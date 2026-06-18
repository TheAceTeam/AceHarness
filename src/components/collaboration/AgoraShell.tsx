'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FolderOpen, GitBranch, MessageSquareText, PanelRightClose, PanelRightOpen, Plus, Settings2, UserMinus, UserPlus } from 'lucide-react';
import { agentApi, agoraApi, type AgoraGuestConfig, type AgoraGuestPreset } from '@/lib/core/api';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
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
  inlineContentSpeakerName?: string;
  initialSavedGuests?: AgoraGuestConfig[];
  initialGuestPresets?: AgoraGuestPreset[];
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

type GuestDraft = {
  displayName: string;
  sourceType: 'preset' | 'custom';
  presetId: string;
  personaPrompt: string;
  engine: string;
  model: string;
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
  return '嘉宾';
}

function isGuestAvailable(guest: Pick<AgoraGuestConfig | AgoraGuestPreset, 'status'>) {
  return guest.status !== 'unavailable';
}

function getGuestRuntimeLabel(guest: Pick<AgoraGuestConfig | AgoraGuestPreset, 'engine' | 'model'>) {
  const resolvedGuest = guest as AgoraGuestConfig;
  const engine = String(resolvedGuest.resolvedEngine || guest.engine || '').trim();
  const model = String(resolvedGuest.resolvedModel || guest.model || '').trim();
  if (!engine && !model) return '跟随默认模型';
  return [engine || '默认引擎', model || '默认模型'].join(' / ');
}

function mapGuestRuntimeOverride(guest: Pick<AgoraGuestConfig, 'runtimeStrategy' | 'engine' | 'model'>) {
  const engine = String(guest.engine || '').trim();
  const model = String(guest.model || '').trim();
  const followsSystem = guest.runtimeStrategy !== 'explicit';
  if (followsSystem && !model) {
    return {
      useDefaultModel: true,
      engine: '',
      model: '',
    };
  }
  return {
    useDefaultModel: false,
    engine: followsSystem ? '' : engine,
    model,
  };
}

function formatUnavailableGuests(guests: Array<Pick<AgoraGuestConfig | AgoraGuestPreset, 'displayName' | 'statusReason'>>) {
  return guests.map((guest) => `${guest.displayName}：${guest.statusReason || '模型或引擎未配置'}`).join('；');
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
  inlineContentSpeakerName,
  initialSavedGuests,
  initialGuestPresets,
  currentUser,
}: AgoraShellProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('chat');
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [guestCreateOpen, setGuestCreateOpen] = useState(false);
  const [guestPanelCollapsed, setGuestPanelCollapsed] = useState(false);
  const [workspaceDraft, setWorkspaceDraft] = useState('');
  const [availableAgents, setAvailableAgents] = useState<Array<{ name: string; description?: string }>>([]);
  const [savedGuests, setSavedGuests] = useState<AgoraGuestConfig[]>(() => initialSavedGuests || []);
  const [guestPresets, setGuestPresets] = useState<AgoraGuestPreset[]>(() => initialGuestPresets || []);
  const [selectedSavedGuestIds, setSelectedSavedGuestIds] = useState<string[]>([]);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [guestBatchSaving, setGuestBatchSaving] = useState(false);
  const [presetRuntimeDraft, setPresetRuntimeDraft] = useState({ engine: '', model: '' });
  const [guestDraft, setGuestDraft] = useState<GuestDraft>({
    displayName: '',
    sourceType: 'custom',
    presetId: 'engineer',
    personaPrompt: '',
    engine: '',
    model: '',
  });
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
  const availableSavedGuests = useMemo(
    () => savedGuests.filter((guest) => !guestRoster.some((item) => item.guestConfigId === guest.id || item.name === guest.displayName)),
    [guestRoster, savedGuests]
  );
  const availableGuestPresets = useMemo(
    () => guestPresets.filter((preset) => !guestRoster.some((item) => item.presetId === preset.id || item.name === preset.displayName)),
    [guestPresets, guestRoster]
  );
  const availableSavedGuestIds = useMemo(
    () => availableSavedGuests.filter(isGuestAvailable).map((guest) => guest.id),
    [availableSavedGuests]
  );
  const selectedAvailableSavedGuestCount = availableSavedGuestIds.filter((id) => selectedSavedGuestIds.includes(id)).length;
  const savedGuestSelectionState: boolean | 'indeterminate' = availableSavedGuestIds.length === 0
    ? false
    : selectedAvailableSavedGuestCount === availableSavedGuestIds.length
      ? true
      : selectedAvailableSavedGuestCount > 0
        ? 'indeterminate'
        : false;
  const availablePresetIds = useMemo(
    () => availableGuestPresets.filter(isGuestAvailable).map((preset) => preset.id),
    [availableGuestPresets]
  );
  const selectedAvailablePresetCount = availablePresetIds.filter((id) => selectedPresetIds.includes(id)).length;
  const presetSelectionState: boolean | 'indeterminate' = availablePresetIds.length === 0
    ? false
    : selectedAvailablePresetCount === availablePresetIds.length
      ? true
      : selectedAvailablePresetCount > 0
        ? 'indeterminate'
        : false;
  const pinnedWorkspacePath = String(chatroom.settings.workspacePath || '').trim();
  const defaultWorkspacePath = String(workingDirectory || '').trim();
  const resolvedWorkspacePath = pinnedWorkspacePath || (lockWorkspace ? defaultWorkspacePath : '');
  const roomTitle = chatroom.topic?.trim() || sessionTitle?.trim() || '新议题';
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
    Promise.all([
      agentApi.listAgents().catch(() => ({ agents: [] })),
      agoraApi.listGuests().catch(() => ({ guests: [], presets: [] })),
    ])
      .then(([agentData, guestData]) => {
        if (cancelled) return;
        setAvailableAgents(Array.isArray(agentData?.agents) ? agentData.agents : []);
        setSavedGuests(Array.isArray(guestData?.guests) ? guestData.guests : []);
        setGuestPresets(Array.isArray(guestData?.presets) ? guestData.presets : []);
      })
      .catch((error: any) => {
        if (cancelled) return;
        toast('warning', error?.message || '加载议场数据失败');
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  useEffect(() => {
    if (initialSavedGuests) {
      setSavedGuests(initialSavedGuests);
    }
  }, [initialSavedGuests]);

  useEffect(() => {
    if (initialGuestPresets) {
      setGuestPresets(initialGuestPresets);
    }
  }, [initialGuestPresets]);

  const updateRoom = useCallback((updater: (roomState: CollaborationRoomState) => CollaborationRoomState) => {
    setSessionWorkbenchState((prev) => {
      const base = ensureChatroomRoomState(prev?.collaborationRoom);
      const nextRoom = updater(base);
      return {
        ...(prev || {}),
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
    if (pinnedWorkspacePath) return;
    let cancelled = false;
    agoraApi.ensureWorkspace({
      sessionId: activeSessionId,
      sourceWorkspace: defaultWorkspacePath || undefined,
      title: roomTitle,
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
        if (!cancelled) toast('warning', error?.message || '准备议场工作区失败');
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, defaultWorkspacePath, lockWorkspace, pinnedWorkspacePath, roomTitle, toast, updateRoom]);

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
    toast('success', nextPath ? '已绑定议场工作区' : '已改为跟随当前工作目录');
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

  const addGuestsToRoom = useCallback((guestsToAdd: AgoraGuestConfig[], options?: { silent?: boolean }) => {
    const unavailable = guestsToAdd.filter((guest) => !isGuestAvailable(guest));
    if (unavailable.length) {
      toast('warning', `以下嘉宾不可用：${formatUnavailableGuests(unavailable)}`);
      return;
    }
    const uniqueGuests = guestsToAdd
      .filter(isGuestAvailable)
      .filter((guest, index, list) => (
        list.findIndex((item) => item.id === guest.id) === index
      ));
    if (!uniqueGuests.length) return;
    updateRoom((current) => {
      const base = ensureChatroomRoomState(current);
      const currentChatroom = base.chatroom!;
      const roster = currentChatroom.participantRoster || [];
      const nextParticipants = uniqueGuests
        .filter((guest) => !roster.some((participant) => participant.guestConfigId === guest.id || participant.name === guest.displayName))
        .map((guest): CollaborationChatroomParticipant => {
          const runtime = mapGuestRuntimeOverride(guest);
          return {
            id: `participant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: guest.displayName,
            sourceType: guest.sourceType,
            sourceAgent: guest.sourceAgent,
            presetId: guest.presetId,
            guestConfigId: guest.id,
            runtimeAgentName: guest.runtimeAgentName,
            personaPrompt: guest.personaPrompt,
            systemPrompt: guest.systemPrompt,
            useDefaultModel: runtime.useDefaultModel,
            engine: runtime.engine,
            model: runtime.model,
            createdAt: Date.now(),
          };
        });
      if (!nextParticipants.length) return base;
      const nextRoster = [...roster, ...nextParticipants];
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
    if (!options?.silent) {
      toast('success', uniqueGuests.length === 1 ? `已加入 ${uniqueGuests[0].displayName}` : `已加入 ${uniqueGuests.length} 位嘉宾`);
    }
  }, [toast, updateRoom]);

  const addGuestToRoom = useCallback((guest: AgoraGuestConfig) => {
    addGuestsToRoom([guest]);
  }, [addGuestsToRoom]);

  const resetGuestCreateState = useCallback(() => {
    setSelectedSavedGuestIds([]);
    setSelectedPresetIds([]);
    setPresetRuntimeDraft({ engine: '', model: '' });
    setGuestDraft({
      displayName: '',
      sourceType: 'custom',
      presetId: guestPresets[0]?.id || 'engineer',
      personaPrompt: '',
      engine: '',
      model: '',
    });
  }, [guestPresets]);

  const openGuestCreateDialog = useCallback(() => {
    resetGuestCreateState();
    setGuestCreateOpen(true);
  }, [resetGuestCreateState]);

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

  const createAndInviteGuest = useCallback(async () => {
    const displayName = guestDraft.displayName.trim() || '嘉宾';
    if (!guestDraft.personaPrompt.trim()) {
      toast('warning', '请填写嘉宾提示词');
      return;
    }
    try {
      const result = await agoraApi.saveGuest({
        displayName,
        sourceType: 'custom',
        personaPrompt: guestDraft.personaPrompt,
        engine: guestDraft.engine,
        model: guestDraft.model,
      });
      if (!isGuestAvailable(result.guest)) {
        toast('warning', `以下嘉宾不可用：${formatUnavailableGuests([result.guest])}`);
        return;
      }
      setSavedGuests((prev) => {
        const without = prev.filter((item) => item.id !== result.guest.id);
        return [...without, result.guest].sort((a, b) => a.createdAt - b.createdAt);
      });
      window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      if (isGuestAvailable(result.guest)) addGuestToRoom(result.guest);
      resetGuestCreateState();
      setGuestCreateOpen(false);
    } catch (error: any) {
      toast('error', error?.message || '创建嘉宾失败');
    }
  }, [addGuestToRoom, guestDraft, resetGuestCreateState, toast]);

  const inviteSelectedSavedGuests = useCallback(() => {
    const selectedAll = availableSavedGuests.filter((guest) => selectedSavedGuestIds.includes(guest.id));
    const unavailable = selectedAll.filter((guest) => !isGuestAvailable(guest));
    if (unavailable.length) {
      toast('warning', `以下嘉宾不可用：${formatUnavailableGuests(unavailable)}`);
      return;
    }
    const selected = selectedAll.filter(isGuestAvailable);
    if (!selected.length) {
      toast('warning', '请选择要加入的嘉宾');
      return;
    }
    addGuestsToRoom(selected);
    resetGuestCreateState();
    setGuestCreateOpen(false);
  }, [addGuestsToRoom, availableSavedGuests, resetGuestCreateState, selectedSavedGuestIds, toast]);

  const createAndInviteSelectedPresets = useCallback(async () => {
    const selectedAll = availableGuestPresets.filter((preset) => selectedPresetIds.includes(preset.id));
    const unavailable = selectedAll.filter((preset) => !isGuestAvailable(preset));
    if (unavailable.length) {
      toast('warning', `以下嘉宾不可用：${formatUnavailableGuests(unavailable)}`);
      return;
    }
    const selected = selectedAll.filter(isGuestAvailable);
    if (!selected.length) {
      toast('warning', '请选择要创建的预设嘉宾');
      return;
    }
    setGuestBatchSaving(true);
    try {
      const created = await Promise.all(selected.map(async (preset) => {
        const existing = savedGuests.find((guest) => guest.presetId === preset.id && guest.displayName === preset.displayName);
        if (existing) return existing;
        const result = await agoraApi.saveGuest({
          displayName: preset.displayName,
          sourceType: 'preset',
          presetId: preset.id,
          sourceAgent: preset.templateAgent,
          engine: presetRuntimeDraft.engine,
          model: presetRuntimeDraft.model,
        });
        return result.guest;
      }));
      setSavedGuests((prev) => {
        const nextById = new Map(prev.map((guest) => [guest.id, guest]));
        created.forEach((guest) => nextById.set(guest.id, guest));
        return Array.from(nextById.values()).sort((a, b) => a.createdAt - b.createdAt);
      });
      window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      const unavailableCreated = created.filter((guest) => !isGuestAvailable(guest));
      if (unavailableCreated.length) {
        toast('warning', `以下嘉宾不可用：${formatUnavailableGuests(unavailableCreated)}`);
        return;
      }
      addGuestsToRoom(created, { silent: true });
      resetGuestCreateState();
      setGuestCreateOpen(false);
      toast('success', `已加入 ${created.length} 位嘉宾`);
    } catch (error: any) {
      toast('error', error?.message || '批量加入嘉宾失败');
    } finally {
      setGuestBatchSaving(false);
    }
  }, [addGuestsToRoom, availableGuestPresets, presetRuntimeDraft.engine, presetRuntimeDraft.model, resetGuestCreateState, savedGuests, selectedPresetIds, toast]);

  const handleGuestDialogOpenChange = useCallback((open: boolean) => {
    setGuestCreateOpen(open);
    if (open) return;
    resetGuestCreateState();
  }, [resetGuestCreateState]);

  const toggleSavedGuestSelected = useCallback((guestId: string, checked: boolean) => {
    setSelectedSavedGuestIds((prev) => (
      checked
        ? Array.from(new Set([...prev, guestId]))
        : prev.filter((id) => id !== guestId)
    ));
  }, []);

  const toggleAllSavedGuests = useCallback((checked: boolean) => {
    setSelectedSavedGuestIds(checked ? availableSavedGuestIds : []);
  }, [availableSavedGuestIds]);

  const togglePresetSelected = useCallback((presetId: string, checked: boolean) => {
    setSelectedPresetIds((prev) => (
      checked
        ? Array.from(new Set([...prev, presetId]))
        : prev.filter((id) => id !== presetId)
    ));
  }, []);

  const toggleAllPresets = useCallback((checked: boolean) => {
    setSelectedPresetIds(checked ? availablePresetIds : []);
  }, [availablePresetIds]);

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
      temporaryRoleConfig,
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
        const data = JSON.parse(event.data || '{}');
        const content = String(data?.content || '');
        partialContent += content;
        lifecycle?.onDelta?.(content, partialContent);
      }) as EventListener);

      stream.events.addEventListener('thinking', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        const content = String(data?.content || '');
        partialContent += content;
        lifecycle?.onDelta?.(content, partialContent);
      }) as EventListener);

      stream.events.addEventListener('done', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
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
          finishReject(Object.assign(new Error(data?.error || finalContent || '嘉宾发言失败'), {
            partialContent: finalContent,
            rawContent: finalRawContent,
            engine: data?.engine,
            model: data?.model,
          }));
          return;
        }
        finishResolve({
          status: 'done',
          content: finalContent,
          rawContent: finalRawContent,
          engine: data?.engine,
          model: data?.model,
        });
      }) as EventListener);

      stream.events.addEventListener('failed', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        const errorText = data?.message || '嘉宾发言失败';
        finishReject(Object.assign(new Error(errorText), {
          partialContent: partialContent || errorText,
          rawContent: partialContent || errorText,
        }));
      }) as EventListener);

      stream.events.onerror = () => {
        if (stoppedByUser || settled) return;
        const errorText = '嘉宾发言连接中断';
        finishReject(Object.assign(new Error(errorText), {
          partialContent: partialContent || errorText,
          rawContent: partialContent || errorText,
        }));
      };
    });
  }, [
    activeSessionId,
    chatroom.topic,
    guestRoster,
    normalizedRoom.agentSessions,
    normalizedRoom.topic,
    resolvedWorkspacePath,
    roomTitle,
    updateRoom,
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
    guestRosterIdentityKey,
    openingSequenceTick,
    roomTitle,
    updateRoom,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border/70 bg-background px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="text-xl font-semibold leading-none text-muted-foreground">#</span>
          <h2 className="min-w-0 truncate text-base font-semibold text-foreground">{roomTitle}</h2>
          <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
            {guests.length} 嘉宾
          </span>
          <span className="hidden truncate text-xs text-muted-foreground lg:block">
            {MODE_LABELS[displayChatroom.settings.responseMode]}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
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
              size="icon"
              className="h-8 w-8 rounded-md"
              title="设置工作区"
              aria-label="设置工作区"
              onClick={() => {
                setWorkspaceDraft(pinnedWorkspacePath || defaultWorkspacePath);
                setWorkspaceDialogOpen(true);
              }}
            >
              <Settings2 className="h-4 w-4" />
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
                    ? 'fixed right-6 top-[8.5rem] z-40'
                    : 'fixed bottom-6 right-6 top-[8.5rem] z-40'
                  : guestPanelCollapsed
                    ? 'absolute right-4 top-4 z-10'
                    : 'absolute bottom-4 right-4 top-4 z-10',
                guestPanelCollapsed ? 'w-12' : 'w-64'
              )}>
              <div className={cn('flex shrink-0 items-center border-b px-2 py-2', guestPanelCollapsed ? 'justify-center' : 'justify-between')}>
                {guestPanelCollapsed ? null : <div className="px-1 text-xs font-semibold text-muted-foreground">嘉宾</div>}
                <div className={cn('flex items-center gap-1', guestPanelCollapsed && 'flex-col')}>
                  {guestPanelCollapsed ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 rounded-md"
                      onClick={() => setGuestPanelCollapsed(false)}
                      title={`展开嘉宾（${guestRoster.length}）`}
                      aria-label="展开嘉宾"
                    >
                      <PanelRightOpen className="h-4 w-4" />
                    </Button>
                  ) : (
                    <>
                      {allowGuestManagement ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 rounded-md"
                          onClick={openGuestCreateDialog}
                          title="加入嘉宾"
                          aria-label="加入嘉宾"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-md"
                        onClick={() => setGuestPanelCollapsed(true)}
                        title="收起嘉宾"
                        aria-label="收起嘉宾"
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
                  title={`展开嘉宾（${guestRoster.length}）`}
                >
                  <Badge variant="secondary" className="h-6 min-w-6 justify-center rounded-full px-1 text-[10px]">
                    {guestRoster.length}
                  </Badge>
                  <span className="text-[11px] font-medium tracking-[0.18em]" style={{ writingMode: 'vertical-rl' }}>
                    嘉宾
                  </span>
                </button>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="max-h-[42%] min-h-0 shrink-0 overflow-y-auto p-2">
                    {guestRoster.length ? guestRoster.map((participant) => (
                      <div
                        key={participant.id}
                        className={cn(
                          'group flex min-h-11 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60',
                          participant.openingStatus === 'failed' && 'bg-rose-50/80 text-rose-900 hover:bg-rose-50 dark:bg-rose-950/20 dark:text-rose-200 dark:hover:bg-rose-950/30'
                        )}
                      >
                        <SpriteAvatar
                          avatar={resolveAgentAvatarSrc(undefined, participant.runtimeAgentName || participant.name)}
                          seed={participant.runtimeAgentName || participant.name}
                          category="agent-default"
                          alt={participant.name}
                          fallback={getInitials(participant.name)}
                          className={cn('h-7 w-7 ring-1 ring-border/60', participant.openingStatus === 'failed' && 'ring-rose-300/70 dark:ring-rose-500/40')}
                          fallbackClassName="bg-primary/10 text-[9px] font-semibold text-primary"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-foreground">{participant.name}</div>
                          {participant.openingStatus === 'failed' ? (
                            <div className="truncate text-[10px] text-rose-600 dark:text-rose-300">
                              开场失败，已静默
                            </div>
                          ) : (
                            <div className="truncate text-[10px] text-muted-foreground">
                              {participant.sourceType === 'custom' ? '自定义' : participant.presetId || participant.sourceAgent || '预设'}
                            </div>
                          )}
                        </div>
                        {allowGuestManagement ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            onClick={() => removeGuest(participant.name)}
                            title="移除嘉宾"
                            aria-label="移除嘉宾"
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    )) : (
                      <div className="px-2 py-6 text-center text-xs text-muted-foreground">暂无嘉宾</div>
                    )}
                  </div>
                  {allowGuestManagement ? (
                    <div className="flex min-h-[168px] flex-1 flex-col border-t p-2">
                      <div className="mb-1 shrink-0 px-1 text-[10px] text-muted-foreground">可加入</div>
                      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                        {availableSavedGuests.map((guest) => (
                          <button
                            key={guest.id}
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left ${
                              isGuestAvailable(guest) ? 'hover:bg-muted/60' : 'cursor-not-allowed opacity-55'
                            }`}
                            onClick={() => addGuestToRoom(guest)}
                            disabled={!isGuestAvailable(guest)}
                          >
                            <SpriteAvatar
                              avatar={resolveAgentAvatarSrc(undefined, guest.runtimeAgentName)}
                              seed={guest.runtimeAgentName || guest.displayName}
                              category="agent-default"
                              alt={guest.displayName}
                              fallback={getInitials(guest.displayName)}
                              className="h-6 w-6 ring-1 ring-border/60"
                              fallbackClassName="bg-primary/10 text-[8px] font-semibold text-primary"
                            />
                            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{guest.displayName}</span>
                            {!isGuestAvailable(guest) ? (
                              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] text-destructive">不可用</Badge>
                            ) : null}
                            <UserPlus className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
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
            <DialogTitle>设置议场工作区</DialogTitle>
            <DialogDescription>这里的路径会同时驱动工作区与变更页签，也会作为嘉宾默认上下文目录。</DialogDescription>
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

      {allowGuestManagement ? (
      <Dialog open={guestCreateOpen} onOpenChange={handleGuestDialogOpenChange}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>加入嘉宾</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[68vh] gap-4 overflow-y-auto pr-1 lg:grid-cols-[1fr_1fr]">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">常驻嘉宾</h3>
                  <p className="mt-1 text-xs text-muted-foreground">可多选加入当前议题。</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={!selectedSavedGuestIds.length}
                  onClick={inviteSelectedSavedGuests}
                >
                  加入已选
                </Button>
              </div>
              <div className="rounded-lg border">
                {availableSavedGuests.length ? (
                  <>
                    <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/35">
                      <Checkbox
                        checked={savedGuestSelectionState}
                        disabled={availableSavedGuestIds.length === 0}
                        onCheckedChange={(checked) => toggleAllSavedGuests(checked === true)}
                        className="mt-0.5"
                      />
                      <span className="font-medium text-foreground">全选可用嘉宾</span>
                      <span className="ml-auto">
                        {selectedAvailableSavedGuestCount}/{availableSavedGuestIds.length}
                      </span>
                    </label>
                    {availableSavedGuests.map((guest) => {
                      const available = isGuestAvailable(guest);
                      return (
                        <label
                          key={guest.id}
                          className={`flex gap-3 border-b px-3 py-3 last:border-b-0 ${available ? 'cursor-pointer hover:bg-muted/40' : 'cursor-not-allowed bg-muted/20 opacity-70'}`}
                        >
                          <Checkbox
                            checked={selectedSavedGuestIds.includes(guest.id)}
                            disabled={!available}
                            onCheckedChange={(checked) => toggleSavedGuestSelected(guest.id, checked === true)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{guest.displayName}</span>
                              <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${available ? 'text-emerald-600' : 'text-destructive'}`}>
                                {available ? '可用' : '不可用'}
                              </Badge>
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">{getGuestRuntimeLabel(guest)}</div>
                            {!available ? (
                              <div className="mt-1 text-xs text-destructive">{guest.statusReason || '模型或引擎未配置'}</div>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </>
                ) : (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无可加入的常驻嘉宾</div>
                )}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">预设嘉宾</h3>
                <p className="mt-1 text-xs text-muted-foreground">选择模型后批量创建为常驻嘉宾并加入。</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={!selectedPresetIds.length || guestBatchSaving}
                  onClick={() => void createAndInviteSelectedPresets()}
                >
                  {guestBatchSaving ? '处理中...' : '创建并加入'}
                </Button>
              </div>
              <div className="rounded-lg border bg-muted/20 p-2">
                <EngineModelSelect
                  engine={presetRuntimeDraft.engine}
                  model={presetRuntimeDraft.model}
                  onEngineChange={(engine) => setPresetRuntimeDraft((prev) => ({ ...prev, engine }))}
                  onModelChange={(model) => setPresetRuntimeDraft((prev) => ({ ...prev, model }))}
                  className="h-9"
                />
              </div>
              <div className="rounded-lg border">
                {availableGuestPresets.length ? (
                  <>
                    <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/35">
                      <Checkbox
                        checked={presetSelectionState}
                        disabled={availablePresetIds.length === 0}
                        onCheckedChange={(checked) => toggleAllPresets(checked === true)}
                        className="mt-0.5"
                      />
                      <span className="font-medium text-foreground">全选可用预设</span>
                      <span className="ml-auto">
                        {selectedAvailablePresetCount}/{availablePresetIds.length}
                      </span>
                    </label>
                    {availableGuestPresets.map((preset) => {
                      const available = isGuestAvailable(preset);
                      return (
                        <label
                          key={preset.id}
                          className={`flex gap-3 border-b px-3 py-3 last:border-b-0 ${available ? 'cursor-pointer hover:bg-muted/40' : 'cursor-not-allowed bg-muted/20 opacity-70'}`}
                        >
                          <Checkbox
                            checked={selectedPresetIds.includes(preset.id)}
                            disabled={!available}
                            onCheckedChange={(checked) => togglePresetSelected(preset.id, checked === true)}
                            className="mt-0.5"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{preset.displayName}</span>
                              <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${available ? 'text-emerald-600' : 'text-destructive'}`}>
                                {available ? '可用' : '不可用'}
                              </Badge>
                            </div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{preset.description}</div>
                            {!available ? (
                              <div className="mt-1 text-xs text-destructive">{preset.statusReason || '模型或引擎未配置'}</div>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </>
                ) : (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">预设嘉宾均已在当前议题中</div>
                )}
              </div>
            </section>

            <section className="space-y-3 lg:col-span-2">
              <div>
                <h3 className="text-sm font-semibold">创建自定义嘉宾</h3>
                <p className="mt-1 text-xs text-muted-foreground">自定义嘉宾会保存为常驻嘉宾，后续议题可继续加入。</p>
              </div>
              <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
                <Input
                  value={guestDraft.displayName}
                  onChange={(event) => setGuestDraft((prev) => ({ ...prev, displayName: event.target.value }))}
                  placeholder="嘉宾名称"
                />
                <EngineModelSelect
                  engine={guestDraft.engine}
                  model={guestDraft.model}
                  onEngineChange={(engine) => setGuestDraft((prev) => ({ ...prev, engine }))}
                  onModelChange={(model) => setGuestDraft((prev) => ({ ...prev, model }))}
                />
                <Textarea
                  value={guestDraft.personaPrompt}
                  onChange={(event) => setGuestDraft((prev) => ({ ...prev, personaPrompt: event.target.value, sourceType: 'custom' }))}
                  rows={4}
                  className="md:col-span-2"
                  placeholder="输入这个嘉宾的性格、立场和发言方式"
                />
              </div>
            </section>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handleGuestDialogOpenChange(false)}>取消</Button>
            <Button onClick={() => void createAndInviteGuest()}>创建自定义并加入</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      ) : null}
    </div>
  );
}
