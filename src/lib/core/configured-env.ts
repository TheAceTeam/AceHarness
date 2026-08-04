import { delimiter } from 'path';
import { buildEnvObject, loadEnvVars, loadEnvVarsSync } from '@/lib/core/env-manager';
import { isWindows } from '@/lib/core/runtime-platform';

type EnvInput = Record<string, string | null | undefined>;
type ConfiguredEnvOptions = {
  userId?: string;
};

function normalizeEnv(baseEnv: EnvInput): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  return env as NodeJS.ProcessEnv;
}

function applyOverrides(target: NodeJS.ProcessEnv, overrides?: EnvInput): NodeJS.ProcessEnv {
  if (!overrides) {
    return target;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      setEnvValue(target, key, value);
    }
  }
  return target;
}

function setEnvValue(target: NodeJS.ProcessEnv, key: string, value: string): void {
  if (isWindows()) {
    for (const existingKey of Object.keys(target)) {
      if (existingKey !== key && existingKey.toLowerCase() === key.toLowerCase()) {
        delete target[existingKey];
      }
    }
  }
  target[key] = value;
}

function applyConfiguredValues(target: NodeJS.ProcessEnv, configured: EnvInput): void {
  for (const [key, value] of Object.entries(configured)) {
    if (typeof value === 'string' && value.trim().length > 0) {
      setEnvValue(target, key, value);
    }
  }
}

export async function loadConfiguredEnvObject(options?: ConfiguredEnvOptions): Promise<Record<string, string>> {
  try {
    return buildEnvObject(await loadEnvVars(
      options?.userId ? { scope: 'merged', userId: options.userId } : { scope: 'system' },
    ));
  } catch {
    return {};
  }
}

export function loadConfiguredEnvObjectSync(options?: ConfiguredEnvOptions): Record<string, string> {
  try {
    return buildEnvObject(loadEnvVarsSync(
      options?.userId ? { scope: 'merged', userId: options.userId } : { scope: 'system' },
    ));
  } catch {
    return {};
  }
}

export async function buildConfiguredProcessEnv(
  overrides?: EnvInput,
  baseEnv: EnvInput = process.env as EnvInput,
  options?: ConfiguredEnvOptions,
): Promise<NodeJS.ProcessEnv> {
  return mergeConfiguredEnv(baseEnv, await loadConfiguredEnvObject(options), overrides);
}

export function buildConfiguredProcessEnvSync(
  overrides?: EnvInput,
  baseEnv: EnvInput = process.env as EnvInput,
  options?: ConfiguredEnvOptions,
): NodeJS.ProcessEnv {
  return mergeConfiguredEnv(baseEnv, loadConfiguredEnvObjectSync(options), overrides);
}

export function getConfiguredEnvValueSync(key: string, options?: ConfiguredEnvOptions): string | undefined {
  const configured = loadConfiguredEnvObjectSync(options);
  const configuredValue = configured[key];
  if (typeof configuredValue === 'string' && configuredValue.length > 0) {
    return configuredValue;
  }
  const processValue = process.env[key];
  if (typeof processValue === 'string' && processValue.length > 0) {
    return processValue;
  }
  return undefined;
}

export function mergeConfiguredEnv(
  baseEnv: EnvInput,
  configured: EnvInput,
  overrides?: EnvInput,
): NodeJS.ProcessEnv {
  const env = normalizeEnv(baseEnv);
  applyConfiguredValues(env, configured);
  return applyOverrides(env, overrides);
}

export function getConfiguredCliSearchPaths(extraPaths: string[] = [], options?: ConfiguredEnvOptions): string[] {
  const env = buildConfiguredProcessEnvSync(undefined, process.env, options);
  const pathValue = env.PATH || env.Path || '';
  const seen = new Set<string>();
  const paths = [...extraPaths, ...pathValue.split(delimiter).filter(Boolean)];
  return paths.filter((entry) => {
    if (!entry || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}
