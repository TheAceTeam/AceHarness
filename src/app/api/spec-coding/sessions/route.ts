import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { buildCreationSession, listCreationSessions, saveCreationSession } from '@/lib/spec-coding-store';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const chatSessionId = searchParams.get('chatSessionId') || undefined;
    const sessions = await listCreationSessions({ chatSessionId, createdBy: auth.id });
    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '读取创建期会话失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const session = buildCreationSession({
      chatSessionId: body.chatSessionId,
      createdBy: auth.id,
      status: body.status,
      specCodingStatus: body.specCodingStatus,
      filename: body.filename,
      workflowName: body.workflowName,
      mode: body.mode,
      referenceWorkflow: body.referenceWorkflow,
      workingDirectory: body.workingDirectory,
      workspaceMode: body.workspaceMode,
      description: body.description,
      requirements: body.requirements,
      clarification: body.clarification,
      uiState: body.uiState,
      config: body.config,
      specCoding: body.specCoding,
    });
    await saveCreationSession(session);
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '创建创建期会话失败' }, { status: 500 });
  }
}
