import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceNotebookRoot } from '@/lib/core/app-paths';

export type NotebookScope = 'personal' | 'global';

export const NOTEBOOK_ROOT_DIRNAME = '.cangjie-notbook';

export function getNotebookRoot(scope: NotebookScope, personalDir: string): string {
  if (scope === 'global') {
    return getWorkspaceNotebookRoot();
  }
  return path.resolve(personalDir, NOTEBOOK_ROOT_DIRNAME);
}

export async function ensureNotebookRoot(scope: NotebookScope, personalDir: string): Promise<string> {
  const root = getNotebookRoot(scope, personalDir);
  await fs.mkdir(root, { recursive: true });
  return root;
}

export function safeResolve(root: string, relPath: string): string | null {
  const resolved = path.resolve(root, relPath || '.');
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

export function normalizeNotebookScope(value: unknown): NotebookScope {
  return value === 'global' ? 'global' : 'personal';
}
