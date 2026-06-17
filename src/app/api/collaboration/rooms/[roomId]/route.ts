import { NextResponse } from 'next/server';
import { getCollaborationRoom } from '@/lib/collaboration/rooms';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const room = await getCollaborationRoom(roomId);
    if (!room) return NextResponse.json({ error: '房间不存在' }, { status: 404 });
    return NextResponse.json({ room });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取协作房间失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
