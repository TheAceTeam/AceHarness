import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';

function normalizeConfigFilename(filename: string): string {
  return filename.replace(/\\/g, '/').replace(/^\/+/, '');
}

async function walkForConfig(dir: string, targetBaseName: string): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isFile() && entry.name === targetBaseName) {
      return resolve(dir, entry.name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'agents') continue;
    const found = await walkForConfig(resolve(dir, entry.name), targetBaseName);
    if (found) return found;
  }

  return null;
}

export async function resolveWorkflowConfigPath(filename: string): Promise<string | null> {
  const normalized = normalizeConfigFilename(filename);
  const runtimeConfigsDir = await getRuntimeConfigsDirPath();

  const directPath = resolve(runtimeConfigsDir, normalized);
  if (existsSync(directPath)) return directPath;

  if (!normalized.includes('/')) {
    return walkForConfig(runtimeConfigsDir, normalized);
  }

  return null;
}
