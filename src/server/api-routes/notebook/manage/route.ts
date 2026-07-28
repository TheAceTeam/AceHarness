import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth/middleware';
import { ensureNotebookRoot, normalizeNotebookScope, safeResolve, type NotebookScope } from '@/lib/notebook/manager';
import { isBuiltinNotebookPath } from '@/lib/notebook/builtin';
import { getNotebookShare } from '@/lib/notebook/share-store';
import {
  appendNotebookDirectoryOrder,
  copyNotebookDirectoryIcon,
  removeNotebookDirectoryOrder,
  removeNotebookDirectoryIcon,
  renameNotebookDirectoryIcon,
  renameNotebookDirectoryOrder,
  reorderNotebookDirectoryEntry,
  setNotebookDirectoryIcon,
} from '@/lib/notebook/tree-order';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

async function ensureDestinationAvailable(fullPath: string): Promise<void> {
  try {
    await fs.lstat(fullPath);
    throw new Error('目标路径已存在');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
}

function ensureValidRelocation(srcFull: string, destFull: string, options?: { disallowSameParent?: boolean }): void {
  const srcNormalized = path.resolve(srcFull);
  const destNormalized = path.resolve(destFull);
  const srcParent = path.dirname(srcNormalized);

  if (srcNormalized === destNormalized) {
    throw new Error('源路径与目标路径相同');
  }
  if (destNormalized.startsWith(`${srcNormalized}${path.sep}`)) {
    throw new Error('不能移动或重命名到自身子目录中');
  }
  if (options?.disallowSameParent && srcParent === path.dirname(destNormalized)) {
    throw new Error('目标路径与当前目录相同');
  }
}

async function resolveSharePermission(shareToken: string): Promise<'read' | 'write' | null> {
  if (!shareToken) return null;
  const share = await getNotebookShare(shareToken);
  return share?.permission || null;
}

async function getRoot(scope: NotebookScope, personalDir: string): Promise<string> {
  return ensureNotebookRoot(scope, personalDir);
}

function containsBuiltinNotebookPath(params: Record<string, unknown>): boolean {
  return Object.values(params).some((value) => typeof value === 'string' && isBuiltinNotebookPath(value));
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const { action, scope: rawScope, shareToken, ...params } = body;
    const scope = normalizeNotebookScope(rawScope);

    if (scope === 'personal' && !auth.personalDir) {
      return jsonOk({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (!action) {
      return jsonOk({ error: '缺少 action 参数' }, { status: 400 });
    }

    if (containsBuiltinNotebookPath(params)) {
      return jsonOk({ error: '内置文档目录为只读内容，无法执行该操作' }, { status: 403 });
    }

    if (scope === 'global' && shareToken) {
      const permission = await resolveSharePermission(String(shareToken));
      if (!permission) {
        return jsonOk({ error: '分享链接无效' }, { status: 403 });
      }
      if (permission === 'read') {
        return jsonOk({ error: '当前分享链接为只读权限' }, { status: 403 });
      }
      return jsonOk({ error: '分享链接不支持文件管理操作' }, { status: 403 });
    }

    const notebookRoot = await getRoot(scope, auth.personalDir);
    if (!existsSync(notebookRoot)) {
      return jsonOk({ error: 'Notebook 目录不存在' }, { status: 404 });
    }

    switch (action) {
      case 'create-file': {
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return jsonOk({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, params.content || '', 'utf-8');
        await appendNotebookDirectoryOrder(path.dirname(fullPath), path.basename(fullPath));
        return jsonOk({ success: true, scope });
      }
      case 'create-folder': {
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return jsonOk({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(fullPath, { recursive: true });
        await appendNotebookDirectoryOrder(path.dirname(fullPath), path.basename(fullPath));
        return jsonOk({ success: true, scope });
      }
      case 'rename': {
        const oldFull = safeResolve(notebookRoot, params.oldPath);
        const newFull = safeResolve(notebookRoot, params.newPath);
        if (!oldFull || !newFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(oldFull)) return jsonOk({ error: '源路径不存在' }, { status: 404 });
        ensureValidRelocation(oldFull, newFull);
        await ensureDestinationAvailable(newFull);
        await fs.mkdir(path.dirname(newFull), { recursive: true });
        await fs.rename(oldFull, newFull);
        const oldParent = path.dirname(oldFull);
        const newParent = path.dirname(newFull);
        const oldName = path.basename(oldFull);
        const newName = path.basename(newFull);
        if (oldParent === newParent) {
          await renameNotebookDirectoryOrder(oldParent, oldName, newName);
          await renameNotebookDirectoryIcon(oldParent, oldName, newName);
        } else {
          await removeNotebookDirectoryOrder(oldParent, oldName);
          await appendNotebookDirectoryOrder(newParent, newName);
          await copyNotebookDirectoryIcon(oldParent, oldName, newParent, newName);
          await removeNotebookDirectoryIcon(oldParent, oldName);
        }
        return jsonOk({ success: true, scope });
      }
      case 'delete': {
        if (scope === 'global' && auth.role !== 'admin') {
          return jsonOk({ error: '仅管理员可删除全局 Notebook 文件' }, { status: 403 });
        }
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(fullPath)) return jsonOk({ error: '路径不存在' }, { status: 404 });
        await fs.rm(fullPath, { recursive: true, force: true });
        await removeNotebookDirectoryOrder(path.dirname(fullPath), path.basename(fullPath));
        await removeNotebookDirectoryIcon(path.dirname(fullPath), path.basename(fullPath));
        return jsonOk({ success: true, scope });
      }
      case 'copy': {
        const srcFull = safeResolve(notebookRoot, params.srcPath);
        const destFull = safeResolve(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return jsonOk({ error: '源路径不存在' }, { status: 404 });
        await ensureDestinationAvailable(destFull);
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        await appendNotebookDirectoryOrder(path.dirname(destFull), path.basename(destFull));
        await copyNotebookDirectoryIcon(path.dirname(srcFull), path.basename(srcFull), path.dirname(destFull), path.basename(destFull));
        return jsonOk({ success: true, scope });
      }
      case 'copy-between': {
        const srcScope = normalizeNotebookScope(params.srcScope);
        const destScope = normalizeNotebookScope(params.destScope);
        const srcRoot = await getRoot(srcScope, auth.personalDir);
        const destRoot = await getRoot(destScope, auth.personalDir);
        const srcFull = safeResolve(srcRoot, params.srcPath);
        const destFull = safeResolve(destRoot, params.destPath);
        if (!srcFull || !destFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return jsonOk({ error: '源路径不存在' }, { status: 404 });
        await ensureDestinationAvailable(destFull);
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        await appendNotebookDirectoryOrder(path.dirname(destFull), path.basename(destFull));
        await copyNotebookDirectoryIcon(path.dirname(srcFull), path.basename(srcFull), path.dirname(destFull), path.basename(destFull));
        return jsonOk({ success: true, srcScope, destScope });
      }
      case 'move': {
        const srcFull = safeResolve(notebookRoot, params.srcPath);
        const destFull = safeResolve(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return jsonOk({ error: '源路径不存在' }, { status: 404 });
        ensureValidRelocation(srcFull, destFull, { disallowSameParent: true });
        await ensureDestinationAvailable(destFull);
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        try {
          await fs.rename(srcFull, destFull);
        } catch {
          await fs.cp(srcFull, destFull, { recursive: true });
          await fs.rm(srcFull, { recursive: true, force: true });
        }
        await removeNotebookDirectoryOrder(path.dirname(srcFull), path.basename(srcFull));
        await appendNotebookDirectoryOrder(path.dirname(destFull), path.basename(destFull));
        await copyNotebookDirectoryIcon(path.dirname(srcFull), path.basename(srcFull), path.dirname(destFull), path.basename(destFull));
        await removeNotebookDirectoryIcon(path.dirname(srcFull), path.basename(srcFull));
        return jsonOk({ success: true, scope });
      }
      case 'set-icon': {
        const targetFull = safeResolve(notebookRoot, params.path);
        const icon = typeof params.icon === 'string' ? params.icon.trim() : '';
        if (!targetFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(targetFull)) return jsonOk({ error: '路径不存在' }, { status: 404 });
        const stat = await fs.stat(targetFull);
        if (!stat.isDirectory()) return jsonOk({ error: '仅支持为目录设置图标' }, { status: 400 });
        if (icon.length > 16) return jsonOk({ error: '图标内容过长' }, { status: 400 });
        await setNotebookDirectoryIcon(path.dirname(targetFull), path.basename(targetFull), icon || null);
        return jsonOk({ success: true, scope });
      }
      case 'reorder': {
        const srcFull = safeResolve(notebookRoot, params.srcPath);
        const targetFull = safeResolve(notebookRoot, params.targetPath);
        const position = params.position === 'after' ? 'after' : 'before';
        if (!srcFull || !targetFull) return jsonOk({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(targetFull)) {
          return jsonOk({ error: '目标路径不存在' }, { status: 404 });
        }
        const targetParent = path.dirname(targetFull);
        const targetScopedSource = path.join(targetParent, path.basename(srcFull));
        const reorderSource = existsSync(srcFull) && path.dirname(srcFull) === targetParent
          ? srcFull
          : targetScopedSource;
        if (!existsSync(reorderSource) || path.dirname(reorderSource) !== targetParent) {
          return jsonOk({ error: '仅支持同一目录内排序' }, { status: 400 });
        }
        await reorderNotebookDirectoryEntry(targetParent, path.basename(reorderSource), path.basename(targetFull), position);
        return jsonOk({ success: true, scope });
      }
      default:
        return jsonOk({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return jsonOk({ error: 'Notebook 操作失败', message: error.message }, { status: 500 });
  }
}
