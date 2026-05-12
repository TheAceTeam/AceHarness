import { getChannelIntegration, listChannelBindings, type ChannelIntegration, type ChannelSessionBinding } from '@/lib/channel-store';
import { workflowRegistry } from '@/lib/workflow-registry';

export interface OutboundChannelMessage {
  text: string;
  title?: string;
  binding?: ChannelSessionBinding | null;
  metadata?: Record<string, any>;
  messages?: Array<{
    kind: 'text' | 'roundtable-message' | 'roundtable-summary' | 'system';
    speakerType?: 'human' | 'agent' | 'supervisor' | 'system';
    speakerName?: string;
    text: string;
  }>;
}

function resolveOutboundUrl(integration: ChannelIntegration): string {
  const config = integration.providerConfig || {};
  if (typeof config.outboundWebhookUrl === 'string' && config.outboundWebhookUrl.trim()) return config.outboundWebhookUrl.trim();
  if (typeof config.botWebhookUrl === 'string' && config.botWebhookUrl.trim()) return config.botWebhookUrl.trim();
  if (typeof config.bridgeCallbackUrl === 'string' && config.bridgeCallbackUrl.trim()) return config.bridgeCallbackUrl.trim();
  return '';
}

function buildProviderPayload(integration: ChannelIntegration, input: OutboundChannelMessage): any {
  const text = input.title ? `${input.title}\n${input.text}` : input.text;
  const messages = input.messages?.length
    ? input.messages
    : [{ kind: 'text' as const, text }];
  if (integration.provider === 'feishu-webhook') {
    return {
      msg_type: 'text',
      content: {
        text,
      },
    };
  }
  if (integration.provider === 'dingtalk-webhook') {
    return {
      msgtype: 'text',
      text: {
        content: text,
      },
    };
  }
  return {
    secret: integration.secret,
    type: 'channel-outbound',
    conversationId: input.binding?.externalConversationId,
    text,
    messages,
    metadata: input.metadata || {},
  };
}

export async function sendOutboundChannelMessage(integration: ChannelIntegration, input: OutboundChannelMessage): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (
    integration.provider === 'wechat-bridge'
    && input.binding?.frontendSessionId
    && input.metadata?.eventType === 'human-question-required'
  ) {
    const { sendWeChatNotificationToFrontendSession } = await import('@/lib/wechat-session-notifier');
    const direct = await sendWeChatNotificationToFrontendSession({
      frontendSessionId: input.binding.frontendSessionId,
      text: input.title ? `${input.title}\n${input.text}` : input.text,
      sourceLabel: '微信审查提醒',
      syncToChat: true,
    });
    if (direct.ok) {
      return { ok: true, status: 200 };
    }
  }

  const url = resolveOutboundUrl(integration);
  if (!url) {
    return { ok: false, error: '未配置 outboundWebhookUrl / botWebhookUrl / bridgeCallbackUrl' };
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildProviderPayload(integration, input)),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { ok: false, status: response.status, error: text || `HTTP ${response.status}` };
    }
    return { ok: true, status: response.status };
  } catch (error: any) {
    return { ok: false, error: error?.message || '发送失败' };
  }
}

function formatWorkflowEvent(type: string, data: any): { title: string; text: string } | null {
  if (type === 'human-question-required' && data?.question) {
    return {
      title: `等待人工回复：${data.question.title || 'Human Question'}`,
      text: `${data.question.message || ''}\n\nquestionId: ${data.question.id || ''}`.trim(),
    };
  }
  if (type === 'state-change') {
    return {
      title: 'Workflow 状态变化',
      text: [data?.state ? `状态：${data.state}` : '', data?.message || ''].filter(Boolean).join('\n'),
    };
  }
  if (type === 'step-complete') {
    return {
      title: '步骤完成',
      text: [data?.state ? `状态：${data.state}` : '', data?.step ? `步骤：${data.step}` : '', data?.summary || ''].filter(Boolean).join('\n'),
    };
  }
  if (type === 'transition') {
    return {
      title: 'Workflow 转移',
      text: [data?.from ? `From：${data.from}` : '', data?.to ? `To：${data.to}` : '', data?.reason || ''].filter(Boolean).join('\n'),
    };
  }
  if (type === 'feedback-injected') {
    return {
      title: '反馈已注入',
      text: data?.message || '',
    };
  }
  return null;
}

let bridgeRegistered = false;

export function ensureChannelEventBridgeRegistered(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;

  const eventTypes = ['human-question-required', 'state-change', 'step-complete', 'transition', 'feedback-injected'];
  for (const type of eventTypes) {
    workflowRegistry.on(type, async (payload: any) => {
      const formatted = formatWorkflowEvent(type, payload);
      if (!formatted) return;
      const bindings = await listChannelBindings().catch(() => []);
      const configFile = payload?.__configFile || payload?.currentConfigFile || payload?.configFile || '';
      const runId = payload?.runId || payload?.question?.runId || '';
      const targets = bindings.filter((binding) => (
        binding.bindingType === 'workflow-run'
        && ((runId && binding.runId === runId) || (configFile && binding.configFile === configFile))
      ));
      for (const binding of targets) {
        const integration = await getChannelIntegration(binding.integrationId).catch(() => null);
        if (!integration || !integration.enabled) continue;
        void sendOutboundChannelMessage(integration, {
          title: formatted.title,
          text: formatted.text,
          binding,
          metadata: { eventType: type, configFile, runId },
        });
      }
    });
  }
}
