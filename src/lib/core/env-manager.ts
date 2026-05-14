/**
 * 环境变量管理 - 存储到 data/env-vars.yaml
 * 支持单独启用/禁用，在 claude 进程启动前注入
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

const ENV_VARS_PATH = getWorkspaceDataFile('env-vars.yaml');
const USER_ENV_DIR = getWorkspaceDataFile('env-vars.users');

export interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

function getUserEnvPath(userId: string): string {
  return resolve(USER_ENV_DIR, `${userId}.yaml`);
}

async function readVarsFromFile(filePath: string): Promise<EnvVar[]> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parse(content);
    return Array.isArray(parsed?.vars) ? parsed.vars : [];
  } catch {
    return [];
  }
}

export async function loadEnvVars(options?: { scope?: 'system' | 'user' | 'merged'; userId?: string }): Promise<EnvVar[]> {
  const scope = options?.scope || 'system';
  if (scope === 'system') return readVarsFromFile(ENV_VARS_PATH);
  if (scope === 'user') {
    if (!options?.userId) return [];
    return readVarsFromFile(getUserEnvPath(options.userId));
  }

  const systemVars = await readVarsFromFile(ENV_VARS_PATH);
  const userVars = options?.userId ? await readVarsFromFile(getUserEnvPath(options.userId)) : [];
  const merged = new Map<string, EnvVar>();
  for (const item of systemVars) {
    if (!item?.key) continue;
    merged.set(item.key, item);
  }
  for (const item of userVars) {
    if (!item?.key) continue;
    merged.set(item.key, item);
  }
  return Array.from(merged.values());
}

export async function saveEnvVars(vars: EnvVar[], options?: { scope?: 'system' | 'user'; userId?: string }): Promise<void> {
  const scope = options?.scope || 'system';
  const targetPath = scope === 'user' && options?.userId
    ? getUserEnvPath(options.userId)
    : ENV_VARS_PATH;
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, stringify({ vars }), 'utf-8');
}

/** Build a plain { KEY: VALUE } object from enabled vars only */
export function buildEnvObject(vars: EnvVar[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const v of vars) {
    if (v.enabled && v.key) {
      env[v.key] = v.value;
    }
  }
  return env;
}
