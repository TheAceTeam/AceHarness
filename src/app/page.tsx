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
import { Switch } from '@/components/ui/switch';
import { workspaceApi, type NotebookScope } from '@/lib/api';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { buildNotebookFromConversation, buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat-notebook';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ChatSidebar from '@/components/chat/ChatSidebar';
import ChatMessage, { RobotLogo } from '@/components/chat/ChatMessage';
import { MessageHistoryCollapse } from '@/components/chat/MessageHistoryCollapse';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import HomeCommandSidebar from '@/components/chat/HomeCommandSidebar';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import AuthGuard from '@/components/AuthGuard';
import UserMenu from '@/components/UserMenu';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { parseActions } from '@/lib/chat-actions';
import {
  inferHomeSidebarMode,
  inferHomeSidebarTab,
  type HomeSidebarHint,
  type HomeSidebarMode,
  type HomeSidebarTab,
} from '@/lib/home-sidebar-state';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { resolveAgentAvatarSrc } from '@/lib/agent-personas';
import { computeAdaptiveRecentWindow } from '@/lib/chat-message-window';

// 动态导入 RichTextEditor - TipTap 是重量级库，延迟加载
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 h-[76px] rounded-xl border border-input bg-background animate-pulse" />
  ),
});

const SIDEBAR_STORAGE_KEY = 'chat-sidebar-width';

const WorkspaceEditor = dynamic(() => import('@/components/workspace/WorkspaceEditor').then(m => m.WorkspaceEditor), {
  ssr: false,
});
const DEFAULT_WIDTH = 264;
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const MOBILE_BREAKPOINT = 768;
type AgentBindingTeam = 'blue' | 'red' | 'judge' | 'black-gold' | 'yellow';

function getAgentBindingTeamLabel(team?: AgentBindingTeam) {
  const normalized = team === 'yellow' ? 'judge' : team;
  switch (normalized) {
    case 'blue':
      return '蓝队';
    case 'red':
      return '红队';
    case 'judge':
      return '黄队';
    case 'black-gold':
      return '指挥官';
    default:
      return 'Agent';
  }
}

function getAgentBindingBadgeClass(team?: AgentBindingTeam) {
  const normalized = team === 'yellow' ? 'judge' : team;
  switch (normalized) {
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
  const {
    activeSessionId, activeSession, sessions, createSession, setActiveSessionId, sendMessage, stopStreaming,
    deleteMessage, retryFromMessage, continueFromMessage,
    loading, streamingMessageId,
    model, setModel, engine, effectiveEngine, setEngine,
    confirmAction, rejectAction, undoActionById, retryAction,
    skillSettings, setSessionWorkbenchState,
  } = useChat();
  const { toast } = useToast();
  const [input, setInput] = useState('');
  const [notebookExporting, setNotebookExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [pendingExport, setPendingExport] = useState<{ type: 'conversation' } | { type: 'assistant'; messageId: string } | null>(null);
  const [exportFileName, setExportFileName] = useState('');
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [exportDirectory, setExportDirectory] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [editorLoaded, setEditorLoaded] = useState(false);
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
  const editorLoadedRef = useRef(false);
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
  const starterHandledRef = useRef(false);
  const starterPromptRef = useRef<string | null>(null);

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
  const derivedHomeSidebarTab = useMemo(
    () => inferHomeSidebarTab(latestSidebarHint, {
      hasWorkflowBinding: Boolean(activeSession?.workflowBinding),
      hasCreationSession: Boolean(activeSession?.creationSession),
    }),
    [activeSession?.creationSession, activeSession?.workflowBinding, latestSidebarHint]
  );
  const derivedHomeSidebarMode = useMemo(
    () => inferHomeSidebarMode(latestSidebarHint, {
      hasWorkflowBinding: Boolean(activeSession?.workflowBinding),
      hasCreationSession: Boolean(activeSession?.creationSession),
    }),
    [activeSession?.creationSession, activeSession?.workflowBinding, latestSidebarHint]
  );

  const sessionScopedSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>();
    if (activeSession?.workflowBinding) {
      tabs.add('commander');
      tabs.add('workflow');
    }
    if (activeSession?.creationSession) {
      tabs.add('workflow');
    }
    for (const tab of latestSidebarHint?.tabs || []) {
      // commander tab 仅在有 workflowBinding 时才有意义
      if (tab === 'commander' && !activeSession?.workflowBinding) continue;
      tabs.add(tab);
    }
    if (tabs.size === 0 && activeSession?.workflowBinding) tabs.add('commander');
    if (tabs.size === 0 && latestSidebarHint) tabs.add(derivedHomeSidebarTab);
    return Array.from(tabs);
  }, [activeSession?.creationSession, activeSession?.workflowBinding, derivedHomeSidebarTab, latestSidebarHint, latestSidebarHint?.tabs]);

  const availableHomeSidebarTabs = useMemo<HomeSidebarTab[]>(() => {
    const tabs = new Set<HomeSidebarTab>(sessionScopedSidebarTabs);
    if (tabs.size === 0 && derivedHomeSidebarMode === 'active') {
      tabs.add(derivedHomeSidebarTab);
    }
    return Array.from(tabs);
  }, [derivedHomeSidebarMode, derivedHomeSidebarTab, sessionScopedSidebarTabs]);

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
    setHomeSidebarTab((prev) => (prev === derivedHomeSidebarTab ? prev : derivedHomeSidebarTab));
    setHomeSidebarMode((prev) => (prev === derivedHomeSidebarMode ? prev : derivedHomeSidebarMode));
  }, [derivedHomeSidebarMode, derivedHomeSidebarTab]);

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
    const nextTab = hintedTab && sessionScopedSidebarTabs.includes(hintedTab)
      ? hintedTab
      : sessionScopedSidebarTabs[0] || 'commander';

    setHomeSidebarTab(nextTab);

    if (latestSidebarHint?.mode) {
      setHomeSidebarMode(latestSidebarHint.mode);
      return;
    }

    if (sessionScopedSidebarTabs.length > 0) {
      setHomeSidebarMode('peek');
      return;
    }

    setHomeSidebarMode('hidden');
  }, [activeSession?.id, isMobile, latestSidebarHint?.activeTab, latestSidebarHint?.mode, sessionScopedSidebarTabs]);

  useEffect(() => {
    if (isMobile) return;
    const binding = activeSession?.workflowBinding;
    const creation = activeSession?.creationSession;
    const hasSidebarContext = Boolean(binding || creation);
    const hintedTab = latestSidebarHint?.activeTab;
    const fallbackTab = availableHomeSidebarTabs[0] || null;
    const nextTab = hintedTab && availableHomeSidebarTabs.includes(hintedTab)
      ? hintedTab
      : fallbackTab;

    if (nextTab) {
      setHomeSidebarTab((prev) => (prev === nextTab ? prev : nextTab));
    }

    if (latestSidebarHint?.mode) {
      setHomeSidebarMode(latestSidebarHint.mode);
      return;
    }

    if (hasSidebarContext && availableHomeSidebarTabs.length > 0) {
      setHomeSidebarMode('peek');
    } else if (hasMessages) {
      setHomeSidebarMode('hidden');
    }
  }, [
    activeSession?.creationSession,
    activeSession?.id,
    activeSession?.workflowBinding,
    availableHomeSidebarTabs,
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
    editorRef.current?.focus();
  }, [activeSession?.id]);

  useEffect(() => {
    if (!editorLoaded && editorRef.current) {
      setEditorLoaded(true);
      editorLoadedRef.current = true;
    }
  }, [editorLoaded, activeSession?.id, input]);

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
        team: (team === 'blue' || team === 'red' || team === 'judge' || team === 'black-gold' || team === 'yellow') ? team : undefined,
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

    starterPromptRef.current = starterPrompt;
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

  useEffect(() => {
    if (!starterPromptRef.current || !editorRef.current) return;
    editorRef.current.setContent(starterPromptRef.current);
    editorRef.current.focus();
    starterPromptRef.current = null;
  }, [editorLoaded]);

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
    if (patch.tab) setHomeSidebarTab(patch.tab);
    if (patch.mode) setHomeSidebarMode(patch.mode);
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: {
        type: 'home_sidebar',
        ...(prev?.homeSidebar || {}),
        ...(patch.tab ? { activeTab: patch.tab } : {}),
        ...(patch.mode ? { mode: patch.mode } : {}),
        ...(patch.intent ? { intent: patch.intent } : {}),
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(patch.reason !== undefined ? { reason: patch.reason } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
        ...(patch.shouldOpenModal !== undefined ? { shouldOpenModal: patch.shouldOpenModal } : {}),
      },
    }));
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
    const hasSidebarContext = Boolean(activeSession?.workflowBinding || activeSession?.creationSession);
    applyHomeSidebarState({ mode: hasSidebarContext ? 'peek' : 'hidden' });
  }, [activeSession?.creationSession, activeSession?.workflowBinding, applyHomeSidebarState]);

  const handleHomeSidebarTabChange = useCallback((tab: HomeSidebarTab) => {
    applyHomeSidebarState({ tab });
  }, [applyHomeSidebarState]);

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
    if (loading) {
      stopStreaming();
      await Promise.resolve();
    }
    await sendMessage(normalized);
    editorRef.current?.focus();
  }, [deleteMessage, editingMessageId, loading, sendMessage, stopStreaming, unlockAutoScroll]);

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
      const hiddenPrompt = [
        '这是一次来自首页按钮的“创建工作流”界面动作，不是用户新增的一条需求内容。',
        '你必须只根据当前已有对话历史来提取真实需求、约束、工作目录、参考工作流、目标、范围、技术栈、已有角色分工，不要把本条指令本身写进 workflowDraft.requirements 或 description。',
        '请把能确认的上下文尽量整理进 home_sidebar：summary、knownFacts、missingFields、questions、recommendedNextAction、workflowDraft。',
        '如果要输出 shouldOpenModal=true 的 home_sidebar，它必须作为整条回复最后一个 <result> 块输出；输出后不要再追加正文。',
        '如果信息不足，请先提出最少量的澄清问题，不要编造需求。',
      ].join('\n');
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      void sendMessage(hiddenPrompt, { displayText: '创建工作流' });
      return;
    }

    if (prompt === '__HOME_ACTION__:create_agent') {
      openHomeSidebar('agent', 'create-agent', 'clarifying', { shouldOpenModal: true });
      const hiddenPrompt = [
        '这是一次来自首页按钮的“创建 Agent”界面动作，不是用户新增的一条职责需求内容。',
        '你必须只根据当前已有对话历史来提取这个 Agent 的真实职责、风格、能力边界、输入输出、协作对象、参考 workflow 和工作目录，不要把本条指令本身写进 agentDraft.mission 或 style。',
        '请把能确认的上下文尽量整理进 home_sidebar：summary、knownFacts、missingFields、questions、recommendedNextAction、agentDraft。',
        '如果要输出 shouldOpenModal=true 的 home_sidebar，它必须作为整条回复最后一个 <result> 块输出；输出后不要再追加正文。',
        '如果信息不足，请先提出最少量的澄清问题，不要编造职责。',
      ].join('\n');
      unlockAutoScroll();
      setInput('');
      editorRef.current?.clear();
      if (loading) stopStreaming();
      void sendMessage(hiddenPrompt, { displayText: '创建 Agent' });
      return;
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
  }, [loading, openHomeSidebar, sendMessage, stopStreaming, unlockAutoScroll]);

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

  const recentWindowSize = useMemo(() => computeAdaptiveRecentWindow(messages as any[], {
    streamingMessageId,
  }), [messages, streamingMessageId]);

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
      return (
        <ChatMessage
          key={msg.id}
          message={msg}
          isStreaming={msg.id === streamingMessageId}
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
        />
      );
    });
  }, [messages, streamingMessageId, recentWindowSize, historyExpanded, messageCallbacks, handleQuickAction, deleteMessage, retryFromMessage, handleEditMessage, continueFromMessage, handleSaveAssistantMessageAsNotebook]);
  const hiddenMessageCount = Math.max(0, messages.length - recentWindowSize);
  const historicalMessageItems = hiddenMessageCount > 0
    ? messages.slice(0, hiddenMessageCount).map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }))
    : [];
  const recentMessageItems = hiddenMessageCount > 0
    ? messages.slice(-recentWindowSize).map((message, index) => ({
        key: message.id,
        node: renderedMessages[hiddenMessageCount + index],
      }))
    : messages.map((message, index) => ({
        key: message.id,
        node: renderedMessages[index],
      }));
  const historicalMessages = hiddenMessageCount > 0 ? renderedMessages.slice(0, hiddenMessageCount) : [];

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
  const activeAgentAvatarSrc = activeAgentBinding
    ? resolveAgentAvatarSrc(undefined, activeAgentBinding.agentName, {
        team: (activeAgentBinding.team === 'yellow' ? 'judge' : activeAgentBinding.team) || 'blue',
        roleType: activeAgentBinding.roleType || 'normal',
      })
    : null;

  return (
    <div ref={containerRef} className="h-screen flex overflow-hidden bg-background">
      {/* Mobile overlay backdrop */}
      {isMobile && sidebarOpen && (
        <div className="fixed inset-0 bg-black/40 z-30" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      {sidebarOpen && (
        <div
          className={
            isMobile
              ? 'fixed inset-y-0 left-0 z-40 bg-background shadow-xl'
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

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b bg-background/80 backdrop-blur shrink-0">
          <div className="flex items-center gap-2">
            <Button size="icon" variant="ghost" onClick={() => setSidebarOpen(p => !p)} title="切换侧边栏">
              <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>menu</span>
            </Button>
            {activeAgentBinding ? (
              <div className="hidden sm:flex items-center gap-3 rounded-full border border-border/70 bg-card/90 px-2 py-1.5 shadow-sm">
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
            <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话">
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>add</span>
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
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={homeSidebarMode === 'active' ? 74 : 100} minSize={42}>
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex-1 relative min-h-0">
                  <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 py-6 md:px-8 lg:px-16">
                    {messages.length === 0 && !loading && (
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
                          ? <VirtualMessageList items={historicalMessageItems} scrollContainerRef={scrollContainerRef} />
                          : historicalMessages
                      }
                      recentContent={<VirtualMessageList items={recentMessageItems} scrollContainerRef={scrollContainerRef} />}
                    />
                    <div ref={messagesEndRef} />
                  </div>
                  {showScrollBtn && (
                    <button
                      onClick={scrollToBottom}
                      className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/90 text-primary-foreground text-xs shadow-lg hover:bg-primary transition-colors"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>arrow_downward</span>
                      新消息
                    </button>
                  )}
                </div>

                <div className="shrink-0 border-t bg-background/80 backdrop-blur px-4 py-3 md:px-8 lg:px-16">
                  {messages.length > 0 && (
                    <div className="mb-2 max-w-4xl mx-auto">
                      <QuickActionsBar onAction={handleQuickAction} skillSettings={skillSettings} />
                    </div>
                  )}
                  <div className="flex items-stretch gap-2 max-w-4xl mx-auto">
                    <div className="flex-1">
                      <RichTextEditor
                        ref={editorRef}
                        onEnter={handleEditorEnter}
                        onChange={(markdown) => setInput(markdown)}
                        placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                        minHeight={76}
                        disabled={false}
                        autoFocus={false}
                        showFullscreenToggle={!isMobile}
                        showToolbar={false}
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
                      <Button className="rounded-xl h-[76px] self-stretch px-3" variant="destructive" onClick={stopStreaming} title="停止生成">
                        <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>stop</span>
                      </Button>
                    )}
                    <Button className="rounded-xl h-[76px] self-stretch px-4" onClick={handleSend} disabled={!getInputMarkdown()}>
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
                  defaultSize={26}
                  minSize={20}
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
                    sidebarHint={latestSidebarHint}
                    activeTab={homeSidebarTab}
                    onTabChange={handleHomeSidebarTabChange}
                    availableTabs={availableHomeSidebarTabs}
                    onCollapse={closeHomeSidebar}
                    onExpand={() => openHomeSidebar(homeSidebarTab)}
                    expanded={homeSidebarMode === 'active'}
                    ensureSessionId={createSession}
                  />
                </ResizablePanel>
              </>
            ) : homeSidebarMode === 'peek' ? (
              <div className="hidden lg:flex items-start border-l bg-card/20">
                <button
                  type="button"
                  className="m-2 flex min-h-24 w-12 flex-col items-center justify-center gap-2 rounded-2xl border bg-background/80 px-2 py-3 text-[11px] text-muted-foreground transition hover:text-foreground"
                  onClick={() => openHomeSidebar(homeSidebarTab)}
                  title="展开首页动态侧边栏"
                >
                  <span className="material-symbols-outlined text-base">right_panel_open</span>
                  <span className="[writing-mode:vertical-rl] rotate-180 tracking-[0.2em]">
                    {homeSidebarTab === 'commander' ? '指挥官' : homeSidebarTab === 'workflow' ? '工作流' : 'Agent'}
                  </span>
                </button>
              </div>
            ) : null}
          </ResizablePanelGroup>
        </div>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>编辑消息</DialogTitle>
            </DialogHeader>
            <div className="min-h-[200px]">
              <RichTextEditor
                ref={editEditorRef}
                content={editContent}
                onChange={(markdown) => setEditContent(markdown)}
                placeholder="输入消息内容..."
                minHeight={200}
                maxHeight={400}
                autoFocus
                showFullscreenToggle={true}
                showToolbar={false}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleCancelEdit}>取消</Button>
              <Button onClick={handleConfirmEdit}>发送</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={debugMode} onOpenChange={setDebugMode}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>System Prompt（实时）</DialogTitle>
            </DialogHeader>
            <pre className="max-h-[60vh] overflow-y-auto rounded-xl border bg-black p-4 text-xs leading-relaxed text-green-300 whitespace-pre-wrap break-words">
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
