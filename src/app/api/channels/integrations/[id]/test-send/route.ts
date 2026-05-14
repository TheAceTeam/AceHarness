import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getChannelIntegration, listChannelBindings } from '@/lib/channel/store';
import { sendOutboundChannelMessage } from '@/lib/channel/delivery';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const integration = await getChannelIntegration(id);
    if (!integration || integration.createdBy !== user.id) {
      return NextResponse.json({ error: '渠道集成不存在' }, { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const bindings = await listChannelBindings();
    const binding = typeof body?.bindingId === 'string'
      ? bindings.find((item) => item.id === body.bindingId && item.integrationId === integration.id) || null
      : bindings.find((item) => item.integrationId === integration.id) || null;
    const text = String(body?.text || 'ACEHarness 渠道测试消息').trim();
    const result = await sendOutboundChannelMessage(integration, {
      title: '渠道联通测试',
      text,
      binding,
      metadata: { type: 'manual-test' },
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error || '发送失败', status: result.status }, { status: 400 });
    }
    return NextResponse.json({ success: true, status: result.status });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '测试发送失败' }, { status: 500 });
  }
}
