'use client';

import { useEffect, useState, useMemo } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import {
  buildWorkflowConversationDirectory,
  getConversationSessionStatusLabel,
  getCreationSessionStatusLabel,
  getWorkbenchSessionKind,
  type ChatSessionSummaryLike,
} from '@/lib/agent-conversations';
import { RobotLogo } from './ChatMessage';

type SkillItem = {
  name: string;
  label: string;
  description: string;
  source?: string;
  tags?: string[];
};

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
    skillSettings,
    discoveredSkills,
    toggleSkill,
  } = useChat();
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [sessionView, setSessionView] = useState<'chat' | 'runs'>('chat');
  const [manageMode, setManageMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(() => new Set());
  const [sessionSearchByView, setSessionSearchByView] = useState({ chat: '', runs: '' });
  const { confirm, dialogProps } = useConfirmDialog();

  const enabledCount = discoveredSkills.filter(s => !!skillSettings[s.name]).length;
  const workflowDirectory = useMemo(
    () => buildWorkflowConversationDirectory(activeSession?.workflowBinding),
    [activeSession?.workflowBinding]
  );
  const groupedSessions = useMemo(() => {
    const runs = sessions.filter((session) => getWorkbenchSessionKind(session) === 'run');
    const chat = sessions.filter((session) => getWorkbenchSessionKind(session) !== 'run');
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

  useEffect(() => {
    if (!activeSession) return;
    setSessionView(getWorkbenchSessionKind(activeSession) === 'run' ? 'runs' : 'chat');
  }, [activeSession?.id, activeSession?.workflowBinding, activeSession?.creationSession]);

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
      setSelectedSessionIds(new Set());
    }
  }, [sessionView]);

  useEffect(() => {
    setSelectedSessionIds(new Set());
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
        {workflowDirectory.length > 0 && (
          <div className="border-b border-border/40 px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs font-semibold text-foreground">当前工作流通讯录</div>
              <span className="text-[10px] text-muted-foreground">
                {workflowDirectory.length} 个会话
              </span>
            </div>
            <div className="space-y-2">
              {workflowDirectory.map((entry) => (
                <div key={entry.key} className="rounded-lg border border-border/50 bg-background/70 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] rounded-full bg-primary/10 px-1.5 py-0.5 text-primary">
                      {entry.role}
                    </span>
                    <span className="truncate text-xs font-medium">{entry.label}</span>
                  </div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground" title={entry.sessionId || getConversationSessionStatusLabel(entry)}>
                    {entry.sessionId || getConversationSessionStatusLabel(entry)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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

        {visibleSessions.length === 0 && (
          <EmptySessionState
            kind={sessionView}
            filtered={isFilteredEmpty}
            query={sessionSearch.trim()}
            onCreate={sessionView === 'chat' && !isFilteredEmpty ? () => createSession() : undefined}
          />
        )}
        {visibleSessions.map(session => (
          <SessionItem
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            selectable={manageMode && sessionView === 'chat'}
            selected={selectedSessionIds.has(session.id)}
            isStreaming={loading && session.id === activeSessionId}
            onClick={() => setActiveSessionId(session.id)}
            onSelectChange={(checked) => toggleSessionSelected(session.id, checked)}
            onDelete={() => { void requestDeleteSession(session); }}
            onRename={(title) => renameSession(session.id, title)}
          />
        ))}
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
  onClose,
}: {
  skills: SkillItem[];
  skillSettings: Record<string, boolean>;
  toggleSkill: (name: string) => void;
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
              已启用 {skills.filter(s => !!skillSettings[s.name]).length} / {skills.length} 个技能
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

function SessionItem({
  session,
  active,
  compact = false,
  selectable = false,
  selected = false,
  isStreaming = false,
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
  onClick: () => void;
  onSelectChange?: (checked: boolean) => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(session.title);
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
    setMenuOpen(false);
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
      className={`group relative flex items-start gap-2 overflow-hidden py-2.5 cursor-pointer ${!compact ? 'border-b border-border/30' : 'rounded-lg'} hover:bg-muted/50 transition-colors ${
        active
          ? 'border-l-4 border-l-primary bg-primary/10 pl-2 pr-3 shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.10)]'
          : 'border-l-4 border-l-transparent px-3'
      } ${isStreaming ? 'bg-primary/15 ring-1 ring-primary/20' : ''}`}
      onClick={onClick}
    >
      {isStreaming ? (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-1 animate-pulse bg-primary" />
      ) : null}
      {selectable ? (
        <input
          type="checkbox"
          aria-label={`选择 ${session.title}`}
          checked={selected}
          onChange={(event) => onSelectChange?.(event.target.checked)}
          onClick={(event) => event.stopPropagation()}
          className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-border accent-primary"
        />
      ) : null}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isStreaming ? (
            <span className="relative flex h-2 w-2 shrink-0" aria-label="进行中">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          ) : null}
          <div className="text-sm font-medium truncate">{session.title}</div>
          {isStreaming ? (
            <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              生成中
            </span>
          ) : null}
          {statusBadge ? (
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${statusBadge.tone}`}>
              {statusBadge.label}
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
        <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="mt-0.5 h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
              title="会话操作"
              aria-label={`更多操作 ${session.title}`}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>more_vert</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-32" onClick={(event) => event.stopPropagation()}>
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                startRenaming();
              }}
            >
              <span className="material-symbols-outlined mr-2 text-sm">edit</span>
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <span className="material-symbols-outlined mr-2 text-sm">delete</span>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
