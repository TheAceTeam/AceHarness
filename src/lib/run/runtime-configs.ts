import { cp, mkdir, readdir, readFile, stat, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { parse, stringify } from 'yaml';
import {
  getInstallConfigPath,
  getInstallConfigsDir,
  getWorkspaceAgentsDir,
  getWorkspaceConfigPath,
  getWorkspaceConfigsDir,
} from '@/lib/core/app-paths';

const DELETED_MARKER = '.deleted.json';

let seedPromise: Promise<void> | null = null;

interface ModelConfigEntry {
  value?: string;
  [key: string]: unknown;
}

interface ModelsConfig {
  models?: ModelConfigEntry[];
  [key: string]: unknown;
}

async function loadDeletedSet(configsDir: string): Promise<Set<string>> {
  const markerPath = resolve(configsDir, DELETED_MARKER);
  if (!existsSync(markerPath)) return new Set();
  try {
    const content = await readFile(markerPath, 'utf-8');
    const list: string[] = JSON.parse(content);
    return new Set(list);
  } catch {
    return new Set();
  }
}

async function saveDeletedSet(configsDir: string, deleted: Set<string>): Promise<void> {
  const markerPath = resolve(configsDir, DELETED_MARKER);
  await writeFile(markerPath, JSON.stringify([...deleted], null, 2), 'utf-8');
}

export async function markConfigDeleted(configsDir: string, relativePath: string): Promise<void> {
  const deleted = await loadDeletedSet(configsDir);
  deleted.add(relativePath);
  await saveDeletedSet(configsDir, deleted);
}

export async function unmarkConfigDeleted(configsDir: string, relativePath: string): Promise<void> {
  const deleted = await loadDeletedSet(configsDir);
  if (!deleted.has(relativePath)) return;
  deleted.delete(relativePath);
  await saveDeletedSet(configsDir, deleted);
}

async function copyMissingRecursive(src: string, dst: string, deletedSet: Set<string>, baseDir: string): Promise<void> {
  const srcStat = await stat(src);
  if (srcStat.isDirectory()) {
    await mkdir(dst, { recursive: true });
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      await copyMissingRecursive(resolve(src, entry.name), resolve(dst, entry.name), deletedSet, baseDir);
    }
    return;
  }

  const rel = relative(baseDir, dst);
  if (deletedSet.has(rel)) return;

  if (existsSync(dst)) return;
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst, { force: false });
}

async function mergeBundledModelsIntoRuntime(installConfigsDir: string, runtimeConfigsDir: string): Promise<void> {
  const installModelsPath = resolve(installConfigsDir, 'models', 'models.yaml');
  const runtimeModelsPath = resolve(runtimeConfigsDir, 'models', 'models.yaml');
  if (!existsSync(installModelsPath) || !existsSync(runtimeModelsPath)) return;

  try {
    const [installContent, runtimeContent] = await Promise.all([
      readFile(installModelsPath, 'utf-8'),
      readFile(runtimeModelsPath, 'utf-8'),
    ]);
    const installCfg = (parse(installContent) as ModelsConfig) || {};
    const runtimeCfg = (parse(runtimeContent) as ModelsConfig) || {};
    const bundledModels = Array.isArray(installCfg.models) ? installCfg.models : [];
    const runtimeModels = Array.isArray(runtimeCfg.models) ? runtimeCfg.models : [];
    if (bundledModels.length === 0) return;

    const existing = new Set(
      runtimeModels
        .map((model) => String(model?.value || '').trim())
        .filter(Boolean),
    );
    const missing = bundledModels.filter((model) => {
      const value = String(model?.value || '').trim();
      return value && !existing.has(value);
    });
    if (missing.length === 0) return;

    runtimeCfg.models = [...runtimeModels, ...missing];
    await writeFile(runtimeModelsPath, stringify(runtimeCfg), 'utf-8');
  } catch {
    // Keep seeding resilient: parsing/merge errors must not block startup.
  }
}

export async function ensureRuntimeConfigsSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;

  seedPromise = (async () => {
    const runtimeConfigsDir = getWorkspaceConfigsDir();
    const installConfigsDir = getInstallConfigsDir();

    if (!existsSync(runtimeConfigsDir)) {
      await mkdir(dirname(runtimeConfigsDir), { recursive: true });
      await cp(installConfigsDir, runtimeConfigsDir, { recursive: true, force: false });
      return;
    }

    const deletedSet = await loadDeletedSet(runtimeConfigsDir);

    // Remove tombstoned files that still exist on disk
    for (const rel of deletedSet) {
      const fullPath = resolve(runtimeConfigsDir, rel);
      if (existsSync(fullPath)) {
        try { await unlink(fullPath); } catch { /* ignore */ }
      }
    }

    await copyMissingRecursive(installConfigsDir, runtimeConfigsDir, deletedSet, runtimeConfigsDir);
    await mergeBundledModelsIntoRuntime(installConfigsDir, runtimeConfigsDir);
  })().finally(() => {
    seedPromise = null;
  });

  return seedPromise;
}

export async function getRuntimeWorkflowConfigPath(filename: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath(filename);
}

export async function getRuntimeAgentConfigPath(name: string): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('agents', `${name}.yaml`);
}

export async function getRuntimeModelsConfigPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('models', 'models.yaml');
}

export async function getRuntimeSdkSettingsPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigPath('settings', 'cangjie-sdks.yaml');
}

export async function getRuntimeConfigsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceConfigsDir();
}

export async function getRuntimeAgentsDirPath(): Promise<string> {
  await ensureRuntimeConfigsSeeded();
  return getWorkspaceAgentsDir();
}

export function getBundledWorkflowConfigPath(filename: string): string {
  return getInstallConfigPath(filename);
}
