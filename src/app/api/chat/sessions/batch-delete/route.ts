import { NextRequest, NextResponse } from 'next/server';
import { deleteChatSession, loadChatSession } from '@/lib/chat/persistence';
import { requireAuth } from '@/lib/auth/middleware';

function isOwner(session: any, userId: string): boolean {
  if (!session) return false;
  if (!session.createdBy) return true;
  return session.createdBy === userId;
}

export async function POST(req: NextRequest) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;
  try {
    const body = await req.json();
    const ids: string[] = Array.from(new Set<string>(
      Array.isArray(body?.ids)
        ? body.ids.map((id: unknown) => String(id || '').trim()).filter(Boolean)
        : []
    ));
    if (ids.length === 0) {
      return NextResponse.json({ error: '缺少要删除的会话' }, { status: 400 });
    }
    if (ids.length > 200) {
      return NextResponse.json({ error: '一次最多删除 200 个会话' }, { status: 400 });
    }

    const deleted: string[] = [];
    const missing: string[] = [];
    const forbidden: string[] = [];
    for (const id of ids) {
      const existing = await loadChatSession(id);
      if (!existing) {
        missing.push(id);
        continue;
      }
      if (!isOwner(existing, user.id)) {
        forbidden.push(id);
        continue;
      }
      const ok = await deleteChatSession(id);
      if (ok) deleted.push(id);
      else missing.push(id);
    }

    return NextResponse.json({
      ok: forbidden.length === 0,
      deleted,
      deletedCount: deleted.length,
      missing,
      forbidden,
    }, { status: forbidden.length > 0 ? 207 : 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
