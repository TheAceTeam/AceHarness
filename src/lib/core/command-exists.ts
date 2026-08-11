import { join } from 'node:path';
import { isWindows } from '@/lib/core/runtime-platform';
import { resolveCommand } from '@/lib/core/resolved-command';

const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function defaultWindowsScanDirs(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  return [
    ...roots.flatMap((root) => [join(root, 'System32'), join(root, 'Sysnative'), root]),
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
  return [...new Set(bases.map((base) => join(base, 'node_modules', '.bin')))];
}

export function getCommonCliSearchPaths(): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (isWindows()) return [...getLocalNodeBinDirs(), ...defaultWindowsScanDirs()];
  return [
    ...getLocalNodeBinDirs(),
    home ? join(home, '.local', 'bin') : '',
    home ? join(home, 'go', 'bin') : '',
    home ? join(home, '.cargo', 'bin') : '',
    ...DEFAULT_SCAN_DIRS_POSIX,
  ].filter(Boolean);
}

/** Compatibility wrapper while callers migrate to resolveCommand(). */
export function findCommand(command: string, extraPaths: string[] = []): string | null {
  if (!command || /[\r\n]/.test(command)) return null;
  const resolution = resolveCommand({ id: command, candidates: [command], fixedArgs: [] }, {
    configuredSearchPaths: extraPaths,
  });
  return resolution.selected?.executable || null;
}

export function commandExists(command: string, extraPaths: string[] = []): boolean {
  const searchPaths = extraPaths.length ? extraPaths : getCommonCliSearchPaths();
  return findCommand(command, searchPaths) !== null;
}
