import { NextRequest, NextResponse } from 'next/server';
import { listChatSessions, saveChatSession } from '@/lib/chat-persistence';
import { requireAuth } from '@/lib/auth-middleware';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  try {
    const allSessions = await listChatSessions();
    // Backward compatibility: legacy sessions without createdBy are visible to everyone.
    // New sessions always include createdBy and are isolated by user.
    const sessions = allSessions.filter(s => !s.createdBy || s.createdBy === user.id);
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  try {
    const body = await request.json();
    const session = {
      id: body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: body.title || '新对话',
      model: body.model || 'claude-sonnet-4-6',
      engine: typeof body.engine === 'string' ? body.engine : undefined,
      agentBinding: body.agentBinding && typeof body.agentBinding.agentName === 'string'
        ? {
            agentName: body.agentBinding.agentName,
            team: typeof body.agentBinding.team === 'string' ? body.agentBinding.team : undefined,
            roleType: typeof body.agentBinding.roleType === 'string' ? body.agentBinding.roleType : undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        : undefined,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      createdBy: user.id,
      visibility: (body.visibility as 'public' | 'private') || 'public',
    };
    await saveChatSession(session);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
