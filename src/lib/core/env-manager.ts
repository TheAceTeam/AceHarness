/**
 * 环境变量管理 - 存储到 data/env-vars.yaml
 * 支持单独启用/禁用，在 claude 进程启动前注入
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { isWindows } from '@/lib/core/runtime-platform';

const ENV_VARS_PATH = getWorkspaceDataFile('env-vars.yaml');
const USER_ENV_DIR = getWorkspaceDataFile('env-vars.users');

export interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

function normalizeKey(key: unknown): string {
  return typeof key === 'string' ? key.trim() : '';
}

function keyIdentity(key: string): string {
  return isWindows() ? key.toUpperCase() : key;
}

function hasUsableValue(variable: EnvVar | undefined): variable is EnvVar {
  return Boolean(
    variable
    && variable.enabled
    && normalizeKey(variable.key)
    && typeof variable.value === 'string'
    && variable.value.trim(),
  );
}

/** Merge system and personal settings without letting an empty personal row shadow a value. */
export function mergeEnvVars(systemVars: EnvVar[], userVars: EnvVar[]): EnvVar[] {
  const merged = new Map<string, EnvVar>();

  for (const item of systemVars) {
    const key = normalizeKey(item?.key);
    if (!key) continue;
    merged.set(keyIdentity(key), { ...item, key });
  }

  for (const item of userVars) {
    const key = normalizeKey(item?.key);
    if (!key) continue;
    const identity = keyIdentity(key);
    if (!merged.has(identity) || hasUsableValue(item)) {
      merged.set(identity, { ...item, key });
    }
  }

  return Array.from(merged.values());
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

function readVarsFromFileSync(filePath: string): EnvVar[] {
  try {
    const content = readFileSync(filePath, 'utf-8');
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
  return mergeEnvVars(systemVars, userVars);
}

export function loadEnvVarsSync(options?: { scope?: 'system' | 'user' | 'merged'; userId?: string }): EnvVar[] {
  const scope = options?.scope || 'system';
  if (scope === 'system') return readVarsFromFileSync(ENV_VARS_PATH);
  if (scope === 'user') {
    if (!options?.userId) return [];
    return readVarsFromFileSync(getUserEnvPath(options.userId));
  }

  const systemVars = readVarsFromFileSync(ENV_VARS_PATH);
  const userVars = options?.userId ? readVarsFromFileSync(getUserEnvPath(options.userId)) : [];
  return mergeEnvVars(systemVars, userVars);
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
    const key = normalizeKey(v?.key);
    if (hasUsableValue(v)) {
      env[key] = v.value;
    }
  }
  return env;
}
