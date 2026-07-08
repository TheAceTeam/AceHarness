import fs from 'fs/promises';
import path from 'path';
import { createReadStream, createWriteStream, existsSync } from 'fs';
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

// GET: List all skills
export async function GET() {
  try {
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

    // Save zip to temp
    const skillsDir = await getRuntimeSkillsDirPath();
    const tmpDir = getSkillsTempPath('upload');
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, 'upload.zip');
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(zipPath, buffer);

    // Unzip
    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });
    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', resolve)
        .on('error', reject);
    });

    type SkillImportCandidate = {
      sourceDir: string;
      destName: string;
      label: string;
    };

    const candidates: SkillImportCandidate[] = [];
    const rootSkillMd = path.join(extractDir, 'SKILL.md');

    // Root SKILL.md means the zip itself is a single skill; subdirectories are resources.
    if (existsSync(rootSkillMd)) {
      const skillName = file.name.replace(/\.zip$/i, '');
      candidates.push({ sourceDir: extractDir, destName: skillName, label: skillName });
    } else {
      // Otherwise import every top-level directory that contains SKILL.md.
      const entries = await fs.readdir(extractDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillMd = path.join(extractDir, entry.name, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        candidates.push({ sourceDir: path.join(extractDir, entry.name), destName: entry.name, label: entry.name });
      }
    }

    if (candidates.length === 0) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return jsonOk({ error: '未找到有效的 Skill（需包含 SKILL.md）' }, { status: 400 });
    }

    for (const candidate of candidates) {
      const skillMdPath = path.join(candidate.sourceDir, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const validation = validateSkillFrontmatter(content);
      if (!validation.ok) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return jsonOk(
          { error: `Skill 校验失败（${candidate.label}/SKILL.md）：${validation.error}` },
          { status: 400 }
        );
      }
    }

    const imported: string[] = [];
    for (const candidate of candidates) {
      const dest = path.join(skillsDir, candidate.destName);
      await fs.cp(candidate.sourceDir, dest, { recursive: true });
      imported.push(candidate.destName);
    }

    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return jsonOk({ success: true, imported, message: `导入了 ${imported.length} 个 Skill` });
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
