import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createWeChatOfficialLoginSession } from '@/lib/channel/wechat/official-service';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const session = await createWeChatOfficialLoginSession({ createdBy: user.id });
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '创建微信扫码会话失败' }, { status: 500 });
  }
}
