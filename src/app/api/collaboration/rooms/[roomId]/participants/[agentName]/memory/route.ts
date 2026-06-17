import { NextRequest, NextResponse } from 'next/server';
import { resolveCollaborationParticipantMemoryContext } from '@/lib/collaboration/memory-context';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string; agentName: string }> }
) {
  try {
    const { roomId, agentName } = await params;
    const context = await resolveCollaborationParticipantMemoryContext({
      roomId,
      agentName: decodeURIComponent(agentName),
      workingDirectory: request.nextUrl.searchParams.get('workingDirectory') || undefined,
    });
    return NextResponse.json({ context });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取协作成员记忆失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
