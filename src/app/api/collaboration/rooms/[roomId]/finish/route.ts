import { NextResponse } from 'next/server';
import { finishCollaborationRoom } from '@/lib/collaboration/rooms';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const room = await finishCollaborationRoom(roomId);
    return NextResponse.json({ success: true, room });
  } catch (error: any) {
    return NextResponse.json(
      { error: '结束协作房间失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
