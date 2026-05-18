/**
 * Cangjie 环境检测与 shell sourcing 工具
 * 供 MCP Server 集成和 CangjieMagic Engine 共用
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadEnvVars, buildEnvObject } from '@/lib/core/env-manager';
import { isLinux, isMacOS, isWindows } from '@/lib/core/runtime-platform';
import { getEffectiveManagedCangjieHome } from '@/lib/cangjie/sdk-manager';

/**
 * Detect CANGJIE_HOME from user-configured env vars (env-vars.yaml) or process.env.
 * Returns the path or null if not found.
 */
export async function detectCangjieHome(options?: { userId?: string }): Promise<string | null> {
  // 0. Check managed SDK first
  try {
    const managed = await getEffectiveManagedCangjieHome();
    if (managed.cangjieHome && existsSync(managed.cangjieHome)) {
      return managed.cangjieHome;
    }
  } catch { /* ignore */ }

  // 1. Check user-configured env vars first (fallback)
  try {
    const vars = await loadEnvVars(options?.userId ? { scope: 'merged', userId: options.userId } : { scope: 'merged' });
    const envObj = buildEnvObject(vars);
    if (envObj.CANGJIE_HOME && existsSync(envObj.CANGJIE_HOME)) {
      return envObj.CANGJIE_HOME;
    }
  } catch { /* ignore */ }

  // 2. Fall back to process.env
  const fromEnv = process.env.CANGJIE_HOME;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  return null;
}

/**
 * Resolve a path from env-vars.yaml > process.env > fallback paths.
 */
async function resolveEnvPath(
  envKey: string,
  fallbackPaths: string[] = [],
  userId?: string,
): Promise<string | null> {
  // 1. User-configured env vars
  try {
    const vars = await loadEnvVars(userId ? { scope: 'merged', userId } : { scope: 'merged' });
    const envObj = buildEnvObject(vars);
    if (envObj[envKey] && existsSync(envObj[envKey])) {
      return envObj[envKey];
    }
  } catch { /* ignore */ }

  // 2. process.env
  const fromEnv = process.env[envKey];
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  // 3. Fallback paths
  for (const p of fallbackPaths) {
    if (existsSync(p)) return p;
  }

  return null;
}

function mergeExtraWindowsPaths(env: Record<string, string>, extraPaths: Array<string | null | undefined>) {
  const additions = extraPaths.filter((value): value is string => Boolean(value));
  if (additions.length === 0) return;
  env.PATH = [...additions, env.PATH || env.Path || ''].filter(Boolean).join(';');
  env.Path = env.PATH;
}

function buildWindowsFallbackEnv(
  cangjieHome: string,
  env: Record<string, string>,
) {
  const runtimeNativeDir = resolve(cangjieHome, 'runtime', 'lib', 'windows_x86_64_cjnative');
  const libNativeDir = resolve(cangjieHome, 'lib', 'windows_x86_64_cjnative');
  const binDir = resolve(cangjieHome, 'bin');
  const toolsBinDir = resolve(cangjieHome, 'tools', 'bin');
  const toolsLibDir = resolve(cangjieHome, 'tools', 'lib');
  const cjpmUserBinDir = env.USERPROFILE ? resolve(env.USERPROFILE, '.cjpm', 'bin') : null;
  mergeExtraWindowsPaths(env, [runtimeNativeDir, libNativeDir, binDir, toolsBinDir, cjpmUserBinDir, toolsLibDir]);
}

function captureWindowsEnvFromScript(
  command: string,
  baseEnv: Record<string, string>,
): Record<string, string> | null {
  try {
    const output = execSync(command, {
      shell: 'powershell',
      env: baseEnv as NodeJS.ProcessEnv,
      encoding: 'utf-8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    const nextEnv: Record<string, string> = { ...baseEnv };
    for (const line of output.split(/\r?\n/)) {
      const idx = line.indexOf('=');
      if (idx <= 0) continue;
      nextEnv[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return nextEnv;
  } catch {
    return null;
  }
}

/**
 * Source envsetup.sh and capture the resulting environment variables.
 * On macOS/Linux: `source envsetup.sh && env -0`
 * On Windows: prefer official envsetup.ps1, fallback to envsetup.bat, then minimal PATH reconstruction
 */
export async function buildCangjieSpawnEnv(
  cangjieHome: string,
  baseEnv: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
  options?: { userId?: string },
): Promise<Record<string, string>> {
  const windows = isWindows();
  const env: Record<string, string> = {};

  // Copy base env (filter out undefined)
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) env[k] = v;
  }

  env.CANGJIE_HOME = cangjieHome;

  if (windows) {
    const setupPs1 = resolve(cangjieHome, 'envsetup.ps1');
    const setupBat = resolve(cangjieHome, 'envsetup.bat');
    const captured =
      (existsSync(setupPs1)
        ? captureWindowsEnvFromScript(`. "${setupPs1}"; Get-ChildItem Env: | ForEach-Object { "$($_.Name)=$($_.Value)" }`, env)
        : null)
      ?? (existsSync(setupBat)
        ? captureWindowsEnvFromScript(`cmd /d /c "call ""${setupBat}"" && set"`, env)
        : null);
    if (captured) {
      Object.assign(env, captured);
    } else {
      buildWindowsFallbackEnv(cangjieHome, env);
    }

    // Add OpenSSL and stdx to PATH on Windows
    const opensslPath = await resolveEnvPath('OPENSSL_PATH', [], options?.userId);
    const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
    mergeExtraWindowsPaths(env, [opensslPath, stdxPath]);
  } else {
    // macOS/Linux: source envsetup.sh and capture full env
    const setupScript = resolve(cangjieHome, 'envsetup.sh');
    if (!existsSync(setupScript)) {
      console.warn(`[cangjie-env] envsetup.sh not found at ${setupScript}`);
      return env;
    }

    // On macOS, prepend OpenSSL and stdx lib paths before sourcing — cjpm needs them
    if (isMacOS()) {
      const extraPaths: string[] = [];

      const opensslPath = await resolveEnvPath('OPENSSL_PATH', [
        '/usr/local/opt/openssl/lib',
        '/opt/homebrew/opt/openssl/lib',
      ], options?.userId);
      if (opensslPath) extraPaths.push(opensslPath);

      const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
      if (stdxPath) extraPaths.push(stdxPath);

      if (extraPaths.length > 0) {
        env.DYLD_LIBRARY_PATH = [...extraPaths, env.DYLD_LIBRARY_PATH || ''].filter(Boolean).join(':');
      }
    } else if (isLinux()) {
      const extraPaths: string[] = [];

      const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
      if (stdxPath) extraPaths.push(stdxPath);

      if (extraPaths.length > 0) {
        env.LD_LIBRARY_PATH = [...extraPaths, env.LD_LIBRARY_PATH || ''].filter(Boolean).join(':');
      }
    }

    try {
      // Use NUL-delimited env output to handle values with newlines
      const cmd = `source "${setupScript}" && env -0`;
      const output = execSync(cmd, {
        shell: '/bin/bash',
        env: env as NodeJS.ProcessEnv,
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });

      // Parse NUL-delimited env output
      const entries = output.split('\0');
      for (const entry of entries) {
        if (!entry) continue;
        const idx = entry.indexOf('=');
        if (idx > 0) {
          env[entry.slice(0, idx)] = entry.slice(idx + 1);
        }
      }
    } catch (err) {
      console.warn(`[cangjie-env] Failed to source envsetup.sh:`, err);
    }
  }

  return env;
}

/**
 * Check if cjpm is available in the given environment.
 */
export function isCjpmAvailable(env?: Record<string, string>): boolean {
  try {
    const windows = isWindows();
    const cmd = windows ? 'where cjpm' : 'command -v cjpm';
    execSync(cmd, {
      stdio: 'ignore',
      shell: windows ? undefined : '/bin/bash',
      env: env ? { ...env } as NodeJS.ProcessEnv : undefined,
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the shell command string to run a cjpm command with envsetup.sh sourced.
 * Returns { command, args } suitable for spawn or MCP config.
 *
 * On macOS, cjpm requires DYLD_LIBRARY_PATH to include OpenSSL and stdx libs.
 * These are read from env-vars (OPENSSL_PATH, CANGJIE_STDX_PATH) with system fallbacks.
 */
export async function buildCjpmShellCommand(
  cangjieHome: string,
  cjpmCommand: string,
  projectDir?: string,
  options?: { userId?: string },
): Promise<{ command: string; args: string[] }> {
  const windows = isWindows();
  const setupScript = resolve(cangjieHome, 'envsetup.sh');

  if (windows) {
    const setupPs1 = resolve(cangjieHome, 'envsetup.ps1');
    const setupBat = resolve(cangjieHome, 'envsetup.bat');
    const parts: string[] = [
      `$env:CANGJIE_HOME="${cangjieHome}"`,
    ];
    if (existsSync(setupPs1)) {
      parts.push(`. "${setupPs1}"`);
    } else if (existsSync(setupBat)) {
      parts.push(`cmd /d /c "call ""${setupBat}"" && ${cjpmCommand.replace(/"/g, '""')}"`);
      return {
        command: 'powershell',
        args: ['-NoProfile', '-Command', parts.join('; ')],
      };
    } else {
      const fallbackEnv = await buildCangjieSpawnEnv(cangjieHome, process.env as Record<string, string | undefined>, options);
      const pathValue = (fallbackEnv.PATH || fallbackEnv.Path || '').replace(/"/g, '""');
      parts.push(`$env:PATH="${pathValue}"`);
    }
    // Add OpenSSL and stdx to PATH on Windows
    const opensslPath = await resolveEnvPath('OPENSSL_PATH', [], options?.userId);
    const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
    const extraPaths = [opensslPath, stdxPath].filter(Boolean);
    if (extraPaths.length > 0) {
      parts.push(`$env:PATH="${extraPaths.join(';')};$env:PATH"`);
    }
    if (projectDir) {
      parts.push(`cd "${projectDir}"`);
    }
    parts.push(cjpmCommand);
    return {
      command: 'powershell',
      args: ['-NoProfile', '-Command', parts.join('; ')],
    };
  }

  // macOS/Linux: source envsetup.sh, set up library paths, then run command
  const parts: string[] = [`source "${setupScript}"`];

  if (isMacOS()) {
    const extraPaths: string[] = [];

    const opensslPath = await resolveEnvPath('OPENSSL_PATH', [
      '/usr/local/opt/openssl/lib',
      '/opt/homebrew/opt/openssl/lib',
    ], options?.userId);
    if (opensslPath) extraPaths.push(opensslPath);

    const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
    if (stdxPath) extraPaths.push(stdxPath);

    if (extraPaths.length > 0) {
      parts.push(`export DYLD_LIBRARY_PATH="${extraPaths.join(':')}:$DYLD_LIBRARY_PATH"`);
    }
  } else {
    // Linux: stdx in LD_LIBRARY_PATH
    const stdxPath = await resolveEnvPath('CANGJIE_STDX_PATH', [], options?.userId);
    if (stdxPath) {
      parts.push(`export LD_LIBRARY_PATH="${stdxPath}:$LD_LIBRARY_PATH"`);
    }
  }

  if (projectDir) {
    parts.push(`cd "${projectDir}"`);
  }
  parts.push(cjpmCommand);

  return {
    command: '/bin/bash',
    args: ['-c', parts.join(' && ')],
  };
}
