import { spawn } from 'child_process';

export const CSI_PACKAGE_NAME = 'csiharness';
export const DEFAULT_UPDATE_TARGET = 'latest';

export interface NpmUpdateOptions {
  packageName?: string;
  target?: string;
  npmCommand?: string;
  cwd?: string;
}

export interface NpmCommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

const SAFE_NPM_TARGET_PATTERN = /^[A-Za-z0-9._~+-]+$/;

export function normalizeUpdateTarget(target?: string): string {
  const trimmed = String(target || '').trim();
  if (!trimmed) return DEFAULT_UPDATE_TARGET;
  if (/^@[^/]+$/.test(trimmed)) return trimmed.slice(1);
  return trimmed;
}

export function buildNpmPackageSpec(
  packageName = CSI_PACKAGE_NAME,
  target?: string,
): string {
  const normalizedTarget = normalizeUpdateTarget(target);
  if (normalizedTarget === packageName) {
    return normalizedTarget;
  }
  if (normalizedTarget.startsWith(`${packageName}@`)) {
    const packageTarget = normalizedTarget.slice(packageName.length + 1);
    if (!packageTarget || !SAFE_NPM_TARGET_PATTERN.test(packageTarget)) {
      throw new Error('Update target must be an npm version or dist-tag.');
    }
    return normalizedTarget;
  }
  if (normalizedTarget.includes('/') || !SAFE_NPM_TARGET_PATTERN.test(normalizedTarget)) {
    throw new Error('Update target must be an npm version or dist-tag.');
  }
  return `${packageName}@${normalizedTarget}`;
}

export function parseNpmVersionOutput(output: string): string {
  const trimmed = output.trim();
  if (!trimmed) return '';

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'string') return parsed.trim();
    if (Array.isArray(parsed)) {
      const hit = parsed.find((item) => typeof item === 'string' && item.trim());
      return typeof hit === 'string' ? hit.trim() : '';
    }
  } catch {
    // npm can print a plain string when --json is ignored by older versions.
  }

  const lastLine = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || '';
  return lastLine.replace(/^"|"$/g, '').trim();
}

export function resolveNpmCommand(customCommand?: string): string {
  const command = customCommand?.trim();
  if (command) return command;
  return 'npm';
}

function quoteWindowsCmdArg(arg: string): string {
  if (!arg) return '""';
  if (/^[A-Za-z0-9@%_+=:,./\\~-]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function spawnNpm(
  npmCommand: string,
  args: string[],
  options: { cwd?: string; stdio: ['ignore', 'pipe', 'pipe'] | 'inherit' },
) {
  if (process.platform !== 'win32') {
    return spawn(npmCommand, args, {
      cwd: options.cwd,
      stdio: options.stdio,
      windowsHide: true,
    });
  }

  const shell = process.env.ComSpec || 'cmd.exe';
  const commandLine = [npmCommand, ...args].map(quoteWindowsCmdArg).join(' ');
  return spawn(shell, ['/d', '/s', '/c', commandLine], {
    cwd: options.cwd,
    stdio: options.stdio,
    windowsHide: true,
  });
}

export async function runNpmCapture(
  npmCommand: string,
  args: string[],
  cwd?: string,
): Promise<NpmCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawnNpm(npmCommand, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ stdout, stderr, code, signal });
    });
  });
}

export async function fetchNpmPackageVersion(options: NpmUpdateOptions = {}): Promise<string> {
  const npmCommand = resolveNpmCommand(options.npmCommand);
  const packageSpec = buildNpmPackageSpec(options.packageName, options.target);
  const result = await runNpmCapture(npmCommand, ['view', packageSpec, 'version', '--json'], options.cwd);
  const version = parseNpmVersionOutput(result.stdout);
  if (result.code !== 0 || !version) {
    const detail = (result.stderr || result.stdout || `npm exited with code ${result.code ?? 'unknown'}`).trim();
    throw new Error(detail);
  }
  return version;
}

export async function installNpmPackageGlobally(options: NpmUpdateOptions = {}): Promise<void> {
  const npmCommand = resolveNpmCommand(options.npmCommand);
  const packageSpec = buildNpmPackageSpec(options.packageName, options.target);

  await new Promise<void>((resolve, reject) => {
    const child = spawnNpm(npmCommand, ['install', '-g', packageSpec], {
      cwd: options.cwd,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(signal ? `npm install stopped by ${signal}` : `npm install exited with code ${code ?? 'unknown'}`));
    });
  });
}
