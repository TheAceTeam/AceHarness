import { cp, lstat, mkdir, readdir, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { execSync } from 'child_process';
import { getInstallPath, getWorkspaceCacheFile, getWorkspaceSkillPath, getWorkspaceSkillsDir, getWorkspaceRoot } from '@/lib/core/app-paths';

const INSTALL_SKILLS_DIR = getInstallPath('skills');
let seedPromise: Promise<void> | null = null;
let runtimeSkillsSeeded = false;

/** Dependencies required by aceharness-* skills scripts */
const SKILL_DEPS: string[] = [];

interface SeedOptions {
  refreshBundledSkills?: boolean;
  refreshAceHarnessBuiltins?: boolean;
}

/**
 * stat() failures that mean the link target is genuinely unresolvable — not
 * that we merely failed to look at it:
 *   ENOENT  target is gone
 *   ENOTDIR a path component is not a directory, e.g. an upgrade replaced a
 *           directory with a regular file (POSIX; Windows surfaces this same
 *           scenario as ENOENT)
 *   ELOOP   the link chain never terminates
 * Anything else — EACCES/EPERM on a restricted target, transient I/O on a
 * network path — must propagate. Deleting a valid user link because of a
 * temporary error is unrecoverable.
 */
const UNRESOLVABLE_LINK_TARGET_CODES = new Set(['ENOENT', 'ENOTDIR', 'ELOOP']);

/**
 * A symlink with an unresolvable target reports existsSync()===false but still
 * occupies the path, so fs.cp throws ERR_FS_CP_DIR_TO_NON_DIR when copying a
 * directory onto it. Clear only those; valid links are left untouched.
 */
async function removeDanglingLink(dst: string): Promise<void> {
  let entry;
  try {
    entry = await lstat(dst);
  } catch (error: any) {
    // Nothing addressable at dst — nothing to clean.
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return;
    throw error;
  }
  if (!entry.isSymbolicLink()) return;

  try {
    await stat(dst);
    return; // target resolves — a valid link, leave it alone
  } catch (error: any) {
    if (!UNRESOLVABLE_LINK_TARGET_CODES.has(error?.code)) throw error;
  }
  await rm(dst, { force: true, maxRetries: 3 });
}

async function copyBundledEntry(src: string, dst: string, options: { replaceExisting: boolean }): Promise<void> {
  await removeDanglingLink(dst);
  if (existsSync(dst)) {
    if (!options.replaceExisting) return;
    await rm(dst, { recursive: true, force: true, maxRetries: 3 });
  }

  const srcStat = await stat(src);
  if (srcStat.isDirectory()) {
    await mkdir(dirname(dst), { recursive: true });
    await cp(src, dst, { recursive: true, force: true });
    return;
  }

  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: options.replaceExisting });
}

async function copyMissingBundledEntry(src: string, dst: string): Promise<void> {
  await copyBundledEntry(src, dst, { replaceExisting: false });
}

async function copyMissingBundledSkills(srcDir: string, dstDir: string): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    await copyMissingBundledEntry(resolve(srcDir, entry.name), resolve(dstDir, entry.name));
  }
}

async function refreshBundledSkills(srcDir: string, dstDir: string): Promise<void> {
  await mkdir(dstDir, { recursive: true });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    await copyBundledEntry(resolve(srcDir, entry.name), resolve(dstDir, entry.name), { replaceExisting: true });
  }
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

export async function ensureRuntimeSkillsSeeded(options: SeedOptions = {}): Promise<void> {
  const refreshBundled = options.refreshBundledSkills === true || options.refreshAceHarnessBuiltins === true;
  if (runtimeSkillsSeeded && !refreshBundled) return;
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeSkillsDir = getWorkspaceSkillsDir();
    if (!existsSync(INSTALL_SKILLS_DIR)) {
      await mkdir(runtimeSkillsDir, { recursive: true });
      await ensureSkillDeps();
      runtimeSkillsSeeded = true;
      return;
    }

    if (refreshBundled) {
      await refreshBundledSkills(INSTALL_SKILLS_DIR, runtimeSkillsDir);
    }
    await copyMissingBundledSkills(INSTALL_SKILLS_DIR, runtimeSkillsDir);
    await ensureSkillDeps();
    runtimeSkillsSeeded = true;
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export function refreshBundledAceHarnessSkillsOnStartup(): void {
  const globalKey = '__ACE_RUNTIME_SKILLS_STARTUP_REFRESH__';
  const globalState = globalThis as Record<string, unknown>;
  if (globalState[globalKey]) return;
  globalState[globalKey] = true;

  void ensureRuntimeSkillsSeeded({ refreshBundledSkills: true }).catch((error) => {
    console.warn('[runtime-skills] Failed to refresh bundled skills:', error);
  });
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
    if (existsSync(dest)) {
      synced.push(skillName);
      continue;
    }

    try {
      await cp(src, dest, { recursive: true, force: true });
    } catch {
      missing.push(skillName);
      continue;
    }
    synced.push(skillName);
  }

  await ensureSkillDeps();
  runtimeSkillsSeeded = true;
  return { synced, missing };
}

export function getSkillsTempPath(...segments: string[]): string {
  return getWorkspaceCacheFile('skills', ...segments);
}
