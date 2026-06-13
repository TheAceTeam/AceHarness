import { NextRequest, NextResponse } from 'next/server';
import { listCollaborationMembers } from '@/lib/collaboration/members';

export async function GET(request: NextRequest) {
  try {
    const spaceType = request.nextUrl.searchParams.get('spaceType') || 'meeting-room';
    const members = await listCollaborationMembers({ spaceType });
    return NextResponse.json({ members });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取协作空间成员失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
