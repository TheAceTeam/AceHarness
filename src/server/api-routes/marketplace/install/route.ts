import { getSkillsTempPath, getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { getInstallPath } from '@/lib/core/app-paths';
import { validateSkillFrontmatter } from '@/lib/skill/frontmatter';
import { downloadMarketplacePackage } from '@/lib/marketplace/provider';
import { getMarketplaceSource } from '@/lib/marketplace/sources';
import { parseDocument } from 'yaml';
import { getMarketplaceInstallFolder } from '@/constants/marketplace';
import { validateInstallRequest, validateSkillName } from '@/lib/marketplace/validators';
import fs from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import { existsSync } from 'fs';
import { pipeline } from 'stream/promises';
import unzipper from 'unzipper';
import { assertSafeRelativePath, WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT, WORKSPACE_ARCHIVE_TOTAL_SIZE_LIMIT } from '@/lib/core/workspace-path-safety';
import { requireAuth } from '@/lib/auth/middleware';
import { errorMessage, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

const installationsInProgress = new Set<string>();

interface ArchiveEntry {
  type: string;
  path: string;
  uncompressedSize: number;
  stream(): NodeJS.ReadableStream;
}

async function extractSkillPackage(zip: ArrayBuffer, destination: string): Promise<void> {
  const directory = await unzipper.Open.buffer(Buffer.from(zip)) as { files: ArchiveEntry[] };
  const files = directory.files.filter((entry) => entry.type === 'File');
  const size = files.reduce((sum, entry) => sum + entry.uncompressedSize, 0);
  if (files.length > WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT || size > WORKSPACE_ARCHIVE_TOTAL_SIZE_LIMIT) {
    throw new Error('技能 ZIP 超出解压大小或文件数限制。');
  }
  for (const file of files) {
    const relative = assertSafeRelativePath(file.path, 'ZIP 路径');
    if (!relative || relative.includes(':')) throw new Error('技能 ZIP 包含无效的文件路径。');
    const target = path.join(destination, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await pipeline(file.stream(), createWriteStream(target, { flags: 'wx' }));
  }
}

async function publishSkillDirectory(skillDir: string, paths: string[]): Promise<void> {
  const locations: { dest: string; staging: string; backedUp: boolean; published: boolean }[] = [];
  let complete = false;
  try {
    for (const dest of new Set(paths)) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const staging = await fs.mkdtemp(path.join(path.dirname(dest), '.marketplace-install-'));
      locations.push({ dest, staging, backedUp: false, published: false });
      await fs.cp(skillDir, path.join(staging, 'new'), { recursive: true });
    }
    for (const location of locations) {
      if (existsSync(location.dest)) {
        await fs.rename(location.dest, path.join(location.staging, 'backup'));
        location.backedUp = true;
      }
      await fs.rename(path.join(location.staging, 'new'), location.dest);
      location.published = true;
    }
    complete = true;
  } catch (error) {
    for (const location of locations.reverse()) {
      try {
        if (location.published) await fs.rm(location.dest, { recursive: true, force: true });
        if (location.backedUp) {
          await fs.rename(path.join(location.staging, 'backup'), location.dest);
          location.backedUp = false;
        }
      } catch (restoreError) {
        console.error('[marketplace] Could not restore ' + location.dest, restoreError);
      }
    }
    throw error;
  } finally {
    for (const location of locations) {
      // Keep backups if rollback could not restore them.
      if (complete || !location.backedUp) {
        await fs.rm(location.staging, { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

export async function POST(request: Request) {
  let tmpDir: string | undefined;
  let lockedFolder: string | undefined;
  try {
    const body = await readJsonBody(request, {});

    if (!validateInstallRequest(body)) {
      return jsonOk({
        success: false,
        error: 'Invalid request parameters',
      }, { status: 400 });
    }

    const { skillName, source = 'matrix', version, namespace } = body;

    if (!validateSkillName(skillName, source)) {
      return jsonOk({
        success: false,
        error: 'Invalid skill name format',
      }, { status: 400 });
    }

    if (source !== 'matrix') {
      const auth = await requireAuth(request);
      if (auth instanceof Response) return auth;
    }

    const selected = await getMarketplaceSource(source);
    if (!selected) return jsonOk({ success: false, error: '该市场来源不存在' }, { status: 404 });

    if (namespace && selected.protocol !== 'skillhub') {
      return jsonOk({ success: false, error: '该市场来源不支持命名空间' }, { status: 400 });
    }
    const folder = getMarketplaceInstallFolder(source, skillName, namespace);
    if (installationsInProgress.has(folder)) {
      return jsonOk({ success: false, error: '该 Skill 正在安装' }, { status: 409 });
    }
    installationsInProgress.add(folder);
    lockedFolder = folder;

    const zipBuffer = await downloadMarketplacePackage(selected, skillName, version, namespace);

    const tempRoot = getSkillsTempPath('install');
    await fs.mkdir(tempRoot, { recursive: true });
    tmpDir = await fs.mkdtemp(path.join(tempRoot, 'skill-'));

    const extractDir = path.join(tmpDir, 'extracted');
    await extractSkillPackage(zipBuffer, extractDir);

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
        return jsonOk({
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
      return jsonOk({
        success: false,
        error: `Skill validation failed: ${validation.error}`,
      }, { status: 400 });
    }

    if (source !== 'matrix') {
      // Runtime consumers resolve skills by their frontmatter name and folder name.
      const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)!;
      const document = parseDocument(frontmatter[1]);
      document.set('name', folder);
      await fs.writeFile(skillMdPath, '---\n' + document.toString() + '---\n' + content.slice(frontmatter[0].length));
    }

    const runtimePath = path.join(await getRuntimeSkillsDirPath(), folder);
    const installPath = getInstallPath('skills', folder);
    await publishSkillDirectory(skillDir, [runtimePath, installPath]);

    return jsonOk({
      success: true,
      data: {
        skillName,
        source,
        runtimePath,
        installPath,
        message: `Skill "${skillName}" installed successfully`,
      },
    });
  } catch (error) {
    console.error('Install API error:', error);

    return jsonOk({
      success: false,
      error: errorMessage(error) || 'Internal server error',
    }, { status: 500 });
  } finally {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    if (lockedFolder) installationsInProgress.delete(lockedFolder);
  }
}
