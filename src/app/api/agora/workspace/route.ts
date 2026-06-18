import { NextRequest, NextResponse } from 'next/server';
import { ensureAgoraWorkspace } from '@/lib/agora/workspace-store';

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
      title: typeof body?.title === 'string' ? body.title : undefined,
      skills: Array.isArray(body?.skills) || (body?.skills && typeof body.skills === 'object') ? body.skills : undefined,
      mcpServers: Array.isArray(body?.mcpServers) || (body?.mcpServers && typeof body.mcpServers === 'object') ? body.mcpServers : undefined,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '准备议场工作区失败' },
      { status: 500 },
    );
  }
}
