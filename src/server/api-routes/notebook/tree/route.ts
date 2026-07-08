import type { Dirent } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { requireAuth } from '@/lib/auth/middleware';
import { normalizeNotebookScope, ensureNotebookRoot, safeResolve } from '@/lib/notebook/manager';
import {
  BUILTIN_NOTEBOOK_DIR,
  BUILTIN_NOTEBOOK_LABEL,
  getBuiltinNotebookDisplayPath,
  getBuiltinNotebookRelativePath,
  getBuiltinNotebookTemplateRoot,
  isBuiltinNotebookPath,
} from '@/lib/notebook/builtin';
import { getNotebookShare } from '@/lib/notebook/share-store';
import { getNotebookDirectoryIcons, getNotebookDirectoryOrder, NOTEBOOK_TREE_ORDER_FILE } from '@/lib/notebook/tree-order';
import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  modifiedTime?: number;
  children?: TreeNode[];
  readOnly?: boolean;
  iconEmoji?: string;
}

function toPortablePath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

async function buildFilesystemTree(
  dirPath: string,
  rootPath: string,
  depth: number,
  maxDepth: number,
  visited?: Set<string>,
): Promise<TreeNode[]> {
  const seen = visited || new Set<string>();
  let realDir: string;
  try {
    realDir = await fs.realpath(dirPath);
  } catch {
    return [];
  }
  if (seen.has(realDir)) return [];
  seen.add(realDir);

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const filteredEntries = entries.filter((entry) => entry.name !== NOTEBOOK_TREE_ORDER_FILE);
  const orderedNames = await getNotebookDirectoryOrder(dirPath);
  const directoryIcons = await getNotebookDirectoryIcons(dirPath);
  const orderIndex = new Map(orderedNames.map((name, index) => [name, index]));
  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of filteredEntries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = toPortablePath(path.relative(rootPath, fullPath));

    if (entry.isDirectory() || entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          const children = depth < maxDepth
            ? await buildFilesystemTree(fullPath, rootPath, depth + 1, maxDepth, seen)
            : undefined;
          dirs.push({
            name: entry.name,
            path: relativePath,
            type: 'directory',
            modifiedTime: stat.mtimeMs,
            children,
            iconEmoji: directoryIcons[entry.name],
          });
        } else if (stat.isFile()) {
          files.push({ name: entry.name, path: relativePath, type: 'file', modifiedTime: stat.mtimeMs });
        }
      } catch {}
    } else if (entry.isFile()) {
      let modifiedTime = 0;
      try {
        const stat = await fs.stat(fullPath);
        modifiedTime = stat.mtimeMs;
      } catch {}
      files.push({
        name: entry.name,
        path: relativePath,
        type: 'file',
        modifiedTime,
      });
    }
  }

  const fallbackCompare = (a: TreeNode, b: TreeNode) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    if (a.type === 'directory') return a.name.localeCompare(b.name);
    const timeDiff = (b.modifiedTime || 0) - (a.modifiedTime || 0);
    if (timeDiff !== 0) return timeDiff;
    return a.name.localeCompare(b.name);
  };

  return [...dirs, ...files].sort((a, b) => {
    const aIndex = orderIndex.get(a.name);
    const bIndex = orderIndex.get(b.name);
    if (aIndex != null && bIndex != null) return aIndex - bIndex;
    if (aIndex != null) return -1;
    if (bIndex != null) return 1;
    return fallbackCompare(a, b);
  });
}

async function buildBuiltinTree(dirPath: string, virtualPath: string, depth: number, maxDepth: number): Promise<TreeNode[]> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' }) as Dirent<string>[];
  } catch {
    return [];
  }

  const dirs: TreeNode[] = [];
  const files: TreeNode[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const nodePath = getBuiltinNotebookDisplayPath(virtualPath ? `${virtualPath}/${entry.name}` : entry.name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const children = depth < maxDepth
          ? await buildBuiltinTree(fullPath, virtualPath ? `${virtualPath}/${entry.name}` : entry.name, depth + 1, maxDepth)
          : undefined;
        dirs.push({
          name: entry.name,
          path: nodePath,
          type: 'directory',
          modifiedTime: stat.mtimeMs,
          children,
          readOnly: true,
        });
      } else if (stat.isFile()) {
        files.push({
          name: entry.name,
          path: nodePath,
          type: 'file',
          modifiedTime: stat.mtimeMs,
          readOnly: true,
        });
      }
    } catch {}
  }

  return [...dirs, ...files].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

async function buildBuiltinRootNode(scope: 'personal' | 'global', maxDepth: number): Promise<TreeNode | null> {
  const builtinRoot = getBuiltinNotebookTemplateRoot(scope);
  const children = maxDepth > 0 ? await buildBuiltinTree(builtinRoot, '', 1, maxDepth) : undefined;
  try {
    const stat = await fs.stat(builtinRoot);
    if (!stat.isDirectory()) return null;
    return {
      name: BUILTIN_NOTEBOOK_LABEL,
      path: BUILTIN_NOTEBOOK_DIR,
      type: 'directory',
      modifiedTime: stat.mtimeMs,
      children,
      readOnly: true,
    };
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const scope = normalizeNotebookScope(searchParams.get('scope'));
    const maxDepth = Math.min(parseInt(searchParams.get('depth') || '2', 10), 10);
    const subPath = searchParams.get('sub') || '';
    const shareToken = searchParams.get('shareToken') || '';

    if (scope === 'personal' && !auth.personalDir) {
      return jsonOk({ error: '用户未配置个人目录' }, { status: 400 });
    }

    const notebookRoot = await ensureNotebookRoot(scope, auth.personalDir);

    if (scope === 'global' && shareToken) {
      const share = await getNotebookShare(shareToken);
      if (!share || share.scope !== 'global') {
        return jsonOk({ error: '分享链接无效' }, { status: 403 });
      }
      const shareDir = path.dirname(share.path || '');
      if (subPath && subPath !== shareDir) {
        return jsonOk({ error: '分享链接无权访问该目录' }, { status: 403 });
      }
      const shareName = path.basename(share.path || '');
      return jsonOk({
        tree: [{
          name: shareName,
          path: share.path,
          type: 'file',
        }],
        rootPath: notebookRoot,
        scope,
      });
    }

    if (!subPath) {
      const tree = await buildFilesystemTree(notebookRoot, notebookRoot, 0, maxDepth);
      const builtinNode = await buildBuiltinRootNode(scope, maxDepth);
      return jsonOk({ tree: builtinNode ? [builtinNode, ...tree] : tree, rootPath: notebookRoot, scope });
    }

    if (isBuiltinNotebookPath(subPath)) {
      if (subPath === BUILTIN_NOTEBOOK_DIR) {
        const tree = await buildBuiltinTree(getBuiltinNotebookTemplateRoot(scope), '', 0, maxDepth);
        return jsonOk({ tree, rootPath: notebookRoot, scope });
      }
      const relativeSubPath = getBuiltinNotebookRelativePath(subPath);
      const builtinTarget = path.join(getBuiltinNotebookTemplateRoot(scope), relativeSubPath);
      const stat = await fs.stat(builtinTarget);
      if (!stat.isDirectory()) {
        return jsonOk({ error: '路径不是目录' }, { status: 400 });
      }
      const tree = await buildBuiltinTree(builtinTarget, relativeSubPath, 0, maxDepth);
      return jsonOk({ tree, rootPath: notebookRoot, scope });
    }

    const targetPath = safeResolve(notebookRoot, subPath);
    if (!targetPath) {
      return jsonOk({ error: '路径不合法' }, { status: 403 });
    }

    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      return jsonOk({ error: '路径不是目录' }, { status: 400 });
    }

    const tree = await buildFilesystemTree(targetPath, notebookRoot, 0, maxDepth);
    return jsonOk({ tree, rootPath: notebookRoot, scope });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return jsonOk({ error: '目录不存在' }, { status: 404 });
    }
    return jsonOk({ error: '读取 Notebook 目录失败', message: error.message }, { status: 500 });
  }
}
