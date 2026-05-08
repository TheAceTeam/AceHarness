import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { getRuntimeSkillsDirPath, getSkillsTempPath } from '@/lib/runtime-skills';
import { normalizeSkillSource, normalizeStringArray, validateSkillFrontmatter } from '@/lib/skill-frontmatter';

/** Scan skills/ directory, find xxx/SKILL.md with valid frontmatter */
async function discoverSkills() {
  const skills: any[] = [];
  try {
    const skillsDir = await getRuntimeSkillsDirPath();
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const validation = validateSkillFrontmatter(content);
        if (!validation.ok) continue;
        const fm = validation.frontmatter;

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
    const dirExists = existsSync(skillsDir);
    if (!dirExists) {
      return NextResponse.json({ skills: [], isCloned: true, message: 'Skills 目录不存在', runtimeSkillsDir: skillsDir });
    }
    const skills = await discoverSkills();
    return NextResponse.json({ skills, isCloned: true, runtimeSkillsDir: skillsDir });
  } catch (error) {
    console.error('Failed to read skills:', error);
    return NextResponse.json({ error: 'Failed to read skills' }, { status: 500 });
  }
}

// POST: Upload zip to import skills
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: '请上传 ZIP 文件' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: '未找到上传文件' }, { status: 400 });
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
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(`unzip -o "${zipPath}" -d "${extractDir}"`, { maxBuffer: 50 * 1024 * 1024 });

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
      return NextResponse.json({ error: '未找到有效的 Skill（需包含 SKILL.md）' }, { status: 400 });
    }

    for (const candidate of candidates) {
      const skillMdPath = path.join(candidate.sourceDir, 'SKILL.md');
      const content = await fs.readFile(skillMdPath, 'utf-8');
      const validation = validateSkillFrontmatter(content);
      if (!validation.ok) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return NextResponse.json(
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

    return NextResponse.json({ success: true, imported, message: `导入了 ${imported.length} 个 Skill` });
  } catch (error) {
    console.error('Failed to import skills:', error);
    return NextResponse.json({ error: '导入失败: ' + (error as Error).message }, { status: 500 });
  }
}

// PUT: Export selected skills as zip
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const skillNames: string[] = body.skills || [];
    if (skillNames.length === 0) {
      return NextResponse.json({ error: '请选择要导出的 Skill' }, { status: 400 });
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
      return NextResponse.json({ error: `找不到 Skill: ${missing.join(', ')}` }, { status: 404 });
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
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { maxBuffer: 50 * 1024 * 1024 });

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
    return NextResponse.json({ error: '导出失败: ' + (error as Error).message }, { status: 500 });
  }
}
