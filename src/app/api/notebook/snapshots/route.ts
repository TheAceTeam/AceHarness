import fs from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { ensureNotebookRoot, normalizeNotebookScope, safeResolve } from '@/lib/notebook/manager';
import { getNotebookShare } from '@/lib/notebook/share-store';
import {
  createNotebookSnapshot,
  getNotebookSnapshotContent,
  listNotebookSnapshots,
  type NotebookSnapshotSource,
} from '@/lib/notebook/snapshot-store';

async function resolveShare(shareToken: string) {
  if (!shareToken) return null;
  return getNotebookShare(shareToken);
}

function getOwnerId(scope: 'personal' | 'global', userId: string): string {
  return scope === 'personal' ? userId : 'global';
}

async function validateFileAccess(input: {
  scope: 'personal' | 'global';
  file: string;
  personalDir: string;
}) {
  const root = await ensureNotebookRoot(input.scope, input.personalDir);
  const fullPath = safeResolve(root, input.file);
  if (!fullPath) return { error: '路径不合法', status: 403 as const };
  return { root, fullPath };
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file') || '';
    const shareToken = searchParams.get('shareToken') || '';
    const snapshotId = searchParams.get('snapshotId') || '';
    const scope = normalizeNotebookScope(searchParams.get('scope'));

    if (!file) return NextResponse.json({ error: '缺少 file 参数' }, { status: 400 });
    if (scope === 'personal' && !auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (scope === 'global' && shareToken) {
      const share = await resolveShare(shareToken);
      if (!share || share.scope !== 'global') {
        return NextResponse.json({ error: '分享链接无效' }, { status: 403 });
      }
      if (share.path !== file) {
        return NextResponse.json({ error: '分享链接无权访问该文件' }, { status: 403 });
      }
    }

    if (snapshotId) {
      const snapshot = await getNotebookSnapshotContent({
        scope,
        ownerId: getOwnerId(scope, auth.id),
        file,
        snapshotId,
      });
      if (!snapshot) {
        return NextResponse.json({ error: '快照不存在' }, { status: 404 });
      }
      return NextResponse.json({
        snapshot: {
          id: snapshot.id,
          file: snapshot.file,
          scope: snapshot.scope,
          createdAt: snapshot.createdAt,
          createdByName: snapshot.createdByName,
          source: snapshot.source,
          content: snapshot.content,
        },
      });
    }

    const rows = await listNotebookSnapshots({
      scope,
      ownerId: getOwnerId(scope, auth.id),
      file,
    });
    return NextResponse.json({ rows });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取快照列表失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const file = String(body?.file || '');
    const rawScope = body?.scope;
    const scope = normalizeNotebookScope(rawScope);
    const shareToken = String(body?.shareToken || '');
    const source = (body?.source || 'manual') as NotebookSnapshotSource;
    let content = typeof body?.content === 'string' ? body.content : '';

    if (!file) return NextResponse.json({ error: '缺少 file 参数' }, { status: 400 });
    if (scope === 'personal' && !auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (scope === 'global' && shareToken) {
      const share = await resolveShare(shareToken);
      if (!share || share.scope !== 'global') {
        return NextResponse.json({ error: '分享链接无效' }, { status: 403 });
      }
      if (share.path !== file) {
        return NextResponse.json({ error: '分享链接无权访问该文件' }, { status: 403 });
      }
      if (share.permission === 'read') {
        return NextResponse.json({ error: '当前分享链接为只读权限' }, { status: 403 });
      }
    }

    const access = await validateFileAccess({ scope, file, personalDir: auth.personalDir });
    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    if (!content) {
      content = await fs.readFile(access.fullPath, 'utf-8').catch(() => '');
    }

    const result = await createNotebookSnapshot({
      scope,
      ownerId: getOwnerId(scope, auth.id),
      file,
      content,
      createdBy: auth.id,
      createdByName: auth.username,
      source,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '创建快照失败' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const file = String(body?.file || '');
    const snapshotId = String(body?.snapshotId || '');
    const rawScope = body?.scope;
    const scope = normalizeNotebookScope(rawScope);
    const shareToken = String(body?.shareToken || '');

    if (!file || !snapshotId) {
      return NextResponse.json({ error: '缺少 file 或 snapshotId 参数' }, { status: 400 });
    }
    if (scope === 'personal' && !auth.personalDir) {
      return NextResponse.json({ error: '用户未配置个人目录' }, { status: 400 });
    }

    if (scope === 'global' && shareToken) {
      const share = await resolveShare(shareToken);
      if (!share || share.scope !== 'global') {
        return NextResponse.json({ error: '分享链接无效' }, { status: 403 });
      }
      if (share.path !== file) {
        return NextResponse.json({ error: '分享链接无权访问该文件' }, { status: 403 });
      }
      if (share.permission === 'read') {
        return NextResponse.json({ error: '当前分享链接为只读权限' }, { status: 403 });
      }
    }

    const access = await validateFileAccess({ scope, file, personalDir: auth.personalDir });
    if ('error' in access) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const snapshot = await getNotebookSnapshotContent({
      scope,
      ownerId: getOwnerId(scope, auth.id),
      file,
      snapshotId,
    });
    if (!snapshot) {
      return NextResponse.json({ error: '快照不存在' }, { status: 404 });
    }

    await fs.writeFile(access.fullPath, snapshot.content || '', 'utf-8');
    return NextResponse.json({ success: true, restoredSnapshotId: snapshot.id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '恢复快照失败' }, { status: 500 });
  }
}
