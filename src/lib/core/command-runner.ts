import { spawn, type ChildProcess } from 'child_process';
import { basename } from 'path';
import { buildConfiguredProcessEnvSync, getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { launchCommand, resolveCommand, type CommandAttempt, type CommandResolution } from '@/lib/core/resolved-command';
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
  resolution: CommandResolution;
};

export function resolveConfiguredCommand(commandName: string, options?: { userId?: string }): ResolvedConfiguredCommand {
  const env = buildConfiguredProcessEnvSync(undefined, process.env, { userId: options?.userId });
  const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths(), { userId: options?.userId });
  const resolution = resolveCommand({ id: commandName, candidates: [commandName], fixedArgs: [] }, {
    env,
    configuredSearchPaths: searchPaths,
  });
  return {
    command: resolution.selected?.executable || null,
    env,
    resolution,
  };
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

function commandAttempt(command: string, args: string[]): CommandAttempt {
  const extension = command.slice(command.lastIndexOf('.')).toLowerCase();
  return {
    executable: command,
    args,
    source: 'configured-path',
    fileKind: extension === '.cmd' ? 'cmd' : extension === '.bat' ? 'bat' : extension === '.ps1' ? 'ps1' : 'native',
    candidateName: command,
    resolved: true,
  };
}

function spawnCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  return launchCommand(commandAttempt(command, args), {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
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
