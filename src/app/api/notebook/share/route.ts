import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import { requireAuth } from '@/lib/auth/middleware';
import { createNotebookShare, getNotebookShare, type NotebookSharePermission } from '@/lib/notebook/share-store';
import { ensureNotebookRoot, normalizeNotebookScope, safeResolve } from '@/lib/notebook/manager';
import { isBuiltinNotebookPath } from '@/lib/notebook/builtin';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const scope = normalizeNotebookScope(body.scope);
    const filePath = String(body.filePath || '');
    const permission = (body.permission === 'read' ? 'read' : 'write') as NotebookSharePermission;

    if (scope !== 'global') {
      return NextResponse.json({ error: '仅全局 Notebook 支持分享链接' }, { status: 400 });
    }
    if (!filePath) {
      return NextResponse.json({ error: '缺少 filePath' }, { status: 400 });
    }
    if (isBuiltinNotebookPath(filePath)) {
      return NextResponse.json({ error: '内置文档不支持创建分享链接' }, { status: 403 });
    }

    const root = await ensureNotebookRoot(scope, auth.personalDir);
    const fullPath = safeResolve(root, filePath);
    if (!fullPath) {
      return NextResponse.json({ error: '路径不合法' }, { status: 403 });
    }
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) {
      return NextResponse.json({ error: '仅支持分享文件' }, { status: 400 });
    }

    const share = await createNotebookShare({
      scope,
      path: filePath,
      absolutePath: fullPath,
      permission,
      createdBy: auth.id,
    });

    return NextResponse.json({
      token: share.token,
      scope: share.scope,
      path: share.path,
      permission: share.permission,
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    return NextResponse.json({ error: '创建分享链接失败', message: error?.message || 'unknown' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const token = new URL(request.url).searchParams.get('token') || '';
    if (!token) {
      return NextResponse.json({ error: '缺少 token 参数' }, { status: 400 });
    }
    const share = await getNotebookShare(token);
    if (!share) {
      return NextResponse.json({ error: '分享链接无效或已失效' }, { status: 404 });
    }
    return NextResponse.json({
      scope: share.scope,
      path: share.path,
      permission: share.permission,
      createdAt: share.createdAt,
    });
  } catch (error: any) {
    return NextResponse.json({ error: '解析分享链接失败', message: error?.message || 'unknown' }, { status: 500 });
  }
}
