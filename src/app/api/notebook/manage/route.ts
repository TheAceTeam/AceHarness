import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { requireAuth } from '@/lib/auth/middleware';
import { ensureNotebookRoot, normalizeNotebookScope, safeResolve, type NotebookScope } from '@/lib/notebook/manager';
import { getNotebookShare } from '@/lib/notebook/share-store';

async function resolveSharePermission(shareToken: string): Promise<'read' | 'write' | null> {
  if (!shareToken) return null;
  const share = await getNotebookShare(shareToken);
  return share?.permission || null;
}

async function getRoot(scope: NotebookScope, personalDir: string): Promise<string> {
  return ensureNotebookRoot(scope, personalDir);
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const { action, scope: rawScope, shareToken, ...params } = body;
    const scope = normalizeNotebookScope(rawScope);

    if (scope === 'personal' && !auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (!action) {
      return NextResponse.json({ error: '缺少 action 参数' }, { status: 400 });
    }

    if (scope === 'global' && shareToken) {
      const permission = await resolveSharePermission(String(shareToken));
      if (!permission) {
        return NextResponse.json({ error: '分享链接无效' }, { status: 403 });
      }
      if (permission === 'read') {
        return NextResponse.json({ error: '当前分享链接为只读权限' }, { status: 403 });
      }
      return NextResponse.json({ error: '分享链接不支持文件管理操作' }, { status: 403 });
    }

    const notebookRoot = await getRoot(scope, auth.personalDir);
    if (!existsSync(notebookRoot)) {
      return NextResponse.json({ error: 'Notebook 目录不存在' }, { status: 404 });
    }

    switch (action) {
      case 'create-file': {
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, params.content || '', 'utf-8');
        return NextResponse.json({ success: true, scope });
      }
      case 'create-folder': {
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        await fs.mkdir(fullPath, { recursive: true });
        return NextResponse.json({ success: true, scope });
      }
      case 'rename': {
        const oldFull = safeResolve(notebookRoot, params.oldPath);
        const newFull = safeResolve(notebookRoot, params.newPath);
        if (!oldFull || !newFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(oldFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(newFull), { recursive: true });
        await fs.rename(oldFull, newFull);
        return NextResponse.json({ success: true, scope });
      }
      case 'delete': {
        if (scope === 'global' && auth.role !== 'admin') {
          return NextResponse.json({ error: '仅管理员可删除全局 Notebook 文件' }, { status: 403 });
        }
        const fullPath = safeResolve(notebookRoot, params.path);
        if (!fullPath) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(fullPath)) return NextResponse.json({ error: '路径不存在' }, { status: 404 });
        await fs.rm(fullPath, { recursive: true, force: true });
        return NextResponse.json({ success: true, scope });
      }
      case 'copy': {
        const srcFull = safeResolve(notebookRoot, params.srcPath);
        const destFull = safeResolve(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        return NextResponse.json({ success: true, scope });
      }
      case 'copy-between': {
        const srcScope = normalizeNotebookScope(params.srcScope);
        const destScope = normalizeNotebookScope(params.destScope);
        const srcRoot = await getRoot(srcScope, auth.personalDir);
        const destRoot = await getRoot(destScope, auth.personalDir);
        const srcFull = safeResolve(srcRoot, params.srcPath);
        const destFull = safeResolve(destRoot, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        await fs.cp(srcFull, destFull, { recursive: true });
        return NextResponse.json({ success: true, srcScope, destScope });
      }
      case 'move': {
        const srcFull = safeResolve(notebookRoot, params.srcPath);
        const destFull = safeResolve(notebookRoot, params.destPath);
        if (!srcFull || !destFull) return NextResponse.json({ error: '路径不合法' }, { status: 403 });
        if (!existsSync(srcFull)) return NextResponse.json({ error: '源路径不存在' }, { status: 404 });
        await fs.mkdir(path.dirname(destFull), { recursive: true });
        try {
          await fs.rename(srcFull, destFull);
        } catch {
          await fs.cp(srcFull, destFull, { recursive: true });
          await fs.rm(srcFull, { recursive: true, force: true });
        }
        return NextResponse.json({ success: true, scope });
      }
      default:
        return NextResponse.json({ error: `未知操作: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    return NextResponse.json({ error: 'Notebook 操作失败', message: error.message }, { status: 500 });
  }
}
