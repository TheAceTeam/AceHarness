import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { isWindows } from '@/lib/core/runtime-platform';

export type CommandSource = 'explicit' | 'configured-path' | 'PATH' | 'fallback' | 'unresolved';
export type CommandFileKind = 'native' | 'cmd' | 'bat' | 'ps1' | 'unknown';

export type CommandCandidate = {
  executable: string;
  source: Exclude<CommandSource, 'unresolved'>;
  candidateName: string;
};

export type CommandAttempt = {
  executable: string;
  args: readonly string[];
  source: CommandSource;
  fileKind: CommandFileKind;
  candidateName: string;
  resolved: boolean;
};

export type CommandResolution = {
  agentId?: string;
  attempts: readonly CommandAttempt[];
  selected?: CommandAttempt;
  diagnostics: {
    explicitOverrideKey?: string;
    rejectedOverride?: 'empty' | 'contains-crlf' | 'contains-arguments' | 'ps1-without-interpreter';
    searchedConfiguredPaths: number;
    searchedProcessPath: boolean;
  };
};

export type CommandSpec = {
  id: string;
  candidates: readonly string[];
  fixedArgs: readonly string[];
  overrideEnvKey?: string;
};

export type LaunchOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  windowsHide?: boolean;
  timeoutMs?: number;
};

export type CommandProbeResult = {
  ok: boolean;
  missing: boolean;
  exitCode: number | null;
  output: string;
};

type ResolveCommandOptions = {
  env?: NodeJS.ProcessEnv;
  configuredSearchPaths?: readonly string[];
};

const BARE_COMMAND_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function environmentValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (!isWindows()) return env[key];
  const normalized = key.toLowerCase();
  const entry = Object.entries(env).find(([name]) => name.toLowerCase() === normalized);
  return entry?.[1];
}

export function normalizeChildProcessEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (!isWindows()) return env;
  const pathValue = environmentValue(env, 'PATH') || '';
  if (!pathValue) return env;
  return { ...env, PATH: pathValue, Path: pathValue };
}

function commandPathEntries(env: NodeJS.ProcessEnv): string[] {
  const pathValue = environmentValue(env, 'PATH') || '';
  return pathValue.split(isWindows() ? ';' : delimiter).map((value) => value.trim()).filter(Boolean);
}

function commandCandidates(command: string, env: NodeJS.ProcessEnv): string[] {
  if (!isWindows() || /\.[^./\\]+$/.test(command)) return [command];
  const extensions = (environmentValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return [...extensions, ''].flatMap((extension) => {
    const candidate = `${command}${extension}`;
    const identity = candidate.toLowerCase();
    if (seen.has(identity)) return [];
    seen.add(identity);
    return [candidate];
  });
}

function classifyCommandFile(command: string): CommandFileKind {
  const extension = command.slice(command.lastIndexOf('.')).toLowerCase();
  if (extension === '.cmd') return 'cmd';
  if (extension === '.bat') return 'bat';
  if (extension === '.ps1') return 'ps1';
  if (extension === '.exe' || extension === '.com') return 'native';
  return 'unknown';
}

function hasPathSyntax(value: string): boolean {
  return isAbsolute(value) || value.includes('/') || value.includes('\\');
}

function normalizeOverride(value: string | undefined): { value?: string; rejected?: CommandResolution['diagnostics']['rejectedOverride'] } {
  if (value === undefined) return {};
  let normalized = value.trim();
  if (!normalized) return { rejected: 'empty' };
  if (/[\r\n]/.test(normalized)) return { rejected: 'contains-crlf' };
  if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1);
  }
  if (!normalized) return { rejected: 'empty' };
  // A path is passed as one spawn argv element, not through a shell. It may
  // therefore contain legal Windows characters such as '&', '%', '!' and '()'.
  if (hasPathSyntax(normalized)) return { value: normalized };
  if (!BARE_COMMAND_RE.test(normalized)) return { rejected: 'contains-arguments' };
  return { value: normalized };
}

function findResolvedPath(command: string, searchPaths: readonly string[], env: NodeJS.ProcessEnv): { executable: string; source: CommandSource } | undefined {
  const candidates = commandCandidates(command, env);
  if (hasPathSyntax(command)) {
    const executable = candidates.find((candidate) => existsSync(candidate));
    return executable ? { executable, source: 'configured-path' } : undefined;
  }

  for (const directory of searchPaths) {
    for (const candidate of candidates) {
      const executable = join(directory, candidate);
      if (existsSync(executable)) return { executable, source: 'configured-path' };
    }
  }

  for (const directory of commandPathEntries(env)) {
    for (const candidate of candidates) {
      const executable = join(directory, candidate);
      if (existsSync(executable)) return { executable, source: 'PATH' };
    }
  }
  return undefined;
}

function makeAttempt(executable: string, args: readonly string[], source: CommandSource, candidateName: string, resolved: boolean): CommandAttempt {
  return {
    executable,
    args: [...args],
    source,
    fileKind: classifyCommandFile(executable),
    candidateName,
    resolved,
  };
}

export function resolveCommand(spec: CommandSpec, options: ResolveCommandOptions = {}): CommandResolution {
  const env = normalizeChildProcessEnv(options.env || process.env);
  const configuredSearchPaths = options.configuredSearchPaths || [];
  const diagnostics: CommandResolution['diagnostics'] = {
    explicitOverrideKey: spec.overrideEnvKey,
    searchedConfiguredPaths: configuredSearchPaths.length,
    searchedProcessPath: true,
  };
  const explicit = spec.overrideEnvKey ? normalizeOverride(environmentValue(env, spec.overrideEnvKey)) : {};
  if (explicit.rejected) {
    diagnostics.rejectedOverride = explicit.rejected;
    return { agentId: spec.id, attempts: [], diagnostics };
  }

  if (explicit.value) {
    const resolved = findResolvedPath(explicit.value, configuredSearchPaths, env);
    const attempt = makeAttempt(resolved?.executable || explicit.value, spec.fixedArgs, 'explicit', explicit.value, Boolean(resolved));
    if (attempt.fileKind === 'ps1') {
      diagnostics.rejectedOverride = 'ps1-without-interpreter';
      return { agentId: spec.id, attempts: [{ ...attempt, resolved: false }], diagnostics };
    }
    return { agentId: spec.id, attempts: [attempt], selected: attempt.resolved ? attempt : undefined, diagnostics };
  }

  const attempts: CommandAttempt[] = [];
  for (const [index, candidateName] of spec.candidates.entries()) {
    const resolved = findResolvedPath(candidateName, configuredSearchPaths, env);
    const source = resolved?.source || (index > 0 ? 'fallback' : 'unresolved');
    const attempt = makeAttempt(resolved?.executable || candidateName, spec.fixedArgs, source, candidateName, Boolean(resolved));
    attempts.push(attempt);
    if (attempt.fileKind === 'ps1') continue;
    if (attempt.resolved) {
      return { agentId: spec.id, attempts, selected: attempt, diagnostics };
    }
  }
  return { agentId: spec.id, attempts, diagnostics };
}

function resolveWindowsCmd(env: NodeJS.ProcessEnv): string {
  return environmentValue(env, 'COMSPEC') || 'cmd.exe';
}

const CMD_META_CHAR_RE = /([()\][%!^"`<>&|;, *?])/g;
const CMD_BACKSLASH_QUOTE_RE = /(?=(\\+?)?)\1"/g;
const CMD_TRAILING_BACKSLASH_RE = /(?=(\\+?)?)\1$/g;

function escapeCmdCommand(value: string): string {
  return value.replace(CMD_META_CHAR_RE, '^$1');
}

function escapeCmdArgument(value: string): string {
  return `"${value.replace(CMD_BACKSLASH_QUOTE_RE, '$1$1\\"').replace(CMD_TRAILING_BACKSLASH_RE, '$1$1')}"`
    .replace(CMD_META_CHAR_RE, '^$1');
}

function launchWindowsBatch(attempt: CommandAttempt, options: LaunchOptions, env: NodeJS.ProcessEnv): ChildProcess {
  const commandLine = [escapeCmdCommand(attempt.executable), ...attempt.args.map(escapeCmdArgument)].join(' ');
  return spawn(resolveWindowsCmd(env), ['/d', '/s', '/c', `"${commandLine}"`], {
    cwd: options.cwd,
    env,
    stdio: options.stdio,
    windowsHide: options.windowsHide ?? true,
    windowsVerbatimArguments: true,
  });
}

export function launchCommand(attempt: CommandAttempt, options: LaunchOptions = {}): ChildProcess {
  if (attempt.fileKind === 'ps1') {
    throw new Error('PowerShell command files require an explicit interpreter argv.');
  }
  const env = normalizeChildProcessEnv(options.env || process.env);
  if (isWindows() && (attempt.fileKind === 'cmd' || attempt.fileKind === 'bat')) {
    return launchWindowsBatch(attempt, options, env);
  }
  return spawn(attempt.executable, [...attempt.args], {
    cwd: options.cwd,
    env,
    stdio: options.stdio,
    windowsHide: options.windowsHide ?? true,
    shell: false,
  });
}

export function probeCommand(attempt: CommandAttempt, options: LaunchOptions = {}): Promise<CommandProbeResult> {
  return new Promise((resolve) => {
    const child = launchCommand({ ...attempt, args: [...attempt.args, '--version'] }, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (result: CommandProbeResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    const timeout = options.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => {
        child.kill();
        finish({ ok: false, missing: false, exitCode: null, output: 'availability probe timed out' });
      }, options.timeoutMs)
      : undefined;
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ ok: false, missing: error.code === 'ENOENT', exitCode: null, output: error.message });
    });
    child.on('close', (exitCode) => {
      finish({
        ok: exitCode === 0,
        missing: exitCode === 127,
        exitCode,
        output: Buffer.concat(chunks).toString('utf8').trim(),
      });
    });
  });
}

export function toAcpxRegistryOverride(resolution: CommandResolution): string[] {
  const attempt = resolution.selected;
  return attempt ? [attempt.executable, ...attempt.args] : [];
}
