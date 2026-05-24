import { randomUUID } from 'crypto';
import { ensureChatroomRoomState } from '@/lib/agora/chatroom-state';
import { loadChatSession, saveChatSession, type PersistedChatSession } from '@/lib/chat/persistence';
import { detectOpeningRole } from '@/lib/agora/opening-copy';
import type {
  CollaborationChatroomParticipant,
  CollaborationRoomMessage,
  SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';

type WorkflowCreationStageSessionLike = {
  frontendSessionId?: string;
  backendSessionId?: string;
  engine?: string;
  model?: string;
  updatedAt?: number;
};

type WorkflowCreationSessionLike = {
  id: string;
  workflowName?: string;
  filename?: string;
  planningEngine?: string;
  planningModel?: string;
  workingDirectory?: string;
  description?: string;
  requirements?: string;
  updatedAt?: number;
  stageSessions?: {
    clarification?: WorkflowCreationStageSessionLike;
    specPlanning?: WorkflowCreationStageSessionLike;
    workflowDraft?: WorkflowCreationStageSessionLike;
  };
};

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function extractWorkflowParticipantNames(config: any, supervisorAgent?: string): string[] {
  const steps = Array.isArray(config?.workflow?.states)
    ? config.workflow.states.flatMap((state: any) => Array.isArray(state?.steps) ? state.steps : [])
    : Array.isArray(config?.workflow?.phases)
      ? config.workflow.phases.flatMap((phase: any) => Array.isArray(phase?.steps) ? phase.steps : [])
      : [];
  return uniqueStrings([
    supervisorAgent || config?.workflow?.supervisor?.agent,
    ...steps.map((step: any) => step?.agent),
  ]);
}

export function createWorkflowParticipants(
  names: string[],
  options?: { coordinatorAgent?: string }
): CollaborationChatroomParticipant[] {
  const now = Date.now();
  const coordinatorAgent = String(options?.coordinatorAgent || '').trim();
  return uniqueStrings(names).map((name, index) => {
    const isCoordinator = name === coordinatorAgent;
    return {
      id: `workflow-participant-${index}-${name}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      name,
      sourceType: 'agent' as const,
      sourceAgent: name,
      runtimeAgentName: name,
      personaPrompt: isCoordinator
        ? '协调型嘉宾，负责智能路由、阶段审阅、人工等待和风险收束；在群聊里以自然嘉宾身份发言。'
        : undefined,
      systemPrompt: isCoordinator ? [
        `你是工作流协作议题里的协调型嘉宾「${name}」。`,
        '你仍负责工作流的智能路由、状态审阅、检查点建议和人工等待，但在议场里不要以旁白或控制者身份发言。',
        '发言应像真实群聊成员一样自然、简短、明确，重点同步下一步、风险和需要用户确认的事项。',
      ].join('\n') : undefined,
      useDefaultModel: true,
      createdAt: now,
    };
  });
}

function getLatestCreationStageSession(session: WorkflowCreationSessionLike): WorkflowCreationStageSessionLike | undefined {
  return session.stageSessions?.workflowDraft
    || session.stageSessions?.specPlanning
    || session.stageSessions?.clarification;
}

function getCreationGuestRuntimeName(sessionId: string): string {
  return `workflow-creation-${sessionId}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function createWorkflowCreationGuest(session?: WorkflowCreationSessionLike | null): {
  participant: CollaborationChatroomParticipant;
  agentSessions: Record<string, string>;
} | null {
  if (!session?.id) return null;
  const latestStage = getLatestCreationStageSession(session);
  const runtimeName = getCreationGuestRuntimeName(session.id);
  const engine = latestStage?.engine || session.planningEngine || '';
  const model = latestStage?.model || session.planningModel || '';
  const participant: CollaborationChatroomParticipant = {
    id: `workflow-creation-participant-${session.id}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
    name: '创建嘉宾',
    sourceType: 'custom',
    runtimeAgentName: runtimeName,
    personaPrompt: [
      `你负责解释「${session.workflowName || session.filename || '当前工作流'}」的创建阶段上下文、目标、约束、草案取舍和配置生成过程。`,
      session.description ? `工作流描述：${session.description}` : '',
      session.requirements ? `原始需求：${session.requirements}` : '',
      '在协作议题里，你只代表创建阶段的上下文，不冒充后续执行嘉宾。',
    ].filter(Boolean).join('\n'),
    systemPrompt: [
      '你是工作流协作议题里的「创建嘉宾」。',
      '你的职责是保留并解释工作流创建阶段的长期上下文，包括需求、澄清、Spec Coding 草案和配置生成取舍。',
      '回答时要自然地参与群聊，避免输出内部实现名或调试说明。',
    ].join('\n'),
    useDefaultModel: !(engine || model),
    engine,
    model,
    createdAt: session.updatedAt || Date.now(),
  };
  const backendSessionId = String(latestStage?.backendSessionId || '').trim();
  return {
    participant,
    agentSessions: backendSessionId ? { [runtimeName]: backendSessionId } : {},
  };
}

export function createWorkflowAgoraWorkbenchState(input: {
  title: string;
  participants: CollaborationChatroomParticipant[];
  workspacePath?: string;
  agentSessions?: Record<string, string>;
}): SessionWorkbenchState {
  const names = input.participants.map((participant) => participant.name).filter(Boolean);
  return {
    collaborationRoom: {
      topic: input.title,
      selectedAgents: names,
      mode: 'group-chat',
      messages: [],
      rounds: [],
      agentSessions: input.agentSessions || {},
      chatroom: {
        status: 'running',
        topic: input.title,
        participants: names,
        facilitator: undefined,
        rounds: [],
        voteHistory: [],
        summaries: [],
        activeVote: null,
        participantRoster: input.participants,
        temporaryAgents: [],
        settings: {
          responseMode: 'mention-driven',
          maxTurnsPerRound: 2,
          maxRepliesPerAgent: 1,
          autoSummarize: true,
          defaultEngine: '',
          defaultModel: '',
          agentOverrides: {},
          workspacePath: input.workspacePath || '',
        },
      },
    },
  };
}

function normalizeWorkflowAgoraState(
  session: PersistedChatSession,
  input: {
    title: string;
    participants?: CollaborationChatroomParticipant[];
    workspacePath?: string;
    agentSessions?: Record<string, string>;
  },
): SessionWorkbenchState {
  const existing = session.sessionWorkbenchState || {};
  const base = ensureChatroomRoomState(existing.collaborationRoom);
  const currentChatroom = base.chatroom!;
  const currentRoster = currentChatroom.participantRoster || [];
  const incomingRoster = input.participants || [];
  const nextRoster = [
    ...currentRoster,
    ...incomingRoster.filter((participant) => (
      !currentRoster.some((item) => item.name === participant.name || item.runtimeAgentName === participant.runtimeAgentName)
    )),
  ];
  const nextParticipants = nextRoster.map((participant) => participant.name);
  return {
    ...existing,
    collaborationRoom: {
      ...base,
      topic: base.topic || input.title,
      selectedAgents: nextParticipants,
      agentSessions: {
        ...(base.agentSessions || {}),
        ...(input.agentSessions || {}),
      },
      chatroom: {
        ...currentChatroom,
        status: 'running',
        topic: currentChatroom.topic || input.title,
        participants: nextParticipants,
        participantRoster: nextRoster,
        settings: {
          ...currentChatroom.settings,
          responseMode: currentChatroom.settings.responseMode || 'mention-driven',
          workspacePath: currentChatroom.settings.workspacePath || input.workspacePath || '',
        },
      },
    },
  };
}

function pickStableTemplate<T>(seed: string, templates: T[]): T {
  if (templates.length === 0) {
    throw new Error('pickStableTemplate requires at least one template');
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return templates[Math.abs(hash) % templates.length];
}

function cleanWorkflowEventBody(body: string, labels: string[]): string {
  let text = String(body || '').trim();
  for (const label of labels) {
    text = text.replace(new RegExp(`^-\\s*${label}[:：]\\s*`, 'im'), '');
  }
  return text
    .replace(/^- Agent:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function pickWorkflowSpeech(input: { type: string; title: string; body?: string; speakerName: string }): string {
  const body = String(input.body || '').trim();
  const stepMatch = input.title.match(/步骤(?:开始|完成|失败)：(.+?)\s*\/\s*(.+)$/);
  const phaseMatch = input.title.match(/阶段(?:开始|完成|失败)：(.+)$/);
  const stateMatch = input.title.match(/状态(?:开始|完成|失败)：(.+)$/);
  const seed = `${input.type}|${input.title}|${input.speakerName}|${body}`;
  if (input.type === 'phase-start' && phaseMatch) {
    return pickStableTemplate(seed, [
      `我先把「${phaseMatch[1]}」这段接起来，进展会同步在这。`,
      `接下来我推进「${phaseMatch[1]}」，边做边说。`,
      `「${phaseMatch[1]}」这段我先开跑，有更新就直接补在这里。`,
    ]);
  }
  if (input.type === 'phase-complete' && phaseMatch) {
    return body
      ? pickStableTemplate(seed, [
        `「${phaseMatch[1]}」这段先收一下，结论是：${body}`,
        `我把「${phaseMatch[1]}」跑完了，先记个结果：${body}`,
        `「${phaseMatch[1]}」到这里差不多了，当前结论：${body}`,
      ])
      : pickStableTemplate(seed, [
        `「${phaseMatch[1]}」这段先收口，可以往后走了。`,
        `我这边把「${phaseMatch[1]}」处理完了，后面可以接着推进。`,
        `「${phaseMatch[1]}」已经完成，下一环节可以继续。`,
      ]);
  }
  if (input.type === 'phase-failed' && phaseMatch) {
    return body
      ? `「${phaseMatch[1]}」这段卡住了：${body}`
      : `「${phaseMatch[1]}」这段卡住了，得先把异常处理掉。`;
  }
  if (input.type === 'state-start' && stateMatch) {
    return pickStableTemplate(seed, [
      `我先进入「${stateMatch[1]}」这段状态，进展继续同步。`,
      `接下来处理「${stateMatch[1]}」，我先把当前步骤推进起来。`,
      `「${stateMatch[1]}」开始了，我先往前走一段。`,
    ]);
  }
  if (input.type === 'state-complete' && stateMatch) {
    return body
      ? pickStableTemplate(seed, [
        `「${stateMatch[1]}」这段先收住，结论是：${body}`,
        `我把「${stateMatch[1]}」处理完了，当前判断：${body}`,
        `「${stateMatch[1]}」已经走完，后面按这个结果继续：${body}`,
      ])
      : pickStableTemplate(seed, [
        `「${stateMatch[1]}」这段先收住，后面可以继续流转。`,
        `我这边把「${stateMatch[1]}」处理完了，可以接着往下走。`,
        `「${stateMatch[1]}」已经完成，准备进入后续判断。`,
      ]);
  }
  if (input.type === 'state-failed' && stateMatch) {
    return body ? `「${stateMatch[1]}」这段没跑通：${body}` : `「${stateMatch[1]}」这段没跑通，得先处理异常。`;
  }
  if (input.type === 'step-start' && stepMatch) {
    return pickStableTemplate(seed, [
      `我先处理「${stepMatch[2]}」，把「${stepMatch[1]}」这段上下文接上。`,
      `接下来我来做「${stepMatch[2]}」，做完就把结果往后递。`,
      `「${stepMatch[2]}」这步我先接住，先把关键输入捋清。`,
    ]);
  }
  if (input.type === 'step-complete' && stepMatch) {
    const conclusion = cleanWorkflowEventBody(body, ['结论']);
    return conclusion
      ? pickStableTemplate(seed, [
        `「${stepMatch[2]}」这步做完了。${conclusion}`,
        `我把「${stepMatch[2]}」收住了：${conclusion}`,
        `「${stepMatch[2]}」已经有结果了，先记一下：${conclusion}`,
      ])
      : pickStableTemplate(seed, [
        `「${stepMatch[2]}」已经做完，我把结果交给下一环节。`,
        `我这边把「${stepMatch[2]}」处理完了，可以继续。`,
        `「${stepMatch[2]}」这步先收住了。`,
      ]);
  }
  if (input.type === 'step-failed' && stepMatch) {
    const reason = cleanWorkflowEventBody(body, ['错误']);
    return reason ? `「${stepMatch[2]}」这步出问题了：${reason}` : `「${stepMatch[2]}」这步出问题了，得先处理异常。`;
  }
  if (input.type === 'human-question') {
    return body ? `这边有个点得请你拍板：${input.title.replace(/^等待人工回复：/, '')}\n${body}` : input.title.replace(/^等待人工回复：/, '');
  }
  if (input.type === 'human-answer') {
    return body ? `收到，这个信息够了，我按这个继续：\n${body}` : '收到，我按这个继续往下走。';
  }
  if (input.type === 'channel-feedback') {
    return body || input.title;
  }
  if (input.type === 'run-created') {
    return '议题先建起来了，后面的进展我都同步在这。';
  }
  if (input.type === 'run-starting') {
    return '这边开始跑了，我先把上下文和执行编队过一遍。';
  }
  if (input.type === 'run-completed') {
    return body ? `这轮工作流已经跑完了。${body}` : '这轮工作流已经跑完，我把最终状态记在这里。';
  }
  if (input.type === 'run-failed') {
    return body ? `工作流这边没跑通：${body}` : '工作流这边没跑通，得先处理阻塞。';
  }
  if (input.type === 'run-stopped') {
    return body ? `工作流先停下来了：${body}` : '工作流先停下来了。';
  }
  if (input.type === 'checkpoint-advice') {
    return body ? `我把检查点建议补一下：\n${body}` : input.title;
  }
  if (input.type === 'state-review') {
    return body ? `这轮我过了一遍，先记下这些：\n${body}` : input.title;
  }
  return [input.title, body].filter(Boolean).join('\n');
}

function pickWorkflowOpeningLine(participant: CollaborationChatroomParticipant): string {
  const coordinatorSignals = [
    participant.name,
    participant.sourceAgent,
    participant.runtimeAgentName,
    participant.presetId,
    participant.personaPrompt,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (['supervisor', '协调', 'default-supervisor'].some((keyword) => coordinatorSignals.includes(keyword))) {
    return '我先盯一下节奏，边走边同步。';
  }

  switch (detectOpeningRole(participant)) {
    case 'engineer':
      return '我先看实现这块。';
    case 'code-reviewer':
      return '我先盯下风险点。';
    case 'architect':
      return '我先从结构和边界看。';
    case 'tester':
      return '我先补一下验证思路。';
    case 'product-manager':
      return '我先对一下目标和范围。';
    case 'copywriter':
      return '我先顺一顺表达。';
    default:
      return '我先接一下这题。';
  }
}

export async function appendWorkflowAgoraOpeningMessages(input: {
  sessionId: string;
  participants: CollaborationChatroomParticipant[];
  workspacePath?: string;
  agentSessions?: Record<string, string>;
  createdAt?: number;
}): Promise<void> {
  const session = await loadChatSession(input.sessionId).catch(() => null);
  if (!session) return;
  const now = input.createdAt || Date.now();
  const title = session.sessionWorkbenchState?.collaborationRoom?.chatroom?.topic
    || session.sessionWorkbenchState?.collaborationRoom?.topic
    || session.title
    || '工作流协作议题';
  session.sessionWorkbenchState = normalizeWorkflowAgoraState(session, {
    title,
    participants: input.participants,
    workspacePath: input.workspacePath,
    agentSessions: input.agentSessions,
  });
  const room = ensureChatroomRoomState(session.sessionWorkbenchState.collaborationRoom);
  const existingIds = new Set(room.messages.map((message) => message.id));
  const existingSetupSpeakers = new Set(
    room.messages
      .filter((message) => message.speakerType === 'agent' && message.chatroom?.kind === 'setup')
      .map((message) => message.speakerName)
  );
  const nextMessages = [...room.messages];
  const nextSessionMessages = [...session.messages];
  let offset = 0;
  const nextRoster = (room.chatroom?.participantRoster || []).map((participant) => {
    if (!input.participants.some((item) => item.name === participant.name || item.runtimeAgentName === participant.runtimeAgentName)) {
      return participant;
    }
    return { ...participant, openingStatus: 'done' as const, openingError: undefined };
  });
  for (const participant of input.participants) {
    if (!participant.name || existingSetupSpeakers.has(participant.name)) continue;
    const messageId = `workflow-opening-${participant.id || participant.runtimeAgentName || participant.name}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (existingIds.has(messageId)) continue;
    const createdAt = now + offset;
    offset += 1;
    const content = pickWorkflowOpeningLine(participant);
    const message: CollaborationRoomMessage = {
      id: messageId,
      speakerType: 'agent',
      speakerName: participant.name,
      content,
      rawContent: content,
      createdAt,
      status: 'done',
      engine: participant.engine,
      model: participant.model,
      chatroom: {
        kind: 'setup',
        mode: room.chatroom?.settings.responseMode || 'mention-driven',
      },
    };
    nextMessages.push(message);
    existingIds.add(messageId);
    existingSetupSpeakers.add(participant.name);
    const centralId = `chat-${messageId}`;
    if (!nextSessionMessages.some((item) => item.id === centralId)) {
      nextSessionMessages.push({
        id: centralId,
        role: 'assistant',
        content,
        rawContent: content,
        timestamp: createdAt,
        engine: participant.engine,
        model: participant.model,
        cards: [{
          type: 'collaboration_speech',
          speakerName: participant.name,
          speakerType: 'agent',
          actionLabel: '开场',
        }],
      });
    }
  }
  room.messages = nextMessages.slice(-80);
  if (room.chatroom) {
    room.chatroom = {
      ...room.chatroom,
      participantRoster: nextRoster,
    };
  }
  session.messages = nextSessionMessages;
  session.sessionWorkbenchState = {
    ...(session.sessionWorkbenchState || {}),
    collaborationRoom: room,
  };
  session.updatedAt = Date.now();
  await saveChatSession(session);
}

export async function ensureWorkflowAgoraSession(input: {
  sessionId: string;
  title: string;
  participants?: CollaborationChatroomParticipant[];
  workspacePath?: string;
  agentSessions?: Record<string, string>;
}): Promise<SessionWorkbenchState | null> {
  const session = await loadChatSession(input.sessionId).catch(() => null);
  if (!session) return null;
  session.sessionWorkbenchState = normalizeWorkflowAgoraState(session, input);
  session.title = session.title || input.title;
  session.updatedAt = Date.now();
  await saveChatSession(session);
  return session.sessionWorkbenchState || null;
}

export async function appendWorkflowAgoraMessage(input: {
  sessionId: string;
  type: string;
  title: string;
  body?: string;
  speakerName: string;
  speakerType?: CollaborationRoomMessage['speakerType'];
  dedupeKey?: string;
  participants?: CollaborationChatroomParticipant[];
  workspacePath?: string;
  agentSessions?: Record<string, string>;
  createdAt?: number;
}): Promise<void> {
  const session = await loadChatSession(input.sessionId).catch(() => null);
  if (!session) return;
  const now = input.createdAt || Date.now();
  const title = session.sessionWorkbenchState?.collaborationRoom?.chatroom?.topic
    || session.sessionWorkbenchState?.collaborationRoom?.topic
    || session.title
    || '工作流协作议题';
  session.sessionWorkbenchState = normalizeWorkflowAgoraState(session, {
    title,
    participants: input.participants,
    workspacePath: input.workspacePath,
    agentSessions: input.agentSessions,
  });
  const room = ensureChatroomRoomState(session.sessionWorkbenchState.collaborationRoom);
  const messageId = input.dedupeKey || `workflow-agora-${now}-${randomUUID().slice(0, 8)}`;
  if (room.messages.some((message) => message.id === messageId)) return;
  const content = pickWorkflowSpeech({
    type: input.type,
    title: input.title,
    body: input.body,
    speakerName: input.speakerName,
  });
  const message: CollaborationRoomMessage = {
    id: messageId,
    speakerType: input.speakerType || 'agent',
    speakerName: input.speakerName,
    content,
    createdAt: now,
    status: 'done',
    chatroom: {
      kind: input.speakerType === 'human'
        ? 'agent'
        : input.type === 'human-question' ? 'system' : 'agent',
      mode: room.chatroom?.settings.responseMode || 'mention-driven',
    },
  };
  room.messages = [...room.messages, message].slice(-80);
  session.sessionWorkbenchState = {
    ...(session.sessionWorkbenchState || {}),
    collaborationRoom: room,
  };
  if (!session.messages.some((item) => item.id === `chat-${messageId}`)) {
    session.messages.push({
      id: `chat-${messageId}`,
      role: message.speakerType === 'human' ? 'user' : 'assistant',
      content,
      rawContent: content,
      timestamp: now,
      cards: [{
        type: 'collaboration_speech',
        speakerName: message.speakerName,
        speakerType: message.speakerType,
        actionLabel: '工作流',
      }],
    });
  }
  session.updatedAt = now;
  await saveChatSession(session);
}
