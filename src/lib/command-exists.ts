import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { delimiter, isAbsolute, join } from 'path';

const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function defaultWindowsScanDirs(): string[] {
  const out: string[] = [];
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home) out.push(join(home, 'AppData', 'Roaming', 'npm'));
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm'));
  if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'Programs'));
  out.push('C:\\Program Files\\nodejs');
  return out;
}

function getExecutableCandidates(command: string): string[] {
  if (process.platform !== 'win32') return [command];

  const hasExtension = /\.[^./\\]+$/.test(command);
  if (hasExtension) return [command];

  const pathext = (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);

  return [command, ...pathext.map((ext) => `${command}${ext}`)];
}

export function getCommonCliSearchPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';

  if (process.platform === 'win32') {
    return defaultWindowsScanDirs();
  }

  return [
    home ? join(home, '.local', 'bin') : '',
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
      const first = output.split(/\r?\n/).find(Boolean);
      if (first) return first;
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
  return findCommand(command, extraPaths.length ? extraPaths : getCommonCliSearchPaths()) !== null;
}
