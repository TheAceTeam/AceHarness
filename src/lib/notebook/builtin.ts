import path from 'path';
import { getInstallPath } from '@/lib/core/app-paths';
import type { NotebookScope } from '@/lib/notebook/manager';

export const BUILTIN_NOTEBOOK_DIR = '__builtin__';
export const BUILTIN_NOTEBOOK_LABEL = 'Cangjie Notebook介绍';

const BUILTIN_NOTEBOOK_PATH_ALIASES: Record<string, string> = {
  'Cangjie Notebook 介绍.cj.md': 'Notebook 功能指南.cj.md',
};

export function isBuiltinNotebookPath(targetPath: string | null | undefined): boolean {
  if (!targetPath) return false;
  return targetPath === BUILTIN_NOTEBOOK_DIR || targetPath.startsWith(`${BUILTIN_NOTEBOOK_DIR}/`);
}

export function getBuiltinNotebookTemplateRoot(scope: NotebookScope): string {
  return getInstallPath('configs', 'notebook', scope);
}

export function getBuiltinNotebookRelativePath(targetPath: string): string {
  if (targetPath === BUILTIN_NOTEBOOK_DIR) return '';
  const relativePath = targetPath.slice(`${BUILTIN_NOTEBOOK_DIR}/`.length);
  return BUILTIN_NOTEBOOK_PATH_ALIASES[relativePath] || relativePath;
}

export function getBuiltinNotebookDisplayPath(relativePath: string): string {
  return relativePath ? `${BUILTIN_NOTEBOOK_DIR}/${relativePath}` : BUILTIN_NOTEBOOK_DIR;
}

export function toBuiltinNotebookAbsolutePath(scope: NotebookScope, targetPath: string): string {
  return path.join(getBuiltinNotebookTemplateRoot(scope), getBuiltinNotebookRelativePath(targetPath));
}
