import { NextRequest, NextResponse } from 'next/server';
import { addRoomParticipants } from '@/lib/collaboration/rooms';
import { syncCollaborationRoomChatSession } from '@/lib/collaboration/session-adapter';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const body = await request.json();
    const agentNames = Array.isArray(body?.agentNames)
      ? body.agentNames
      : [body?.agentName];
    const room = await addRoomParticipants({ roomId, agentNames });
    const session = await syncCollaborationRoomChatSession(room);
    return NextResponse.json({ success: true, room, session });
  } catch (error: any) {
    return NextResponse.json(
      { error: '添加协作成员失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
