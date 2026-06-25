import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { ensureAgoraWorkspace, removeAgoraWorkspace } from '@/lib/agora/workspace-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sessionId = String(body?.sessionId || '').trim();
    if (!sessionId) {
      return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 });
    }
    const result = await ensureAgoraWorkspace({
      sessionId,
      sourceWorkspace: typeof body?.sourceWorkspace === 'string' ? body.sourceWorkspace : undefined,
      targetWorkspace: typeof body?.targetWorkspace === 'string' ? body.targetWorkspace : undefined,
      title: typeof body?.title === 'string' ? body.title : undefined,
      skills: Array.isArray(body?.skills) || (body?.skills && typeof body.skills === 'object') ? body.skills : undefined,
      mcpServers: Array.isArray(body?.mcpServers) || (body?.mcpServers && typeof body.mcpServers === 'object') ? body.mcpServers : undefined,
      purpose: body?.purpose === 'chat' ? 'chat' : 'agora',
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '准备议场工作区失败' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const sessionId = String(body?.sessionId || '').trim();
    const workspacePath = typeof body?.workspacePath === 'string' ? body.workspacePath.trim() : '';
    if (!sessionId) {
      return NextResponse.json({ error: '缺少 sessionId' }, { status: 400 });
    }
    if (!workspacePath) {
      return NextResponse.json({ error: '缺少 workspacePath' }, { status: 400 });
    }

    await removeAgoraWorkspace(sessionId, workspacePath);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '删除议场工作目录失败' },
      { status: /只能删除系统默认创建/.test(error?.message || '') ? 400 : 500 },
    );
  }
}
