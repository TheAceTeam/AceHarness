import { NextRequest, NextResponse } from 'next/server';
import { getSkillsTempPath, getRuntimeSkillsDirPath } from '@/lib/runtime-skills';
import { getInstallPath } from '@/lib/app-paths';
import { validateSkillFrontmatter } from '@/lib/skill-frontmatter';
import { MarketplaceClient } from '@/lib/marketplace-client';
import { validateInstallRequest, validateSkillName } from '@/lib/marketplace-validators';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { existsSync } from 'fs';
import unzipper from 'unzipper';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!validateInstallRequest(body)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request parameters',
      }, { status: 400 });
    }

    const { skillName } = body;

    if (!validateSkillName(skillName)) {
      return NextResponse.json({
        success: false,
        error: 'Invalid skill name format',
      }, { status: 400 });
    }

    const client = new MarketplaceClient();

    const zipBuffer = await client.downloadSkill(skillName);

    const tmpDir = getSkillsTempPath('install', skillName);
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await fs.mkdir(tmpDir, { recursive: true });

    const zipPath = path.join(tmpDir, `${skillName}.zip`);
    await fs.writeFile(zipPath, Buffer.from(zipBuffer));

    const extractDir = path.join(tmpDir, 'extracted');
    await fs.mkdir(extractDir, { recursive: true });

    await new Promise<void>((resolve, reject) => {
      createReadStream(zipPath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on('close', () => resolve())
        .on('error', (err: Error) => reject(err));
    });

    const rootSkillMd = path.join(extractDir, 'SKILL.md');
    let skillDir: string;

    if (existsSync(rootSkillMd)) {
      skillDir = extractDir;
    } else {
      const entries = await fs.readdir(extractDir, { withFileTypes: true });
      const skillEntry = entries.find(entry => {
        if (!entry.isDirectory()) return false;
        return existsSync(path.join(extractDir, entry.name, 'SKILL.md'));
      });

      if (!skillEntry) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        return NextResponse.json({
          success: false,
          error: 'SKILL.md file not found in the skill package',
        }, { status: 400 });
      }

      skillDir = path.join(extractDir, skillEntry.name);
    }

    const skillMdPath = path.join(skillDir, 'SKILL.md');
    const content = await fs.readFile(skillMdPath, 'utf-8');
    const validation = validateSkillFrontmatter(content);

    if (!validation.ok) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      return NextResponse.json({
        success: false,
        error: `Skill validation failed: ${validation.error}`,
      }, { status: 400 });
    }

    const runtimeSkillsDir = await getRuntimeSkillsDirPath();
    const runtimePath = path.join(runtimeSkillsDir, skillName);

    if (existsSync(runtimePath)) {
      await fs.rm(runtimePath, { recursive: true, force: true });
    }
    await fs.cp(skillDir, runtimePath, { recursive: true });

    const installSkillsDir = getInstallPath('skills');
    const installPath = path.join(installSkillsDir, skillName);

    await fs.mkdir(installSkillsDir, { recursive: true });
    if (existsSync(installPath)) {
      await fs.rm(installPath, { recursive: true, force: true });
    }
    await fs.cp(skillDir, installPath, { recursive: true });

    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    return NextResponse.json({
      success: true,
      data: {
        skillName,
        runtimePath,
        installPath,
        message: `Skill "${skillName}" installed successfully`,
      },
    });
  } catch (error: any) {
    console.error('Install API error:', error);

    return NextResponse.json({
      success: false,
      error: error.message || 'Internal server error',
    }, { status: 500 });
  }
}