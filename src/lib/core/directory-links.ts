import { existsSync, realpathSync, symlinkSync } from 'fs';
import { isWindows } from '@/lib/core/runtime-platform';

function getDirectoryLinkType(): 'dir' | 'junction' {
  return isWindows() ? 'junction' : 'dir';
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
