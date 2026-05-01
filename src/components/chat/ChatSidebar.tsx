'use client';

import { useState, useMemo } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  buildWorkflowConversationDirectory,
  getConversationSessionStatusLabel,
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
    skillSettings,
    discoveredSkills,
    toggleSkill,
  } = useChat();
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

  const enabledCount = discoveredSkills.filter(s => !!skillSettings[s.name]).length;
  const workflowDirectory = useMemo(
    () => buildWorkflowConversationDirectory(activeSession?.workflowBinding),
    [activeSession?.workflowBinding]
  );

  return (
    <div className="w-full bg-muted/30 flex flex-col h-full">
      {/* ACEHarness Header */}
      <div className="p-3 border-b bg-gradient-to-r from-primary/10 to-blue-500/10">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <RobotLogo size={28} />
            <span className="font-bold text-sm bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">ACEHarness</span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => createSession()} title="新建会话" className="h-6 px-2">
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>add</span>
            <span className="ml-1 text-xs">新建</span>
          </Button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">对话管理</span>
        </div>
      </div>

      {/* Active session info */}
      {sessions.find(s => s.id === activeSessionId) && (
        <div className="px-3 py-2 bg-primary/5 border-b">
          <div className="text-xs text-muted-foreground mb-1">当前会话</div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate flex-1">
              {editingSessionId === activeSessionId ? (
                <input
                  autoFocus
                  defaultValue={sessions.find(s => s.id === activeSessionId)?.title}
                  className="w-full bg-transparent border-b border-primary outline-none text-sm"
                  onBlur={(e) => {
                    renameSession(activeSessionId!, e.target.value);
                    setEditingSessionId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      renameSession(activeSessionId!, (e.target as HTMLInputElement).value);
                      setEditingSessionId(null);
                    }
                    if (e.key === 'Escape') {
                      setEditingSessionId(null);
                    }
                  }}
                />
              ) : (
                <span
                  className="cursor-pointer hover:text-primary"
                  onClick={() => setEditingSessionId(activeSessionId)}
                  title="点击修改标题"
                >
                  {sessions.find(s => s.id === activeSessionId)?.title}
                </span>
              )}
            </span>
            <button
              onClick={() => setEditingSessionId(activeSessionId)}
              className="p-1 hover:bg-muted rounded"
              title="重命名"
            >
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>edit</span>
            </button>
          </div>
        </div>
      )}

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

        {sessions.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">暂无会话</div>
        )}
        {sessions.map(session => (
          <SessionItem
            key={session.id}
            session={session}
            active={session.id === activeSessionId}
            onClick={() => setActiveSessionId(session.id)}
            onDelete={() => deleteSession(session.id)}
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

function SessionItem({ session, active, compact = false, onClick, onDelete, onRename }: {
  session: ChatSessionSummaryLike & {
    agentBinding?: {
      agentName: string;
    };
  };
  active: boolean;
  compact?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}) {
  void onRename;
  const summary = session.lastMessage?.slice(0, 40) || '空会话';
  const statusBadge = session.workflowBinding
    ? { label: '运行', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
    : session.creationSession
      ? { label: '创建', tone: 'bg-sky-500/10 text-sky-700 dark:text-sky-300' }
      : session.agentBinding
        ? { label: 'Agent', tone: 'bg-violet-500/10 text-violet-700 dark:text-violet-300' }
      : null;
  const subLabel = session.workflowBinding?.configFile || session.creationSession?.workflowName || session.agentBinding?.agentName || '';

  return (
    <div
      className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer ${!compact ? 'border-b border-border/30' : 'rounded-lg'} hover:bg-muted/50 transition-colors ${active ? 'bg-muted' : ''}`}
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-medium truncate">{session.title}</div>
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
      <Button
        size="icon"
        variant="ghost"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="删除会话"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>delete</span>
      </Button>
    </div>
  );
}
