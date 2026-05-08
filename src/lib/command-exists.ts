import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function defaultWindowsScanDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return [
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
    return defaultWindowsScanDirs();
  }

  return [
    home ? join(home, '.local', 'bin') : '',
    home ? join(home, 'go', 'bin') : '',
    home ? join(home, '.cargo', 'bin') : '',
    ...DEFAULT_SCAN_DIRS_POSIX,
  ].filter(Boolean);
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
        shell: process.env.ComSpec,
      }).trim();
      const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const preferred = pickPreferredWindowsCommand(lines);
      if (preferred) return preferred;
    } catch {
      /* fall through to PATH scanning */
    }
  }

  const pathDirs = (process.env.PATH || '')
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
    });
    return true;
  } catch (err: any) {
    return err?.status != null;
  }
}
