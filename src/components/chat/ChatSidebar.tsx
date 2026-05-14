'use client';

import { useEffect, useState, useMemo } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { runsApi, workflowApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
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
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { Pin } from 'lucide-react';
import {
  buildWorkflowConversationDirectory,
  getCreationSessionStatusLabel,
  getWorkbenchSessionKind,
  type ChatSessionSummaryLike,
} from '@/lib/agent/conversations';
import type { HumanQuestion } from '@/lib/run/state-persistence';
import { RobotLogo } from './ChatMessage';

type SkillItem = {
  name: string;
  label: string;
  description: string;
  source?: string;
  tags?: string[];
};

type SidebarSession = ChatSessionSummaryLike & {
  agentBinding?: {
    agentName: string;
  };
  sessionWorkbenchState?: any;
};

type WorkflowBucketKey = 'active' | 'archived';

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

function hasWeChatBinding(session?: Pick<SidebarSession, 'sessionWorkbenchState'> | null): boolean {
  return Boolean(session?.sessionWorkbenchState?.wechatBinding);
}

function compareSidebarSessions(a: SidebarSession, b: SidebarSession): number {
  const aPinned = hasWeChatBinding(a);
  const bPinned = hasWeChatBinding(b);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

function isActiveRunStatus(status?: string): boolean {
  return status === 'preparing' || status === 'running' || status === 'pending';
}

function getWorkflowSessionConfigFile(session: SidebarSession, relatedBinding = session.workflowBinding): string {
  return relatedBinding?.configFile || session.creationSession?.filename || '未命名工作流';
}

function getWorkflowSessionName(session: SidebarSession, relatedBinding = session.workflowBinding): string {
  return session.creationSession?.workflowName || relatedBinding?.configFile || session.title || getWorkflowSessionConfigFile(session, relatedBinding);
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
  activeSessionId: string | null;
  pendingQuestionCount: number;
  runStatusById: Record<string, string>;
  relatedBinding?: SidebarSession['workflowBinding'];
}): WorkflowBucketKey {
  const { session, activeSessionId, pendingQuestionCount, runStatusById, relatedBinding = session.workflowBinding } = input;
  const runId = relatedBinding?.runId;
  const runStatus = runId ? runStatusById[runId] : '';
  if (runId) {
    if (isActiveRunStatus(runStatus)) {
      if (pendingQuestionCount > 0) return 'active';
      if (session.id === activeSessionId && relatedBinding) return 'active';
      return 'active';
    }
    return 'archived';
  }
  return 'archived';
}

export default function ChatSidebar() {
  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    createSession,
    deleteSession,
    renameSession,
    loading,
    activeStreamingSessionIds = [],
    recentlyCompletedSessionIds = [],
    sessionLoadingId,
    skillSettings,
    discoveredSkills,
    toggleSkill,
    setSkillsEnabled,
  } = useChat();
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [sessionView, setSessionView] = useState<'chat' | 'runs'>('chat');
  const [manageMode, setManageMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [sessionSearchByView, setSessionSearchByView] = useState({ chat: '', runs: '' });
  const [pendingHumanQuestions, setPendingHumanQuestions] = useState<HumanQuestion[]>([]);
  const [runStatusById, setRunStatusById] = useState<Record<string, string>>({});
  const { confirm, dialogProps } = useConfirmDialog();

  const enabledCount = discoveredSkills.filter(s => !!skillSettings[s.name]).length;
  const groupedSessions = useMemo(() => {
    const workflowRelatedSessionIds = new Set<string>();
    for (const session of sessions as SidebarSession[]) {
      const binding = session.workflowBinding;
      if (!binding) continue;
      workflowRelatedSessionIds.add(session.id);
      if (binding.supervisorSessionId) workflowRelatedSessionIds.add(binding.supervisorSessionId);
      for (const sessionId of Object.values(binding.attachedAgentSessions || {})) {
        if (sessionId) workflowRelatedSessionIds.add(sessionId);
      }
    }
    const isWorkflowSession = (session: SidebarSession) => {
      const kind = getWorkbenchSessionKind(session);
      return kind === 'run' || kind === 'creation' || workflowRelatedSessionIds.has(session.id);
    };
    const runs = (sessions as SidebarSession[]).filter(isWorkflowSession).sort(compareSidebarSessions);
    const chat = (sessions as SidebarSession[]).filter((session) => !isWorkflowSession(session)).sort(compareSidebarSessions);
    return { chat, runs };
  }, [sessions]);
  const baseVisibleSessions = sessionView === 'runs' ? groupedSessions.runs : groupedSessions.chat;
  const sessionSearch = sessionSearchByView[sessionView];
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
        session.agentBinding?.agentName,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [baseVisibleSessions, normalizedSearch]);
  const isFilteredEmpty = normalizedSearch.length > 0 && visibleSessions.length === 0;
  const selectedVisibleCount = visibleSessions.filter((session) => selectedSessionIds.has(session.id)).length;
  const allVisibleSelected = visibleSessions.length > 0 && selectedVisibleCount === visibleSessions.length;
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
  const workflowBindingByRelatedSessionId = useMemo(() => {
    const map = new Map<string, NonNullable<SidebarSession['workflowBinding']>>();
    for (const session of sessions as SidebarSession[]) {
      const binding = session.workflowBinding;
      if (!binding) continue;
      map.set(session.id, binding);
      if (binding.supervisorSessionId) map.set(binding.supervisorSessionId, binding);
      for (const sessionId of Object.values(binding.attachedAgentSessions || {})) {
        if (sessionId) map.set(sessionId, binding);
      }
    }
    return map;
  }, [sessions]);
  const visibleWorkflowBuckets = useMemo(() => {
    const buckets: Record<WorkflowBucketKey, WorkflowSessionGroup[]> = {
      active: [],
      archived: [],
    };
    const groupMaps: Record<WorkflowBucketKey, Map<string, WorkflowSessionGroup>> = {
      active: new Map(),
      archived: new Map(),
    };

    for (const session of visibleSessions as SidebarSession[]) {
      const relatedBinding = session.workflowBinding || workflowBindingByRelatedSessionId.get(session.id);
      if (!relatedBinding && !session.creationSession) continue;
      const pendingCount = pendingQuestionsBySessionId.get(session.id)?.length || 0;
      const bucket = getWorkflowSessionBucket({
        session,
        activeSessionId,
        pendingQuestionCount: pendingCount,
        runStatusById,
        relatedBinding,
      });
      const configFile = getWorkflowSessionConfigFile(session, relatedBinding);
      const key = `${bucket}:${configFile}`;
      const groupMap = groupMaps[bucket];
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          key,
          name: getWorkflowSessionName(session, relatedBinding),
          configFile,
          sessions: [],
          agentGroups: [],
          pendingCount: 0,
        });
      }
      const group = groupMap.get(key)!;
      group.sessions.push(session);
      group.pendingCount += pendingCount;
    }

    for (const key of Object.keys(groupMaps) as WorkflowBucketKey[]) {
      buckets[key] = Array.from(groupMaps[key].values())
        .map((group) => ({
          ...group,
          sessions: group.sessions.sort((a, b) => {
            const aPending = pendingQuestionsBySessionId.get(a.id)?.length || 0;
            const bPending = pendingQuestionsBySessionId.get(b.id)?.length || 0;
            if (aPending !== bPending) return bPending - aPending;
            return compareSidebarSessions(a, b);
          }),
        }))
        .map((group) => ({
          ...group,
          agentGroups: buildWorkflowAgentGroups(group.sessions, pendingQuestionsBySessionId, workflowBindingByRelatedSessionId),
        }))
        .sort((a, b) => {
          const aPinned = a.sessions.some((session) => hasWeChatBinding(session));
          const bPinned = b.sessions.some((session) => hasWeChatBinding(session));
          if (aPinned !== bPinned) return aPinned ? -1 : 1;
          if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
          return (b.sessions[0]?.updatedAt || 0) - (a.sessions[0]?.updatedAt || 0);
        });
    }

    return buckets;
  }, [activeSessionId, pendingQuestionsBySessionId, runStatusById, visibleSessions, workflowBindingByRelatedSessionId]);

  useEffect(() => {
    if (!activeSession) return;
    const kind = getWorkbenchSessionKind(activeSession);
    const relatedToWorkflow = kind === 'run'
      || kind === 'creation'
      || workflowBindingByRelatedSessionId.has(activeSession.id);
    const nextView = relatedToWorkflow ? 'runs' : 'chat';
    setSessionView((prev) => (prev === nextView ? prev : nextView));
  }, [activeSession?.id, activeSession?.workflowBinding, activeSession?.creationSession, workflowBindingByRelatedSessionId]);

  useEffect(() => {
    let cancelled = false;
    const refreshWorkflowSidebarSignals = async () => {
      try {
        const [questionsResult, runsResult] = await Promise.all([
          workflowApi.listHumanQuestions({ status: 'unanswered', limit: 100 }),
          runsApi.listAll().catch(() => ({ runs: [] })),
        ]);
        if (cancelled) return;
        setPendingHumanQuestions(questionsResult.questions || []);
        setRunStatusById(Object.fromEntries((runsResult.runs || []).map((run) => [run.id, run.status])));
      } catch {
        if (!cancelled) setPendingHumanQuestions([]);
      }
    };
    refreshWorkflowSidebarSignals();
    const timer = window.setInterval(refreshWorkflowSidebarSignals, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const visibleIds = new Set(groupedSessions.chat.map((session) => session.id));
    setSelectedSessionIds((prev) => {
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [groupedSessions.chat]);

  useEffect(() => {
    if (sessionView !== 'chat') {
      setManageMode(false);
      setSelectedSessionIds((prev) => (prev.size === 0 ? prev : new Set()));
    }
  }, [sessionView]);

  useEffect(() => {
    setSelectedSessionIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [sessionSearch]);

  const toggleSessionSelected = (sessionId: string, checked: boolean) => {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sessionId);
      else next.delete(sessionId);
      return next;
    });
  };

  const toggleAllVisibleSelected = (checked: boolean) => {
    setSelectedSessionIds(checked ? new Set(visibleSessions.map((session) => session.id)) : new Set());
  };

  const deleteSelectedSessions = async () => {
    const ids = visibleSessions
      .map((session) => session.id)
      .filter((id) => selectedSessionIds.has(id));
    if (ids.length === 0) return;
    const ok = await confirm({
      title: '确认删除对话',
      description: `将删除选中的 ${ids.length} 个对话，删除后无法恢复。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    ids.forEach((id) => deleteSession(id));
    setSelectedSessionIds(new Set());
    setManageMode(false);
  };

  const requestDeleteSession = async (session: ChatSessionSummaryLike) => {
    const ok = await confirm({
      title: '确认删除对话',
      description: `删除「${session.title}」后无法恢复。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (ok) deleteSession(session.id);
  };

  return (
    <div className="w-full bg-muted/30 flex flex-col h-full">
      {/* ACEHarness Header */}
      <div className="p-3 border-b bg-gradient-to-r from-primary/10 to-blue-500/10">
        <div className="mb-3 flex items-center gap-2">
          <RobotLogo size={28} />
          <span className="font-bold text-sm bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">ACEHarness</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="default"
            onClick={() => createSession()}
            title="新建会话"
            className="h-8 justify-center gap-1.5 px-2 text-xs"
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">add</span>
            新建
          </Button>
          <Button
            type="button"
            size="sm"
            variant={manageMode ? 'secondary' : 'outline'}
            className={`h-8 justify-center gap-1.5 px-2 text-xs ${
              manageMode ? 'text-primary ring-1 ring-primary/20' : ''
            }`}
            onClick={() => {
              setSessionView('chat');
              setManageMode((prev) => {
                if (prev) setSelectedSessionIds(new Set());
                return !prev;
              });
            }}
          >
            <span className="material-symbols-outlined text-sm" aria-hidden="true">
              {manageMode ? 'done' : 'checklist'}
            </span>
            {manageMode ? '完成管理' : '对话管理'}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border/40 px-3 py-2">
          <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={`h-7 justify-center gap-1 px-2 text-xs ${
                sessionView === 'chat'
                  ? 'bg-background text-primary shadow-sm ring-1 ring-primary/20 hover:bg-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setSessionView('chat')}
            >
              <span className="material-symbols-outlined text-sm">forum</span>
              <span>对话</span>
              <span className="ml-1 text-[10px] text-muted-foreground">
                {groupedSessions.chat.length}
              </span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={`h-7 justify-center gap-1 px-2 text-xs ${
                sessionView === 'runs'
                  ? 'bg-background text-primary shadow-sm ring-1 ring-primary/20 hover:bg-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() => setSessionView('runs')}
            >
              <span className="material-symbols-outlined text-sm">account_tree</span>
              <span>工作流</span>
              <span className="ml-1 text-[10px] text-muted-foreground">
                {groupedSessions.runs.length}
              </span>
            </Button>
          </div>
        </div>

        <div className="border-b border-border/40 px-3 py-2">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              search
            </span>
            <Input
              value={sessionSearch}
              onChange={(event) => setSessionSearchByView((prev) => ({ ...prev, [sessionView]: event.target.value }))}
              placeholder={sessionView === 'runs' ? '筛选工作流会话...' : '筛选对话...'}
              className="h-8 pl-8 pr-8 text-xs"
            />
            {sessionSearch ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => setSessionSearchByView((prev) => ({ ...prev, [sessionView]: '' }))}
                aria-label="清空筛选"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            ) : null}
          </div>
        </div>

        {manageMode && sessionView === 'chat' && visibleSessions.length > 0 && (
          <div className="flex items-center justify-between border-b border-border/40 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                aria-label="选择全部对话"
                checked={allVisibleSelected}
                onChange={(event) => toggleAllVisibleSelected(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span>全选</span>
              {selectedVisibleCount > 0 ? (
                <span className="text-primary">已选 {selectedVisibleCount}</span>
              ) : null}
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={selectedVisibleCount === 0}
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              onClick={() => { void deleteSelectedSessions(); }}
            >
              <span className="material-symbols-outlined text-sm">delete</span>
              删除
            </Button>
          </div>
        )}

        {sessionView === 'chat' && visibleSessions.length === 0 && (
          <EmptySessionState
            kind={sessionView}
            filtered={isFilteredEmpty}
            query={sessionSearch.trim()}
            onCreate={sessionView === 'chat' && !isFilteredEmpty ? () => createSession() : undefined}
          />
        )}
        {sessionView === 'runs' ? (
          <div className="px-2 py-2">
            <WorkflowBucket
              title="运行中"
              icon="radio_button_checked"
              groups={visibleWorkflowBuckets.active}
              activeSessionId={activeSessionId}
              loading={loading}
              activeStreamingSessionIds={activeStreamingSessionIds}
              recentlyCompletedSessionIds={recentlyCompletedSessionIds}
              sessionLoadingId={sessionLoadingId}
              pendingQuestionsBySessionId={pendingQuestionsBySessionId}
              onSessionClick={setActiveSessionId}
              onDeleteSession={(session) => { void requestDeleteSession(session); }}
              onRenameSession={(session, title) => renameSession(session.id, title)}
              defaultOpen
              forceOpen={normalizedSearch.length > 0}
            />
            <WorkflowBucket
              title="非运行中"
              icon="inventory_2"
              groups={visibleWorkflowBuckets.archived}
              activeSessionId={activeSessionId}
              loading={loading}
              activeStreamingSessionIds={activeStreamingSessionIds}
              recentlyCompletedSessionIds={recentlyCompletedSessionIds}
              sessionLoadingId={sessionLoadingId}
              pendingQuestionsBySessionId={pendingQuestionsBySessionId}
              onSessionClick={setActiveSessionId}
              onDeleteSession={(session) => { void requestDeleteSession(session); }}
              onRenameSession={(session, title) => renameSession(session.id, title)}
              forceOpen={normalizedSearch.length > 0}
            />
          </div>
        ) : (
          visibleSessions.map(session => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              selectable={manageMode && sessionView === 'chat'}
              selected={selectedSessionIds.has(session.id)}
              isStreaming={activeStreamingSessionIds.includes(session.id) || (loading && session.id === activeSessionId)}
              isRecentlyCompleted={recentlyCompletedSessionIds.includes(session.id)}
              isLoadingSession={sessionLoadingId === session.id}
              onClick={() => setActiveSessionId(session.id)}
              onSelectChange={(checked) => toggleSessionSelected(session.id, checked)}
              onDelete={() => { void requestDeleteSession(session); }}
              onRename={(title) => renameSession(session.id, title)}
            />
          ))
        )}
      </div>
      {/* Skills 入口 */}
      {discoveredSkills.length > 0 && (
        <div className="border-t p-3">
          <button
            className="w-full flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors"
            onClick={() => setSkillModalOpen(true)}
          >
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-muted-foreground">extension</span>
              <span className="text-xs font-semibold text-muted-foreground">Skills</span>
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              {enabledCount}/{discoveredSkills.length}
            </span>
          </button>
        </div>
      )}
      {/* Skills 管理弹窗 */}
      {skillModalOpen && (
        <SkillManagerModal
          skills={discoveredSkills}
          skillSettings={skillSettings}
          toggleSkill={toggleSkill}
          setSkillsEnabled={setSkillsEnabled}
          onClose={() => setSkillModalOpen(false)}
        />
      )}
      {dialogProps ? <ConfirmDialog {...dialogProps} /> : null}
    </div>
  );
}

const LOCKED_SKILLS = ['aceharness-chat-card'];

/* ========== Skills 管理弹窗 ========== */

function SkillManagerModal({
  skills,
  skillSettings,
  toggleSkill,
  setSkillsEnabled,
  onClose,
}: {
  skills: SkillItem[];
  skillSettings: Record<string, boolean>;
  toggleSkill: (name: string) => void;
  setSkillsEnabled: (skills: Record<string, boolean>) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'cangjie' | 'anthropics'>('all');

  const filtered = useMemo(() => {
    let list = skills;
    if (activeTab !== 'all') {
      list = list.filter(s => (s.source || 'cangjie') === activeTab);
    }
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
  }, [skills, activeTab, search]);

  const cangjieCount = skills.filter(s => (s.source || 'cangjie') === 'cangjie').length;
  const anthropicsCount = skills.filter(s => (s.source || 'cangjie') === 'anthropics').length;
  const enabledCount = skills.filter(s => !!skillSettings[s.name]).length;
  const selectableSkills = skills.filter(s => !LOCKED_SKILLS.includes(s.name));
  const selectedFilteredCount = filtered.filter(s => !!skillSettings[s.name]).length;

  const setAllSelectableSkills = (enabled: boolean) => {
    const next = Object.fromEntries(selectableSkills.map(skill => [skill.name, enabled]));
    for (const skillName of LOCKED_SKILLS) {
      if (skills.some(skill => skill.name === skillName)) next[skillName] = true;
    }
    setSkillsEnabled(next);
  };

  const tabs = [
    { key: 'all' as const, label: '全部', count: skills.length },
    { key: 'cangjie' as const, label: 'Cangjie', count: cangjieCount },
    { key: 'anthropics' as const, label: 'Anthropics', count: anthropicsCount },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-card rounded-lg w-[560px] max-w-[90vw] max-h-[75vh] flex flex-col border shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-base font-semibold">Skills 管理</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              已启用 {enabledCount} / {skills.length} 个技能
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <span className="material-symbols-outlined text-sm">close</span>
          </Button>
        </div>

        {/* Tabs + Search */}
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
              placeholder="搜索技能名称、描述或标签..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-xs"
            />
          </div>
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
            <span className="text-[11px] text-muted-foreground">
              当前列表 {selectedFilteredCount} / {filtered.length} 已启用
            </span>
            <div className="flex gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setAllSelectableSkills(true)}
                disabled={selectableSkills.length === 0}
              >
                全选
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => setAllSelectableSkills(false)}
                disabled={selectableSkills.length === 0}
              >
                全部取消
              </Button>
            </div>
          </div>
        </div>

        {/* Skills List */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {filtered.length === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">没有匹配的技能</div>
          ) : (
            <div className="space-y-1">
              {filtered.map(skill => (
                <div
                  key={skill.name}
                  className="flex items-start gap-3 p-2.5 rounded-md hover:bg-muted/50 transition-colors group"
                >
                  <div className="mt-0.5 shrink-0">
                    <span className={`material-symbols-outlined text-base ${
                      (skill.source || 'cangjie') === 'anthropics' ? 'text-orange-400' : 'text-blue-400'
                    }`}>
                      {(skill.source || 'cangjie') === 'anthropics' ? 'auto_awesome' : 'extension'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium">{skill.label}</span>
                      {skill.source === 'anthropics' && (
                        <span className="text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-500 font-medium leading-none">
                          Anthropics
                        </span>
                      )}
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
          )}
        </div>
      </div>
    </div>
  );
}

function EmptySessionState({
  kind,
  filtered,
  query,
  onCreate,
}: {
  kind: 'chat' | 'runs';
  filtered: boolean;
  query: string;
  onCreate?: () => void;
}) {
  const isWorkflow = kind === 'runs';
  const title = filtered
    ? '没有匹配结果'
    : isWorkflow
      ? '暂无工作流'
      : '暂无对话';
  const description = filtered
    ? `没有找到包含“${query}”的会话。`
    : isWorkflow
      ? '运行态工作流会话会在启动工作流后出现在这里。'
      : '新建对话，让 AI 帮你继续推进。';
  const hint = filtered ? '调整关键词后再试' : isWorkflow ? '等待工作流运行' : '准备开始新的对话';

  return (
    <div className="px-3 py-6">
      <div className="flex flex-col items-center justify-center rounded-xl border border-border/70 bg-background/80 px-4 py-6 text-center shadow-sm backdrop-blur-sm transition-transform hover:-translate-y-0.5">
        <div className="mb-4 w-24 animate-[botBounce_2.5s_ease-in-out_infinite] drop-shadow-sm">
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
  activeSessionId,
  loading,
  activeStreamingSessionIds,
  recentlyCompletedSessionIds,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  defaultOpen = false,
  forceOpen = false,
}: {
  title: string;
  icon: string;
  groups: WorkflowSessionGroup[];
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIds: string[];
  recentlyCompletedSessionIds: string[];
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  onSessionClick: (sessionId: string) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  defaultOpen?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const sessionCount = groups.reduce((sum, group) => sum + group.sessions.length, 0);
  const pendingCount = groups.reduce((sum, group) => sum + group.pendingCount, 0);

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
    <div className="mb-3 rounded-xl border bg-background/70">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="material-symbols-outlined text-sm text-muted-foreground">{open ? 'expand_more' : 'chevron_right'}</span>
        <span className="material-symbols-outlined text-sm text-primary">{icon}</span>
        <span className="min-w-0 flex-1 text-xs font-semibold text-foreground">{title}</span>
        {pendingCount > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
            待审 {pendingCount}
          </span>
        ) : null}
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {sessionCount}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-border/40 p-2">
          {groups.map((group) => (
            <WorkflowGroup
              key={group.key}
              group={group}
              activeSessionId={activeSessionId}
              loading={loading}
              activeStreamingSessionIds={activeStreamingSessionIds}
              recentlyCompletedSessionIds={recentlyCompletedSessionIds}
              sessionLoadingId={sessionLoadingId}
              pendingQuestionsBySessionId={pendingQuestionsBySessionId}
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
  activeSessionId,
  loading,
  activeStreamingSessionIds,
  recentlyCompletedSessionIds,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  forceOpen = false,
}: {
  group: WorkflowSessionGroup;
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIds: string[];
  recentlyCompletedSessionIds: string[];
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
  onSessionClick: (sessionId: string) => void;
  onDeleteSession: (session: SidebarSession) => void;
  onRenameSession: (session: SidebarSession, title: string) => void;
  forceOpen?: boolean;
}) {
  const hasActiveSession = group.sessions.some((session) => session.id === activeSessionId);
  const [open, setOpen] = useState(hasActiveSession || group.pendingCount > 0 || forceOpen);
  const agentCount = group.agentGroups.length;

  useEffect(() => {
    if (hasActiveSession || group.pendingCount > 0 || forceOpen) setOpen(true);
  }, [forceOpen, group.pendingCount, hasActiveSession]);

  return (
    <div className={`rounded-lg border ${group.pendingCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'bg-muted/10'}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="material-symbols-outlined text-sm text-muted-foreground">{open ? 'expand_more' : 'chevron_right'}</span>
        <span className="material-symbols-outlined text-sm text-muted-foreground">account_tree</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{group.name}</div>
          <div className="truncate text-[10px] text-muted-foreground">{group.configFile}</div>
        </div>
        {group.pendingCount > 0 ? (
          <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
            ping {group.pendingCount}
          </span>
        ) : null}
        <span className="rounded-full bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
          {agentCount}/{group.sessions.length}
        </span>
      </button>
      {open ? (
        <div className="space-y-1 border-t border-border/40 p-1.5">
          {group.agentGroups.map((agentGroup) => (
            <WorkflowAgentGroup
              key={agentGroup.key}
              group={agentGroup}
              activeSessionId={activeSessionId}
              loading={loading}
              activeStreamingSessionIds={activeStreamingSessionIds}
              recentlyCompletedSessionIds={recentlyCompletedSessionIds}
              sessionLoadingId={sessionLoadingId}
              pendingQuestionsBySessionId={pendingQuestionsBySessionId}
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

function WorkflowAgentGroup({
  group,
  activeSessionId,
  loading,
  activeStreamingSessionIds,
  recentlyCompletedSessionIds,
  sessionLoadingId,
  pendingQuestionsBySessionId,
  onSessionClick,
  onDeleteSession,
  onRenameSession,
  forceOpen = false,
}: {
  group: WorkflowAgentSessionGroup;
  activeSessionId: string | null;
  loading: boolean;
  activeStreamingSessionIds: string[];
  recentlyCompletedSessionIds: string[];
  sessionLoadingId: string | null;
  pendingQuestionsBySessionId: Map<string, HumanQuestion[]>;
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

  useEffect(() => {
    if (hasActiveSession || group.pendingCount > 0 || forceOpen) setOpen(true);
  }, [forceOpen, group.pendingCount, hasActiveSession]);

  return (
    <div className={`rounded-md border ${group.pendingCount > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'bg-background/70'}`}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
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
      </button>
      {open ? (
        <div className="border-t border-border/40 pl-3">
          {group.sessions.length > 0 ? (
            group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                compact
                attentionCount={pendingQuestionsBySessionId.get(session.id)?.length || 0}
                isStreaming={activeStreamingSessionIds.includes(session.id) || (loading && session.id === activeSessionId)}
                isRecentlyCompleted={recentlyCompletedSessionIds.includes(session.id)}
                isLoadingSession={sessionLoadingId === session.id}
                onClick={() => onSessionClick(session.id)}
                onDelete={() => onDeleteSession(session)}
                onRename={(title) => onRenameSession(session, title)}
              />
            ))
          ) : (
            <div className="px-3 py-2 text-[10px] text-muted-foreground">
              {group.connected ? '已绑定会话，等待拉取会话摘要。' : '等待首次对话。'}
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
  onClick: () => void;
  onSelectChange?: (checked: boolean) => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
  const isWeChatBound = hasWeChatBinding(session as SidebarSession);
  const summary = session.lastMessage?.slice(0, 40) || '空会话';
  const statusBadge = session.workflowBinding
    ? { label: '运行', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    : session.creationSession
      ? { label: '创建', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' }
    : session.agentBinding
        ? { label: 'Agent', tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
      : null;
  const subLabel = session.workflowBinding?.configFile
    || (session.creationSession
      ? `${session.creationSession.filename} · ${getCreationSessionStatusLabel(session.creationSession.status)}`
      : '')
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
      className={`group relative flex items-start gap-2 overflow-hidden py-2.5 cursor-pointer ${!compact ? 'border-b border-border/30' : 'rounded-lg'} transition-colors ${
        active
          ? 'border-l-4 border-l-primary bg-primary/10 pl-2 pr-3 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.10)]'
          : isWeChatBound
            ? 'border-l-4 border-l-[#1AAD19] bg-[#1AAD19]/[0.08] px-3 shadow-[inset_0_0_0_1px_rgba(26,173,25,0.14)] hover:bg-[#1AAD19]/[0.12]'
            : 'border-l-4 border-l-transparent px-3 hover:bg-muted/50'
      } ${isStreaming || isLoadingSession ? 'bg-primary/15 ring-1 ring-primary/20' : isRecentlyCompleted ? 'bg-emerald-500/10 ring-1 ring-emerald-500/20' : ''}`}
      onClick={() => {
        if (selectable) {
          onSelectChange?.(!selected);
          return;
        }
        onClick();
      }}
    >
      {isStreaming || isLoadingSession ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 animate-pulse bg-primary" />
      ) : isRecentlyCompleted ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-emerald-500" />
      ) : null}
      {selectable ? (
        <button
          type="button"
          aria-label={`选择 ${session.title}`}
          aria-pressed={selected}
          onClick={(event) => {
            event.stopPropagation();
            onSelectChange?.(!selected);
          }}
          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
            selected ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-transparent hover:border-primary/40'
          }`}
        >
          <span className="material-symbols-outlined text-sm">check</span>
        </button>
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
              生成中
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
        <div className="mt-0.5 flex shrink-0 items-center gap-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-60 hover:opacity-100"
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
            className="h-6 w-6 opacity-60 hover:opacity-100 text-destructive hover:text-destructive"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            title="删除会话"
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
