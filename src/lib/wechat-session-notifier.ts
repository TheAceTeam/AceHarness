import { appendChatSessionMessage, loadChatSession } from '@/lib/chat-persistence';
import { getChannelIntegration, listChannelBindings } from '@/lib/channel-store';
import { sendWeChatOfficialText } from '@/lib/wechat-official-client';

async function resolveWeChatDeliveryTarget(frontendSessionId: string): Promise<{
  accountId: string;
  userId: string;
} | null> {
  const session = await loadChatSession(frontendSessionId).catch(() => null);
  const wechatBinding = session?.sessionWorkbenchState?.wechatBinding;
  if (!wechatBinding?.integrationId || !wechatBinding?.accountId) return null;

  const integration = await getChannelIntegration(wechatBinding.integrationId).catch(() => null);
  if (!integration || !integration.enabled || integration.provider !== 'wechat-bridge') return null;

  const bindings = await listChannelBindings().catch(() => []);
  const binding = bindings.find((item) =>
    item.id === wechatBinding.bindingId
    || (
      item.frontendSessionId === frontendSessionId
      && item.integrationId === wechatBinding.integrationId
      && item.externalConversationId === wechatBinding.externalConversationId
    )
  );
  const userId = binding?.externalUserId || binding?.externalConversationId;
  if (!userId) return null;

  return {
    accountId: wechatBinding.accountId,
    userId,
  };
}

export async function sendWeChatNotificationToFrontendSession(input: {
  frontendSessionId?: string | null;
  text: string;
  syncToChat?: boolean;
  sourceLabel?: string;
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
      dedupeKey: `wechat-notify:${frontendSessionId}:${deliveredText}`,
    }).catch(() => {});
  }

  return { ok: true, text: deliveredText };
}
