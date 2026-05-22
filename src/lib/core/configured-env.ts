import { delimiter } from 'path';
import { buildEnvObject, loadEnvVars, loadEnvVarsSync } from '@/lib/core/env-manager';

type EnvInput = Record<string, string | undefined>;

function normalizeEnv(baseEnv: EnvInput): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value !== undefined) {
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
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}

export async function loadConfiguredEnvObject(): Promise<Record<string, string>> {
  try {
    return buildEnvObject(await loadEnvVars({ scope: 'system' }));
  } catch {
    return {};
  }
}

export function loadConfiguredEnvObjectSync(): Record<string, string> {
  try {
    return buildEnvObject(loadEnvVarsSync({ scope: 'system' }));
  } catch {
    return {};
  }
}

export async function buildConfiguredProcessEnv(
  overrides?: EnvInput,
  baseEnv: EnvInput = process.env as EnvInput,
): Promise<NodeJS.ProcessEnv> {
  const env = normalizeEnv(baseEnv);
  Object.assign(env, await loadConfiguredEnvObject());
  return applyOverrides(env, overrides);
}

export function buildConfiguredProcessEnvSync(
  overrides?: EnvInput,
  baseEnv: EnvInput = process.env as EnvInput,
): NodeJS.ProcessEnv {
  const env = normalizeEnv(baseEnv);
  Object.assign(env, loadConfiguredEnvObjectSync());
  return applyOverrides(env, overrides);
}

export function getConfiguredEnvValueSync(key: string): string | undefined {
  const configured = loadConfiguredEnvObjectSync();
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

export function getConfiguredCliSearchPaths(extraPaths: string[] = []): string[] {
  const env = buildConfiguredProcessEnvSync();
  const pathValue = env.PATH || env.Path || '';
  const seen = new Set<string>();
  const paths = [...extraPaths, ...pathValue.split(delimiter).filter(Boolean)];
  return paths.filter((entry) => {
    if (!entry || seen.has(entry)) return false;
    seen.add(entry);
    return true;
  });
}
