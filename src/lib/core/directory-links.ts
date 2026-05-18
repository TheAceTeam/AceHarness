import { existsSync, realpathSync, symlinkSync } from 'fs';

function getDirectoryLinkType(): 'dir' | 'junction' {
  return process.platform === 'win32' ? 'junction' : 'dir';
}

export function createDirectoryLinkSync(targetDir: string, linkPath: string): void {
  symlinkSync(targetDir, linkPath, getDirectoryLinkType());
}

export function isLinkedDirectoryTarget(linkPath: string, targetDir: string): boolean {
  if (!existsSync(linkPath) || !existsSync(targetDir)) return false;

  try {
    return realpathSync(linkPath) === realpathSync(targetDir);
  } catch {
    return false;
  }
}

export function ensureDirectoryLinkSync(targetDir: string, linkPath: string): 'created' | 'exists' | 'skipped' {
  if (!existsSync(targetDir)) return 'skipped';
  if (existsSync(linkPath)) {
    return isLinkedDirectoryTarget(linkPath, targetDir) ? 'exists' : 'skipped';
  }

  createDirectoryLinkSync(targetDir, linkPath);
  return 'created';
}
