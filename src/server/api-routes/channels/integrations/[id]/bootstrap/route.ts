import { requireAuth } from '@/lib/auth/middleware';
import { getChannelIntegration, listChannelBindings } from '@/lib/channel/store';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  const { id } = await params;
  const integration = await getChannelIntegration(id);
  if (!integration || integration.createdBy !== user.id) {
    return jsonError('渠道集成不存在', 404);
  }

  const bindings = (await listChannelBindings()).filter((item) => item.integrationId === integration.id);

  return jsonOk({
    integration,
    protocol: {
      version: 'aceharness-wechat-bridge/v1',
      inbound: {
        url: integration.webhookPath,
        secretHeader: 'x-ace-channel-secret',
        acceptedSecretFields: ['secret', 'token', 'sharedSecret'],
        payloadShape: {
          secret: integration.secret,
          message: {
            conversationId: 'wechat-room-001',
            conversationName: '微信测试群',
            userId: 'wx-user-001',
            userName: 'Alice',
            messageId: 'msg-001',
            text: '/status',
            mentions: ['default-supervisor'],
          },
        },
      },
      response: {
        ok: true,
        replies: ['default-supervisor: 当前状态正常'],
        replyMessages: [
          {
            kind: 'text',
            text: '当前状态正常',
          },
        ],
      },
      outbound: {
        callbackUrl: integration.providerConfig?.outboundWebhookUrl || integration.providerConfig?.bridgeCallbackUrl || '',
        payloadShape: {
          secret: integration.secret,
          type: 'channel-outbound',
          conversationId: 'wechat-room-001',
          messages: [
            {
              kind: 'text',
              text: '建议先收敛接口范围。',
            },
          ],
          metadata: {
            eventType: 'transition',
          },
        },
      },
    },
    bindings,
  });
}
