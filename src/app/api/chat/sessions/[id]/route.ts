import { NextRequest, NextResponse } from 'next/server';
import { loadChatSession, saveChatSession, deleteChatSession } from '@/lib/chat/persistence';
import { requireAuth } from '@/lib/auth/middleware';

function isOwner(session: any, userId: string): boolean {
  // Backward compatibility: legacy sessions without createdBy are treated as shared.
  if (!session) return false;
  if (!session.createdBy) return true;
  return session.createdBy === userId;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const session = await loadChatSession(id);
    if (!session) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    if (!isOwner(session, user.id)) {
      return NextResponse.json({ error: '无权访问该会话' }, { status: 403 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const existing = await loadChatSession(id);
    if (!existing) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    if (!isOwner(existing, user.id)) {
      return NextResponse.json({ error: '无权修改该会话' }, { status: 403 });
    }
    const body = await req.json();
    const session = { ...body, id, createdBy: existing.createdBy, updatedAt: Date.now() };
    await saveChatSession(session);
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const existing = await loadChatSession(id);
    if (!existing) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    if (!isOwner(existing, user.id)) {
      return NextResponse.json({ error: '无权删除该会话' }, { status: 403 });
    }
    const deleted = await deleteChatSession(id);
    if (!deleted) {
      return NextResponse.json({ error: '会话不存在' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
