import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { getChannelIntegration } from '@/lib/channel/store';
import { rememberWeChatOfficialBridge, startWeChatOfficialBridge } from '@/lib/channel/wechat/official-service';

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const integrationId = String(body?.integrationId || '');
    const accountId = String(body?.accountId || '');
    if (!integrationId || !accountId) {
      return jsonError('缺少 integrationId 或 accountId', 400);
    }

    const integration = await getChannelIntegration(integrationId);
    if (!integration || integration.createdBy !== user.id) {
      return jsonError('微信接入点不存在', 404);
    }
    if (!integration.secret || !integration.webhookPath) {
      return jsonError('当前接入点缺少 webhook 或 secret，请重新生成接入点', 400);
    }

    const runtime = await startWeChatOfficialBridge({
      accountId,
      integrationId,
      webhookUrl: `${requestUrl(request).origin}${integration.webhookPath}`,
      secret: integration.secret,
      createdBy: user.id,
    });
    const rememberedIntegration = await rememberWeChatOfficialBridge({
      integration,
      accountId,
      origin: requestUrl(request).origin,
    });
    return jsonOk({ runtime, integration: rememberedIntegration });
  } catch (error) {
    return jsonError(errorMessage(error) || '启动微信桥接失败', 500);
  }
}
