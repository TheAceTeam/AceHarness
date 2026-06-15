import { NextRequest, NextResponse } from 'next/server';
import { ensureCollaborationRoomChatSession } from '@/lib/collaboration/session-adapter';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await ensureCollaborationRoomChatSession({
      roomId,
      createdBy: typeof body?.createdBy === 'string' ? body.createdBy : undefined,
      visibility: body?.visibility === 'private' ? 'private' : 'public',
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建协作会话失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
