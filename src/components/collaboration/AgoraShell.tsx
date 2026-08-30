'use client';

import dynamic from '@/lib/navigation/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FolderOpen, GitBranch, MessageSquareText, PanelRightClose, PanelRightOpen, Settings2 } from 'lucide-react';
import { agentApi, agoraApi } from '@/lib/core/api';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import StackedList, { type StackedListMember } from '@/components/ui/stacked-list';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { useChat } from '@/contexts/ChatContext';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { cn } from '@/lib/core/utils';
import type {
  CollaborationChatroomMode,
  CollaborationChatroomParticipant,
  CollaborationRoomMessage,
  CollaborationRoomState,
  SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';
import { AgoraChatPanel } from '@/components/collaboration/agora/AgoraChatPanel';
import { ensureChatroomRoomState } from '@/lib/agora/chatroom-state';
import { detectOpeningRole, type OpeningRole } from '@/lib/agora/opening-copy';
import { mergeFinalRawStreamContent } from '@/lib/chat/ai-process-blocks';
import { formatAceReasoning } from '@/lib/chat/ace-reasoning';
import { parseAceSseEventData, storeChatStreamSseEventAsAgentMessage, type AceStreamChunk } from '@/client/ai/messages';
import { describeEventSourceError } from '@/lib/core/safe-event-source';

const WorkspaceEditor = dynamic(() => import('@/components/workspace/WorkspaceEditor').then((m) => m.WorkspaceEditor), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载工作区...</div>,
});

const GitWorkspaceDiffPanel = dynamic(() => import('@/components/workflow/GitWorkspaceDiffPanel').then((m) => m.GitWorkspaceDiffPanel), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在加载 Git 变更...</div>,
});

type AgoraAuxiliaryTab = {
  id: string;
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};

type AppendSessionMessage = (
  sessionId: string,
  message: {
    id?: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    rawContent?: string;
    cards?: any[];
    engine?: string;
    model?: string;
    timestamp?: number;
  }
) => Promise<void>;

interface AgoraShellProps {
  activeSessionId: string | null;
  sessionTitle?: string | null;
  sessionWorkbenchState?: SessionWorkbenchState;
  setSessionWorkbenchState: (
    state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)
  ) => void;
  appendSessionMessage?: AppendSessionMessage;
  workingDirectory?: string;
  hideComposer?: boolean;
  onInsertIntoMainInput?: (content: string) => void;
  onRegisterMainInputHandler?: (handler: ((text: string) => void) | null) => void;
  auxiliaryTabs?: AgoraAuxiliaryTab[];
  chatBanner?: ReactNode;
  chatBannerPlacement?: 'top' | 'bottom-floating' | 'inline';
  allowOpeningMessages?: boolean;
  allowGuestManagement?: boolean;
  allowTopicControls?: boolean;
  showComposerControls?: boolean;
  lockWorkspace?: boolean;
  fixedGuestPanel?: boolean;
  defaultMemberPanelCollapsed?: boolean;
  inlineContentSpeakerName?: string;
  currentUser?: {
    username?: string;
    email?: string;
    avatar?: string;
    name?: string;
    nickname?: string;
    displayName?: string;
  } | null;
}

const MODE_LABELS: Record<CollaborationChatroomMode, string> = {
  broadcast: '全员回应',
  'mention-driven': '点名接话',
  facilitated: '群聊',
};

const MODE_OPTIONS: Array<{ value: CollaborationChatroomMode; label: string; title: string }> = [
  { value: 'mention-driven', label: '点名', title: '点名模式：只有被 @ 的 Agent 响应' },
  { value: 'broadcast', label: '广播', title: '广播模式：群内 Agent 同轮响应' },
  { value: 'facilitated', label: '主持', title: '主持人模式：由主持人组织发言顺序' },
];

type RoomAgentListItem = {
  name: string;
  description?: string;
  systemPrompt?: string;
  team?: string;
  roleType?: string;
  engine?: string;
  model?: string;
};

function getInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function getCollaborationActionLabel(message: CollaborationRoomMessage) {
  if (message.speakerType === 'human') return '你';
  if (message.chatroom?.kind === 'summary') return '总结';
  if (message.chatroom?.kind === 'vote-result') return '票决';
  if (message.chatroom?.kind === 'vote') return '投票';
  if (message.chatroom?.kind === 'topic-change') return '议题';
  if (message.chatroom?.kind === 'setup') return '开场';
  if (message.speakerType === 'system') return '系统';
  return 'Agent';
}

const ROLE_OPENING_LINE_TEMPLATES: Record<OpeningRole, string[]> = {
  engineer: [
    '大家好～工程师前来报到，后续会从技术实现角度积极参与讨论，多多交流！',
    '各位好呀，工程师已就位，专注落地实现，有技术落地问题随时沟通～',
    '大家好，我是工程师，在线待命，全力配合技术实现相关探讨！',
    '哈喽各位～工程师报到啦，后续聚焦落地细节，一起推进技术方案！',
    '大家好呀，工程师在线，会从实操实现层面参与本次讨论，多多指教～',
  ],
  'code-reviewer': [
    '大家好～代码评审已就位，很高兴加入讨论，后续会及时补充评审建议！',
    '哈喽各位，我是代码评审，在线参与交流，后续输出代码质量相关观点～',
    '大家好呀，代码评审前来报到，前期跟进讨论，后期完善专业评审意见！',
    '各位好～代码评审视角已上线，积极参与探讨，助力代码规范与优化！',
    '大家好，很高兴加入本次沟通，代码评审待命，后续同步相关看法与建议！',
  ],
  tester: [
    '大家好～测试工程师在线，随时准备同步技术相关内容，全力配合！',
    '哈喽各位，我是测试岗，已就位待命，及时同步技术与测试相关信息～',
    '大家好呀，测试这边在线，准备同步技术要点，积极参与沟通！',
    '各位好～测试工程师报到，在线同步技术相关内容，助力项目推进！',
    '大家好，测试岗已上线，专注同步技术信息，随时交流探讨～',
  ],
  architect: [
    '大家好～架构师就位啦，后续从架构层面输出专业观点，多多交流！',
    '哈喽各位，架构师在线待命，聚焦整体架构，分享顶层设计思路～',
    '大家好呀，架构师前来报到，后续补充架构维度的专业看法！',
    '各位好～我是架构师，已就位，从架构全局参与本次讨论！',
    '大家好，架构视角已上线，后续输出架构层面思路，全力配合～',
  ],
  'product-manager': [
    '大家好～产品经理在线待命，架构 & 整体方案视角已就位，输出全局思路！',
    '哈喽各位，产品经理报到，可提供整体方案思路，把控整体方向～',
    '大家好呀，产品视角就位，兼顾架构与整体方案，随时沟通！',
    '各位好～我是产品经理，已待命，输出整体规划与方案思路！',
    '大家好，产品经理在线，统筹整体方案，助力项目落地推进～',
  ],
  copywriter: [
    '大家好～文案岗在线待命，业务和需求相关问题，我全程跟进对接！',
    '哈喽各位，文案前来报到，专注跟进业务需求，及时响应各类问题～',
    '大家好呀，文案已就位，业务、需求类问题随时找我沟通处理！',
    '各位好～我是文案，在线待命，全力跟进业务与需求相关事宜！',
    '大家好，文案视角上线，聚焦业务需求，全程做好跟进配合～',
  ],
  generic: [
    '我已就位，后续会围绕议题参与讨论',
    '大家好，我在线，随时跟进这个议题',
    '我这边已准备好，后续直接参与讨论',
    '在线待命，有需要可以直接 @我',
    '我先加入讨论，后续补充相关观点',
  ],
};

const OPENING_LOCAL_DELAY_MIN_MS = 90;
const OPENING_LOCAL_DELAY_JITTER_MS = 90;
const OPENING_TYPEWRITER_DELAY_MIN_MS = 18;
const OPENING_TYPEWRITER_DELAY_JITTER_MS = 12;
const OPENING_CHUNK_MIN_CHARS = 3;
const OPENING_CHUNK_MAX_CHARS = 5;

function stableOpeningIndex(seed: string, modulo: number) {
  if (modulo <= 0) return 0;
  let hash = 0;
  for (const char of seed) {
    hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  }
  return hash % modulo;
}

function getUsedOpeningLines(messages: CollaborationRoomMessage[]) {
  return new Set(
    messages
      .filter((message) => message.speakerType === 'agent' && message.chatroom?.kind === 'setup')
      .map((message) => String(message.rawContent || message.content || '').trim())
      .filter(Boolean)
  );
}

function buildOpeningLineCandidates(participant: CollaborationChatroomParticipant) {
  const role = detectOpeningRole(participant);
  return ROLE_OPENING_LINE_TEMPLATES[role] || ROLE_OPENING_LINE_TEMPLATES.generic;
}

function pickOpeningLine(participant: CollaborationChatroomParticipant, topic: string, usedLines: Set<string>) {
  const candidates = buildOpeningLineCandidates(participant);
  const available = candidates.filter((line) => !usedLines.has(line));
  const pool = available.length ? available : candidates;
  const seed = `${participant.id}:${participant.name}:${topic}:${usedLines.size}`;
  return pool[stableOpeningIndex(seed, pool.length)];
}

function splitOpeningLineIntoPartials(line: string) {
  const chars = Array.from(line);
  const partials: string[] = [];
  let index = 0;
  while (index < chars.length) {
    const chunkSize = OPENING_CHUNK_MIN_CHARS
      + Math.floor(Math.random() * (OPENING_CHUNK_MAX_CHARS - OPENING_CHUNK_MIN_CHARS + 1));
    index = Math.min(chars.length, index + chunkSize);
    partials.push(chars.slice(0, index).join(''));
  }
  return partials;
}

function replaceRoomMessageById(
  room: CollaborationRoomState,
  messageId: string,
  updater: (message: CollaborationRoomMessage) => CollaborationRoomMessage
) {
  const base = ensureChatroomRoomState(room);
  const messages = base.messages || [];
  const existingIndex = messages.findIndex((item) => item.id === messageId);
  if (existingIndex < 0) return base;
  const nextMessages = [...messages];
  nextMessages[existingIndex] = updater(nextMessages[existingIndex]);
  return {
    ...base,
    messages: nextMessages,
  };
}

function hasOwnKey<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function replaceAgentSession(sessions: Record<string, string>, agentName: string, nextSessionId?: string): Record<string, string> {
  const next = { ...sessions };
  if (nextSessionId) next[agentName] = nextSessionId;
  else delete next[agentName];
  return next;
}

function formatAgentStreamError(
  data: Record<string, any> | null | undefined,
  fallback = 'Agent 发言失败',
): string {
  const message = String(data?.message || data?.error || fallback).trim() || fallback;
  return [
    data?.sourceLabel ? `来源：${String(data.sourceLabel)}` : '',
    data?.stage ? `阶段：${String(data.stage)}` : '',
    data?.code ? `错误代码：${String(data.code)}` : '',
    data?.streamId ? `流标识：${String(data.streamId)}` : '',
    data?.engine ? `引擎：${String(data.engine)}` : '',
    data?.model ? `模型：${String(data.model)}` : '',
    `原始错误：${message}`,
  ].filter(Boolean).join('\n');
}

function appendAgentStreamError(partial: string, errorText: string): string {
  const normalizedPartial = String(partial || '').trim();
  return normalizedPartial ? `${normalizedPartial}\n\n---\n${errorText}` : errorText;
}

function buildOpeningMessageId(sessionId: string, participant: CollaborationChatroomParticipant): string {
  return `agora-opening-${sessionId}-${participant.guestConfigId || participant.id || participant.name}`;
}

export function AgoraShell({
  activeSessionId,
  sessionTitle,
  sessionWorkbenchState,
  setSessionWorkbenchState,
  appendSessionMessage,
  workingDirectory,
  hideComposer = true,
  onInsertIntoMainInput,
  onRegisterMainInputHandler,
  auxiliaryTabs,
  chatBanner,
  chatBannerPlacement = 'top',
  allowOpeningMessages = true,
  allowGuestManagement = true,
  allowTopicControls = true,
  showComposerControls = true,
  lockWorkspace = false,
  fixedGuestPanel = false,
  defaultMemberPanelCollapsed = false,
  inlineContentSpeakerName,
  currentUser,
}: AgoraShellProps) {
  const { toast } = useToast();
  const { skillSettings, mcpSettings } = useChat();
  const [activeTab, setActiveTab] = useState('chat');
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [guestPanelCollapsed, setGuestPanelCollapsed] = useState(defaultMemberPanelCollapsed);
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [availableAgents, setAvailableAgents] = useState<RoomAgentListItem[]>([]);
  const [openingSequenceTick, setOpeningSequenceTick] = useState(0);
  const openingInFlightRef = useRef<Set<string>>(new Set());
  const openingMessagesRef = useRef<CollaborationRoomMessage[]>([]);

  const room = sessionWorkbenchState?.collaborationRoom || null;
  const normalizedRoom = useMemo(() => ensureChatroomRoomState(room), [room]);
  useEffect(() => {
    openingMessagesRef.current = normalizedRoom.messages || [];
  }, [normalizedRoom.messages]);
  const chatroom = normalizedRoom.chatroom!;
  const guestRoster = useMemo<CollaborationChatroomParticipant[]>(() => {
    if (chatroom.participantRoster?.length) return chatroom.participantRoster;
    return (chatroom.participants || []).map((name, index) => ({
      id: `participant-${index}-${name}`,
      name,
      sourceType: 'agent' as const,
      sourceAgent: name,
      createdAt: Date.now(),
      useDefaultModel: true,
    } satisfies CollaborationChatroomParticipant));
  }, [chatroom.participantRoster, chatroom.participants]);
  const guestRosterIdentityKey = useMemo(
    () => guestRoster.map((participant) => `${participant.id}:${participant.name}`).join('|'),
    [guestRoster]
  );
  const guests = useMemo(() => guestRoster.map((participant) => participant.name), [guestRoster]);
  const enabledSkillNames = useMemo(() => (
    Object.entries(skillSettings || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([name]) => name.trim())
      .filter(Boolean)
      .sort()
  ), [skillSettings]);
  const pinnedWorkspacePath = String(chatroom.settings.workspacePath || '').trim();
  const defaultWorkspacePath = String(workingDirectory || '').trim();
  const resolvedWorkspacePath = pinnedWorkspacePath || (lockWorkspace ? defaultWorkspacePath : '');
  const roomTitle = chatroom.topic?.trim() || sessionTitle?.trim() || '群聊';
  const displayRoom = useMemo(() => (
    chatroom.status === 'setup'
      ? {
          ...normalizedRoom,
          chatroom: {
            ...chatroom,
            status: 'running' as const,
          },
        }
      : normalizedRoom
  ), [chatroom, normalizedRoom]);
  const displayChatroom = displayRoom.chatroom!;
  const tabItems = useMemo(() => {
    const defaultTabs: AgoraAuxiliaryTab[] = [
      {
        id: 'workspace',
        title: '工作区',
        icon: <FolderOpen className="h-4 w-4" />,
        content: resolvedWorkspacePath ? (
          <WorkspaceEditor
            open
            onOpenChange={() => {}}
            workspacePath={resolvedWorkspacePath}
            title={`${roomTitle} · 工作区`}
            presentation="page"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            未设置工作区
          </div>
        ),
      },
      {
        id: 'changes',
        title: '变更',
        icon: <GitBranch className="h-4 w-4" />,
        content: resolvedWorkspacePath ? (
          <GitWorkspaceDiffPanel workspacePath={resolvedWorkspacePath} presentation="embedded" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            未设置工作区
          </div>
        ),
      },
    ];
    return auxiliaryTabs?.length ? auxiliaryTabs : defaultTabs;
  }, [auxiliaryTabs, resolvedWorkspacePath, roomTitle]);

  useEffect(() => {
    if (activeTab === 'chat') return;
    if (!tabItems.some((tab) => tab.id === activeTab && !tab.disabled)) {
      setActiveTab('chat');
    }
  }, [activeTab, tabItems]);

  useEffect(() => {
    let cancelled = false;
    agentApi.listAgents()
      .then((agentData) => {
        if (cancelled) return;
        setAvailableAgents(Array.isArray(agentData?.agents) ? agentData.agents : []);
      })
      .catch((error: any) => {
        if (cancelled) return;
        toast('warning', error?.message || '加载 Agent 列表失败');
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const updateRoom = useCallback((updater: (roomState: CollaborationRoomState) => CollaborationRoomState) => {
    setSessionWorkbenchState((prev) => {
      const base = ensureChatroomRoomState(prev?.collaborationRoom);
      const nextRoom = updater(base);
      const previousMode = prev?.conversationMode;
      return {
        ...(prev || {}),
        conversationMode: previousMode && previousMode.startsWith('workflow-') ? previousMode : 'agent-chat',
        collaborationRoom: {
          ...nextRoom,
          messages: (nextRoom.messages || []).slice(-80),
          rounds: (nextRoom.rounds || []).slice(-16),
        },
      };
    });
  }, [setSessionWorkbenchState]);

  useEffect(() => {
    if (chatroom.status !== 'setup') return;
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      return {
        ...base,
        chatroom: base.chatroom ? {
          ...base.chatroom,
          status: 'running',
        } : base.chatroom,
      };
    });
  }, [chatroom.status, updateRoom]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (lockWorkspace) return;
    let cancelled = false;
    agoraApi.ensureWorkspace({
      sessionId: activeSessionId,
      sourceWorkspace: defaultWorkspacePath || undefined,
      title: roomTitle,
      skills: skillSettings,
      mcpServers: mcpSettings,
    })
      .then((result) => {
        if (cancelled || !result.workspacePath) return;
        updateRoom((current) => {
          const base = ensureChatroomRoomState(current);
          if (base.chatroom?.settings.workspacePath) return base;
          return {
            ...base,
            chatroom: base.chatroom ? {
              ...base.chatroom,
              settings: {
                ...base.chatroom.settings,
                workspacePath: result.workspacePath,
              },
            } : base.chatroom,
          };
        });
      })
      .catch((error: any) => {
        if (!cancelled) toast('warning', error?.message || '准备群聊工作区失败');
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, defaultWorkspacePath, lockWorkspace, mcpSettings, roomTitle, skillSettings, toast, updateRoom]);

  const withAgoraRuntimeSettings = useCallback((config?: Record<string, any>) => {
    if (!config) return config;
    const existingSkills = Array.isArray(config.skills)
      ? config.skills.map((item) => String(item || '').trim()).filter(Boolean)
      : [];
    const skills = Array.from(new Set([...existingSkills, ...enabledSkillNames])).sort();
    const skillPrompt = skills.length
      ? [
          `当前群聊启用了这些 Skills：${skills.join(', ')}。`,
          '如需使用 skill，请优先查看工作区 .agents/skills/{skill-name}/SKILL.md，并按其中流程执行。',
        ].join('\n')
      : '';
    return {
      ...config,
      ...(skills.length ? { skills } : {}),
      systemPrompt: [config.systemPrompt || '', skillPrompt].filter(Boolean).join('\n'),
    };
  }, [enabledSkillNames]);

  const appendToCentralChat = useCallback((message: CollaborationRoomMessage) => {
    if (!activeSessionId || !appendSessionMessage) return;
    const role = message.speakerType === 'human'
      ? 'user'
      : message.status === 'error'
        ? 'error'
        : 'assistant';
    void appendSessionMessage(activeSessionId, {
      id: `chat-${message.id}`,
      role,
      content: message.content,
      rawContent: message.rawContent || message.content,
      timestamp: message.createdAt,
      engine: message.engine,
      model: message.model,
      cards: [
        {
          type: 'collaboration_speech',
          speakerName: message.speakerName,
          speakerType: message.speakerType,
          actionLabel: getCollaborationActionLabel(message),
        },
        ...((message.cards || []).filter(Boolean)),
      ],
    });
  }, [activeSessionId, appendSessionMessage]);

  const handleSaveWorkspacePath = useCallback(() => {
    const nextPath = workspaceDraft.trim();
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      return {
        ...base,
        chatroom: base.chatroom ? {
          ...base.chatroom,
          settings: {
            ...base.chatroom.settings,
            workspacePath: nextPath,
          },
        } : base.chatroom,
      };
    });
    setWorkspaceDialogOpen(false);
    toast('success', nextPath ? '已绑定群聊工作区' : '已改为跟随当前工作目录');
  }, [toast, updateRoom, workspaceDraft]);

  const resetWorkspacePath = useCallback(() => {
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      return {
        ...base,
        chatroom: base.chatroom ? {
          ...base.chatroom,
          settings: {
            ...base.chatroom.settings,
            workspacePath: '',
          },
        } : base.chatroom,
      };
    });
    setWorkspaceDialogOpen(false);
    setWorkspaceDraft('');
    toast('success', '已改为跟随当前工作目录');
  }, [toast, updateRoom]);

  const setResponseMode = useCallback((mode: CollaborationChatroomMode) => {
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      return {
        ...base,
        chatroom: base.chatroom ? {
          ...base.chatroom,
          settings: {
            ...base.chatroom.settings,
            responseMode: mode,
          },
        } : base.chatroom,
      };
    });
  }, [updateRoom]);

  const addAgentToRoom = useCallback((agent: any) => {
    const name = String(agent?.name || '').trim();
    if (!name) return;
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      const currentChatroom = base.chatroom!;
      const roster = currentChatroom.participantRoster || [];
      if (roster.some((participant) => participant.name === name || participant.sourceAgent === name || participant.runtimeAgentName === name)) {
        return base;
      }
      const nextParticipant: CollaborationChatroomParticipant = {
        id: `agent-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        sourceType: 'agent',
        sourceAgent: name,
        runtimeAgentName: name,
        systemPrompt: typeof agent?.systemPrompt === 'string' ? agent.systemPrompt : undefined,
        useDefaultModel: !agent?.model,
        engine: typeof agent?.engine === 'string' ? agent.engine : '',
        model: typeof agent?.model === 'string' ? agent.model : '',
        createdAt: Date.now(),
      };
      const nextRoster = [...roster, nextParticipant];
      return {
        ...base,
        selectedAgents: nextRoster.map((participant) => participant.name),
        chatroom: {
          ...currentChatroom,
          status: 'running',
          participants: nextRoster.map((participant) => participant.name),
          participantRoster: nextRoster,
        },
      };
    });
    toast('success', `已拉入 Agent：${name}`);
  }, [toast, updateRoom]);

  const removeGuest = useCallback((guestName: string) => {
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      const currentChatroom = base.chatroom!;
      const nextRoster = (currentChatroom.participantRoster || [])
        .filter((participant) => participant.name !== guestName);
      return {
        ...base,
        selectedAgents: nextRoster.map((participant) => participant.name),
        chatroom: {
          ...currentChatroom,
          participants: nextRoster.map((participant) => participant.name),
          participantRoster: nextRoster,
        },
      };
    });
  }, [updateRoom]);

  const callAgent = useCallback(async (
    agentName: string,
    message: string,
    roundId?: string,
    messagePatch?: Pick<CollaborationRoomMessage, 'chatroom'>,
    temporaryRoleConfig?: Record<string, any>,
    lifecycle?: {
      onStreamStart?: (stream: {
        streamId: string;
        runtimeName: string;
        stop: () => Promise<void>;
      }) => void;
      onDelta?: (content: string, accumulated: string) => void;
    }
  ) => {
    const participant = guestRoster.find((item) => item.name === agentName);
    const runtimeName = participant?.runtimeAgentName || participant?.guestConfigId || agentName;
    const existingSession = normalizedRoom.agentSessions?.[runtimeName] || undefined;
    const agoraExpectedResultType = messagePatch?.chatroom?.kind === 'summary'
      ? 'summary'
      : messagePatch?.chatroom?.kind === 'vote'
        ? 'vote'
        : 'speech';
    const stream = await agentApi.streamChat(runtimeName, {
      message,
      mode: 'standalone-chat',
      sessionId: existingSession,
      frontendSessionId: activeSessionId || undefined,
      workingDirectory: resolvedWorkspacePath || undefined,
      workflowContext: {
        frontendSessionId: activeSessionId || undefined,
        collaborationTopic: chatroom.topic || normalizedRoom.topic || roomTitle,
        collaborationSpeaker: agentName,
        roundId,
        temporaryLab: 'agora',
        agoraExpectedResultType,
      },
      temporaryRoleConfig: withAgoraRuntimeSettings(temporaryRoleConfig),
      requestedMcpServers: mcpSettings,
    });
    return await new Promise<{
      status: 'done' | 'stopped';
      content: string;
      rawContent: string;
      engine?: string;
      model?: string;
    }>((resolve, reject) => {
      let settled = false;
      let stoppedByUser = false;
      let partialContent = '';
      let latestEngineError = '';
      let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;

      const closeEvents = () => {
        try {
          stream.events.close();
        } catch {}
      };

      const finishResolve = (value: {
        status: 'done' | 'stopped';
        content: string;
        rawContent: string;
        engine?: string;
        model?: string;
      }) => {
        if (settled) return;
        settled = true;
        closeEvents();
        resolve(value);
      };

      const finishReject = (error: Error & {
        code?: string;
        partialContent?: string;
        rawContent?: string;
        engine?: string;
        model?: string;
      }) => {
        if (settled) return;
        settled = true;
        closeEvents();
        reject(error);
      };

      const syncRuntimeSession = (nextSessionId?: string) => {
        updateRoom((current) => ({
          ...current,
          agentSessions: replaceAgentSession(current.agentSessions || {}, runtimeName, nextSessionId),
          chatroom: current.chatroom ? {
            ...current.chatroom,
            participantRoster: (current.chatroom.participantRoster || []).map((item) => (
              item.id === participant?.id || (participant?.guestConfigId && item.guestConfigId === participant.guestConfigId)
                ? { ...item, runtimeAgentName: runtimeName }
                : item
            )),
          } : current.chatroom,
        }));
      };

      lifecycle?.onStreamStart?.({
        streamId: stream.streamId,
        runtimeName,
        stop: async () => {
          if (settled) return;
          stoppedByUser = true;
          try {
            await agentApi.stopChatStream(runtimeName, { streamId: stream.streamId });
          } catch {}
          finishResolve({
            status: 'stopped',
            content: partialContent.trim() || '已停止',
            rawContent: partialContent,
          });
        },
      });

      stream.events.addEventListener('delta', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const content = String(data?.content || '');
        partialContent += content;
        const row = storeChatStreamSseEventAsAgentMessage('delta', data, {
          chatId: stream.streamId,
          stepKey: runtimeName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'agora-agent-chat',
        }, aiPrevious);
        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
        lifecycle?.onDelta?.(content, partialContent);
      }) as EventListener);

      stream.events.addEventListener('thinking', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const content = String(data?.content || '');
        const row = storeChatStreamSseEventAsAgentMessage('thinking', { ...data, content: formatAceReasoning(content) }, {
          chatId: stream.streamId,
          stepKey: runtimeName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'agora-agent-chat',
        }, aiPrevious);
        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
        if (content) {
          const reasoningBlock = formatAceReasoning(content);
          partialContent += reasoningBlock;
          lifecycle?.onDelta?.(reasoningBlock, partialContent);
        }
      }) as EventListener);

      stream.events.addEventListener('done', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const hasSessionField = hasOwnKey(data, 'sessionId');
        const nextSessionId = hasSessionField ? normalizeSessionId(data.sessionId) : undefined;
        if (hasSessionField) {
          syncRuntimeSession(nextSessionId);
        }
        const finalContent = data?.specCodingRevision?.applied
          ? `${data.output || partialContent || data.error || '无输出'}\n\n---\n已刷新 Spec：${data.specCodingRevision.summary}`
          : (data?.output || partialContent || data?.error || '无输出');
        const finalRawContent = mergeFinalRawStreamContent(
          partialContent,
          String(data?.rawOutput || data?.output || data?.error || ''),
        );
        if (data?.isError) {
          const errorText = formatAgentStreamError({
            ...data,
            sourceLabel: data?.sourceLabel || 'ACEHarness Agent 执行终态',
            stage: data?.stage || 'execution-finalize',
            engine: data?.engine || runtimeName,
            streamId: stream.streamId,
            content: undefined,
            message: data?.error || latestEngineError || data?.message || finalContent,
          });
          const errorContent = appendAgentStreamError(partialContent, errorText);
          storeChatStreamSseEventAsAgentMessage('error', {
            ...data,
            content: errorContent,
            isError: true,
          }, {
            chatId: stream.streamId,
            stepKey: runtimeName,
            provider: data?.engine,
            model: data?.model,
            sessionId: data?.sessionId || nextSessionId || existingSession,
            frontendSessionId: activeSessionId || undefined,
            streamScope: 'agora-agent-chat',
          }, aiPrevious);
          finishReject(Object.assign(new Error(errorText), {
            code: data?.code,
            partialContent,
            rawContent: finalRawContent,
            engine: data?.engine,
            model: data?.model,
          }));
          return;
        }
        const row = storeChatStreamSseEventAsAgentMessage('done', {
          ...data,
          content: finalRawContent || finalContent,
        }, {
          chatId: stream.streamId,
          stepKey: runtimeName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || nextSessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'agora-agent-chat',
        }, aiPrevious);
        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
        finishResolve({
          status: 'done',
          content: finalContent,
          rawContent: finalRawContent,
          engine: data?.engine,
          model: data?.model,
        });
      }) as EventListener);

      stream.events.addEventListener('failed', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const errorText = formatAgentStreamError({
          ...data,
          message: data?.message || latestEngineError || 'Agent 发言失败',
          sourceLabel: data?.sourceLabel || 'ACEHarness Agent 流式执行',
          stage: data?.stage || 'stream-finalize',
          engine: data?.engine || runtimeName,
          streamId: stream.streamId,
        });
        const errorContent = appendAgentStreamError(partialContent, errorText);
        storeChatStreamSseEventAsAgentMessage('error', {
          ...data,
          content: errorContent,
          isError: true,
        }, {
          chatId: stream.streamId,
          stepKey: runtimeName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'agora-agent-chat',
        }, aiPrevious);
        finishReject(Object.assign(new Error(errorText), {
          code: data?.code,
          partialContent,
          rawContent: partialContent,
        }));
      }) as EventListener);

      stream.events.addEventListener('engine_error', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        if (data?.recoverable) return;
        latestEngineError = formatAgentStreamError({
          ...data,
          message: data?.message || data?.error || 'Agent 引擎返回错误',
          sourceLabel: data?.sourceLabel || 'ACEHarness Agent 引擎',
          stage: data?.stage || 'engine',
          engine: data?.engine || runtimeName,
          streamId: stream.streamId,
        });
      }) as EventListener);

      stream.events.onerror = (event: Event) => {
        if (stoppedByUser || settled) return;
        const errorText = latestEngineError || formatAgentStreamError({
          message: describeEventSourceError(event, stream.events),
          sourceLabel: '浏览器网络/SSE 连接层',
          stage: 'connection',
          code: 'AGENT_SSE_CONNECTION_ERROR',
          engine: runtimeName,
          streamId: stream.streamId,
        });
        const errorContent = appendAgentStreamError(partialContent, errorText);
        storeChatStreamSseEventAsAgentMessage('error', {
          content: errorContent,
          isError: true,
        }, {
          chatId: stream.streamId,
          stepKey: runtimeName,
          sessionId: existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'agora-agent-chat',
        }, aiPrevious);
        finishReject(Object.assign(new Error(errorText), {
          code: 'AGENT_SSE_CONNECTION_ERROR',
          partialContent,
          rawContent: partialContent,
        }));
      };
    });
  }, [
    activeSessionId,
    chatroom.topic,
    guestRoster,
    normalizedRoom.agentSessions,
    normalizedRoom.topic,
    mcpSettings,
    resolvedWorkspacePath,
    roomTitle,
    updateRoom,
    withAgoraRuntimeSettings,
  ]); 

  useEffect(() => {
    if (!allowOpeningMessages) return;
    if (!activeSessionId || !guestRoster.length) return;
    const currentMessages = openingMessagesRef.current || [];
    const pendingOpening = currentMessages.find((message) => (
      message.speakerType === 'agent'
      && message.chatroom?.kind === 'setup'
      && message.status === 'pending'
    ));
    if (openingInFlightRef.current.size > 0) return;
    const openedSpeakers = new Set(
      guestRoster
        .filter((participant) => participant.openingStatus === 'done' || participant.openingStatus === 'failed')
        .map((participant) => participant.name)
    );
    currentMessages
      .filter((message) => message.speakerType === 'agent' && message.chatroom?.kind === 'setup')
        .map((message) => message.speakerName)
        .forEach((name) => openedSpeakers.add(name));
    let existingPendingMessage: CollaborationRoomMessage | null = null;
    let participant = pendingOpening
      ? guestRoster.find((participant) => participant.name === pendingOpening.speakerName)
      : null;
    if (participant && pendingOpening) {
      existingPendingMessage = pendingOpening;
      openedSpeakers.delete(participant.name);
    }
    if (!participant) {
      participant = guestRoster.find((participant) => {
        const key = `${activeSessionId}:${participant.id}:${participant.name}`;
        return participant.name && !openedSpeakers.has(participant.name) && !openingInFlightRef.current.has(key);
      }) || null;
    }
    if (!participant) return;
    const openingParticipant = participant;
    const run = async () => {
      const key = `${activeSessionId}:${openingParticipant.id}:${openingParticipant.name}`;
      const messageId = buildOpeningMessageId(activeSessionId, openingParticipant);
      openingInFlightRef.current.add(key);
      const pendingMessage: CollaborationRoomMessage = {
        id: existingPendingMessage?.id || messageId,
        speakerType: 'agent',
        speakerName: openingParticipant.name,
        content: '发言中',
        createdAt: existingPendingMessage?.createdAt || Date.now(),
        status: 'pending',
        engine: openingParticipant.engine,
        model: openingParticipant.model,
        chatroom: {
          kind: 'setup',
          mode: chatroom.settings.responseMode || 'mention-driven',
        },
      };
      const targetMessageId = pendingMessage.id;
      updateRoom((current) => {
        const base = ensureChatroomRoomState(current);
        const messages = base.messages || [];
        const nextRoster = (base.chatroom?.participantRoster || []).map((item) => (
          item.id === openingParticipant.id
            ? { ...item, openingStatus: 'pending' as const, openingError: undefined }
            : item
        ));
        if (messages.some((item) => item.id === targetMessageId || (item.speakerType === 'agent' && item.chatroom?.kind === 'setup' && item.speakerName === openingParticipant.name))) {
          return {
            ...base,
            chatroom: base.chatroom ? {
              ...base.chatroom,
              participantRoster: nextRoster,
            } : base.chatroom,
          };
        }
        return {
          ...base,
          messages: [...messages, pendingMessage],
          chatroom: base.chatroom ? {
            ...base.chatroom,
            participantRoster: nextRoster,
          } : base.chatroom,
        };
      });
      try {
        const delayMs = OPENING_LOCAL_DELAY_MIN_MS + Math.floor(Math.random() * OPENING_LOCAL_DELAY_JITTER_MS);
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        const openingLine = pickOpeningLine(openingParticipant, roomTitle, getUsedOpeningLines(openingMessagesRef.current || []));
        const partials = splitOpeningLineIntoPartials(openingLine);
        for (let index = 0; index < partials.length; index += 1) {
          const partial = partials[index];
          updateRoom((current) => replaceRoomMessageById(current, targetMessageId, (message) => ({
            ...message,
            content: partial,
            rawContent: partial,
            status: 'pending',
          })));
          if (index < partials.length - 1) {
            await new Promise((resolve) => window.setTimeout(
              resolve,
              OPENING_TYPEWRITER_DELAY_MIN_MS + Math.floor(Math.random() * OPENING_TYPEWRITER_DELAY_JITTER_MS)
            ));
          }
        }
        const message: CollaborationRoomMessage = {
          ...pendingMessage,
          speakerType: 'agent',
          speakerName: openingParticipant.name,
          content: openingLine,
          rawContent: openingLine,
          status: 'done',
          engine: participant.engine,
          model: participant.model,
        };
        updateRoom((current) => {
          const base = ensureChatroomRoomState(current);
          const messages = base.messages || [];
          const nextRoster = (base.chatroom?.participantRoster || []).map((item) => (
            item.id === openingParticipant.id
              ? { ...item, openingStatus: 'done' as const, openingError: undefined }
            : item
          ));
          const existingIndex = messages.findIndex((item) => item.id === targetMessageId);
          if (existingIndex < 0) {
            return {
              ...base,
              messages: [...messages, message],
              chatroom: base.chatroom ? {
                ...base.chatroom,
                participantRoster: nextRoster,
              } : base.chatroom,
            };
          }
          const nextMessages = [...messages];
          nextMessages[existingIndex] = {
            ...nextMessages[existingIndex],
            ...message,
          };
          return {
            ...base,
            messages: nextMessages,
            chatroom: base.chatroom ? {
              ...base.chatroom,
              participantRoster: nextRoster,
            } : base.chatroom,
          };
        });
        appendToCentralChat(message);
      } catch (error: any) {
        updateRoom((current) => {
          const base = ensureChatroomRoomState(current);
          const messages = (base.messages || []).filter((item) => item.id !== targetMessageId);
          const nextRoster = (base.chatroom?.participantRoster || []).map((item) => (
            item.id === openingParticipant.id
              ? { ...item, openingStatus: 'failed' as const, openingError: error?.message || '未知错误' }
              : item
          ));
          return {
            ...base,
            messages,
            chatroom: base.chatroom ? {
              ...base.chatroom,
              participantRoster: nextRoster,
            } : base.chatroom,
          };
        });
      } finally {
        openingInFlightRef.current.delete(key);
        setOpeningSequenceTick((value) => value + 1);
      }
    };
    void run();
  }, [
    activeSessionId,
    allowOpeningMessages,
    appendToCentralChat,
    chatroom.settings.responseMode,
    guestRoster,
    guestRosterIdentityKey,
    openingSequenceTick,
    roomTitle,
    updateRoom,
  ]);

  const activeGuestMembers = useMemo<StackedListMember[]>(() => guestRoster.map((participant) => {
    const failed = participant.openingStatus === 'failed';
    const pending = participant.openingStatus === 'pending';
    const roleLabel = participant.sourceType === 'custom'
      ? '自定义'
      : participant.sourceType === 'agent'
        ? (participant.sourceAgent || 'Agent')
        : 'Agent';
    const roleType: StackedListMember['roleType'] = participant.sourceType === 'custom'
      ? 'creator'
      : participant.sourceType === 'agent'
        ? 'data'
        : 'pm';

    return {
      id: participant.id,
      name: participant.name,
      status: failed ? '开场失败，已静默' : pending ? '准备开场' : 'Online',
      online: !failed && !pending,
      statusTone: failed ? 'danger' : pending ? 'warning' : 'success',
      role: roleLabel,
      roleType,
      avatarNode: (
        <SpriteAvatar
          avatar={resolveAgentAvatarSrc(undefined, participant.runtimeAgentName || participant.name)}
          seed={participant.runtimeAgentName || participant.name}
          category="agent-default"
          alt={participant.name}
          fallback={getInitials(participant.name)}
          className={cn('h-9 w-9 shadow-sm ring-2 ring-background', failed && 'ring-rose-300/80 dark:ring-rose-500/50')}
          fallbackClassName="bg-primary/10 text-xs font-semibold text-primary"
        />
      ),
      action: allowGuestManagement ? {
        label: '移除 Agent',
        type: 'remove',
        onClick: () => removeGuest(participant.name),
      } : undefined,
    };
  }), [allowGuestManagement, guestRoster, removeGuest]);

  const directoryGuestMembers = useMemo<StackedListMember[]>(() => availableAgents
    .filter((agent) => {
      const name = String(agent?.name || '').trim();
      return name && !guestRoster.some((participant) => (
        participant.name === name
        || participant.sourceAgent === name
        || participant.runtimeAgentName === name
      ));
    })
    .map((agent) => {
    const name = String(agent?.name || '').trim();
    const description = String(agent?.description || agent?.systemPrompt || '').trim();
    return {
      id: name,
      name,
      status: description || '可加入当前群聊',
      online: false,
      statusTone: 'default' as const,
      role: String(agent?.team || agent?.roleType || 'Agent'),
      roleType: 'data' as const,
      avatarNode: (
        <SpriteAvatar
          avatar={resolveAgentAvatarSrc(undefined, name)}
          seed={name}
          category="agent-default"
          alt={name}
          fallback={getInitials(name)}
          className="h-9 w-9 shadow-sm ring-2 ring-background"
          fallbackClassName="bg-primary/10 text-xs font-semibold text-primary"
        />
      ),
      action: {
        label: '拉入群聊',
        type: 'add',
        onClick: () => addAgentToRoom(agent),
      },
    };
  }), [addAgentToRoom, availableAgents, guestRoster]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-background px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xl font-semibold leading-none text-muted-foreground">#</span>
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground">{roomTitle}</h2>
          <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
            {guests.length} Agent
          </span>
          <span className="hidden truncate text-xs text-muted-foreground lg:block">
            {MODE_LABELS[displayChatroom.settings.responseMode]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {guestRoster.length > 0 ? (
          <div className="hidden items-center gap-1 rounded-full border border-border/60 bg-background/70 p-0.5 md:flex">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  'h-7 rounded-full px-2 text-[11px] transition-colors',
                  displayChatroom.settings.responseMode === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
                title={option.title}
                onClick={() => setResponseMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          ) : null}
          <div className="hidden -space-x-2 sm:flex">
            {guestRoster.slice(0, 5).map((participant) => (
              <SpriteAvatar
                key={`header-${participant.id}`}
                avatar={resolveAgentAvatarSrc(undefined, participant.runtimeAgentName || participant.name)}
                seed={participant.runtimeAgentName || participant.name}
                category="agent-default"
                alt={participant.name}
                fallback={getInitials(participant.name)}
                className="h-7 w-7 border-2 border-background ring-1 ring-border/60"
                fallbackClassName="bg-primary/10 text-[9px] font-semibold text-primary"
              />
            ))}
          </div>
          {lockWorkspace ? null : (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 rounded-md px-2.5 text-xs"
              title="切换工作区"
              aria-label="切换工作区"
              onClick={() => {
                setWorkspaceDraft(pinnedWorkspacePath || defaultWorkspacePath);
                setWorkspaceDialogOpen(true);
              }}
            >
              <Settings2 className="mr-1.5 h-4 w-4" />
              切换工作区
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/60 bg-background px-5">
          <TabsList className="h-11 gap-5 rounded-none bg-transparent p-0">
            <TabsTrigger value="chat" className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none">
              <MessageSquareText className="h-4 w-4" />
              聊天
            </TabsTrigger>
            {tabItems.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={tab.disabled}
                className="h-11 gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-0 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
              >
                {tab.icon}
                {tab.title}
                {tab.badge}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="hidden text-xs text-muted-foreground md:block">
            {resolvedWorkspacePath || '准备工作区...'}
          </div>
        </div>

        <TabsContent value="chat" className="mt-0 min-h-0 flex-1">
          <div className="flex h-full min-h-0 flex-col">
            {chatBanner && chatBannerPlacement === 'top' ? (
              <div className="shrink-0 border-b bg-amber-500/5 px-5 py-3">
                {chatBanner}
              </div>
            ) : null}
            <div className="relative min-h-0 flex-1">
              <AgoraChatPanel
                availableAgents={availableAgents}
                room={displayRoom}
                updateRoom={updateRoom}
                appendToCentralChat={appendToCentralChat}
                onInsertIntoMainInput={onInsertIntoMainInput}
                displayRoomTranscriptWhenMirrored
                mirrorHumanMessagesToCentral
                onRegisterMainInputHandler={onRegisterMainInputHandler}
                layout="workspace"
                hideComposer={hideComposer}
                currentUser={currentUser}
                callAgent={callAgent}
                toast={toast}
                allowTopicControls={allowTopicControls}
                showComposerControls={showComposerControls}
                inlineContent={chatBanner && chatBannerPlacement === 'inline' ? chatBanner : undefined}
                inlineContentSpeakerName={inlineContentSpeakerName}
              />
              {chatBanner && chatBannerPlacement === 'bottom-floating' ? (
                <div className="pointer-events-none fixed inset-x-4 bottom-5 z-50 flex justify-center">
                  <div className="pointer-events-auto max-h-[42vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-amber-400/35 bg-background/95 p-3 shadow-2xl backdrop-blur">
                    {chatBanner}
                  </div>
                </div>
              ) : null}
              <aside className={cn(
                'hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-background/92 shadow-xl backdrop-blur transition-[width] duration-200 xl:flex',
                fixedGuestPanel
                  ? guestPanelCollapsed
                    ? 'fixed right-6 top-[8.5rem] z-[80] max-h-[calc(100dvh-10rem)]'
                    : 'fixed bottom-24 right-6 top-[8.5rem] z-[80] max-h-[calc(100dvh-14.5rem)]'
                  : guestPanelCollapsed
                    ? 'absolute right-4 top-4 z-10'
                    : 'absolute bottom-4 right-4 top-4 z-10',
                guestPanelCollapsed ? 'w-12' : 'w-[21rem]'
              )}>
              <div className={cn('flex shrink-0 items-center border-b px-2 py-2', guestPanelCollapsed ? 'justify-center' : 'justify-between')}>
                {guestPanelCollapsed ? null : <div className="px-1 text-xs font-semibold text-muted-foreground">Agent</div>}
                <div className={cn('flex items-center gap-1', guestPanelCollapsed && 'flex-col')}>
                  {guestPanelCollapsed ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-md"
                      onClick={() => setGuestPanelCollapsed(false)}
                      title={`展开 Agent（${guestRoster.length}）`}
                      aria-label="展开 Agent"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-md"
                        onClick={() => setGuestPanelCollapsed(true)}
                        title="收起 Agent"
                        aria-label="收起 Agent"
                      >
                        <PanelRightClose className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              {guestPanelCollapsed ? (
                <button
                  type="button"
                  className="flex w-full flex-col items-center gap-2 px-2 py-3 text-muted-foreground hover:bg-muted/55 hover:text-foreground"
                  onClick={() => setGuestPanelCollapsed(false)}
                  title={`展开 Agent（${guestRoster.length}）`}
                >
                  <Badge variant="secondary" className="h-6 min-w-6 justify-center rounded-full px-1 text-[10px]">
                    {guestRoster.length}
                  </Badge>
                  <span className="text-[11px] font-medium tracking-[0.18em]" style={{ writingMode: 'vertical-rl' }}>
                    Agent
                  </span>
                </button>
              ) : (
                <div className="min-h-0 flex-1 p-1.5">
                  <StackedList
                    activeMembers={activeGuestMembers}
                    directoryMembers={allowGuestManagement ? directoryGuestMembers : []}
                    title="当前成员"
                    directoryTitle="添加成员"
                    directorySubtitle={`${directoryGuestMembers.length} 个可加入 Agent`}
                    searchPlaceholder="搜索当前成员..."
                    directorySearchPlaceholder="搜索可加入 Agent..."
                    emptyActiveLabel="暂无 Agent"
                    emptyDirectoryLabel="暂无可加入 Agent"
                    className="h-full border-0"
                  />
                </div>
              )}
              </aside>
            </div>
          </div>
        </TabsContent>

        {tabItems.map((tab) => (
          <TabsContent key={tab.id} value={tab.id} className="mt-0 min-h-0 flex-1 bg-background">
            {tab.content}
          </TabsContent>
        ))}

      </Tabs>

      {lockWorkspace ? null : (
      <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置群聊工作区</DialogTitle>
            <DialogDescription>这里的路径会同时驱动工作区与变更页签，也会作为 Agent 默认上下文目录。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <WorkspaceDirectoryPicker
              workspaceRoot={workspaceDraft || defaultWorkspacePath || pinnedWorkspacePath || ''}
              value={workspaceDraft}
              onChange={setWorkspaceDraft}
              autoSelectRootWhenEmpty={Boolean(defaultWorkspacePath || pinnedWorkspacePath)}
            />
            <div className="rounded-xl bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
              已选择：{workspaceDraft || '未选择'}
            </div>
            {defaultWorkspacePath ? (
              <div className="rounded-xl bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                当前工作目录：{defaultWorkspacePath}
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={resetWorkspacePath}
            >
              跟随当前目录
            </Button>
            <Button variant="outline" onClick={() => setWorkspaceDialogOpen(false)}>取消</Button>
            <Button onClick={handleSaveWorkspacePath}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}

    </div>
  );
}
