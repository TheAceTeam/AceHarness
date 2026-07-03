import { appendChatSessionMessage, loadChatSession } from '@/lib/chat/persistence';
import { getChannelIntegration, listChannelBindings } from '@/lib/channel/store';
import { sendWeChatOfficialText } from '@/lib/channel/wechat/official-client';

async function resolveWeChatDeliveryTarget(frontendSessionId: string): Promise<{
  accountId: string;
  userId: string;
} | null> {
  const session = await loadChatSession(frontendSessionId).catch(() => null);
  const wechatBinding = session?.sessionWorkbenchState?.wechatBinding;
  const bindings = await listChannelBindings().catch(() => []);
  const binding = bindings.find((item) =>
    item.frontendSessionId === frontendSessionId
    && (!wechatBinding?.integrationId || item.integrationId === wechatBinding.integrationId)
    && (!wechatBinding?.externalConversationId || item.externalConversationId === wechatBinding.externalConversationId)
  ) || bindings.find((item) => item.id === wechatBinding?.bindingId);
  const integrationId = wechatBinding?.integrationId || binding?.integrationId;
  if (!integrationId) return null;

  const integration = await getChannelIntegration(integrationId).catch(() => null);
  if (!integration || !integration.enabled || integration.provider !== 'wechat-bridge') return null;

  const accountId = wechatBinding?.accountId
    || (typeof integration.providerConfig?.wechatOfficialAccountId === 'string' ? integration.providerConfig.wechatOfficialAccountId : '');
  const userId = binding?.externalUserId || binding?.externalConversationId || wechatBinding?.externalConversationId;
  if (!accountId) return null;
  if (!userId) return null;

  return {
    accountId,
    userId,
  };
}

export async function sendWeChatNotificationToFrontendSession(input: {
  frontendSessionId?: string | null;
  text: string;
  syncToChat?: boolean;
  sourceLabel?: string;
  dedupeKey?: string;
}): Promise<{ ok: boolean; reason?: string; text?: string }> {
  const frontendSessionId = String(input.frontendSessionId || '').trim();
  if (!frontendSessionId) return { ok: false, reason: 'missing-frontend-session' };

  const target = await resolveWeChatDeliveryTarget(frontendSessionId);
  if (!target) return { ok: false, reason: 'wechat-binding-not-found' };

  const result = await sendWeChatOfficialText({
    accountId: target.accountId,
    userId: target.userId,
  text: input.text,
  }).catch((error: any) => ({ ok: false, error: error?.message || String(error) }));

  if (!result?.ok) {
    return { ok: false, reason: result?.error || 'send-failed' };
  }

  const deliveredText = 'text' in result && typeof result.text === 'string'
    ? result.text
    : input.text;

  if (input.syncToChat !== false) {
    await appendChatSessionMessage(frontendSessionId, {
      role: 'assistant',
      content: deliveredText,
      source: {
        type: 'wechat',
        label: input.sourceLabel || '微信提醒',
        direction: 'outbound',
      },
    }, {
      dedupeKey: input.dedupeKey || `wechat-notify:${frontendSessionId}:${deliveredText}`,
    }).catch(() => {});
  }

  return { ok: true, text: deliveredText };
}
