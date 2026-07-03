import { getChannelIntegration, listChannelBindings, type ChannelIntegration, type ChannelSessionBinding } from '@/lib/channel/store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { sendHumanReviewEmailNotification } from '@/lib/notify/human-review-email';
import { loadRunState } from '@/lib/run/state-persistence';

export interface OutboundChannelMessage {
  text: string;
  title?: string;
  binding?: ChannelSessionBinding | null;
  dedupeKey?: string;
  metadata?: Record<string, any>;
  messages?: Array<{
    kind: 'text' | 'system';
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
    && (input.metadata?.eventType === 'human-question-required' || input.metadata?.eventType === 'human-approval-required')
  ) {
    const { sendWeChatNotificationToFrontendSession } = await import('@/lib/channel/wechat/session-notifier');
    const direct = await sendWeChatNotificationToFrontendSession({
      frontendSessionId: input.binding.frontendSessionId,
      text: input.title ? `${input.title}\n${input.text}` : input.text,
      sourceLabel: '微信审查提醒',
      syncToChat: true,
      dedupeKey: input.dedupeKey,
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

function normalizeNotificationText(value: unknown, maxChars = 1800): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  const text = raw
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}\n\n...`;
}

function formatHumanApprovalAdvice(advice: unknown): string {
  const text = normalizeNotificationText(advice, 1400);
  if (!text) return '';
  return ['Supervisor 建议：', text].join('\n');
}

function formatWorkflowEvent(type: string, data: any): { title: string; text: string } | null {
  if (type === 'human-question-required' && data?.question) {
    return {
      title: `等待人工回复：${data.question.title || 'Human Question'}`,
      text: `${data.question.message || ''}\n\nquestionId: ${data.question.id || ''}`.trim(),
    };
  }
  if (type === 'human-approval-required') {
    const suggested = data?.suggestedNextState || data?.nextState || '';
    const current = data?.currentState || '__human_approval__';
    const availableStates = Array.isArray(data?.availableStates) && data.availableStates.length
      ? `可选状态：\n${data.availableStates.map((state: string) => `- ${state}`).join('\n')}`
      : '';
    const advice = data?.supervisorAdvice ? formatHumanApprovalAdvice(data.supervisorAdvice) : '';
    const questionId = data?.humanQuestion?.id ? `questionId: ${data.humanQuestion.id}` : '';
    return {
      title: '等待人工审查',
      text: [
        `当前状态：${current}`,
        suggested ? `建议进入：${suggested}` : '',
        availableStates,
        advice,
        questionId,
        '微信可回复：',
        '/approve 批准',
        '/iterate <反馈> 要求继续迭代',
      ].filter(Boolean).join('\n\n'),
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

const HUMAN_WAITING_EVENT_TYPES = new Set(['human-question-required', 'human-approval-required']);
const deliveredWorkflowEventKeys = new Map<string, number>();
const WORKFLOW_EVENT_DEDUPE_TTL_MS = 2 * 60 * 1000;

async function resolveWorkflowEventOwnerId(payload: any, runId: string): Promise<string> {
  const direct = payload?.runOwnerId
    || payload?.createdBy
    || payload?.question?.runOwnerId
    || payload?.question?.createdBy
    || payload?.humanQuestion?.runOwnerId
    || payload?.humanQuestion?.createdBy;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  if (!runId) return '';
  const state = await loadRunState(runId).catch(() => null);
  const persisted = state?.runOwnerId || state?.createdBy;
  return typeof persisted === 'string' ? persisted.trim() : '';
}

function getWorkflowRunTargets(bindings: ChannelSessionBinding[], runId: string, configFile: string): ChannelSessionBinding[] {
  return bindings.filter((binding) => (
    binding.bindingType === 'workflow-run'
    && ((runId && binding.runId === runId) || (configFile && binding.configFile === configFile))
  ));
}

function getHomeSessionFallbackTargets(bindings: ChannelSessionBinding[], ownerId: string): ChannelSessionBinding[] {
  if (!ownerId) return [];
  const candidates = bindings
    .filter((binding) => (
      binding.bindingType === 'agent-chat'
      && binding.createdBy === ownerId
      && Boolean(binding.frontendSessionId)
      && binding.metadata?.source === 'home-session-bind'
    ))
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

  const seenIntegrations = new Set<string>();
  return candidates.filter((binding) => {
    if (seenIntegrations.has(binding.integrationId)) return false;
    seenIntegrations.add(binding.integrationId);
    return true;
  });
}

function getWorkflowEventIds(type: string, payload: any): { configFile: string; runId: string; questionId: string } {
  return {
    configFile: payload?.__configFile
      || payload?.currentConfigFile
      || payload?.configFile
      || payload?.question?.configFile
      || payload?.question?.sourceConfigFile
      || payload?.humanQuestion?.configFile
      || payload?.humanQuestion?.sourceConfigFile
      || '',
    runId: payload?.runId
      || payload?.question?.runId
      || payload?.question?.sourceRunId
      || payload?.humanQuestion?.runId
      || payload?.humanQuestion?.sourceRunId
      || '',
    questionId: payload?.question?.id || payload?.humanQuestion?.id || payload?.pendingHumanQuestion?.id || '',
  };
}

function shouldDeliverWorkflowEvent(type: string, ids: { configFile: string; runId: string; questionId: string }): boolean {
  const now = Date.now();
  for (const [key, timestamp] of deliveredWorkflowEventKeys) {
    if (now - timestamp > WORKFLOW_EVENT_DEDUPE_TTL_MS) deliveredWorkflowEventKeys.delete(key);
  }
  if (!HUMAN_WAITING_EVENT_TYPES.has(type)) return true;
  const key = `${type}:${ids.runId || ids.configFile}:${ids.questionId || 'no-question'}`;
  const last = deliveredWorkflowEventKeys.get(key);
  if (last && now - last <= WORKFLOW_EVENT_DEDUPE_TTL_MS) return false;
  deliveredWorkflowEventKeys.set(key, now);
  return true;
}

function getWorkflowDeliveryDedupeKey(type: string, ids: { configFile: string; runId: string; questionId: string }, binding: ChannelSessionBinding): string {
  return [
    'workflow-event',
    type,
    ids.runId || ids.configFile || 'unknown-run',
    ids.questionId || 'no-question',
    binding.id || binding.frontendSessionId || binding.externalConversationId || 'unknown-target',
  ].join(':');
}

export async function deliverWorkflowEventToChannels(type: string, payload: any): Promise<void> {
  const formatted = formatWorkflowEvent(type, payload);
  if (!formatted) return;
  if (type === 'human-question-required' && payload?.question) {
    void sendHumanReviewEmailNotification(payload.question).catch(() => {});
  }
  const ids = getWorkflowEventIds(type, payload);
  if (!shouldDeliverWorkflowEvent(type, ids)) return;
  const bindings = await listChannelBindings().catch(() => []);
  const workflowTargets = getWorkflowRunTargets(bindings, ids.runId, ids.configFile);
  const ownerId = HUMAN_WAITING_EVENT_TYPES.has(type) && workflowTargets.length === 0
    ? await resolveWorkflowEventOwnerId(payload, ids.runId)
    : '';
  const targets = workflowTargets.length > 0
    ? workflowTargets
    : getHomeSessionFallbackTargets(bindings, ownerId);
  for (const binding of targets) {
    const integration = await getChannelIntegration(binding.integrationId).catch(() => null);
    if (!integration || !integration.enabled) continue;
    if (binding.bindingType === 'agent-chat' && integration.provider !== 'wechat-bridge') continue;
    void sendOutboundChannelMessage(integration, {
      title: formatted.title,
      text: formatted.text,
      binding,
      dedupeKey: getWorkflowDeliveryDedupeKey(type, ids, binding),
      metadata: {
        eventType: type,
        configFile: ids.configFile,
        runId: ids.runId,
        ...(binding.bindingType === 'agent-chat' ? { fallbackTarget: 'home-session-bind', ownerId } : {}),
      },
    });
  }
}

export function ensureChannelEventBridgeRegistered(): void {
  if (bridgeRegistered) return;
  bridgeRegistered = true;

  const eventTypes = ['human-question-required', 'human-approval-required', 'state-change', 'step-complete', 'transition', 'feedback-injected'];
  for (const type of eventTypes) {
    workflowRegistry.on(type, async (payload: any) => {
      void deliverWorkflowEventToChannels(type, payload);
    });
  }
}
