'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollaborationRoomSurface } from '@/components/collaboration/CollaborationRoomSurface';
import { EngineSelect } from '@/components/EngineSelect';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ModelSelect } from '@/components/ModelSelect';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import type {
  CollaborationChatroomMode,
  CollaborationChatroomParticipant,
  CollaborationChatroomRound,
  CollaborationChatroomState,
  CollaborationChatroomSummary,
  CollaborationChatroomVote,
  CollaborationRoomMessage,
  CollaborationRoomState,
} from '@/lib/core/home-sidebar-state';
import { createInitialChatroomState, ensureChatroomRoomState } from './types';

export interface ChatroomPanelProps {
  availableAgents: Array<{ name: string; description?: string }>;
  room: CollaborationRoomState | null;
  updateRoom: (updater: (room: CollaborationRoomState) => CollaborationRoomState) => void;
  appendToCentralChat?: (message: CollaborationRoomMessage) => void;
  onRegisterMainInputHandler?: (handler: ((text: string) => void) | null) => void;
  callAgent: (
    agentName: string,
    message: string,
    roundId?: string,
    messagePatch?: Pick<CollaborationRoomMessage, 'chatroom'>,
    temporaryRoleConfig?: Record<string, any>
  ) => Promise<string>;
  toast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void;
}

type VoteDraft = {
  question: string;
  options: string;
  allowAbstain: boolean;
};

const CHATROOM_HOST_NAME = 'AI 百灵鸟';

type TemporaryAgentDraft = {
  id?: string;
  name: string;
  sourceType: 'agent' | 'custom';
  sourceAgent: string;
  personaPrompt: string;
  useDefaultModel: boolean;
  engine: string;
  model: string;
};

const MODE_LABELS: Record<CollaborationChatroomMode, string> = {
  broadcast: '广播',
  'mention-driven': '点名接话',
  facilitated: '百灵鸟控场',
};

const ANCIENT_STYLE_SURNAMES = ['子车', '司空', '上官', '公孙', '令狐', '诸葛', '东方', '尉迟', '慕容', '宇文', '谢', '沈', '顾', '苏', '楚', '陆', '秦', '柳', '白', '萧'];
const ANCIENT_STYLE_GIVEN_PREFIXES = ['雪', '清', '知', '听', '疏', '明', '映', '流', '寒', '星', '若', '云', '青', '景', '书', '月'];
const ANCIENT_STYLE_GIVEN_SUFFIXES = ['兰', '宁', '晏', '辞', '微', '舟', '岚', '音', '霁', '棠', '遥', '歌', '汐', '禾', '言', '玉'];

function generateAncientStyleMemberName(existingNames: string[]) {
  const existing = new Set(existingNames);
  const total = ANCIENT_STYLE_SURNAMES.length * ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length;
  const start = Date.now() % total;
  for (let offset = 0; offset < total; offset += 1) {
    const index = (start + offset) % total;
    const surnameIndex = Math.floor(index / (ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length));
    const givenIndex = index % (ANCIENT_STYLE_GIVEN_PREFIXES.length * ANCIENT_STYLE_GIVEN_SUFFIXES.length);
    const prefixIndex = Math.floor(givenIndex / ANCIENT_STYLE_GIVEN_SUFFIXES.length);
    const suffixIndex = givenIndex % ANCIENT_STYLE_GIVEN_SUFFIXES.length;
    const candidate = `${ANCIENT_STYLE_SURNAMES[surnameIndex]}${ANCIENT_STYLE_GIVEN_PREFIXES[prefixIndex]}${ANCIENT_STYLE_GIVEN_SUFFIXES[suffixIndex]}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `成员${existingNames.length + 1}`;
}

function getInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function getSpeakerAvatarSrc(name: string, kind: 'agent' | 'host' | 'system') {
  if (kind === 'host') {
    return resolveAgentAvatarSrc(undefined, `host:${name}`, { roleType: 'supervisor', team: 'black-gold' });
  }
  if (kind === 'system') {
    return resolveAgentAvatarSrc(undefined, `system:${name}`, { team: 'judge' });
  }
  return resolveAgentAvatarSrc(undefined, name);
}

function buildChatroomParticipantRoleConfig(
  participant: CollaborationChatroomParticipant,
  runtime: { engine?: string; model?: string },
  sourceDescription?: string
) {
  const selectedEngine = String(runtime.engine || '').trim();
  const selectedModel = String(runtime.model || '').trim();
  const persona = participant.sourceType === 'custom'
    ? participant.personaPrompt
    : `${participant.sourceAgent || participant.name}${sourceDescription ? `：${sourceDescription}` : ''}`;
  return {
    name: participant.name,
    team: 'blue',
    roleType: 'normal',
    title: '聊天室成员',
    persona,
    engineModels: selectedEngine && selectedModel ? { [selectedEngine]: selectedModel } : {},
    activeEngine: selectedEngine,
    capabilities: ['multi-agent-chat', 'chatroom'],
    systemPrompt: [
      `你是聊天室成员「${participant.name}」。`,
      participant.sourceType === 'custom'
        ? `你的人格与行为准则：${participant.personaPrompt}`
        : `你的人格来源：${participant.sourceAgent || participant.name}${sourceDescription ? `。参考描述：${sourceDescription}` : ''}`,
      '你的任务是在多人协作聊天中给出清晰、专业、自然的发言。',
      '不要自称业务 Agent，不要编造自己有文件系统或工具执行结果。',
      `如果 ${CHATROOM_HOST_NAME} 点名你，就直接进入讨论；如果你希望其他参与者补充，可以在末尾使用 @名字。`,
    ].filter(Boolean).join('\n'),
    constraints: ['不调用工具', '不修改文件', '仅用于聊天室临时讨论'],
    allowedTools: [],
    category: 'chatroom-member',
    tags: ['chatroom', participant.sourceType === 'custom' ? 'custom' : 'agent-template'],
  };
}

function createRoomMessage(
  input: Omit<CollaborationRoomMessage, 'id' | 'createdAt'> & { chatroom?: CollaborationRoomMessage['chatroom'] }
): CollaborationRoomMessage {
  return {
    id: `chatroom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  };
}

function extractMentions(text: string, participants: string[]): string[] {
  const mentions: string[] = [];
  for (const name of participants) {
    if (text.includes(`@${name}`) && !mentions.includes(name)) mentions.push(name);
  }
  if (text.includes('@全员')) {
    for (const name of participants) {
      if (!mentions.includes(name)) mentions.push(name);
    }
  }
  return mentions;
}

function ensureRoom(room: CollaborationRoomState | null): CollaborationRoomState {
  return ensureChatroomRoomState(room || {
    topic: '',
    selectedAgents: [],
    mode: 'roundtable',
    messages: [],
    rounds: [],
    agentSessions: {},
  });
}

function buildAgentPrompt(input: {
  topic: string;
  mode: CollaborationChatroomMode;
  hostMessage: string;
  agentName: string;
  participants: string[];
  transcript: CollaborationRoomMessage[];
}) {
  const transcript = input.transcript.slice(-14)
    .map((message) => `${message.speakerName}: ${message.content.slice(0, 600)}`)
    .join('\n\n');
  return [
    `你正在参加一个 Agent 剧场，当前议题是「${input.topic}」。`,
    `你是 ${input.agentName}。参与者：${input.participants.join('、') || '未设置'}。`,
    `当前协作方式：${MODE_LABELS[input.mode]}。`,
    `${CHATROOM_HOST_NAME} 的开场消息：${input.hostMessage}`,
    input.mode === 'broadcast'
      ? '请直接给出你的观点、判断和建议。不要假装替别人发言。'
      : '请代表你自己的角色发言。如果你希望某个参与者补充，请在末尾用 @姓名 点名；若不需要继续，就不要再 @。',
    '回答保持紧凑但有信息量，优先给结论、依据、风险和建议。',
    transcript ? `最近记录：\n${transcript}` : '最近记录：暂无。',
  ].join('\n\n');
}

function buildSummaryPrompt(input: {
  topic: string;
  participants: string[];
  transcript: CollaborationRoomMessage[];
}) {
  const transcript = input.transcript.slice(-18)
    .map((message) => `${message.speakerName}: ${message.content.slice(0, 800)}`)
    .join('\n\n');
  return [
    `请为 Agent 剧场输出收束总结。议题：${input.topic}。`,
    `参与者：${input.participants.join('、') || '未设置'}。`,
    '请输出四段：共识、分歧、风险、下一步。每段 1-3 条，简洁明确。',
    transcript ? `讨论记录：\n${transcript}` : '讨论记录：暂无。',
  ].join('\n\n');
}

function buildVotePrompt(input: {
  topic: string;
  question: string;
  options: string[];
  allowAbstain: boolean;
}) {
  return [
    `聊天室正在就议题「${input.topic}」进行投票。`,
    `投票问题：${input.question}`,
    `可选项：${input.options.join('、')}${input.allowAbstain ? '、弃权' : ''}`,
    '请仅用两行回复。',
    '第一行只写你的选择。',
    '第二行以“理由：”开头，写一句简短理由。',
  ].join('\n');
}

function extractVoteResult(output: string, options: string[], allowAbstain: boolean) {
  const normalized = output.trim();
  const chosen = options.find((option) => normalized.includes(option))
    || (allowAbstain && normalized.includes('弃权') ? '弃权' : options[0]);
  const reasonLine = normalized.split(/\r?\n/).find((line) => line.includes('理由'));
  return {
    choice: chosen,
    reason: reasonLine?.replace(/^.*理由[:：]?\s*/, '').trim() || normalized,
  };
}

function summarizeVote(vote: CollaborationChatroomVote) {
  const tally = vote.options.reduce<Record<string, number>>((acc, option) => {
    acc[option] = 0;
    return acc;
  }, {});
  if (vote.allowAbstain) tally['弃权'] = 0;
  Object.values(vote.votes).forEach((choice) => {
    tally[choice] = (tally[choice] || 0) + 1;
  });
  return Object.entries(tally)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${label} ${count} 票`)
    .join('，');
}

export function ChatroomPanel({
  availableAgents,
  room,
  updateRoom,
  appendToCentralChat,
  onRegisterMainInputHandler,
  callAgent,
  toast,
}: ChatroomPanelProps) {
  const normalizedRoom = ensureRoom(room);
  const chatroom = normalizedRoom.chatroom || createInitialChatroomState();
  const messages = normalizedRoom.messages || [];
  const legacyTemporaryAgents = chatroom.temporaryAgents || [];
  const participantRoster = useMemo<CollaborationChatroomParticipant[]>(() => {
    if (chatroom.participantRoster?.length) return chatroom.participantRoster;
    return (chatroom.participants || []).map((name, index) => {
      const temp = legacyTemporaryAgents.find((agent) => agent.name === name);
      return temp ? {
        id: temp.id,
        name: temp.name,
        sourceType: 'custom' as const,
        personaPrompt: temp.personaPrompt,
        useDefaultModel: !(temp.engine || temp.model),
        engine: temp.engine || '',
        model: temp.model || '',
        createdAt: temp.createdAt,
      } : {
        id: `legacy-${index}-${name}`,
        name,
        sourceType: 'agent' as const,
        sourceAgent: name,
        useDefaultModel: true,
        createdAt: Date.now(),
      };
    });
  }, [chatroom.participantRoster, chatroom.participants, legacyTemporaryAgents]);
  const participants = participantRoster.map((participant) => participant.name);
  const useCentralTranscript = Boolean(appendToCentralChat);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const [topicInput, setTopicInput] = useState(chatroom.topic || normalizedRoom.topic || '');
  const [draft, setDraft] = useState('');
  const [composerMode, setComposerMode] = useState<CollaborationChatroomMode>(chatroom.settings.responseMode);
  const [topicDialogOpen, setTopicDialogOpen] = useState(false);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  const [temporaryParticipantDialogOpen, setTemporaryParticipantDialogOpen] = useState(false);
  const [voteDraft, setVoteDraft] = useState<VoteDraft>({ question: '', options: '', allowAbstain: false });
  const [topicDraft, setTopicDraft] = useState(chatroom.topic || '');
  const [temporaryAgentDraft, setTemporaryAgentDraft] = useState<TemporaryAgentDraft>({
    name: '',
    sourceType: 'agent',
    sourceAgent: availableAgents[0]?.name || '',
    personaPrompt: '',
    useDefaultModel: true,
    engine: '',
    model: '',
  });

  useEffect(() => {
    setComposerMode(chatroom.settings.responseMode);
  }, [chatroom.settings.responseMode]);

  useEffect(() => {
    setTopicInput(chatroom.topic || normalizedRoom.topic || '');
    setTopicDraft(chatroom.topic || normalizedRoom.topic || '');
  }, [chatroom.topic, normalizedRoom.topic]);

  useEffect(() => {
    if (bottomRef.current && typeof bottomRef.current.scrollIntoView === 'function') {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length]);

  const openVoteCount = chatroom.activeVote
    ? Object.keys(chatroom.activeVote.votes || {}).length
    : 0;
  const participantMap = useMemo(
    () => new Map(participantRoster.map((participant) => [participant.name, participant])),
    [participantRoster]
  );

  const resolveChatroomParticipantRuntimeConfig = (participantName: string) => {
    const participant = participantMap.get(participantName);
    const useDefault = participant?.useDefaultModel !== false;
    return {
      participant,
      useDefault,
      effectiveEngine: String(useDefault ? (chatroom.settings.defaultEngine || '') : (participant?.engine || chatroom.settings.defaultEngine || '')).trim(),
      effectiveModel: String(useDefault ? (chatroom.settings.defaultModel || '') : (participant?.model || chatroom.settings.defaultModel || '')).trim(),
    };
  };

  const updateChatroom = (updater: (state: CollaborationChatroomState) => CollaborationChatroomState) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      const nextChatroom = updater(base.chatroom || createInitialChatroomState({
        topic: base.topic || '',
        participants: base.selectedAgents || [],
      }));
      return {
        ...base,
        topic: nextChatroom.topic,
        selectedAgents: nextChatroom.participants,
        chatroom: nextChatroom,
      };
    });
  };

  const appendMessages = (...nextMessages: CollaborationRoomMessage[]) => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        messages: [...(base.messages || []), ...nextMessages],
      };
    });
    nextMessages.forEach((message) => appendToCentralChat?.(message));
  };

  const handleSubmitParticipantDraft = () => {
    const editingId = temporaryAgentDraft.id;
    const name = temporaryAgentDraft.name.trim();
    const personaPrompt = temporaryAgentDraft.personaPrompt.trim();
    if (!name) {
      toast('warning', '请填写聊天室成员名字');
      return;
    }
    if (participantRoster.some((participant) => participant.name === name && participant.id !== editingId)) {
      toast('warning', `聊天室成员 ${name} 已存在`);
      return;
    }
    if (temporaryAgentDraft.sourceType === 'custom' && !personaPrompt) {
      toast('warning', '临时人格需要填写提示词');
      return;
    }
    updateChatroom((current) => ({
      ...current,
      participantRoster: editingId
        ? (current.participantRoster || []).map((participant) => participant.id === editingId ? {
          ...participant,
          name,
          sourceType: temporaryAgentDraft.sourceType,
          sourceAgent: temporaryAgentDraft.sourceType === 'agent' ? temporaryAgentDraft.sourceAgent : undefined,
          personaPrompt: temporaryAgentDraft.sourceType === 'custom' ? personaPrompt : undefined,
          useDefaultModel: temporaryAgentDraft.useDefaultModel,
          engine: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.engine,
          model: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.model,
        } : participant)
        : [
          ...(current.participantRoster || []),
          {
            id: `participant-${Date.now()}`,
            name,
            sourceType: temporaryAgentDraft.sourceType,
            sourceAgent: temporaryAgentDraft.sourceType === 'agent' ? temporaryAgentDraft.sourceAgent : undefined,
            personaPrompt: temporaryAgentDraft.sourceType === 'custom' ? personaPrompt : undefined,
            useDefaultModel: temporaryAgentDraft.useDefaultModel,
            engine: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.engine,
            model: temporaryAgentDraft.useDefaultModel ? '' : temporaryAgentDraft.model,
            createdAt: Date.now(),
          },
        ],
      participants: editingId
        ? (current.participantRoster || []).map((participant) => participant.id === editingId ? name : participant.name)
        : [...(current.participantRoster || []).map((participant) => participant.name), name],
    }));
    setTemporaryAgentDraft({
      id: undefined,
      name: generateAncientStyleMemberName([...participantRoster.map((participant) => participant.name), name]),
      sourceType: 'agent',
      sourceAgent: availableAgents[0]?.name || '',
      personaPrompt: '',
      useDefaultModel: true,
      engine: '',
      model: '',
    });
    setTemporaryParticipantDialogOpen(false);
  };

  const openCreateParticipantDialog = () => {
    setTemporaryAgentDraft({
      id: undefined,
      name: generateAncientStyleMemberName(participantRoster.map((participant) => participant.name)),
      sourceType: 'agent',
      sourceAgent: availableAgents[0]?.name || '',
      personaPrompt: '',
      useDefaultModel: true,
      engine: '',
      model: '',
    });
    setTemporaryParticipantDialogOpen(true);
  };

  const openEditParticipantDialog = (participant: CollaborationChatroomParticipant) => {
    setTemporaryAgentDraft({
      id: participant.id,
      name: participant.name,
      sourceType: participant.sourceType,
      sourceAgent: participant.sourceAgent || availableAgents[0]?.name || '',
      personaPrompt: participant.personaPrompt || '',
      useDefaultModel: participant.useDefaultModel !== false,
      engine: participant.engine || '',
      model: participant.model || '',
    });
    setTemporaryParticipantDialogOpen(true);
  };

  const setChatroomDefaultRuntime = (patch: { engine?: string; model?: string }) => {
    updateChatroom((current) => ({
      ...current,
      settings: {
        ...current.settings,
        defaultEngine: patch.engine ?? current.settings.defaultEngine ?? '',
        defaultModel: patch.model ?? current.settings.defaultModel ?? '',
      },
    }));
  };

  const markRound = (roundId: string, patch: Partial<CollaborationChatroomRound>) => {
    updateChatroom((current) => ({
      ...current,
      rounds: current.rounds.map((round) => round.id === roundId ? { ...round, ...patch } : round),
      activeRoundId: patch.status === 'completed' || patch.status === 'failed' ? undefined : current.activeRoundId,
    }));
  };

  const saveSummary = (roundId: string, content: string, generatedBy: string) => {
    const summary: CollaborationChatroomSummary = {
      id: `summary-${Date.now()}`,
      roundId,
      title: `第 ${chatroom.rounds.length} 轮总结`,
      content,
      generatedBy,
      createdAt: Date.now(),
    };
    updateChatroom((current) => ({
      ...current,
      summaries: [summary, ...current.summaries].slice(0, 12),
      rounds: current.rounds.map((round) => round.id === roundId ? { ...round, summary: content } : round),
    }));
  };

  const runSummary = async (roundId: string, transcript: CollaborationRoomMessage[]) => {
    const summarizer = participants[0];
    if (!summarizer) return;
    updateChatroom((current) => ({ ...current, status: 'summarizing' }));
    try {
      const summarizerConfig = participantMap.get(summarizer);
      const summarizerRuntime = resolveChatroomParticipantRuntimeConfig(summarizer);
      const sourceDescription = summarizerConfig?.sourceType === 'agent'
        ? availableAgents.find((agent) => agent.name === summarizerConfig.sourceAgent)?.description
        : summarizerConfig?.personaPrompt;
      const output = await callAgent(
        summarizer,
        buildSummaryPrompt({
          topic: chatroom.topic,
          participants,
          transcript,
        }),
        roundId,
        { chatroom: { kind: 'summary', mode: composerMode } },
        summarizerConfig ? buildChatroomParticipantRoleConfig(summarizerConfig, {
          engine: summarizerRuntime.effectiveEngine,
          model: summarizerRuntime.effectiveModel,
        }, sourceDescription) : undefined
      );
      saveSummary(roundId, output, summarizer);
      markRound(roundId, { status: 'completed', completedAt: Date.now(), summary: output });
      updateChatroom((current) => ({ ...current, status: 'running' }));
    } catch (error: any) {
      appendMessages(createRoomMessage({
        roundId,
        speakerType: 'system',
        speakerName: '系统',
        content: `本轮总结失败：${error?.message || '未知错误'}`,
        status: 'error',
        error: error?.message || '未知错误',
        chatroom: { kind: 'system', mode: composerMode },
      }));
      markRound(roundId, { status: 'failed', completedAt: Date.now(), summary: error?.message || '总结失败' });
      updateChatroom((current) => ({ ...current, status: 'running' }));
    }
  };

  const handleCreateRoom = () => {
    const picked = participantRoster.map((participant) => participant.name);
    const topic = topicInput.trim();
    if (picked.length < 2) {
      toast('warning', '至少添加 2 个聊天室成员');
      return;
    }
    if (!topic) {
      toast('warning', '请输入聊天室议题');
      return;
    }
    const setupMessage = createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `Agent 剧场已创建，议题为「${topic}」。参与 Agent：${picked.join('、')}。`,
      status: 'done',
      chatroom: { kind: 'setup', participants: picked, mode: composerMode },
    });
    updateRoom((current) => {
      const base = ensureRoom(current);
      const nextChatroom = createInitialChatroomState({
        status: 'running',
        topic,
        participants: picked,
        participantRoster,
        temporaryAgents: base.chatroom?.temporaryAgents || [],
        settings: {
          ...createInitialChatroomState().settings,
          responseMode: composerMode,
          autoSummarize: base.chatroom?.settings.autoSummarize ?? true,
          maxTurnsPerRound: base.chatroom?.settings.maxTurnsPerRound ?? 6,
          maxRepliesPerAgent: base.chatroom?.settings.maxRepliesPerAgent ?? 2,
          defaultEngine: base.chatroom?.settings.defaultEngine || '',
          defaultModel: base.chatroom?.settings.defaultModel || '',
        },
      });
      return {
        ...base,
        topic,
        selectedAgents: picked,
        messages: [setupMessage],
        chatroom: nextChatroom,
      };
    });
    appendToCentralChat?.(setupMessage);
    toast('success', 'Agent 剧场已创建');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleResetRoom = () => {
    updateRoom((current) => {
      const base = ensureRoom(current);
      return {
        ...base,
        topic: '',
        selectedAgents: [],
        messages: [],
        chatroom: createInitialChatroomState(),
      };
    });
    setDraft('');
    setTopicInput('');
  };

  const getMessageKindLabel = (message: CollaborationRoomMessage) => {
    if (message.chatroom?.kind === 'summary') return '总结';
    if (message.chatroom?.kind === 'vote-result') return '票决';
    if (message.chatroom?.kind === 'vote') return '投票';
    if (message.chatroom?.kind === 'host') return CHATROOM_HOST_NAME;
    if (message.speakerType === 'system') return '系统';
    return 'Agent';
  };

  const runConversationRound = async (hostMessage: string, mode: CollaborationChatroomMode) => {
    const topic = chatroom.topic.trim();
    if (!topic) {
      toast('warning', '请先设置议题');
      return;
    }
    if (!participants.length) {
      toast('warning', '请先添加聊天室成员');
      return;
    }
    const mentions = extractMentions(hostMessage, participants);
    const kickoffParticipants = mode === 'mention-driven' && mentions.length > 0 ? mentions : participants;
    const roundId = `chatround-${Date.now()}`;
    const round: CollaborationChatroomRound = {
      id: roundId,
      title: `第 ${chatroom.rounds.length + 1} 轮`,
      topic,
      mode,
      participants: kickoffParticipants,
      status: 'running',
      startedAt: Date.now(),
    };
    const hostEntry = createRoomMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: CHATROOM_HOST_NAME,
      content: [
        '@用户，我收到你的开场要求，现在开始控场。',
        `开场要求：${hostMessage}`,
        kickoffParticipants.length
          ? `我会先点名 ${kickoffParticipants.join('、')}，按当前议题推进讨论。`
          : '当前还没有可点名成员。',
      ].join('\n'),
      status: 'done',
      chatroom: { kind: 'host', mode, mentions, participants: kickoffParticipants },
    });
    const systemEntry = createRoomMessage({
      roundId,
      speakerType: 'system',
      speakerName: '系统',
      content: `已启动${MODE_LABELS[mode]}轮次，首轮参与者：${kickoffParticipants.join('、')}。`,
      status: 'done',
      chatroom: { kind: 'system', mode, participants: kickoffParticipants },
    });

    appendMessages(hostEntry, systemEntry);
    updateChatroom((current) => ({
      ...current,
      status: 'running',
      rounds: [...current.rounds, round],
      activeRoundId: roundId,
      settings: { ...current.settings, responseMode: mode },
    }));

    const transcript: CollaborationRoomMessage[] = [...messages, hostEntry, systemEntry];
    const queue = [...kickoffParticipants];
    const spokenCounts = new Map<string, number>();
    let turns = 0;
    let failures = 0;

    while (queue.length > 0 && turns < chatroom.settings.maxTurnsPerRound) {
      const agentName = queue.shift();
      if (!agentName) continue;
      const count = (spokenCounts.get(agentName) || 0) + 1;
      if (count > chatroom.settings.maxRepliesPerAgent) continue;
      spokenCounts.set(agentName, count);
      turns += 1;
      try {
        const participantConfig = participantMap.get(agentName);
        const runtimeConfig = resolveChatroomParticipantRuntimeConfig(agentName);
        const sourceDescription = participantConfig?.sourceType === 'agent'
          ? availableAgents.find((agent) => agent.name === participantConfig.sourceAgent)?.description
          : participantConfig?.personaPrompt;
        const output = await callAgent(
          agentName,
          buildAgentPrompt({
            topic,
            mode,
            hostMessage,
            agentName,
            participants,
            transcript,
          }),
          roundId,
          { chatroom: { kind: 'agent', mode } },
          participantConfig ? buildChatroomParticipantRoleConfig(participantConfig, {
            engine: runtimeConfig.effectiveEngine,
            model: runtimeConfig.effectiveModel,
          }, sourceDescription) : undefined
        );
        const transcriptMessage = createRoomMessage({
          roundId,
          speakerType: 'agent',
          speakerName: agentName,
          content: output,
          status: 'done',
          chatroom: { kind: mode === 'facilitated' ? 'agent' : 'agent', mode },
        });
        transcript.push(transcriptMessage);
        if (mode !== 'broadcast') {
          const nextMentions = extractMentions(output, participants).filter((name) => name !== agentName);
          nextMentions.forEach((name) => {
            if ((spokenCounts.get(name) || 0) < chatroom.settings.maxRepliesPerAgent && !queue.includes(name)) {
              queue.push(name);
            }
          });
        }
      } catch (error: any) {
        failures += 1;
        transcript.push(createRoomMessage({
          roundId,
          speakerType: 'system',
          speakerName: '系统',
          content: `${agentName} 回复失败：${error?.message || '未知错误'}`,
          status: 'error',
          error: error?.message || '未知错误',
          chatroom: { kind: 'system', mode },
        }));
      }
    }

    if (chatroom.settings.autoSummarize && transcript.length > 2) {
      await runSummary(roundId, transcript);
    } else {
      markRound(roundId, {
        status: failures === kickoffParticipants.length ? 'failed' : 'completed',
        completedAt: Date.now(),
      });
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    await runConversationRound(text, composerMode);
  };

  useEffect(() => {
    if (!onRegisterMainInputHandler) return;
    if (!useCentralTranscript) {
      onRegisterMainInputHandler(null);
      return;
    }
    onRegisterMainInputHandler((text: string) => {
      const normalized = text.trim();
      if (!normalized) return;
      void runConversationRound(normalized, composerMode);
    });
    return () => {
      onRegisterMainInputHandler(null);
    };
  }, [composerMode, onRegisterMainInputHandler, runConversationRound, useCentralTranscript]);

  const handleChangeTopic = () => {
    const nextTopic = topicDraft.trim();
    if (!nextTopic) {
      toast('warning', '请输入新议题');
      return;
    }
    updateChatroom((current) => ({
      ...current,
      topic: nextTopic,
    }));
    appendMessages(createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `议题已切换为「${nextTopic}」。`,
      status: 'done',
      chatroom: { kind: 'topic-change', mode: composerMode },
    }));
    setTopicDialogOpen(false);
    toast('success', '议题已更新');
  };

  const handleVote = async () => {
    const question = voteDraft.question.trim();
    const options = voteDraft.options.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      toast('warning', '请填写投票问题，并至少提供两个选项');
      return;
    }
    const voteId = `vote-${Date.now()}`;
    const vote: CollaborationChatroomVote = {
      id: voteId,
      question,
      options,
      votes: {},
      reasons: {},
      status: 'open',
      allowAbstain: voteDraft.allowAbstain,
      createdAt: Date.now(),
    };
    updateChatroom((current) => ({
      ...current,
      status: 'voting',
      activeVote: vote,
    }));
    appendMessages(createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `开始投票：「${question}」`,
      status: 'done',
      chatroom: { kind: 'vote', voteId, mode: composerMode },
    }));
    setVoteDialogOpen(false);
    setVoteDraft({ question: '', options: '', allowAbstain: false });

    const nextVote: CollaborationChatroomVote = {
      ...vote,
      votes: {} as Record<string, string>,
      reasons: {} as Record<string, string>,
    };
    for (const participant of participants) {
      try {
        const participantConfig = participantMap.get(participant);
        const runtimeConfig = resolveChatroomParticipantRuntimeConfig(participant);
        const sourceDescription = participantConfig?.sourceType === 'agent'
          ? availableAgents.find((agent) => agent.name === participantConfig.sourceAgent)?.description
          : participantConfig?.personaPrompt;
        const output = await callAgent(
          participant,
          buildVotePrompt({
            topic: chatroom.topic,
            question,
            options,
            allowAbstain: voteDraft.allowAbstain,
          }),
          voteId,
          { chatroom: { kind: 'vote', voteId, mode: composerMode } },
          participantConfig ? buildChatroomParticipantRoleConfig(participantConfig, {
            engine: runtimeConfig.effectiveEngine,
            model: runtimeConfig.effectiveModel,
          }, sourceDescription) : undefined
        );
        const result = extractVoteResult(output, options, voteDraft.allowAbstain);
        nextVote.votes[participant] = result.choice;
        nextVote.reasons![participant] = result.reason;
        updateChatroom((current) => ({
          ...current,
          activeVote: {
            ...(current.activeVote || vote),
            votes: { ...(current.activeVote?.votes || {}), [participant]: result.choice },
            reasons: { ...(current.activeVote?.reasons || {}), [participant]: result.reason },
          },
        }));
      } catch (error: any) {
        nextVote.votes[participant] = '未投';
        nextVote.reasons![participant] = error?.message || '投票失败';
      }
    }
    nextVote.status = 'closed';
    nextVote.completedAt = Date.now();
    const tally = summarizeVote(nextVote);
    appendMessages(createRoomMessage({
      speakerType: 'system',
      speakerName: '系统',
      content: `投票结束：「${question}」。结果：${tally || '无有效投票'}。`,
      status: 'done',
      chatroom: { kind: 'vote-result', voteId, mode: composerMode },
    }));
    updateChatroom((current) => ({
      ...current,
      status: 'running',
      activeVote: null,
      voteHistory: [nextVote, ...current.voteHistory].slice(0, 10),
    }));
    toast('success', '投票完成');
  };

  if (chatroom.status === 'setup') {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-slate-800/60 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(17,24,39,0.92))] p-4 text-slate-50 shadow-[0_18px_60px_rgba(15,23,42,0.28)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/75">Collaboration Setup</div>
              <h3 className="mt-2 text-xl font-semibold">安排聊天室成员</h3>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                先确定聊天室成员，再设定议题、人格来源和协作方式。
              </p>
            </div>
            <Badge className="border-cyan-400/30 bg-cyan-400/10 text-cyan-100">产品模式</Badge>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border bg-background p-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">聊天室成员</h4>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">先把成员加进房间。每个人都有自己的名字、人格来源和模型策略。</p>
              </div>
              <Button size="sm" onClick={openCreateParticipantDialog}>新增成员</Button>
            </div>
            <div className="mt-4 space-y-3">
              {participantRoster.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  还没有聊天室成员。先新增两个成员，再开始讨论。
                </div>
              ) : participantRoster.map((participant) => {
                const runtime = resolveChatroomParticipantRuntimeConfig(participant.name);
                const sourceDescription = participant.sourceType === 'agent'
                  ? availableAgents.find((agent) => agent.name === participant.sourceAgent)?.description
                  : participant.personaPrompt;
                return (
                  <div key={participant.id} className="rounded-xl border bg-background/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{participant.name}</div>
                        <div className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
                          <div>{participant.sourceType === 'agent' ? 'Agent 人格' : '临时人格'}</div>
                          <div>{runtime.effectiveEngine || '跟随全局'} / {runtime.effectiveModel || '跟随全局'}</div>
                          <div>
                            {participant.sourceType === 'agent'
                              ? `来源：${participant.sourceAgent || '-'}`
                              : `来源：${sourceDescription || '临时人格'}`
                            }
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => openEditParticipantDialog(participant)}>
                          编辑
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => updateChatroom((current) => ({
                            ...current,
                            participantRoster: (current.participantRoster || []).filter((item) => item.id !== participant.id),
                            participants: (current.participantRoster || []).filter((item) => item.id !== participant.id).map((item) => item.name),
                          }))}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="space-y-4 rounded-xl border bg-background p-4">
            <div>
              <h4 className="text-sm font-semibold">房间议题</h4>
              <Input
                value={topicInput}
                onChange={(event) => setTopicInput(event.target.value)}
                className="mt-3"
                placeholder="例如：是否将上下文工作台升级为正式协作能力"
              />
            </div>
            <div>
              <h4 className="text-sm font-semibold">默认模型策略</h4>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <EngineSelect
                  value={chatroom.settings.defaultEngine || ''}
                  onChange={(value) => setChatroomDefaultRuntime({ engine: value })}
                  allowGlobal
                />
                <ModelSelect
                  value={chatroom.settings.defaultModel || ''}
                  onChange={(value) => setChatroomDefaultRuntime({ model: value })}
                  engine={chatroom.settings.defaultEngine || undefined}
                  allowGlobal
                />
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">新成员默认继承这里的模型策略，也可以在各自卡片里切成独立配置。</p>
            </div>
            <div>
              <h4 className="text-sm font-semibold">默认协作模式</h4>
              <Select value={composerMode} onValueChange={(value: CollaborationChatroomMode) => setComposerMode(value)}>
                <SelectTrigger className="mt-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facilitated">百灵鸟控场</SelectItem>
                  <SelectItem value="mention-driven">点名接话</SelectItem>
                  <SelectItem value="broadcast">广播讨论</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {composerMode === 'facilitated'
                  ? '允许 Agent 在发言末尾继续点名，系统会自动收束。'
                  : composerMode === 'mention-driven'
                    ? '只有被点名的 Agent 会接话，节奏最可控。'
                    : '适合快速收集所有人的第一反应。'}
              </p>
            </div>
            <Button className="w-full" onClick={handleCreateRoom}>
              创建聊天室
            </Button>
          </section>
        </div>
        <Dialog open={temporaryParticipantDialogOpen} onOpenChange={setTemporaryParticipantDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{temporaryAgentDraft.id ? '编辑聊天室成员' : '新增聊天室成员'}</DialogTitle>
              <DialogDescription>给成员设置名字、人格来源和模型策略。</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">成员名字</div>
                <Input
                  value={temporaryAgentDraft.name}
                  onChange={(event) => setTemporaryAgentDraft((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="例如：一辩架构师"
                />
              </div>
              <div className="space-y-1.5">
                <div className="text-xs text-muted-foreground">人格来源</div>
                <Select
                  value={temporaryAgentDraft.sourceType}
                  onValueChange={(value: 'agent' | 'custom') => setTemporaryAgentDraft((prev) => ({ ...prev, sourceType: value }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent">现有 Agent</SelectItem>
                    <SelectItem value="custom">临时人格</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {temporaryAgentDraft.sourceType === 'agent' ? (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">选择 Agent</div>
                  <Select
                    value={temporaryAgentDraft.sourceAgent}
                    onValueChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, sourceAgent: value }))}
                  >
                    <SelectTrigger><SelectValue placeholder="选择 Agent" /></SelectTrigger>
                    <SelectContent>
                      {availableAgents.map((agent) => (
                        <SelectItem key={agent.name} value={agent.name}>{agent.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">人格提示词</div>
                  <Textarea
                    rows={4}
                    value={temporaryAgentDraft.personaPrompt}
                    onChange={(event) => setTemporaryAgentDraft((prev) => ({ ...prev, personaPrompt: event.target.value }))}
                    placeholder="描述这个成员的立场、关注点和表达方式"
                  />
                </div>
              )}
              <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">使用默认模型策略</div>
                  <div className="text-xs text-muted-foreground">关闭后可为这个成员单独设置引擎和模型。</div>
                </div>
                <Switch
                  checked={temporaryAgentDraft.useDefaultModel}
                  onCheckedChange={(checked) => setTemporaryAgentDraft((prev) => ({ ...prev, useDefaultModel: checked }))}
                />
              </div>
              {temporaryAgentDraft.useDefaultModel ? null : (
                <div className="grid gap-2 sm:grid-cols-2">
                  <EngineSelect
                    value={temporaryAgentDraft.engine}
                    onChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, engine: value }))}
                    allowGlobal
                  />
                  <ModelSelect
                    value={temporaryAgentDraft.model}
                    onChange={(value) => setTemporaryAgentDraft((prev) => ({ ...prev, model: value }))}
                    engine={temporaryAgentDraft.engine || chatroom.settings.defaultEngine || undefined}
                    allowGlobal
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setTemporaryParticipantDialogOpen(false)}>取消</Button>
              <Button onClick={handleSubmitParticipantDraft}>{temporaryAgentDraft.id ? '保存成员' : '添加成员'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-800/60 bg-[linear-gradient(140deg,rgba(10,15,28,1),rgba(21,32,56,0.96))] p-4 text-slate-50 shadow-[0_18px_60px_rgba(2,6,23,0.32)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-[0.22em] text-cyan-200/75">Chatroom</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <h3 className="truncate text-xl font-semibold">{chatroom.topic}</h3>
              <Badge className="border-white/15 bg-white/10 text-slate-100">{MODE_LABELS[chatroom.settings.responseMode]}</Badge>
              <Badge className="border-white/15 bg-white/10 text-slate-100">{participants.length} 位成员</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
              <span>轮次 {chatroom.rounds.length}</span>
              <span>总结 {chatroom.summaries.length}</span>
              <span>投票 {chatroom.voteHistory.length}{chatroom.activeVote ? ' + 进行中' : ''}</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {participants.map((name) => (
                <div key={`participant-${name}`} className="flex items-center gap-2 rounded-full border border-white/12 bg-white/6 px-2.5 py-1.5">
                  <Avatar className="h-7 w-7 ring-1 ring-white/15">
                    <AvatarImage src={getSpeakerAvatarSrc(name, 'agent')} alt={name} className="object-cover" />
                    <AvatarFallback className="bg-white/10 text-[10px] font-semibold text-slate-100">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[140px] truncate text-xs text-slate-100">{name}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid min-w-[240px] gap-2 sm:grid-cols-2">
            <Button variant="outline" className="border-white/20 bg-white/5 text-slate-100 hover:bg-white/10" onClick={() => setTopicDialogOpen(true)}>
              切换议题
            </Button>
            <Button variant="outline" className="border-white/20 bg-white/5 text-slate-100 hover:bg-white/10" onClick={() => setVoteDialogOpen(true)}>
              发起投票
            </Button>
            <Button variant="ghost" className="sm:col-span-2 text-slate-300 hover:bg-white/10 hover:text-white" onClick={handleResetRoom}>
              结束房间
            </Button>
          </div>
        </div>
      </div>

      {!useCentralTranscript ? (
      <div>
        <CollaborationRoomSurface
          messages={messages}
          hideMessages={false}
          hideComposer={false}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => void handleSend()}
          submitLabel="发起本轮"
          submitDisabled={!draft.trim()}
          placeholder={`输入 ${CHATROOM_HOST_NAME} 的开场消息。可直接 @Agent 名称，也可先点 @全员 收集第一轮回应。`}
          mentionTargets={participants}
          onInsertMention={(value) => setDraft((prev) => `${prev}${value}`.trimStart())}
          inputRef={inputRef}
          bottomRef={bottomRef}
          emptyText={`还没有消息。发起 ${CHATROOM_HOST_NAME} 的第一轮消息后，这里会显示完整的协作过程。`}
          helperText={`Ctrl/Cmd + Enter 发送。主持控场模式下，Agent 的点名会触发下一跳，直到达到轮次上限或不再继续。`}
          getSpeakerAvatarSrc={getSpeakerAvatarSrc}
          getInitials={getInitials}
          getMessageKindLabel={getMessageKindLabel}
        />
      </div>
      ) : null}

      <Dialog open={topicDialogOpen} onOpenChange={setTopicDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>切换议题</DialogTitle>
            <DialogDescription>更新聊天室的主议题，系统会把本次变更记录到消息流里。</DialogDescription>
          </DialogHeader>
          <Input value={topicDraft} onChange={(event) => setTopicDraft(event.target.value)} placeholder="输入新的议题" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setTopicDialogOpen(false)}>取消</Button>
            <Button onClick={handleChangeTopic}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={voteDialogOpen} onOpenChange={setVoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>发起投票</DialogTitle>
            <DialogDescription>正式发起一轮表决。每个 Agent 会返回选择和一句理由。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={voteDraft.question}
              onChange={(event) => setVoteDraft((prev) => ({ ...prev, question: event.target.value }))}
              placeholder="例如：chatroom 第一优先级要不要先做状态归一"
            />
            <Textarea
              value={voteDraft.options}
              onChange={(event) => setVoteDraft((prev) => ({ ...prev, options: event.target.value }))}
              rows={4}
              placeholder="每行一个选项，或用逗号分隔"
            />
            <div className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <div>
                <div className="font-medium">允许弃权</div>
                <div className="text-xs text-muted-foreground">开启后，Agent 可以选择弃权而不是强行站队。</div>
              </div>
              <Switch
                checked={voteDraft.allowAbstain}
                onCheckedChange={(checked) => setVoteDraft((prev) => ({ ...prev, allowAbstain: checked }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoteDialogOpen(false)}>取消</Button>
            <Button onClick={() => void handleVote()}>开始投票</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
