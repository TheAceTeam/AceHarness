import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { getChannelIntegration } from '@/lib/channel-store';
import { rememberWeChatOfficialBridge, startWeChatOfficialBridge } from '@/lib/wechat-official-service';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json().catch(() => ({}));
    const integrationId = String(body?.integrationId || '');
    const accountId = String(body?.accountId || '');
    if (!integrationId || !accountId) {
      return NextResponse.json({ error: '缺少 integrationId 或 accountId' }, { status: 400 });
    }

    const integration = await getChannelIntegration(integrationId);
    if (!integration || integration.createdBy !== user.id) {
      return NextResponse.json({ error: '微信接入点不存在' }, { status: 404 });
    }
    if (!integration.secret || !integration.webhookPath) {
      return NextResponse.json({ error: '当前接入点缺少 webhook 或 secret，请重新生成接入点' }, { status: 400 });
    }

    const runtime = await startWeChatOfficialBridge({
      accountId,
      integrationId,
      webhookUrl: `${request.nextUrl.origin}${integration.webhookPath}`,
      secret: integration.secret,
      createdBy: user.id,
    });
    const rememberedIntegration = await rememberWeChatOfficialBridge({
      integration,
      accountId,
      origin: request.nextUrl.origin,
    });
    return NextResponse.json({ runtime, integration: rememberedIntegration });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '启动微信桥接失败' }, { status: 500 });
  }
}
