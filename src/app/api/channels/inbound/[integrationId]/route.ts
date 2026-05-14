import { NextRequest, NextResponse } from 'next/server';
import { handleChannelInbound } from '@/lib/channel/gateway';

export async function POST(request: NextRequest, { params }: { params: Promise<{ integrationId: string }> }) {
  try {
    const { integrationId } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await handleChannelInbound(integrationId, body, request.headers.get('x-ace-channel-secret'));
    if ('challenge' in result) {
      return NextResponse.json({ challenge: result.challenge });
    }
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '处理渠道消息失败' }, { status: 400 });
  }
}
