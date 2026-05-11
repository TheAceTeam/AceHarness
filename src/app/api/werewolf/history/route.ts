import { NextRequest, NextResponse } from 'next/server';
import { appendWerewolfHistory, listWerewolfHistory } from '@/lib/werewolf-history-store';

export async function GET(request: NextRequest) {
  try {
    const limit = Math.max(1, Math.min(20, Number(request.nextUrl.searchParams.get('limit') || 8)));
    const entries = await listWerewolfHistory(limit);
    return NextResponse.json({ entries });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取历史对局记忆失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await appendWerewolfHistory(body);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '写入历史对局记忆失败' }, { status: 500 });
  }
}
