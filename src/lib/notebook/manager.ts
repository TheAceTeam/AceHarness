import fs from 'fs/promises';
import path from 'path';
import { getWorkspaceNotebookRoot } from '@/lib/core/app-paths';
import { NOTEBOOK_ROOT_DIRNAME } from '@/lib/notebook/constants';

export type NotebookScope = 'personal' | 'global';

const LEGACY_NOTEBOOK_FILES = [
  'Notebook 功能指南.cj.md',
  'Notebook 编辑器功能介绍.cj.md',
  '.ace-notebook-bootstrap.json',
];

export function getNotebookRoot(scope: NotebookScope, personalDir: string): string {
  if (scope === 'global') {
    return getWorkspaceNotebookRoot();
  }
  return path.resolve(personalDir, NOTEBOOK_ROOT_DIRNAME);
}

export async function ensureNotebookRoot(scope: NotebookScope, personalDir: string): Promise<string> {
  const root = getNotebookRoot(scope, personalDir);
  await fs.mkdir(root, { recursive: true });
  await Promise.all(
    LEGACY_NOTEBOOK_FILES.map((name) =>
      fs.rm(path.join(root, name), { force: true }).catch(() => undefined)
    ),
  );
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
