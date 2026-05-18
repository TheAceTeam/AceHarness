import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

/**
 * Windows often stores user PATH as "Path" (mixed case). Node usually aliases it, but some
 * launchers / parent processes only set one of PATH vs Path for child Node—then PATH scanning
 * and cmd-launched where.exe can disagree with an interactive CMD session.
 */
function getProcessPathEnv(): string {
  if (process.platform !== 'win32') {
    return process.env.PATH || '';
  }
  const path = process.env.PATH || process.env.Path;
  return path || '';
}

function windowsEnvForChildProcess(): NodeJS.ProcessEnv {
  if (process.platform !== 'win32') return process.env;
  const mergedPath = getProcessPathEnv();
  if (!mergedPath) return process.env;
  return {
    ...process.env,
    PATH: mergedPath,
    Path: mergedPath,
  };
}

function defaultWindowsScanDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  const systemDirs = roots.flatMap((root) => [
    join(root, 'System32'),
    join(root, 'Sysnative'),
    root,
  ]);
  return [
    ...systemDirs,
    home ? join(home, 'AppData', 'Roaming', 'npm') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Programs') : '',
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links') : '',
    home ? join(home, 'go', 'bin') : '',
    home ? join(home, '.cargo', 'bin') : '',
    home ? join(home, 'scoop', 'shims') : '',
    home ? join(home, '.local', 'bin') : '',
    'C:\\Program Files\\nodejs',
  ].filter(Boolean);
}

function getLocalNodeBinDirs(): string[] {
  const bases = [process.cwd(), process.env.INIT_CWD || ''].filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const base of bases) {
    const dir = join(base, 'node_modules', '.bin');
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

function resolveWindowsCmdShell(): string {
  const candidates = [
    process.env.ComSpec?.trim(),
    ...defaultWindowsScanDirs().map((dir) => join(dir, 'cmd.exe')),
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
}

function resolveWindowsPowerShell(): string {
  const candidates = [
    process.env.PSHOME?.trim() ? join(process.env.PSHOME.trim(), 'powershell.exe') : '',
    'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    'pwsh.exe',
    'powershell.exe',
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => candidate.toLowerCase().endsWith('.exe') && existsSync(candidate)) || candidates[0];
}

function getExecutableCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command];

  const hasExtension = /\.[^./\\]+$/.test(command);
  if (hasExtension) return [command];

  const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);

  return [...pathext.map((ext) => `${command}${ext}`), command];
}

function pickPreferredWindowsCommand(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const rank = (filePath: string): number => {
    const p = filePath.toLowerCase();
    if (p.endsWith('.cmd')) return 0;
    if (p.endsWith('.exe')) return 1;
    if (p.endsWith('.bat')) return 2;
    if (p.endsWith('.com')) return 3;
    return 9;
  };
  const sorted = [...candidates].sort((a, b) => rank(a) - rank(b));
  return sorted[0] || null;
}

export function getCommonCliSearchPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';

  if (process.platform === 'win32') {
    return [...getLocalNodeBinDirs(), ...defaultWindowsScanDirs()];
  }

  return [
    ...getLocalNodeBinDirs(),
    home ? join(home, '.local', 'bin') : '',
    home ? join(home, 'go', 'bin') : '',
    home ? join(home, '.cargo', 'bin') : '',
    ...DEFAULT_SCAN_DIRS_POSIX,
  ].filter(Boolean);
}

function findCommandViaLoginShell(command: string): string | null {
  if (process.platform === 'win32') return null;
  if (!/^[\w.-]+$/.test(command)) return null;

  const shell = process.env.SHELL?.trim() || '/bin/sh';
  try {
    const output = execFileSync(shell, ['-lc', `command -v -- ${command}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      env: process.env,
    }).trim();

    if (!output || output.includes('\n')) return null;
    if (!output.includes('/')) return null;
    return existsSync(output) ? output : null;
  } catch {
    return null;
  }
}

function findCommandViaPowerShell(command: string): string | null {
  if (process.platform !== 'win32') return null;
  if (!/^[\w.-]+$/.test(command)) return null;

  const shell = resolveWindowsPowerShell();
  try {
    const output = execFileSync(
      shell,
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Command -Name '${command}' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source)`,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
        windowsHide: true,
        env: windowsEnvForChildProcess(),
      }
    ).trim();

    if (!output || output.includes('\n')) return null;
    return existsSync(output) ? output : null;
  } catch {
    return null;
  }
}

export function findCommand(command: string, extraPaths: string[] = []): string | null {
  if (!command || /[\r\n]/.test(command)) return null;

  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    for (const candidate of getExecutableCandidates(command)) {
      if (existsSync(candidate)) return candidate;
    }
    return existsSync(command) ? command : null;
  }

  if (process.platform === 'win32' && /^[\w.-]+$/.test(command)) {
    try {
      const output = execSync(`where.exe ${command}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: resolveWindowsCmdShell(),
        env: windowsEnvForChildProcess(),
      }).trim();
      const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const preferred = pickPreferredWindowsCommand(lines);
      if (preferred) return preferred;
    } catch {
      /* fall through to PATH scanning */
    }
  }

  const pathDirs = getProcessPathEnv()
    .split(delimiter)
    .filter(Boolean);
  const candidates = getExecutableCandidates(command);
  const seen = new Set<string>();

  for (const dir of [...extraPaths, ...pathDirs]) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    for (const candidate of candidates) {
      const fullPath = join(dir, candidate);
      if (existsSync(fullPath)) return fullPath;
    }
  }

  const shellResolved = findCommandViaLoginShell(command);
  if (shellResolved) return shellResolved;

  const powerShellResolved = findCommandViaPowerShell(command);
  if (powerShellResolved) return powerShellResolved;

  return null;
}

export function commandExists(command: string, extraPaths: string[] = []): boolean {
  const searchPaths = extraPaths.length ? extraPaths : getCommonCliSearchPaths();
  if (findCommand(command, searchPaths) !== null) return true;

  try {
    execFileSync(command, ['--version'], {
      stdio: 'ignore',
      timeout: 5000,
      windowsHide: true,
      env: process.platform === 'win32' ? windowsEnvForChildProcess() : process.env,
    });
    return true;
  } catch (err: any) {
    return err?.status != null;
  }
}
