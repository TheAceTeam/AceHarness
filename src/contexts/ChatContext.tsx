'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { ActionBlock, ActionState, ActionStatus, executeAction, undoAction, isSafeAction, parseActions } from '@/lib/chat-actions';
import type { HomeSidebarHint, SessionWorkbenchState } from '@/lib/home-sidebar-state';

// --- Types ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  actions?: ActionState[];
  cards?: any[];
  engine?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  backendSessionId?: string;
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
    team?: 'blue' | 'red' | 'judge' | 'black-gold' | 'yellow';
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

interface DashboardChatContextType {
  isOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  sessions: SessionSummary[];
  activeSessionId: string | null;
  activeSession: ChatSession | null;
  createSession: (options?: {
    title?: string;
    agentBinding?: {
      agentName: string;
      team?: 'blue' | 'red' | 'judge' | 'black-gold' | 'yellow';
      roleType?: 'normal' | 'supervisor';
    };
  }) => string;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setActiveSessionId: (id: string) => void;
  sendMessage: (text: string, options?: { displayText?: string }) => Promise<void>;
  stopStreaming: () => void;
  deleteMessage: (messageId: string) => void;
  retryFromMessage: (messageId: string) => void;
  continueFromMessage: (messageId: string) => Promise<void>;
  loading: boolean;
  streamingMessageId: string | null;
  model: string;
  setModel: (m: string) => void;
  engine: string;
  effectiveEngine: string;
  setEngine: (e: string) => void;
  confirmAction: (messageId: string, actionId: string) => Promise<void>;
  rejectAction: (messageId: string, actionId: string) => void;
  undoActionById: (messageId: string, actionId: string) => Promise<void>;
  retryAction: (messageId: string, actionId: string) => Promise<void>;
  skillSettings: Record<string, boolean>;
  discoveredSkills: { name: string; label: string; description: string; source?: string; tags?: string[] }[];
  toggleSkill: (skill: string) => void;
  workingDirectory: string;
  setWorkingDirectory: (dir: string) => void;
  setSessionWorkbenchState: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
  appendVisibleSessionTag: (sessionId: string, label: string) => Promise<void>;
  appendSessionMessage: (
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>,
    options?: { backendSessionId?: string }
  ) => Promise<void>;
}

const DashboardChatContext = createContext<DashboardChatContextType>({
  isOpen: false, openChat: () => {}, closeChat: () => {}, toggleChat: () => {},
  sessions: [], activeSessionId: null, activeSession: null,
  createSession: () => '', deleteSession: () => {}, renameSession: () => {},
  setActiveSessionId: () => {},
  sendMessage: async () => {}, stopStreaming: () => {},
  deleteMessage: () => {}, retryFromMessage: () => {}, continueFromMessage: async () => {},
  loading: false, streamingMessageId: null,
  model: '', setModel: () => {},
  engine: '', effectiveEngine: '', setEngine: () => {},
  confirmAction: async () => {}, rejectAction: () => {},
  undoActionById: async () => {}, retryAction: async () => {},
  skillSettings: {}, discoveredSkills: [], toggleSkill: () => {},
  workingDirectory: '', setWorkingDirectory: () => {},
  setSessionWorkbenchState: () => {},
  appendVisibleSessionTag: async () => {},
  appendSessionMessage: async () => {},
});

const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ACTIVE_SESSION_STORAGE_KEY = 'aceharness:chat:active-session-id';

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
    body: JSON.stringify(session),
  });
}

async function apiLoadSession(id: string): Promise<ChatSession | null> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.session || null;
}

async function apiSaveSession(session: ChatSession): Promise<void> {
  await fetch(`/api/chat/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
    body: JSON.stringify(session),
  });
}

async function apiDeleteSession(id: string): Promise<void> {
  await fetch(`/api/chat/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
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
  // Legacy modal state
  const [isOpen, setIsOpen] = useState(false);
  const openChat = useCallback(() => setIsOpen(true), []);
  const closeChat = useCallback(() => setIsOpen(false), []);
  const toggleChat = useCallback(() => setIsOpen(prev => !prev), []);

  // Dashboard chat state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [model, setModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chat-model') || '';
    }
    return '';
  });

  // Per-chat engine override (empty = use global)
  const [engine, setEngineState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('chat-engine') || '';
    }
    return '';
  });
  // Resolved global engine for when per-chat engine is empty
  const [globalEngine, setGlobalEngine] = useState('');
  const effectiveEngine = engine || globalEngine;

  const refreshGlobalEngineConfig = useCallback(() => {
    fetch('/api/engine').then(r => r.json()).then(data => {
      if (data.engine) setGlobalEngine(data.engine);
      const savedModel = typeof window !== 'undefined' ? localStorage.getItem('chat-model') : null;
      if (!savedModel && data.defaultModel) setModel(data.defaultModel);
    }).catch(() => {});
  }, []);

  const handleSetEngine = useCallback((e: string) => {
    setEngineState(e);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-engine', e);
    }
    updateActiveSession(s => ({ ...s, engine: e }));
  }, []);

  const handleSetModel = useCallback((m: string) => {
    setModel(m);
    if (typeof window !== 'undefined') {
      localStorage.setItem('chat-model', m);
    }
    updateActiveSession(s => ({ ...s, model: m }));
  }, []);

  // Load global engine config and default model on mount, and keep it in sync with engine settings page
  useEffect(() => {
    refreshGlobalEngineConfig();
    const onEngineUpdated = () => refreshGlobalEngineConfig();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') refreshGlobalEngineConfig();
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [refreshGlobalEngineConfig]);

  const [skillSettings, setSkillSettings] = useState<Record<string, boolean>>({});
  const [discoveredSkills, setDiscoveredSkills] = useState<{ name: string; label: string; description: string; source?: string; tags?: string[] }[]>([]);
  const [workingDirectory, setWorkingDirectoryState] = useState('');

  // Load skill settings on mount
  useEffect(() => {
    fetch('/api/chat/settings').then(r => r.json()).then(data => {
      if (data.skills) setSkillSettings(data.skills);
      if (data.discoveredSkills) setDiscoveredSkills(data.discoveredSkills);
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
  }, [getWorkingDirStorageKey]);

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

  const setWorkingDirectory = useCallback((dir: string) => {
    setWorkingDirectoryState(dir);
    if (typeof window !== 'undefined') {
      localStorage.setItem(getWorkingDirStorageKey(), dir || '');
    }
  }, [getWorkingDirStorageKey]);

  // Debounced save ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSessionRef = useRef<ChatSession | null>(null);
  const activeEventSourceRef = useRef<EventSource | null>(null);
  const activeChatIdRef = useRef<string | null>(null);
  const skillSettingsRef = useRef(skillSettings);
  const modelRef = useRef(model);
  const engineRef = useRef(engine);
  const globalEngineRef = useRef(globalEngine);
  const sendMessageRef = useRef<((text: string, options?: { displayText?: string }) => Promise<void>) | null>(null);
  activeSessionRef.current = activeSession;
  skillSettingsRef.current = skillSettings;
  modelRef.current = model;
  engineRef.current = engine;
  globalEngineRef.current = globalEngine;

  // Load session list on mount
  useEffect(() => {
    apiListSessions().then(list => {
      setSessions(list);
      if (list.length === 0) return;
      const savedActiveSessionId = typeof window !== 'undefined'
        ? window.localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)
        : null;
      const nextActiveSession = savedActiveSessionId
        ? list.find((session) => session.id === savedActiveSessionId)
        : null;
      setActiveSessionId((nextActiveSession || list[0]).id);
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (activeSessionId) {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
    } else {
      window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    }
  }, [activeSessionId]);

  // Re-parse messages with unparsed action/card blocks in content
  const reparseSession = useCallback((s: ChatSession): ChatSession => {
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
        latestSidebarHint = parsed.sidebarHints[parsed.sidebarHints.length - 1];
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

  // Load full session when activeSessionId changes
  useEffect(() => {
    if (!activeSessionId) { setActiveSession(null); return; }
    // If we already have it loaded (e.g. just created), skip
    if (activeSession?.id === activeSessionId) return;
    // Close any active stream and reset loading state
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
    setLoading(false);
    setStreamingMessageId(null);
    apiLoadSession(activeSessionId).then(async s => {
      if (!s) { setActiveSession(null); return; }
      // Clean up empty assistant messages left by interrupted streams
      const cleaned = {
        ...s,
        messages: s.messages.filter(m => !(m.role === 'assistant' && !m.content && !m.actions?.length && !m.cards?.length)),
      };
      setActiveSession(reparseSession(cleaned));
      // Restore per-session engine & model selections
      if (cleaned.engine) {
        setEngineState(cleaned.engine);
      }
      if (cleaned.model) {
        setModel(cleaned.model);
      }

      // Check if there's an active stream for this session and reconnect
      try {
        const checkRes = await fetch(`/api/chat/stream?checkActive=${encodeURIComponent(activeSessionId)}`);
        const checkData = await checkRes.json();
        // Skip reconnect if engine has changed since the stream was started
        const streamEngine = checkData.engine || '';
        const streamModel = checkData.model || '';
        const currentEngine = cleaned.engine || globalEngineRef.current || '';
        const currentModel = cleaned.model || '';
        if (checkData.active && checkData.chatId && streamEngine === currentEngine && streamModel === currentModel) {
          // Always create a fresh assistant message for recovery — never reuse an existing one
          // to avoid overwriting completed historical messages with new streaming content
          const recoveryMsg = { id: genId(), role: 'assistant' as const, content: '', timestamp: Date.now() };
          cleaned.messages.push(recoveryMsg);
          setActiveSession(reparseSession(cleaned));

            setLoading(true);
            setStreamingMessageId(recoveryMsg.id);
            activeChatIdRef.current = checkData.chatId;

            // Pre-fill with accumulated content
            if (checkData.streamContent) {
              const { text: cleanText, cards: newCards, sidebarHints } = parseActions(checkData.streamContent);
              const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
              setActiveSession(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  sessionWorkbenchState: latestSidebarHint ? {
                    ...(prev.sessionWorkbenchState || {}),
                    homeSidebar: latestSidebarHint,
                  } : prev.sessionWorkbenchState,
                  messages: prev.messages.map(m => m.id === recoveryMsg.id ? { ...m, content: cleanText, cards: newCards.length > 0 ? newCards : m.cards } : m),
                };
              });
            }

            // Connect SSE to continue receiving deltas
            const es = new EventSource(`/api/chat/stream?id=${checkData.chatId}`);
            activeEventSourceRef.current = es;
            let accumulated = checkData.streamContent || '';

            es.addEventListener('delta', (e) => {
              const { content } = JSON.parse(e.data);
              accumulated += content;
              const { text: cleanText, cards: newCards, sidebarHints } = parseActions(accumulated);
              const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
              setActiveSession(prev => {
                if (!prev) return prev;
                return {
                  ...prev,
                  sessionWorkbenchState: latestSidebarHint ? {
                    ...(prev.sessionWorkbenchState || {}),
                    homeSidebar: latestSidebarHint,
                  } : prev.sessionWorkbenchState,
                  messages: prev.messages.map(m => m.id === recoveryMsg.id ? { ...m, content: cleanText, cards: newCards.length > 0 ? newCards : m.cards } : m),
                };
              });
            });

            es.addEventListener('thinking', (e) => {
              const { content } = JSON.parse(e.data);
              setActiveSession(prev => {
                if (!prev) return prev;
                const msg = prev.messages.find(m => m.id === recoveryMsg.id);
                const prevRaw = msg?.rawContent || '';
                return {
                  ...prev,
                  messages: prev.messages.map(m => m.id === recoveryMsg.id ? { ...m, rawContent: prevRaw + content } : m),
                };
              });
            });

            es.addEventListener('done', (e) => {
              const data = JSON.parse(e.data);
              es.close();
              activeEventSourceRef.current = null;
              activeChatIdRef.current = null;
              if (data.sessionId) {
                setActiveSession(prev => prev ? { ...prev, backendSessionId: data.sessionId } : prev);
              }
              const fullText = data.result || accumulated;
              const { text: cleanText, cards, sidebarHints } = parseActions(fullText);
              const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
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
                    rawContent: cards.length > 0 ? fullText : m.rawContent,
                    cards: cards.length > 0 ? cards : m.cards,
                    costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
                  } : m),
                };
              });
              setLoading(false);
              setStreamingMessageId(null);
            });

            es.addEventListener('error', () => {
              es.close();
              activeEventSourceRef.current = null;
              activeChatIdRef.current = null;
              setLoading(false);
              setStreamingMessageId(null);
            });
        }
      } catch { /* recovery is best-effort */ }
    });
  }, [activeSessionId]);

  // Debounced persist to server
  const pendingSessionRef = useRef<ChatSession | null>(null);
  const scheduleSave = useCallback((session: ChatSession) => {
    pendingSessionRef.current = session;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      pendingSessionRef.current = null;
      apiSaveSession(session).catch(console.error);
    }, 300);
  }, []);

  // Flush pending save on page unload to prevent data loss
  useEffect(() => {
    const handleBeforeUnload = () => {
      const pending = pendingSessionRef.current;
      if (pending) {
        pendingSessionRef.current = null;
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
      scheduleSave(updated);
      // Also update summary in sessions list
      setSessions(list => list.map(s => s.id === updated.id ? {
        ...s,
        title: updated.title,
        updatedAt: updated.updatedAt,
        messageCount: updated.messages.length,
        lastMessage: updated.messages.filter(m => m.role !== 'error').slice(-1)[0]?.content?.slice(0, 100),
        agentBinding: updated.agentBinding,
        workflowBinding: updated.workflowBinding,
        creationSession: updated.creationSession,
        sessionWorkbenchState: updated.sessionWorkbenchState,
      } : s));
      return updated;
    });
  }, [scheduleSave]);

  const setSessionWorkbenchState = useCallback((state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => {
    updateActiveSession((session) => ({
      ...session,
      updatedAt: Date.now(),
      sessionWorkbenchState: typeof state === 'function' ? state(session.sessionWorkbenchState) : state,
    }));
  }, [updateActiveSession]);

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
      lastMessage: updated.messages.filter((message) => message.role !== 'error').slice(-1)[0]?.content?.slice(0, 100),
      agentBinding: updated.agentBinding,
      workflowBinding: updated.workflowBinding,
      creationSession: updated.creationSession,
      sessionWorkbenchState: updated.sessionWorkbenchState,
    } : item));
  }, [updateActiveSession]);

  const appendSessionMessage = useCallback(async (
    sessionId: string,
    message: Omit<ChatMessage, 'id' | 'timestamp'> & Partial<Pick<ChatMessage, 'id' | 'timestamp'>>,
    options?: { backendSessionId?: string }
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
      return {
        ...session,
        backendSessionId: options?.backendSessionId || session.backendSessionId,
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
      lastMessage: updated.messages.filter((msg) => msg.role !== 'error').slice(-1)[0]?.content?.slice(0, 100),
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
      team?: 'blue' | 'red' | 'judge' | 'black-gold' | 'yellow';
      roleType?: 'normal' | 'supervisor';
    };
  }) => {
    const id = genId();
    const title = options?.title?.trim() || '新对话';
    const now = Date.now();
    const session: ChatSession = {
      id, title, model, engine: engine || undefined, messages: [],
      agentBinding: options?.agentBinding ? {
        agentName: options.agentBinding.agentName,
        team: options.agentBinding.team,
        roleType: options.agentBinding.roleType,
        createdAt: now,
        updatedAt: now,
      } : undefined,
      sessionWorkbenchState: undefined,
      createdAt: now, updatedAt: now,
    };
    const summary: SessionSummary = {
      id, title, model,
      createdAt: session.createdAt, updatedAt: session.updatedAt,
      messageCount: 0,
      agentBinding: session.agentBinding,
      sessionWorkbenchState: session.sessionWorkbenchState,
    };
    setSessions(prev => [summary, ...prev]);
    setActiveSession(session);
    setActiveSessionId(id);
    apiCreateSession(session).catch(console.error);
    return id;
  }, [model, engine]);

  const deleteSession = useCallback((id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeSessionId === id) {
        const nextId = next.length > 0 ? next[0].id : null;
        setActiveSessionId(nextId);
        if (!nextId) setActiveSession(null);
      }
      return next;
    });
    apiDeleteSession(id).catch(console.error);
  }, [activeSessionId]);

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

  const autoExecuteSafeActions = useCallback(async (messageId: string, actions: ActionState[], _retryCount?: number) => {
    const retryCount = _retryCount || 0;
    const results: { type: string; data: any }[] = [];
    for (const a of actions) {
      if (isSafeAction(a.action)) {
        updateAction(messageId, a.id, { status: 'auto_executing' });
        try {
          const enriched = enrichAction(a.action);
          const { result } = await executeAction(enriched);
          updateAction(messageId, a.id, { status: 'success', result });
          results.push({ type: a.action.type, data: result });
        } catch (err: any) {
          updateAction(messageId, a.id, { status: 'error', error: err.message });
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
        id: followUpMsgId, role: 'assistant', content: '', engine: followUpEngine, model: model || undefined, timestamp: Date.now(),
      };
      updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, followUpMsg] }));
      setLoading(true);
      setStreamingMessageId(followUpMsgId);

      try {
        const backendSid = activeSessionRef.current?.backendSessionId;
        const frontendSid = activeSessionRef.current?.id;
        const startRes = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: followUpPrompt, model, engine: followUpEngine || undefined, sessionId: backendSid || undefined, frontendSessionId: frontendSid || undefined, mode: 'dashboard', workingDirectory: workingDirectory || undefined }),
        });
        const { chatId } = await startRes.json();
        if (!chatId) throw new Error('Failed to start stream');
        activeChatIdRef.current = chatId;

        await new Promise<void>((resolve, reject) => {
          let accumulated = '';
          let reconnectAttempts = 0;
          const MAX_RECONNECTS = 3;

          const connectSSE = () => {
            const es = new EventSource(`/api/chat/stream?id=${chatId}`);
            activeEventSourceRef.current = es;

            es.addEventListener('delta', (e) => {
              const { content } = JSON.parse(e.data);
              accumulated += content;
              // Extract cards in real-time so they render immediately without waiting for stream to finish
              const { text: cleanText, cards: newCards, sidebarHints } = parseActions(accumulated);
              const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
              updateActiveSession(s => {
                const existingMsg = s.messages.find(m => m.id === followUpMsgId);
                const existingCards: any[] = existingMsg?.cards || [];
                const existingKeys = new Set(existingCards.map((c: any) => c.header?.title));
                const uniqueNewCards = newCards.filter((c: any) => !existingKeys.has(c.header?.title));
                return {
                  ...s,
                  sessionWorkbenchState: latestSidebarHint ? {
                    ...(s.sessionWorkbenchState || {}),
                    homeSidebar: latestSidebarHint,
                  } : s.sessionWorkbenchState,
                  messages: s.messages.map(m => m.id === followUpMsgId ? { ...m, content: cleanText, cards: [...existingCards, ...uniqueNewCards] } : m),
                };
              });
            });

            es.addEventListener('done', (e) => {
              const data = JSON.parse(e.data);
              es.close();
              activeEventSourceRef.current = null;
              activeChatIdRef.current = null;
              if (data.sessionId) {
                updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
              }
              const fullText = data.result || accumulated;
              const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(fullText);
              const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
              const newActionStates: ActionState[] = newActions.map(a => ({
                id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
              }));
              updateActiveSession(s => ({
                ...s, updatedAt: Date.now(),
                sessionWorkbenchState: latestSidebarHint ? {
                  ...(s.sessionWorkbenchState || {}),
                  homeSidebar: latestSidebarHint,
                } : s.sessionWorkbenchState,
                messages: s.messages.map(m => m.id === followUpMsgId ? {
                  ...m, content: cleanText,
                  rawContent: (newCards.length > 0 || newActionStates.length > 0) ? fullText : undefined,
                  actions: newActionStates.length > 0 ? newActionStates : undefined,
                  cards: newCards.length > 0 ? newCards : undefined,
                } : m),
              }));

              // Handle loading state and recursive actions
              const finishLoading = () => {
                setLoading(false);
                setStreamingMessageId(null);
              };

              if (newActionStates.length > 0) {
                autoExecuteSafeActions(followUpMsgId, newActionStates).finally(finishLoading);
                resolve();
              } else {
                finishLoading();
                // If no cards and content is substantial, trigger a card-format retry
                if (newCards.length === 0 && cleanText.length > 200 && retryCount < 1) {
                  const retryPrompt = `你刚才的回复没有使用 \`\`\`card 代码块来展示结构化内容。请将上面的分析结果重新用 \`\`\`card 代码块格式输出为可视化卡片（不要用 \`\`\`json）。card 格式示例：{"header":{"icon":"图标","title":"标题","gradient":"from-blue-500 to-cyan-500"},"blocks":[...],"actions":[{"label":"按钮","prompt":"消息"}]}`;
                  sendMessageRef.current?.(retryPrompt);
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
                // Try recovery via backendSessionId
                const backendSid = activeSessionRef.current?.backendSessionId;
                if (backendSid) {
                  fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`)
                    .then(r => r.json())
                    .then(recData => {
                      if (recData.content) {
                        const { text: cleanText, cards: newCards, sidebarHints } = parseActions(recData.content);
                        const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
                        updateActiveSession(s => ({
                          ...s,
                          sessionWorkbenchState: latestSidebarHint ? {
                            ...(s.sessionWorkbenchState || {}),
                            homeSidebar: latestSidebarHint,
                          } : s.sessionWorkbenchState,
                          messages: s.messages.map(m => m.id === followUpMsgId ? { ...m, content: cleanText, cards: newCards } : m),
                        }));
                      }
                    })
                    .catch(() => {});
                }
                activeChatIdRef.current = null;
                reject(new Error('Stream error'));
              }
            });
          };

          connectSSE();
        });
      } catch { /* follow-up failed silently */ }
      setLoading(false);
      setStreamingMessageId(null);
    }
  }, [updateAction, model, updateActiveSession]);

  const interruptCurrentStream = useCallback(() => {
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
    if (activeChatIdRef.current) {
      fetch(`/api/chat/stream?id=${encodeURIComponent(activeChatIdRef.current)}`, { method: 'DELETE' }).catch(() => {});
      activeChatIdRef.current = null;
    }
    setLoading(false);
    setStreamingMessageId(null);
  }, []);

  // --- Send message (streaming) ---
  const sendMessage = useCallback(async (text: string, options?: { displayText?: string }) => {
    if (activeEventSourceRef.current || activeChatIdRef.current) {
      interruptCurrentStream();
    }

    let sid = activeSessionId;
    if (!sid) { sid = createSession(); }

    const userMsg: ChatMessage = { id: genId(), role: 'user', content: options?.displayText ?? text, timestamp: Date.now() };
    updateActiveSession(s => ({
      ...s,
      updatedAt: Date.now(),
      title: s.messages.length === 0 ? text.slice(0, 30) : s.title,
      messages: [...s.messages, userMsg],
    }));

    const assistantMsgId = genId();
    const currentModel = modelRef.current || '';
    const currentEngineOverride = engineRef.current || '';
    const resolvedEngine = currentEngineOverride || globalEngineRef.current || '';
    const previousSession = activeSessionRef.current;
    const agentBinding = previousSession?.agentBinding;
    const previousEffectiveEngine = previousSession?.engine || globalEngineRef.current || '';
    const previousModel = previousSession?.model || '';
    const shouldStartFresh = !!previousSession?.backendSessionId
      && (resolvedEngine !== previousEffectiveEngine || currentModel !== previousModel);
    const assistantMsg: ChatMessage = { id: assistantMsgId, role: 'assistant', content: '', engine: resolvedEngine, model: currentModel || undefined, timestamp: Date.now() };
    updateActiveSession(s => ({
      ...s,
      engine: currentEngineOverride,
      model: currentModel,
      backendSessionId: shouldStartFresh ? undefined : s.backendSessionId,
    }));
    updateActiveSession(s => ({ ...s, updatedAt: Date.now(), messages: [...s.messages, assistantMsg] }));
    setLoading(true);
    setStreamingMessageId(assistantMsgId);

    try {
      if (agentBinding?.agentName) {
        const result = await fetch(`/api/agents/${encodeURIComponent(agentBinding.agentName)}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({
            message: text,
            mode: 'standalone-chat',
            sessionId: shouldStartFresh ? undefined : (activeSessionRef.current?.backendSessionId || undefined),
            workingDirectory: workingDirectory || undefined,
          }),
        }).then(async (response) => {
          const data = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(data?.error || 'Agent 对话失败');
          }
          return data as {
            output: string;
            sessionId?: string | null;
            engine?: string;
            model?: string;
            isError?: boolean;
            error?: string | null;
          };
        });

        updateActiveSession((s) => ({
          ...s,
          backendSessionId: result.sessionId || s.backendSessionId,
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
        setStreamingMessageId(null);
        return;
      }

      const backendSid = shouldStartFresh ? undefined : activeSessionRef.current?.backendSessionId;
      const frontendSid = activeSessionRef.current?.id;
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, model: currentModel, engine: resolvedEngine || undefined, sessionId: backendSid || undefined, frontendSessionId: frontendSid || undefined, mode: 'dashboard', workingDirectory: workingDirectory || undefined }),
      });
      const startData = await startRes.json();
      if (!startRes.ok || startData.error) {
        updateActiveSession(s => ({
          ...s, updatedAt: Date.now(),
          messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, role: 'error' as const, content: startData.error || `HTTP ${startRes.status}` } : m),
        }));
        setLoading(false);
        setStreamingMessageId(null);
        return;
      }

      const { chatId } = startData;
      activeChatIdRef.current = chatId;
      await new Promise<void>((resolve, reject) => {
        let accumulated = '';
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
          const es = new EventSource(`/api/chat/stream?id=${chatId}`);
          activeEventSourceRef.current = es;
          resetInactivityTimer();
          let accumulatedRawContent = '';

          es.addEventListener('thinking', (e) => {
            resetInactivityTimer();
            const { content } = JSON.parse(e.data);
            accumulatedRawContent += content;
            updateActiveSession(s => ({
              ...s, messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, rawContent: accumulatedRawContent } : m),
            }));
          });

          es.addEventListener('delta', (e) => {
            resetInactivityTimer();
            const { content } = JSON.parse(e.data);
            accumulated += content;
            // Extract cards in real-time so they render immediately without waiting for stream to finish
            const { text: cleanText, cards: newCards, sidebarHints } = parseActions(accumulated);
            const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
            updateActiveSession(s => {
              const existingMsg = s.messages.find(m => m.id === assistantMsgId);
              const existingCards: any[] = existingMsg?.cards || [];
              // Merge cards by header.title to avoid duplicates
              const existingKeys = new Set(existingCards.map((c: any) => c.header?.title));
              const uniqueNewCards = newCards.filter((c: any) => !existingKeys.has(c.header?.title));
              return {
                ...s,
                sessionWorkbenchState: latestSidebarHint ? {
                  ...(s.sessionWorkbenchState || {}),
                  homeSidebar: latestSidebarHint,
                } : s.sessionWorkbenchState,
                messages: s.messages.map(m => m.id === assistantMsgId ? { ...m, content: cleanText, cards: [...existingCards, ...uniqueNewCards] } : m),
              };
            });
          });

          es.addEventListener('done', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = JSON.parse(e.data);
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            if (data.sessionId) {
              updateActiveSession(s => ({ ...s, backendSessionId: data.sessionId }));
            }
            if (data.isError) {
              const partial = String(data.result || accumulated || '').trim();
              const message = String(data.error || '请求失败，请稍后重试');
              const content = partial
                ? `请求失败：${message}\n\n已返回部分内容：\n${partial}`
                : `请求失败：${message}`;
              updateActiveSession(s => ({
                ...s,
                updatedAt: Date.now(),
                messages: s.messages.map(m => m.id === assistantMsgId
                  ? { ...m, role: 'error' as const, content }
                  : m),
              }));
              setLoading(false);
              setStreamingMessageId(null);
              resolve();
              return;
            }
            const fullText = data.result || accumulated;
            const streamText = accumulated || fullText;
            const { text: cleanText, actions, cards, sidebarHints } = parseActions(fullText);
            const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
            const actionStates: ActionState[] = actions.map(a => ({
              id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
            }));
            updateActiveSession(s => ({
              ...s, updatedAt: Date.now(),
              sessionWorkbenchState: latestSidebarHint ? {
                ...(s.sessionWorkbenchState || {}),
                homeSidebar: latestSidebarHint,
              } : s.sessionWorkbenchState,
              messages: s.messages.map(m => m.id === assistantMsgId ? {
                ...m, content: cleanText,
                rawContent: accumulatedRawContent || (streamText !== cleanText ? streamText : undefined),
                actions: actionStates.length > 0 ? actionStates : undefined,
                cards: cards.length > 0 ? cards : undefined,
                costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
              } : m),
            }));
            if (actionStates.length > 0) {
              // autoExecuteSafeActions will handle its own loading state
              autoExecuteSafeActions(assistantMsgId, actionStates);
              resolve();
            } else {
              setLoading(false);
              setStreamingMessageId(null);
              resolve();
            }
          });

          es.addEventListener('engine_error', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = JSON.parse(e.data || '{}');
            const message = String(data?.message || '执行失败，请稍后重试');
            updateActiveSession(s => ({
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map(m => m.id === assistantMsgId
                ? { ...m, role: 'error' as const, content: `请求失败：${message}` }
                : m),
            }));
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            setLoading(false);
            setStreamingMessageId(null);
            resolve();
          });

          es.addEventListener('failed', (e) => {
            if (inactivityTimer) clearTimeout(inactivityTimer);
            const data = JSON.parse(e.data || '{}');
            const message = String(data?.message || '执行失败，请稍后重试');
            updateActiveSession(s => ({
              ...s,
              updatedAt: Date.now(),
              messages: s.messages.map(m => m.id === assistantMsgId
                ? { ...m, role: 'error' as const, content: `请求失败：${message}` }
                : m),
            }));
            es.close();
            activeEventSourceRef.current = null;
            activeChatIdRef.current = null;
            setLoading(false);
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
              // All reconnects failed — try to recover full content from backend
              const backendSid = activeSessionRef.current?.backendSessionId;
              if (backendSid) {
                fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`)
                  .then(r => r.json())
                  .then(recData => {
                    if (recData.content) {
                      const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(recData.content);
                      const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
                      const newActionStates: ActionState[] = newActions.map(a => ({
                        id: genId(), action: a, status: isSafeAction(a) ? 'auto_executing' as ActionStatus : 'pending' as ActionStatus, timestamp: Date.now(),
                      }));
                      updateActiveSession(s => ({
                        ...s, updatedAt: Date.now(),
                        sessionWorkbenchState: latestSidebarHint ? {
                          ...(s.sessionWorkbenchState || {}),
                          homeSidebar: latestSidebarHint,
                        } : s.sessionWorkbenchState,
                        messages: s.messages.map(m => m.id === assistantMsgId ? {
                          ...m, content: cleanText,
                          actions: newActionStates.length > 0 ? newActionStates : m.actions,
                          cards: newCards.length > 0 ? newCards : m.cards,
                        } : m),
                      }));
                      if (newActionStates.length > 0) {
                        autoExecuteSafeActions(assistantMsgId, newActionStates);
                        resolve();
                      } else {
                        setLoading(false);
                        setStreamingMessageId(null);
                        resolve();
                      }
                    } else {
                      updateActiveSession(s => ({
                        ...s, messages: s.messages.map(m => m.id === assistantMsgId && !m.content
                          ? { ...m, role: 'error' as const, content: '流式连接中断' }
                          : m),
                      }));
                      setLoading(false);
                      setStreamingMessageId(null);
                      resolve();
                    }
                  })
                  .catch(() => {
                    updateActiveSession(s => ({
                      ...s, messages: s.messages.map(m => m.id === assistantMsgId && !m.content
                        ? { ...m, role: 'error' as const, content: '流式连接中断' }
                        : m),
                    }));
                    setLoading(false);
                    setStreamingMessageId(null);
                    resolve();
                  });
              } else {
                setLoading(false);
                setStreamingMessageId(null);
                resolve();
              }
            }
          });
        };

        connectSSE();
      });
    } catch (err: any) {
      // If the assistant message is still empty, convert to error
      updateActiveSession(s => ({
        ...s, updatedAt: Date.now(),
        messages: s.messages.map(m => m.id === assistantMsgId && !m.content
          ? { ...m, role: 'error' as const, content: err.message || '请求失败' }
          : m),
      }));
      setLoading(false);
      setStreamingMessageId(null);
    }
    // Note: setLoading(false) is called inside the Promise's done/error handlers
    // to properly handle autoExecuteSafeActions
  }, [activeSessionId, createSession, updateActiveSession, autoExecuteSafeActions, workingDirectory, interruptCurrentStream]);
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

    if (!msg.content.includes('超时') && !msg.content.includes('timeout')) return;

    // If engine has changed since the error, the old backendSessionId is invalid
    const backendSid = session.backendSessionId;
    const sessionEngine = session.engine || globalEngineRef.current || '';
    const sessionModel = session.model || '';
    if (!backendSid || (engineRef.current || globalEngineRef.current || '') !== sessionEngine || (modelRef.current || '') !== sessionModel) return;

    setLoading(true);
    try {
      // Try to recover content from the backend
      const recRes = await fetch(`/api/chat/stream/recover?sessionId=${encodeURIComponent(backendSid)}`);
      const recData = await recRes.json();

      if (recData.content) {
        const { text: cleanText, actions: newActions, cards: newCards, sidebarHints } = parseActions(recData.content);
        const latestSidebarHint = sidebarHints[sidebarHints.length - 1];
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
        }
      }
    } catch (err) {
      console.error('Continue from timeout failed:', err);
    } finally {
      setLoading(false);
    }
  }, [updateActiveSession, autoExecuteSafeActions]);

  return (
    <DashboardChatContext.Provider value={{
      isOpen, openChat, closeChat, toggleChat,
      sessions, activeSessionId, activeSession,
      createSession, deleteSession, renameSession, setActiveSessionId,
      sendMessage, stopStreaming, deleteMessage, retryFromMessage, continueFromMessage,
      loading, streamingMessageId, model, setModel: handleSetModel,
      engine, effectiveEngine, setEngine: handleSetEngine,
      confirmAction, rejectAction, undoActionById, retryAction,
      skillSettings, discoveredSkills, toggleSkill,
      workingDirectory, setWorkingDirectory,
      setSessionWorkbenchState,
      appendVisibleSessionTag,
      appendSessionMessage,
    }}>
      {children}
    </DashboardChatContext.Provider>
  );
}

export const useChat = () => useContext(DashboardChatContext);
