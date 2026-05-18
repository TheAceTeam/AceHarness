import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getWeChatOfficialLoginSession } from '@/lib/channel/wechat/official-service';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const session = await getWeChatOfficialLoginSession(id, { createdBy: user.id });
    if (!session) {
      return NextResponse.json({ error: '扫码会话不存在或已过期' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取微信扫码状态失败' }, { status: 500 });
  }
}
