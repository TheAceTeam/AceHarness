import { randomUUID } from 'crypto';
import { executeAgentChat, type AgentChatUserContext } from '@/lib/agent/chat-service';
import type { WorkflowRunBindingLike } from '@/lib/agent/conversations';
import { createRoundtableMessage, loadRoundtable, saveRoundtable, type RoundtableMessage, type RoundtableRecord } from '@/lib/roundtable/store';

export interface RoundtableStartInput {
  createdBy: AgentChatUserContext;
  topic: string;
  participants: string[];
  runBinding?: WorkflowRunBindingLike | null;
  workflowContext?: Record<string, any> | null;
  hostMessage?: string;
  summarizer?: string;
  workingDirectory?: string;
}

export interface RoundtableContinueInput {
  createdBy: AgentChatUserContext;
  roundtableId: string;
  hostMessage: string;
  runBinding?: WorkflowRunBindingLike | null;
  workflowContext?: Record<string, any> | null;
  summarizer?: string;
  workingDirectory?: string;
}

export function extractRoundtableMentions(input: string, participants: string[]): string[] {
  if (!input.trim()) return [];
  const mentions: string[] = [];
  const pushMention = (agentName: string) => {
    if (!mentions.includes(agentName)) mentions.push(agentName);
  };
  const escapedParticipants = participants
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((agentName) => agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionPattern = escapedParticipants.length
    ? new RegExp(`@全员|@(${escapedParticipants.join('|')})`, 'gu')
    : /@全员/gu;
  for (const match of input.matchAll(mentionPattern)) {
    const token = match[0];
    if (token === '@全员') {
      participants.forEach(pushMention);
    } else {
      const agentName = token.slice(1);
      if (participants.includes(agentName)) pushMention(agentName);
    }
  }
  return mentions;
}

function extractNextRoundMentions(input: string, participants: string[], speaker?: string): string[] {
  return extractRoundtableMentions(input, participants).filter((agentName) => agentName !== speaker);
}

function buildRoundtablePrompt(agentName: string, input: {
  kind: 'single' | 'round' | 'summary';
  topic: string;
  hostMessage?: string;
  transcript: RoundtableMessage[];
  participants: string[];
}): string {
  const transcript = input.transcript.slice(-12)
    .map((message) => `${message.speakerName}: ${message.content.slice(0, 1200)}`)
    .join('\n\n');
  if (input.kind === 'summary') {
    return [
      `你是本次协作室的总结者 ${agentName}。`,
      `议题：${input.topic}`,
      input.participants.length ? `参与者：${input.participants.join('、')}` : '',
      '请基于下面的多方发言，输出结构化总结：共识、分歧、风险、下一步动作。必要时指出哪些内容应转为 Spec 修订、workflow 编排调整或运行反馈。',
      '',
      '讨论记录：',
      transcript || '暂无讨论记录',
    ].filter(Boolean).join('\n\n');
  }
  return [
    `你正在参加一个由人类主持的多 Agent 协作室。你的身份是 ${agentName}。`,
    `议题：${input.topic || '未命名议题'}`,
    input.participants.length ? `本轮参与者：${input.participants.join('、')}` : '',
    input.hostMessage ? `主持人本轮指令：${input.hostMessage}` : '',
    '请只代表你自己的角色职责发言，给出高密度观点。不要替其他 Agent 总结，不要输出工具调用说明。',
    '如果你希望某个 Agent 继续接话，请在发言末尾明确使用 @agent；如果不需要继续，就不要输出新的 @，本轮会自然结束。@全员 表示让所有参与者接话。',
    '建议包含：你的判断、依据、风险、需要其他角色补充的问题、可执行建议。',
    '',
    '最近讨论记录：',
    transcript || '暂无讨论记录',
  ].filter(Boolean).join('\n\n');
}

async function runMentionDrivenRoundtable(input: {
  record: RoundtableRecord;
  roundId: string;
  topic: string;
  hostMessage: string;
  initialTargets: string[];
  createdBy: AgentChatUserContext;
  runBinding?: WorkflowRunBindingLike | null;
  workflowContext?: Record<string, any> | null;
  summarizer?: string;
  workingDirectory?: string;
}): Promise<RoundtableRecord> {
  const transcript = [...input.record.messages];
  const queue = [...input.initialTargets];
  const spokenCounts = new Map<string, number>();
  const allParticipants = new Set(input.initialTargets);
  const maxTurns = Math.max(6, input.record.participants.length * 2);
  let turns = 0;

  try {
    while (queue.length > 0 && turns < maxTurns) {
      const agentName = queue.shift();
      if (!agentName) continue;
      const nextCount = (spokenCounts.get(agentName) || 0) + 1;
      if (nextCount > 2) continue;
      spokenCounts.set(agentName, nextCount);
      turns += 1;

      const result = await executeAgentChat({
        agentName,
        message: buildRoundtablePrompt(agentName, {
          kind: 'round',
          topic: input.topic,
          hostMessage: input.hostMessage,
          transcript,
          participants: Array.from(allParticipants),
        }),
        mode: 'workflow-chat',
        sessionId: input.record.agentSessions[agentName]
          || (agentName === input.record.supervisorAgent ? input.runBinding?.supervisorSessionId : input.runBinding?.attachedAgentSessions?.[agentName])
          || null,
        workingDirectory: input.workingDirectory || input.createdBy.personalDir,
        workflowContext: {
          ...(input.workflowContext || {}),
          collaborationTopic: input.topic,
          collaborationSpeaker: agentName,
        },
        userContext: input.createdBy,
      });
      if (result.sessionId) input.record.agentSessions[agentName] = result.sessionId;
      const message = createRoundtableMessage({
        roundId: input.roundId,
        speakerType: agentName === input.record.supervisorAgent ? 'supervisor' : 'agent',
        speakerName: agentName,
        content: result.output || result.error || '无输出',
        status: result.isError ? 'error' : 'done',
        error: result.error || null,
        engine: result.engine,
        model: result.model,
      });
      input.record.messages.push(message);
      transcript.push(message);
      input.record.updatedAt = Date.now();
      await saveRoundtable(input.record);

      const nextMentions = extractNextRoundMentions(message.content, input.record.participants, agentName)
        .filter((name) => (spokenCounts.get(name) || 0) < 2);
      nextMentions.forEach((name) => {
        allParticipants.add(name);
        if (!queue.includes(name)) queue.push(name);
      });
    }

    const finalParticipants = Array.from(allParticipants);
    const summarizer = input.summarizer || (finalParticipants.includes(input.record.supervisorAgent || '') ? input.record.supervisorAgent : finalParticipants[0]);
    let summary = queue.length > 0 && turns >= maxTurns
      ? '已达到本轮最大接话次数，系统自动收束。'
      : '没有新的 @，本轮圆桌自然结束。';

    if (summarizer && finalParticipants.length > 0) {
      const summaryResult = await executeAgentChat({
        agentName: summarizer,
        message: buildRoundtablePrompt(summarizer, {
          kind: 'summary',
          topic: input.topic,
          transcript,
          participants: finalParticipants,
        }),
        mode: 'workflow-chat',
        sessionId: input.record.agentSessions[summarizer] || null,
        workingDirectory: input.workingDirectory || input.createdBy.personalDir,
        workflowContext: {
          ...(input.workflowContext || {}),
          collaborationTopic: input.topic,
          collaborationSpeaker: summarizer,
        },
        userContext: input.createdBy,
      });
      if (summaryResult.sessionId) input.record.agentSessions[summarizer] = summaryResult.sessionId;
      summary = summaryResult.output || summaryResult.error || summary;
      input.record.messages.push(createRoundtableMessage({
        roundId: input.roundId,
        speakerType: summarizer === input.record.supervisorAgent ? 'supervisor' : 'agent',
        speakerName: summarizer,
        content: summary,
        status: summaryResult.isError ? 'error' : 'done',
        error: summaryResult.error || null,
        engine: summaryResult.engine,
        model: summaryResult.model,
      }));
    } else {
      input.record.messages.push(createRoundtableMessage({
        roundId: input.roundId,
        speakerType: 'system',
        speakerName: '系统',
        content: summary,
        status: 'done',
      }));
    }

    input.record.rounds = input.record.rounds.map((round) => round.id === input.roundId
      ? { ...round, participants: finalParticipants, status: 'completed', completedAt: Date.now(), summary }
      : round);
    input.record.status = 'completed';
    input.record.updatedAt = Date.now();
    await saveRoundtable(input.record);
    return input.record;
  } catch (error: any) {
    input.record.messages.push(createRoundtableMessage({
      roundId: input.roundId,
      speakerType: 'system',
      speakerName: '系统',
      content: `圆桌中断：${error?.message || '未知错误'}`,
      status: 'error',
      error: error?.message || '未知错误',
    }));
    input.record.rounds = input.record.rounds.map((round) => round.id === input.roundId
      ? { ...round, status: 'failed', completedAt: Date.now(), summary: error?.message || '执行失败' }
      : round);
    input.record.status = 'failed';
    input.record.updatedAt = Date.now();
    await saveRoundtable(input.record);
    throw error;
  }
}

export async function startRoundtable(input: RoundtableStartInput): Promise<RoundtableRecord> {
  const roundId = `round-${randomUUID()}`;
  const initialTargets = extractRoundtableMentions(input.hostMessage || '', input.participants);
  const record: RoundtableRecord = {
    id: `roundtable-${randomUUID()}`,
    createdBy: input.createdBy.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'running',
    topic: input.topic,
    runId: input.runBinding?.runId,
    configFile: input.runBinding?.configFile,
    supervisorAgent: input.runBinding?.supervisorAgent || 'default-supervisor',
    participants: input.participants,
    agentSessions: {},
    messages: [
      ...(input.hostMessage ? [createRoundtableMessage({
        roundId,
        speakerType: 'human',
        speakerName: '主持人',
        content: input.hostMessage,
        status: 'done',
      })] : []),
      createRoundtableMessage({
        roundId,
        speakerType: 'system',
        speakerName: '系统',
        content: initialTargets.length
          ? `圆桌开始：${initialTargets.join('、')}。后续只由被 @ 到的 Agent 接话。`
          : '主持人未 @ 任何 Agent，本轮圆桌到此结束。',
        status: 'done',
      }),
    ],
    rounds: [{
      id: roundId,
      topic: input.topic,
      participants: initialTargets,
      status: initialTargets.length ? 'running' : 'completed',
      startedAt: Date.now(),
      ...(!initialTargets.length ? { completedAt: Date.now(), summary: '主持人未 @ 任何 Agent，本轮结束。' } : {}),
    }],
  };
  await saveRoundtable(record);

  if (initialTargets.length === 0) {
    return record;
  }

  return runMentionDrivenRoundtable({
    record,
    roundId,
    topic: input.topic,
    hostMessage: input.hostMessage || '',
    initialTargets,
    createdBy: input.createdBy,
    runBinding: input.runBinding,
    workflowContext: input.workflowContext,
    summarizer: input.summarizer,
    workingDirectory: input.workingDirectory,
  });
}

export async function continueRoundtable(input: RoundtableContinueInput): Promise<RoundtableRecord> {
  const record = await loadRoundtable(input.roundtableId);
  if (!record) throw new Error('找不到圆桌记录');
  const roundId = `round-${randomUUID()}`;
  const initialTargets = extractRoundtableMentions(input.hostMessage, record.participants);
  record.messages.push(createRoundtableMessage({
    roundId,
    speakerType: 'human',
    speakerName: '主持人',
    content: input.hostMessage,
    status: 'done',
  }));
  record.messages.push(createRoundtableMessage({
    roundId,
    speakerType: 'system',
    speakerName: '系统',
    content: initialTargets.length
      ? `圆桌继续：${initialTargets.join('、')}。后续只由被 @ 到的 Agent 接话。`
      : '主持人未 @ 任何 Agent，本轮圆桌到此结束。',
    status: 'done',
  }));
  record.rounds.push({
    id: roundId,
    topic: record.topic,
    participants: initialTargets,
    status: initialTargets.length ? 'running' : 'completed',
    startedAt: Date.now(),
    ...(!initialTargets.length ? { completedAt: Date.now(), summary: '主持人未 @ 任何 Agent，本轮结束。' } : {}),
  });
  record.status = initialTargets.length ? 'running' : 'completed';
  record.updatedAt = Date.now();
  await saveRoundtable(record);
  if (initialTargets.length === 0) return record;

  return runMentionDrivenRoundtable({
    record,
    roundId,
    topic: record.topic,
    hostMessage: input.hostMessage,
    initialTargets,
    createdBy: input.createdBy,
    runBinding: input.runBinding,
    workflowContext: input.workflowContext,
    summarizer: input.summarizer,
    workingDirectory: input.workingDirectory,
  });
}

export async function appendRoundtableHostMessage(roundtableId: string, content: string): Promise<RoundtableRecord> {
  const record = await loadRoundtable(roundtableId);
  if (!record) throw new Error('找不到圆桌记录');
  record.messages.push(createRoundtableMessage({
    speakerType: 'human',
    speakerName: '主持人',
    content,
    status: 'done',
  }));
  record.updatedAt = Date.now();
  await saveRoundtable(record);
  return record;
}
