import fs from 'fs/promises';
import path from 'path';
import { createWriteStream, existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import { randomUUID } from 'crypto';
import unzipper from 'unzipper';
import { ZipFile } from 'yazl';
import { getInstallSkillsDirPath, getRuntimeSkillsDirPath, getSkillsTempPath, syncInstalledSkillsToRuntime } from '@/lib/run/runtime-skills';
import { normalizeSkillSource, normalizeStringArray, validateSkillFrontmatter } from '@/lib/skill/frontmatter';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

/** Zip directory contents using yazl (portable; avoids Windows missing `zip` and GBK stderr mojibake). */
async function zipDirectoryContents(sourceDir: string, destZipPath: string): Promise<void> {
  const zipfile = new ZipFile();

  async function walk(rel: string): Promise<void> {
    const abs = path.join(sourceDir, rel);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    for (const entry of entries) {
      const entryRel = rel ? path.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(entryRel);
      } else {
        const metadataPath = entryRel.split(path.sep).join('/');
        zipfile.addFile(path.join(sourceDir, entryRel), metadataPath);
      }
    }
  }

  await walk('');

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(destZipPath);
    out.on('error', reject);
    out.on('close', () => resolve());
    zipfile.outputStream.on('error', reject);
    zipfile.outputStream.pipe(out);
    zipfile.end();
  });
}

/** Scan skills/ directory, find xxx/SKILL.md with valid frontmatter */
async function discoverSkills(skillsDir: string) {
  const skills: any[] = [];
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const validation = validateSkillFrontmatter(content);
        if (!validation.ok) continue;
        const fm = validation.frontmatter;
        const skillStat = await fs.stat(skillMdPath).catch(() => null);

        // Check for PROMPT.md
        const promptMdPath = path.join(skillsDir, entry.name, 'PROMPT.md');
        const hasPromptMd = existsSync(promptMdPath);

        skills.push({
          name: fm.name,
          path: entry.name,
          description: fm.description,
          descriptionZh: fm.descriptionZH || '',
          tags: normalizeStringArray(fm.tags),
          source: normalizeSkillSource(fm.source),
          hasPromptMd,
          updatedAt: skillStat?.mtime?.toISOString(),
          detailedDescription: content,
        });
      } catch { /* no SKILL.md */ }
    }
  } catch { /* skills dir doesn't exist */ }
  return skills;
}

type SkillImportStatus = 'queued' | 'running' | 'completed' | 'failed';
type SkillImportPhase = 'queued' | 'reading' | 'scanning' | 'validating' | 'writing' | 'completed' | 'failed';
type SkillImportResult = {
  name: string;
  path: string;
  status: 'imported' | 'failed' | 'skipped';
  reason?: string;
};
type SkillImportJob = {
  id: string;
  fileName: string;
  fileSize: number;
  status: SkillImportStatus;
  phase: SkillImportPhase;
  progress: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  imported: string[];
  failed: SkillImportResult[];
  skipped: SkillImportResult[];
  results: SkillImportResult[];
  summary: { total: number; imported: number; failed: number; skipped: number };
  error?: string;
};
type SkillImportCandidate = {
  destName: string;
  label: string;
  relativePath: string;
  prefix: string;
  skillMdEntry: any;
};

const skillImportJobs: Map<string, SkillImportJob> = ((globalThis as any).__ACE_SKILL_IMPORT_JOBS ||= new Map());

function updateSkillImportJob(id: string, patch: Partial<SkillImportJob>): SkillImportJob | null {
  const current = skillImportJobs.get(id);
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  skillImportJobs.set(id, next);
  return next;
}

function summarizeSkillImportResults(results: SkillImportResult[]) {
  const imported = results.filter((item) => item.status === 'imported').map((item) => item.name);
  const failed = results.filter((item) => item.status === 'failed');
  const skipped = results.filter((item) => item.status === 'skipped');
  return {
    imported,
    failed,
    skipped,
    summary: {
      total: results.length,
      imported: imported.length,
      failed: failed.length,
      skipped: skipped.length,
    },
  };
}

function getZipParentPath(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function getZipBaseName(rawPath: string): string {
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function shouldSkipSkillArchiveFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized.split('/').includes('__pycache__') || normalized.endsWith('.pyc');
}

function getZipEntrySize(entry: any): number | null {
  const raw = entry?.uncompressedSize ?? entry?.vars?.uncompressedSize;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

async function writeZipEntryIfChanged(entry: any, target: string): Promise<'written' | 'skipped'> {
  const entrySize = getZipEntrySize(entry);
  if (entrySize != null) {
    const existing = await fs.stat(target).catch(() => null);
    if (existing?.isFile() && existing.size === entrySize) return 'skipped';
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  if (typeof entry.stream === 'function') {
    await pipeline(entry.stream(), createWriteStream(target));
  } else {
    await fs.writeFile(target, await entry.buffer());
  }
  return 'written';
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function processSkillImportJob(jobId: string, buffer: Buffer, fileName: string): Promise<void> {
  try {
    const skillsDir = await getRuntimeSkillsDirPath();
    updateSkillImportJob(jobId, {
      status: 'running',
      phase: 'reading',
      progress: 8,
      message: '正在读取 ZIP 目录。',
    });

    const directory = await (unzipper as any).Open.buffer(buffer);
    const files: any[] = (directory.files || []).filter((entry: any) => entry.type === 'File');

    updateSkillImportJob(jobId, {
      phase: 'scanning',
      progress: 20,
      message: `正在扫描 ${files.length} 个文件。`,
    });

    const candidates = new Map<string, SkillImportCandidate>();
    const skippedByPath = new Map<string, SkillImportResult>();
    const rootSkillMd = files.find((entry) => String(entry.path || '').replace(/\\/g, '/') === 'SKILL.md');
    if (rootSkillMd) {
      const skillName = fileName.replace(/\.zip$/i, '');
      candidates.set('.', {
        destName: skillName,
        label: skillName,
        relativePath: '.',
        prefix: '',
        skillMdEntry: rootSkillMd,
      });
    } else {
      const directSkillEntries = files.filter((entry) => {
        const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = rawPath.split('/');
        return parts.at(-1) === 'SKILL.md' && (
          parts.length === 2
          || (parts.length === 3 && ['skills', 'skill'].includes(parts[0].toLowerCase()))
        );
      });

      for (const entry of directSkillEntries) {
        const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const parentPath = getZipParentPath(rawPath);
        const destName = getZipBaseName(parentPath);
        candidates.set(parentPath, {
          destName,
          label: parentPath,
          relativePath: parentPath,
          prefix: `${parentPath}/`,
          skillMdEntry: entry,
        });
      }

      const topLevelDirs = new Set<string>();
      const wrappedSkillDirs = new Set<string>();
      for (const entry of files) {
        const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
        const parts = rawPath.split('/');
        if (parts[0]) topLevelDirs.add(parts[0]);
        if (parts.length >= 2 && ['skills', 'skill'].includes(parts[0].toLowerCase())) {
          wrappedSkillDirs.add(`${parts[0]}/${parts[1]}`);
        }
      }
      for (const dir of topLevelDirs) {
        if (['skills', 'skill'].includes(dir.toLowerCase())) continue;
        if (!candidates.has(dir)) {
          skippedByPath.set(dir, { name: dir, path: dir, status: 'skipped', reason: '目录下没有直接的 SKILL.md' });
        }
      }
      for (const dir of wrappedSkillDirs) {
        if (!candidates.has(dir)) {
          skippedByPath.set(dir, { name: getZipBaseName(dir), path: dir, status: 'skipped', reason: '目录下没有直接的 SKILL.md' });
        }
      }
    }

    const candidateList = Array.from(candidates.values());
    const skippedResults = Array.from(skippedByPath.values());
    if (candidateList.length === 0) {
      const results = skippedResults;
      const summary = summarizeSkillImportResults(results);
      updateSkillImportJob(jobId, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        message: '未找到有效的 Skill（需包含 SKILL.md）。',
        error: '未找到有效的 Skill（需包含 SKILL.md）',
        results,
        ...summary,
        completedAt: new Date().toISOString(),
      });
      return;
    }

    updateSkillImportJob(jobId, {
      phase: 'validating',
      progress: 35,
      message: `发现 ${candidateList.length} 个候选 Skill，正在校验 SKILL.md。`,
    });

    const results: SkillImportResult[] = [];
    const validCandidates: SkillImportCandidate[] = [];
    for (let index = 0; index < candidateList.length; index++) {
      const candidate = candidateList[index];
      const validationProgress = 35 + Math.floor(((index + 1) / candidateList.length) * 25);
      try {
        const content = (await candidate.skillMdEntry.buffer()).toString('utf-8');
        const validation = validateSkillFrontmatter(content);
        if (!validation.ok) {
          results.push({ name: candidate.destName, path: candidate.relativePath, status: 'failed', reason: validation.error });
        } else {
          validCandidates.push(candidate);
        }
      } catch (error) {
        results.push({
          name: candidate.destName,
          path: candidate.relativePath,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      updateSkillImportJob(jobId, {
        phase: 'validating',
        progress: validationProgress,
        message: `正在校验 SKILL.md：${index + 1}/${candidateList.length}`,
        results: [...results],
      });
    }

    updateSkillImportJob(jobId, {
      phase: 'writing',
      progress: 62,
      message: `正在写入 ${validCandidates.length} 个 Skill。`,
    });

    for (let index = 0; index < validCandidates.length; index++) {
      const candidate = validCandidates[index];
      const dest = path.join(skillsDir, candidate.destName);
      try {
        await fs.mkdir(dest, { recursive: true });
        const candidateFiles = files.filter((entry) => {
          const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
          if (!rawPath.startsWith(candidate.prefix)) return false;
          const relative = candidate.prefix ? rawPath.slice(candidate.prefix.length) : rawPath;
          return Boolean(relative) && !relative.includes('..') && !shouldSkipSkillArchiveFile(relative);
        });
        let written = 0;
        let skipped = 0;
        await runWithConcurrency(candidateFiles, 12, async (entry) => {
          const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
          const relative = candidate.prefix ? rawPath.slice(candidate.prefix.length) : rawPath;
          const target = path.join(dest, ...relative.split('/'));
          const result = await writeZipEntryIfChanged(entry, target);
          if (result === 'written') written++;
          else skipped++;
        });
        const ignored = files.filter((entry) => {
          const rawPath = String(entry.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
          if (!rawPath.startsWith(candidate.prefix)) return false;
          const relative = candidate.prefix ? rawPath.slice(candidate.prefix.length) : rawPath;
          return shouldSkipSkillArchiveFile(relative);
        }).length;
        results.push({
          name: candidate.destName,
          path: candidate.relativePath,
          status: 'imported',
          reason: `已写入 ${written} 个文件，跳过未变化 ${skipped} 个${ignored ? `，忽略缓存 ${ignored} 个` : ''}`,
        });
      } catch (error) {
        results.push({
          name: candidate.destName,
          path: candidate.relativePath,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      const writeProgress = 62 + Math.floor(((index + 1) / Math.max(1, validCandidates.length)) * 33);
      updateSkillImportJob(jobId, {
        phase: 'writing',
        progress: writeProgress,
        message: `正在写入 Skill：${index + 1}/${validCandidates.length}`,
        results: [...results],
      });
    }

    results.push(...skippedResults);
    const summary = summarizeSkillImportResults(results);
    updateSkillImportJob(jobId, {
      status: summary.imported.length > 0 ? 'completed' : 'failed',
      phase: summary.imported.length > 0 ? 'completed' : 'failed',
      progress: 100,
      message: `导入完成：成功 ${summary.summary.imported} 个，失败 ${summary.summary.failed} 个，跳过 ${summary.summary.skipped} 个`,
      error: summary.imported.length > 0 ? undefined : '没有 Skill 导入成功',
      results,
      ...summary,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    updateSkillImportJob(jobId, {
      status: 'failed',
      phase: 'failed',
      progress: 100,
      message: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
      completedAt: new Date().toISOString(),
    });
  }
}

// GET: List all skills
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const importJobId = url.searchParams.get('importJobId');
    if (importJobId) {
      const job = skillImportJobs.get(importJobId);
      if (!job) return jsonOk({ error: '找不到导入任务' }, { status: 404 });
      return jsonOk(job, { headers: { 'Cache-Control': 'no-store' } });
    }

    const skillsDir = await getRuntimeSkillsDirPath();
    const installSkillsDir = getInstallSkillsDirPath();
    const dirExists = existsSync(skillsDir);
    if (!dirExists) {
      return jsonOk({
        skills: [],
        installSkills: [],
        isCloned: true,
        message: 'Skills 目录不存在',
        runtimeSkillsDir: skillsDir,
        installSkillsDir,
      });
    }
    const [skills, installSkills] = await Promise.all([
      discoverSkills(skillsDir),
      existsSync(installSkillsDir) ? discoverSkills(installSkillsDir) : Promise.resolve([]),
    ]);
    return jsonOk({ skills, installSkills, isCloned: true, runtimeSkillsDir: skillsDir, installSkillsDir });
  } catch (error) {
    console.error('Failed to read skills:', error);
    return jsonOk({ error: 'Failed to read skills' }, { status: 500 });
  }
}

// POST: Upload zip to import skills
export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return jsonOk({ error: '请上传 ZIP 文件' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return jsonOk({ error: '未找到上传文件' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const jobId = `skill-import-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const job: SkillImportJob = {
      id: jobId,
      fileName: file.name,
      fileSize: file.size,
      status: 'queued',
      phase: 'queued',
      progress: 0,
      message: '导入任务已创建。',
      startedAt: now,
      updatedAt: now,
      imported: [],
      failed: [],
      skipped: [],
      results: [],
      summary: { total: 0, imported: 0, failed: 0, skipped: 0 },
    };
    skillImportJobs.set(jobId, job);
    void processSkillImportJob(jobId, buffer, file.name);

    return jsonOk({
      success: true,
      async: true,
      jobId,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      message: job.message,
    });
  } catch (error) {
    console.error('Failed to import skills:', error);
    return jsonOk({ error: '导入失败: ' + (error as Error).message }, { status: 500 });
  }
}

// PUT: Export selected skills as zip
export async function PUT(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const skillNames: string[] = body.skills || [];
    if (skillNames.length === 0) {
      return jsonOk({ error: '请选择要导出的 Skill' }, { status: 400 });
    }

    const skillsDir = await getRuntimeSkillsDirPath();
    // Verify all skills exist
    const missing: string[] = [];
    for (const name of skillNames) {
      if (!existsSync(path.join(skillsDir, name, 'SKILL.md'))) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      return jsonOk({ error: `找不到 Skill: ${missing.join(', ')}` }, { status: 404 });
    }

    // Create zip
    const tmpDir = getSkillsTempPath('export');
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tmpDir, { recursive: true });

    // Copy skills to tmp
    for (const name of skillNames) {
      await fs.cp(path.join(skillsDir, name), path.join(tmpDir, name), { recursive: true });
    }

    const zipPath = getSkillsTempPath('skills-export.zip');
    await zipDirectoryContents(tmpDir, zipPath);

    const zipBuffer = await fs.readFile(zipPath);

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(zipPath, { force: true }).catch(() => {});

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="skills-export.zip"`,
      },
    });
  } catch (error) {
    console.error('Failed to export skills:', error);
    return jsonOk({ error: '导出失败: ' + (error as Error).message }, { status: 500 });
  }
}

// PATCH: Sync selected installed skills into runtime skills directory
export async function PATCH(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const skillNames = Array.isArray(body.skills)
      ? body.skills.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    if (skillNames.length === 0) {
      return jsonOk({ error: '请选择要同步的 Skill' }, { status: 400 });
    }

    const installSkillsDir = getInstallSkillsDirPath();
    if (!existsSync(installSkillsDir)) {
      return jsonOk({ error: '安装目录中不存在 skills 目录' }, { status: 404 });
    }

    const installSkills = await discoverSkills(installSkillsDir);
    const installSkillSet = new Set(installSkills.map((skill) => skill.path));
    const invalid = skillNames.filter((name: string) => !installSkillSet.has(name));
    if (invalid.length > 0) {
      return jsonOk({ error: `这些 Skill 不在安装目录中：${invalid.join(', ')}` }, { status: 404 });
    }

    const result = await syncInstalledSkillsToRuntime(skillNames);
    return jsonOk({
      success: true,
      synced: result.synced,
      missing: result.missing,
      message: `已同步 ${result.synced.length} 个 Skill 到 runtime 目录`,
    });
  } catch (error) {
    console.error('Failed to sync installed skills:', error);
    return jsonOk({ error: '同步失败: ' + (error as Error).message }, { status: 500 });
  }
}

// DELETE: Remove skills by name
export async function DELETE(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const skillNames = Array.isArray(body.skills)
      ? body.skills.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];

    if (skillNames.length === 0) {
      return jsonOk({ error: '请选择要删除的 Skill' }, { status: 400 });
    }

    const skillsDir = await getRuntimeSkillsDirPath();
    if (!existsSync(skillsDir)) {
      return jsonOk({ error: 'Skills 目录不存在' }, { status: 404 });
    }

    const deleted: string[] = [];
    const notFound: string[] = [];
    for (const name of skillNames) {
      const skillPath = path.join(skillsDir, name);
      if (existsSync(skillPath)) {
        await fs.rm(skillPath, { recursive: true, force: true });
        deleted.push(name);
      } else {
        notFound.push(name);
      }
    }

    return jsonOk({
      success: true,
      deleted,
      notFound,
      message: `已删除 ${deleted.length} 个 Skill${notFound.length ? `，${notFound.length} 个未找到` : ''}`,
    });
  } catch (error) {
    console.error('Failed to delete skills:', error);
    return jsonOk({ error: '删除失败: ' + (error as Error).message }, { status: 500 });
  }
}
