'use client';

import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useChat } from '@/contexts/ChatContext';
import { agoraApi, type AgoraGuestConfig, type AgoraGuestPreset } from '@/lib/core/api';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import type { CheckedState } from '@radix-ui/react-checkbox';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { Pin } from 'lucide-react';
import {
  buildWorkflowConversationDirectory,
  getCreationSessionStatusLabel,
  isWorkflowDirectorySession,
  getWorkbenchSessionKind,
  type ChatSessionSummaryLike,
} from '@/lib/agent/conversations';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { getAgoraTopicExtensionActions } from '@/lib/agora/extensions';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import {
  isWorkflowSidebarHint,
  type CollaborationChatroomParticipant,
} from '@/lib/core/home-sidebar-state';
import type { HumanQuestion } from '@/lib/run/state-persistence';
import { useWorkflowLiveState } from '@/lib/workflow/live-store';
import { isRunningWorkflowConversation } from '@/lib/workflow/run-status';
import type { ManagedMcpServer } from '@/lib/mcp/types';
import { RobotLogo } from '@/components/brand/RobotLogo';

type SkillItem = {
  name: string;
  label: string;
  description: string;
  source?: string;
  tags?: string[];
};

type McpServerItem = ManagedMcpServer;

type SidebarSession = ChatSessionSummaryLike & {
  agentBinding?: {
    agentName: string;
  };
  sessionWorkbenchState?: any;
};
type SessionIdSet = ReadonlySet<string>;

const EMPTY_SESSION_ID_LIST: string[] = [];
const EMPTY_SKILL_SETTINGS: Record<string, boolean> = {};
const EMPTY_SKILLS: SkillItem[] = [];
const EMPTY_MCP_SETTINGS: Record<string, boolean> = {};
const EMPTY_MCP_SERVERS: McpServerItem[] = [];
const AGORA_WORKSPACE_SEGMENT = 'agora-workspaces';
const noopToggleSetting = (_name: string) => {};
const noopSetSettings = (_settings: Record<string, boolean>) => {};

export type SessionDirectoryView = 'conversation';
type WorkflowBucketKey = 'creating' | 'ready' | 'active';
export const SESSION_DIRECTORY_ORDER_STORAGE_KEY = 'chat-session-directory-order';
export const DEFAULT_SESSION_DIRECTORY_ORDER: SessionDirectoryView[] = ['conversation'];

export function normalizeSessionDirectoryOrder(order?: readonly string[] | null): SessionDirectoryView[] {
  const next: SessionDirectoryView[] = [];
  for (const item of order || []) {
    if (item === 'conversation' && !next.includes(item)) {
      next.push(item);
    }
  }
  return next.includes('conversation') ? ['conversation'] : DEFAULT_SESSION_DIRECTORY_ORDER;
}

export function readStoredSessionDirectoryOrder(): SessionDirectoryView[] {
  if (typeof window === 'undefined') return DEFAULT_SESSION_DIRECTORY_ORDER;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SESSION_DIRECTORY_ORDER_STORAGE_KEY) || '[]');
    return normalizeSessionDirectoryOrder(Array.isArray(parsed) ? parsed : null);
  } catch {
    return DEFAULT_SESSION_DIRECTORY_ORDER;
  }
}

type WorkflowAgentSessionGroup = {
  key: string;
  label: string;
  role: 'Supervisor' | 'Agent' | '创建' | '运行';
  sessionId: string | null;
  sessions: SidebarSession[];
  pendingCount: number;
  connected: boolean;
};

type WorkflowSessionGroup = {
  key: string;
  name: string;
  configFile: string;
  sessions: SidebarSession[];
  agentGroups: WorkflowAgentSessionGroup[];
  pendingCount: number;
};

type TopicTemporaryGuestDraft = {
  name: string;
  personaPrompt: string;
  engine: string;
  model: string;
};

type PresetGuestCreateDraft = {
  id: string;
  presetId: string;
  personaPrompt: string;
  engine: string;
  model: string;
};

type CustomGuestDraft = {
  displayName: string;
  personaPrompt: string;
  engine: string;
  model: string;
};

type AgoraGuestEditDraft = {
  id: string;
  displayName: string;
  sourceType: 'preset' | 'custom';
  sourceAgent?: string;
  presetId?: string;
  personaPrompt: string;
  engine: string;
  model: string;
};

function hasWeChatBinding(session?: Pick<SidebarSession, 'sessionWorkbenchState'> | null): boolean {
  return Boolean(session?.sessionWorkbenchState?.wechatBinding);
}

function normalizePathForCompare(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function sanitizeAgoraWorkspaceSessionSegment(input: string): string {
  const normalized = String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'agora';
}

function getDefaultAgoraWorkspaceDeleteCandidate(session: Pick<SidebarSession, 'id' | 'sessionWorkbenchState'>): string | null {
  const chatWorkspace = session.sessionWorkbenchState?.chatWorkspace;
  const workspacePath = String(chatWorkspace?.workingDirectory || '').trim();
  if (!chatWorkspace?.autoCreated || !workspacePath) return null;

  const normalized = normalizePathForCompare(workspacePath);
  const parts = normalized.split('/').filter(Boolean);
  const segmentIndex = parts.lastIndexOf(AGORA_WORKSPACE_SEGMENT);
  if (segmentIndex < 0) return null;
  if (parts[segmentIndex + 1] !== sanitizeAgoraWorkspaceSessionSegment(session.id).toLowerCase()) return null;
  return workspacePath;
}

function compareSidebarSessions(a: SidebarSession, b: SidebarSession): number {
  const aPinned = hasWeChatBinding(a);
  const bPinned = hasWeChatBinding(b);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

function isLegacyPlanningCreationSession(session: SidebarSession): boolean {
  return Boolean(
    session.creationSession?.creationSessionId
    && session.title.trim().startsWith('创建计划：')
  );
}

function collapseDuplicateCreationPlanningSessions(sessions: SidebarSession[]): SidebarSession[] {
  const primaryCreationSessionIds = new Set(
    sessions
      .filter((session) => session.creationSession?.creationSessionId && !isLegacyPlanningCreationSession(session))
      .map((session) => session.creationSession!.creationSessionId)
  );
  if (primaryCreationSessionIds.size === 0) return sessions;
  return sessions.filter((session) => {
    const creationSessionId = session.creationSession?.creationSessionId;
    if (!creationSessionId) return true;
    return !isLegacyPlanningCreationSession(session) || !primaryCreationSessionIds.has(creationSessionId);
  });
}

function isActiveRunStatus(status?: string): boolean {
  return status === 'preparing' || status === 'running' || status === 'pending';
}

function getWorkflowSessionConfigFile(session: SidebarSession, relatedBinding = session.workflowBinding): string {
  return (
    relatedBinding?.configFile
    || session.creationSession?.filename
    || session.sessionWorkbenchState?.homeSidebar?.workflowDraft?.name
    || session.title
    || '未命名工作流'
  );
}

function getWorkflowSessionName(session: SidebarSession, relatedBinding = session.workflowBinding): string {
  return (
    session.creationSession?.workflowName
    || relatedBinding?.configFile
    || session.sessionWorkbenchState?.homeSidebar?.workflowDraft?.name
    || session.title
    || getWorkflowSessionConfigFile(session, relatedBinding)
  );
}

function createWorkflowAgentGroup(input: {
  key: string;
  label: string;
  role: WorkflowAgentSessionGroup['role'];
  sessionId?: string | null;
}): WorkflowAgentSessionGroup {
  return {
    key: input.key,
    label: input.label,
    role: input.role,
    sessionId: input.sessionId || null,
    sessions: [],
    pendingCount: 0,
    connected: Boolean(input.sessionId),
  };
}

function buildWorkflowAgentGroups(
  sessions: SidebarSession[],
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>,
  workflowBindingByRelatedSessionId: Map<string, NonNullable<SidebarSession['workflowBinding']>>
): WorkflowAgentSessionGroup[] {
  const groups = new Map<string, WorkflowAgentSessionGroup>();
  const assignedSessionIds = new Set<string>();
  const addGroup = (group: WorkflowAgentSessionGroup) => {
    if (!groups.has(group.key)) {
      groups.set(group.key, group);
      return group;
    }
    const existing = groups.get(group.key)!;
    existing.sessionId = existing.sessionId || group.sessionId;
    existing.connected = existing.connected || group.connected;
    return existing;
  };
  const addSessionToGroup = (group: WorkflowAgentSessionGroup, session: SidebarSession) => {
    if (group.sessions.some((item) => item.id === session.id)) return;
    group.sessions.push(session);
    group.pendingCount += pendingQuestionsBySessionId.get(session.id)?.length || 0;
    assignedSessionIds.add(session.id);
  };

  for (const session of sessions) {
    const binding = session.workflowBinding || workflowBindingByRelatedSessionId.get(session.id);
    if (!binding) continue;
    for (const entry of buildWorkflowConversationDirectory(binding)) {
      const group = addGroup(createWorkflowAgentGroup({
        key: `${entry.role}:${entry.label}`,
        label: entry.label,
        role: entry.role,
        sessionId: entry.sessionId,
      }));
      const isEntrySession = entry.sessionId && entry.sessionId === session.id;
      const isRuntimeSupervisor = entry.role === 'Supervisor' && session.id === binding.supervisorSessionId;
      const isAgentBinding = session.agentBinding?.agentName === entry.label;
      if (isEntrySession || isRuntimeSupervisor || isAgentBinding) {
        addSessionToGroup(group, session);
      }
    }
  }

  for (const session of sessions) {
    if (assignedSessionIds.has(session.id)) continue;
    if (session.creationSession) {
      addSessionToGroup(
        addGroup(createWorkflowAgentGroup({
          key: 'creation:workflow-design',
          label: '工作流设计',
          role: '创建',
          sessionId: session.id,
        })),
        session
      );
      continue;
    }
    const relatedBinding = session.workflowBinding || workflowBindingByRelatedSessionId.get(session.id);
    if (relatedBinding) {
      addSessionToGroup(
        addGroup(createWorkflowAgentGroup({
          key: 'runtime:workflow-run',
          label: '运行会话',
          role: '运行',
          sessionId: session.id,
        })),
        session
      );
    }
  }

  const roleOrder: Record<WorkflowAgentSessionGroup['role'], number> = {
    Supervisor: 0,
    创建: 1,
    运行: 2,
    Agent: 3,
  };

  return Array.from(groups.values())
    .filter((group) => group.sessions.length > 0 || Boolean(group.sessionId))
    .map((group) => ({
      ...group,
      sessions: group.sessions.sort((a, b) => {
        const aPending = pendingQuestionsBySessionId.get(a.id)?.length || 0;
        const bPending = pendingQuestionsBySessionId.get(b.id)?.length || 0;
        if (aPending !== bPending) return bPending - aPending;
        return compareSidebarSessions(a, b);
      }),
    }))
    .sort((a, b) => {
      if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
      if (roleOrder[a.role] !== roleOrder[b.role]) return roleOrder[a.role] - roleOrder[b.role];
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.label.localeCompare(b.label, 'zh-CN');
    });
}

function getWorkflowSessionBucket(input: {
  session: SidebarSession;
  pendingQuestionCount: number;
  runStatusById: Record<string, string>;
  relatedBinding?: SidebarSession['workflowBinding'];
}): WorkflowBucketKey {
  const { session, pendingQuestionCount, runStatusById, relatedBinding = session.workflowBinding } = input;
  const runId = relatedBinding?.runId;
  const runStatus = runId ? runStatusById[runId] : '';
  if (runId) {
    return isActiveRunStatus(runStatus) || pendingQuestionCount > 0 ? 'active' : 'ready';
  }

  const creationStatus = session.creationSession?.status;
  if (creationStatus === 'draft' || creationStatus === 'confirmed') return 'creating';
  if (
    session.sessionWorkbenchState?.homeSidebar?.intent === 'create-workflow'
    || Boolean(session.sessionWorkbenchState?.homeSidebar?.workflowDraft)
  ) {
    return 'creating';
  }
  return 'ready';
}

function getSelectionState(sessionIds: string[], selectedSessionIds: Set<string>): CheckedState {
  if (sessionIds.length === 0) return false;
  const selectedCount = sessionIds.filter((id) => selectedSessionIds.has(id)).length;
  if (selectedCount === 0) return false;
  if (selectedCount === sessionIds.length) return true;
  return 'indeterminate';
}

function checkedStateToBoolean(checked: CheckedState): boolean {
  return checked === true;
}

function getUniqueSessionIds(sessions: Pick<SidebarSession, 'id'>[]): string[] {
  return Array.from(new Set(sessions.map((session) => session.id).filter(Boolean)));
}

function isAgoraGuestAvailable(guest: Pick<AgoraGuestConfig | AgoraGuestPreset, 'status'>) {
  return guest.status !== 'unavailable';
}

function getAgoraGuestRuntimeLabel(guest: Pick<AgoraGuestConfig | AgoraGuestPreset, 'engine' | 'model'>) {
  const resolvedGuest = guest as AgoraGuestConfig;
  const engine = String(resolvedGuest.resolvedEngine || guest.engine || '').trim();
  const model = String(resolvedGuest.resolvedModel || guest.model || '').trim();
  if (!engine && !model) return '跟随默认模型';
  return [engine || '默认引擎', model || '默认模型'].join(' / ');
}

function mapAgoraGuestRuntimeOverride(guest: Pick<AgoraGuestConfig, 'runtimeStrategy' | 'engine' | 'model'>) {
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

function formatAgoraUnavailableGuests(guests: Array<Pick<AgoraGuestConfig | AgoraGuestPreset, 'displayName' | 'statusReason'>>) {
  return guests.map((guest) => `${guest.displayName}：${guest.statusReason || '模型或引擎未配置'}`).join('；');
}

function mapAgoraGuestToParticipant(guest: AgoraGuestConfig): CollaborationChatroomParticipant {
  const runtime = mapAgoraGuestRuntimeOverride(guest);
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
}

function mapTemporaryDraftToParticipant(draft: TopicTemporaryGuestDraft): CollaborationChatroomParticipant {
  return {
    id: `participant-temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: draft.name.trim(),
    sourceType: 'custom',
    personaPrompt: draft.personaPrompt.trim(),
    useDefaultModel: !(draft.engine || draft.model),
    engine: draft.engine,
    model: draft.model,
    createdAt: Date.now(),
  };
}

function createAgoraWorkbenchState(title = '新议题', participants: CollaborationChatroomParticipant[] = []) {
  const names = participants.map((participant) => participant.name).filter(Boolean);
  return {
    collaborationRoom: {
      topic: title,
      selectedAgents: names,
      mode: 'group-chat' as const,
      messages: [],
      rounds: [],
      agentSessions: {},
      chatroom: createInitialChatroomState({
        status: 'running',
        topic: title,
        participants: names,
        participantRoster: participants,
      }),
    },
  };
}

function getSidebarInitials(name: string) {
  return name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase() || name.slice(0, 2).toUpperCase();
}

function getAgoraSessionTitle(session: SidebarSession): string {
  const room = session.sessionWorkbenchState?.collaborationRoom;
  const title = room?.chatroom?.topic || room?.topic || session.title || '新议题';
  return title === '新议场' ? '新议题' : title;
}

function getAgoraSessionParticipants(session: SidebarSession): string[] {
  const room = session.sessionWorkbenchState?.collaborationRoom;
  const chatroom = room?.chatroom;
  const names = [
    ...((chatroom?.participantRoster || []).map((participant: any) => participant?.name).filter(Boolean)),
    ...((chatroom?.participants || []).filter(Boolean)),
    ...((room?.selectedAgents || []).filter(Boolean)),
  ];
  return Array.from(new Set(names));
}

function isLegacyEmptyAgoraSession(session: SidebarSession): boolean {
  return !session.workflowBinding
    && !session.creationSession
    && !session.sessionWorkbenchState?.collaborationRoom
    && session.title === '新议场'
    && (session.messageCount || 0) === 0;
}

function getDeleteConfirmationDescription(input: {
  view: SessionDirectoryView;
  sessions: SidebarSession[];
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  activeStreamingSessionIds: string[];
  sessionLoadingId: string | null;
  runStatusById: Record<string, string>;
}): string {
  const {
    view,
    sessions,
    pendingQuestionsBySessionId,
    activeStreamingSessionIds,
    sessionLoadingId,
    runStatusById,
  } = input;
  const workflowCounts = new Map<string, number>();
  let workflowDraftingCount = 0;
  let workflowCompletedCount = 0;
  let agentChatCount = 0;
  let runningCount = 0;
  let pendingCount = 0;
  let streamingCount = 0;
  let wechatCount = 0;
  for (const session of sessions) {
    if (session.workflowBinding || session.creationSession) {
      const workflowName = getWorkflowSessionName(session);
      workflowCounts.set(workflowName, (workflowCounts.get(workflowName) || 0) + 1);
    }
    if (session.conversationMode === 'workflow-drafting' || session.creationSession) workflowDraftingCount += 1;
    if (session.conversationMode === 'workflow-completed') workflowCompletedCount += 1;
    if (session.conversationMode === 'agent-chat' || session.sessionWorkbenchState?.collaborationRoom) agentChatCount += 1;
    const runId = session.workflowBinding?.runId;
    if (runId && isActiveRunStatus(runStatusById[runId])) runningCount += 1;
    pendingCount += pendingQuestionsBySessionId.get(session.id)?.length || 0;
    if (activeStreamingSessionIds.includes(session.id) || sessionLoadingId === session.id) streamingCount += 1;
    if (hasWeChatBinding(session)) wechatCount += 1;
  }
  const workflowSummary = Array.from(workflowCounts.entries())
    .slice(0, 4)
    .map(([name, count]) => `${name}：${count} 个会话`)
    .join('；');
  const moreCount = workflowCounts.size > 4 ? `；另有 ${workflowCounts.size - 4} 个工作流` : '';
  const riskLines = [
    `将删除选中的 ${sessions.length} 个对话，删除后无法恢复。`,
    workflowSummary ? `涉及 ${workflowSummary}${moreCount}。` : '',
    workflowDraftingCount > 0 ? `其中 ${workflowDraftingCount} 个正在创建工作流，删除会丢弃当前对话内草案入口。` : '',
    workflowCompletedCount > 0 ? `其中 ${workflowCompletedCount} 个是已完成工作流对话；只删除首页对话记录，不会删除 run history、配置和产物。` : '',
    workflowCounts.size > 0 && workflowCompletedCount === 0 ? '只删除首页对话记录，不会删除工作流配置、运行历史和产物。' : '',
    runningCount > 0 ? `其中 ${runningCount} 个属于运行中工作流。` : '',
    agentChatCount > 0 ? `其中 ${agentChatCount} 个是多 Agent 群聊，对话记录和群聊上下文会一起删除。` : '',
    streamingCount > 0 ? `其中 ${streamingCount} 个正在生成或加载，删除会先尝试停止关联会话进程。` : '',
    pendingCount > 0 ? `其中包含 ${pendingCount} 个待审入口，删除会移除首页入口但不会自动处理待审。` : '',
    wechatCount > 0 ? `其中 ${wechatCount} 个绑定了微信入口，删除会移除该会话入口。` : '',
  ].filter(Boolean);
  return riskLines.join('\n');
}

function getSingleDeleteConfirmationDescription(session: ChatSessionSummaryLike): string {
  const lines = [`删除「${session.title}」后无法恢复。`];
  if (session.conversationMode === 'workflow-drafting' || session.creationSession) {
    lines.push('该对话正在创建工作流，删除会丢弃当前对话内草案入口。');
  } else if (session.workflowBinding || session.conversationMode === 'workflow-completed') {
    lines.push('只删除首页对话记录，不会删除 run history、工作流配置和产物。');
  } else if (session.conversationMode === 'agent-chat' || session.sessionWorkbenchState?.collaborationRoom) {
    lines.push('该对话是多 Agent 群聊，删除会移除群聊上下文。');
  }
  return lines.join('\n');
}

function ChatSidebarComponent({
  sessionView: controlledSessionView,
  onSessionViewChange,
  compact = false,
}: {
  sessionView?: SessionDirectoryView;
  onSessionViewChange?: (view: SessionDirectoryView) => void;
  compact?: boolean;
}) {
  const {
    sessions,
    activeSessionId,
    activeSession,
    setActiveSessionId,
    setSessionWorkbenchState,
    createSession,
    deleteSession,
    deleteSessions,
    renameSession,
    loading,
    activeStreamingSessionIds = EMPTY_SESSION_ID_LIST,
    recentlyCompletedSessionIds = EMPTY_SESSION_ID_LIST,
    sessionLoadingId,
    skillSettings = EMPTY_SKILL_SETTINGS,
    discoveredSkills = EMPTY_SKILLS,
    toggleSkill = noopToggleSetting,
    setSkillsEnabled = noopSetSettings,
    mcpSettings = EMPTY_MCP_SETTINGS,
    discoveredMcpServers = EMPTY_MCP_SERVERS,
    toggleMcpServer = noopToggleSetting,
    setMcpServersEnabled = noopSetSettings,
    capabilitySkills = {},
    setCapabilitySkills = () => {},
  } = useChat();
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [internalSessionView, setInternalSessionView] = useState<SessionDirectoryView>('conversation');
  const updateSessionView = useCallback((_view: SessionDirectoryView) => {
    if (!controlledSessionView) setInternalSessionView('conversation');
    onSessionViewChange?.('conversation');
  }, [controlledSessionView, onSessionViewChange]);
  const [manageMode, setManageMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [sessionSearchByView, setSessionSearchByView] = useState<Record<SessionDirectoryView, string>>({
    conversation: '',
  });
  const { pendingHumanQuestions, runStatusById } = useWorkflowLiveState();
  const [agoraTopicDialogOpen, setAgoraTopicDialogOpen] = useState(false);
  const [agoraGuestDialogOpen, setAgoraGuestDialogOpen] = useState(false);
  const [agoraGuestsLoading, setAgoraGuestsLoading] = useState(false);
  const [agoraSavedGuests, setAgoraSavedGuests] = useState<AgoraGuestConfig[]>([]);
  const [agoraGuestManageMode, setAgoraGuestManageMode] = useState(false);
  const [agoraManagedGuestIds, setAgoraManagedGuestIds] = useState<Set<string>>(() => new Set());
  const [agoraGuestDeleting, setAgoraGuestDeleting] = useState(false);
  const [agoraGuestPresets, setAgoraGuestPresets] = useState<AgoraGuestPreset[]>([]);
  const [agoraTopicTitle, setAgoraTopicTitle] = useState('新议题');
  const [agoraSelectedGuestIds, setAgoraSelectedGuestIds] = useState<string[]>([]);
  const [agoraTemporaryGuests, setAgoraTemporaryGuests] = useState<TopicTemporaryGuestDraft[]>([]);
  const [agoraTemporaryDraft, setAgoraTemporaryDraft] = useState<TopicTemporaryGuestDraft>({
    name: '',
    personaPrompt: '',
    engine: '',
    model: '',
  });
  const [agoraPresetCreateDrafts, setAgoraPresetCreateDrafts] = useState<PresetGuestCreateDraft[]>([]);
  const [agoraPresetSaving, setAgoraPresetSaving] = useState(false);
  const [agoraCustomGuestDraft, setAgoraCustomGuestDraft] = useState<CustomGuestDraft>({
    displayName: '',
    personaPrompt: '',
    engine: '',
    model: '',
  });
  const [agoraCustomGuestSaving, setAgoraCustomGuestSaving] = useState(false);
  const [agoraGuestEditOpen, setAgoraGuestEditOpen] = useState(false);
  const [agoraGuestEditSaving, setAgoraGuestEditSaving] = useState(false);
  const [agoraGuestEditDraft, setAgoraGuestEditDraft] = useState<AgoraGuestEditDraft | null>(null);
  const [workspaceDeleteConfirm, setWorkspaceDeleteConfirm] = useState<{
    session: ChatSessionSummaryLike;
    workspacePath: string;
  } | null>(null);
  const [deleteWorkspaceWithSession, setDeleteWorkspaceWithSession] = useState(true);
  const [workspaceDeleting, setWorkspaceDeleting] = useState(false);
  const { confirm, dialogProps } = useConfirmDialog();
  const { toast } = useToast();

  const enabledCount = useMemo(
    () => discoveredSkills.filter((skill) => !!skillSettings[skill.name]).length,
    [discoveredSkills, skillSettings]
  );
  const enabledMcpCount = useMemo(
    () => discoveredMcpServers.filter((server) => !!mcpSettings[server.name]).length,
    [discoveredMcpServers, mcpSettings]
  );
  const enabledKnowledgeCount = useMemo(
    () => capabilitySkills?.rag?.enabled ? (capabilitySkills?.rag?.knowledgeBases?.length || 0) : 0,
    [capabilitySkills]
  );
  const activeStreamingSessionIdSet = useMemo(
    () => new Set(activeStreamingSessionIds),
    [activeStreamingSessionIds]
  );
  const recentlyCompletedSessionIdSet = useMemo(
    () => new Set(recentlyCompletedSessionIds),
    [recentlyCompletedSessionIds]
  );
  const agoraExtensionActions = useMemo(() => getAgoraTopicExtensionActions(), []);
  const currentSessionView = 'conversation' as SessionDirectoryView;
  const sessionsWithActiveState = useMemo(() => {
    if (!activeSession) return sessions as SidebarSession[];
    const base = sessions as SidebarSession[];
    let found = false;
    const merged = base.map((session) => {
      if (session.id !== activeSession.id) return session;
      found = true;
      return {
        ...session,
        title: activeSession.title,
        lastMessage: session.lastMessage,
        creationSession: activeSession.creationSession,
        workflowBinding: activeSession.workflowBinding,
        agentBinding: activeSession.agentBinding,
        sessionWorkbenchState: activeSession.sessionWorkbenchState,
      } as SidebarSession;
    });
    if (!found) {
      merged.unshift({
        id: activeSession.id,
        title: activeSession.title,
        updatedAt: activeSession.updatedAt,
        messageCount: activeSession.messages.length,
        lastMessage: activeSession.messages.filter((message) => message.role !== 'error').slice(-1)[0]?.content,
        creationSession: activeSession.creationSession,
        workflowBinding: activeSession.workflowBinding,
        agentBinding: activeSession.agentBinding,
        sessionWorkbenchState: activeSession.sessionWorkbenchState,
      } as SidebarSession);
    }
    return merged;
  }, [activeSession, sessions]);

  const groupedSessions = useMemo(() => {
    const unified = collapseDuplicateCreationPlanningSessions([...sessionsWithActiveState]).sort(compareSidebarSessions);
    return {
      conversation: unified,
    };
  }, [sessionsWithActiveState]);
  const baseVisibleSessions = groupedSessions[currentSessionView];
  const sessionSearch = sessionSearchByView[currentSessionView] || '';
  const normalizedSearch = sessionSearch.trim().toLowerCase();
  const visibleSessions = useMemo(() => {
    if (!normalizedSearch) return baseVisibleSessions;
    return baseVisibleSessions.filter((session) => {
      const haystack = [
        session.title,
        session.lastMessage,
        session.workflowBinding?.configFile,
        session.workflowBinding?.runId,
        session.creationSession?.filename,
        session.creationSession?.workflowName,
        session.sessionWorkbenchState?.collaborationRoom?.topic,
        ...(session.sessionWorkbenchState?.collaborationRoom?.selectedAgents || []),
        session.agentBinding?.agentName,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [baseVisibleSessions, normalizedSearch]);
  const isFilteredEmpty = normalizedSearch.length > 0 && visibleSessions.length === 0;
  const visibleSessionIds = useMemo(() => getUniqueSessionIds(visibleSessions as SidebarSession[]), [visibleSessions]);
  const visibleSessionIdSet = useMemo(() => new Set(visibleSessionIds), [visibleSessionIds]);
  const visibleSessionById = useMemo(
    () => new Map((visibleSessions as SidebarSession[]).map((session) => [session.id, session])),
    [visibleSessions]
  );
  const selectedVisibleCount = useMemo(
    () => visibleSessionIds.filter((sessionId) => selectedSessionIds.has(sessionId)).length,
    [selectedSessionIds, visibleSessionIds]
  );
  const selectedVisibleState = useMemo(
    () => getSelectionState(visibleSessionIds, selectedSessionIds),
    [selectedSessionIds, visibleSessionIds]
  );
  const pendingQuestionsBySessionId = useMemo(() => {
    const map = new Map<string, HumanQuestion[]>();
    for (const question of pendingHumanQuestions) {
      const sessionId = question.workflowFrontendSessionId || '';
      if (!sessionId) continue;
      const list = map.get(sessionId) || [];
      list.push(question);
      map.set(sessionId, list);
    }
    return map;
  }, [pendingHumanQuestions]);
  useEffect(() => {
    setSelectedSessionIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleSessionIdSet.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visibleSessionIdSet]);

  useEffect(() => {
    const visibleIds = new Set(agoraSavedGuests.map((guest) => guest.id));
    setAgoraManagedGuestIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [agoraSavedGuests]);

  useEffect(() => {
    if (!activeSession || !isLegacyEmptyAgoraSession(activeSession as unknown as SidebarSession)) return;
    renameSession(activeSession.id, '新议题');
    setSessionWorkbenchState(createAgoraWorkbenchState('新议题'));
  }, [activeSession, renameSession, setSessionWorkbenchState]);

  useEffect(() => {
    setSelectedSessionIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [sessionSearch]);

  useEffect(() => {
    setAgoraGuestManageMode(false);
    setAgoraManagedGuestIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  useEffect(() => {
    if (agoraGuestManageMode && agoraSavedGuests.length === 0) {
      setAgoraGuestManageMode(false);
    }
    if (agoraGuestManageMode) return;
    setAgoraManagedGuestIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [agoraGuestManageMode, agoraSavedGuests.length]);

  const loadAgoraGuests = useCallback(async () => {
    setAgoraGuestsLoading(true);
    try {
      const data = await agoraApi.listGuests();
      setAgoraSavedGuests(Array.isArray(data.guests) ? data.guests : []);
      setAgoraGuestPresets(Array.isArray(data.presets) ? data.presets : []);
    } catch (error: any) {
      toast('warning', error?.message || '加载议场嘉宾失败');
    } finally {
      setAgoraGuestsLoading(false);
    }
  }, [toast]);

  const openCreateAgoraTopicDialog = () => {
    setAgoraTopicTitle('新议题');
    setAgoraSelectedGuestIds([]);
    setAgoraTemporaryGuests([]);
    setAgoraTemporaryDraft({ name: '', personaPrompt: '', engine: '', model: '' });
    setAgoraTopicDialogOpen(true);
    void loadAgoraGuests();
  };

  const createAgoraSession = (participants: CollaborationChatroomParticipant[] = [], title = '新议题') => {
    const topic = title.trim() || '新议题';
    const sessionId = createSession({
      title: topic,
      sessionWorkbenchState: createAgoraWorkbenchState(topic, participants),
    });
    updateSessionView('conversation');
    setActiveSessionId(sessionId);
  };

  const addTemporaryGuestToTopicDraft = () => {
    const name = agoraTemporaryDraft.name.trim();
    const personaPrompt = agoraTemporaryDraft.personaPrompt.trim();
    if (!name) {
      toast('warning', '请填写临时嘉宾名称');
      return;
    }
    if (!personaPrompt) {
      toast('warning', '请填写临时嘉宾提示词');
      return;
    }
    const existingNames = new Set([
      ...agoraSavedGuests.filter((guest) => agoraSelectedGuestIds.includes(guest.id)).map((guest) => guest.displayName),
      ...agoraTemporaryGuests.map((guest) => guest.name),
    ]);
    if (existingNames.has(name)) {
      toast('warning', `嘉宾「${name}」已在议题中`);
      return;
    }
    setAgoraTemporaryGuests((prev) => [...prev, { ...agoraTemporaryDraft, name, personaPrompt }]);
    setAgoraTemporaryDraft({ name: '', personaPrompt: '', engine: '', model: '' });
  };

  const submitCreateAgoraTopic = () => {
    const title = agoraTopicTitle.trim() || '新议题';
    const selectedGuests = agoraSavedGuests.filter((guest) => agoraSelectedGuestIds.includes(guest.id));
    const unavailable = selectedGuests.filter((guest) => !isAgoraGuestAvailable(guest));
    if (unavailable.length) {
      toast('warning', `以下嘉宾不可用：${formatAgoraUnavailableGuests(unavailable)}`);
      return;
    }
    const participants = [
      ...selectedGuests.filter(isAgoraGuestAvailable).map(mapAgoraGuestToParticipant),
      ...agoraTemporaryGuests.map(mapTemporaryDraftToParticipant),
    ];
    if (!participants.length) {
      toast('warning', '请至少选择或添加一位嘉宾');
      return;
    }
    createAgoraSession(participants, title);
    setAgoraTopicDialogOpen(false);
  };

  const createSelectedPresetGuests = async () => {
    const selectedPresets = agoraPresetCreateDrafts
      .map((draft) => {
        const preset = agoraGuestPresets.find((item) => item.id === draft.presetId);
        return preset ? { draft, preset } : null;
      })
      .filter((item): item is { draft: PresetGuestCreateDraft; preset: AgoraGuestPreset } => Boolean(item));
    const unavailable = selectedPresets.filter((item) => !isAgoraGuestAvailable(item.preset));
    if (unavailable.length) {
      toast('warning', `以下嘉宾不可用：${formatAgoraUnavailableGuests(unavailable.map((item) => item.preset))}`);
      return;
    }
    if (!selectedPresets.length) {
      toast('warning', '请选择要创建的预设嘉宾');
      return;
    }
    const missingPrompt = selectedPresets.find(({ draft }) => !draft.personaPrompt.trim());
    if (missingPrompt) {
      toast('warning', `请填写「${missingPrompt.preset.displayName}」的提示词`);
      return;
    }
    setAgoraPresetSaving(true);
    try {
      const created = await Promise.all(selectedPresets.map(async ({ draft, preset }) => {
        const result = await agoraApi.saveGuest({
          displayName: preset.displayName,
          sourceType: 'preset',
          presetId: preset.id,
          sourceAgent: preset.templateAgent,
          personaPrompt: draft.personaPrompt.trim(),
          engine: draft.engine,
          model: draft.model,
        });
        return result.guest;
      }));
      const unavailableCreated = created.filter((guest) => !isAgoraGuestAvailable(guest));
      if (unavailableCreated.length) {
        toast('warning', `以下嘉宾不可用：${formatAgoraUnavailableGuests(unavailableCreated)}`);
      }
      setAgoraSavedGuests((prev) => {
        const nextById = new Map(prev.map((guest) => [guest.id, guest]));
        created.forEach((guest) => nextById.set(guest.id, guest));
        return Array.from(nextById.values()).sort((a, b) => a.createdAt - b.createdAt);
      });
      setAgoraPresetCreateDrafts([]);
      window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      toast('success', `已创建 ${created.length} 位常驻嘉宾`);
    } catch (error: any) {
      toast('error', error?.message || '创建常驻嘉宾失败');
    } finally {
      setAgoraPresetSaving(false);
    }
  };

  const addPresetCreateDraft = (preset: AgoraGuestPreset) => {
    setAgoraPresetCreateDrafts((prev) => [
      ...prev,
      {
        id: `preset-draft-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        presetId: preset.id,
        personaPrompt: preset.personaPrompt || '',
        engine: '',
        model: '',
      },
    ]);
  };

  const removePresetCreateDraft = (draftId: string) => {
    setAgoraPresetCreateDrafts((prev) => prev.filter((draft) => draft.id !== draftId));
  };

  const updatePresetCreateDraft = (draftId: string, patch: Partial<Pick<PresetGuestCreateDraft, 'personaPrompt' | 'engine' | 'model'>>) => {
    setAgoraPresetCreateDrafts((prev) => prev.map((draft) => (
      draft.id === draftId ? { ...draft, ...patch } : draft
    )));
  };

  const openAgoraGuestEditDialog = useCallback((guest: AgoraGuestConfig) => {
    setAgoraGuestEditDraft({
      id: guest.id,
      displayName: guest.displayName,
      sourceType: guest.sourceType,
      sourceAgent: guest.sourceAgent,
      presetId: guest.presetId,
      personaPrompt: guest.personaPrompt || '',
      engine: guest.engine || '',
      model: guest.model || '',
    });
    setAgoraGuestEditOpen(true);
  }, []);

  const saveAgoraGuestEdit = async () => {
    if (!agoraGuestEditDraft) return;
    const displayName = agoraGuestEditDraft.displayName.trim();
    const personaPrompt = agoraGuestEditDraft.personaPrompt.trim();
    if (!displayName) {
      toast('warning', '请填写嘉宾名称');
      return;
    }
    if (!personaPrompt) {
      toast('warning', '请填写嘉宾提示词');
      return;
    }
    setAgoraGuestEditSaving(true);
    try {
      const result = await agoraApi.saveGuest({
        id: agoraGuestEditDraft.id,
        displayName,
        sourceType: agoraGuestEditDraft.sourceType,
        sourceAgent: agoraGuestEditDraft.sourceAgent,
        presetId: agoraGuestEditDraft.presetId,
        personaPrompt,
        engine: agoraGuestEditDraft.engine,
        model: agoraGuestEditDraft.model,
      });
      setAgoraSavedGuests((prev) => (
        prev
          .map((guest) => (guest.id === result.guest.id ? result.guest : guest))
          .sort((a, b) => a.createdAt - b.createdAt)
      ));
      setAgoraGuestEditOpen(false);
      setAgoraGuestEditDraft(null);
      window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      toast(isAgoraGuestAvailable(result.guest) ? 'success' : 'warning', isAgoraGuestAvailable(result.guest)
        ? `已更新常驻嘉宾「${result.guest.displayName}」`
        : `嘉宾「${result.guest.displayName}」不可用：${result.guest.statusReason || '模型或引擎未配置'}`);
    } catch (error: any) {
      toast('error', error?.message || '保存常驻嘉宾失败');
    } finally {
      setAgoraGuestEditSaving(false);
    }
  };

  const createCustomAgoraGuest = async () => {
    const displayName = agoraCustomGuestDraft.displayName.trim();
    const personaPrompt = agoraCustomGuestDraft.personaPrompt.trim();
    if (!displayName) {
      toast('warning', '请填写嘉宾名称');
      return;
    }
    if (!personaPrompt) {
      toast('warning', '请填写嘉宾提示词');
      return;
    }
    setAgoraCustomGuestSaving(true);
    try {
      const result = await agoraApi.saveGuest({
        displayName,
        sourceType: 'custom',
        personaPrompt,
        engine: agoraCustomGuestDraft.engine,
        model: agoraCustomGuestDraft.model,
      });
      setAgoraSavedGuests((prev) => {
        const without = prev.filter((guest) => guest.id !== result.guest.id);
        return [...without, result.guest].sort((a, b) => a.createdAt - b.createdAt);
      });
      setAgoraCustomGuestDraft({ displayName: '', personaPrompt: '', engine: '', model: '' });
      window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      toast(isAgoraGuestAvailable(result.guest) ? 'success' : 'warning', isAgoraGuestAvailable(result.guest)
        ? `已创建常驻嘉宾「${result.guest.displayName}」`
        : `嘉宾「${result.guest.displayName}」不可用：${result.guest.statusReason || '模型或引擎未配置'}`);
    } catch (error: any) {
      toast('error', error?.message || '创建常驻嘉宾失败');
    } finally {
      setAgoraCustomGuestSaving(false);
    }
  };

  const toggleAgoraManagedGuestSelected = (guestId: string, checked: boolean) => {
    setAgoraManagedGuestIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(guestId);
      else next.delete(guestId);
      return next;
    });
  };

  const toggleAllAgoraManagedGuestsSelected = (checked: boolean) => {
    setAgoraManagedGuestIds(checked ? new Set(agoraSavedGuests.map((guest) => guest.id)) : new Set());
  };

  const deleteAgoraGuests = async (guests: AgoraGuestConfig[]) => {
    const guestsToDelete = guests.filter((guest, index, list) => (
      Boolean(guest.id) && list.findIndex((item) => item.id === guest.id) === index
    ));
    if (!guestsToDelete.length) return;
    const ok = await confirm({
      title: guestsToDelete.length > 1 ? '确认批量删除常驻嘉宾' : '确认删除常驻嘉宾',
      description: guestsToDelete.length > 1
        ? `删除选中的 ${guestsToDelete.length} 位常驻嘉宾后，已有议题中的嘉宾记录不会被自动移除，但后续不能再从常驻嘉宾中选择。`
        : `删除「${guestsToDelete[0].displayName}」后，已有议题中的嘉宾记录不会被自动移除，但后续不能再从常驻嘉宾中选择。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    setAgoraGuestDeleting(true);
    try {
      const results = await Promise.allSettled(guestsToDelete.map((guest) => agoraApi.deleteGuest(guest.id)));
      const deletedIds: string[] = [];
      const failedGuests: Array<{ guest: AgoraGuestConfig; message: string }> = [];

      results.forEach((result, index) => {
        const guest = guestsToDelete[index];
        if (result.status === 'fulfilled') {
          deletedIds.push(guest.id);
          return;
        }
        failedGuests.push({
          guest,
          message: result.reason?.message || '删除失败',
        });
      });

      if (deletedIds.length > 0) {
        const deletedIdSet = new Set(deletedIds);
        setAgoraSavedGuests((prev) => prev.filter((item) => !deletedIdSet.has(item.id)));
        setAgoraSelectedGuestIds((prev) => prev.filter((id) => !deletedIdSet.has(id)));
        setAgoraManagedGuestIds((prev) => new Set([...prev].filter((id) => !deletedIdSet.has(id))));
        window.dispatchEvent(new CustomEvent('agora:guests-updated'));
      }

      if (failedGuests.length > 0) {
        const failureSummary = failedGuests.length === 1
          ? `${failedGuests[0].guest.displayName}：${failedGuests[0].message}`
          : `${failedGuests.length} 位删除失败`;
        toast(
          deletedIds.length > 0 ? 'warning' : 'error',
          deletedIds.length > 0 ? `已删除 ${deletedIds.length} 位常驻嘉宾，${failureSummary}` : failureSummary,
        );
        return;
      }

      toast('success', guestsToDelete.length > 1 ? `已删除 ${guestsToDelete.length} 位常驻嘉宾` : '已删除常驻嘉宾');
    } catch (error: any) {
      toast('error', error?.message || '删除常驻嘉宾失败');
    } finally {
      setAgoraGuestDeleting(false);
    }
  };

  const deleteSelectedAgoraGuests = async () => {
    const guestsToDelete = agoraSavedGuests.filter((guest) => agoraManagedGuestIds.has(guest.id));
    if (!guestsToDelete.length) return;
    await deleteAgoraGuests(guestsToDelete);
  };

  const createAgoraExtensionTopic = (actionId: string) => {
    const action = agoraExtensionActions.find((item) => item.id === actionId);
    if (!action) return;
    const topic = action.createTopic();
    const sessionId = createSession({
      title: topic.title,
      sessionWorkbenchState: topic.sessionWorkbenchState,
    });
    updateSessionView('conversation');
    setActiveSessionId(sessionId);
  };

  const openAgoraSession = (session: SidebarSession) => {
    if (isLegacyEmptyAgoraSession(session)) {
      updateSessionView('conversation');
      setActiveSessionId(session.id);
      return;
    }
    setActiveSessionId(session.id);
  };

  const toggleSessionSelected = (sessionId: string, checked: boolean) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  };

  const toggleAllVisibleSelected = (checked: boolean) => {
    setSelectedSessionIds(checked ? new Set(visibleSessionIds) : new Set());
  };

  const deleteSelectedSessions = async () => {
    const selectedSessions = Array.from(selectedSessionIds)
      .map((sessionId) => visibleSessionById.get(sessionId))
      .filter((session): session is SidebarSession => Boolean(session));
    const protectedSessions = selectedSessions.filter((session) => (
      isRunningWorkflowConversation({ workflowBinding: session.workflowBinding, runStatusById })
    ));
    const deletableSessions = selectedSessions.filter((session) => (
      !isRunningWorkflowConversation({ conversationMode: session.conversationMode, workflowBinding: session.workflowBinding, runStatusById })
    ));
    const ids = getUniqueSessionIds(deletableSessions);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '确认删除对话',
      description: getDeleteConfirmationDescription({
        view: currentSessionView,
        sessions: deletableSessions,
        pendingQuestionsBySessionId,
        activeStreamingSessionIds,
        sessionLoadingId,
        runStatusById,
      }),
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    if (protectedSessions.length > 0) {
      toast('warning', `已跳过 ${protectedSessions.length} 个运行中的工作流对话`);
    }
    deleteSessions(ids);
    setSelectedSessionIds(new Set());
    setManageMode(false);
  };

  const requestDeleteSession = async (session: ChatSessionSummaryLike) => {
    if (isRunningWorkflowConversation({ conversationMode: session.conversationMode, workflowBinding: session.workflowBinding, runStatusById })) {
      toast('warning', '工作流运行中的对话不能删除');
      return;
    }
    const defaultWorkspacePath = getDefaultAgoraWorkspaceDeleteCandidate(session as SidebarSession);
    if (defaultWorkspacePath) {
      setDeleteWorkspaceWithSession(true);
      setWorkspaceDeleteConfirm({
        session,
        workspacePath: defaultWorkspacePath,
      });
      return;
    }

    const ok = await confirm({
      title: '确认删除对话',
      description: getSingleDeleteConfirmationDescription(session),
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    deleteSession(session.id);
  };

  const confirmDeleteSessionWithOptionalWorkspace = async () => {
    if (!workspaceDeleteConfirm || workspaceDeleting) return;
    const { session, workspacePath } = workspaceDeleteConfirm;
    const shouldDeleteWorkspace = deleteWorkspaceWithSession;

    setWorkspaceDeleting(true);
    deleteSession(session.id);
    setWorkspaceDeleteConfirm(null);

    if (!shouldDeleteWorkspace) {
      setWorkspaceDeleting(false);
      return;
    }

    try {
      await agoraApi.deleteWorkspace({
        sessionId: session.id,
        workspacePath,
      });
      toast('success', '已删除绑定的工作目录');
    } catch (error: any) {
      toast('error', error?.message || '工作目录删除失败，请手动检查');
    } finally {
      setWorkspaceDeleting(false);
    }
  };

  const createButtonLabel = '新建';
  const createButtonTitle = '新建会话';
  const handleCreateSession = () => createSession();

  return (
    <div className="w-full flex h-full flex-col bg-muted/30">
      <div className={compact ? 'border-b bg-muted/20 p-2' : 'border-b bg-gradient-to-r from-primary/10 to-blue-500/10 p-3'}>
        {!compact ? (
          <div className="mb-3 flex items-center gap-2">
            <RobotLogo size={28} />
            <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-sm font-bold text-transparent">ACEHarness</span>
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8 justify-center gap-1.5 px-2 text-xs"
            onClick={handleCreateSession}
            title={createButtonTitle}
            aria-label={createButtonTitle}
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
            {createButtonLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={manageMode ? 'secondary' : 'outline'}
            className={`h-8 justify-center gap-1.5 px-2 text-xs ${
              manageMode ? 'text-primary ring-1 ring-primary/20' : ''
            }`}
            onClick={() => {
              setManageMode((prev) => {
                if (prev) setSelectedSessionIds(new Set());
                return !prev;
              });
            }}
            title={manageMode ? '完成管理' : '批量管理'}
            aria-label={manageMode ? '完成管理' : '批量管理'}
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              {manageMode ? 'done' : 'checklist'}
            </span>
            {manageMode ? '完成管理' : '批量管理'}
          </Button>
        </div>
      </div>

      <div className="home-chat-scroll flex-1 overflow-y-auto">
        <div className="border-b border-border/40 px-3 py-2">
          <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="material-symbols-outlined text-[18px] text-primary">forum</span>
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-foreground">对话</div>
                <div className="truncate text-[10px] text-muted-foreground">群聊和工作流都会显示在这里</div>
              </div>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {groupedSessions.conversation.length}
            </Badge>
          </div>
        </div>

        <div className="border-b border-border/40 px-3 py-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              search
            </span>
            <Input
              value={sessionSearch}
              onChange={(event) => setSessionSearchByView((prev) => ({ ...prev, [currentSessionView]: event.target.value }))}
              placeholder="筛选对话..."
              className="h-8 pl-8 pr-8 text-xs"
            />
            {sessionSearch ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setSessionSearchByView((prev) => ({ ...prev, [currentSessionView]: '' }))}
                aria-label="清空筛选"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            ) : null}
          </div>
        </div>

        {manageMode && visibleSessions.length > 0 && (
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                aria-label="选择全部对话"
                checked={selectedVisibleState}
                onCheckedChange={(checked) => toggleAllVisibleSelected(checkedStateToBoolean(checked))}
                className="h-3.5 w-3.5"
              />
              <span>全选</span>
              {selectedVisibleCount > 0 ? (
                <span className="text-primary">已选 {selectedVisibleCount}</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selectedVisibleCount === 0}
              className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => { void deleteSelectedSessions(); }}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              删除
            </Button>
          </div>
        )}

        {visibleSessions.length === 0 && (
          <EmptySessionState
            kind={currentSessionView}
            filtered={isFilteredEmpty}
            query={sessionSearch.trim()}
            onCreate={!isFilteredEmpty ? () => createSession() : undefined}
          />
        )}
        {visibleSessions.length > 0 ? (
          <div className="home-chat-sidebar-card mx-2 my-2 overflow-hidden rounded-2xl border border-border/45 bg-background/35">
            {visibleSessions.map(session => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                selectable={manageMode}
                selected={selectedSessionIds.has(session.id)}
                isStreaming={activeStreamingSessionIdSet.has(session.id)}
                isRecentlyCompleted={recentlyCompletedSessionIdSet.has(session.id)}
                isLoadingSession={sessionLoadingId === session.id}
                deleteDisabled={isRunningWorkflowConversation({
                  conversationMode: session.conversationMode,
                  workflowBinding: session.workflowBinding,
                  runStatusById,
                })}
                onClick={() => setActiveSessionId(session.id)}
                onSelectChange={(checked) => toggleSessionSelected(session.id, checked)}
                onDelete={() => { void requestDeleteSession(session); }}
                onRename={(title) => renameSession(session.id, title)}
              />
            ))}
          </div>
        ) : null}
      </div>
      {(discoveredSkills.length > 0 || discoveredMcpServers.length > 0 || enabledKnowledgeCount > 0) && (
        <div className="border-t p-3 space-y-1.5">
          <button
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors"
            onClick={() => setSkillModalOpen(true)}
          >
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-muted-foreground">extension</span>
              <span className="text-xs font-semibold text-muted-foreground">Skills/MCP/知识库</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {enabledCount + enabledMcpCount + enabledKnowledgeCount}/{discoveredSkills.length + discoveredMcpServers.length + enabledKnowledgeCount}
            </span>
          </button>
        </div>
      )}
      {/* Skills/MCP 管理弹窗 */}
      {skillModalOpen && (
        <SkillManagerModal
          skills={discoveredSkills}
          skillSettings={skillSettings}
          toggleSkill={toggleSkill}
          setSkillsEnabled={setSkillsEnabled}
          servers={discoveredMcpServers}
          mcpSettings={mcpSettings}
          toggleMcpServer={toggleMcpServer}
          setMcpServersEnabled={setMcpServersEnabled}
          capabilitySkills={capabilitySkills}
          setCapabilitySkills={setCapabilitySkills}
          onClose={() => setSkillModalOpen(false)}
        />
      )}
      <Dialog
        open={Boolean(workspaceDeleteConfirm)}
        onOpenChange={(open) => {
          if (workspaceDeleting) return;
          if (!open) setWorkspaceDeleteConfirm(null);
        }}
      >
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>确认删除对话</DialogTitle>
            <DialogDescription>
              删除「{workspaceDeleteConfirm?.session.title}」后无法恢复。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
              <Checkbox
                checked={deleteWorkspaceWithSession}
                onCheckedChange={(checked) => setDeleteWorkspaceWithSession(checked === true)}
                disabled={workspaceDeleting}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-medium text-foreground">同时删除系统自动创建的工作目录</span>
                <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                  {workspaceDeleteConfirm?.workspacePath}
                </span>
              </span>
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              只会对 ACEHarness 默认创建并绑定到该会话的 agora workspace 生效；用户手动选择的目录不会出现这个选项。
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setWorkspaceDeleteConfirm(null)}
              disabled={workspaceDeleting}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => { void confirmDeleteSessionWithOptionalWorkspace(); }}
              disabled={workspaceDeleting}
            >
              {workspaceDeleting ? '删除中...' : '删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </div>
  );
}

const ChatSidebar = memo(ChatSidebarComponent);
ChatSidebar.displayName = 'ChatSidebar';
export default ChatSidebar;

const LOCKED_SKILLS = ['aceharness-chat-card'];

/* ========== Skills/MCP 管理弹窗 ========== */

function SkillManagerModal({
  skills,
  skillSettings,
  toggleSkill,
  setSkillsEnabled,
  servers,
  mcpSettings,
  toggleMcpServer,
  setMcpServersEnabled,
  capabilitySkills,
  setCapabilitySkills,
  onClose,
}: {
  skills: SkillItem[];
  skillSettings: Record<string, boolean>;
  toggleSkill: (name: string) => void;
  setSkillsEnabled: (skills: Record<string, boolean>) => void;
  servers: McpServerItem[];
  mcpSettings: Record<string, boolean>;
  toggleMcpServer: (name: string) => void;
  setMcpServersEnabled: (servers: Record<string, boolean>) => void;
  capabilitySkills: any;
  setCapabilitySkills: (capabilitySkills: any) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'skills' | 'mcp' | 'rag'>('skills');
  const [knowledgeBases, setKnowledgeBases] = useState<Array<{ id: string; name: string; description?: string; chunkCount?: number; documentCount?: number }>>([]);

  useEffect(() => {
    if (activeTab !== 'rag') return;
    let cancelled = false;
    fetch('/api/rag/knowledge-bases')
      .then((response) => response.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data?.knowledgeBases)) setKnowledgeBases(data.knowledgeBases);
      })
      .catch(() => {
        if (!cancelled) setKnowledgeBases([]);
      });
    return () => { cancelled = true; };
  }, [activeTab]);

  const filteredSkills = useMemo(() => {
    let list = skills;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return list;
  }, [skills, search]);

  const filteredServers = useMemo(() => {
    if (!search.trim()) return servers;
    const query = search.trim().toLowerCase();
    return servers.filter((server) => {
      const envKeys = Object.keys(server.env || {}).join(' ');
      return [
        server.name,
        server.command,
        envKeys,
      ].join(' ').toLowerCase().includes(query);
    });
  }, [search, servers]);

  const enabledCount = useMemo(
    () => skills.filter((skill) => !!skillSettings[skill.name]).length,
    [skillSettings, skills]
  );
  const enabledMcpCount = useMemo(
    () => servers.filter((server) => !!mcpSettings[server.name]).length,
    [mcpSettings, servers]
  );
  const selectableSkills = useMemo(
    () => skills.filter((skill) => !LOCKED_SKILLS.includes(skill.name)),
    [skills]
  );
  const selectedFilteredSkillCount = useMemo(
    () => filteredSkills.filter((skill) => !!skillSettings[skill.name]).length,
    [filteredSkills, skillSettings]
  );
  const selectedFilteredMcpCount = useMemo(
    () => filteredServers.filter((server) => !!mcpSettings[server.name]).length,
    [filteredServers, mcpSettings]
  );

  const setAllSelectableSkills = (enabled: boolean) => {
    const next = Object.fromEntries(selectableSkills.map(skill => [skill.name, enabled]));
    for (const skillName of LOCKED_SKILLS) {
      if (skills.some(skill => skill.name === skillName)) next[skillName] = true;
    }
    setSkillsEnabled(next);
  };

  const setAllServers = (enabled: boolean) => {
    const next = Object.fromEntries(servers.map((server) => [server.name, enabled]));
    setMcpServersEnabled(next);
  };

  const tabs = [
    { key: 'skills' as const, label: 'Skills', count: skills.length },
    { key: 'mcp' as const, label: 'MCP', count: servers.length },
    { key: 'rag' as const, label: '知识库', count: capabilitySkills?.rag?.enabled ? (capabilitySkills?.rag?.knowledgeBases?.length || 0) : 0 },
  ];
  const ragEnabled = Boolean(capabilitySkills?.rag?.enabled);
  const selectedKnowledgeBases = new Set(Array.isArray(capabilitySkills?.rag?.knowledgeBases) ? capabilitySkills.rag.knowledgeBases : ['default']);
  const ragTopK = Number(capabilitySkills?.rag?.topK || 8);
  const updateRagCapability = (patch: Record<string, unknown>) => {
    const previous = capabilitySkills || {};
    const previousRag = previous.rag || {};
    setCapabilitySkills({
      ...previous,
      rag: {
        enabled: false,
        knowledgeBases: ['default'],
        topK: 8,
        autoInject: false,
        allowAgentQuery: true,
        ...previousRag,
        ...patch,
      },
    });
  };
  const selectedFilteredCount = activeTab === 'skills' ? selectedFilteredSkillCount : activeTab === 'mcp' ? selectedFilteredMcpCount : selectedKnowledgeBases.size;
  const filteredCount = activeTab === 'skills' ? filteredSkills.length : activeTab === 'mcp' ? filteredServers.length : knowledgeBases.length;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-lg w-[620px] max-w-[92vw] max-h-[75vh] flex flex-col border"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-semibold">Skills/MCP</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>已启用 {enabledCount} / {skills.length} 个技能</span>
              <span> · MCP {enabledMcpCount}/{servers.length}</span>
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <span className="material-symbols-outlined text-sm">close</span>
          </Button>
        </div>

        <div className="px-4 pt-3 pb-2 space-y-2 shrink-0">
          <div className="flex gap-1">
            {tabs.map(tab => (
              <button
                key={tab.key}
                className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                }`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.label} ({tab.count})
              </button>
            ))}
          </div>
          <div className="relative">
            <span className="material-symbols-outlined text-sm absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">search</span>
            <Input
              placeholder={activeTab === 'skills' ? '搜索技能名称、描述或标签...' : activeTab === 'mcp' ? '搜索 MCP 名称、命令或 ENV...' : '搜索知识库名称或描述...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">
              当前列表 {selectedFilteredCount} / {filteredCount} 已启用
            </span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => activeTab === 'skills' ? setAllSelectableSkills(true) : activeTab === 'mcp' ? setAllServers(true) : updateRagCapability({ enabled: true, knowledgeBases: knowledgeBases.map((kb) => kb.id) })}
                disabled={activeTab === 'skills' ? selectableSkills.length === 0 : activeTab === 'mcp' ? servers.length === 0 : knowledgeBases.length === 0}
              >
                全选
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => activeTab === 'skills' ? setAllSelectableSkills(false) : activeTab === 'mcp' ? setAllServers(false) : updateRagCapability({ enabled: false, knowledgeBases: [] })}
                disabled={activeTab === 'skills' ? selectableSkills.length === 0 : activeTab === 'mcp' ? servers.length === 0 : knowledgeBases.length === 0}
              >
                全部取消
              </Button>
            </div>
          </div>
        </div>

        <div className="home-chat-scroll flex-1 overflow-y-auto px-4 pb-4">
          {activeTab === 'skills' && filteredSkills.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">没有匹配的技能</div>
          ) : activeTab === 'mcp' && filteredServers.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">没有匹配的 MCP Server</div>
          ) : activeTab === 'rag' ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/20 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium">允许首页对话使用 RAG 知识库</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">启用后，AI 会通过 aceharness-rag Python 脚本调用受控 runtime API。</div>
                </div>
                <Switch checked={ragEnabled} onCheckedChange={(checked) => updateRagCapability({ enabled: checked })} className="scale-75" />
              </div>
              <div className="rounded-md border bg-muted/20 p-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium">默认 TopK</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">AI 主动检索时默认返回的片段数量。</div>
                </div>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={Number.isFinite(ragTopK) ? ragTopK : 8}
                  onChange={(event) => updateRagCapability({ topK: Math.max(1, Math.min(Number(event.target.value || 8), 50)) })}
                  className="h-8 w-20 text-xs"
                />
              </div>
              {knowledgeBases.length === 0 ? (
                <div className="py-10 text-center text-xs text-muted-foreground">没有可用知识库</div>
              ) : (
                <div className="space-y-1">
                  {knowledgeBases
                    .filter((kb) => {
                      if (!search.trim()) return true;
                      const query = search.trim().toLowerCase();
                      return [kb.id, kb.name, kb.description || ''].join(' ').toLowerCase().includes(query);
                    })
                    .map((kb) => {
                      const checked = selectedKnowledgeBases.has(kb.id);
                      return (
                        <div key={kb.id} className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors">
                          <span className="material-symbols-outlined text-base text-amber-500 mt-0.5">database</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-medium">{kb.name || kb.id}</span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{kb.id}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{kb.description || '暂无描述'}</p>
                            <div className="text-[10px] text-muted-foreground mt-1">Chunks {kb.chunkCount ?? 0} · Documents {kb.documentCount ?? 0}</div>
                          </div>
                          <Switch
                            checked={checked}
                            onCheckedChange={(nextChecked) => {
                              const next = new Set(selectedKnowledgeBases);
                              if (nextChecked) next.add(kb.id);
                              else next.delete(kb.id);
                              updateRagCapability({ enabled: next.size > 0 ? true : ragEnabled, knowledgeBases: [...next] });
                            }}
                            className="scale-75 mt-0.5"
                          />
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          ) : activeTab === 'skills' ? (
            <div className="space-y-1">
              {filteredSkills.map(skill => (
                <div
                  key={skill.name}
                  className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors group"
                >
                  <div className="mt-0.5 shrink-0">
                    <span className="material-symbols-outlined text-base text-blue-400">extension</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{skill.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                      {skill.description || '暂无描述'}
                    </p>
                    {skill.tags && skill.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {skill.tags.slice(0, 4).map(tag => (
                          <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 mt-0.5 flex items-center gap-1">
                    {LOCKED_SKILLS.includes(skill.name) ? (
                      <>
                        <span className="material-symbols-outlined text-xs text-muted-foreground" title="必选技能">lock</span>
                        <Switch checked={true} disabled className="scale-75 opacity-60" />
                      </>
                    ) : (
                      <Switch
                        checked={!!skillSettings[skill.name]}
                        onCheckedChange={() => toggleSkill(skill.name)}
                        className="scale-75"
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredServers.map((server) => {
                const envCount = Object.keys(server.env || {}).length;
                return (
                  <div
                    key={server.name}
                    className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/20 p-3"
                  >
                    <div className="mt-0.5 shrink-0">
                      <span className="material-symbols-outlined text-base text-emerald-500">developer_board</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium">{server.name}</span>
                        <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium leading-none">
                          stdio
                        </span>
                        {envCount > 0 && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-secondary text-secondary-foreground font-medium leading-none">
                            ENV {envCount}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
                        {server.command}
                      </p>
                    </div>
                    <div className="shrink-0 mt-0.5">
                      <Switch
                        checked={!!mcpSettings[server.name]}
                        onCheckedChange={() => toggleMcpServer(server.name)}
                        className="scale-75"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgoraTopicCreateDialog({
  open,
  title,
  savedGuests,
  selectedGuestIds,
  temporaryGuests,
  temporaryDraft,
  loading,
  onOpenChange,
  onTitleChange,
  onToggleSavedGuest,
  onToggleAllSavedGuests,
  onTemporaryDraftChange,
  onAddTemporaryGuest,
  onRemoveTemporaryGuest,
  onCreateGuest,
  onSubmit,
}: {
  open: boolean;
  title: string;
  savedGuests: AgoraGuestConfig[];
  selectedGuestIds: string[];
  temporaryGuests: TopicTemporaryGuestDraft[];
  temporaryDraft: TopicTemporaryGuestDraft;
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onTitleChange: (title: string) => void;
  onToggleSavedGuest: (guestId: string, checked: boolean) => void;
  onToggleAllSavedGuests: (checked: boolean) => void;
  onTemporaryDraftChange: (draft: TopicTemporaryGuestDraft) => void;
  onAddTemporaryGuest: () => void;
  onRemoveTemporaryGuest: (index: number) => void;
  onCreateGuest: () => void;
  onSubmit: () => void;
}) {
  const availableSavedGuestIds = savedGuests.filter(isAgoraGuestAvailable).map((guest) => guest.id);
  const selectedAvailableSavedGuestIds = availableSavedGuestIds.filter((id) => selectedGuestIds.includes(id));
  const savedGuestSelectionState: CheckedState = availableSavedGuestIds.length === 0
    ? false
    : selectedAvailableSavedGuestIds.length === availableSavedGuestIds.length
      ? true
      : selectedAvailableSavedGuestIds.length > 0
        ? 'indeterminate'
        : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>新建议题</DialogTitle>
          <DialogDescription>先选择本议题的嘉宾，创建后会进入群聊。</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[68vh] space-y-4 overflow-y-auto px-1 pb-1">
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">议题名称</div>
            <Input value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="新议题" />
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">常驻嘉宾</h3>
                <p className="mt-1 text-xs text-muted-foreground">可多选加入当前议题。</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={onCreateGuest}>
                创建常驻嘉宾
              </Button>
            </div>
            <div className="rounded-lg border">
              {loading ? (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">正在加载常驻嘉宾...</div>
              ) : savedGuests.length ? (
                <>
                  <label className="flex cursor-pointer items-center gap-3 border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground hover:bg-muted/35">
                    <Checkbox
                      checked={savedGuestSelectionState}
                      disabled={availableSavedGuestIds.length === 0}
                      onCheckedChange={(checked) => onToggleAllSavedGuests(checkedStateToBoolean(checked))}
                      className="mt-0.5"
                    />
                    <span className="font-medium text-foreground">全选可用嘉宾</span>
                    <span className="ml-auto">
                      {selectedAvailableSavedGuestIds.length}/{availableSavedGuestIds.length}
                    </span>
                  </label>
                  {savedGuests.map((guest) => {
                const available = isAgoraGuestAvailable(guest);
                return (
                  <label
                    key={guest.id}
                    className={`flex gap-3 border-b px-3 py-3 last:border-b-0 ${available ? 'cursor-pointer hover:bg-muted/40' : 'cursor-not-allowed bg-muted/20 opacity-70'}`}
                  >
                    <Checkbox
                      checked={selectedGuestIds.includes(guest.id)}
                      disabled={!available}
                      onCheckedChange={(checked) => onToggleSavedGuest(guest.id, checked === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{guest.displayName}</span>
                        <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${available ? 'text-emerald-600' : 'text-destructive'}`}>
                          {available ? '可用' : '不可用'}
                        </Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{getAgoraGuestRuntimeLabel(guest)}</div>
                      {!available ? (
                        <div className="mt-1 text-xs text-destructive">{guest.statusReason || '模型或引擎未配置'}</div>
                      ) : null}
                    </div>
                  </label>
                );
              })}
                </>
              ) : (
                <div className="px-3 py-8 text-center text-xs text-muted-foreground">暂无常驻嘉宾</div>
              )}
            </div>
          </section>

          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold">临时嘉宾</h3>
              <p className="mt-1 text-xs text-muted-foreground">只加入当前议题，后续可在议题右侧升级为常驻嘉宾。</p>
            </div>
            {temporaryGuests.length ? (
              <div className="space-y-1 rounded-lg border p-2">
                {temporaryGuests.map((guest, index) => (
                  <div key={`${guest.name}-${index}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                    <SpriteAvatar
                      avatar={resolveAgentAvatarSrc(undefined, guest.name)}
                      seed={guest.name}
                      category="agent-default"
                      alt={guest.name}
                      fallback={getSidebarInitials(guest.name)}
                      className="h-6 w-6 ring-1 ring-border/60"
                      fallbackClassName="bg-primary/10 text-[8px] font-semibold text-primary"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs">{guest.name}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemoveTemporaryGuest(index)}>
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 md:grid-cols-2">
              <Input
                value={temporaryDraft.name}
                onChange={(event) => onTemporaryDraftChange({ ...temporaryDraft, name: event.target.value })}
                placeholder="临时嘉宾名称"
              />
              <EngineModelSelect
                engine={temporaryDraft.engine}
                model={temporaryDraft.model}
                onEngineChange={(engine) => onTemporaryDraftChange({ ...temporaryDraft, engine })}
                onModelChange={(model) => onTemporaryDraftChange({ ...temporaryDraft, model })}
              />
              <Textarea
                value={temporaryDraft.personaPrompt}
                onChange={(event) => onTemporaryDraftChange({ ...temporaryDraft, personaPrompt: event.target.value })}
                rows={3}
                className="md:col-span-2"
                placeholder="输入临时嘉宾的人格、立场和发言方式"
              />
              <div className="md:col-span-2">
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onAddTemporaryGuest}>
                  添加临时嘉宾
                </Button>
              </div>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={onSubmit}>创建议题</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgoraGuestManagerDialog({
  open,
  presets,
  presetDrafts,
  customDraft,
  loading,
  presetSaving,
  customSaving,
  onOpenChange,
  onAddPresetDraft,
  onRemovePresetDraft,
  onPresetDraftChange,
  onCreateSelectedPresets,
  onCustomDraftChange,
  onCreateCustom,
}: {
  open: boolean;
  presets: AgoraGuestPreset[];
  presetDrafts: PresetGuestCreateDraft[];
  customDraft: CustomGuestDraft;
  loading: boolean;
  presetSaving: boolean;
  customSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onAddPresetDraft: (preset: AgoraGuestPreset) => void;
  onRemovePresetDraft: (draftId: string) => void;
  onPresetDraftChange: (draftId: string, patch: Partial<Pick<PresetGuestCreateDraft, 'personaPrompt' | 'engine' | 'model'>>) => void;
  onCreateSelectedPresets: () => void;
  onCustomDraftChange: (draft: CustomGuestDraft) => void;
  onCreateCustom: () => void;
}) {
  const selectedPresets = presetDrafts
    .map((draft) => {
      const preset = presets.find((item) => item.id === draft.presetId);
      return preset ? { draft, preset } : null;
    })
    .filter((item): item is { draft: PresetGuestCreateDraft; preset: AgoraGuestPreset } => Boolean(item));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle>创建常驻嘉宾</DialogTitle>
          <DialogDescription>常驻嘉宾是全局角色，可在不同议题中重复加入。</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 max-h-[70vh] space-y-4 overflow-y-auto px-1 pb-1">
          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold">预设嘉宾</h3>
              <p className="mt-1 text-xs text-muted-foreground">从左侧加入右侧待创建清单，确认后才会创建。</p>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
              <div className="overflow-hidden rounded-lg border">
                <div className="border-b bg-muted/25 px-3 py-2 text-xs font-medium text-muted-foreground">可选预设</div>
                <div className="max-h-[350px] overflow-y-auto">
                  {loading ? (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">正在加载...</div>
                  ) : presets.length ? presets.map((preset) => {
                    const available = isAgoraGuestAvailable(preset);
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        disabled={!available}
                        className={`flex w-full gap-3 border-b px-3 py-3 text-left last:border-b-0 ${available ? 'hover:bg-muted/40' : 'cursor-not-allowed bg-muted/20 opacity-70'}`}
                        onClick={() => onAddPresetDraft(preset)}
                      >
                        <span className="material-symbols-outlined mt-0.5 text-[16px] text-muted-foreground">add</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{preset.displayName}</span>
                            <Badge variant="outline" className={`h-5 px-1.5 text-[10px] ${available ? 'text-emerald-600' : 'text-destructive'}`}>
                              {available ? '可用' : '不可用'}
                            </Badge>
                          </div>
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{preset.description}</div>
                          {!available ? <div className="mt-1 text-xs text-destructive">{preset.statusReason || '模型或引擎未配置'}</div> : null}
                        </div>
                      </button>
                    );
                  }) : (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">没有可选预设</div>
                  )}
                </div>
              </div>
              <div className="hidden items-center text-muted-foreground md:flex">
                <span className="material-symbols-outlined text-[20px]">arrow_forward</span>
              </div>
              <div className="overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/25 px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">待创建</span>
                  <Button type="button" size="sm" className="h-7 text-xs" disabled={!presetDrafts.length || presetSaving} onClick={onCreateSelectedPresets}>
                    {presetSaving ? '创建中...' : '确认创建'}
                  </Button>
                </div>
                <div className="max-h-[350px] overflow-y-auto">
                  {selectedPresets.length ? selectedPresets.map(({ draft, preset }) => (
                    <div key={draft.id} className="flex gap-3 border-b px-3 py-3 last:border-b-0">
                      <span className="material-symbols-outlined mt-0.5 text-[16px] text-primary">check</span>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="truncate text-sm font-medium">{preset.displayName}</div>
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{preset.description}</div>
                        <EngineModelSelect
                          engine={draft.engine}
                          model={draft.model}
                          onEngineChange={(engine) => onPresetDraftChange(draft.id, { engine })}
                          onModelChange={(model) => onPresetDraftChange(draft.id, { model })}
                        />
                        <Textarea
                          value={draft.personaPrompt}
                          onChange={(event) => onPresetDraftChange(draft.id, { personaPrompt: event.target.value })}
                          rows={3}
                          placeholder="输入这个预设嘉宾的补充提示词"
                        />
                      </div>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemovePresetDraft(draft.id)}>
                        <span className="material-symbols-outlined text-[15px]">close</span>
                      </Button>
                    </div>
                  )) : (
                    <div className="px-3 py-8 text-center text-xs text-muted-foreground">从左侧选择预设嘉宾</div>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">自定义常驻嘉宾</h3>
                <p className="mt-1 text-xs text-muted-foreground">保存后可加入任意议题。</p>
              </div>
              <Button type="button" size="sm" className="h-8 text-xs" disabled={customSaving} onClick={onCreateCustom}>
                {customSaving ? '创建中...' : '创建自定义嘉宾'}
              </Button>
            </div>
            <div className="grid gap-3 rounded-lg border p-3 md:grid-cols-2">
              <Input
                value={customDraft.displayName}
                onChange={(event) => onCustomDraftChange({ ...customDraft, displayName: event.target.value })}
                placeholder="嘉宾名称"
              />
              <EngineModelSelect
                engine={customDraft.engine}
                model={customDraft.model}
                onEngineChange={(engine) => onCustomDraftChange({ ...customDraft, engine })}
                onModelChange={(model) => onCustomDraftChange({ ...customDraft, model })}
              />
              <Textarea
                value={customDraft.personaPrompt}
                onChange={(event) => onCustomDraftChange({ ...customDraft, personaPrompt: event.target.value })}
                rows={4}
                className="md:col-span-2"
                placeholder="输入这个嘉宾的性格、立场和发言方式"
              />
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgoraGuestEditDialog({
  open,
  draft,
  saving,
  onOpenChange,
  onDraftChange,
  onSave,
}: {
  open: boolean;
  draft: AgoraGuestEditDraft | null;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (patch: Partial<AgoraGuestEditDraft>) => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>编辑常驻嘉宾</DialogTitle>
        </DialogHeader>
        {draft ? (
          <div className="grid gap-3 py-1 md:grid-cols-2">
            <Input
              value={draft.displayName}
              onChange={(event) => onDraftChange({ displayName: event.target.value })}
              placeholder="嘉宾名称"
            />
            <EngineModelSelect
              engine={draft.engine}
              model={draft.model}
              onEngineChange={(engine) => onDraftChange({ engine })}
              onModelChange={(model) => onDraftChange({ model })}
            />
            <Textarea
              value={draft.personaPrompt}
              onChange={(event) => onDraftChange({ personaPrompt: event.target.value })}
              rows={6}
              className="md:col-span-2"
              placeholder="输入这个嘉宾的性格、立场和发言方式"
            />
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button>
          <Button onClick={onSave} disabled={!draft || saving}>{saving ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgoraDirectory({
  sessions,
  searchValue,
  savedGuests,
  guestsLoading,
  guestManageMode,
  guestDeleting,
  selectedSavedGuestIds,
  activeSessionId,
  selectable,
  selectedSessionIds,
  isFilteredEmpty,
  activeStreamingSessionIdSet,
  recentlyCompletedSessionIdSet,
  sessionLoadingId,
  onCreate,
  extensionActions,
  onCreateExtensionTopic,
  onCreateGuest,
  onToggleGuestManageMode,
  onToggleGuestSelect,
  onToggleAllGuestsSelected,
  onDeleteSelectedGuests,
  onEditGuest,
  onSearchChange,
  onSessionClick,
  onSelectChange,
  onDeleteSession,
  onRenameSession,
  onDeleteGuest,
}: {
  sessions: SidebarSession[];
  searchValue: string;
  savedGuests: AgoraGuestConfig[];
  guestsLoading: boolean;
  guestManageMode: boolean;
  guestDeleting: boolean;
  selectedSavedGuestIds: Set<string>;
  activeSessionId: string | null;
  selectable: boolean;
  selectedSessionIds: Set<string>;
  isFilteredEmpty: boolean;
  activeStreamingSessionIdSet: SessionIdSet;
  recentlyCompletedSessionIdSet: SessionIdSet;
  sessionLoadingId: string | null;
  onCreate: () => void;
  extensionActions: ReturnType<typeof getAgoraTopicExtensionActions>;
  onCreateExtensionTopic: (actionId: string) => void;
  onCreateGuest: () => void;
  onToggleGuestManageMode: () => void;
  onToggleGuestSelect: (guestId: string, checked: boolean) => void;
  onToggleAllGuestsSelected: (checked: boolean) => void;
  onDeleteSelectedGuests: () => void;
  onEditGuest: (guest: AgoraGuestConfig) => void;
  onSearchChange: (value: string) => void;
  onSessionClick: (sessionId: string) => void;
  onSelectChange: (sessionId: string, checked: boolean) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  onDeleteGuest: (guest: AgoraGuestConfig) => void;
}) {
  const savedGuestIds = useMemo(() => savedGuests.map((guest) => guest.id), [savedGuests]);
  const savedGuestSelectionState = getSelectionState(savedGuestIds, selectedSavedGuestIds);
  const selectedSavedGuestCount = savedGuests.filter((guest) => selectedSavedGuestIds.has(guest.id)).length;
  const selectedManagedGuests = savedGuests.filter((guest) => selectedSavedGuestIds.has(guest.id));
  const [guideDismissed, setGuideDismissed] = useState(false);
  const shouldShowStarterGuide = !guestsLoading
    && sessions.length === 0
    && savedGuests.length === 0
    && searchValue.trim().length === 0;
  const showStarterGuide = shouldShowStarterGuide && !guideDismissed;

  useEffect(() => {
    if (shouldShowStarterGuide) return;
    setGuideDismissed(false);
  }, [shouldShowStarterGuide]);

  return (
    <div className="px-2 pb-2 pt-1">
      <div className="mb-3 px-0.5">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            search
          </span>
          <Input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="搜索议题"
            className="h-8 border-transparent bg-muted/55 pl-8 pr-8 text-xs focus-visible:ring-1"
          />
          {searchValue ? (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={() => onSearchChange('')}
              aria-label="清空筛选"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          ) : null}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {showStarterGuide ? (
          <motion.div
            key="agora-starter-guide"
            initial={{ opacity: 0, y: -14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.985 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="mb-4 overflow-hidden rounded-2xl border border-violet-200/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(247,244,255,0.96))] shadow-[0_16px_42px_rgba(88,28,135,0.08)] dark:border-violet-400/20 dark:bg-[linear-gradient(180deg,rgba(28,24,40,0.98),rgba(17,18,28,0.96))] dark:shadow-[0_18px_48px_rgba(2,6,23,0.36)]"
          >
            <div className="border-b border-violet-100/80 px-3 py-2.5 dark:border-violet-400/15">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Badge variant="outline" className="border-violet-200/80 bg-white/80 text-[10px] text-violet-700 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-200">
                    议场引导
                  </Badge>
                  <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">先创建嘉宾，再打开第一场讨论</div>
                  <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
                    常驻嘉宾是可复用角色；议题用于承载一次具体讨论。
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-full text-slate-400 hover:bg-white/70 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-white/10 dark:hover:text-slate-200"
                  onClick={() => setGuideDismissed(true)}
                  title="关闭引导"
                  aria-label="关闭引导"
                >
                  <span className="material-symbols-outlined text-[16px]">close</span>
                </Button>
              </div>
            </div>
            <div className="space-y-2 px-3 py-3">
              {[
                {
                  title: '创建常驻嘉宾',
                  detail: '先准备几个可反复邀请的角色，后续每个议题都能直接复用。',
                  icon: 'person_add',
                },
                {
                  title: '新建议题',
                  detail: '设定讨论主题并挑选嘉宾入场；没有常驻嘉宾时，也可以先加临时嘉宾。',
                  icon: 'forum',
                },
              ].map((step, index) => (
                <motion.div
                  key={step.title}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.05 + index * 0.07, duration: 0.2, ease: 'easeOut' }}
                  className="flex items-start gap-3 rounded-xl border border-violet-100/80 bg-white/80 px-3 py-2.5 dark:border-violet-400/15 dark:bg-white/5"
                >
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200">
                    <span className="material-symbols-outlined text-[15px]">{step.icon}</span>
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 dark:text-slate-100">{index + 1}. {step.title}</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{step.detail}</div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-violet-100/80 bg-white/60 px-3 py-3 dark:border-violet-400/15 dark:bg-white/5">
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-full bg-slate-900 px-3 text-xs text-white hover:bg-slate-800 dark:bg-violet-500 dark:hover:bg-violet-400"
                onClick={() => {
                  setGuideDismissed(true);
                  onCreateGuest();
                }}
              >
                创建常驻嘉宾
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 rounded-full px-3 text-xs"
                onClick={() => {
                  setGuideDismissed(true);
                  onCreate();
                }}
              >
                新建议题
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="mb-4">
        <div className="mb-1 flex h-7 items-center justify-between px-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">议题</div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCreate}
              title="新建议题"
              aria-label="新建议题"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
            </Button>
            {extensionActions.length ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="议题更多操作"
                    aria-label="议题更多操作"
                  >
                    <span className="material-symbols-outlined text-[15px]">more_horiz</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {extensionActions.map((action) => (
                    <DropdownMenuItem key={action.id} onSelect={() => onCreateExtensionTopic(action.id)}>
                      <span className="material-symbols-outlined mr-2 text-sm">{action.icon}</span>
                      {action.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
        {sessions.length === 0 ? (
          <div className="rounded-md px-2 py-2 text-xs text-muted-foreground">
            {isFilteredEmpty ? '无匹配议题' : '暂无议题'}
          </div>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <AgoraTopicItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                selectable={selectable}
                selected={selectedSessionIds.has(session.id)}
                isStreaming={activeStreamingSessionIdSet.has(session.id)}
                isRecentlyCompleted={recentlyCompletedSessionIdSet.has(session.id)}
                isLoadingSession={sessionLoadingId === session.id}
                onClick={() => onSessionClick(session.id)}
                onSelectChange={(checked) => onSelectChange(session.id, checked)}
                onDelete={() => onDeleteSession(session)}
                onRename={(title) => onRenameSession(session, title)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 flex h-7 items-center justify-between px-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">常驻嘉宾</div>
          <div className="flex items-center gap-1">
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{savedGuests.length}</span>
            {savedGuests.length ? (
              <Button
                type="button"
                variant={guestManageMode ? 'secondary' : 'ghost'}
                size="icon"
                className={`h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground ${
                  guestManageMode ? 'text-primary ring-1 ring-primary/20' : ''
                }`}
                onClick={onToggleGuestManageMode}
                title={guestManageMode ? '完成嘉宾管理' : '批量管理嘉宾'}
                aria-label={guestManageMode ? '完成嘉宾管理' : '批量管理嘉宾'}
                disabled={guestDeleting}
              >
                <span className="material-symbols-outlined text-[15px]">{guestManageMode ? 'done' : 'checklist'}</span>
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={onCreateGuest}
              title="创建常驻嘉宾"
              aria-label="创建常驻嘉宾"
              disabled={guestDeleting}
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="常驻嘉宾更多操作"
                  aria-label="常驻嘉宾更多操作"
                  disabled={guestDeleting}
                >
                  <span className="material-symbols-outlined text-[15px]">more_horiz</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={() => onCreateGuest()}>
                  <span className="material-symbols-outlined mr-2 text-sm">person_add</span>
                  创建嘉宾
                </DropdownMenuItem>
                {savedGuests.length ? (
                  <DropdownMenuItem onSelect={() => onToggleGuestManageMode()}>
                    <span className="material-symbols-outlined mr-2 text-sm">{guestManageMode ? 'done' : 'checklist'}</span>
                    {guestManageMode ? '完成管理' : '批量管理'}
                  </DropdownMenuItem>
                ) : null}
                {guestManageMode && selectedManagedGuests.length === 1 ? (
                  <DropdownMenuItem onSelect={() => onEditGuest(selectedManagedGuests[0]!)}>
                    <span className="material-symbols-outlined mr-2 text-sm">edit</span>
                    编辑已选
                  </DropdownMenuItem>
                ) : null}
                {guestManageMode && selectedManagedGuests.length > 0 ? (
                  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteSelectedGuests()}>
                    <span className="material-symbols-outlined mr-2 text-sm">delete</span>
                    删除已选
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {guestManageMode && savedGuests.length > 0 ? (
          <div className="mb-2 flex items-center justify-between rounded-md border border-border/50 bg-background/70 px-2 py-1.5">
            <div
              className={`flex items-center gap-2 text-xs text-muted-foreground ${guestDeleting ? '' : 'cursor-pointer'}`}
              onClick={guestDeleting ? undefined : () => onToggleAllGuestsSelected(savedGuestSelectionState !== true)}
              onKeyDown={guestDeleting ? undefined : (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggleAllGuestsSelected(savedGuestSelectionState !== true);
                }
              }}
              role="button"
              tabIndex={guestDeleting ? -1 : 0}
              aria-pressed={savedGuestSelectionState === true}
            >
              <Checkbox
                aria-label="选择全部常驻嘉宾"
                checked={savedGuestSelectionState}
                onCheckedChange={(checked) => onToggleAllGuestsSelected(checkedStateToBoolean(checked))}
                onClick={(event) => event.stopPropagation()}
                className="h-3.5 w-3.5"
                disabled={guestDeleting}
              />
              <span>全选</span>
              {selectedSavedGuestCount > 0 ? (
                <span className="text-primary">已选 {selectedSavedGuestCount}</span>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selectedSavedGuestCount === 0 || guestDeleting}
              className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={onDeleteSelectedGuests}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              {guestDeleting ? '删除中...' : '删除'}
            </Button>
          </div>
        ) : null}
        <div className="space-y-0.5">
          {savedGuests.map((guest) => {
            const guestSelected = selectedSavedGuestIds.has(guest.id);
            return (
            <div
              key={guest.id}
              className={`group flex min-h-10 items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted/65 hover:text-foreground ${
                guestManageMode ? 'cursor-pointer' : ''
              } ${guestSelected ? 'bg-muted/70 text-foreground' : ''}`}
              onClick={guestManageMode && !guestDeleting ? () => onToggleGuestSelect(guest.id, !guestSelected) : undefined}
              onKeyDown={guestManageMode && !guestDeleting ? (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onToggleGuestSelect(guest.id, !guestSelected);
                }
              } : undefined}
              role={guestManageMode ? 'button' : undefined}
              tabIndex={guestManageMode && !guestDeleting ? 0 : undefined}
              aria-pressed={guestManageMode ? guestSelected : undefined}
            >
              {guestManageMode ? (
                <Checkbox
                  aria-label={`选择 ${guest.displayName}`}
                  checked={guestSelected}
                  onCheckedChange={(checked) => onToggleGuestSelect(guest.id, checkedStateToBoolean(checked))}
                  onClick={(event) => event.stopPropagation()}
                  className="h-3.5 w-3.5 shrink-0"
                  disabled={guestDeleting}
                />
              ) : null}
              <SpriteAvatar
                avatar={resolveAgentAvatarSrc(undefined, guest.runtimeAgentName || guest.displayName)}
                seed={guest.runtimeAgentName || guest.displayName}
                category="agent-default"
                alt={guest.displayName}
                fallback={getSidebarInitials(guest.displayName)}
                className="h-6 w-6 ring-1 ring-border/60"
                fallbackClassName="bg-primary/10 text-[8px] font-semibold text-primary"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-foreground">{guest.displayName}</div>
                <div className="truncate text-[10px] text-muted-foreground">{getAgoraGuestRuntimeLabel(guest)}</div>
              </div>
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full opacity-70 ${isAgoraGuestAvailable(guest) ? 'bg-emerald-500/70' : 'bg-destructive/70'}`}
                aria-hidden="true"
              />
              {!guestManageMode ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100"
                      onClick={(event) => event.stopPropagation()}
                      title="嘉宾操作"
                      aria-label={`嘉宾 ${guest.displayName} 的操作`}
                      disabled={guestDeleting}
                    >
                      <span className="material-symbols-outlined text-[13px]">more_horiz</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-36">
                    <DropdownMenuItem onSelect={() => onEditGuest(guest)}>
                      <span className="material-symbols-outlined mr-2 text-sm">edit</span>
                      编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => onDeleteGuest(guest)}>
                      <span className="material-symbols-outlined mr-2 text-sm">delete</span>
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="h-6 w-6 shrink-0" aria-hidden="true" />
              )}
            </div>
          );})}
          {savedGuests.length === 0 ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted/65 hover:text-foreground"
              onClick={onCreateGuest}
            >
              <span className="material-symbols-outlined text-[15px]">person_add</span>
              {guestsLoading ? '正在加载...' : '创建常驻嘉宾'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgoraTopicItem({
  session,
  active,
  selectable,
  selected,
  isStreaming,
  isRecentlyCompleted,
  isLoadingSession,
  onClick,
  onSelectChange,
  onDelete,
  onRename,
}: {
  session: SidebarSession;
  active: boolean;
  selectable: boolean;
  selected: boolean;
  isStreaming: boolean;
  isRecentlyCompleted: boolean;
  isLoadingSession: boolean;
  onClick: () => void;
  onSelectChange: (checked: boolean) => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const title = getAgoraSessionTitle(session);
  const [renameValue, setRenameValue] = useState(title);
  const guestCount = getAgoraSessionParticipants(session).length;
  const statusText = isStreaming ? '发言中' : isLoadingSession ? '加载中' : isRecentlyCompleted ? '刚完成' : guestCount ? `${guestCount} 嘉宾` : '';

  useEffect(() => {
    if (!renameDialogOpen) setRenameValue(title);
  }, [renameDialogOpen, title]);

  const commitRename = () => {
    const nextTitle = renameValue.trim();
    if (nextTitle && nextTitle !== title) onRename(nextTitle);
    setRenameValue(nextTitle || title);
    setRenameDialogOpen(false);
  };

  const row = (
    <div
      className={`group relative flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-primary/12 text-foreground'
          : 'text-muted-foreground hover:bg-muted/65 hover:text-foreground'
      } ${isStreaming ? 'ring-1 ring-primary/20' : isRecentlyCompleted ? 'ring-1 ring-emerald-500/20' : ''}`}
      onClick={() => {
        if (selectable) {
          onSelectChange(!selected);
          return;
        }
        onClick();
      }}
    >
      {selectable ? (
        <Checkbox
          aria-label={`选择 ${title}`}
          checked={selected}
          onCheckedChange={(checked) => onSelectChange(checkedStateToBoolean(checked))}
          onClick={(event) => event.stopPropagation()}
          className="h-3.5 w-3.5"
        />
      ) : (
        <span className={`shrink-0 text-[15px] font-semibold ${active ? 'text-primary' : 'text-muted-foreground/70'}`}>#</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{title}</div>
        {statusText ? <div className="truncate text-[10px] text-muted-foreground/75">{statusText}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {isStreaming ? (
          <span className="relative flex h-2 w-2" aria-label="发言中">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
        ) : isLoadingSession ? (
          <span className="material-symbols-outlined animate-spin text-[13px] text-primary">progress_activity</span>
        ) : isRecentlyCompleted ? (
          <span className="material-symbols-outlined text-[13px] text-emerald-600 dark:text-emerald-400">check_circle</span>
        ) : null}
      </div>
      {!selectable ? (
        <div className="absolute right-1 top-1 hidden items-center rounded-md bg-background/95 ring-1 ring-border/70 group-hover:flex">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-md text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              setRenameDialogOpen(true);
            }}
            title="重命名议题"
            aria-label={`重命名 ${title}`}
          >
            <span className="material-symbols-outlined text-[12px]">edit</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 rounded-md text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="删除议题"
            aria-label={`删除 ${title}`}
          >
            <span className="material-symbols-outlined text-[12px]">delete</span>
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-32" onClick={(event) => event.stopPropagation()}>
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault();
              setRenameDialogOpen(true);
            }}
          >
            <span className="material-symbols-outlined mr-2 text-sm">edit</span>
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
            <span className="material-symbols-outlined mr-2 text-sm">delete</span>
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名议题</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder="议题名称"
                aria-label="议题名称"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EmptySessionState({
  kind,
  filtered,
  query,
  onCreate,
}: {
  kind: SessionDirectoryView;
  filtered: boolean;
  query: string;
  onCreate?: () => void;
}) {
  const title = filtered
    ? '没有匹配结果'
    : '暂无对话';
  const description = filtered
    ? `没有找到包含“${query}”的会话。`
    : '新建对话，让 AI 帮你继续推进。';
  const hint = filtered
    ? '调整关键词后再试'
    : '准备开始新的对话';

  return (
    <div className="px-3 py-6">
      <div className="flex flex-col items-center justify-center rounded-xl border border-border/70 bg-background/80 px-4 py-6 text-center backdrop-blur-sm transition-transform hover:-translate-y-0.5">
        <div className="mb-4 w-24 animate-[botBounce_2.5s_ease-in-out_infinite]">
          <svg viewBox="0 0 100 110" fill="none" xmlns="http://www.w3.org/2000/svg" className="block h-auto w-full">
            <defs>
              <linearGradient id="emptyBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F8FAFC" />
                <stop offset="100%" stopColor="#E2E8F0" />
              </linearGradient>
              <linearGradient id="emptyScreenGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#1E293B" />
                <stop offset="100%" stopColor="#0F172A" />
              </linearGradient>
            </defs>
            <line x1="50" y1="8" x2="45" y2="2" stroke="#94A3B8" strokeWidth="2.2" strokeLinecap="round" />
            <line x1="50" y1="8" x2="55" y2="2" stroke="#94A3B8" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="45" cy="2" r="2.2" fill="#F97316" />
            <circle cx="55" cy="2" r="2.2" fill="#3B82F6" />
            <rect x="25" y="12" width="50" height="38" rx="14" fill="#F8FAFC" stroke="#CBD5E1" strokeWidth="1.2" />
            <ellipse cx="38" cy="28" rx="6.5" ry="7" fill="white" stroke="#475569" strokeWidth="1" />
            <ellipse cx="62" cy="28" rx="6.5" ry="7" fill="white" stroke="#475569" strokeWidth="1" />
            <circle cx="40" cy="30" r="2.5" fill="#1E293B" />
            <circle cx="64" cy="30" r="2.5" fill="#1E293B" />
            <circle cx="41.2" cy="28.8" r="1" fill="white" />
            <circle cx="65.2" cy="28.8" r="1" fill="white" />
            <path d="M44 39 Q50 35 56 39" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" fill="none" />
            <rect x="27" y="54" width="46" height="38" rx="12" fill="url(#emptyBodyGrad)" stroke="#CBD5E1" strokeWidth="1" />
            <rect x="32" y="62" width="36" height="20" rx="6" fill="url(#emptyScreenGrad)" stroke="#334155" strokeWidth="0.8" />
            <rect x="34" y="64" width="32" height="16" rx="4" fill="#0F172A" opacity="0.9" />
            <text x="50" y="77.5" fontFamily="'Courier New', monospace" fontSize="13" fontWeight="bold" fill="#60A5FA" textAnchor="middle" className="animate-pulse">
              0
            </text>
            <circle cx="38" cy="59" r="2" fill="#F97316" stroke="#C2410C" strokeWidth="0.5" />
            <circle cx="50" cy="59" r="2" fill="#34D399" stroke="#059669" strokeWidth="0.5" />
            <circle cx="62" cy="59" r="2" fill="#60A5FA" stroke="#2563EB" strokeWidth="0.5" />
          </svg>
        </div>
        <div className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-base font-semibold text-transparent">
          {title}
        </div>
        <div className="mt-2 max-w-[220px] text-xs leading-relaxed text-muted-foreground">
          {description}
        </div>
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[10px] font-medium text-primary">
          <span className="material-symbols-outlined text-xs">smart_toy</span>
          {hint}
        </div>
        {onCreate ? (
          <Button type="button" size="sm" className="mt-4 h-8 gap-1.5 text-xs" onClick={onCreate}>
            <span className="material-symbols-outlined text-sm">add</span>
            新建对话
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function WorkflowBucket({
  title,
  icon,
  groups,
  selectable,
  selectedSessionIds,
  activeSessionId,
  loading,
  activeStreamingSessionIdSet,
  recentlyCompletedSessionIdSet,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSelectSessions,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  defaultOpen = false,
  forceOpen = false,
}: {
  title: string;
  icon: string;
  groups: WorkflowSessionGroup[];
  selectable: boolean;
  selectedSessionIds: Set<string>;
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIdSet: SessionIdSet;
  recentlyCompletedSessionIdSet: SessionIdSet;
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  onSelectSessions: (sessionIds: string[], checked: boolean) => void;
  onSessionClick: (sessionId: string) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sessionCount = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const pendingCount = groups.reduce((sum, group) => sum + group.pendingCount, 0);
  const bucketSessionIds = useMemo(() => getUniqueSessionIds(groups.flatMap((group) => group.sessions)), [groups]);
  const bucketSelectionState = getSelectionState(bucketSessionIds, selectedSessionIds);

  useEffect(() => {
    if (pendingCount > 0 || defaultOpen || forceOpen) setOpen(true);
  }, [defaultOpen, forceOpen, pendingCount]);

  if (groups.length === 0) {
    return (
      <div className="mb-2 rounded-xl border border-dashed bg-background/60 px-3 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">{icon}</span>
          <span>{title}</span>
          <span className="ml-auto text-[10px]">暂无</span>
        </div>
      </div>
    );
  }

  return (
    <div className="home-chat-sidebar-card mb-3 rounded-xl border bg-background/70">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="material-symbols-outlined text-sm text-muted-foreground">{open ? 'expand_more' : 'chevron_right'}</span>
          <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
          <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">{title}</span>
        </button>
        {selectable ? (
          <Checkbox
            aria-label={`选择${title}全部工作流对话`}
            checked={bucketSelectionState}
            onCheckedChange={(checked) => onSelectSessions(bucketSessionIds, checkedStateToBoolean(checked))}
            className="h-3.5 w-3.5"
          />
        ) : null}
        {pendingCount > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
            待审 {pendingCount}
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {sessionCount}
        </span>
      </div>
      {open ? (
        <div className="space-y-2 border-t border-border/40 p-2">
          {groups.map((group) => (
            <WorkflowGroup
              key={group.key}
              group={group}
              selectable={selectable}
              selectedSessionIds={selectedSessionIds}
              activeSessionId={activeSessionId}
              loading={loading}
              activeStreamingSessionIdSet={activeStreamingSessionIdSet}
              recentlyCompletedSessionIdSet={recentlyCompletedSessionIdSet}
              sessionLoadingId={sessionLoadingId}
              pendingQuestionsBySessionId={pendingQuestionsBySessionId}
              onSelectSessions={onSelectSessions}
              onSessionClick={onSessionClick}
              onDeleteSession={onDeleteSession}
              onRenameSession={onRenameSession}
              forceOpen={forceOpen}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowGroup({
  group,
  selectable,
  selectedSessionIds,
  activeSessionId,
  loading,
  activeStreamingSessionIdSet,
  recentlyCompletedSessionIdSet,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSelectSessions,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  forceOpen = false,
}: {
  group: WorkflowSessionGroup;
  selectable: boolean;
  selectedSessionIds: Set<string>;
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIdSet: SessionIdSet;
  recentlyCompletedSessionIdSet: SessionIdSet;
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  onSelectSessions: (sessionIds: string[], checked: boolean) => void;
  onSessionClick: (sessionId: string) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  forceOpen?: boolean;
}) {
  const hasActiveSession = group.sessions.some((session) => session.id === activeSessionId);
  const [open, setOpen] = useState(hasActiveSession || group.pendingCount > 0 || forceOpen);
  const groupSessionIds = useMemo(() => getUniqueSessionIds(group.sessions), [group.sessions]);
  const groupSelectionState = getSelectionState(groupSessionIds, selectedSessionIds);

  useEffect(() => {
    if (hasActiveSession || group.pendingCount > 0 || forceOpen) setOpen(true);
  }, [forceOpen, group.pendingCount, hasActiveSession]);

  return (
    <div className={`home-chat-sidebar-card rounded-lg border ${group.pendingCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/10'}`}>
      <div className="flex w-full items-center gap-2 px-2.5 py-2 text-left">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="material-symbols-outlined text-sm text-muted-foreground">{open ? 'expand_more' : 'chevron_right'}</span>
          <span className="material-symbols-outlined text-sm text-muted-foreground">account_tree</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">{group.name}</div>
            <div className="truncate text-[10px] text-muted-foreground">{group.configFile}</div>
          </div>
        </button>
        {selectable ? (
          <Checkbox
            aria-label={`选择工作流 ${group.name}`}
            checked={groupSelectionState}
            onCheckedChange={(checked) => onSelectSessions(groupSessionIds, checkedStateToBoolean(checked))}
            className="h-3.5 w-3.5"
          />
        ) : null}
        {group.pendingCount > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
            ping {group.pendingCount}
          </span>
        ) : null}
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {group.sessions.length} 议题
        </span>
      </div>
      {open ? (
        <div className="space-y-1 border-t border-border/40 p-1.5">
          {group.sessions.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              compact
              selectable={selectable}
              selected={selectedSessionIds.has(session.id)}
              attentionCount={pendingQuestionsBySessionId.get(session.id)?.length || 0}
              isStreaming={activeStreamingSessionIdSet.has(session.id)}
              isRecentlyCompleted={recentlyCompletedSessionIdSet.has(session.id)}
              isLoadingSession={sessionLoadingId === session.id}
              onClick={() => onSessionClick(session.id)}
              onSelectChange={(checked) => onSelectSessions([session.id], checked)}
              onDelete={() => onDeleteSession(session)}
              onRename={(title) => onRenameSession(session, title)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function WorkflowAgentGroup({
  group,
  selectable,
  selectedSessionIds,
  activeSessionId,
  loading,
  activeStreamingSessionIdSet,
  recentlyCompletedSessionIdSet,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSelectSessions,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  forceOpen = false,
}: {
  group: WorkflowAgentSessionGroup;
  selectable: boolean;
  selectedSessionIds: Set<string>;
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIdSet: SessionIdSet;
  recentlyCompletedSessionIdSet: SessionIdSet;
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  onSelectSessions: (sessionIds: string[], checked: boolean) => void;
  onSessionClick: (sessionId: string) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  forceOpen?: boolean;
}) {
  const hasActiveSession = group.sessions.some((session) => session.id === activeSessionId);
  const [open, setOpen] = useState(hasActiveSession || group.pendingCount > 0 || forceOpen);
  const roleTone = group.role === 'Supervisor'
    ? 'bg-primary/10 text-primary'
    : group.role === 'Agent'
      ? 'bg-violet-500/10 text-violet-700 dark:text-violet-300'
      : group.role === '创建'
        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const targetSessionId = group.sessions[0]?.id || group.sessionId || null;
  const agentSessionIds = useMemo(() => getUniqueSessionIds(group.sessions), [group.sessions]);
  const agentSelectionState = getSelectionState(agentSessionIds, selectedSessionIds);

  useEffect(() => {
    if (hasActiveSession || group.pendingCount > 0 || forceOpen) setOpen(true);
  }, [forceOpen, group.pendingCount, hasActiveSession]);

  return (
    <div className={`rounded-md border ${group.pendingCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background/70'}`}>
      <div className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => {
            if (group.sessions.length === 1 && !open && targetSessionId) {
              onSessionClick(targetSessionId);
            }
            setOpen((value) => !value);
          }}
        >
          <span className="material-symbols-outlined text-sm text-muted-foreground">{open ? 'expand_more' : 'chevron_right'}</span>
          <span className="material-symbols-outlined text-sm text-muted-foreground">
            {group.role === 'Supervisor' ? 'admin_panel_settings' : group.role === '创建' ? 'edit_note' : group.role === '运行' ? 'route' : 'smart_toy'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-medium text-foreground">{group.label}</div>
            <div className="truncate text-[9px] text-muted-foreground">
              {group.sessionId || (group.connected ? '已绑定会话' : '等待首次对话')}
            </div>
          </div>
        </button>
        {selectable && agentSessionIds.length > 0 ? (
          <Checkbox
            aria-label={`选择 ${group.label}`}
            checked={agentSelectionState}
            onCheckedChange={(checked) => onSelectSessions(agentSessionIds, checkedStateToBoolean(checked))}
            className="h-3.5 w-3.5"
          />
        ) : null}
        <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-medium ${roleTone}`}>
          {group.role}
        </span>
        {group.pendingCount > 0 ? (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-medium text-amber-700 dark:text-amber-300">
            待审 {group.pendingCount}
          </span>
        ) : null}
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
          {group.sessions.length || '待'}
        </span>
      </div>
      {open ? (
        <div className="border-t border-border/40 pl-3">
          {group.sessions.length > 0 ? (
            group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                compact
                selectable={selectable}
                selected={selectedSessionIds.has(session.id)}
                attentionCount={pendingQuestionsBySessionId.get(session.id)?.length || 0}
                isStreaming={activeStreamingSessionIdSet.has(session.id)}
                isRecentlyCompleted={recentlyCompletedSessionIdSet.has(session.id)}
                isLoadingSession={sessionLoadingId === session.id}
                onClick={() => onSessionClick(session.id)}
                onSelectChange={(checked) => onSelectSessions([session.id], checked)}
                onDelete={() => onDeleteSession(session)}
                onRename={(title) => onRenameSession(session, title)}
              />
            ))
          ) : (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">
                {group.connected ? '已记录会话，可直接打开。' : '等待首次对话。'}
              </div>
              {group.sessionId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => onSessionClick(group.sessionId!)}
                >
                  打开对话
                </Button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SessionItem({
  session,
  active,
  compact = false,
  selectable = false,
  selected = false,
  isStreaming = false,
  isRecentlyCompleted = false,
  isLoadingSession = false,
  attentionCount = 0,
  deleteDisabled = false,
  onClick,
  onSelectChange,
  onDelete,
  onRename,
}: {
  session: ChatSessionSummaryLike & {
    agentBinding?: {
      agentName: string;
    };
  };
  active: boolean;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  isStreaming?: boolean;
  isRecentlyCompleted?: boolean;
  isLoadingSession?: boolean;
  attentionCount?: number;
  deleteDisabled?: boolean;
  onClick: () => void;
  onSelectChange?: (checked: boolean) => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const isWeChatBound = hasWeChatBinding(session as SidebarSession);
  const summary = session.lastMessage?.slice(0, 40) || '空会话';
  const workflowTopic = session.sessionWorkbenchState?.collaborationRoom?.chatroom?.topic
    || session.sessionWorkbenchState?.collaborationRoom?.topic
    || '';
  const isWorkflowAgoraTopic = Boolean(session.workflowBinding && session.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const statusBadge = deleteDisabled
    ? { label: '运行中', tone: 'bg-primary/10 text-primary' }
    : isWorkflowAgoraTopic
    ? { label: '协作议题', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
    : session.workflowBinding
      ? { label: '运行', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    : session.creationSession
      ? { label: '创建', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
      : session.sessionWorkbenchState?.collaborationRoom
        ? { label: '议场', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
      : session.agentBinding
        ? { label: 'Agent', tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
        : null;
  const subLabel = session.workflowBinding
    ? [session.workflowBinding.configFile, workflowTopic && workflowTopic !== session.workflowBinding.configFile ? workflowTopic : ''].filter(Boolean).join(' · ')
    : session.creationSession
      ? `${session.creationSession.filename} · ${getCreationSessionStatusLabel(session.creationSession.status)}`
      : workflowTopic
        || session.agentBinding?.agentName
        || '';
  const commitRename = () => {
    const nextTitle = renameValue.trim();
    if (nextTitle && nextTitle !== session.title) {
      onRename(nextTitle);
    }
    setRenameValue(nextTitle || session.title);
    setRenameDialogOpen(false);
  };
  const startRenaming = () => {
    setRenameValue(session.title);
    setRenameDialogOpen(true);
  };

  useEffect(() => {
    if (!renameDialogOpen) {
      setRenameValue(session.title);
    }
  }, [renameDialogOpen, session.title]);

  const row = (
    <div
      className={`home-chat-session-row group relative flex items-start gap-2 overflow-hidden py-2.5 cursor-pointer ${compact ? 'rounded-xl' : 'border-b border-border/35 last:border-b-0'} transition-colors duration-150 ${
        active
          ? 'border-l-[3px] border-primary bg-primary/10 px-3'
          : isWeChatBound
            ? 'border-l-[3px] border-[#1AAD19] bg-[#1AAD19]/[0.08] px-3 hover:bg-[#1AAD19]/[0.12]'
            : 'px-3 hover:bg-muted/55'
      } ${isStreaming ? 'bg-primary/15 ring-1 ring-primary/20' : isLoadingSession ? 'bg-muted/45' : isRecentlyCompleted ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' : ''}`}
      onClick={() => {
        if (selectable) {
          onSelectChange?.(!selected);
          return;
        }
        onClick();
      }}
    >
      {selectable ? (
        <Checkbox
          aria-label={`选择 ${session.title}`}
          checked={selected}
          onCheckedChange={(checked) => onSelectChange?.(checkedStateToBoolean(checked))}
          onClick={(event) => {
            event.stopPropagation();
          }}
          className="mt-0.5 h-4 w-4"
        />
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <span className="relative flex h-2 w-2 shrink-0" aria-label="进行中">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          ) : isRecentlyCompleted ? (
            <span className="inline-flex shrink-0 items-center text-emerald-600 dark:text-emerald-400" aria-label="刚完成">
              <span className="material-symbols-outlined text-sm">check_circle</span>
            </span>
          ) : isLoadingSession ? (
            <span className="inline-flex shrink-0 items-center text-primary" aria-label="加载中">
              <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
            </span>
          ) : null}
          <div className="text-sm font-medium truncate">{session.title}</div>
          {isWeChatBound ? (
            <>
              <span
                className="inline-flex shrink-0 items-center text-[#1AAD19]"
                title="微信绑定会话"
                aria-label="微信绑定会话"
              >
                <WeChatIcon className="h-3.5 w-3.5" />
              </span>
              <span
                className="inline-flex shrink-0 items-center text-muted-foreground"
                title="已置顶"
                aria-label="已置顶"
              >
                <Pin className="h-3 w-3 fill-current" />
              </span>
              <span className="shrink-0 rounded-full bg-[#1AAD19]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#168C14] dark:text-[#7EE37B]">
                微信
              </span>
            </>
          ) : null}
          {isStreaming ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              发言中
            </span>
          ) : isRecentlyCompleted ? (
            <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 dark:text-emerald-300">
              刚完成
            </span>
          ) : isLoadingSession ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              加载中
            </span>
          ) : null}
          {statusBadge ? (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusBadge.tone}`}>
              {statusBadge.label}
            </span>
          ) : null}
          {attentionCount > 0 ? (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
              待审 {attentionCount}
            </span>
          ) : null}
        </div>
        {subLabel ? (
          <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{subLabel}</div>
        ) : null}
        <div className="text-xs text-muted-foreground truncate mt-0.5">{summary}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-0.5">
          {new Date(session.updatedAt).toLocaleString()}
        </div>
      </div>
      {!selectable ? (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-0 rounded-full bg-background/92 opacity-0 ring-1 ring-border/60 backdrop-blur transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-full text-muted-foreground hover:bg-background/80 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              startRenaming();
            }}
            title="重命名会话"
            aria-label={`重命名 ${session.title}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>edit</span>
          </Button>
          <Button
            size="icon"
            variant="ghost"
            disabled={deleteDisabled}
            className="h-7 w-7 rounded-full text-destructive hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-45"
            onClick={(event) => {
              event.stopPropagation();
              if (deleteDisabled) return;
              onDelete();
            }}
            title={deleteDisabled ? '工作流运行中的对话不能删除' : '删除会话'}
            aria-label={`删除 ${session.title}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>delete</span>
          </Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
        <ContextMenuContent className="w-32" onClick={(event) => event.stopPropagation()}>
          <ContextMenuItem
            onSelect={(event) => {
              event.preventDefault();
              startRenaming();
            }}
          >
            <span className="material-symbols-outlined mr-2 text-sm">edit</span>
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
            <span className="material-symbols-outlined mr-2 text-sm">delete</span>
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitRename();
            }}
          >
            <DialogHeader>
              <DialogTitle>重命名对话</DialogTitle>
              <DialogDescription>
                修改后会同步显示在左侧对话列表中。
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                placeholder="请输入对话名称"
                aria-label="对话名称"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!renameValue.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WeChatIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M785.066667 578.389333c-22.755556 0-39.822222-17.066667-39.822223-39.822222 0-22.755556 17.066667-39.822222 39.822223-39.822222 22.755556 0 39.822222 17.066667 39.822222 39.822222 0 22.755556-17.066667 39.822222-39.822222 39.822222m-204.8 0c-22.755556 0-39.822222-17.066667-39.822223-39.822222 0-22.755556 17.066667-39.822222 39.822223-39.822222 22.755556 0 39.822222 17.066667 39.822222 39.822222 0 22.755556-17.066667 39.822222-39.822222 39.822222m386.844444 56.888889c0-130.844444-113.777778-238.933333-261.688889-250.311111H682.666667c-153.6 0-278.755556 113.777778-278.755556 250.311111 0 22.755556 5.688889 39.822222 5.688889 62.577778 28.444444 108.088889 142.222222 187.733333 273.066667 187.733333 45.511111 0 85.333333-11.377778 125.155555-28.444444l62.577778 45.511111s17.066667 11.377778 17.066667-11.377778l-17.066667-68.266666c56.888889-45.511111 96.711111-113.777778 96.711111-187.733334" />
      <path d="M256 356.522667c-22.755556 0-39.822222-17.066667-39.822222-39.822223 0-22.755556 17.066667-39.822222 39.822222-39.822222 22.755556 0 39.822222 17.066667 39.822222 39.822222 0 17.066667-17.066667 39.822222-39.822222 39.822223m250.311111-85.333334c22.755556 0 39.822222 17.066667 39.822222 39.822223 0 22.755556-17.066667 39.822222-39.822222 39.822222-22.755556 0-39.822222-17.066667-39.822222-39.822222 0-22.755556 17.066667-39.822222 39.822222-39.822223m199.111111 96.711111c-22.755556-142.222222-159.288889-250.311111-324.266666-250.311111-176.355556 0-324.266667 130.844444-324.266667 290.133334 0 91.022222 45.511111 170.666667 113.777778 221.866666l-22.755556 91.022223s-5.688889 28.444444 22.755556 17.066666l91.022222-62.577778c39.822222 11.377778 79.644444 22.755556 119.466667 22.755556h11.377777c-5.688889-17.066667-5.688889-39.822222-5.688889-62.577778 0-147.911111 136.533333-273.066667 301.511112-273.066666 5.688889 0 11.377778 0 17.066666 5.688888z" />
    </svg>
  );
}
