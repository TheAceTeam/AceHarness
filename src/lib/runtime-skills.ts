import { cp, mkdir, readdir, stat, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { execSync } from 'child_process';
import { getInstallPath, getWorkspaceCacheFile, getWorkspaceSkillPath, getWorkspaceSkillsDir, getWorkspaceRoot } from '@/lib/app-paths';

const INSTALL_SKILLS_DIR = getInstallPath('skills');
let seedPromise: Promise<void> | null = null;
let runtimeSkillsSeeded = false;

/** Dependencies required by aceharness-* skills scripts */
const SKILL_DEPS = ['yaml', 'zod'];

async function copyMissingRecursive(src: string, dst: string): Promise<void> {
  const srcStat = await stat(src);
  if (srcStat.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyMissingRecursive(resolve(src, entry.name), resolve(dst, entry.name));
    }
    return;
  }

  if (existsSync(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: false });
}

/**
 * Ensure skill script dependencies (yaml, zod) are available in the runtime directory.
 * Tries to resolve from the install dir first; if not found, installs into runtime.
 */
async function ensureSkillDeps(): Promise<void> {
  const runtimeRoot = getWorkspaceRoot();
  const runtimeNodeModules = join(runtimeRoot, 'node_modules');

  // Check if deps already resolvable from install dir or runtime
  const missing: string[] = [];
  for (const dep of SKILL_DEPS) {
    const inInstall = existsSync(join(getInstallPath('node_modules'), dep));
    const inRuntime = existsSync(join(runtimeNodeModules, dep));
    if (!inInstall && !inRuntime) {
      missing.push(dep);
    }
  }

  if (missing.length === 0) return;

  // Ensure package.json exists in runtime root
  const pkgPath = join(runtimeRoot, 'package.json');
  if (!existsSync(pkgPath)) {
    await writeFile(pkgPath, '{"private":true}\n');
  }

  try {
    console.log(`[runtime-skills] Installing skill dependencies: ${missing.join(', ')}`);
    execSync(`npm install ${missing.join(' ')} --save --legacy-peer-deps`, {
      cwd: runtimeRoot,
      stdio: 'pipe',
      timeout: 60000,
    });
  } catch (err: any) {
    console.error(`[runtime-skills] Failed to install skill deps:`, err.message);
  }
}

export async function ensureRuntimeSkillsSeeded(): Promise<void> {
  if (runtimeSkillsSeeded) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeSkillsDir = getWorkspaceSkillsDir();
    if (!existsSync(INSTALL_SKILLS_DIR)) {
      await mkdir(runtimeSkillsDir, { recursive: true });
      await ensureSkillDeps();
      runtimeSkillsSeeded = true;
      return;
    }

    if (!existsSync(runtimeSkillsDir)) {
      await mkdir(dirname(runtimeSkillsDir), { recursive: true });
      await cp(INSTALL_SKILLS_DIR, runtimeSkillsDir, { recursive: true, force: false });
      await ensureSkillDeps();
      runtimeSkillsSeeded = true;
      return;
    }

    await copyMissingRecursive(INSTALL_SKILLS_DIR, runtimeSkillsDir);
    await ensureSkillDeps();
    runtimeSkillsSeeded = true;
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export async function getRuntimeSkillsDirPath(): Promise<string> {
  await ensureRuntimeSkillsSeeded();
  return getWorkspaceSkillsDir();
}

export async function getRuntimeSkillPath(...segments: string[]): Promise<string> {
  await ensureRuntimeSkillsSeeded();
  return getWorkspaceSkillPath(...segments);
}

export function getInstallSkillsDirPath(): string {
  return INSTALL_SKILLS_DIR;
}

export async function syncInstalledSkillsToRuntime(skillNames: string[]): Promise<{ synced: string[]; missing: string[] }> {
  await ensureRuntimeSkillsSeeded();

  const runtimeSkillsDir = getWorkspaceSkillsDir();
  const synced: string[] = [];
  const missing: string[] = [];

  for (const rawName of skillNames) {
    const skillName = rawName.trim();
    if (!skillName) continue;

    const src = join(INSTALL_SKILLS_DIR, skillName);
    if (!existsSync(src)) {
      missing.push(skillName);
      continue;
    }

    const dest = join(runtimeSkillsDir, skillName);
    await cp(src, dest, { recursive: true, force: true });
    synced.push(skillName);
  }

  await ensureSkillDeps();
  runtimeSkillsSeeded = true;
  return { synced, missing };
}

export function getSkillsTempPath(...segments: string[]): string {
  return getWorkspaceCacheFile('skills', ...segments);
}
