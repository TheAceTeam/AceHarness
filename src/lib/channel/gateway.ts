import { randomUUID } from 'crypto';
import { getUserById } from '@/lib/core/user-store';
import { workflowRegistry, isStateMachineManagerLike } from '@/lib/workflow/registry';
import { findRunningRuns, loadRunState } from '@/lib/run/state-persistence';
import { createBindingFromDefault, findChannelBinding, getChannelIntegration, saveChannelBinding, type ChannelIntegration, type ChannelSessionBinding } from '@/lib/channel/store';
import { appendChatSessionMessage } from '@/lib/chat/persistence';
import { appendWorkflowAgoraMessage } from '@/lib/agora/workflow-topic';

export interface NormalizedChannelMessage {
  integrationId: string;
  externalConversationId: string;
  externalConversationName?: string;
  externalUserId: string;
  externalUserName?: string;
  externalMessageId?: string;
  text: string;
  mentions?: string[];
  raw?: any;
}

export interface ChannelGatewayReply {
  ok: boolean;
  binding?: ChannelSessionBinding | null;
  replies: string[];
  replyMessages?: Array<{
    kind: 'text' | 'system';
    speakerType?: 'human' | 'agent' | 'supervisor' | 'system';
    speakerName?: string;
    text: string;
  }>;
  metadata?: Record<string, any>;
}

type ChannelGatewayReplyMessage = NonNullable<ChannelGatewayReply['replyMessages']>[number];

function textReplies(replies: string[], kind: ChannelGatewayReplyMessage['kind'] = 'text'): ChannelGatewayReply['replyMessages'] {
  return replies.map((text) => ({ kind, text }));
}

function buildWechatReplyGuardrail(): string {
  return [
    '[微信渠道回复要求]',
    '- 你的回复将直接发送到微信。',
    '- 只允许输出纯文本。',
    '- 不要输出 Markdown。',
    '- 不要输出代码块，不要使用 ``` 包裹内容。',
    '- 不要输出 HTML 标签。',
    '- 不要输出 <result></result> 或任何 XML / HTML 风格标签。',
    '- 不要使用表格、标题、列表符号、引用块等富文本格式。',
    '- 如果需要给出代码、命令或路径，也要改写成普通纯文本描述。',
  ].join('\n');
}

function applyWechatReplyGuardrail(integration: ChannelIntegration, text: string): string {
  if (integration.provider !== 'wechat-bridge') return text;
  const trimmed = text.trim();
  if (!trimmed) return buildWechatReplyGuardrail();
  return `${trimmed}\n\n${buildWechatReplyGuardrail()}`;
}

function extractSharedSecret(body: any, headerSecret?: string | null): string {
  return String(headerSecret || body?.secret || body?.token || body?.sharedSecret || '').trim();
}

function normalizeTextContent(provider: string, body: any): string {
  if (body?.message?.text) return String(body.message.text);
  if (typeof body?.text === 'string') return body.text;
  if (provider === 'feishu-webhook') {
    const content = body?.event?.message?.content;
    if (typeof content === 'string') {
      try {
        const parsed = JSON.parse(content);
        if (typeof parsed?.text === 'string') return parsed.text;
      } catch {
        return content;
      }
    }
  }
  if (provider === 'dingtalk-webhook') {
    if (typeof body?.text?.content === 'string') return body.text.content;
    if (typeof body?.conversation?.text === 'string') return body.conversation.text;
  }
  return '';
}

export function normalizeInboundMessage(integration: ChannelIntegration, body: any): NormalizedChannelMessage | { challenge: string } {
  if (integration.provider === 'feishu-webhook' && typeof body?.challenge === 'string') {
    return { challenge: body.challenge };
  }

  if (body?.message && typeof body.message === 'object' && typeof body.message.conversationId === 'string') {
    return {
      integrationId: integration.id,
      externalConversationId: String(body.message.conversationId),
      externalConversationName: typeof body.message.conversationName === 'string' ? body.message.conversationName : undefined,
      externalUserId: String(body.message.userId || 'unknown'),
      externalUserName: typeof body.message.userName === 'string' ? body.message.userName : undefined,
      externalMessageId: typeof body.message.messageId === 'string' ? body.message.messageId : undefined,
      text: String(body.message.text || '').trim(),
      mentions: Array.isArray(body.message.mentions) ? body.message.mentions.filter((item: unknown): item is string => typeof item === 'string') : [],
      raw: body,
    };
  }

  if (integration.provider === 'feishu-webhook') {
    return {
      integrationId: integration.id,
      externalConversationId: String(body?.event?.message?.chat_id || body?.event?.open_chat_id || 'unknown'),
      externalConversationName: typeof body?.event?.chat_name === 'string' ? body.event.chat_name : undefined,
      externalUserId: String(body?.event?.sender?.sender_id?.open_id || body?.event?.sender?.sender_id?.user_id || 'unknown'),
      externalUserName: typeof body?.event?.sender?.sender_type === 'string' ? body.event.sender.sender_type : undefined,
      externalMessageId: typeof body?.event?.message?.message_id === 'string' ? body.event.message.message_id : undefined,
      text: normalizeTextContent(integration.provider, body).trim(),
      raw: body,
    };
  }

  if (integration.provider === 'dingtalk-webhook') {
    return {
      integrationId: integration.id,
      externalConversationId: String(body?.conversationId || body?.sessionWebhook || 'unknown'),
      externalConversationName: typeof body?.conversationTitle === 'string' ? body.conversationTitle : undefined,
      externalUserId: String(body?.senderStaffId || body?.senderId || 'unknown'),
      externalUserName: typeof body?.senderNick === 'string' ? body.senderNick : undefined,
      externalMessageId: typeof body?.msgId === 'string' ? body.msgId : undefined,
      text: normalizeTextContent(integration.provider, body).trim(),
      raw: body,
    };
  }

  return {
    integrationId: integration.id,
    externalConversationId: String(body?.conversationId || body?.chatId || body?.roomId || 'unknown'),
    externalConversationName: typeof body?.conversationName === 'string' ? body.conversationName : undefined,
    externalUserId: String(body?.userId || body?.senderId || 'unknown'),
    externalUserName: typeof body?.userName === 'string' ? body.userName : undefined,
    externalMessageId: typeof body?.messageId === 'string' ? body.messageId : undefined,
    text: normalizeTextContent(integration.provider, body).trim(),
    raw: body,
  };
}

async function resolveBinding(integration: ChannelIntegration, message: NormalizedChannelMessage): Promise<ChannelSessionBinding | null> {
  const existing = await findChannelBinding(integration.id, message.externalConversationId);
  if (existing) return existing;
  const { listChannelBindings } = await import('@/lib/channel/store');
  const pendingHomeBinding = (await listChannelBindings())
    .filter((item) =>
      item.integrationId === integration.id
      && item.createdBy === integration.createdBy
      && item.frontendSessionId
      && item.metadata?.source === 'home-session-bind'
      && item.externalConversationId !== message.externalConversationId
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (pendingHomeBinding) {
    return saveChannelBinding({
      ...pendingHomeBinding,
      externalConversationId: message.externalConversationId,
      externalConversationName: message.externalConversationName,
      externalUserId: message.externalUserId,
      metadata: {
        ...(pendingHomeBinding.metadata || {}),
        claimedAt: Date.now(),
        claimedConversationId: message.externalConversationId,
      },
    });
  }
  if (integration.bindingStrategy !== 'per-conversation-auto') return null;

  const fromDefault = await createBindingFromDefault({
    integration,
    createdBy: integration.createdBy,
    externalConversationId: message.externalConversationId,
    externalConversationName: message.externalConversationName,
    externalUserId: message.externalUserId,
  });
  if (fromDefault) return fromDefault;

  const runningManagers = workflowRegistry.getRunningManagers();
  let managerCandidate: { configFile: string; status: any } | null = null;
  for (const { configFile, manager } of runningManagers) {
    const status = manager.getStatus();
    const ownerId = status?.runOwnerId || status?.createdBy;
    if (ownerId && ownerId === integration.createdBy) {
      managerCandidate = { configFile, status };
      break;
    }
    if (status?.runId) {
      const persistedRun = await loadRunState(status.runId).catch(() => null);
      const persistedOwnerId = persistedRun?.runOwnerId || persistedRun?.createdBy;
      if (persistedOwnerId && persistedOwnerId === integration.createdBy) {
        managerCandidate = { configFile, status: { ...status, runId: persistedRun.runId } };
        break;
      }
    }
  }

  if (managerCandidate) {
    return saveChannelBinding({
      id: `binding-${randomUUID()}`,
      integrationId: integration.id,
      bindingType: 'workflow-run',
      createdBy: integration.createdBy,
      createdAt: Date.now(),
      externalConversationId: message.externalConversationId,
      externalConversationName: message.externalConversationName,
      externalUserId: message.externalUserId,
      configFile: managerCandidate.configFile,
      runId: managerCandidate.status?.runId,
      workflowMode: 'full-control',
    });
  }

  const runningRuns = await findRunningRuns();
  const persistedCandidate = runningRuns
    .filter((run) => {
      const ownerId = run.runOwnerId || run.createdBy;
      return ownerId && ownerId === integration.createdBy;
    })
    .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime))[0];

  if (!persistedCandidate?.configFile) return null;
  return saveChannelBinding({
    id: `binding-${randomUUID()}`,
    integrationId: integration.id,
    bindingType: 'workflow-run',
    createdBy: integration.createdBy,
    createdAt: Date.now(),
    externalConversationId: message.externalConversationId,
    externalConversationName: message.externalConversationName,
    externalUserId: message.externalUserId,
    configFile: persistedCandidate.configFile,
    runId: persistedCandidate.runId,
    workflowMode: 'full-control',
  });
}

function summarizeWorkflowStatus(status: any): string {
  const lines = [
    `状态：${status?.status || 'unknown'}`,
    status?.currentPhase ? `阶段：${status.currentPhase}` : '',
    status?.currentStep ? `步骤：${status.currentStep}` : '',
    status?.runId ? `Run ID：${status.runId}` : '',
    Array.isArray(status?.humanQuestions) && status.humanQuestions.length
      ? `待处理问题：${status.humanQuestions.filter((item: any) => item.status === 'unanswered').length}`
      : '',
  ].filter(Boolean);
  return lines.join('\n');
}

async function loadWorkflowStatus(binding: ChannelSessionBinding): Promise<any | null> {
  if (binding.runId) {
    const manager = await workflowRegistry.getManagerByRunId(binding.runId);
    if (manager?.getStatus?.()?.runId === binding.runId) return manager.getStatus();
    return loadRunState(binding.runId);
  }
  if (binding.configFile) {
    const manager = workflowRegistry.getRunningManager(binding.configFile);
    if (manager) return manager.getStatus();
  }
  return null;
}

function buildWorkflowContext(binding: ChannelSessionBinding, status: any) {
  return {
    configFile: binding.configFile || status?.currentConfigFile || '',
    runId: binding.runId || status?.runId || '',
    workflowName: status?.workflowName || binding.configFile || '',
    status: status?.status || '',
    currentPhase: status?.currentPhase || status?.currentState || '',
    currentStep: status?.currentStep || '',
    supervisorAgent: status?.supervisorAgent || 'default-supervisor',
    supervisorSessionId: status?.supervisorSessionId || null,
    latestSupervisorReview: status?.latestSupervisorReview || null,
    specCodingSummary: status?.specCodingSummary || status?.runSpecCoding || null,
    specCodingDetails: status?.specCodingDetails || null,
    selectedStepName: status?.currentStep || '',
    requirements: status?.requirements || '',
  };
}

async function resolveWorkflowAgoraSessionId(binding: ChannelSessionBinding, status: any): Promise<string | null> {
  const direct = binding.frontendSessionId || status?.workflowFrontendSessionId;
  if (direct) return direct;
  const runId = binding.runId || status?.runId;
  if (!runId) return null;
  const persistedRun = await loadRunState(runId).catch(() => null);
  return persistedRun?.workflowFrontendSessionId || null;
}

async function attachWorkflowAgoraSessionToBinding(
  binding: ChannelSessionBinding,
  workflowAgoraSessionId: string | null,
): Promise<ChannelSessionBinding> {
  if (!workflowAgoraSessionId || binding.frontendSessionId === workflowAgoraSessionId) return binding;
  return saveChannelBinding({
    ...binding,
    frontendSessionId: workflowAgoraSessionId,
  });
}

function getChannelSpeakerName(message: NormalizedChannelMessage): string {
  return message.externalUserName?.trim() || '渠道用户';
}

async function handleWorkflowMessage(binding: ChannelSessionBinding, integration: ChannelIntegration, message: NormalizedChannelMessage): Promise<ChannelGatewayReply> {
  const text = message.text.trim();
  const guardedText = applyWechatReplyGuardrail(integration, text);
  const lower = text.toLowerCase();
  const status = await loadWorkflowStatus(binding);
  if (!status) {
    return { ok: false, binding, replies: ['当前没有可用的 workflow 运行上下文。'] };
  }

  const manager = binding.runId
    ? await workflowRegistry.getManagerByRunId(binding.runId)
    : workflowRegistry.getRunningManager(binding.configFile);

  if (lower === '/status' || lower === 'status') {
    const replies = [summarizeWorkflowStatus(status)];
    return { ok: true, binding, replies, replyMessages: textReplies(replies) };
  }

  if ((lower === '/approve' || text === '通过' || lower === 'approve') && manager) {
    manager.approve();
    return { ok: true, binding, replies: ['已批准当前检查点。'], replyMessages: textReplies(['已批准当前检查点。']) };
  }

  if (lower.startsWith('/iterate ') && manager) {
    const feedback = text.slice('/iterate '.length).trim();
    if (!feedback) return { ok: false, binding, replies: ['请在 /iterate 后附带迭代意见。'] };
    if ('requestIteration' in manager && typeof (manager as any).requestIteration === 'function') {
      (manager as any).requestIteration(feedback);
      return { ok: true, binding, replies: ['已请求继续迭代。'], replyMessages: textReplies(['已请求继续迭代。']) };
    }
  }

  if (lower === '/questions') {
    const questions = (status?.humanQuestions || []).filter((item: any) => item.status === 'unanswered');
    if (questions.length === 0) return { ok: true, binding, replies: ['当前没有待处理的人工问题。'], replyMessages: textReplies(['当前没有待处理的人工问题。']) };
    const replies = questions.slice(0, 5).map((question: any) => `${question.id}\n${question.title}\n${question.message}`);
    return {
      ok: true,
      binding,
      replies,
      replyMessages: textReplies(replies),
    };
  }

  if (lower.startsWith('/answer ')) {
    const parts = text.split(/\s+/);
    const questionId = parts[1];
    const answerText = text.slice(text.indexOf(questionId) + questionId.length).trim();
    if (!questionId || !answerText) {
      return { ok: false, binding, replies: ['用法：/answer <questionId> <回答内容>'] };
    }
    if (!manager || !isStateMachineManagerLike(manager)) {
      return { ok: false, binding, replies: ['当前运行不支持人工问题应答。'] };
    }
    await manager.answerHumanQuestion(questionId, { text: answerText });
    return { ok: true, binding, replies: [`已回答问题 ${questionId}。`], replyMessages: textReplies([`已回答问题 ${questionId}。`]) };
  }

  if (!manager) {
    return { ok: false, binding, replies: ['当前 workflow 未在运行，无法处理实时消息。'] };
  }
  if (binding.workflowMode === 'feedback-only' || !lower.startsWith('/')) {
    const workflowAgoraSessionId = await resolveWorkflowAgoraSessionId(binding, status);
    if (workflowAgoraSessionId) {
      binding = await attachWorkflowAgoraSessionToBinding(binding, workflowAgoraSessionId);
      await appendWorkflowAgoraMessage({
        sessionId: workflowAgoraSessionId,
        type: 'channel-feedback',
        title: '渠道反馈',
        body: text,
        speakerName: getChannelSpeakerName(message),
        speakerType: 'human',
        dedupeKey: message.externalMessageId
          ? `channel-feedback-${message.externalMessageId}`
          : `channel-feedback-${binding.id}-${Date.now()}`,
      }).catch(() => {});
    }
    manager.injectLiveFeedback(guardedText);
    return { ok: true, binding, replies: ['反馈已注入当前运行。'], replyMessages: textReplies(['反馈已注入当前运行。']) };
  }
  return { ok: false, binding, replies: ['无法识别的 workflow 命令。可用命令：/status /approve /iterate /questions /answer'] };
}

async function handleAgentChatMessage(binding: ChannelSessionBinding, integration: ChannelIntegration, message: NormalizedChannelMessage): Promise<ChannelGatewayReply> {
  const user = await getUserById(integration.createdBy);
  if (!user) return { ok: false, binding, replies: ['渠道所有者不存在，无法执行 Agent 对话。'] };
  const status = binding.configFile || binding.runId ? await loadWorkflowStatus(binding) : null;
  const { executeAgentChat } = await import('@/lib/agent/chat-service');
  const result = await executeAgentChat({
    agentName: binding.agentName || 'default-supervisor',
    message: applyWechatReplyGuardrail(integration, message.text),
    mode: status ? 'workflow-chat' : 'standalone-chat',
    sessionId: binding.agentSessionId || null,
    workingDirectory: user.personalDir,
    workflowContext: status ? buildWorkflowContext(binding, status) : null,
    userContext: {
      id: user.id,
      username: user.username,
      personalDir: user.personalDir,
    },
  });
  const nextAgentSessionId = result.sessionId || undefined;
  const updatedBinding = (binding.agentSessionId || undefined) !== nextAgentSessionId
    ? await saveChannelBinding({ ...binding, agentSessionId: nextAgentSessionId })
    : binding;
  return {
    ok: true,
    binding: updatedBinding,
    replies: [result.output || result.error || '无输出'],
    replyMessages: textReplies([result.output || result.error || '无输出']),
  };
}

async function syncInboundToFrontendSession(binding: ChannelSessionBinding | null, message: NormalizedChannelMessage): Promise<void> {
  if (!binding?.frontendSessionId) return;
  await appendChatSessionMessage(binding.frontendSessionId, {
    role: 'user',
    content: message.text,
    source: {
      type: 'wechat',
      label: '微信',
      direction: 'inbound',
    },
  }, { dedupeKey: message.externalMessageId || `wechat-inbound:${binding.frontendSessionId}:${message.externalConversationId}:${message.text}` }).catch(() => {});
}

async function syncRepliesToFrontendSession(binding: ChannelSessionBinding | null, reply: ChannelGatewayReply): Promise<void> {
  if (!binding?.frontendSessionId) return;
  const messages = Array.isArray(reply.replyMessages) && reply.replyMessages.length > 0
    ? reply.replyMessages.map((item) => item.speakerName ? `${item.speakerName}: ${item.text}` : item.text)
    : reply.replies;
  for (const content of messages) {
    const text = String(content || '').trim();
    if (!text) continue;
    await appendChatSessionMessage(binding.frontendSessionId, {
      role: 'assistant',
      content: text,
      source: {
        type: 'wechat',
        label: '微信回复',
        direction: 'outbound',
      },
    }, { dedupeKey: `wechat-outbound:${binding.frontendSessionId}:${text}` }).catch(() => {});
  }
}

export async function handleChannelInbound(integrationId: string, body: any, headerSecret?: string | null): Promise<ChannelGatewayReply | { challenge: string }> {
  const integration = await getChannelIntegration(integrationId);
  if (!integration || !integration.enabled) {
    throw new Error('渠道集成不存在或已禁用');
  }

  const providedSecret = extractSharedSecret(body, headerSecret);
  if (!providedSecret || providedSecret !== integration.secret) {
    throw new Error('渠道密钥校验失败');
  }

  const normalized = normalizeInboundMessage(integration, body);
  if ('challenge' in normalized) return normalized;
  if (!normalized.text?.trim()) {
    return { ok: true, binding: null, replies: ['已忽略空消息。'], replyMessages: textReplies(['已忽略空消息。'], 'system') };
  }

  const binding = await resolveBinding(integration, normalized);
  if (!binding) {
    return { ok: false, binding: null, replies: ['当前没有可自动绑定的运行时上下文。请先启动一个 workflow，再从微信发送消息；或者在渠道设置里手动补充绑定。'] };
  }
  await syncInboundToFrontendSession(binding, normalized);

  if (binding.bindingType === 'workflow-run') {
    const reply = await handleWorkflowMessage(binding, integration, normalized);
    await syncRepliesToFrontendSession(reply.binding || binding, reply);
    return reply;
  }
  const reply = await handleAgentChatMessage(binding, integration, normalized);
  await syncRepliesToFrontendSession(reply.binding || binding, reply);
  return reply;
}
