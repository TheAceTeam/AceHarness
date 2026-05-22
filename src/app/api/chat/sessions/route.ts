import { NextRequest, NextResponse } from 'next/server';
import { listChatSessions, saveChatSession } from '@/lib/chat/persistence';
import { requireAuth } from '@/lib/auth/middleware';

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
    const now = Date.now();
    const messages = Array.isArray(body.messages)
      ? body.messages.map((message: any, index: number) => ({
          id: typeof message?.id === 'string' ? message.id : `${now}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          role: message?.role === 'assistant' || message?.role === 'error' ? message.role : 'user',
          content: typeof message?.content === 'string' ? message.content : '',
          rawContent: typeof message?.rawContent === 'string' ? message.rawContent : undefined,
          source: message?.source,
          actions: Array.isArray(message?.actions) ? message.actions : undefined,
          cards: Array.isArray(message?.cards) ? message.cards : undefined,
          engine: typeof message?.engine === 'string' ? message.engine : undefined,
          model: typeof message?.model === 'string' ? message.model : undefined,
          timestamp: typeof message?.timestamp === 'number' ? message.timestamp : now + index,
        })).filter((message: any) => message.content || message.cards?.length)
      : [];
    const session = {
      id: body.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: body.title || '新对话',
      model: body.model || 'claude-sonnet-4-6',
      engine: typeof body.engine === 'string' ? body.engine : undefined,
      workflowBinding: body.workflowBinding && typeof body.workflowBinding.configFile === 'string' && typeof body.workflowBinding.runId === 'string'
        ? {
            configFile: body.workflowBinding.configFile,
            runId: body.workflowBinding.runId,
            supervisorAgent: typeof body.workflowBinding.supervisorAgent === 'string' ? body.workflowBinding.supervisorAgent : undefined,
            supervisorSessionId: typeof body.workflowBinding.supervisorSessionId === 'string' ? body.workflowBinding.supervisorSessionId : null,
            attachedAgentSessions: body.workflowBinding.attachedAgentSessions && typeof body.workflowBinding.attachedAgentSessions === 'object'
              ? body.workflowBinding.attachedAgentSessions
              : {},
            createdAt: typeof body.workflowBinding.createdAt === 'number' ? body.workflowBinding.createdAt : now,
            updatedAt: typeof body.workflowBinding.updatedAt === 'number' ? body.workflowBinding.updatedAt : now,
          }
        : undefined,
      creationSession: body.creationSession && typeof body.creationSession.creationSessionId === 'string'
        ? {
            creationSessionId: body.creationSession.creationSessionId,
            filename: body.creationSession.filename,
            workflowName: body.creationSession.workflowName,
            status: body.creationSession.status,
            specCodingId: body.creationSession.specCodingId,
            createdAt: typeof body.creationSession.createdAt === 'number' ? body.creationSession.createdAt : now,
            updatedAt: typeof body.creationSession.updatedAt === 'number' ? body.creationSession.updatedAt : now,
          }
        : undefined,
      agentBinding: body.agentBinding && typeof body.agentBinding.agentName === 'string'
        ? {
            agentName: body.agentBinding.agentName,
            team: typeof body.agentBinding.team === 'string' ? body.agentBinding.team : undefined,
            roleType: typeof body.agentBinding.roleType === 'string' ? body.agentBinding.roleType : undefined,
            createdAt: now,
            updatedAt: now,
          }
        : undefined,
      sessionWorkbenchState: body.sessionWorkbenchState && typeof body.sessionWorkbenchState === 'object'
        ? body.sessionWorkbenchState
        : undefined,
      createdAt: now,
      updatedAt: now,
      messages,
      createdBy: user.id,
      visibility: (body.visibility as 'public' | 'private') || 'public',
    };
    await saveChatSession(session);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
