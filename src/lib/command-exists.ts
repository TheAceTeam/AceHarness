import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join, delimiter } from 'path';

const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function defaultWindowsScanDirs(): string[] {
  const out: string[] = [];
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm'));
  if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'Programs'));
  out.push('C:\\Program Files\\nodejs');
  return out;
}

function existsNamedInDir(dir: string, name: string): boolean {
  const candidates = [
    join(dir, `${name}.exe`),
    join(dir, `${name}.cmd`),
    join(dir, `${name}.bat`),
    join(dir, name),
  ];
  return candidates.some((p) => existsSync(p));
}

/**
 * True if `name` is on PATH or exists under known bin dirs.
 * Windows: uses `where.exe` (no Git Bash required); falls back to scanning npm/global dirs.
 * POSIX: uses bash `command -v` with PATH augmented by extraDirs.
 * `name` must be a single token (no slashes).
 */
export function commandExists(name: string, extraDirs?: string[]): boolean {
  if (!/^[\w.-]+$/.test(name)) return false;

  if (process.platform === 'win32') {
    try {
      execSync(`where.exe ${name}`, {
        stdio: 'ignore',
        shell: process.env.ComSpec || true,
      });
      return true;
    } catch {
      const dirs = [...(extraDirs ?? []), ...defaultWindowsScanDirs()];
      const seen = new Set<string>();
      for (const dir of dirs) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        try {
          if (existsSync(dir) && existsNamedInDir(dir, name)) return true;
        } catch {
          /* ignore */
        }
      }
      return false;
    }
  }

  const dirs = extraDirs?.length ? extraDirs : DEFAULT_SCAN_DIRS_POSIX;
  const pathEnv = [...dirs, process.env.PATH || ''].filter(Boolean).join(delimiter);
  try {
    execSync(`command -v ${name}`, {
      stdio: 'ignore',
      shell: '/bin/bash',
      env: { ...process.env, PATH: pathEnv },
    });
    return true;
  } catch {
    for (const dir of dirs) {
      if (existsSync(join(dir, name))) return true;
    }
    return false;
  }
}
