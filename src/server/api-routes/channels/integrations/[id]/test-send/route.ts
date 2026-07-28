import { requireAuth } from '@/lib/auth/middleware';
import { getChannelIntegration, listChannelBindings } from '@/lib/channel/store';
import { sendOutboundChannelMessage } from '@/lib/channel/delivery';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  try {
    const { id } = await params;
    const integration = await getChannelIntegration(id);
    if (!integration || integration.createdBy !== user.id) {
      return jsonError('渠道集成不存在', 404);
    }
    const body = await readJsonBody<Record<string, any>>(request, {});
    const bindings = await listChannelBindings();
    const binding = typeof body?.bindingId === 'string'
      ? bindings.find((item) => item.id === body.bindingId && item.integrationId === integration.id) || null
      : bindings.find((item) => item.integrationId === integration.id) || null;
    const text = String(body?.text || 'CSIHarness 渠道测试消息').trim();
    const result = await sendOutboundChannelMessage(integration, {
      title: '渠道联通测试',
      text,
      binding,
      metadata: { type: 'manual-test' },
    });
    if (!result.ok) {
      return jsonOk({ error: result.error || '发送失败', status: result.status }, { status: 400 });
    }
    return jsonOk({ success: true, status: result.status });
  } catch (error) {
    return jsonError(errorMessage(error) || '测试发送失败', 500);
  }
}
