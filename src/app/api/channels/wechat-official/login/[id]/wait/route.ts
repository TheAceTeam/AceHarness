import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { waitForWeChatOfficialLogin } from '@/lib/wechat-official-service';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { id } = await params;
    const timeoutRaw = request.nextUrl.searchParams.get('timeoutMs');
    const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
    const session = await waitForWeChatOfficialLogin(
      id,
      Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      { createdBy: user.id },
    );
    if (!session) {
      return NextResponse.json({ error: '扫码会话不存在或已过期' }, { status: 404 });
    }
    return NextResponse.json({ session });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '等待微信扫码确认失败' }, { status: 500 });
  }
}
