'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { buildNotebookFromConversation, buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat/notebook';
import { useToast } from '@/components/ui/toast';
import { Switch } from '@/components/ui/switch';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useSidebarPluginPreferences } from '@/hooks/useSidebarPluginPreferences';
import ChatSidebar from '@/components/chat/ChatSidebar';
import WeChatSessionBindDialog from '@/components/chat/WeChatSessionBindDialog';
import ChatMessage, { RobotLogo } from '@/components/chat/ChatMessage';
import { MessageHistoryCollapse } from '@/components/chat/MessageHistoryCollapse';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import HomeCommandSidebar from '@/components/chat/HomeCommandSidebar';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import AuthGuard from '@/components/AuthGuard';
import UserMenu from '@/components/UserMenu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import {
  type CollaborationRoomState,
  inferHomeSidebarMode,
  inferHomeSidebarTab,
  type HomeSidebarHint,
  type HomeSidebarMode,
  type HomeSidebarTab,
} from '@/lib/core/home-sidebar-state';
import { dispatchHomeAction } from '@/lib/sidebar-plugins/intent-handlers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { computeAdaptiveRecentWindow } from '@/lib/chat/message-window';
import { cn } from '@/lib/core/utils';
import {
  DEFAULT_WEREWOLF_BOARD_ID,
  TEMP_WEREWOLF_SUPERVISOR,
  listTemporaryWerewolfAgentNames,
} from '@/plugins/werewolf/agents';
import pkgJson from '../../package.json';

// 动态导入 RichTextEditor - TipTap 是重量级库，延迟加载
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-[76px] rounded-xl border border-input bg-background animate-pulse" />
  ),
});

const SIDEBAR_STORAGE_KEY = 'chat-sidebar-width';
const HOME_SIDEBAR_WIDTH_STORAGE_KEY = 'home-command-sidebar-width';

const WorkspaceEditor = dynamic(() => import('@/components/workspace/WorkspaceEditor').then(m => m.WorkspaceEditor), {
  ssr: false,
});
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_HOME_SIDEBAR_SIZE = 26;
const MIN_HOME_SIDEBAR_SIZE = 20;
const MAX_HOME_SIDEBAR_SIZE = 46;
const MOBILE_BREAKPOINT = 768;
type AgentBindingTeam = 'blue' | 'red' | 'judge' | 'black-gold';

function createWerewolfLabRoom(now = Date.now()): CollaborationRoomState {
  const players = listTemporaryWerewolfAgentNames();
  return {
    topic: '多Agent能力实验室：AI 狼人杀',
    selectedAgents: [TEMP_WEREWOLF_SUPERVISOR.name, ...players],
    mode: 'roundtable',
    messages: [],
    rounds: [],
    agentSessions: {},
    werewolf: {
      enabled: true,
      phase: 'setup',
      dayNumber: 1,
      boardId: DEFAULT_WEREWOLF_BOARD_ID,
      boardName: '预女猎',
      players: [],
      eliminated: [],
      votes: [],
      revealedRoles: false,
      lastSummary: '请先选择板子，系统会随机选择参与人格并分配身份。',
    },
  };
}

function getAgentBindingTeamLabel(team?: AgentBindingTeam) {
  switch (team) {
    case 'blue':
      return '蓝队';
    case 'red':
      return '红队';
    case 'judge':
      return '裁定席';
    case 'black-gold':
      return '指挥官';
    default:
      return 'Agent';
  }
}

function getAgentBindingBadgeClass(team?: AgentBindingTeam) {
  switch (team) {
    case 'blue':
      return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200';
    case 'red':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200';
    case 'judge':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-200';
    case 'black-gold':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200';
    default:
      return 'border-border bg-muted/50 text-muted-foreground';
  }
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return isMobile;
}

function ChatPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useSidebarPluginPreferences();
  const {
    activeSessionId, activeSession, sessions, createSession, setActiveSessionId, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, sessionLoadingId, streamingMessageId, setStreamingMessageId, markSessionStreaming, unmarkSessionStreaming,
    model, setModel, engine, effectiveEngine, setEngine,
    confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings, setSessionWorkbenchState,
    appendSessionMessage,
    updateSessionMessage,
  } = useChat();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const collaborationMessageHandlerRef = useRef<((text: string) => void) | null>(null);  const [notebookExporting, setNotebookExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ type: 'conversation' } | { type: 'assistant'; messageId: string } | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [exportDirectory, setExportDirectory] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [debugMode, setDebugMode] = useState(false);
  const [debugPrompt, setDebugPrompt] = useState<string | null>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false);
  const [workspaceEditorPath, setWorkspaceEditorPath] = useState<string | undefined>();
  const [workspaceEditorFilePath, setWorkspaceEditorFilePath] = useState<string | null>(null);
  const [workspaceEditorTitle, setWorkspaceEditorTitle] = useState<string | undefined>();
  const [wechatBindDialogOpen, setWeChatBindDialogOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichTextEditorHandle | null>(null);
  const editEditorRef = useRef<RichTextEditorHandle | null>(null);
  const lastEditSeedRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const pendingHistoryScrollAdjustRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const isMobile = useIsMobile();
  const [currentUser, setCurrentUser] = useState<{ username: string; email: string; role: 'admin' | 'user'; avatar?: string } | null>(null);
  const [homeSidebarTab, setHomeSidebarTab] = useState<HomeSidebarTab>('commander');
  const [homeSidebarMode, setHomeSidebarMode] = useState<HomeSidebarMode>('hidden');
  const [homeSidebarSize, setHomeSidebarSize] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_HOME_SIDEBAR_SIZE;
    const saved = Number(window.localStorage.getItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY) || '');
    if (!Number.isFinite(saved)) return DEFAULT_HOME_SIDEBAR_SIZE;
    return Math.min(MAX_HOME_SIDEBAR_SIZE, Math.max(MIN_HOME_SIDEBAR_SIZE, saved));
  });
  const starterHandledRef = useRef(false);
  const werewolfPreviousDarkClassRef = useRef<boolean | null>(null);
  const lastHomeSidebarSyncRef = useRef('');

  const parsedSidebarHint = useMemo<HomeSidebarHint | null>(() => {
    // 已有持久化状态时跳过昂贵的 parseActions 解析
    if (activeSession?.sessionWorkbenchState?.homeSidebar) {
      return null;
    }
    const assistantMessages = [...(activeSession?.messages || [])]
      .filter((message) => message.role === 'assistant')
      .reverse();
    for (const message of assistantMessages) {
      const parsed = parseActions(message.rawContent || message.content || '');
      if (parsed.sidebarHints.length > 0) {
        return parsed.sidebarHints[parsed.sidebarHints.length - 1];
      }
    }
    return null;
  }, [activeSession?.messages, activeSession?.sessionWorkbenchState?.homeSidebar]);

  const latestSidebarHint = activeSession?.sessionWorkbenchState?.homeSidebar || parsedSidebarHint;
  const hasWorkflowSidebarContext = Boolean(activeSession?.workflowBinding);
  const hasCreationSidebarContext = Boolean(activeSession?.creationSession);
  const hasCollaborationSidebarContext = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom);
  const hasCommanderSidebarContext = hasWorkflowSidebarContext || hasCollaborationSidebarContext;
  const hasHintSidebarContext = Boolean(
    latestSidebarHint?.intent
    || latestSidebarHint?.workflowDraft
    || latestSidebarHint?.agentDraft
    || latestSidebarHint?.tabs?.length
  );
  const derivedHomeSidebarTab = useMemo(
    () => inferHomeSidebarTab(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
      hasCreationSession: hasCreationSidebarContext,
    }),
    [hasCommanderSidebarContext, hasCreationSidebarContext, latestSidebarHint]
  );
  const derivedHomeSidebarMode = useMemo(
    () => inferHomeSidebarMode(latestSidebarHint, {
      hasWorkflowBinding: hasCommanderSidebarContext,
      hasCreationSession: hasCreationSidebarContext,
    }),
    [hasCommanderSidebarContext, hasCreationSidebarContext, latestSidebarHint]
  );

  const sessionScopedSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>();
    // If hint explicitly specifies tabs, use those as the primary source
    const hintTabs = latestSidebarHint?.tabs || [];
    if (hintTabs.length > 0) {
      for (const tab of hintTabs) {
        if (tab === 'commander' && !hasCommanderSidebarContext) continue;
        tabs.add(tab);
      }
    } else {
      if (hasCommanderSidebarContext) {
        tabs.add('commander');
      }
      if (hasWorkflowSidebarContext) {
        tabs.add('workflow');
      }
      if (hasCreationSidebarContext) {
        tabs.add('workflow');
      }
    }
    if (tabs.size === 0 && hasCommanderSidebarContext) tabs.add('commander');
    if (tabs.size === 0 && latestSidebarHint) tabs.add(derivedHomeSidebarTab);
    return Array.from(tabs);
  }, [derivedHomeSidebarTab, hasCommanderSidebarContext, hasCreationSidebarContext, hasWorkflowSidebarContext, latestSidebarHint, latestSidebarHint?.tabs]);

  const availableHomeSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>(sessionScopedSidebarTabs);
    if (tabs.size === 0 && derivedHomeSidebarMode === 'active') {
      tabs.add(derivedHomeSidebarTab);
    }
    return Array.from(tabs);
  }, [derivedHomeSidebarMode, derivedHomeSidebarTab, sessionScopedSidebarTabs]);
  const hasHomeSidebarContext = hasWorkflowSidebarContext
    || hasCreationSidebarContext
    || hasCollaborationSidebarContext
    || hasHintSidebarContext;
  const availableHomeSidebarTabsKey = availableHomeSidebarTabs.join('|');

  useEffect(() => {
    if (!parsedSidebarHint) return;
    const persisted = activeSession?.sessionWorkbenchState?.homeSidebar;
    if (JSON.stringify(parsedSidebarHint) === JSON.stringify(persisted || null)) return;
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: parsedSidebarHint,
    }));
  }, [activeSession?.sessionWorkbenchState?.homeSidebar, parsedSidebarHint, setSessionWorkbenchState]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin);
    }
  }, []);

  useEffect(() => {
    const handleOpenWorkspacePath = (event: Event) => {
      const detail = (event as CustomEvent<{
        absolutePath?: string;
        workspacePath?: string;
        filePath?: string | null;
      }>).detail;
      if (!detail?.workspacePath) return;
      setWorkspaceEditorPath(detail.workspacePath);
      setWorkspaceEditorTitle('文档链接');
      setWorkspaceEditorFilePath(detail.absolutePath || detail.filePath || null);
      setWorkspaceEditorOpen(true);
    };
    window.addEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    return () => {
      window.removeEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    };
  }, []);

  const chatTitle = useMemo(() => {
    const notebookFile = searchParams.get('notebookFile');
    if (notebookFile) {
      const fileName = notebookFile.split('/').pop() || notebookFile;
      return `${fileName} · Notebook`;
    }

    const sessionTitle = activeSession?.title?.trim();
    return sessionTitle || '首页';
  }, [activeSession?.title, searchParams]);

  useDocumentTitle(chatTitle);

  // Load current user info
  useEffect(() => {
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) setCurrentUser(JSON.parse(stored));
    } catch {}
  }, []);

  // Load saved width
  useEffect(() => {
    const saved = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved) {
      const w = parseInt(saved, 10);
      if (w >= MIN_WIDTH && w <= MAX_WIDTH) setSidebarWidth(w);
    }
  }, []);

  // Hide sidebar by default on mobile
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Resize drag handler
  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const x = e.clientX - containerRef.current.getBoundingClientRect().left;
      const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, x));
      setSidebarWidth(clamped);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, clamped.toString());
    };
    const onUp = () => setIsResizing(false);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  // Detect user scroll to lock/unlock auto-scroll
  const hasMessages = (activeSession?.messages?.length ?? 0) > 0;
  useEffect(() => {
    if (isMobile) return;

    const hintedTab = latestSidebarHint?.activeTab;
    const nextTab = hintedTab && availableHomeSidebarTabs.includes(hintedTab)
      ? hintedTab
      : availableHomeSidebarTabs[0] || derivedHomeSidebarTab;

    let nextMode = latestSidebarHint?.mode || derivedHomeSidebarMode;
    if (nextMode === 'hidden' && hasHomeSidebarContext && availableHomeSidebarTabs.length > 0) {
      nextMode = 'peek';
    } else if (!hasHomeSidebarContext && hasMessages) {
      nextMode = 'hidden';
    }

    const syncSignature = [
      activeSession?.id || '',
      nextTab,
      nextMode,
      availableHomeSidebarTabsKey,
      hasHomeSidebarContext ? 'context' : 'empty',
    ].join('|');
    if (lastHomeSidebarSyncRef.current === syncSignature) return;
    lastHomeSidebarSyncRef.current = syncSignature;

    setHomeSidebarTab((prev) => (prev === nextTab ? prev : nextTab));
    setHomeSidebarMode((prev) => (prev === nextMode ? prev : nextMode));
  }, [
    activeSession?.id,
    availableHomeSidebarTabsKey,
    derivedHomeSidebarMode,
    derivedHomeSidebarTab,
    hasHomeSidebarContext,
    hasMessages,
    isMobile,
    latestSidebarHint?.activeTab,
    latestSidebarHint?.mode,
  ]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      const threshold = 80;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
      autoScrollLockedRef.current = !nearBottom;
      setShowScrollBtn(!nearBottom && hasMessages);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMessages]);

  // Auto-scroll to bottom only if not locked by user
  useEffect(() => {
    if (!autoScrollLockedRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
    }
  }, [activeSession?.messages, loading]);

  useEffect(() => {
    if (!editDialogOpen || !editEditorRef.current || !editingMessageId) return;
    if (lastEditSeedRef.current === editingMessageId) return;
    editEditorRef.current.setContent(editContent);
    lastEditSeedRef.current = editingMessageId;
  }, [editContent, editDialogOpen, editingMessageId]);

  useEffect(() => {
    const targetSessionId = searchParams.get('sessionId');
    if (!targetSessionId || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }
    setActiveSessionId(targetSessionId);

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [pathname, router, searchParams, setActiveSessionId]);

  useEffect(() => {
    const starterAgent = searchParams.get('agentName');
    if (!starterAgent || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const team = searchParams.get('agentTeam');
    const roleType = searchParams.get('agentRoleType');
    createSession({
      title: sessionTitle?.trim() || `${starterAgent} 对话`,
      agentBinding: {
        agentName: starterAgent,
        team: (team === 'blue' || team === 'red' || team === 'judge' || team === 'black-gold') ? team : undefined,
        roleType: roleType === 'supervisor' ? 'supervisor' : roleType === 'normal' ? 'normal' : undefined,
      },
    });

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('agentName');
    nextParams.delete('agentTeam');
    nextParams.delete('agentRoleType');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, pathname, router, searchParams]);

  useEffect(() => {
    const starterPrompt = searchParams.get('starterPrompt');
    if (!starterPrompt || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const existingSessionId = searchParams.get('sessionId');
    if (existingSessionId) {
      setActiveSessionId(existingSessionId);
    } else {
      createSession({ title: sessionTitle?.trim() || '新对话' });
    }

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    setInput(starterPrompt);
    editorRef.current?.setContent(starterPrompt);
    editorRef.current?.focus();

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('starterPrompt');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, pathname, router, searchParams, setActiveSessionId]);

  const getInputMarkdown = useCallback(() => {
    return editorRef.current?.getMarkdown().trim() || input.trim();
  }, [input]);

  const getEditMarkdown = useCallback(() => {
    return editEditorRef.current?.getMarkdown().trim() || editContent.trim();
  }, [editContent]);

  const updateNotebookUrl = useCallback((filePath: string, scope: NotebookScope = 'personal') => {
    const params = new URLSearchParams();
    params.set('notebook', '1');
    params.set('notebookFile', filePath);
    params.set('notebookScope', scope);
    router.push(`/notebook?${params.toString()}`);
  }, [router]);

  const normalizeNotebookFileName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.endsWith('.cj.md') ? trimmed : `${trimmed}.cj.md`;
  }, []);

  const createDefaultNotebookBaseName = useCallback(() => {
    return createDefaultNotebookFileName().replace(/\.cj\.md$/i, '');
  }, []);

  const openNotebookExportDialog = useCallback((target: { type: 'conversation' } | { type: 'assistant'; messageId: string }) => {
    setPendingExport(target);
    setExportFileName(createDefaultNotebookBaseName());
    setExportScope('personal');
    setExportDirectory('');
    setExportDialogOpen(true);
  }, [createDefaultNotebookBaseName]);

  const closeNotebookExportDialog = useCallback(() => {
    if (notebookExporting) return;
    setExportDialogOpen(false);
    setPendingExport(null);
    setExportFileName('');
    setExportScope('personal');
    setExportDirectory('');
  }, [notebookExporting]);

  const saveNotebookFile = useCallback(async (filePath: string, content: string, scope: NotebookScope) => {
    await workspaceApi.manageNotebook('create-file', { path: filePath }, { scope });
    await workspaceApi.saveNotebookFile(filePath, content, { scope });
    updateNotebookUrl(filePath, scope);
  }, [updateNotebookUrl]);

  const handleConfirmNotebookExport = useCallback(async () => {
    if (!pendingExport) return;

    const normalizedFileName = normalizeNotebookFileName(exportFileName) || normalizeNotebookFileName(createDefaultNotebookBaseName());
    if (!normalizedFileName) return;
    const normalizedDir = exportDirectory.replace(/^\/+|\/+$/g, '');
    const finalFilePath = normalizedDir ? `${normalizedDir}/${normalizedFileName}` : normalizedFileName;

    const exportPayload = pendingExport.type === 'conversation'
      ? (activeSession ? { filePath: finalFilePath, content: buildNotebookFromConversation(activeSession) } : null)
      : (() => {
          const message = activeSession?.messages.find((item) => item.id === pendingExport.messageId && item.role === 'assistant');
          if (!message) return null;
          const contentText = (message.rawContent || message.content || '').trim();
          if (!contentText) return null;
          return { filePath: finalFilePath, content: buildNotebookFromAssistantMessage(message) };
        })();

    if (!exportPayload) {
      toast('warning', '没有可导出的内容');
      return;
    }

    try {
      setNotebookExporting(true);
      await saveNotebookFile(exportPayload.filePath, exportPayload.content, exportScope);
      toast('success', `已保存为 Notebook：${exportPayload.filePath}`);
      setExportDialogOpen(false);
      setPendingExport(null);
      setExportFileName('');
      setExportDirectory('');
    } catch (error: any) {
      toast('error', error?.message || '保存 Notebook 失败');
    } finally {
      setNotebookExporting(false);
    }
  }, [pendingExport, normalizeNotebookFileName, exportFileName, exportDirectory, toast, activeSession, saveNotebookFile, exportScope, createDefaultNotebookBaseName]);

  const handleSaveConversationAsNotebook = useCallback(async () => {
    if (!activeSession) return;
    const exportableMessages = activeSession.messages.filter((message) => {
      if (message.role === 'error') return false;
      return Boolean((message.rawContent || message.content || '').trim());
    });
    if (exportableMessages.length === 0) {
      toast('warning', '当前会话没有可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'conversation' });
  }, [activeSession, openNotebookExportDialog, toast]);

  const handleSaveAssistantMessageAsNotebook = useCallback(async (messageId: string) => {
    const message = activeSession?.messages.find((item) => item.id === messageId && item.role === 'assistant');
    if (!message) return;

    const contentText = (message.rawContent || message.content || '').trim();
    if (!contentText) {
      toast('warning', '这条消息暂无可导出的内容');
      return;
    }

    openNotebookExportDialog({ type: 'assistant', messageId });
  }, [activeSession, openNotebookExportDialog, toast]);

  const unlockAutoScroll = useCallback(() => {
    autoScrollLockedRef.current = false;
    setShowScrollBtn(false);
  }, []);

  const scrollToBottom = useCallback(() => {
    unlockAutoScroll();
    isProgrammaticScrollRef.current = true;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
  }, [unlockAutoScroll]);

  const applyHomeSidebarState = useCallback((patch: {
    tab?: HomeSidebarTab;
    mode?: HomeSidebarMode;
    intent?: HomeSidebarHint['intent'];
    stage?: HomeSidebarHint['stage'];
    reason?: string;
    summary?: string;
    shouldOpenModal?: boolean;
  }) => {
    if (patch.tab) setHomeSidebarTab((prev) => (prev === patch.tab ? prev : patch.tab!));
    if (patch.mode) setHomeSidebarMode((prev) => (prev === patch.mode ? prev : patch.mode!));
    setSessionWorkbenchState((prev) => {
      const nextHomeSidebar: HomeSidebarHint = {
        type: 'home_sidebar',
        ...(prev?.homeSidebar || {}),
        ...(patch.tab ? { activeTab: patch.tab } : {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
        ...(patch.intent ? { intent: patch.intent } : {}),
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.shouldOpenModal !== undefined ? { shouldOpenModal: patch.shouldOpenModal } : {}),
      };
      if (JSON.stringify(prev?.homeSidebar || null) === JSON.stringify(nextHomeSidebar)) {
        return prev || { homeSidebar: nextHomeSidebar };
      }
      return {
        ...(prev || {}),
        homeSidebar: nextHomeSidebar,
      };
    });
  }, [setSessionWorkbenchState]);

  const openHomeSidebar = useCallback((
    tab?: HomeSidebarTab,
    intent?: HomeSidebarHint['intent'],
    stage?: HomeSidebarHint['stage'],
    options?: { shouldOpenModal?: boolean }
  ) => {
    applyHomeSidebarState({
      tab,
      mode: 'active',
      intent,
      stage,
      shouldOpenModal: options?.shouldOpenModal ?? false,
    });
  }, [applyHomeSidebarState]);

  const closeHomeSidebar = useCallback(() => {
    applyHomeSidebarState({ mode: hasHomeSidebarContext ? 'peek' : 'hidden' });
  }, [applyHomeSidebarState, hasHomeSidebarContext]);

  const handleHomeSidebarTabChange = useCallback((tab: HomeSidebarTab) => {
    applyHomeSidebarState({ tab });
  }, [applyHomeSidebarState]);

  const handleHomeSidebarLayout = useCallback((layout: Record<string, number> | number[]) => {
    if (homeSidebarMode !== 'active') return;
    const nextSize = Array.isArray(layout)
      ? layout[1]
      : layout['home-command-sidebar-panel'];
    if (!Number.isFinite(nextSize)) return;
    const clamped = Math.min(MAX_HOME_SIDEBAR_SIZE, Math.max(MIN_HOME_SIDEBAR_SIZE, nextSize));
    setHomeSidebarSize((prev) => Math.abs(prev - clamped) < 0.1 ? prev : clamped);
    try {
      window.localStorage.setItem(HOME_SIDEBAR_WIDTH_STORAGE_KEY, clamped.toFixed(2));
    } catch {}
  }, [homeSidebarMode]);

  const mainInputMentionItems = useMemo(() => {
    const room = activeSession?.sessionWorkbenchState?.collaborationRoom;
    if (!room || !hasCollaborationSidebarContext) return [];
    const names = new Set<string>();
    if (homeSidebarTab === 'chatroom') {
      names.add('全员');
      names.add('AI 百灵鸟');
      (room.chatroom?.participants || []).forEach((participant) => {
        const name = String(participant || '').trim();
        if (name) names.add(name);
      });
      (room.selectedAgents || []).forEach((name) => {
        if (name) names.add(name);
      });
    } else if (homeSidebarTab === 'commander' || homeSidebarTab === 'workflow') {
      names.add('全员');
      (room.selectedAgents || []).forEach((name) => {
        if (name) names.add(name);
      });
    }
    return Array.from(names);
  }, [activeSession?.sessionWorkbenchState?.collaborationRoom, hasCollaborationSidebarContext, homeSidebarTab]);

  const submitMessage = useCallback(async (text: string) => {
    const normalized = text.trim();
    if (!normalized) return;
    if (editingMessageId) {
      deleteMessage(editingMessageId);
      setEditingMessageId(null);
    }

    unlockAutoScroll();
    setInput('');
    editorRef.current?.clear();

    // Route to collaboration room if active
    if (hasCollaborationSidebarContext && collaborationMessageHandlerRef.current) {
      if (homeSidebarTab === 'chatroom' && activeSessionId && appendSessionMessage) {
        await appendSessionMessage(activeSessionId, {
          role: 'user',
          content: normalized,
          rawContent: normalized,
          timestamp: Date.now(),
        });
      }
      collaborationMessageHandlerRef.current(normalized);
      editorRef.current?.focus();
      return;
    }

    if (loading) {
      stopStreaming();
      await Promise.resolve();
    }
    await sendMessage(normalized);
    editorRef.current?.focus();
  }, [activeSessionId, appendSessionMessage, deleteMessage, editingMessageId, hasCollaborationSidebarContext, homeSidebarTab, loading, sendMessage, stopStreaming, unlockAutoScroll]);

  const handleSend = useCallback(async () => {
    const text = getInputMarkdown();
    if (!text) return;
    await submitMessage(text);
  }, [getInputMarkdown, submitMessage]);

  const handleEditorEnter = useCallback(async (text: string) => {
    const markdown = text.trim() || getInputMarkdown();
    if (!markdown) return;
    await submitMessage(markdown);
  }, [getInputMarkdown, submitMessage]);

  const handleQuickAction = useCallback((prompt: string) => {
    if (prompt === '__HOME_ACTION__:create_workflow') {
      openHomeSidebar('workflow', 'create-workflow', 'clarifying', { shouldOpenModal: true });
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      return;
    }

    if (prompt === '__HOME_ACTION__:create_agent') {
      openHomeSidebar('agent', 'create-agent', 'clarifying', { shouldOpenModal: true });
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      return;
    }

    if (prompt === '__HOME_ACTION__:werewolf_lab') {
      const now = Date.now();
      const sessionId = createSession({
        title: '多Agent能力实验室 · AI 狼人杀',
        sessionWorkbenchState: {
          homeSidebar: {
            type: 'home_sidebar',
            mode: 'active',
            activeTab: 'commander',
            tabs: ['commander'],
            intent: 'supervisor-chat',
            stage: 'running',
            reason: '启动多Agent能力实验室，用 AI 狼人杀测试群聊、点名、回合制和投票能力。',
            summary: '这是一个多Agent协作能力测试对话。右侧协作室已预置 AI 狼人杀实验流程，可选择板子、随机角色和视角后由 Supervisor 推进。',
            recommendedNextAction: '在右侧协作室选择板子，必要时刷新随机角色，然后点击“确认角色并开局”。',
          },
          collaborationRoom: createWerewolfLabRoom(now),
        },
        messages: [
          {
            role: 'user',
            content: '启动多Agent能力实验室：AI 狼人杀',
            timestamp: now,
          },
          {
            role: 'assistant',
            content: [
              '已创建一个 AI 狼人杀实验对话。',
              '',
              '右侧协作室已预置 20 个临时测试人格。先选择板子和参与人格，再让 Supervisor 按流程推进发言、投票和结算。',
            ].join('\n'),
            timestamp: now + 1,
          },
        ],
      });
      setActiveSessionId(sessionId);
      setHomeSidebarTab('commander');
      setHomeSidebarMode('active');
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      toast('success', '已创建多Agent能力实验室对话');
      return;
    }

    // Plugin intent dispatch — let registered plugins handle their own actions
    if (prompt.startsWith('__HOME_ACTION__:')) {
      const actionId = prompt.replace('__HOME_ACTION__:', '');
      const handled = dispatchHomeAction(actionId, {
        createSession,
        setActiveSessionId,
        setHomeSidebarTab,
        setHomeSidebarMode,
        unlockAutoScroll,
        toast,
      });
      if (handled) {
        unlockAutoScroll();
        setInput('');
        editorRef.current?.clear();
        return;
      }
    }

    if (prompt && prompt.includes('\n')) {
      setInput(prompt);
      editorRef.current?.setContent(prompt);
      editorRef.current?.focus();
      return;
    }

    if (prompt && !prompt.includes('\n')) {
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      sendMessage(prompt);
    }
  }, [loading, openHomeSidebar, stopStreaming, unlockAutoScroll]);

  const handleDebugToggle = useCallback(async (checked: boolean) => {
    setDebugMode(checked);
    if (checked && !debugPrompt) {
      setDebugLoading(true);
      try {
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
        const res = await fetch('/api/chat/debug-prompt', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setDebugPrompt(data?.error ? `加载失败：${data.error}` : `加载失败：HTTP ${res.status}`);
          return;
        }
        if (typeof data?.prompt === 'string' && data.prompt.trim().length > 0) {
          setDebugPrompt(data.prompt);
          return;
        }
        if (typeof data?.error === 'string' && data.error.trim()) {
          setDebugPrompt(`加载失败：${data.error}`);
          return;
        }
        setDebugPrompt('未返回可显示的 System Prompt');
      } catch (error: any) {
        setDebugPrompt(`加载失败：${error?.message || '未知错误'}`);
      } finally {
        setDebugLoading(false);
      }
    }
  }, [debugPrompt]);

  useEffect(() => {
    const starterAction = searchParams.get('starterAction');
    if (!starterAction || starterHandledRef.current) return;

    starterHandledRef.current = true;
    const sidebarTab = searchParams.get('sidebarTab');
    const sessionTitle = searchParams.get('sessionTitle');
    const existingSessionId = searchParams.get('sessionId');
    if (existingSessionId) {
      setActiveSessionId(existingSessionId);
    } else {
      createSession({ title: sessionTitle?.trim() || '新对话' });
    }

    if (sidebarTab === 'agent' || sidebarTab === 'workflow' || sidebarTab === 'commander') {
      openHomeSidebar(sidebarTab);
    }

    if (starterAction === 'create_agent') {
      handleQuickAction('__HOME_ACTION__:create_agent');
    } else if (starterAction === 'create_workflow') {
      handleQuickAction('__HOME_ACTION__:create_workflow');
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete('sessionId');
    nextParams.delete('starterAction');
    nextParams.delete('sidebarTab');
    nextParams.delete('sessionTitle');
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
  }, [createSession, handleQuickAction, pathname, router, searchParams, setActiveSessionId]);

  const messages = activeSession?.messages || [];

  useEffect(() => {
    setHistoryExpanded(false);
  }, [activeSession?.id]);

  const handleEditMessage = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    lastEditSeedRef.current = null;
    setEditingMessageId(messageId);
    setEditContent(msg.content);
    setEditDialogOpen(true);
  }, [messages]);

  const handleConfirmEdit = useCallback(async () => {
    const text = getEditMarkdown();
    if (!editingMessageId || !text) return;

    // Delete the original message and any subsequent messages
    const msgIndex = messages.findIndex(m => m.id === editingMessageId);
    if (msgIndex !== -1) {
      const messagesToDelete = messages.slice(msgIndex);
      for (const msg of messagesToDelete) {
        if (msg.id) {
          deleteMessage(msg.id);
        }
      }
    }

    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    lastEditSeedRef.current = null;
    editEditorRef.current?.clear();
    await sendMessage(text);
  }, [getEditMarkdown, editingMessageId, messages, deleteMessage, sendMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditDialogOpen(false);
    setEditingMessageId(null);
    setEditContent('');
    lastEditSeedRef.current = null;
    editEditorRef.current?.clear();
  }, []);

  // Memoize message callbacks to prevent unnecessary re-renders
  const messageCallbacks = useMemo(() => {
    const callbacks: Record<string, {
      onConfirmAction: (id: string) => void;
      onRejectAction: (id: string) => void;
      onUndoAction: (id: string) => void;
      onRetryAction: (id: string) => void;
    }> = {};
    messages.forEach(msg => {
      callbacks[msg.id] = {
        onConfirmAction: (id) => confirmAction(msg.id, id),
        onRejectAction: (id) => rejectAction(msg.id, id),
        onUndoAction: (id) => undoActionById(msg.id, id),
        onRetryAction: (id) => retryAction(msg.id, id),
      };
    });
    return callbacks;
  }, [messages, confirmAction, rejectAction, undoActionById, retryAction]);

  const handleQuoteMessage = useCallback((messageId: string) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    const collaborationCard = (message.cards || []).find((card: any) => card?.type === 'collaboration_speech');
    const speakerName = collaborationCard?.speakerName
      || (message.role === 'user' ? '用户' : message.role === 'assistant' ? 'AI' : '错误');
    const sourceText = String(message.content || message.rawContent || '').trim();
    if (!sourceText) return;
    const quotedText = sourceText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .slice(0, 30)
      .map((line) => `> ${line}`)
      .join('\n');
    const prefix = editorRef.current?.isEmpty() ? '' : '\n\n';
    const quoteMarkdown = `${prefix}> **${speakerName}：**\n${quotedText}\n\n`;
    editorRef.current?.insertMarkdown(quoteMarkdown);
    editorRef.current?.focus();
  }, [messages]);

  const isChatroomCentralTranscript = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.chatroom);
  const recentWindowSize = useMemo(() => computeAdaptiveRecentWindow(messages as any[], {
    streamingMessageId,
    forceFullWindow: Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled),
    ...(isChatroomCentralTranscript
      ? { minRecentMessages: 100, maxRecentMessages: 100, targetWeight: Number.MAX_SAFE_INTEGER }
      : {}),
  }), [messages, streamingMessageId, activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled, isChatroomCentralTranscript]);

  const renderedMessages = useMemo(() => {
    const hiddenCount = Math.max(0, messages.length - recentWindowSize);
    return messages.map((msg, index) => {
      // 折叠区域的消息：用轻量占位符，不做 Markdown 解析
      if (index < hiddenCount && !historyExpanded) {
        return (
          <div key={msg.id} className="px-4 py-2 text-xs text-muted-foreground truncate">
            {msg.role === 'user' ? '👤 ' : '🤖 '}
            {(msg.content || '').slice(0, 120)}
          </div>
        );
      }
      // assistant 消息：隐藏 <result> 机器通道。streaming 阶段只展示普通正文；
      // 非 streaming 阶段再结合解析结果驱动侧边栏/卡片等结构化行为。
      const isStreaming = msg.id === streamingMessageId;
      let displayMsg = msg;
      let hasSidebarHint = false;
      const isWerewolfMessage = Boolean((msg.cards || []).some((card: any) => card?.type === 'werewolf_speech'));
      if (msg.role === 'assistant' && !isWerewolfMessage) {
        const raw = msg.rawContent || msg.content || '';
        const normalized = normalizeAssistantDisplay(raw, isStreaming);
        hasSidebarHint = normalized.hasSidebarHint;
        if (normalized.hasMachineResult) {
          displayMsg = { ...msg, content: normalized.visibleText };
        }
      }
      return (
        <div key={msg.id} className="pb-4">
          <ChatMessage
            message={displayMsg}
            isStreaming={isStreaming}
            onConfirmAction={messageCallbacks[msg.id]?.onConfirmAction}
            onRejectAction={messageCallbacks[msg.id]?.onRejectAction}
            onUndoAction={messageCallbacks[msg.id]?.onUndoAction}
            onRetryAction={messageCallbacks[msg.id]?.onRetryAction}
            onAction={handleQuickAction}
            onDelete={deleteMessage}
            onRetryFromMessage={msg.role === 'user' ? retryFromMessage : undefined}
            onEditMessage={msg.role === 'user' ? handleEditMessage : undefined}
            onContinue={msg.role === 'error' ? continueFromMessage : undefined}
            onSaveAsNotebook={msg.role === 'assistant' ? handleSaveAssistantMessageAsNotebook : undefined}
            onQuoteMessage={handleQuoteMessage}
            werewolfView={activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolfView}
            currentUser={currentUser}
          />
          {hasSidebarHint && (
            <div className="mt-2 ml-10">
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-[10px] font-medium text-primary">
                <span className="material-symbols-outlined" style={{ fontSize: 12 }}>side_navigation</span>
                已推送侧边栏
              </span>
            </div>
          )}
        </div>
      );
    });
  }, [messages, streamingMessageId, recentWindowSize, historyExpanded, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, handleEditMessage, continueFromMessage, handleSaveAssistantMessageAsNotebook, handleQuoteMessage]);
  const hiddenMessageCount = Math.max(0, messages.length - recentWindowSize);
  const historicalMessageItems = useMemo(() => (
    hiddenMessageCount > 0
      ? messages.slice(0, hiddenMessageCount).map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }))
      : []
  ), [hiddenMessageCount, messages, renderedMessages]);
  const recentMessageItems = useMemo(() => (
    hiddenMessageCount > 0
      ? messages.slice(-recentWindowSize).map((message, index) => ({
        key: message.id,
        node: renderedMessages[hiddenMessageCount + index],
      }))
      : messages.map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }))
  ), [hiddenMessageCount, messages, recentWindowSize, renderedMessages]);
  const historicalMessages = useMemo(
    () => (hiddenMessageCount > 0 ? renderedMessages.slice(0, hiddenMessageCount) : []),
    [hiddenMessageCount, renderedMessages]
  );

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    const pending = pendingHistoryScrollAdjustRef.current;
    if (!scroller || !pending) return;
    pendingHistoryScrollAdjustRef.current = null;
    const nextScrollHeight = scroller.scrollHeight;
    const delta = nextScrollHeight - pending.prevScrollHeight;
    if (Math.abs(delta) < 1) return;
    scroller.scrollTop = Math.max(0, pending.prevScrollTop + delta);
  }, [historyExpanded, hiddenMessageCount]);

  const activeAgentBinding = activeSession?.agentBinding;
  const activeWeChatBinding = activeSession?.sessionWorkbenchState?.wechatBinding;
  const isWerewolfLabMode = Boolean(activeSession?.sessionWorkbenchState?.collaborationRoom?.werewolf?.enabled);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;

    if (isWerewolfLabMode) {
      if (werewolfPreviousDarkClassRef.current === null) {
        werewolfPreviousDarkClassRef.current = root.classList.contains('dark');
      }
      root.classList.add('dark');
      return;
    }

    const previousHadDarkClass = werewolfPreviousDarkClassRef.current;
    if (previousHadDarkClass === null) return;
    werewolfPreviousDarkClassRef.current = null;
    if (previousHadDarkClass) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [activeSession?.id, isWerewolfLabMode]);

  const activeAgentAvatarSrc = activeAgentBinding
    ? resolveAgentAvatarSrc(undefined, activeAgentBinding.agentName, {
        team: activeAgentBinding.team || 'red',
        roleType: activeAgentBinding.roleType || 'normal',
      })
    : null;

  return (
    <div
      ref={containerRef}
      className={cn(
        'h-screen flex overflow-hidden bg-background',
        isWerewolfLabMode && 'werewolf-wood-bg'
      )}
    >
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={
            isMobile
              ? 'fixed inset-y-0 left-0 z-40 bg-background'
              : 'relative shrink-0'
          }
          style={{ width: isMobile ? `${Math.min(sidebarWidth, 320)}px` : `${sidebarWidth}px` }}
        >
          <ChatSidebar />
          {/* Resize handle (desktop only) */}
          {!isMobile && (
            <div
              className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:w-1.5 transition-all ${
                isResizing ? 'bg-primary w-1.5' : 'bg-border hover:bg-primary/60'
              }`}
              onMouseDown={e => { e.preventDefault(); setIsResizing(true); }}
            />
          )}
        </div>
      )}

      <div className={cn('flex-1 flex flex-col min-w-0', isWerewolfLabMode && 'werewolf-wood-main')}>
        {/* Top bar */}
        <div
          className={cn(
            'flex items-center justify-between px-4 py-2 border-b bg-background/80 backdrop-blur shrink-0',
            isWerewolfLabMode && 'werewolf-wood-panel border-stone-700/60 bg-stone-900/35'
          )}
        >
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>menu</span>
            </Button>
            {activeAgentBinding ? (
              <div className="hidden sm:flex items-center gap-3 rounded-full border border-border/70 bg-card/90 px-2 py-1.5">
                <Avatar className="h-8 w-8 ring-1 ring-border/70">
                  <AvatarImage src={activeAgentAvatarSrc || undefined} alt={activeAgentBinding.agentName} />
                  <AvatarFallback>{activeAgentBinding.agentName.slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="flex items-center gap-2">
                  <div className="text-xs">
                    <div className="font-medium text-foreground">当前对话角色：{activeAgentBinding.agentName}</div>
                  </div>
                  <Badge variant="outline" className={getAgentBindingBadgeClass(activeAgentBinding.team)}>
                    {getAgentBindingTeamLabel(activeAgentBinding.team)}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => createSession({ title: '新对话' })}
                >
                  退出角色
                </Button>
              </div>
            ) : null}
            <Button
              size="sm"
              variant={activeWeChatBinding ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => setWeChatBindDialogOpen(true)}
              title="绑定当前首页对话到微信 Bot"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>forum</span>
              <span>微信 Bot</span>
              {activeWeChatBinding ? (
                <span className="ml-2 hidden sm:inline text-xs opacity-90">
                  {activeWeChatBinding.externalConversationId}
                </span>
              ) : null}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleSaveConversationAsNotebook}
              disabled={!activeSession || notebookExporting || messages.length === 0}
              title="保存当前会话为 Notebook"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '18px', marginRight: '4px' }}>note_add</span>
              <span className="hidden sm:inline">保存为 Notebook</span>
            </Button>
            <ThemeToggle />
            <Button size="sm" variant="outline" onClick={() => router.push('/dashboard')} title="切换到控制台">
              <span className="material-symbols-outlined" style={{ fontSize: '20px', marginRight: '4px' }}>dashboard</span>
              <span className="hidden sm:inline">控制台</span>
            </Button>
            <UserMenu user={currentUser} />
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <ResizablePanelGroup
            orientation="horizontal"
            className={cn('h-full', isWerewolfLabMode && 'werewolf-wood-main')}
            onLayoutChanged={handleHomeSidebarLayout}
          >
            <ResizablePanel id="home-main-panel" defaultSize={homeSidebarMode === 'active' ? `${100 - homeSidebarSize}%` : '100%'} minSize="42%">
              <div className={cn('flex h-full min-h-0 flex-col', isWerewolfLabMode && 'werewolf-wood-main')}>
                <div className="flex-1 relative min-h-0">
                  <div
                    ref={scrollContainerRef}
                    className={cn(
                      'home-chat-scroll absolute inset-0 overflow-y-auto px-4 py-6 md:px-8 lg:px-16',
                      isWerewolfLabMode && 'werewolf-wood-main'
                    )}
                  >
                    {messages.length === 0 && sessionLoadingId === activeSessionId ? (
                      <div className="flex h-full items-center justify-center">
                        <div className="home-chat-surface flex items-center gap-3 rounded-2xl px-4 py-3 text-sm text-muted-foreground">
                          <span className="material-symbols-outlined animate-spin text-base text-primary">progress_activity</span>
                          <span>正在加载对话...</span>
                        </div>
                      </div>
                    ) : messages.length === 0 && !loading && (
                      <div className="flex flex-col items-center justify-center h-full gap-8">
                        <div className="text-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
                            className="inline-flex p-3 mb-4"
                          >
                            <RobotLogo size={56} className="animate-robotPulse" />
                          </motion.div>
                          <motion.h2
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-2xl font-bold bg-gradient-to-r from-primary via-blue-500 to-purple-500 bg-clip-text text-transparent mb-2"
                          >
                            ACEHarness Multi-Agent 助手
                          </motion.h2>
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.1 }}
                            className="text-sm text-muted-foreground"
                          >
                            {activeAgentBinding?.agentName
                              ? `当前正在与 Agent「${activeAgentBinding.agentName}」对话`
                              : '通过对话实现全流程 Multi-Agent 智能编排'}
                          </motion.p>
                          <motion.span
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="mt-1 text-xs text-muted-foreground/60"
                          >
                            v{pkgJson.version}
                          </motion.span>
                        </div>
                        <QuickActions onAction={handleQuickAction} skillSettings={skillSettings} />
                      </div>
                    )}
                    <MessageHistoryCollapse
                      hiddenCount={hiddenMessageCount}
                      recentCount={recentWindowSize}
                      open={historyExpanded}
                      onOpenChange={(open) => {
                        const scroller = scrollContainerRef.current;
                        pendingHistoryScrollAdjustRef.current = scroller
                          ? { prevScrollHeight: scroller.scrollHeight, prevScrollTop: scroller.scrollTop }
                          : null;
                        setHistoryExpanded(open);
                      }}
                      hiddenContent={
                        historyExpanded
                          ? <VirtualMessageList items={historicalMessageItems} scrollContainerRef={scrollContainerRef} itemGap={0} />
                          : historicalMessages
                      }
                      recentContent={<VirtualMessageList items={recentMessageItems} scrollContainerRef={scrollContainerRef} itemGap={0} />}
                    />
                    <div ref={messagesEndRef} />
                  </div>
                  {showScrollBtn && (
                    <button
                      onClick={scrollToBottom}
                      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/20 bg-background/92 px-3 py-1.5 text-xs text-foreground backdrop-blur-md transition-colors duration-150 hover:bg-background"
                    >
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: '16px' }}>arrow_downward</span>
                      新消息
                    </button>
                  )}
                </div>

                <div
                  className={cn(
                    'home-chat-input-tray shrink-0 border-t px-4 py-3 md:px-8 lg:px-16',
                    isWerewolfLabMode && 'werewolf-wood-panel border-stone-700/60 bg-stone-950/35'
                  )}
                >
                  {messages.length > 0 && (
                    <div className="mx-auto mb-2 max-w-4xl rounded-2xl border border-border/60 bg-background/70 px-2 py-2 backdrop-blur-sm">
                      <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
                    </div>
                  )}
                  <div className="mx-auto flex max-w-4xl items-stretch gap-2">
                    <div className="flex-1">
                      <RichTextEditor
                        ref={editorRef}
                        content={input}
                        onEnter={handleEditorEnter}
                        onChange={(markdown) => setInput(markdown)}
                        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                        minHeight={76}
                        className="[&_.ProseMirror]:text-[13px] [&_.ProseMirror]:leading-5 [&_.ProseMirror_p]:my-0.5 [&_.ProseMirror_h1]:!text-base [&_.ProseMirror_h2]:!text-sm"
                        disabled={false}
                        autoFocus={false}
                        showFullscreenToggle={!isMobile}
                        showToolbar={false}
                        mentionItems={mainInputMentionItems}
                        trimPastedTrailingNewlines
                        footerContent={(
                          <>
                            <button
                              onClick={() => handleDebugToggle(!debugMode)}
                              className={`inline-flex items-center gap-1 text-[10px] transition-colors ${debugMode ? 'text-green-400' : 'text-muted-foreground hover:text-foreground'}`}
                              title="调试模式：查看发送给 AI 的系统提示词"
                            >
                              <span className="material-symbols-outlined text-sm">bug_report</span>
                              调试
                            </button>
                            <Switch checked={debugMode} onCheckedChange={handleDebugToggle} className="scale-75" />
                            <div className="w-24 shrink-0 sm:w-32">
                              <EngineModelSelect engine={engine} model={model} onEngineChange={setEngine} onModelChange={setModel} className="h-6 text-[9px]" />
                            </div>
                          </>
                        )}
                      />
                    </div>
                    {loading && (
                      <Button className="h-[76px] self-stretch rounded-2xl border border-destructive/20 px-3 transition-colors duration-150" variant="destructive" onClick={stopStreaming} title="停止生成">
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>stop</span>
                      </Button>
                    )}
                    <Button className="h-[76px] self-stretch rounded-2xl px-4 transition-colors duration-150" onClick={handleSend} disabled={!getInputMarkdown()}>
                      <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>send</span>
                    </Button>
                  </div>
                </div>
              </div>
            </ResizablePanel>

            {homeSidebarMode === 'active' ? (
              <>
                <ResizableHandle
                  withHandle
                  className="hidden lg:flex"
                  onClickHandle={closeHomeSidebar}
                />

                <ResizablePanel
                  id="home-command-sidebar-panel"
                  defaultSize={`${homeSidebarSize}%`}
                  minSize={`${MIN_HOME_SIDEBAR_SIZE}%`}
                  maxSize={`${MAX_HOME_SIDEBAR_SIZE}%`}
                  className="hidden lg:block"
                >
                  <HomeCommandSidebar
                    engine={effectiveEngine || engine}
                    model={model}
                    onQuickPrompt={handleQuickAction}
                    activeSessionId={activeSessionId}
                    activeSession={activeSession}
                    sessionWorkbenchState={activeSession?.sessionWorkbenchState}
                    setSessionWorkbenchState={setSessionWorkbenchState}
                    appendSessionMessage={appendSessionMessage}
                    updateSessionMessage={updateSessionMessage}
                    setStreamingMessageId={setStreamingMessageId}
                    markSessionStreaming={markSessionStreaming}
                    unmarkSessionStreaming={unmarkSessionStreaming}
                    onRegisterCollaborationHandler={(handler) => { collaborationMessageHandlerRef.current = handler; }}
                    sidebarHint={latestSidebarHint}
                    activeTab={homeSidebarTab}
                    onTabChange={handleHomeSidebarTabChange}
                    availableTabs={availableHomeSidebarTabs}
                    onCollapse={closeHomeSidebar}
                    onExpand={() => openHomeSidebar(homeSidebarTab)}
                    expanded={homeSidebarMode === 'active'}
                    ensureSessionId={createSession}
                    werewolfMode={isWerewolfLabMode}
                  />
                </ResizablePanel>
              </>
            ) : homeSidebarMode === 'peek' ? (
              <div className={cn('hidden lg:flex items-start border-l bg-card/20', isWerewolfLabMode && 'werewolf-wood-panel border-l-stone-700/60')}>
                <button
                  type="button"
                  className={cn(
                    'm-2 flex min-h-32 w-16 flex-col items-center justify-center gap-2 rounded-2xl border bg-background/82 px-2 py-4 text-[12px] text-muted-foreground backdrop-blur-sm transition-colors duration-150 hover:text-foreground',
                    isWerewolfLabMode && 'border-stone-600/70 bg-stone-950/35 text-stone-300 hover:text-stone-100'
                  )}
                  onClick={() => openHomeSidebar(homeSidebarTab)}
                  title="展开首页动态侧边栏"
                >
                  <span className="material-symbols-outlined text-3xl">right_panel_open</span>
                  <span className="[writing-mode:vertical-rl] tracking-[0.2em]">
                    {homeSidebarTab === 'commander' ? '指挥官' : homeSidebarTab === 'workflow' ? '工作流' : 'Agent'}
                  </span>
                </button>
              </div>
            ) : null}
          </ResizablePanelGroup>
        </div>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
            <DialogContent
            className="max-w-2xl overflow-hidden p-0 flex flex-col gap-0"
            resizableHeight
            defaultHeight={500}
            minHeight={360}
            maxHeight={820}
            onPointerDownOutside={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-rich-text-editor-fullscreen]')) {
                event.preventDefault();
              }
            }}
            onInteractOutside={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest('[data-rich-text-editor-fullscreen]')) {
                event.preventDefault();
              }
            }}
          >
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle>编辑消息</DialogTitle>
            </DialogHeader>
            <div className="min-h-0 flex-1 px-6 py-4">
              {editDialogOpen && (
                <RichTextEditor
                  ref={editEditorRef}
                  content={editContent}
                  onChange={(markdown) => setEditContent(markdown)}
                  placeholder="输入消息内容..."
                  minHeight={280}
                  maxHeight={340}
                  autoFocus
                  showFullscreenToggle={true}
                  showToolbar={false}
                  className="h-full"
                />
              )}
            </div>
            <DialogFooter className="border-t px-6 py-4">
              <Button variant="outline" onClick={handleCancelEdit}>取消</Button>
              <Button onClick={handleConfirmEdit}>发送</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={debugMode} onOpenChange={setDebugMode}>
          <DialogContent
            className="max-w-3xl overflow-hidden p-0 flex flex-col gap-0"
            resizableHeight
            defaultHeight={620}
            minHeight={360}
            maxHeight={900}
          >
            <DialogHeader className="border-b px-6 py-4">
              <DialogTitle>System Prompt（实时）</DialogTitle>
            </DialogHeader>
            <pre className="min-h-0 flex-1 overflow-y-auto bg-black px-6 py-5 text-xs leading-relaxed text-green-300 whitespace-pre-wrap break-words">
              {debugLoading ? '加载中...' : (debugPrompt || '')}
            </pre>
          </DialogContent>
        </Dialog>

        <NotebookSaveDialog
          open={exportDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              closeNotebookExportDialog();
              return;
            }
            setExportDialogOpen(true);
          }}
          title="保存为 Notebook"
          confirmLabel="创建"
          scope={exportScope}
          onScopeChange={setExportScope}
          directory={exportDirectory}
          onDirectoryChange={setExportDirectory}
          directories={[]}
          saving={notebookExporting}
          previewText={`将保存到：${exportDirectory ? `${exportDirectory}/` : ''}${normalizeNotebookFileName(exportFileName) || normalizeNotebookFileName(createDefaultNotebookBaseName())}`}
          extraContent={(
            <div className="space-y-2">
              <Input
                value={exportFileName}
                onChange={(e) => setExportFileName(e.target.value)}
                placeholder="可选：输入文件名（无需 .cj.md）"
                disabled={notebookExporting}
              />
              <p className="text-xs text-muted-foreground">可不填文件名；系统会自动使用当前时间。你输入时也无需带 .cj.md 后缀。</p>
            </div>
          )}
          onConfirm={handleConfirmNotebookExport}
        />
        {workspaceEditorPath && (
          <WorkspaceEditor
            open={workspaceEditorOpen}
            onOpenChange={setWorkspaceEditorOpen}
            workspacePath={workspaceEditorPath}
            initialFilePath={workspaceEditorFilePath}
            title={workspaceEditorTitle}
          />
        )}
      </div>

      <WeChatSessionBindDialog
        open={wechatBindDialogOpen}
        onOpenChange={setWeChatBindDialogOpen}
        activeSession={activeSession}
        origin={origin}
        onBindingSaved={({ integration, binding, targetLabel, accountId }) => {
          setSessionWorkbenchState((prev) => ({
            ...(prev || {}),
            wechatBinding: {
              integrationId: integration.id,
              integrationName: integration.name,
              bindingId: binding.id,
              accountId,
              externalConversationId: binding.externalConversationId,
              externalConversationName: binding.externalConversationName,
              bindingType: binding.bindingType,
              targetLabel,
              webhookPath: integration.webhookPath,
              secret: integration.secret,
              updatedAt: Date.now(),
            },
          }));
        }}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <AuthGuard>
      <ChatPageContent />
    </AuthGuard>
  );
}
