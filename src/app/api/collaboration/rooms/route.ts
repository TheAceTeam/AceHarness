import { NextRequest, NextResponse } from 'next/server';
import { listCollaborationRooms } from '@/lib/collaboration/rooms';

export async function GET(request: NextRequest) {
  try {
    const rooms = await listCollaborationRooms({
      spaceType: request.nextUrl.searchParams.get('spaceType') || undefined,
      roomType: request.nextUrl.searchParams.get('roomType') || undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
    });
    return NextResponse.json({ rooms });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取协作房间失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
