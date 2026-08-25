'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { ActionBlock, ActionState, ActionStatus, executeAction, undoAction, isSafeAction, parseActions, normalizeAssistantDisplay } from '@/lib/chat/actions';
import { getSessionDirectoryKind } from '@/lib/agent/conversations';
import { extractLastChatPreview } from '@/lib/chat/message-preview';
import {
  isCreationAssistantSidebarHint,
  readStoredCreationAssistantEnabled,
  resolveCreationAssistantEnabled,
  writeStoredCreationAssistantEnabled,
  type HomeSidebarHint,
  type SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';
import { appendStreamChunk, buildFinalRawContent } from '@/lib/chat/stream-assembly';
import type { ManagedMcpServer } from '@/lib/mcp/types';
import { useWorkflowLiveState } from '@/lib/workflow/live-store';
import { createSafeEventSource } from '@/lib/core/safe-event-source';
import { parseSseJsonEventData } from '@/lib/core/sse-event-data';
import { isRunningWorkflowConversation } from '@/lib/workflow/run-status';
import { resolveConversationMode, type HomeConversationMode } from '@/lib/chat/conversation-mode';
import { storeChatStreamSseEventAsAgentMessage, type AceStreamChunk } from '@/client/ai/messages';
import { agentMessagesCollection } from '@/client/db/collections';
import { useRuntimeEngineSelectionQuery } from '@/client/query/engines';
import { apiFetch } from '@/client/query/api-client';

// --- Types ---

function hasOwnKey<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeRuntimeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRuntimeSessionIdFromPayload(value: any): string | undefined {
  return normalizeRuntimeSessionId(value?.runtimeSessionId) || normalizeRuntimeSessionId(value?.sessionId);
}

function resolveLatestHomeSidebarHint(
  sidebarHints: HomeSidebarHint[],
  creationAssistantEnabled: boolean,
): HomeSidebarHint | undefined {
  const candidate = sidebarHints[sidebarHints.length - 1];
  if (!creationAssistantEnabled && isCreationAssistantSidebarHint(candidate)) return undefined;
  return candidate;
}

function normalizeChatSession(session: ChatSession | null | undefined): ChatSession | null {
  if (!session) return null;
  const oldFieldRecord = session as ChatSession & { backendSessionId?: unknown };
  const runtimeSessionId = normalizeRuntimeSessionId(session.runtimeSessionId) || normalizeRuntimeSessionId(oldFieldRecord.backendSessionId);
  const { backendSessionId: _oldField, ...publicSession } = oldFieldRecord;
  return {
    ...publicSession,
    runtimeSessionId,
  };
}

function serializeChatSession(session: ChatSession): ChatSession {
  const oldFieldRecord = session as ChatSession & { backendSessionId?: unknown };
  const { backendSessionId: _oldField, ...publicSession } = oldFieldRecord;
  return publicSession;
}

function appendRequestFailureNotice(message: ChatMessage, errorMessage: string, fallbackContent = '', fallbackRawContent = ''): ChatMessage {
  const notice = `请求失败：${errorMessage || '请求失败'}`;
  const appendNotice = (value: string) => {
    const base = String(value || '').trimEnd();
    if (!base) return notice;
    if (base.includes(notice)) return base;
    return `${base}\n\n${notice}`;
  };
  const baseContent = message.content || fallbackContent;
  const baseRawContent = message.rawContent || fallbackRawContent || baseContent;
  const content = appendNotice(baseContent);
  const rawContent = appendNotice(baseRawContent);
  return {
    ...message,
    role: 'error',
    content,
    rawContent: rawContent !== content ? rawContent : undefined,
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  source?: {
    type: 'wechat';
    label?: string;
    direction?: 'inbound' | 'outbound';
  };
  actions?: ActionState[];
  cards?: any[];
  engine?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  workflowThinking?: boolean;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  conversationMode?: HomeConversationMode;
  runtimeSessionId?: string;
  creationSession?: {
    creationSessionId: string;
    filename: string;
    workflowName: string;
    status: 'draft' | 'confirmed' | 'config-generated' | 'run-bound' | 'archived';
    specCodingId: string;
    createdAt: number;
    updatedAt: number;
  };
  workflowBinding?: {
    configFile: string;
    runId: string;
    supervisorAgent?: string;
    supervisorSessionId?: string | null;
    attachedAgentSessions?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
  };
  agentBinding?: {
    agentName: string;
    team?: 'blue' | 'red' | 'judge' | 'black-gold';
    roleType?: 'normal' | 'supervisor';
    createdAt: number;
    updatedAt: number;
  };
  sessionWorkbenchState?: SessionWorkbenchState;
  model: string;
  engine?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

interface SessionSummary {
  id: string;
  title: string;
  conversationMode?: HomeConversationMode;
  model: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
  creationSession?: ChatSession['creationSession'];
  workflowBinding?: ChatSession['workflowBinding'];
  agentBinding?: ChatSession['agentBinding'];
  sessionWorkbenchState?: ChatSession['sessionWorkbenchState'];
}

interface StreamCheckResponse {
  active: boolean;
  found?: boolean;
  chatId?: string;
  streamContent?: string;
  status?: 'running' | 'completed' | 'failed' | 'killed';
  engine?: string;
  model?: string;
  runtimeSessionId?: string;
  liveSession?: ChatSession | null;
}

type DiscoveredSkill = {
  name: string;
  label: string;
  description: string;
  source?: string;
  tags?: string[];
};

function resolveNextActiveSessionIdAfterDelete(
  remainingSessions: SessionSummary[],
  deletedActiveSession?: Pick<SessionSummary, 'workflowBinding' | 'creationSession' | 'sessionWorkbenchState'> | null,
): string | null {
  if (!deletedActiveSession) return null;
  const deletedDirectoryKind = getSessionDirectoryKind(deletedActiveSession);
  return remainingSessions.find((session) => getSessionDirectoryKind(session) === deletedDirectoryKind)?.id || null;
}

function extractLastMessagePreview(messages: ChatMessage[]): string | undefined {
  return extractLastChatPreview(messages);
}

function removeSessionId(list: string[], sessionId: string): string[] {
  return list.includes(sessionId) ? list.filter((item) => item !== sessionId) : list;
}

function removeSessionIds(list: string[], sessionIds: Set<string>): string[] {
  let changed = false;
  const next = list.filter((item) => {
    const keep = !sessionIds.has(item);
    if (!keep) changed = true;
    return keep;
  });
  return changed ? next : list;
}

function isSessionAhead(
  candidate: Pick<ChatSession, 'updatedAt' | 'messages'>,
  baseline: Pick<ChatSession, 'updatedAt' | 'messages'> | null | undefined,
): boolean {
  if (!baseline) return true;
  if (baseline.messages.length > 0 && candidate.messages.length === 0) return false;
  if (candidate.messages.length > 0 && baseline.messages.length === 0) return true;
  return candidate.updatedAt > baseline.updatedAt || candidate.messages.length > baseline.messages.length;
}

function hasReadableSessionMessages(session: Pick<ChatSession, 'messages'> | null | undefined): boolean {
  return Boolean(session?.messages?.some((message) => (
    String(message.content || message.rawContent || '').trim()
    || (message.actions?.length ?? 0) > 0
    || (message.cards?.length ?? 0) > 0
  )));
}

function countReadableSessionMessages(session: Pick<ChatSession, 'messages'> | null | undefined): number {
  return session?.messages.reduce((count, message) => (
    String(message.content || message.rawContent || '').trim()
    || (message.actions?.length ?? 0) > 0
    || (message.cards?.length ?? 0) > 0
      ? count + 1
      : count
  ), 0) || 0;
}

function isSessionMoreCompleteForRestore(
  candidate: Pick<ChatSession, 'updatedAt' | 'messages'>,
  baseline: Pick<ChatSession, 'updatedAt' | 'messages'>,
): boolean {
  const candidateReadableCount = countReadableSessionMessages(candidate);
  const baselineReadableCount = countReadableSessionMessages(baseline);
  if (candidateReadableCount !== baselineReadableCount) {
    if (candidateReadableCount === 0) return false;
    if (baselineReadableCount === 0) return true;
    return candidateReadableCount > baselineReadableCount;
  }
  if (candidate.messages.length !== baseline.messages.length) {
    return candidate.messages.length > baseline.messages.length;
  }
  return isSessionAhead(candidate, baseline);
}

function chooseLoadedSessionSnapshot(input: {
  liveSession: ChatSession | null;
  persistedSession: ChatSession | null;
  latestCached: ChatSession | undefined;
  currentActive: ChatSession | null;
  summaryMessageCount?: number;
}): ChatSession | null {
  const candidates = [
    input.liveSession,
    input.persistedSession,
    input.latestCached,
    input.currentActive,
  ].filter((session): session is ChatSession => Boolean(session));
  if (candidates.length === 0) return null;

  const nonEmptyCandidates = candidates.filter(hasReadableSessionMessages);
  const effectiveCandidates = nonEmptyCandidates.length > 0 ? nonEmptyCandidates : candidates;
  if ((input.summaryMessageCount || 0) > 0 && nonEmptyCandidates.length > 0) {
    return nonEmptyCandidates.reduce((best, candidate) => (
      isSessionMoreCompleteForRestore(candidate, best) ? candidate : best
    ));
  }

  return effectiveCandidates.reduce((best, candidate) => (
    isSessionMoreCompleteForRestore(candidate, best) ? candidate : best
  ));
}

function resolveSessionWorkingDirectory(
  session: Pick<ChatSession, 'sessionWorkbenchState'> | null | undefined,
  fallbackWorkingDirectory: string,
): string {
  const sessionWorkingDirectory = String(session?.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim();
  if (sessionWorkingDirectory) return sessionWorkingDirectory;
  return String(fallbackWorkingDirectory || '').trim();
}

interface DashboardChatContextType {
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  createSession: (options?: {
    title?: string;
    agentBinding?: {
      agentName: string;
      team?: 'blue' | 'red' | 'judge' | 'black-gold';
      roleType?: 'normal' | 'supervisor';
    };
    sessionWorkbenchState?: SessionWorkbenchState;
    messages?: Array<Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>>;
  }) => string;
  deleteSession: (id: string) => void;
  deleteSessions: (ids: string[]) => void;
  renameSession: (id: string, title: string) => void;
  setActiveSessionId: (id: string | null) => void;
  sendMessage: (text: string, options?: { displayText?: string; targetSessionId?: string }) => Promise<void>;
  compactActiveSession: () => Promise<void>;
  stopStreaming: () => void;
  deleteMessage: (messageId: string) => void;
  retryFromMessage: (messageId: string) => void;
  continueFromMessage: (messageId: string) => Promise<void>;
  loading: boolean;
  activeStreamingSessionIds: string[];
  recentlyCompletedSessionIds: string[];
  sessionLoadingId: string | null;
  streamingMessageId: string | null;
  setStreamingMessageId: (id: string | null) => void;
  markSessionStreaming: (sessionId: string | null | undefined) => void;
  unmarkSessionStreaming: (sessionId: string | null | undefined) => void;
  model: string;
  setModel: (m: string) => void;
  creationAssistantDefaultEnabled: boolean;
  setCreationAssistantDefaultEnabled: (enabled: boolean) => void;
  engine: string;
  effectiveEngine: string;
  isModelSelectionReady: boolean;
  setEngine: (e: string) => void;
  confirmAction: (messageId: string, actionId: string) => Promise<void>;
  rejectAction: (messageId: string, actionId: string) => void;
  undoActionById: (messageId: string, actionId: string) => Promise<void>;
  retryAction: (messageId: string, actionId: string) => Promise<void>;
  reloadActionResult: (messageId: string, actionId: string) => Promise<void>;
  skillSettings: Record<string, boolean>;
  discoveredSkills: DiscoveredSkill[];
  toggleSkill: (skill: string) => void;
  setSkillsEnabled: (skills: Record<string, boolean>) => void;
  mcpSettings: Record<string, boolean>;
  discoveredMcpServers: ManagedMcpServer[];
  toggleMcpServer: (serverName: string) => void;
  setMcpServersEnabled: (servers: Record<string, boolean>) => void;
  capabilitySkills: any;
  setCapabilitySkills: (capabilitySkills: any) => void;
  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  setSessionWorkbenchState: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
  updateSessionWorkbenchState: (
    sessionId: string,
    state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)
  ) => Promise<ChatSession | null>;
  updateSessionCreationBinding: (sessionId: string, creationSession: ChatSession['creationSession'] | null) => Promise<void>;
  appendVisibleSessionTag: (sessionId: string, label: string) => Promise<void>;
  appendSessionMessage: (
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>,
    options?: { runtimeSessionId?: string | null }
  ) => Promise<void>;
  updateSessionMessage: (
    sessionId: string,
    messageId: string,
    patch: Partial<ChatMessage>
  ) => Promise<void>;
}

const DashboardChatContext = createContext<DashboardChatContextType>({
  isOpen: false, openChat: () => {}, closeChat: () => {}, toggleChat: () => {},
  sessions: [], sessionsLoading: true, activeSessionId: null, activeSession: null,
  createSession: () => '', deleteSession: () => {}, deleteSessions: () => {}, renameSession: () => {},
  setActiveSessionId: () => {},
  sendMessage: async () => {}, compactActiveSession: async () => {}, stopStreaming: () => {},
  deleteMessage: () => {}, retryFromMessage: () => {}, continueFromMessage: async () => {},
  loading: false, activeStreamingSessionIds: [], recentlyCompletedSessionIds: [], sessionLoadingId: null, streamingMessageId: null, setStreamingMessageId: () => {},
  markSessionStreaming: () => {}, unmarkSessionStreaming: () => {},
  model: '', setModel: () => {},
  creationAssistantDefaultEnabled: true, setCreationAssistantDefaultEnabled: () => {},
  engine: '', effectiveEngine: '', isModelSelectionReady: false, setEngine: () => {},
  confirmAction: async () => {}, rejectAction: () => {},
  undoActionById: async () => {}, retryAction: async () => {}, reloadActionResult: async () => {},
  skillSettings: {}, discoveredSkills: [], toggleSkill: () => {}, setSkillsEnabled: () => {},
  mcpSettings: {}, discoveredMcpServers: [], toggleMcpServer: () => {}, setMcpServersEnabled: () => {},
  capabilitySkills: {}, setCapabilitySkills: () => {},
  workingDirectory: '', setWorkingDirectory: () => {},
  setSessionWorkbenchState: () => {},
  updateSessionWorkbenchState: async () => null,
  updateSessionCreationBinding: async () => {},
  appendVisibleSessionTag: async () => {},
  appendSessionMessage: async () => {},
  updateSessionMessage: async () => {},
});

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTIVE_SESSION_STORAGE_KEY = 'aceharness:chat:active-session-id';
export { appendStreamChunk, buildFinalRawContent };

function writeStoredActiveSessionId(sessionId: string | null): void {
  if (typeof window === 'undefined') return;

  try {
    if (sessionId) {
      window.sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
    } else {
      window.sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  } catch {}

  // 清理旧架构共享标签页 key，避免不同窗口竞争同一个当前会话。
  try {
    window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {}
}

function readStoredActiveSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
    return stored && stored.trim() ? stored.trim() : null;
  } catch {
    return null;
  }
}

// --- Server API helpers ---
function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiListSessions(): Promise<SessionSummary[]> {
  const res = await fetch('/api/chat/sessions', {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions || [];
}

async function apiCreateSession(session: ChatSession): Promise<void> {
  await fetch('/api/chat/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(serializeChatSession(session)),
  });
}

async function apiLoadSession(id: string): Promise<ChatSession | null> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return normalizeChatSession(data.session || null);
}

async function apiCheckStreamState(id: string): Promise<StreamCheckResponse | null> {
  try {
    const res = await fetch(`/api/chat/stream?checkActive=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data as StreamCheckResponse;
  } catch {
    return null;
  }
}

async function apiSaveSession(session: ChatSession): Promise<void> {
  await fetch(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(serializeChatSession(session)),
  });
}

async function apiDeleteSession(id: string): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || '删除会话失败');
  }
}

async function apiEnsureChatWorkspace(input: {
  sessionId: string;
  sourceWorkspace?: string;
  targetWorkspace?: string;
  title?: string;
  skills?: string[] | Record<string, boolean>;
  mcpServers?: string[] | Record<string, boolean>;
}): Promise<{ workspacePath: string; created: boolean; sourceWorkspace?: string }> {
  const res = await fetch('/api/agora/workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({
      ...input,
      purpose: 'chat',
    }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || '准备对话工作区失败');
  return data;
}

async function apiBatchDeleteSessions(ids: string[]): Promise<void> {
  const res = await fetch('/api/chat/sessions/batch-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok && res.status !== 207) {
    throw new Error('批量删除会话失败');
  }
  const data = await res.json().catch(() => null);
  if (Array.isArray(data?.protectedRunning) && data.protectedRunning.length > 0) {
    throw new Error('部分工作流运行中的对话不能删除');
  }
}

async function apiTerminateSessionProcesses(id: string): Promise<void> {
  await Promise.allSettled([
    fetch(`/api/chat/stream?frontendSessionId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    }),
    fetch(`/api/agents/__session__/chat/stream?frontendSessionId=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: getAuthHeaders(),
    }),
  ]);
}

async function apiTerminateSessionsProcesses(ids: string[]): Promise<void> {
  await Promise.allSettled(ids.map((id) => apiTerminateSessionProcesses(id)));
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const getWorkingDirStorageKey = useCallback(() => {
    if (typeof window === 'undefined') return 'chat-working-directory';
    try {
      const raw = localStorage.getItem('auth-user');
      if (!raw) return 'chat-working-directory';
      const user = JSON.parse(raw);
      const uid = user?.id || user?.username || '';
      return uid ? `chat-working-directory:${uid}` : 'chat-working-directory';
    } catch {
      return 'chat-working-directory';
    }
  }, []);
  // oldArchitecture modal state
  const [isOpen, setIsOpen] = useState(false);
  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen(prev => !prev), []);

  // Dashboard chat state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeStreamingSessionIds, setActiveStreamingSessionIds] = useState<string[]>([]);
  const [recentlyCompletedSessionIds, setRecentlyCompletedSessionIds] = useState<string[]>([]);
  const [sessionLoadingId, setSessionLoadingId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [model, setModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chat-model') || '';
    }
    return '';
  });
  const [creationAssistantDefaultEnabled, setCreationAssistantDefaultEnabledState] = useState(
    readStoredCreationAssistantEnabled
  );
  const setCreationAssistantDefaultEnabled = useCallback((enabled: boolean) => {
    setCreationAssistantDefaultEnabledState(enabled);
    writeStoredCreationAssistantEnabled(enabled);
  }, []);

  // Per-chat engine override (empty = use global)
  const [engine, setEngineState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chat-engine') || '';
    }
    return '';
  });
  // Resolved global engine for when per-chat engine is empty
  const runtimeSelectionQuery = useRuntimeEngineSelectionQuery();
  const globalEngine = typeof runtimeSelectionQuery.data?.engine === 'string' ? runtimeSelectionQuery.data.engine : '';
  const globalDefaultModel = typeof runtimeSelectionQuery.data?.defaultModel === 'string' ? runtimeSelectionQuery.data.defaultModel : '';
  const effectiveGlobalEngine = globalEngine;
  const effectiveEngine = engine || effectiveGlobalEngine;
  const isModelSelectionReady = Boolean(effectiveEngine) && !runtimeSelectionQuery.isLoading;
  const { chatStreamsBySessionId, chatSessionSignalsById, runStatusById } = useWorkflowLiveState();

  // Load global runtime selection and default model on mount.
  useEffect(() => {
    const savedModel = typeof window !== 'undefined' ? localStorage.getItem('chat-model') : null;
    if (!savedModel && globalDefaultModel) setModel(globalDefaultModel);
  }, [globalDefaultModel]);

  const [skillSettings, setSkillSettings] = useState<Record<string, boolean>>({});
  const [discoveredSkills, setDiscoveredSkills] = useState<DiscoveredSkill[]>([]);
  const [mcpSettings, setMcpSettings] = useState<Record<string, boolean>>({});
  const [discoveredMcpServers, setDiscoveredMcpServers] = useState<ManagedMcpServer[]>([]);
  const [capabilitySkills, setCapabilitySkillsState] = useState<any>({});
  const [workingDirectory, setWorkingDirectoryState] = useState('');

  const refreshChatSettings = useCallback(async () => {
    return fetch('/api/chat/settings').then(r => r.json()).then(data => {
      if (data.skills) setSkillSettings(data.skills);
      if (data.discoveredSkills) setDiscoveredSkills(data.discoveredSkills);
      if (data.mcpServers) setMcpSettings(data.mcpServers);
      if (data.discoveredMcpServers) setDiscoveredMcpServers(data.discoveredMcpServers);
      if (data.capabilitySkills) setCapabilitySkillsState(data.capabilitySkills);
      return data;
    });
  }, []);

  // Load skill settings on mount
  useEffect(() => {
    refreshChatSettings().then(data => {
      const wdKey = getWorkingDirStorageKey();
      const localDir = localStorage.getItem(wdKey);
      if (localDir) {
        setWorkingDirectoryState(localDir);
        return;
      }
      if (data.workingDirectory) {
        setWorkingDirectoryState(data.workingDirectory);
        localStorage.setItem(wdKey, data.workingDirectory);
        return;
      }
      try {
        const stored = localStorage.getItem('auth-user');
        if (stored) {
          const user = JSON.parse(stored);
          if (user.personalDir) {
            setWorkingDirectoryState(user.personalDir);
            localStorage.setItem(wdKey, user.personalDir);
          }
        }
      } catch {}
    }).catch(() => {});
  }, [getWorkingDirStorageKey, refreshChatSettings]);

  const toggleSkill = useCallback((skill: string) => {
    setSkillSettings(prev => {
      const next = { ...prev, [skill]: !prev[skill] };
      fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const setSkillsEnabled = useCallback((skills: Record<string, boolean>) => {
    setSkillSettings(prev => {
      const next = { ...prev, ...skills };
      fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const toggleMcpServer = useCallback((serverName: string) => {
    setMcpSettings(prev => {
      const next = { ...prev, [serverName]: !prev[serverName] };
      fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const setMcpServersEnabled = useCallback((servers: Record<string, boolean>) => {
    setMcpSettings(prev => {
      const next = { ...prev, ...servers };
      fetch('/api/chat/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpServers: next }),
      }).catch(() => {});
      return next;
    });
  }, []);

  const setCapabilitySkills = useCallback((nextCapabilitySkills: any) => {
    setCapabilitySkillsState(nextCapabilitySkills || {});
    fetch('/api/chat/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ capabilitySkills: nextCapabilitySkills || {} }),
    }).catch(() => {});
  }, []);

  const setWorkingDirectory = useCallback((dir: string) => {
    setWorkingDirectoryState(dir);
    if (typeof window !== 'undefined') {
      localStorage.setItem(getWorkingDirStorageKey(), dir || '');
    }
  }, [getWorkingDirStorageKey]);

  // Debounced save ref
  const saveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const activeSessionRef = useRef<ChatSession | null>(null);
  const activeEventSourceRef = useRef<EventSource | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const attachedStreamingSessionIdRef = useRef<string | null>(null);
  const compactInFlightRef = useRef(false);
  const recentCompletionTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const sessionLoadTokenRef = useRef(0);
  const hasHydratedStoredSessionRef = useRef(false);
  const skillSettingsRef = useRef(skillSettings);
  const mcpSettingsRef = useRef(mcpSettings);
  const runtimeSessionStatusRef = useRef<Record<string, StreamCheckResponse['status'] | null>>({});
  const handledChatSessionSignalsRef = useRef<Record<string, number>>({});
  const modelRef = useRef(model);
  const engineRef = useRef(engine);
  const globalEngineRef = useRef(effectiveGlobalEngine);
  const sendMessageRef = useRef<((text: string, options?: { displayText?: string; targetSessionId?: string }) => Promise<void>) | null>(null);
  const pendingSessionsRef = useRef<Record<string, ChatSession>>({});
  const pendingCreationPromisesRef = useRef<Record<string, Promise<void> | undefined>>({});
  const sessionCacheRef = useRef<Record<string, ChatSession>>({});
  activeSessionRef.current = activeSession;
  skillSettingsRef.current = skillSettings;
  mcpSettingsRef.current = mcpSettings;
  modelRef.current = model;
  engineRef.current = engine;
  globalEngineRef.current = effectiveGlobalEngine;

  useEffect(() => {
    if (!activeSession || sessionLoadingId === activeSession.id) return;
    const existing = sessionCacheRef.current[activeSession.id];
    if (
      existing
      && existing.messages.length > activeSession.messages.length
      && existing.updatedAt >= activeSession.updatedAt
    ) {
      return;
    }
    sessionCacheRef.current[activeSession.id] = activeSession;
  }, [activeSession, sessionLoadingId]);

  const loadSessionSummaries = useCallback((isCancelled: () => boolean = () => false) => {
    setSessionsLoading(true);
    return apiListSessions().then(list => {
      if (isCancelled()) return;
      const mergedList = [...list];
      const mergeLocalSession = (session: ChatSession | null | undefined) => {
        if (!session) return;
        const localSummary: SessionSummary = {
          id: session.id,
          title: session.title,
          model: session.model,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
          lastMessage: extractLastMessagePreview(session.messages),
          conversationMode: session.conversationMode,
          creationSession: session.creationSession,
          workflowBinding: session.workflowBinding,
          agentBinding: session.agentBinding,
          sessionWorkbenchState: session.sessionWorkbenchState,
        };
        const existingIndex = mergedList.findIndex((item) => item.id === session.id);
        if (existingIndex < 0) {
          mergedList.unshift(localSummary);
          return;
        }

        const existing = mergedList[existingIndex];
        const localIsAhead = session.messages.length > existing.messageCount
          || session.updatedAt >= existing.updatedAt;
        if (localIsAhead || localSummary.lastMessage && !existing.lastMessage) {
          mergedList[existingIndex] = { ...existing, ...localSummary };
        }
      };
      mergeLocalSession(activeSessionRef.current);
      Object.values(sessionCacheRef.current).forEach(mergeLocalSession);
      setSessions(mergedList);

      const storedActiveSessionId = readStoredActiveSessionId();
      if (!storedActiveSessionId) return;

      const storedSessionExists = mergedList.some((session) => session.id === storedActiveSessionId);
      if (!storedSessionExists) {
        writeStoredActiveSessionId(null);
      }

      setActiveSessionId((prev) => (prev ? prev : storedSessionExists ? storedActiveSessionId : null));
      hasHydratedStoredSessionRef.current = true;
    }).finally(() => {
      if (!isCancelled()) setSessionsLoading(false);
    });
  }, []);

  // Load session list on mount and after same-page login.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;
    void loadSessionSummaries(isCancelled);
    const handleAuthChanged = () => {
      void loadSessionSummaries(isCancelled);
    };
    window.addEventListener('auth:changed', handleAuthChanged);
    return () => {
      cancelled = true;
      window.removeEventListener('auth:changed', handleAuthChanged);
    };
  }, [loadSessionSummaries]);

  useEffect(() => {
    const handleStorageAuthChange = (event: StorageEvent) => {
      if (event.key !== 'auth-token') return;
      void loadSessionSummaries();
    };
    window.addEventListener('storage', handleStorageAuthChange);
    return () => {
      window.removeEventListener('storage', handleStorageAuthChange);
    };
  }, [loadSessionSummaries]);

  useEffect(() => {
    if (!hasHydratedStoredSessionRef.current && !activeSessionId) return;
    writeStoredActiveSessionId(activeSessionId);
  }, [activeSessionId]);

  // Re-parse messages with unparsed action/card blocks in content
  const reparseSession = useCallback((s: ChatSession): ChatSession => {
    const creationAssistantEnabled = resolveCreationAssistantEnabled(s);
    let changed = false;
    const messages = s.messages.map(m => {
      if (m.role !== 'assistant' || !m.content) return m;
      const hasUnparsed = /```(?:action|card|json|)\s*\n\s*\{/.test(m.content);
      if (!hasUnparsed) return m;
      const { text, actions, cards } = parseActions(m.content);
      if (actions.length === 0 && cards.length === 0) return m;
      changed = true;
      const actionStates: ActionState[] = actions.map(a => ({
        id: genId(), action: a, status: 'pending' as ActionStatus, timestamp: m.timestamp,
      }));
      return {
        ...m,
        content: text,
        actions: actionStates.length > 0 ? [...(m.actions || []), ...actionStates] : m.actions,
        cards: cards.length > 0 ? [...(m.cards || []), ...cards] : m.cards,
      };
    });
    if (!changed) return s;

    const assistantMessages = [...messages].reverse().filter((message) => message.role === 'assistant');
    let latestSidebarHint: HomeSidebarHint | null = null;
    for (const message of assistantMessages) {
      const parsed = parseActions(message.rawContent || message.content || '');
      if (parsed.sidebarHints.length > 0) {
        latestSidebarHint = resolveLatestHomeSidebarHint(parsed.sidebarHints, creationAssistantEnabled) || null;
        break;
      }
    }

    return {
      ...s,
      messages,
      sessionWorkbenchState: latestSidebarHint
        ? {
            ...(s.sessionWorkbenchState || {}),
            homeSidebar: latestSidebarHint,
          }
        : s.sessionWorkbenchState,
    };
  }, []);

  const prepareLoadedSession = useCallback((session: ChatSession | null | undefined): ChatSession | null => {
    if (!session) return null;
    const shouldClearCreationHint = !resolveCreationAssistantEnabled(session)
      && isCreationAssistantSidebarHint(session.sessionWorkbenchState?.homeSidebar);
    const cleaned = {
      ...session,
      sessionWorkbenchState: shouldClearCreationHint
        ? {
            ...(session.sessionWorkbenchState || {}),
            homeSidebar: null,
          }
        : session.sessionWorkbenchState,
      messages: session.messages.filter((message) => !(
        message.role === 'assistant'
        && !message.content
        && !message.actions?.length
        && !message.cards?.length
      )),
    };
    return reparseSession(cleaned);
  }, [reparseSession]);

  const markSessionStreaming = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return;
    setActiveStreamingSessionIds((prev) => (prev.includes(sessionId) ? prev : [...prev, sessionId]));
    setRecentlyCompletedSessionIds((prev) => removeSessionId(prev, sessionId));
    const existingTimer = recentCompletionTimersRef.current[sessionId];
    if (existingTimer) {
      clearTimeout(existingTimer);
      delete recentCompletionTimersRef.current[sessionId];
    }
  }, []);

  const unmarkSessionStreaming = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return;
    setActiveStreamingSessionIds((prev) => removeSessionId(prev, sessionId));
  }, []);

  const markSessionRecentlyCompleted = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return;
    setRecentlyCompletedSessionIds((prev) => (prev.includes(sessionId) ? prev : [...prev, sessionId]));
    const existingTimer = recentCompletionTimersRef.current[sessionId];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    recentCompletionTimersRef.current[sessionId] = setTimeout(() => {
      setRecentlyCompletedSessionIds((prev) => removeSessionId(prev, sessionId));
      delete recentCompletionTimersRef.current[sessionId];
    }, 120000);
  }, []);

  const detachCurrentStream = useCallback(() => {
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
    activeChatIdRef.current = null;
    attachedStreamingSessionIdRef.current = null;
    setLoading(false);
    setStreamingMessageId(null);
  }, []);

  useEffect(() => {
    const trackedSessionIds = new Set([
      ...Object.keys(runtimeSessionStatusRef.current),
      ...Object.keys(chatStreamsBySessionId),
    ]);

    if (trackedSessionIds.size === 0) {
      runtimeSessionStatusRef.current = {};
      return;
    }

    trackedSessionIds.forEach((sessionId) => {
      const streamState = chatStreamsBySessionId[sessionId];
      const previousStatus = runtimeSessionStatusRef.current[sessionId] || null;
      const nextStatus = streamState?.status || null;

      if (!nextStatus) {
        delete runtimeSessionStatusRef.current[sessionId];
        unmarkSessionStreaming(sessionId);
        return;
      }

      runtimeSessionStatusRef.current[sessionId] = nextStatus;

      if (nextStatus === 'running') {
        markSessionStreaming(sessionId);
        return;
      }

      unmarkSessionStreaming(sessionId);

      if (
        nextStatus === 'completed'
        && !recentlyCompletedSessionIds.includes(sessionId)
        && previousStatus !== 'completed'
        && (previousStatus !== null || Date.now() - streamState.updatedAt < 120000)
      ) {
        markSessionRecentlyCompleted(sessionId);
      }
    });
  }, [chatStreamsBySessionId, markSessionRecentlyCompleted, markSessionStreaming, recentlyCompletedSessionIds, unmarkSessionStreaming]);

  useEffect(() => () => {
    Object.values(recentCompletionTimersRef.current).forEach((timer) => clearTimeout(timer));
    recentCompletionTimersRef.current = {};
    Object.values(saveTimersRef.current).forEach((timer) => clearTimeout(timer));
    saveTimersRef.current = {};
    pendingSessionsRef.current = {};
    pendingCreationPromisesRef.current = {};
  }, []);

  // Load full session when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) {
      setActiveSession(null);
      setSessionLoadingId(null);
      return;
    }
    // If we already have it loaded (e.g. just created), skip
    if (activeSession?.id === activeSessionId && sessionLoadingId !== activeSessionId) return;
    // Close any active stream and reset loading state
    detachCurrentStream();
    setSessionLoadingId(activeSessionId);
    const nextToken = sessionLoadTokenRef.current + 1;
    sessionLoadTokenRef.current = nextToken;
    const summary = sessions.find((item) => item.id === activeSessionId);
    const cached = sessionCacheRef.current[activeSessionId];

    if (activeSession?.id !== activeSessionId) {
      if (cached) {
        setActiveSession(cached);
      } else if (summary) {
        setActiveSession({
          id: summary.id,
          title: summary.title,
          runtimeSessionId: undefined,
          creationSession: summary.creationSession,
          workflowBinding: summary.workflowBinding,
          agentBinding: summary.agentBinding,
          sessionWorkbenchState: summary.sessionWorkbenchState,
          model: summary.model,
          engine: undefined,
          messages: [],
          createdAt: summary.createdAt,
          updatedAt: summary.updatedAt,
        });
      }
    }
    Promise.all([
      apiLoadSession(activeSessionId),
      apiCheckStreamState(activeSessionId),
    ]).then(([loadedSession, streamState]) => {
      if (sessionLoadTokenRef.current !== nextToken) return;

      const liveSession = prepareLoadedSession(streamState?.liveSession || null);
      const persistedSession = prepareLoadedSession(loadedSession);
      const latestCached = sessionCacheRef.current[activeSessionId];
      const currentActive = activeSessionRef.current?.id === activeSessionId ? activeSessionRef.current : null;
      const nextSession = chooseLoadedSessionSnapshot({
        liveSession,
        persistedSession,
        latestCached,
        currentActive,
        summaryMessageCount: summary?.messageCount,
      });

      if (!nextSession) {
        setActiveSession(null);
        setSessionLoadingId((current) => current === activeSessionId ? null : current);
        return;
      }

      setActiveSession(nextSession);
      setSessionLoadingId((current) => current === activeSessionId ? null : current);
      upsertSessionSummary(nextSession);
      if (nextSession.engine) {
        setEngineState(nextSession.engine);
      }
      if (nextSession.model) {
        setModel(nextSession.model);
      }

      if (
        streamState?.active
        && streamState.chatId
      ) {
        const streamEngine = streamState.engine || '';
        const streamModel = streamState.model || '';
        const currentEngine = nextSession.engine || globalEngineRef.current || '';
        const currentModel = nextSession.model || '';
        if (streamEngine === currentEngine && streamModel === currentModel) {
          const lastAssistantMessage = [...nextSession.messages].reverse().find((message) => message.role === 'assistant');
          const recoveryMsg = lastAssistantMessage || { id: genId(), role: 'assistant' as const, content: '', timestamp: Date.now() };
          const recoveredSession = lastAssistantMessage
            ? nextSession
            : { ...nextSession, messages: [...nextSession.messages, recoveryMsg] };
          const cachedAgentMessage = agentMessagesCollection.get(streamState.chatId);
          const cachedAgentContent = cachedAgentMessage?.content || cachedAgentMessage?.chunks?.join('') || '';
          const initialStreamContent = String(recoveryMsg.rawContent || cachedAgentContent || streamState.streamContent || '');
          const initialCleanText = recoveryMsg.content || normalizeAssistantDisplay(initialStreamContent, true).visibleText || parseActions(initialStreamContent).text;
          const hydratedSession = initialStreamContent
            ? {
                ...recoveredSession,
                messages: recoveredSession.messages.map((message) => (
                  message.id === recoveryMsg.id
                    ? { ...message, content: initialCleanText, rawContent: initialStreamContent }
                    : message
                )),
              }
            : recoveredSession;
          setActiveSession(reparseSession(hydratedSession));

          setLoading(true);
          markSessionStreaming(activeSessionId);
          setStreamingMessageId(recoveryMsg.id);
          activeChatIdRef.current = streamState.chatId;
          attachedStreamingSessionIdRef.current = activeSessionId;

          const es = createSafeEventSource(`/api/chat/stream?id=${streamState.chatId}`);
          activeEventSourceRef.current = es;
          let accumulated = initialStreamContent;
          let accumulatedRawStream = initialStreamContent;
          let initialSnapshotReplayPending = Boolean(initialStreamContent);
          let hasConnected = false;
          let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined = initialStreamContent
            ? { id: streamState.chatId, content: initialStreamContent, toolCalls: cachedAgentMessage?.toolCalls || [] }
            : undefined;

          es.addEventListener('connected', () => {
            hasConnected = true;
          });

          es.addEventListener('delta', (e) => {
            if (!hasConnected) return;
            const content = String(parseSseJsonEventData(e.data).content || '');
            if (initialSnapshotReplayPending && content === initialStreamContent) {
              initialSnapshotReplayPending = false;
              return;
            }
            initialSnapshotReplayPending = false;
            accumulated += content;
            accumulatedRawStream = appendStreamChunk(accumulatedRawStream, content);
            const row = storeChatStreamSseEventAsAgentMessage('delta', { content }, {
              chatId: streamState.chatId,
              sessionId: recoveredSession.runtimeSessionId,
              frontendSessionId: activeSessionId,
              streamScope: 'chat-recovery',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            const { text: parsedText } = parseActions(accumulated);
            const cleanText = normalizeAssistantDisplay(accumulated, true).visibleText || parsedText;
            setActiveSession(prev => {
              if (!prev) return prev;
              return {
                ...prev,
                messages: prev.messages.map(m => m.id === recoveryMsg.id ? { ...m, content: cleanText, rawContent: accumulatedRawStream } : m),
              };
            });
          });

          es.addEventListener('session', (e) => {
            const data = parseSseJsonEventData(e.data);
            const runtimeSessionId = readRuntimeSessionIdFromPayload(data);
            if (!runtimeSessionId) return;
            setActiveSession(prev => prev ? {
              ...prev,
              runtimeSessionId,
            } : prev);
          });

          es.addEventListener('thinking', (e) => {
            if (!hasConnected) return;
            const content = String(parseSseJsonEventData(e.data).content || '');
            const row = storeChatStreamSseEventAsAgentMessage('thinking', { content }, {
              chatId: streamState.chatId,
              sessionId: recoveredSession.runtimeSessionId,
              frontendSessionId: activeSessionId,
              streamScope: 'chat-recovery',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          });

          es.addEventListener('done', (e) => {
            const data = parseSseJsonEventData(e.data);
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            attachedStreamingSessionIdRef.current = null;
            const nextRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
            if (nextRuntimeSessionId || hasOwnKey(data, 'runtimeSessionId') || hasOwnKey(data, 'sessionId')) {
              setActiveSession(prev => prev ? { ...prev, runtimeSessionId: nextRuntimeSessionId } : prev);
            }
            const fullRawContent = buildFinalRawContent(accumulatedRawStream, accumulated, String(data.result || ''));
            const row = storeChatStreamSseEventAsAgentMessage(data.isError ? 'error' : 'done', {
              ...data,
              content: fullRawContent || data.result || accumulated,
              isError: data.isError,
            }, {
              chatId: streamState.chatId,
              sessionId: nextRuntimeSessionId || recoveredSession.runtimeSessionId,
              frontendSessionId: activeSessionId,
              streamScope: 'chat-recovery',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            const { text: cleanText, cards, sidebarHints } = parseActions(fullRawContent);
            const latestSidebarHint = resolveLatestHomeSidebarHint(
              sidebarHints,
              resolveCreationAssistantEnabled(recoveredSession),
            );
            setActiveSession(prev => {
              if (!prev) return prev;
              return {
                ...prev, updatedAt: Date.now(),
                sessionWorkbenchState: latestSidebarHint ? {
                  ...(prev.sessionWorkbenchState || {}),
                  homeSidebar: latestSidebarHint,
                } : prev.sessionWorkbenchState,
                messages: prev.messages.map(m => m.id === recoveryMsg.id ? {
                  ...m, content: cleanText,
                  rawContent: fullRawContent !== cleanText ? fullRawContent : m.rawContent,
                  cards: cards.length > 0 ? cards : m.cards,
                  costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
                } : m),
              };
            });
            setLoading(false);
            markSessionRecentlyCompleted(activeSessionId);
            unmarkSessionStreaming(activeSessionId);
            setSessionLoadingId((current) => current === activeSessionId ? null : current);
            setStreamingMessageId(null);
          });

          es.addEventListener('error', () => {
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            attachedStreamingSessionIdRef.current = null;
            setLoading(false);
            markSessionRecentlyCompleted(activeSessionId);
            unmarkSessionStreaming(activeSessionId);
            setSessionLoadingId((current) => current === activeSessionId ? null : current);
            setStreamingMessageId(null);
          });
          return;
        }
      }

      setLoading(false);
      setStreamingMessageId(null);
      if (streamState?.status === 'completed') {
        markSessionRecentlyCompleted(activeSessionId);
      }
    }).catch(() => {
      if (sessionLoadTokenRef.current !== nextToken) return;
      if (cached) {
        setActiveSession(cached);
        upsertSessionSummary(cached);
      } else {
        setActiveSession(null);
      }
      setSessionLoadingId((current) => current === activeSessionId ? null : current);
    });
  }, [activeSession?.id, activeSessionId, detachCurrentStream, markSessionRecentlyCompleted, markSessionStreaming, prepareLoadedSession, sessionLoadingId, sessions, unmarkSessionStreaming]);

  const cacheSessionSnapshot = useCallback((session: ChatSession | null | undefined) => {
    if (!session?.id) return;
    const existing = sessionCacheRef.current[session.id];
    if (
      existing
      && existing.id === session.id
      && existing.messages.length > session.messages.length
      && existing.updatedAt >= session.updatedAt
    ) {
      return;
    }
    sessionCacheRef.current[session.id] = session;
  }, []);

  const clearSessionTracking = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return;
    delete sessionCacheRef.current[sessionId];
    delete pendingSessionsRef.current[sessionId];
    delete handledChatSessionSignalsRef.current[sessionId];
    delete runtimeSessionStatusRef.current[sessionId];
    const timer = saveTimersRef.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete saveTimersRef.current[sessionId];
    }
  }, []);

  const upsertSessionSummary = useCallback((updated: ChatSession) => {
    cacheSessionSnapshot(updated);
    setSessions((list) => {
      const conversationMode = resolveConversationMode(updated, { runStatusById });
      const summary: SessionSummary = {
        id: updated.id,
        title: updated.title,
        model: updated.model,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
        messageCount: updated.messages.length,
        lastMessage: extractLastMessagePreview(updated.messages),
        conversationMode,
        agentBinding: updated.agentBinding,
        workflowBinding: updated.workflowBinding,
        creationSession: updated.creationSession,
        sessionWorkbenchState: {
          ...(updated.sessionWorkbenchState || {}),
          conversationMode,
        },
      };
      const exists = list.some((item) => item.id === updated.id);
      if (!exists) {
        return [summary, ...list];
      }
      let changed = false;
      const next = list.map((item) => {
        if (item.id !== updated.id) return item;
        const merged = { ...item, ...summary };
        if (JSON.stringify(merged) === JSON.stringify(item)) return item;
        changed = true;
        return merged;
      });
      return changed ? next : list;
    });
  }, [cacheSessionSnapshot, runStatusById]);

  useEffect(() => {
    const signalEntries = Object.entries(chatSessionSignalsById);
    if (signalEntries.length === 0) return;

    let cancelled = false;
    const syncSessionsFromSignals = async () => {
      for (const [sessionId, signal] of signalEntries) {
        const updatedAt = typeof signal?.updatedAt === 'number' && Number.isFinite(signal.updatedAt)
          ? signal.updatedAt
          : 0;
        if (!sessionId || updatedAt <= (handledChatSessionSignalsRef.current[sessionId] || 0)) {
          continue;
        }

        if (signal?.removed) {
          handledChatSessionSignalsRef.current[sessionId] = updatedAt;
          setActiveStreamingSessionIds((prev) => removeSessionId(prev, sessionId));
          setRecentlyCompletedSessionIds((prev) => removeSessionId(prev, sessionId));
          if (activeSessionRef.current?.id === sessionId || activeSessionId === sessionId) {
            detachCurrentStream();
            setActiveSession((current) => current?.id === sessionId ? null : current);
          }
          setSessions((list) => {
            const deletingSession = activeSessionId === sessionId
              ? list.find((session) => session.id === sessionId)
              : null;
            const next = list.filter((session) => session.id !== sessionId);
            if (activeSessionId === sessionId) {
              const nextId = resolveNextActiveSessionIdAfterDelete(next, deletingSession);
              setActiveSessionId(nextId);
              if (!nextId) setActiveSession(null);
            }
            return next.length === list.length ? list : next;
          });
          clearSessionTracking(sessionId);
          continue;
        }

        if (sessionId !== activeSessionId) {
          handledChatSessionSignalsRef.current[sessionId] = updatedAt;
          continue;
        }

        const activeTargetSession = activeSessionRef.current?.id === sessionId
          ? activeSessionRef.current
          : null;
        const shouldRefreshFromSignal = Boolean(
          activeTargetSession?.workflowBinding
          || activeTargetSession?.sessionWorkbenchState?.wechatBinding
        );
        if (!shouldRefreshFromSignal) {
          handledChatSessionSignalsRef.current[sessionId] = updatedAt;
          continue;
        }

        if (
          sessionLoadingId === sessionId
          || (
            (activeEventSourceRef.current || activeChatIdRef.current)
            && attachedStreamingSessionIdRef.current === sessionId
          )
        ) {
          continue;
        }

        const latest = await apiLoadSession(sessionId).catch(() => null);
        if (cancelled) return;
        handledChatSessionSignalsRef.current[sessionId] = updatedAt;
        const prepared = prepareLoadedSession(latest);
        if (!prepared) continue;

        const current = activeTargetSession;
        const cached = sessionCacheRef.current[sessionId] || null;
        if (!isSessionAhead(prepared, current) && !isSessionAhead(prepared, cached)) {
          continue;
        }

        upsertSessionSummary(prepared);
        if (activeSessionRef.current?.id === sessionId) {
          setActiveSession((currentSession) => {
            if (!currentSession || currentSession.id !== sessionId) return currentSession;
            return isSessionAhead(prepared, currentSession) ? prepared : currentSession;
          });
        }
      }
    };

    void syncSessionsFromSignals();
    return () => {
      cancelled = true;
    };
  }, [
    activeSessionId,
    chatSessionSignalsById,
    clearSessionTracking,
    detachCurrentStream,
    prepareLoadedSession,
    sessionLoadingId,
    streamingMessageId,
    upsertSessionSummary,
  ]);

  // Debounced persist to server
  const flushPendingSessionSave = useCallback((sessionId: string) => {
    const pending = pendingSessionsRef.current[sessionId];
    if (!pending) return;
    delete pendingSessionsRef.current[sessionId];
    const timer = saveTimersRef.current[sessionId];
    if (timer) {
      clearTimeout(timer);
      delete saveTimersRef.current[sessionId];
    }
    apiSaveSession(pending).catch(console.error);
  }, []);

  const scheduleSave = useCallback((session: ChatSession) => {
    pendingSessionsRef.current[session.id] = session;
    const existingTimer = saveTimersRef.current[session.id];
    if (existingTimer) clearTimeout(existingTimer);
    saveTimersRef.current[session.id] = setTimeout(() => {
      delete saveTimersRef.current[session.id];
      if (pendingCreationPromisesRef.current[session.id]) return;
      flushPendingSessionSave(session.id);
    }, 300);
  }, [flushPendingSessionSave]);

  // Flush pending save on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      const pendingSessions = Object.values(pendingSessionsRef.current);
      pendingSessionsRef.current = {};
      Object.entries(saveTimersRef.current).forEach(([sessionId, timer]) => {
        clearTimeout(timer);
        delete saveTimersRef.current[sessionId];
      });
      for (const pending of pendingSessions) {
        // Use synchronous XHR for reliable save during unload
        try {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', `/api/chat/sessions/${encodeURIComponent(pending.id)}`, false);
          xhr.setRequestHeader('Content-Type', 'application/json');
          const token = localStorage.getItem('auth-token');
          if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
          xhr.send(JSON.stringify(pending));
        } catch { /* best effort */ }
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Helper: update active session in state + schedule save
  const updateActiveSession = useCallback((updater: (s: ChatSession) => ChatSession) => {
    setActiveSession(prev => {
      if (!prev) return prev;
      const updated = updater(prev);
      if (updated === prev) return prev;
      scheduleSave(updated);
      upsertSessionSummary(updated);
      return updated;
    });
  }, [scheduleSave, upsertSessionSummary]);

  const getCachedSessionSnapshot = useCallback((sessionId: string | null | undefined): ChatSession | null => {
    if (!sessionId) return null;
    const activeSnapshot = activeSessionRef.current?.id === sessionId && sessionLoadingId !== sessionId
      ? activeSessionRef.current
      : null;
    const cachedSnapshot = sessionCacheRef.current[sessionId] || null;
    if (activeSnapshot && cachedSnapshot) {
      if (
        cachedSnapshot.updatedAt > activeSnapshot.updatedAt
        || cachedSnapshot.messages.length > activeSnapshot.messages.length
      ) {
        return cachedSnapshot;
      }
      return activeSnapshot;
    }
    return activeSnapshot || cachedSnapshot;
  }, [sessionLoadingId]);

  const loadSessionSnapshot = useCallback(async (sessionId: string | null | undefined): Promise<ChatSession | null> => {
    const cached = getCachedSessionSnapshot(sessionId);
    if (cached) return cached;
    if (!sessionId) return null;
    const loaded = await apiLoadSession(sessionId);
    if (loaded) {
      cacheSessionSnapshot(loaded);
      return loaded;
    }
    if (activeSessionRef.current?.id === sessionId) {
      return activeSessionRef.current;
    }
    return null;
  }, [cacheSessionSnapshot, getCachedSessionSnapshot]);

  const updateSessionById = useCallback(async (
    sessionId: string | null | undefined,
    updater: (session: ChatSession) => ChatSession,
  ): Promise<ChatSession | null> => {
    if (!sessionId) return null;
    const base = await loadSessionSnapshot(sessionId);
    if (!base) return null;
    const updated = updater(base);
    if (updated === base) return updated;
    cacheSessionSnapshot(updated);
    scheduleSave(updated);
    upsertSessionSummary(updated);
    if (activeSessionRef.current?.id === sessionId) {
      setActiveSession((current) => {
        if (!current || current.id !== sessionId) return current;
        return updated;
      });
    }
    return updated;
  }, [cacheSessionSnapshot, loadSessionSnapshot, scheduleSave, upsertSessionSummary]);

  const ensureTargetSessionWorkspace = useCallback(async (
    sessionId: string,
    session: ChatSession,
  ): Promise<string> => {
    const existingWorkspace = resolveSessionWorkingDirectory(session, '');
    if (existingWorkspace) return existingWorkspace;

    try {
      const result = await apiEnsureChatWorkspace({
        sessionId,
        sourceWorkspace: workingDirectory || undefined,
        title: session.title,
        skills: skillSettingsRef.current,
        mcpServers: mcpSettingsRef.current,
      });
      if (!result.workspacePath) return '';
      await refreshChatSettings().catch(() => {});
      setWorkingDirectory(result.workspacePath);
      await updateSessionById(sessionId, (current) => {
        const previousWorkspace = String(current.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim();
        return {
          ...current,
          runtimeSessionId: previousWorkspace === result.workspacePath ? current.runtimeSessionId : undefined,
          sessionWorkbenchState: {
            ...(current.sessionWorkbenchState || {}),
            chatWorkspace: {
              ...(current.sessionWorkbenchState?.chatWorkspace || {}),
              workingDirectory: result.workspacePath,
              sourceWorkspace: result.sourceWorkspace || workingDirectory || current.sessionWorkbenchState?.chatWorkspace?.sourceWorkspace,
              autoCreated: result.created,
              gitBaselineReady: true,
              updatedAt: Date.now(),
            },
          },
        };
      });
      return result.workspacePath;
    } catch {
      return '';
    }
  }, [refreshChatSettings, setWorkingDirectory, updateSessionById, workingDirectory]);

  const handleSetEngine = useCallback((e: string) => {
    setEngineState(e);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-engine', e);
    }
    updateActiveSession(s => ({ ...s, engine: e }));
  }, [updateActiveSession]);

  const handleSetModel = useCallback((m: string) => {
    setModel(m);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-model', m);
    }
    updateActiveSession(s => ({ ...s, model: m }));
  }, [updateActiveSession]);

  const setSessionWorkbenchState = useCallback((state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => {
    updateActiveSession((session) => {
      const nextState = typeof state === 'function' ? state(session.sessionWorkbenchState) : state;
      const conversationMode = resolveConversationMode({ ...session, sessionWorkbenchState: nextState }, { runStatusById });
      const normalizedState = {
        ...(nextState || {}),
        conversationMode,
      };
      if (normalizedState === session.sessionWorkbenchState) return session;
      if (JSON.stringify(normalizedState || null) === JSON.stringify(session.sessionWorkbenchState || null)) return session;
      const previousWorkspace = String(session.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim();
      const nextWorkspace = String(normalizedState?.chatWorkspace?.workingDirectory || '').trim();
      return {
        ...session,
        runtimeSessionId: previousWorkspace !== nextWorkspace ? undefined : session.runtimeSessionId,
        conversationMode,
        sessionWorkbenchState: normalizedState,
      };
    });
  }, [runStatusById, updateActiveSession]);

  const updateSessionWorkbenchState = useCallback(async (
    sessionId: string,
    state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState),
  ): Promise<ChatSession | null> => {
    return updateSessionById(sessionId, (session) => {
      const nextState = typeof state === 'function' ? state(session.sessionWorkbenchState) : state;
      const conversationMode = resolveConversationMode({ ...session, sessionWorkbenchState: nextState }, { runStatusById });
      const normalizedState = {
        ...(nextState || {}),
        conversationMode,
      };
      if (JSON.stringify(normalizedState || null) === JSON.stringify(session.sessionWorkbenchState || null)) return session;
      const previousWorkspace = String(session.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '').trim();
      const nextWorkspace = String(normalizedState?.chatWorkspace?.workingDirectory || '').trim();
      return {
        ...session,
        runtimeSessionId: previousWorkspace !== nextWorkspace ? undefined : session.runtimeSessionId,
        conversationMode,
        sessionWorkbenchState: normalizedState,
      };
    });
  }, [runStatusById, updateSessionById]);

  const updateSessionCreationBinding = useCallback(async (
    sessionId: string,
    creationSession: ChatSession['creationSession'] | null
  ) => {
    const applyBinding = (session: ChatSession): ChatSession => {
      const nextSession = {
        ...session,
        updatedAt: Date.now(),
        creationSession: creationSession || undefined,
      };
      const conversationMode = resolveConversationMode(nextSession, { runStatusById });
      return {
        ...nextSession,
        conversationMode,
        sessionWorkbenchState: {
          ...(nextSession.sessionWorkbenchState || {}),
          conversationMode,
        },
      };
    };

    if (activeSessionRef.current?.id === sessionId) {
      updateActiveSession((session) => applyBinding(session));
      return;
    }

    const session = await apiLoadSession(sessionId);
    if (!session) return;
    const updated = applyBinding(session);
    await apiSaveSession(updated);
    setSessions((list) => list.map((item) => item.id === updated.id ? {
      ...item,
      title: updated.title,
      updatedAt: updated.updatedAt,
      messageCount: updated.messages.length,
      lastMessage: extractLastMessagePreview(updated.messages),
      agentBinding: updated.agentBinding,
      workflowBinding: updated.workflowBinding,
      creationSession: updated.creationSession,
      sessionWorkbenchState: updated.sessionWorkbenchState,
    } : item));
  }, [runStatusById, updateActiveSession]);

  const appendVisibleSessionTag = useCallback(async (sessionId: string, label: string) => {
    const appendMessage = (session: ChatSession): ChatSession => {
      const lastVisibleMessage = [...session.messages].reverse().find((message) => message.role === 'user');
      if (lastVisibleMessage?.content === label) return session;

      const timestamp = Date.now();
      return {
        ...session,
        updatedAt: timestamp,
        messages: [
          ...session.messages,
          {
            id: genId(),
            role: 'user',
            content: label,
            timestamp,
          },
        ],
      };
    };

    if (activeSessionRef.current?.id === sessionId) {
      updateActiveSession((session) => appendMessage(session));
      return;
    }

    const session = await apiLoadSession(sessionId);
    if (!session) return;
    const updated = appendMessage(session);
    if (updated === session) return;
    await apiSaveSession(updated);
    setSessions((list) => list.map((item) => item.id === updated.id ? {
      ...item,
      title: updated.title,
      updatedAt: updated.updatedAt,
      messageCount: updated.messages.length,
      lastMessage: extractLastMessagePreview(updated.messages),
      agentBinding: updated.agentBinding,
      workflowBinding: updated.workflowBinding,
      creationSession: updated.creationSession,
      sessionWorkbenchState: updated.sessionWorkbenchState,
    } : item));
  }, [updateActiveSession]);

  const appendSessionMessage = useCallback(async (
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>,
    options?: { runtimeSessionId?: string | null }
  ) => {
    const timestamp = message.timestamp || Date.now();
    const nextMessage: ChatMessage = {
      ...message,
      id: message.id || genId(),
      timestamp,
    };

    const applyMessage = (session: ChatSession): ChatSession => {
      const contentKey = (nextMessage.rawContent || nextMessage.content || '').trim();
      const exists = Boolean(contentKey) && session.messages.some((item) => {
        if (item.role !== nextMessage.role) return false;
        return (item.rawContent || item.content || '').trim() === contentKey;
      });
      const messages = exists ? session.messages : [...session.messages, nextMessage];
      const shouldUpdateRuntimeSessionId = Boolean(options && Object.prototype.hasOwnProperty.call(options, 'runtimeSessionId'));
      return {
        ...session,
        runtimeSessionId: shouldUpdateRuntimeSessionId
          ? (options?.runtimeSessionId || undefined)
          : session.runtimeSessionId,
        updatedAt: timestamp,
        messages,
      };
    };

    if (activeSessionRef.current?.id === sessionId) {
      updateActiveSession((session) => applyMessage(session));
      return;
    }

    const session = await apiLoadSession(sessionId);
    if (!session) return;
    const updated = applyMessage(session);
    await apiSaveSession(updated);
    setSessions((list) => list.map((item) => item.id === updated.id ? {
      ...item,
      title: updated.title,
      updatedAt: updated.updatedAt,
      messageCount: updated.messages.length,
      lastMessage: extractLastMessagePreview(updated.messages),
      agentBinding: updated.agentBinding,
      workflowBinding: updated.workflowBinding,
      creationSession: updated.creationSession,
      sessionWorkbenchState: updated.sessionWorkbenchState,
    } : item));
  }, [updateActiveSession]);

  const updateSessionMessage = useCallback(async (
    sessionId: string,
    messageId: string,
    patch: Partial<ChatMessage>
  ) => {
    const applyPatch = (session: ChatSession): ChatSession => {
      const messages = session.messages.map((message) => (
        message.id === messageId
          ? {
              ...message,
              ...patch,
              id: message.id,
              timestamp: patch.timestamp || message.timestamp,
            }
          : message
      ));
      return {
        ...session,
        updatedAt: Date.now(),
        messages,
      };
    };

    if (activeSessionRef.current?.id === sessionId) {
      updateActiveSession((session) => applyPatch(session));
      return;
    }

    const session = await apiLoadSession(sessionId);
    if (!session) return;
    const updated = applyPatch(session);
    await apiSaveSession(updated);
    setSessions((list) => list.map((item) => item.id === updated.id ? {
      ...item,
      title: updated.title,
      updatedAt: updated.updatedAt,
      messageCount: updated.messages.length,
      lastMessage: extractLastMessagePreview(updated.messages),
      agentBinding: updated.agentBinding,
      workflowBinding: updated.workflowBinding,
      creationSession: updated.creationSession,
      sessionWorkbenchState: updated.sessionWorkbenchState,
    } : item));
  }, [updateActiveSession]);

  const createSession = useCallback((options?: {
    title?: string;
    agentBinding?: {
      agentName: string;
      team?: 'blue' | 'red' | 'judge' | 'black-gold';
      roleType?: 'normal' | 'supervisor';
    };
    sessionWorkbenchState?: SessionWorkbenchState;
    messages?: Array<Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>>;
  }) => {
    const id = genId();
    const title = options?.title?.trim() || '新对话';
    const now = Date.now();
    const requestedCreationAssistantEnabled = options?.sessionWorkbenchState?.creationAssistantEnabled;
    const initialSessionWorkbenchState: SessionWorkbenchState = {
      ...(options?.sessionWorkbenchState || {}),
      creationAssistantEnabled: typeof requestedCreationAssistantEnabled === 'boolean'
        ? requestedCreationAssistantEnabled
        : creationAssistantDefaultEnabled,
    };
    const initialMessages: ChatMessage[] = (options?.messages || []).map((message, index) => ({
      ...message,
      id: message.id || genId(),
      timestamp: message.timestamp || now + index,
    }));
    const baseSession: ChatSession = {
      id, title, model, engine: engine || undefined, messages: initialMessages,
      conversationMode: initialSessionWorkbenchState.conversationMode,
      agentBinding: options?.agentBinding ? {
        agentName: options.agentBinding.agentName,
        team: options.agentBinding.team,
        roleType: options.agentBinding.roleType,
        createdAt: now,
        updatedAt: now,
      } : undefined,
      sessionWorkbenchState: initialSessionWorkbenchState,
      createdAt: now, updatedAt: now,
    };
    const conversationMode = resolveConversationMode(baseSession, { runStatusById });
    const creationAssistantEnabled = resolveCreationAssistantEnabled(baseSession);
    const session: ChatSession = {
      ...baseSession,
      conversationMode,
      sessionWorkbenchState: {
        ...(baseSession.sessionWorkbenchState || {}),
        creationAssistantEnabled,
        creationTag: typeof baseSession.sessionWorkbenchState?.creationTag === 'boolean'
          ? baseSession.sessionWorkbenchState.creationTag
          : creationAssistantEnabled,
        conversationMode,
      },
    };
    const summary: SessionSummary = {
      id, title, model,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      messageCount: initialMessages.length,
      lastMessage: extractLastMessagePreview(initialMessages),
      conversationMode: session.conversationMode,
      agentBinding: session.agentBinding,
      sessionWorkbenchState: session.sessionWorkbenchState,
    };
    setSessions(prev => [summary, ...prev]);
    sessionCacheRef.current[id] = session;
    setActiveSession(session);
    setActiveSessionId(id);
    const creationPromise = apiCreateSession(session);
    pendingCreationPromisesRef.current[id] = creationPromise;
    void creationPromise
      .catch(console.error)
      .finally(() => {
        delete pendingCreationPromisesRef.current[id];
        flushPendingSessionSave(id);
      });
    return id;
  }, [creationAssistantDefaultEnabled, flushPendingSessionSave, model, engine, runStatusById]);

  const deleteSession = useCallback((id: string) => {
    const sessionToDelete = sessions.find((session) => session.id === id)
      || (activeSessionRef.current?.id === id ? activeSessionRef.current : null);
    const wasActiveSession = activeSessionId === id;
    if (isRunningWorkflowConversation({
      conversationMode: sessionToDelete?.conversationMode,
      workflowBinding: sessionToDelete?.workflowBinding,
      runStatusById,
    })) {
      console.warn('[chat] blocked deletion of running workflow conversation', id);
      return;
    }
    if (activeSessionId === id) {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
        activeEventSourceRef.current = null;
      }
      activeChatIdRef.current = null;
      setLoading(false);
      setStreamingMessageId(null);
    }
    setSessions(prev => {
      const deletingSession = activeSessionId === id ? prev.find((session) => session.id === id) : null;
      const next = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        const nextId = resolveNextActiveSessionIdAfterDelete(next, deletingSession);
        setActiveSessionId(nextId);
        if (!nextId) setActiveSession(null);
      }
      return next;
    });
    clearSessionTracking(id);
    void apiTerminateSessionProcesses(id)
      .catch(console.error)
      .finally(() => {
        apiDeleteSession(id).catch(async (error) => {
          console.error(error);
          const [list, restoredSession] = await Promise.all([
            apiListSessions(),
            wasActiveSession ? apiLoadSession(id) : Promise.resolve(null),
          ]);
          setSessions(list);
          if (restoredSession) {
            sessionCacheRef.current[id] = restoredSession;
            setActiveSession(reparseSession(restoredSession));
            setActiveSessionId(id);
          }
        });
      });
  }, [activeSessionId, clearSessionTracking, runStatusById, sessions]);

  const deleteSessions = useCallback((ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
    if (uniqueIds.length === 0) return;
    const sessionById = new Map<string, SessionSummary | ChatSession>();
    sessions.forEach((session) => sessionById.set(session.id, session));
    if (activeSessionRef.current) sessionById.set(activeSessionRef.current.id, activeSessionRef.current);
    const deletableIds = uniqueIds.filter((id) => !isRunningWorkflowConversation({
      conversationMode: sessionById.get(id)?.conversationMode,
      workflowBinding: sessionById.get(id)?.workflowBinding,
      runStatusById,
    }));
    if (deletableIds.length === 0) {
      console.warn('[chat] blocked deletion of running workflow conversations', uniqueIds);
      return;
    }
    const deleting = new Set(deletableIds);
    const deletingActive = activeSessionId ? deleting.has(activeSessionId) : false;
    const deletedActiveSessionId = deletingActive ? activeSessionId : null;
    if (deletingActive) {
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
        activeEventSourceRef.current = null;
      }
      activeChatIdRef.current = null;
      setLoading(false);
      setStreamingMessageId(null);
    }
    setActiveStreamingSessionIds((prev) => removeSessionIds(prev, deleting));
    setRecentlyCompletedSessionIds((prev) => removeSessionIds(prev, deleting));
    setSessions(prev => {
      const deletingSession = deletingActive
        ? prev.find((session) => session.id === activeSessionId)
        : null;
      const next = prev.filter(s => !deleting.has(s.id));
      if (deletingActive) {
        const nextId = resolveNextActiveSessionIdAfterDelete(next, deletingSession);
        setActiveSessionId(nextId);
        if (!nextId) setActiveSession(null);
      }
      return next;
    });
    deletableIds.forEach((id) => clearSessionTracking(id));
    void apiTerminateSessionsProcesses(deletableIds)
      .catch(console.error)
      .finally(() => {
        apiBatchDeleteSessions(deletableIds).catch(async (error) => {
          console.error(error);
          await Promise.allSettled(deletableIds.map((id) => apiDeleteSession(id)));
          const [list, restoredSession] = await Promise.all([
            apiListSessions(),
            deletedActiveSessionId ? apiLoadSession(deletedActiveSessionId) : Promise.resolve(null),
          ]);
          setSessions(list);
          if (restoredSession) {
            sessionCacheRef.current[deletedActiveSessionId!] = restoredSession;
            setActiveSession(reparseSession(restoredSession));
            setActiveSessionId(deletedActiveSessionId);
          }
        });
      });
  }, [activeSessionId, clearSessionTracking, runStatusById, sessions]);

  const renameSession = useCallback((id: string, title: string) => {
    if (activeSession?.id === id) {
      updateActiveSession(s => ({ ...s, title, updatedAt: Date.now() }));
    } else {
      // Rename a non-active session: load, update, save
      apiLoadSession(id).then(s => {
        if (s) apiSaveSession({ ...s, title, updatedAt: Date.now() });
      });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, title, updatedAt: Date.now() } : s));
    }
  }, [activeSession, updateActiveSession]);

  // --- Action helpers ---
  const updateAction = useCallback((messageId: string, actionId: string, patch: Partial<ActionState>) => {
    updateActiveSession(s => ({
      ...s,
      updatedAt: Date.now(),
      messages: s.messages.map(m =>
        m.id === messageId
          ? { ...m, actions: m.actions?.map(a => a.id === actionId ? { ...a, ...patch } : a) }
          : m
      ),
    }));
  }, [updateActiveSession]);

  // Inject context into actions before execution (e.g., filter skill.list by enabled skills)
  const enrichAction = useCallback((action: ActionBlock): ActionBlock => {
    if (action.type === 'skill.list') {
      const enabledSkills = Object.entries(skillSettingsRef.current)
        .filter(([, v]) => v)
        .map(([k]) => k);
      return { ...action, params: { ...action.params, enabledSkills } };
    }
    return action;
  }, []);

  const runAction = useCallback(async (messageId: string, actionState: ActionState) => {
    updateAction(messageId, actionState.id, { status: 'executing' });
    try {
      const enriched = enrichAction(actionState.action);
      const { result, snapshot } = await executeAction({ ...actionState, action: enriched }.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      updateAction(messageId, actionState.id, { status: 'error', error: err.message });
    }
  }, [updateAction, enrichAction]);

  const autoExecuteSafeActions = useCallback(async (
    messageId: string,
    actions: ActionState[],
    targetSessionIdArg?: string,
    _retryCount?: number,
  ) => {
    const retryCount = _retryCount || 0;
    const targetSessionId = targetSessionIdArg || activeSessionRef.current?.id || activeSessionId || null;
    if (!targetSessionId) return;
    const applyToTargetSession = (updater: (session: ChatSession) => ChatSession) => updateSessionById(targetSessionId, updater);
    const getTargetSessionSnapshot = () => getCachedSessionSnapshot(targetSessionId);
    const updateTargetAction = (actionId: string, patch: Partial<ActionState>) => applyToTargetSession((session) => ({
      ...session,
      updatedAt: Date.now(),
      messages: session.messages.map((message) => (
        message.id === messageId
          ? { ...message, actions: message.actions?.map((action) => action.id === actionId ? { ...action, ...patch } : action) }
          : message
      )),
    }));
    const results: { type: string; data: any }[] = [];
    for (const a of actions) {
      if (isSafeAction(a.action)) {
        await updateTargetAction(a.id, { status: 'auto_executing' });
        try {
          const enriched = enrichAction(a.action);
          const { result } = await executeAction(enriched);
          await updateTargetAction(a.id, { status: 'success', result });
          results.push({ type: a.action.type, data: result });
        } catch (err: any) {
          await updateTargetAction(a.id, { status: 'error', error: err.message });
        }
      }
    }
    // Feed results back to AI for analysis via streaming
    if (results.length > 0) {
      const summary = results.map(r => {
        const json = JSON.stringify(r.data, null, 2);
        const truncated = json.length > 4000 ? json.slice(0, 4000) + '\n...(truncated)' : json;
        return `[${r.type} 结果]:\n${truncated}`;
      }).join('\n\n');
      const followUpPrompt = `以下是刚才自动执行的操作返回的数据，请根据这些数据用 \`\`\`card 代码块生成结构化的可视化分析卡片，并在卡片的 actions 中给出 2-3 个上下文相关的后续操作建议：\n\n${summary}`;

      const followUpMsgId = genId();
      const followUpEngine = effectiveEngine;
      const followUpMsg: ChatMessage = {
        id: followUpMsgId, role: 'assistant', content: '', rawContent: '', engine: followUpEngine, model: model || undefined, timestamp: Date.now(),
      };
      await applyToTargetSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, followUpMsg] }));
      setLoading(true);
      setStreamingMessageId(followUpMsgId);

      try {
        const runtimeSid = getTargetSessionSnapshot()?.runtimeSessionId;
        const frontendSid = targetSessionId;
        const targetSessionSnapshot = getTargetSessionSnapshot();
        let targetWorkingDirectory = resolveSessionWorkingDirectory(targetSessionSnapshot, '');
        if (!targetWorkingDirectory && targetSessionSnapshot) {
          targetWorkingDirectory = await ensureTargetSessionWorkspace(targetSessionId, targetSessionSnapshot);
        }
        const startRes = await apiFetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            message: followUpPrompt,
            model,
            engine: followUpEngine || undefined,
            runtimeSessionId: runtimeSid || undefined,
            frontendSessionId: frontendSid || undefined,
            assistantMessageId: followUpMsgId,
            skipUserMessage: true,
            mode: 'dashboard',
            workingDirectory: targetWorkingDirectory || undefined,
            mcpServers: mcpSettingsRef.current,
            creationAssistantEnabled: resolveCreationAssistantEnabled(targetSessionSnapshot),
          }),
        });
        const { chatId } = await startRes.json();
        if (!chatId) throw new Error('Failed to start stream');
        activeChatIdRef.current = chatId;
        attachedStreamingSessionIdRef.current = targetSessionId;
        markSessionStreaming(targetSessionId);

        await new Promise<void>((resolve, reject) => {
          let accumulated = '';
          let accumulatedRawStream = '';
          let reconnectAttempts = 0;
          const MAX_RECONNECTS = 3;
          let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;

        const connectSSE = () => {
          const es = createSafeEventSource(`/api/chat/stream?id=${chatId}`);
          activeEventSourceRef.current = es;
          let hasConnected = false;

          es.addEventListener('connected', () => {
            hasConnected = true;
          });

          es.addEventListener('delta', (e) => {
            if (!hasConnected) return;
              const content = String(parseSseJsonEventData(e.data).content || '');
              accumulated += content;
              accumulatedRawStream = appendStreamChunk(accumulatedRawStream, content);
              const row = storeChatStreamSseEventAsAgentMessage('delta', { content }, {
                chatId,
                sessionId: getTargetSessionSnapshot()?.runtimeSessionId,
                frontendSessionId: targetSessionId,
                streamScope: 'chat-follow-up',
              }, aiPrevious);
              aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
              const { text: parsedText } = parseActions(accumulated);
              const cleanText = normalizeAssistantDisplay(accumulated, true).visibleText || parsedText;
              void applyToTargetSession(s => ({
                ...s,
                messages: s.messages.map(m => m.id === followUpMsgId ? { ...m, content: cleanText, rawContent: accumulatedRawStream } : m),
              }));
            });

            es.addEventListener('done', (e) => {
              const data = parseSseJsonEventData(e.data);
              es.close();
              activeEventSourceRef.current = null;
              activeChatIdRef.current = null;
              attachedStreamingSessionIdRef.current = null;
              const nextRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
              if (nextRuntimeSessionId || hasOwnKey(data, 'runtimeSessionId') || hasOwnKey(data, 'sessionId')) {
                void applyToTargetSession(s => ({ ...s, runtimeSessionId: nextRuntimeSessionId }));
              }
              const fullRawContent = buildFinalRawContent(accumulatedRawStream, accumulated, String(data.result || ''));
              const row = storeChatStreamSseEventAsAgentMessage(data.isError ? 'error' : 'done', {
                ...data,
                content: fullRawContent || data.result || accumulated,
                isError: data.isError,
              }, {
                chatId,
                sessionId: nextRuntimeSessionId || getTargetSessionSnapshot()?.runtimeSessionId,
                frontendSessionId: targetSessionId,
                streamScope: 'chat-follow-up',
              }, aiPrevious);
              aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
              const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(fullRawContent);
              const latestSidebarHint = resolveLatestHomeSidebarHint(
                sidebarHints,
                resolveCreationAssistantEnabled(getTargetSessionSnapshot()),
              );
              const newActionStates: ActionState[] = newActions.map(a => ({
                id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
              }));
              void applyToTargetSession(s => ({
                ...s, updatedAt: Date.now(),
                sessionWorkbenchState: latestSidebarHint ? {
                  ...(s.sessionWorkbenchState || {}),
                  homeSidebar: latestSidebarHint,
                } : s.sessionWorkbenchState,
                messages: s.messages.map(m => m.id === followUpMsgId ? {
                  ...m, content: cleanText,
                  rawContent: fullRawContent !== cleanText ? fullRawContent : undefined,
                  actions: newActionStates.length > 0 ? newActionStates : undefined,
                  cards: newCards.length > 0 ? newCards : undefined,
                } : m),
              }));

              // Handle loading state and recursive actions
              const finishLoading = () => {
                setLoading(false);
                markSessionRecentlyCompleted(targetSessionId);
                unmarkSessionStreaming(targetSessionId);
                setStreamingMessageId(null);
              };

              if (newActionStates.length > 0) {
                autoExecuteSafeActions(followUpMsgId, newActionStates, targetSessionId, retryCount).finally(finishLoading);
                resolve();
              } else {
                finishLoading();
                // If no cards and content is substantial, trigger a card-format retry
                if (newCards.length === 0 && cleanText.length > 200 && retryCount < 1) {
                  const retryPrompt = `你刚才的回复没有使用 \`\`\`card 代码块来展示结构化内容。请将上面的分析结果重新用 \`\`\`card 代码块格式输出为可视化卡片（不要用 \`\`\`json）。card 格式示例：{"header":{"icon":"图标","title":"标题","gradient":"from-blue-500 to-cyan-500"},"blocks":[...],"actions":[{"label":"按钮","prompt":"消息"}]}`;
                  void sendMessageRef.current?.(retryPrompt, { displayText: retryPrompt, targetSessionId });
                }
                resolve();
              }
            });

            es.addEventListener('error', () => {
              es.close();
              activeEventSourceRef.current = null;
              if (reconnectAttempts < MAX_RECONNECTS) {
                reconnectAttempts++;
                setTimeout(connectSSE, 1000 * reconnectAttempts);
              } else {
                // 尝试按 runtimeSessionId 恢复已缓存内容。
                const runtimeSid = getTargetSessionSnapshot()?.runtimeSessionId;
                if (runtimeSid) {
                  fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(runtimeSid)}`)
                    .then(r => r.json())
                    .then(recData => {
                      if (recData.content) {
                        const row = storeChatStreamSseEventAsAgentMessage('done', {
                          ...recData,
                          content: recData.content,
                        }, {
                          chatId,
                          sessionId: runtimeSid,
                          frontendSessionId: targetSessionId,
                          streamScope: 'chat-follow-up',
                        }, aiPrevious);
                        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
                        const { text: cleanText, cards: newCards, sidebarHints } = parseActions(recData.content);
                        const latestSidebarHint = resolveLatestHomeSidebarHint(
                          sidebarHints,
                          resolveCreationAssistantEnabled(getTargetSessionSnapshot()),
                        );
                        void applyToTargetSession(s => ({
                          ...s,
                          sessionWorkbenchState: latestSidebarHint ? {
                            ...(s.sessionWorkbenchState || {}),
                            homeSidebar: latestSidebarHint,
                          } : s.sessionWorkbenchState,
                          messages: s.messages.map(m => m.id === followUpMsgId ? {
                            ...m,
                            content: cleanText,
                            rawContent: recData.content !== cleanText ? recData.content : m.rawContent,
                            cards: newCards,
                          } : m),
                        }));
                      }
                    })
                    .catch(() => {});
                }
                activeChatIdRef.current = null;
                attachedStreamingSessionIdRef.current = null;
                reject(new Error('Stream error'));
              }
            });
          };

          connectSSE();
        });
      } catch { /* follow-up failed silently */ }
      setLoading(false);
      unmarkSessionStreaming(targetSessionId);
      setStreamingMessageId(null);
    }
  }, [activeSessionId, effectiveEngine, enrichAction, ensureTargetSessionWorkspace, getCachedSessionSnapshot, markSessionRecentlyCompleted, markSessionStreaming, model, updateAction, updateSessionById, workingDirectory]);

  const interruptCurrentStream = useCallback(() => {
    const activeChatId = activeChatIdRef.current;
    const targetSessionId = attachedStreamingSessionIdRef.current || activeSessionRef.current?.id || activeSessionId;
    detachCurrentStream();
    if (activeChatId) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(activeChatId)}&preserveSession=1`, { method: 'DELETE' }).catch(() => {});
    }
    unmarkSessionStreaming(targetSessionId);
  }, [activeSessionId, detachCurrentStream, unmarkSessionStreaming]);

  const compactActiveSession = useCallback(async () => {
    if (compactInFlightRef.current) {
      throw new Error('上下文压缩正在进行中');
    }

    const targetSession = activeSessionRef.current;
    const targetSessionId = targetSession?.id;
    if (!targetSessionId) {
      throw new Error('请先打开一个对话');
    }
    if ((targetSession.messages || []).length === 0) {
      throw new Error('当前对话还没有可压缩的上下文');
    }

    compactInFlightRef.current = true;
    if (activeEventSourceRef.current || activeChatIdRef.current) {
      interruptCurrentStream();
    }

    const pendingMessageId = genId();
    const startedAt = Date.now();
    const resolvedEngine = engineRef.current || targetSession.engine || globalEngineRef.current || '';
    const resolvedModel = modelRef.current || targetSession.model || '';

    const applyToTargetSession = async (updater: (session: ChatSession) => ChatSession) => {
      if (activeSessionRef.current?.id === targetSessionId) {
        updateActiveSession(updater);
        return;
      }
      const loaded = await apiLoadSession(targetSessionId);
      if (!loaded) return;
      const updated = updater(loaded);
      await apiSaveSession(updated);
      setSessions((list) => list.map((item) => item.id === updated.id ? {
        ...item,
        title: updated.title,
        updatedAt: updated.updatedAt,
        messageCount: updated.messages.length,
        lastMessage: extractLastMessagePreview(updated.messages),
        agentBinding: updated.agentBinding,
        workflowBinding: updated.workflowBinding,
        creationSession: updated.creationSession,
        sessionWorkbenchState: updated.sessionWorkbenchState,
      } : item));
    };

    updateActiveSession((session) => ({
      ...session,
      updatedAt: startedAt,
      messages: [
        ...session.messages,
        {
          id: pendingMessageId,
          role: 'assistant',
          content: '',
          rawContent: '',
          engine: resolvedEngine || undefined,
          model: resolvedModel || undefined,
          timestamp: startedAt,
        },
      ],
    }));
    setLoading(true);
    markSessionStreaming(targetSessionId);
    setStreamingMessageId(pendingMessageId);

    try {
      let targetWorkingDirectory = resolveSessionWorkingDirectory(targetSession, '');
      if (!targetWorkingDirectory) {
        targetWorkingDirectory = await ensureTargetSessionWorkspace(targetSessionId, targetSession);
      }
      const response = await fetch('/api/chat/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          frontendSessionId: targetSessionId,
            runtimeSessionId: targetSession.runtimeSessionId || targetSession.workflowBinding?.supervisorSessionId || undefined,
          model: resolvedModel,
          engine: resolvedEngine || undefined,
          workingDirectory: targetWorkingDirectory || undefined,
          skills: skillSettingsRef.current,
          mcpServers: mcpSettingsRef.current,
          creationAssistantEnabled: resolveCreationAssistantEnabled(targetSession),
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${response.status}`);
      }
      const nextRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
      if (!nextRuntimeSessionId) {
        throw new Error('上下文压缩未返回新的 session');
      }
      const completedAt = Date.now();
      const timeLabel = new Date(completedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const tagLabel = `上下文压缩 · ${timeLabel} 已刷新 session 上下文容量`;
      await applyToTargetSession((session) => ({
        ...session,
        runtimeSessionId: nextRuntimeSessionId,
        workflowBinding: session.workflowBinding?.supervisorAgent ? {
          ...session.workflowBinding,
          supervisorSessionId: nextRuntimeSessionId,
          updatedAt: completedAt,
        } : session.workflowBinding,
        engine: typeof data?.engine === 'string' && data.engine ? data.engine : (resolvedEngine || session.engine),
        model: typeof data?.model === 'string' && data.model ? data.model : (resolvedModel || session.model),
        updatedAt: completedAt,
        messages: [
          ...session.messages.filter((message) => message.id !== pendingMessageId),
          {
            id: genId(),
            role: 'user',
            content: tagLabel,
            timestamp: completedAt,
          },
        ],
      }));
    } catch (error: any) {
      const message = error?.message || '上下文压缩失败';
      await applyToTargetSession((session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: session.messages.map((item) => item.id === pendingMessageId
          ? {
              ...item,
              role: 'error' as const,
              content: `上下文压缩失败：${message}`,
              rawContent: undefined,
            }
          : item),
      }));
      throw error;
    } finally {
      compactInFlightRef.current = false;
      setLoading(false);
      unmarkSessionStreaming(targetSessionId);
      setStreamingMessageId(null);
    }
  }, [ensureTargetSessionWorkspace, interruptCurrentStream, markSessionStreaming, unmarkSessionStreaming, updateActiveSession, workingDirectory]);

  // --- Send message (streaming) ---
  const sendMessage = useCallback(async (text: string, options?: { displayText?: string; targetSessionId?: string }) => {
    const currentModel = modelRef.current || '';
    const currentEngineOverride = engineRef.current || '';
    const resolvedEngine = currentEngineOverride || globalEngineRef.current || '';
    const recordSendFailure = async (sessionId: string, reason: string) => {
      const attemptedText = String(options?.displayText ?? text ?? '').trim();
      await updateSessionById(sessionId, (session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: [
          ...session.messages,
          ...(attemptedText ? [{
            id: genId(),
            role: 'user' as const,
            content: attemptedText,
            timestamp: Date.now(),
          }] : []),
          {
            id: genId(),
            role: 'error' as const,
            content: `无法发送：${reason}`,
            engine: resolvedEngine || undefined,
            model: currentModel || undefined,
            timestamp: Date.now(),
          },
        ],
      }));
    };

    if (!currentModel || !resolvedEngine) {
      const targetSessionId = options?.targetSessionId || activeSessionId || createSession({ title: '新对话' });
      const reason = !resolvedEngine
        ? '尚未选择可用的引擎，请先完成引擎配置后重试。'
        : '尚未选择模型，请先选择可用模型后重试。';
      await recordSendFailure(targetSessionId, reason);
      return;
    }

    if (activeEventSourceRef.current || activeChatIdRef.current) {
      interruptCurrentStream();
    }

    let sid = options?.targetSessionId || activeSessionId;
    if (!sid) { sid = createSession(); }
    const targetSessionId = sid;
    const previousSession = await loadSessionSnapshot(targetSessionId);
    if (!previousSession) {
      await recordSendFailure(targetSessionId, '无法加载当前对话，请重新打开对话后重试。');
      return;
    }
    const creationAssistantEnabled = resolveCreationAssistantEnabled(previousSession);
    const applyToTargetSession = (updater: (session: ChatSession) => ChatSession) => updateSessionById(targetSessionId, updater);
    const getTargetSessionSnapshot = () => getCachedSessionSnapshot(targetSessionId);
    let targetWorkingDirectory = resolveSessionWorkingDirectory(previousSession, '');
    if (!targetWorkingDirectory) {
      targetWorkingDirectory = await ensureTargetSessionWorkspace(targetSessionId, previousSession);
    }

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: options?.displayText ?? text, timestamp: Date.now() };
    await applyToTargetSession(s => ({
      ...s,
      updatedAt: Date.now(),
      title: s.messages.length === 0 ? userMsg.content.slice(0, 30) : s.title,
      messages: [...s.messages, userMsg],
    }));

    const assistantMsgId = genId();
    const agentBinding = previousSession?.agentBinding;
    const previousEffectiveEngine = previousSession?.engine || globalEngineRef.current || '';
    const shouldStartFresh = !!previousSession?.runtimeSessionId
      && resolvedEngine !== previousEffectiveEngine;
    const assistantMsg: ChatMessage = { id: assistantMsgId, role: 'assistant', content: '', rawContent: '', engine: resolvedEngine, model: currentModel || undefined, timestamp: Date.now() };
    await applyToTargetSession(s => ({
      ...s,
      engine: resolvedEngine || undefined,
      model: currentModel,
      runtimeSessionId: shouldStartFresh ? undefined : s.runtimeSessionId,
    }));
    await applyToTargetSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, assistantMsg] }));
    setLoading(true);
    markSessionStreaming(targetSessionId);
    setStreamingMessageId(assistantMsgId);

    try {
      if (agentBinding?.agentName) {
        const result = await fetch(`/api/agents/${encodeURIComponent(agentBinding.agentName)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            message: text,
            mode: 'standalone-chat',
            runtimeSessionId: shouldStartFresh ? undefined : (previousSession.runtimeSessionId || undefined),
            frontendSessionId: targetSessionId,
            workingDirectory: targetWorkingDirectory || undefined,
            requestedMcpServers: mcpSettingsRef.current,
          }),
        }).then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || 'Agent 对话失败');
          }
          return data as {
            output: string;
            runtimeSessionId?: string | null;
            sessionId?: string | null;
            engine?: string;
            model?: string;
            isError?: boolean;
            error?: string | null;
          };
        });
        const resultRuntimeSessionId = result.runtimeSessionId ?? result.sessionId;

        await applyToTargetSession((s) => ({
          ...s,
          runtimeSessionId: resultRuntimeSessionId ?? undefined,
          updatedAt: Date.now(),
          messages: s.messages.map((m) => m.id === assistantMsgId
            ? {
                ...m,
                role: result.isError ? 'error' as const : 'assistant' as const,
                content: result.isError ? (result.error || result.output || 'Agent 对话失败') : (result.output || ''),
                engine: result.engine || m.engine,
                model: result.model || m.model,
              }
            : m),
        }));
        setLoading(false);
        markSessionRecentlyCompleted(targetSessionId);
        unmarkSessionStreaming(targetSessionId);
        setStreamingMessageId(null);
        return;
      }

      const workflowBinding = previousSession?.workflowBinding;
      if (workflowBinding?.supervisorAgent) {
        const result = await fetch(`/api/agents/${encodeURIComponent(workflowBinding.supervisorAgent)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            message: text,
            mode: 'workflow-chat',
            runtimeSessionId: shouldStartFresh ? undefined : (previousSession.runtimeSessionId || workflowBinding.supervisorSessionId || undefined),
            frontendSessionId: targetSessionId,
            workingDirectory: targetWorkingDirectory || undefined,
            workflowContext: {
              configFile: workflowBinding.configFile,
              runId: workflowBinding.runId,
              supervisorAgent: workflowBinding.supervisorAgent,
              supervisorSessionId: workflowBinding.supervisorSessionId || null,
            },
            requestedMcpServers: mcpSettingsRef.current,
          }),
        }).then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || 'Supervisor 对话失败');
          }
          return data as {
            output: string;
            runtimeSessionId?: string | null;
            sessionId?: string | null;
            engine?: string;
            model?: string;
            isError?: boolean;
            error?: string | null;
            specCodingRevision?: {
              applied: boolean;
              summary: string;
            } | null;
          };
        });
        const resultRuntimeSessionId = result.runtimeSessionId ?? result.sessionId;

        const responseContent = result.specCodingRevision?.applied
          ? `${result.output || result.error || '无输出'}\n\n---\n已由 Supervisor 刷新 Spec：${result.specCodingRevision.summary}`
          : (result.output || result.error || '无输出');
        const parsed = result.isError ? { text: responseContent, cards: [] as any[], sidebarHints: [] as HomeSidebarHint[] } : parseActions(responseContent);
        const latestSidebarHint = resolveLatestHomeSidebarHint(
          parsed.sidebarHints,
          creationAssistantEnabled,
        );

        await applyToTargetSession((s) => ({
          ...s,
          runtimeSessionId: resultRuntimeSessionId ?? undefined,
          workflowBinding: s.workflowBinding ? {
            ...s.workflowBinding,
            supervisorSessionId: resultRuntimeSessionId ?? null,
            updatedAt: Date.now(),
          } : s.workflowBinding,
          sessionWorkbenchState: latestSidebarHint ? {
            ...(s.sessionWorkbenchState || {}),
            homeSidebar: latestSidebarHint,
          } : s.sessionWorkbenchState,
          updatedAt: Date.now(),
                messages: s.messages.map((m) => m.id === assistantMsgId
                  ? {
                      ...m,
                      role: result.isError ? 'error' as const : 'assistant' as const,
                      content: parsed.text,
                      rawContent: responseContent !== parsed.text ? responseContent : m.rawContent,
                      cards: parsed.cards.length > 0 ? parsed.cards : undefined,
                      engine: result.engine || m.engine,
                      model: result.model || m.model,
              }
            : m),
        }));
        setLoading(false);
        markSessionRecentlyCompleted(targetSessionId);
        unmarkSessionStreaming(targetSessionId);
        setStreamingMessageId(null);
        return;
      }

      const runtimeSid = shouldStartFresh ? undefined : previousSession.runtimeSessionId;
      const frontendSid = targetSessionId;
      const startRes = await apiFetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          message: text,
          displayMessage: options?.displayText ?? text,
          model: currentModel,
          engine: resolvedEngine || undefined,
          runtimeSessionId: runtimeSid || undefined,
          frontendSessionId: frontendSid || undefined,
          userMessageId: userMsg.id,
          assistantMessageId: assistantMsgId,
          mode: 'dashboard',
          workingDirectory: targetWorkingDirectory || undefined,
          mcpServers: mcpSettingsRef.current,
          creationAssistantEnabled,
        }),
      });
      const startData = await startRes.json().catch(() => ({}));
      if (!startRes.ok || startData.error) {
        const startError = String(startData?.error || `HTTP ${startRes.status}`);
        await applyToTargetSession(s => ({
          ...s, updatedAt: Date.now(),
          messages: s.messages.map(m => m.id === assistantMsgId
            ? appendRequestFailureNotice(m, startError)
            : m),
        }));
        setLoading(false);
        unmarkSessionStreaming(targetSessionId);
        setStreamingMessageId(null);
        return;
      }

      const chatId = typeof startData?.chatId === 'string' ? startData.chatId.trim() : '';
      if (!chatId) {
        throw new Error('启动流式会话失败：服务器未返回会话 ID');
      }
      activeChatIdRef.current = chatId;
      attachedStreamingSessionIdRef.current = targetSessionId;
      await new Promise<void>((resolve, reject) => {
        let accumulated = '';
        let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;
        let reconnectAttempts = 0;
        const MAX_RECONNECTS = 3;
        const INACTIVITY_TIMEOUT = 1_200_000; // 20 minutes without any data
        let inactivityTimer: ReturnType<typeof setTimeout> | null = null;

        const resetInactivityTimer = () => {
          if (inactivityTimer) clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => {
            if (activeEventSourceRef.current) {
              activeEventSourceRef.current.close();
              activeEventSourceRef.current = null;
            }
            activeChatIdRef.current = null;
            reject(new Error('响应超时，请重试'));
          }, INACTIVITY_TIMEOUT);
        };

        const connectSSE = () => {
          const es = createSafeEventSource(`/api/chat/stream?id=${chatId}`);
          activeEventSourceRef.current = es;
          resetInactivityTimer();
          let accumulatedRawStream = '';
          let hasConnected = false;

          es.addEventListener('connected', () => {
            resetInactivityTimer();
            hasConnected = true;
          });

          es.addEventListener('thinking', (e) => {
            if (!hasConnected) return;
            resetInactivityTimer();
            const content = String(parseSseJsonEventData(e.data).content || '');
            const row = storeChatStreamSseEventAsAgentMessage('thinking', { content }, {
              chatId,
              provider: resolvedEngine,
              model: currentModel,
              sessionId: getTargetSessionSnapshot()?.runtimeSessionId,
              frontendSessionId: targetSessionId,
              streamScope: 'chat-message',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          });

          es.addEventListener('session', (e) => {
            resetInactivityTimer();
            const data = parseSseJsonEventData(e.data);
            const runtimeSessionId = readRuntimeSessionIdFromPayload(data);
            if (!runtimeSessionId) return;
            void applyToTargetSession(s => ({
              ...s,
              runtimeSessionId,
              engine: resolvedEngine || s.engine,
              model: currentModel || s.model,
            }));
          });

          es.addEventListener('delta', (e) => {
            if (!hasConnected) return;
            resetInactivityTimer();
            const content = String(parseSseJsonEventData(e.data).content || '');
            accumulated += content;
            accumulatedRawStream = appendStreamChunk(accumulatedRawStream, content);
            const row = storeChatStreamSseEventAsAgentMessage('delta', { content }, {
              chatId,
              provider: resolvedEngine,
              model: currentModel,
              sessionId: getTargetSessionSnapshot()?.runtimeSessionId,
              frontendSessionId: targetSessionId,
              streamScope: 'chat-message',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            const { text: parsedText } = parseActions(accumulated);
            const cleanText = normalizeAssistantDisplay(accumulated, true).visibleText || parsedText;
            void applyToTargetSession(s => ({
              ...s,
              messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, content: cleanText, rawContent: accumulatedRawStream } : m),
            }));
          });

          es.addEventListener('done', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = parseSseJsonEventData(e.data);
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            attachedStreamingSessionIdRef.current = null;
            const nextRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
            if (nextRuntimeSessionId || hasOwnKey(data, 'runtimeSessionId') || hasOwnKey(data, 'sessionId')) {
              void applyToTargetSession(s => ({ ...s, runtimeSessionId: nextRuntimeSessionId }));
            }
            if (data.isError) {
              const failedRuntimeSessionId = nextRuntimeSessionId;
              const message = String(data.error || '请求失败，请稍后重试');
              const partialRawContent = buildFinalRawContent(accumulatedRawStream, accumulated, String(data.result || ''));
              const partialContent = normalizeAssistantDisplay(partialRawContent, false).visibleText
                || parseActions(partialRawContent).text
                || String(data.result || accumulated || '');
              const row = storeChatStreamSseEventAsAgentMessage('error', {
                ...data,
                content: partialRawContent || partialContent || message,
                isError: true,
              }, {
                chatId,
                provider: resolvedEngine,
                model: currentModel,
                sessionId: nextRuntimeSessionId || getTargetSessionSnapshot()?.runtimeSessionId,
                frontendSessionId: targetSessionId,
                streamScope: 'chat-message',
              }, aiPrevious);
              aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
              void applyToTargetSession(s => ({
                ...s,
                runtimeSessionId: failedRuntimeSessionId || s.runtimeSessionId,
                updatedAt: Date.now(),
                messages: s.messages.map(m => m.id === assistantMsgId
                  ? appendRequestFailureNotice(m, message, partialContent, partialRawContent)
                  : m),
              }));
              setLoading(false);
              markSessionRecentlyCompleted(targetSessionId);
              unmarkSessionStreaming(targetSessionId);
              setStreamingMessageId(null);
              resolve();
              return;
            }
            const fullRawContent = buildFinalRawContent(accumulatedRawStream, accumulated, String(data.result || ''));
            const row = storeChatStreamSseEventAsAgentMessage('done', {
              ...data,
              content: fullRawContent || data.result || accumulated,
            }, {
              chatId,
              provider: resolvedEngine,
              model: currentModel,
              sessionId: nextRuntimeSessionId || getTargetSessionSnapshot()?.runtimeSessionId,
              frontendSessionId: targetSessionId,
              streamScope: 'chat-message',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            const { text: cleanText, actions, cards, sidebarHints } = parseActions(fullRawContent);
            const latestSidebarHint = resolveLatestHomeSidebarHint(sidebarHints, creationAssistantEnabled);
            const actionStates: ActionState[] = actions.map(a => ({
              id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
            }));
            void applyToTargetSession(s => ({
              ...s, updatedAt: Date.now(),
              sessionWorkbenchState: latestSidebarHint ? {
                ...(s.sessionWorkbenchState || {}),
                homeSidebar: latestSidebarHint,
              } : s.sessionWorkbenchState,
              messages: s.messages.map(m => m.id === assistantMsgId ? {
                ...m, content: cleanText,
                rawContent: fullRawContent !== cleanText ? fullRawContent : undefined,
                actions: actionStates.length > 0 ? actionStates : undefined,
                cards: cards.length > 0 ? cards : undefined,
                costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
              } : m),
            }));
            if (actionStates.length > 0) {
              // autoExecuteSafeActions will handle its own loading state
              autoExecuteSafeActions(assistantMsgId, actionStates, targetSessionId);
              resolve();
            } else {
              setLoading(false);
              markSessionRecentlyCompleted(targetSessionId);
              unmarkSessionStreaming(targetSessionId);
              setStreamingMessageId(null);
              resolve();
            }
          });

          es.addEventListener('engine_error', (e) => {
            const data = parseSseJsonEventData(e.data);
            // A provider-throttle notice is progress, not a terminal answer.
            // Keep this SSE connection and the pending assistant row alive so
            // the server-side retry can complete in the same chat session.
            if (data?.recoverable) {
              resetInactivityTimer();
              return;
            }
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const message = String(data?.message || '执行失败，请稍后重试');
            const failedRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
            const row = storeChatStreamSseEventAsAgentMessage('error', {
              ...data,
              content: accumulatedRawStream || accumulated || message,
              isError: true,
            }, {
              chatId,
              provider: resolvedEngine,
              model: currentModel,
              sessionId: failedRuntimeSessionId || getTargetSessionSnapshot()?.runtimeSessionId,
              frontendSessionId: targetSessionId,
              streamScope: 'chat-message',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            void applyToTargetSession(s => ({
              ...s,
              runtimeSessionId: failedRuntimeSessionId || s.runtimeSessionId,
              updatedAt: Date.now(),
              messages: s.messages.map(m => m.id === assistantMsgId
                ? appendRequestFailureNotice(m, message, accumulated, accumulatedRawStream)
                : m),
            }));
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            attachedStreamingSessionIdRef.current = null;
            setLoading(false);
            markSessionRecentlyCompleted(targetSessionId);
            unmarkSessionStreaming(targetSessionId);
            setStreamingMessageId(null);
            resolve();
          });

          es.addEventListener('failed', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = parseSseJsonEventData(e.data);
            const message = String(data?.message || '执行失败，请稍后重试');
            const failedRuntimeSessionId = readRuntimeSessionIdFromPayload(data);
            const row = storeChatStreamSseEventAsAgentMessage('error', {
              ...data,
              content: accumulatedRawStream || accumulated || message,
              isError: true,
            }, {
              chatId,
              provider: resolvedEngine,
              model: currentModel,
              sessionId: failedRuntimeSessionId || getTargetSessionSnapshot()?.runtimeSessionId,
              frontendSessionId: targetSessionId,
              streamScope: 'chat-message',
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
            void applyToTargetSession(s => ({
              ...s,
              runtimeSessionId: failedRuntimeSessionId || s.runtimeSessionId,
              updatedAt: Date.now(),
              messages: s.messages.map(m => m.id === assistantMsgId
                ? appendRequestFailureNotice(m, message, accumulated, accumulatedRawStream)
                : m),
            }));
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            attachedStreamingSessionIdRef.current = null;
            setLoading(false);
            markSessionRecentlyCompleted(targetSessionId);
            unmarkSessionStreaming(targetSessionId);
            setStreamingMessageId(null);
            resolve();
          });

          es.addEventListener('error', () => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            es.close();
            activeEventSourceRef.current = null;
            if (reconnectAttempts < MAX_RECONNECTS) {
              reconnectAttempts++;
              setTimeout(connectSSE, 1000 * reconnectAttempts);
            } else {
              // 重连失败后尝试按 runtimeSessionId 恢复已缓存内容。
              const runtimeSid = getTargetSessionSnapshot()?.runtimeSessionId;
              if (runtimeSid) {
                fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(runtimeSid)}`)
                  .then(r => r.json())
                  .then(recData => {
                    if (recData.content) {
                      const row = storeChatStreamSseEventAsAgentMessage('done', {
                        ...recData,
                        content: recData.content,
                      }, {
                        chatId,
                        provider: resolvedEngine,
                        model: currentModel,
                        sessionId: runtimeSid,
                        frontendSessionId: targetSessionId,
                        streamScope: 'chat-message',
                      }, aiPrevious);
                      aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
                      const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(recData.content);
                      const latestSidebarHint = resolveLatestHomeSidebarHint(sidebarHints, creationAssistantEnabled);
                      const newActionStates: ActionState[] = newActions.map(a => ({
                        id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
                      }));
                      void applyToTargetSession(s => ({
                        ...s, updatedAt: Date.now(),
                        sessionWorkbenchState: latestSidebarHint ? {
                          ...(s.sessionWorkbenchState || {}),
                          homeSidebar: latestSidebarHint,
                        } : s.sessionWorkbenchState,
                        messages: s.messages.map(m => m.id === assistantMsgId ? {
                          ...m, content: cleanText,
                          rawContent: recData.content !== cleanText ? recData.content : m.rawContent,
                          actions: newActionStates.length > 0 ? newActionStates : m.actions,
                          cards: newCards.length > 0 ? newCards : m.cards,
                        } : m),
                      }));
                      if (newActionStates.length > 0) {
                        autoExecuteSafeActions(assistantMsgId, newActionStates, targetSessionId);
                        resolve();
                      } else {
                        setLoading(false);
                        markSessionRecentlyCompleted(targetSessionId);
                        unmarkSessionStreaming(targetSessionId);
                        setStreamingMessageId(null);
                        resolve();
                      }
                    } else {
                      void applyToTargetSession(s => ({
                        ...s,
                        updatedAt: Date.now(),
                        messages: s.messages.map(m => m.id === assistantMsgId
                          ? appendRequestFailureNotice(m, '流式连接中断，请重试')
                          : m),
                      }));
                      setLoading(false);
                      markSessionRecentlyCompleted(targetSessionId);
                      unmarkSessionStreaming(targetSessionId);
                      setStreamingMessageId(null);
                      resolve();
                    }
                  })
                  .catch(() => {
                    void applyToTargetSession(s => ({
                      ...s,
                      updatedAt: Date.now(),
                      messages: s.messages.map(m => m.id === assistantMsgId
                        ? appendRequestFailureNotice(m, '流式连接中断，请重试')
                        : m),
                    }));
                    setLoading(false);
                    markSessionRecentlyCompleted(targetSessionId);
                    unmarkSessionStreaming(targetSessionId);
                    setStreamingMessageId(null);
                    resolve();
                  });
              } else {
                void applyToTargetSession(s => ({
                  ...s,
                  updatedAt: Date.now(),
                  messages: s.messages.map(m => m.id === assistantMsgId
                    ? appendRequestFailureNotice(m, '流式连接中断，请重试')
                    : m),
                }));
                setLoading(false);
                markSessionRecentlyCompleted(targetSessionId);
                unmarkSessionStreaming(targetSessionId);
                setStreamingMessageId(null);
                resolve();
              }
            }
          });
        };

        connectSSE();
      });
    } catch (err: any) {
      // Preserve any partial output and always leave a visible terminal error.
      await applyToTargetSession(s => ({
        ...s, updatedAt: Date.now(),
        messages: s.messages.map(m => m.id === assistantMsgId
          ? appendRequestFailureNotice(m, err?.message || '请求失败')
          : m),
      }));
      setLoading(false);
      markSessionRecentlyCompleted(targetSessionId);
      unmarkSessionStreaming(targetSessionId);
      setStreamingMessageId(null);
    }
    // Note: setLoading(false) is called inside the Promise's done/error handlers
    // to properly handle autoExecuteSafeActions
  }, [activeSessionId, createSession, ensureTargetSessionWorkspace, loadSessionSnapshot, updateSessionById, getCachedSessionSnapshot, autoExecuteSafeActions, workingDirectory, interruptCurrentStream, markSessionRecentlyCompleted, markSessionStreaming, unmarkSessionStreaming]);
  sendMessageRef.current = sendMessage;
  const confirmAction = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState) return;
    await runAction(messageId, actionState);
  }, [activeSession, runAction]);

  const rejectAction = useCallback((messageId: string, actionId: string) => {
    updateAction(messageId, actionId, { status: 'error', error: '用户已拒绝' });
  }, [updateAction]);

  const undoActionById = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState || !actionState.snapshot) return;
    try {
      await undoAction(actionState);
      updateAction(messageId, actionId, { status: 'undone' });
    } catch (err: any) {
      updateAction(messageId, actionId, { error: `撤销失败: ${err.message}` });
    }
  }, [activeSession, updateAction]);

  const retryAction = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState) return;

    updateAction(messageId, actionState.id, { status: 'executing' });
    try {
      const { result, snapshot } = await executeAction(actionState.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      const errorMsg = err.message || '执行失败';
      updateAction(messageId, actionState.id, { status: 'error', error: errorMsg });
      // Feed error back to AI so it can self-correct
      const { type, params } = actionState.action;
      const errorPrompt = `刚才执行的操作失败了，请根据错误信息修正后重试：\n\n操作类型: ${type}\n参数: ${JSON.stringify(params)}\n错误: ${errorMsg}\n\n请分析错误原因并给出正确的操作。`;
      sendMessage(errorPrompt);
    }
  }, [activeSession, updateAction, sendMessage]);

  const reloadActionResult = useCallback(async (messageId: string, actionId: string) => {
    const msg = activeSession?.messages.find(m => m.id === messageId);
    const actionState = msg?.actions?.find(a => a.id === actionId);
    if (!actionState) return;

    updateAction(messageId, actionState.id, { status: 'executing', error: undefined });
    try {
      const { result, snapshot } = await executeAction(actionState.action);
      updateAction(messageId, actionState.id, { status: 'success', result, snapshot });
    } catch (err: any) {
      const errorMsg = err.message || '重新加载失败';
      updateAction(messageId, actionState.id, { status: 'error', error: errorMsg });
    }
  }, [activeSession, updateAction]);

  // --- Stop streaming ---
  const stopStreaming = useCallback(() => {
    interruptCurrentStream();
  }, [interruptCurrentStream]);

  // --- Delete message ---
  const deleteMessage = useCallback((messageId: string) => {
    if (loading) return;
    updateActiveSession(s => ({
      ...s, updatedAt: Date.now(),
      messages: s.messages.filter(m => m.id !== messageId),
    }));
  }, [loading, updateActiveSession]);

  // --- Retry from user message ---
  const retryFromMessage = useCallback((messageId: string) => {
    if (loading) return;
    const session = activeSessionRef.current;
    if (!session) return;
    const msgIndex = session.messages.findIndex(m => m.id === messageId);
    if (msgIndex < 0) return;
    const targetMsg = session.messages[msgIndex];
    if (targetMsg.role !== 'user') return;
    // Truncate everything after this user message
    updateActiveSession(s => ({
      ...s, updatedAt: Date.now(),
      messages: s.messages.slice(0, msgIndex),
    }));
    // Re-send the same text
    sendMessage(targetMsg.content);
  }, [loading, updateActiveSession, sendMessage]);

  // --- Continue from timeout ---
  const continueFromMessage = useCallback(async (messageId: string) => {
    const session = activeSessionRef.current;
    if (!session) return;
    const msg = session.messages.find(m => m.id === messageId);
    if (!msg || msg.role !== 'error') return;

    // 如果引擎或模型已变更，之前的 runtimeSessionId 不再可复用。
    const runtimeSid = session.runtimeSessionId;
    const sessionEngine = session.engine || globalEngineRef.current || '';
    const sessionModel = session.model || '';
    if (!runtimeSid || (engineRef.current || globalEngineRef.current || '') !== sessionEngine || (modelRef.current || '') !== sessionModel) return;

    setLoading(true);
    try {
      // Try to recover content from the backend
      const recRes = await fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(runtimeSid)}`);
      const recData = await recRes.json();

      if (recData.content) {
        const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(recData.content);
        const latestSidebarHint = resolveLatestHomeSidebarHint(
          sidebarHints,
          resolveCreationAssistantEnabled(session),
        );
        const newActionStates: ActionState[] = newActions.map(a => ({
          id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
        }));

        // Update the error message with recovered content
        updateActiveSession(s => ({
          ...s, updatedAt: Date.now(),
          sessionWorkbenchState: latestSidebarHint ? {
            ...(s.sessionWorkbenchState || {}),
            homeSidebar: latestSidebarHint,
          } : s.sessionWorkbenchState,
          messages: s.messages.map(m => m.id === messageId ? {
            ...m,
            role: 'assistant' as const,
            content: cleanText,
            rawContent: recData.content !== cleanText ? recData.content : m.rawContent,
            actions: newActionStates.length > 0 ? newActionStates : undefined,
            cards: newCards.length > 0 ? newCards : undefined,
          } : m),
        }));

        if (newActionStates.length > 0) {
          autoExecuteSafeActions(messageId, newActionStates);
        }
      } else {
        // No content recovered - could be that the process was killed
        // Try to check if there's an active stream
        const activeRes = await fetch(`/api/chat/stream/active?frontendSessionId=${encodeURIComponent(session.id)}`);
        const activeData = await activeRes.json();

        if (activeData.active && activeData.chatId) {
          // There's still an active stream - reconnect to it
          // This shouldn't normally happen for timeouts, but handle it anyway
          updateActiveSession(s => ({
            ...s, updatedAt: Date.now(),
            messages: s.messages.map(m => m.id === messageId ? {
              ...m,
              role: 'assistant' as const,
              content: '[重新连接中...]',
            } : m),
          }));
          // The reconnection logic would be handled by the SSE connection below
        } else {
          await sendMessageRef.current?.('继续', { targetSessionId: session.id });
        }
      }
    } catch (err) {
      console.error('Continue from timeout failed:', err);
      await sendMessageRef.current?.('继续', { targetSessionId: session.id });
    } finally {
      setLoading(false);
    }
  }, [updateActiveSession, autoExecuteSafeActions]);

  return (
    <DashboardChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      sessions, sessionsLoading, activeSessionId, activeSession,
      createSession, deleteSession, deleteSessions, renameSession, setActiveSessionId,
      sendMessage, compactActiveSession, stopStreaming, deleteMessage, retryFromMessage, continueFromMessage,
      loading, activeStreamingSessionIds, recentlyCompletedSessionIds, sessionLoadingId, streamingMessageId, setStreamingMessageId,
      markSessionStreaming, unmarkSessionStreaming, model, setModel: handleSetModel,
      creationAssistantDefaultEnabled, setCreationAssistantDefaultEnabled,
      engine, effectiveEngine, isModelSelectionReady, setEngine: handleSetEngine,
      confirmAction, rejectAction, undoActionById, retryAction, reloadActionResult,
      skillSettings, discoveredSkills, toggleSkill, setSkillsEnabled,
      mcpSettings, discoveredMcpServers, toggleMcpServer, setMcpServersEnabled,
      capabilitySkills, setCapabilitySkills,
      workingDirectory, setWorkingDirectory,
      setSessionWorkbenchState,
      updateSessionWorkbenchState,
      updateSessionCreationBinding,
      appendVisibleSessionTag,
      appendSessionMessage,
      updateSessionMessage,
    }}>
      {children}
    </DashboardChatContext.Provider>
  );
}

export const useChat = () => useContext(DashboardChatContext);
