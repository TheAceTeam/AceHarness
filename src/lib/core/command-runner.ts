import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { basename, join } from 'path';
import { buildConfiguredProcessEnvSync, getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { isWindows } from '@/lib/core/runtime-platform';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_OUTPUT_LIMIT = 256 * 1024;

export type CommandRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type ResolvedConfiguredCommand = {
  command: string | null;
  env: NodeJS.ProcessEnv;
};

export function resolveConfiguredCommand(commandName: string, options?: { userId?: string }): ResolvedConfiguredCommand {
  const env = buildConfiguredProcessEnvSync(undefined, process.env, { userId: options?.userId });
  const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths(), { userId: options?.userId });
  return {
    command: findCommand(commandName, searchPaths),
    env,
  };
}

function escapeWinCmdToken(value: string): string {
  if (value === '') return '""';
  if (/[\s"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function resolveWindowsCmdShell(): string {
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  const candidates = [
    process.env.ComSpec?.trim(),
    ...roots.flatMap((root) => [join(root, 'System32', 'cmd.exe'), join(root, 'Sysnative', 'cmd.exe'), join(root, 'cmd.exe')]),
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
}

function appendOutput(current: string, chunk: Buffer, outputLimit: number): string {
  const next = current + chunk.toString('utf8');
  if (next.length <= outputLimit) return next;
  return next.slice(next.length - outputLimit);
}

function closeProcessTree(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (isWindows() && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 3000);
}

function spawnCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  if (!isWindows()) {
    return spawn(command, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  const line = [command, ...args].map(escapeWinCmdToken).join(' ');
  return spawn(line, {
    shell: resolveWindowsCmdShell(),
    windowsHide: true,
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function runCommand(options: {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  timeoutLabel?: string;
  outputLimit?: number;
}): Promise<CommandRunResult> {
  const args = options.args || [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  const timeoutLabel = options.timeoutLabel || [basename(options.command), ...args].join(' ');

  return new Promise((resolve, reject) => {
    const child = spawnCommand(options.command, args, options.cwd, options.env || process.env);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeProcessTree(child);
      reject(new Error(`${timeoutLabel} 执行超时`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk, outputLimit);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk, outputLimit);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin?.end();
  });
}
