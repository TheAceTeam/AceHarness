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

function closeProcessTree(child: ChildProcess, processGroup: boolean): void {
  if (child.killed || child.exitCode !== null) return;
  if (isWindows() && child.pid) {
    const kill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    kill.on('error', () => child.kill('SIGTERM'));
    return;
  }
  if (processGroup && child.pid) {
    const group = -child.pid;
    try { process.kill(group, 'SIGTERM'); } catch { return; }
    setTimeout(() => {
      try { process.kill(group, 'SIGKILL'); } catch { /* process group ended */ }
    }, 3000).unref();
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

function spawnCommand(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, processGroup: boolean): ChildProcess {
  return launchCommand(commandAttempt(command, args), {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    detached: processGroup && !isWindows(),
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
  signal?: AbortSignal;
  processGroup?: boolean;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}): Promise<CommandRunResult> {
  const args = options.args || [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outputLimit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;
  const timeoutLabel = options.timeoutLabel || [basename(options.command), ...args].join(' ');

  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error('命令已取消'));
      return;
    }
    const processGroup = options.processGroup ?? false;
    const child = spawnCommand(options.command, args, options.cwd, options.env || process.env, processGroup);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      cancel(new Error(`${timeoutLabel} 执行超时`));
    }, timeoutMs);
    function onAbort() {
      cancel(new Error('命令已取消'));
    }
    function finish() {
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
    function cancel(error: Error) {
      if (settled) return;
      finish();
      closeProcessTree(child, processGroup);
      reject(error);
    }
    options.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stdout = appendOutput(stdout, chunk, outputLimit);
      options.onOutput?.('stdout', chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (settled) return;
      stderr = appendOutput(stderr, chunk, outputLimit);
      options.onOutput?.('stderr', chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      if (settled) return;
      finish();
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      finish();
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}
