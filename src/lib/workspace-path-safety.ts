import fs from 'fs/promises';
import path from 'path';

export const WORKSPACE_TEXT_FILE_SIZE_LIMIT = 200 * 1024;
export const WORKSPACE_BLOB_PREVIEW_SIZE_LIMIT = 50 * 1024 * 1024;
export const WORKSPACE_UPLOAD_FILE_SIZE_LIMIT = 50 * 1024 * 1024;
export const WORKSPACE_UPLOAD_TOTAL_SIZE_LIMIT = 200 * 1024 * 1024;
export const WORKSPACE_UPLOAD_FILE_COUNT_LIMIT = 500;
export const WORKSPACE_ARCHIVE_TOTAL_SIZE_LIMIT = 200 * 1024 * 1024;
export const WORKSPACE_ARCHIVE_FILE_COUNT_LIMIT = 2000;
export const WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT = 1000;

export class WorkspacePathError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'WorkspacePathError';
    this.status = status;
  }
}

export function isInsidePath(root: string, target: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
}

function hasControlChars(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function assertSafeRelativePath(relPath: string, label = '路径'): string {
  if (typeof relPath !== 'string') {
    throw new WorkspacePathError(`${label}不合法`);
  }

  if (relPath.length > WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT) {
    throw new WorkspacePathError(`${label}过长`);
  }

  if (hasControlChars(relPath)) {
    throw new WorkspacePathError(`${label}包含非法字符`);
  }

  const normalized = normalizeRelativePath(relPath.trim());
  if (!normalized) return '';

  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) {
    throw new WorkspacePathError(`${label}不能是绝对路径`);
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '..' || part === '.')) {
    throw new WorkspacePathError(`${label}不能包含 . 或 ..`);
  }

  return parts.join(path.sep);
}

export async function resolveWorkspaceRoot(workspace: string): Promise<string> {
  if (!workspace || typeof workspace !== 'string') {
    throw new WorkspacePathError('缺少 workspace 参数');
  }

  if (hasControlChars(workspace)) {
    throw new WorkspacePathError('workspace 包含非法字符');
  }

  const resolved = path.resolve(workspace);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(resolved);
  } catch {
    throw new WorkspacePathError('workspace 不存在', 404);
  }

  const stat = await fs.stat(realRoot);
  if (!stat.isDirectory()) {
    throw new WorkspacePathError('workspace 不是目录');
  }

  return realRoot;
}

export async function resolveExistingInsideWorkspace(root: string, relPath: string): Promise<string> {
  const safeRelPath = assertSafeRelativePath(relPath);
  const lexicalPath = path.resolve(root, safeRelPath);
  if (!isInsidePath(root, lexicalPath)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  let realPath: string;
  try {
    realPath = await fs.realpath(lexicalPath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new WorkspacePathError('路径不存在', 404);
    throw error;
  }

  if (!isInsidePath(root, realPath)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  return realPath;
}

export async function resolveCreatableInsideWorkspace(root: string, relPath: string): Promise<{ fullPath: string; parentPath: string }> {
  const safeRelPath = assertSafeRelativePath(relPath);
  if (!safeRelPath) {
    throw new WorkspacePathError('不能写入 workspace 根目录');
  }

  const fullPath = path.resolve(root, safeRelPath);
  if (!isInsidePath(root, fullPath)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  const parentPath = path.dirname(fullPath);
  let realParent: string;
  try {
    realParent = await fs.realpath(parentPath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new WorkspacePathError('父目录不存在', 404);
    throw error;
  }

  if (!isInsidePath(root, realParent)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  return { fullPath, parentPath: realParent };
}

export async function assertNoSymlinkEscape(root: string, targetPath: string): Promise<void> {
  const realPath = await fs.realpath(targetPath);
  if (!isInsidePath(root, realPath)) {
    throw new WorkspacePathError('符号链接指向 workspace 外部，操作已拒绝', 403);
  }
}

export async function ensureDirectoryInsideWorkspace(root: string, relPath: string): Promise<string> {
  const safeRelPath = assertSafeRelativePath(relPath);
  const fullPath = path.resolve(root, safeRelPath);
  if (!isInsidePath(root, fullPath)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  await fs.mkdir(fullPath, { recursive: true });
  const realPath = await fs.realpath(fullPath);
  if (!isInsidePath(root, realPath)) {
    throw new WorkspacePathError('路径不合法', 403);
  }

  return realPath;
}

export async function getConflictSafePath(targetPath: string): Promise<string> {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 1;

  while (true) {
    try {
      await fs.lstat(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return candidate;
      throw error;
    }
  }
}

export function sanitizeDownloadName(name: string): string {
  const fallback = 'download';
  const originalBase = path.basename(name || fallback);
  const base = originalBase.replace(/[\r\n"\\/\u0000-\u001f\u007f]/g, '_').trim();
  return /[^_]/.test(base) ? base : fallback;
}

export function workspaceErrorResponse(error: unknown): { message: string; status: number } {
  if (error instanceof WorkspacePathError) {
    return { message: error.message, status: error.status };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message, status: 500 };
  }
  return { message: '操作失败', status: 500 };
}
