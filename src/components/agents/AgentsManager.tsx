'use client';

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import Link from 'next/link';
import { agentApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ThemeToggle } from '@/components/theme-toggle';
import { Download, FolderOpen, Search, Upload } from 'lucide-react';
import AgentEditModal from '@/components/AgentEditModal';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import { ClipLoader } from 'react-spinners';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import SpriteAvatar from '@/components/SpriteAvatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/core/utils';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import type { ReturnTarget } from '@/lib/navigation/return-target';

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  skills?: string[];
  description?: string;
  alwaysAvailableForChat?: boolean;
  workspaceProfile?: {
    nickname?: string;
    officeRole?: string;
    residency?: {
      office?: boolean;
      meetingRoom?: boolean;
      defaultDirectRoom?: boolean;
    };
    roomPresence?: {
      recommendForMeetingRoom?: boolean;
      autoShowInOffice?: boolean;
    };
  };
}

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];
type DisplayTeam = 'blue' | 'red' | 'judge' | 'black-gold';

interface AgentsManagerProps {
  embedded?: boolean;
  returnTarget?: ReturnTarget;
}

export default function AgentsManager({
  embedded = false,
  returnTarget = { href: '/dashboard', label: '返回仪表盘' },
}: AgentsManagerProps) {
  const VIEW_MODE_STORAGE_KEY = 'aceharness:agents:view-mode';
  const { toast } = useToast();
  useDocumentTitle(embedded ? null : 'Agent 管理');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [embeddedSearchDraft, setEmbeddedSearchDraft] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [showAICreateModal, setShowAICreateModal] = useState(false);
  const [aiRevisionAgent, setAiRevisionAgent] = useState<AgentConfig | null>(null);
  const [alertMessage, setAlertMessage] = useState('');
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('gallery');
  const [selectedAgentNames, setSelectedAgentNames] = useState<string[]>([]);
  const [runtimeAgentsDir, setRuntimeAgentsDir] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [archiveExporting, setArchiveExporting] = useState(false);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    loadAgents();
    fetch('/api/engine').then(r => r.json()).then(d => {
      if (d.engine) setGlobalEngine(d.engine);
      setGlobalDefaultModel(d.defaultModel || '');
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedViewMode = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (savedViewMode === 'gallery' || savedViewMode === 'table') {
      setViewMode(savedViewMode);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
  }, [viewMode]);

  const loadAgents = async () => {
    try {
      setLoading(true);
      const data = await agentApi.listAgents();
      setAgents(data.agents || []);
      setRuntimeAgentsDir(data.runtimeAgentsDir || '');
    } catch (error) {
      console.error('Failed to load agents:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedAgentNames((prev) => prev.filter((name) => agents.some((agent) => agent.name === name)));
  }, [agents]);

  const handleCreateAgent = () => {
      setEditingAgent({
        name: '',
        team: 'red',
        roleType: 'normal',
        engineModels: {},
        activeEngine: '',
      tags: [],
      capabilities: [],
      skills: [],
      systemPrompt: '',
    });
    setIsNewAgent(true);
  };

  const handleContinueEditAIAgent = (agent: AgentConfig) => {
    setShowAICreateModal(false);
    setAiRevisionAgent(null);
    setEditingAgent({
      ...agent,
      team: agent.team || 'red',
      roleType: agent.roleType || 'normal',
      engineModels: agent.engineModels || {},
      activeEngine: agent.activeEngine || '',
      tags: agent.tags || [],
      capabilities: agent.capabilities || [],
      skills: agent.skills || [],
      systemPrompt: agent.systemPrompt || '',
    });
    setIsNewAgent(true);
  };

  const handleContinueEditAIRevisionAgent = (agent: AgentConfig) => {
    const originalName = aiRevisionAgent?.name || agent.name;
    setShowAICreateModal(false);
    setAiRevisionAgent(null);
    setEditingAgent({
      ...agent,
      name: originalName,
      team: agent.team || aiRevisionAgent?.team || 'red',
      roleType: agent.roleType || aiRevisionAgent?.roleType || 'normal',
      engineModels: agent.engineModels || aiRevisionAgent?.engineModels || {},
      activeEngine: agent.activeEngine || aiRevisionAgent?.activeEngine || '',
      tags: agent.tags || aiRevisionAgent?.tags || [],
      capabilities: agent.capabilities || aiRevisionAgent?.capabilities || [],
      skills: agent.skills || aiRevisionAgent?.skills || [],
      systemPrompt: agent.systemPrompt || aiRevisionAgent?.systemPrompt || '',
    });
    setIsNewAgent(false);
  };

  const handleEditAgent = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setIsNewAgent(false);
  };

  const handleReviseAgent = (agent: AgentConfig) => {
    setShowAICreateModal(false);
    setAiRevisionAgent(agent);
  };

  const handleSaveAgent = async (agent: AgentConfig) => {
    try {
      const targetName = isNewAgent ? agent.name : (editingAgent?.name || agent.name);
      await agentApi.saveAgent(targetName, agent);
      await loadAgents();
      setEditingAgent(null);
      toast('success', 'Agent 配置已保存');
    } catch (error: any) {
      toast('error', error.message || '保存 Agent 配置失败');
    }
  };

  const handleDeleteAgent = async (name: string) => {
    const confirmed = await confirm({
      title: '确认删除',
      description: `确定要删除 Agent "${name}" 吗？`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await agentApi.deleteAgent(name);
      await loadAgents();
    } catch (error) {
      console.error('Failed to delete agent:', error);
      setAlertMessage('删除失败: ' + (error as Error).message);
    }
  };

  const toggleAgentSelection = (name: string) => {
    setSelectedAgentNames((prev) => (
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name]
    ));
  };

  const handleSearchInputChange = (value: string) => {
    setEmbeddedSearchDraft(value);
  };

  const handleApplySearch = () => {
    setSearchQuery(embeddedSearchDraft);
  };

  const toggleSelectAllFiltered = (checked: boolean | 'indeterminate') => {
    if (checked) {
      setSelectedAgentNames(filteredAgents.map((agent) => agent.name));
      return;
    }
    setSelectedAgentNames([]);
  };

  const toggleSelectAllFilteredByContainer = () => {
    toggleSelectAllFiltered(allFilteredSelected ? false : true);
  };

  const handleBatchDeleteAgents = async () => {
    if (selectedAgentNames.length === 0) {
      toast('warning', '请先选择要删除的 Agent');
      return;
    }
    const confirmed = await confirm({
      title: '确认批量删除',
      description: `确定要删除这 ${selectedAgentNames.length} 个 Agent 吗？`,
      confirmLabel: '批量删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      const result = await agentApi.batchDeleteAgents(selectedAgentNames);
      setSelectedAgentNames([]);
      await loadAgents();
      toast('success', result.message || `已删除 ${result.updatedCount} 个 Agent`);
    } catch (error: any) {
      toast('error', error.message || '批量删除 Agent 失败');
    }
  };

  const handleImportAgentZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setArchiveImporting(true);
    try {
      const result = await agentApi.importAgentZip(file);
      await loadAgents();
      toast('success', result.message || `导入了 ${result.imported.length} 个 Agent`);
    } catch (error: any) {
      toast('error', error.message || '导入 Agent 失败');
    } finally {
      setArchiveImporting(false);
      if (archiveInputRef.current) archiveInputRef.current.value = '';
    }
  };

  const handleExportAgents = async () => {
    if (selectedAgentNames.length === 0) {
      toast('warning', '请先选择要导出的 Agent');
      return;
    }
    setArchiveExporting(true);
    try {
      const blob = await agentApi.exportAgents(selectedAgentNames);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'agents-export.zip';
      anchor.click();
      URL.revokeObjectURL(url);
      toast('success', `已导出 ${selectedAgentNames.length} 个 Agent`);
    } catch (error: any) {
      toast('error', error.message || '导出 Agent 失败');
    } finally {
      setArchiveExporting(false);
    }
  };

  // Get all unique tags
  const allTags = Array.from(new Set(agents.flatMap(a => a.tags || [])));

  // Determine agent group by name prefix or first tag
  const getAgentGroup = (agent: AgentConfig): string => {
    // Check name prefix first (compiler_xxx agents)
    if (agent.name.startsWith('compiler_')) return 'compiler';
    // Check name prefix (oh-cangjie agents)
    if (agent.name.startsWith('oh-cangjie')) return 'openharmony';
    // Check first tag
    const firstTag = agent.tags?.[0] || '';
    if (firstTag === 'OH' || firstTag === '仓颉') return 'openharmony';
    if (firstTag === 'C++' || firstTag === '编译器' || firstTag === 'LLVM') return 'compiler';
    return 'common';
  };

  const normalizeTeam = (team: AgentConfig['team']): DisplayTeam => team as DisplayTeam;

  // Filter agents
  const filteredAgents = agents.filter(agent => {
    if (selectedGroup !== 'all' && getAgentGroup(agent) !== selectedGroup) {
      return false;
    }
    if (searchQuery && !agent.name.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (selectedTeam !== 'all' && normalizeTeam(agent.team) !== selectedTeam) {
      return false;
    }
    if (selectedCategory !== 'all' && agent.category !== selectedCategory) {
      return false;
    }
    if (selectedTags.length > 0 && !selectedTags.some(tag => agent.tags?.includes(tag))) {
      return false;
    }
    return true;
  });

  // Group agents by team
  const TEAM_ORDER: DisplayTeam[] = ['black-gold', 'red', 'blue', 'judge'];
  const groupedAgents = Object.fromEntries(
    TEAM_ORDER.map((team) => [team, filteredAgents.filter((agent) => normalizeTeam(agent.team) === team)])
  ) as Record<DisplayTeam, AgentConfig[]>;

  const teamCounts = Object.fromEntries(
    TEAM_ORDER.map((team) => [team, agents.filter((agent) => normalizeTeam(agent.team) === team).length])
  ) as Record<DisplayTeam, number>;

  // Group agents by first tag (for sidebar counts)
  const groupCounts = {
    all: agents.length,
    common: agents.filter(a => getAgentGroup(a) === 'common').length,
    compiler: agents.filter(a => getAgentGroup(a) === 'compiler').length,
    openharmony: agents.filter(a => getAgentGroup(a) === 'openharmony').length,
  };

  const teamLabels: Record<string, string> = {
    'black-gold': '指挥官',
    blue: '蓝队',
    red: '红队',
    judge: '裁定席',
  };
  const teamDescriptions: Record<string, string> = {
    'black-gold': 'Supervisor，统筹推进、评估与阶段指挥',
    blue: '攻击方，负责挑战、压测和寻找风险',
    red: '防守方，负责实现、修复与稳定推进',
    judge: '裁判席，负责裁定、复核与形成结论',
  };
  const teamPanelClass: Record<DisplayTeam, string> = {
    'black-gold': 'border-amber-500/25 bg-[linear-gradient(180deg,rgba(245,158,11,0.06),rgba(245,158,11,0.02))]',
    blue: 'border-sky-500/25 bg-[linear-gradient(180deg,rgba(14,165,233,0.06),rgba(14,165,233,0.02))]',
    red: 'border-rose-500/25 bg-[linear-gradient(180deg,rgba(244,63,94,0.06),rgba(244,63,94,0.02))]',
    judge: 'border-yellow-500/25 bg-[linear-gradient(180deg,rgba(234,179,8,0.06),rgba(234,179,8,0.02))]',
  };
  const groupLabels: Record<string, string> = { all: '全部', common: '通用', compiler: '编译器', openharmony: '仓颉' };
  const supervisorAgents = agents.filter((agent) => agent.roleType === 'supervisor');
  const allFilteredSelected = filteredAgents.length > 0 && filteredAgents.every((agent) => selectedAgentNames.includes(agent.name));
  const hasPartialFilteredSelection = filteredAgents.some((agent) => selectedAgentNames.includes(agent.name));

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const getAgentRuntimeMeta = (agent: AgentConfig) => {
    return {
      avatarSrc: resolveAgentAvatarSrc(agent.avatar, agent.name, {
        team: agent.team,
        roleType: agent.roleType || 'normal',
      }),
    };
  };

  const getWorkspaceProfileBadges = (agent: AgentConfig) => {
    const profile = agent.workspaceProfile || {};
    const badges: Array<{ label: string; className: string }> = [];
    if (profile.residency?.office || profile.roomPresence?.autoShowInOffice) {
      badges.push({ label: '办公室常驻', className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200' });
    }
    if (profile.residency?.meetingRoom || profile.roomPresence?.recommendForMeetingRoom) {
      badges.push({ label: '会议室推荐', className: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200' });
    }
    if (profile.residency?.defaultDirectRoom) {
      badges.push({ label: '可私聊', className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200' });
    }
    return badges;
  };
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'Agent 管理',
    subtitle: `管理 ${agents.length} 个可调度角色与运行时 Agent 编队`,
    actions: (
      <>
        <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeAgentsDir}>
          <FolderOpen className="w-4 h-4 mr-1" />
          <span className="hidden xl:inline">工作目录</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => archiveInputRef.current?.click()}
          disabled={archiveImporting}
        >
          <Upload className={`w-4 h-4 mr-1 ${archiveImporting ? 'animate-bounce' : ''}`} />
          <span className="hidden xl:inline">{archiveImporting ? '导入中...' : '导入 ZIP'}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleExportAgents}
          disabled={archiveExporting || selectedAgentNames.length === 0}
        >
          <Download className={`w-4 h-4 mr-1 ${archiveExporting ? 'animate-bounce' : ''}`} />
          <span className="hidden xl:inline">{archiveExporting ? '导出中...' : '导出 ZIP'}</span>
        </Button>
        <Button size="sm" onClick={() => { setAiRevisionAgent(null); setShowAICreateModal(true); }} variant="outline">
          <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
          AI 创建
        </Button>
        <Button size="sm" onClick={handleCreateAgent}>
          <span className="material-symbols-outlined text-sm mr-1">add</span>
          新建 Agent
        </Button>
      </>
    ),
  }, [agents.length, runtimeAgentsDir, archiveImporting, archiveExporting, selectedAgentNames.length]);

  return (
    <div
      className={cn(
        'relative bg-background',
        embedded ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'min-h-screen',
      )}
    >
      {runtimeAgentsDir ? (
        <WorkspaceEditor
          open={workspaceOpen}
          onOpenChange={setWorkspaceOpen}
          workspacePath={runtimeAgentsDir}
          title="Runtime Agents"
        />
      ) : null}
      <input
        ref={archiveInputRef}
        type="file"
        accept=".zip,application/zip"
        className="hidden"
        onChange={handleImportAgentZip}
      />
      {!embedded && !isDashboardShell ? (
        <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href={returnTarget.href} aria-label={returnTarget.label} title={returnTarget.label}>
                <span className="material-symbols-outlined text-lg">arrow_back</span>
              </Link>
            </Button>
            <h1 className="text-lg font-semibold">Agent 管理</h1>
          </div>
          <div className="flex items-center gap-2" data-tour-step-id="agent-create">
            <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeAgentsDir}>
              <FolderOpen className="w-4 h-4 mr-1" />
              打开工作目录
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => archiveInputRef.current?.click()}
              disabled={archiveImporting}
            >
              <Upload className="w-4 h-4 mr-1" />
              {archiveImporting ? '导入中...' : '导入 ZIP'}
            </Button>
            <Button size="sm" onClick={() => { setAiRevisionAgent(null); setShowAICreateModal(true); }} variant="outline">
              <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
              AI 创建
            </Button>
            <Button size="sm" onClick={handleCreateAgent}>
              <span className="material-symbols-outlined text-sm mr-1">add</span>
              新建 Agent
            </Button>
            <ThemeToggle />
          </div>
        </div>
      ) : null}

      <div
        data-agent-manager-scroll-root
        className={cn(
          'mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-6',
          embedded && 'min-h-0 flex-1 gap-3 overflow-auto px-4 py-4 pb-24',
        )}
      >
        {!embedded ? (
        <section data-tour-step-id="agent-hall" className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(8,11,21,0.98),rgba(19,19,20,0.94))] px-8 py-8 text-white shadow-[0_32px_120px_rgba(2,6,23,0.28)]">
          <div className="absolute inset-y-0 right-0 w-[32rem] bg-[radial-gradient(circle_at_center,_rgba(251,191,36,0.18),_transparent_52%)]" />
          <div className="absolute -left-12 top-10 h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />
          <div className="absolute bottom-0 right-24 h-56 w-56 rounded-full bg-rose-500/10 blur-3xl" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0,rgba(255,255,255,0.04)_49%,transparent_100%)] opacity-50" />

          <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <Badge className="border-amber-300/30 bg-amber-400/10 px-3 py-1 text-amber-100">
                角色大厅
              </Badge>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">像选角色一样管理你的 Agent 编队</h1>
                <p className="max-w-2xl text-sm leading-7 text-white/72 md:text-base">
                  这里不再只是配置列表。每个 Agent 都应该像可被调度、被记住、被协作的角色实体，拥有稳定头像、鲜明阵营和可感知的职责定位。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['all', 'common', 'compiler', 'openharmony'] as const).map((group) => (
                  <Button
                    key={group}
                    size="sm"
                    variant={selectedGroup === group ? 'default' : 'secondary'}
                    className={selectedGroup === group ? 'bg-white text-slate-950 hover:bg-white/90' : 'border-white/10 bg-white/10 text-white hover:bg-white/15'}
                    onClick={() => setSelectedGroup(group)}
                  >
                    {groupLabels[group]}
                    <span className="ml-2 rounded-full bg-black/20 px-1.5 py-0.5 text-[11px]">
                      {groupCounts[group]}
                    </span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:w-[34rem] xl:grid-cols-3">
              {[
                { label: '角色总数', value: agents.length, tone: 'from-white/18 to-white/5' },
                { label: '当前筛选', value: filteredAgents.length, tone: 'from-sky-400/22 to-sky-400/5' },
                { label: '指挥官', value: teamCounts['black-gold'], tone: 'from-amber-400/22 to-amber-400/5' },
              ].map((item) => (
                <div key={item.label} className={`rounded-2xl border border-white/10 bg-gradient-to-br ${item.tone} px-4 py-4 backdrop-blur`}>
                  <div className="text-xs uppercase tracking-[0.24em] text-white/50">{item.label}</div>
                  <div className="mt-3 text-3xl font-semibold">{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
        ) : null}

        {!embedded ? (
        <section
          className={cn(
            'z-10 rounded-[28px] border border-border/70 bg-card/85 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75',
            'sticky top-[4.5rem]',
          )}
        >
          <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[26px] border border-border/60 bg-background/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">推荐入口链路</div>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    先明确角色定位，再决定是进入首页协作、继续精修配置，还是把它编入 workflow。
                  </p>
                </div>
                <Badge variant="outline">5.1</Badge>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-[124px] whitespace-normal rounded-[24px] border border-border/60 bg-muted/30 p-4 text-left hover:bg-muted/60 hover:text-foreground"
                  onClick={() => { setAiRevisionAgent(null); setShowAICreateModal(true); }}
                >
                  <div className="w-full break-words">
                    <div className="text-sm font-medium">AI 创建 Agent</div>
                    <div className="mt-2 text-xs leading-6 text-muted-foreground">从职责和风格出发生成角色草案，再继续精修。</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-[124px] whitespace-normal rounded-[24px] border border-border/60 bg-muted/30 p-4 text-left hover:bg-muted/60 hover:text-foreground"
                  onClick={handleCreateAgent}
                >
                  <div className="w-full break-words">
                    <div className="text-sm font-medium">手动建模</div>
                    <div className="mt-2 text-xs leading-6 text-muted-foreground">直接配置模型、系统提示词和常驻对话属性。</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto min-h-[124px] whitespace-normal rounded-[24px] border border-border/60 bg-muted/30 p-4 text-left hover:bg-muted/60 hover:text-foreground"
                  onClick={() => setWorkspaceOpen(true)}
                  disabled={!runtimeAgentsDir}
                >
                  <div className="w-full break-words">
                    <div className="text-sm font-medium">查看运行目录</div>
                    <div className="mt-2 text-xs leading-6 text-muted-foreground">直接检查 runtime agents 文件结构和落地结果。</div>
                  </div>
                </Button>
              </div>
            </div>

            <div className="rounded-[26px] border border-border/60 bg-background/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">编队总览</div>
                  <div className="mt-1 text-xs text-muted-foreground">当前大厅中的角色数量、席位分布与管理视图概览。</div>
                </div>
                <Badge variant="secondary">{agents.length}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">可管理角色</div>
                  <div className="mt-2 text-2xl font-semibold">{filteredAgents.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">当前筛选结果可直接编辑、删除或批量整理</div>
                </div>
                <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/5 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-amber-600">Supervisor</div>
                  <div className="mt-2 text-2xl font-semibold">{supervisorAgents.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">负责设计收口、审阅、修订和阶段指挥</div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-5 gap-2">
                {TEAM_ORDER.map((team) => (
                  <div key={team} className="rounded-[20px] border border-border/60 bg-muted/30 px-3 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{teamLabels[team]}</div>
                    <div className="mt-2 text-xl font-semibold">{teamCounts[team]}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
        ) : null}

        {embedded ? (
          <>
            <section className="sticky top-0 z-20 rounded-[24px] border border-border/70 bg-card/95 p-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/95">
              <div className="flex items-center gap-3">
                <Input
                  placeholder="搜索 Agent..."
                  value={embeddedSearchDraft}
                  onChange={(e) => handleSearchInputChange(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleApplySearch();
                    }
                  }}
                  className="h-10 min-w-0 flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleApplySearch}
                  className="h-10 shrink-0"
                >
                  <Search className="mr-1 h-4 w-4" />
                  搜索
                </Button>
              </div>
            </section>

            <section className="rounded-[28px] border border-border/70 bg-card/70 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1 rounded-[24px] border border-border/60 bg-background/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">标签筛选</span>
                    {allTags.length > 0 ? (
                      allTags.map((tag) => (
                        <Badge
                          key={tag}
                          variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                          className="shrink-0 cursor-pointer whitespace-nowrap px-3 py-1"
                          onClick={() => toggleTag(tag)}
                        >
                          {tag}
                        </Badge>
                      ))
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">暂无标签</span>
                    )}
                  </div>
                </div>
                <div className="inline-flex shrink-0 rounded-full border border-border/60 bg-muted/40 p-1">
                  <Button
                    size="sm"
                    variant={viewMode === 'gallery' ? 'default' : 'ghost'}
                    className="h-8 rounded-full px-3"
                    onClick={() => setViewMode('gallery')}
                  >
                    <span className="material-symbols-outlined text-sm">grid_view</span>
                  </Button>
                  <Button
                    size="sm"
                    variant={viewMode === 'table' ? 'default' : 'ghost'}
                    className="h-8 rounded-full px-3"
                    onClick={() => setViewMode('table')}
                  >
                    <span className="material-symbols-outlined text-sm">table_rows</span>
                  </Button>
                </div>
              </div>
            </section>
          </>
        ) : null}

        {!embedded ? (
          <>
            <section
              className="sticky top-[4.5rem] z-20 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
            >
              <div>
                <div className="relative rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
                <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_55%)]" />
                <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                  <div className="flex w-full max-w-md items-center gap-2">
                    <Input
                      placeholder="搜索 Agent..."
                      value={embeddedSearchDraft}
                      onChange={(e) => handleSearchInputChange(e.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleApplySearch();
                        }
                      }}
                      className="h-11 w-full"
                    />
                    <Button
                      size="sm"
                      onClick={handleApplySearch}
                      className="h-11 shrink-0"
                    >
                      <Search className="mr-1 h-4 w-4" />
                      搜索
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'blue', 'red', 'judge'] as const).map((team) => (
                      <Button
                        key={team}
                        size="sm"
                        variant={selectedTeam === team ? 'default' : 'outline'}
                        className={cn(
                          'rounded-full',
                          selectedTeam === team && team !== 'all' && team === 'blue' && 'bg-sky-500 text-slate-950 hover:bg-sky-400',
                          selectedTeam === team && team !== 'all' && team === 'red' && 'bg-rose-500 text-white hover:bg-rose-400',
                          selectedTeam === team && team !== 'all' && team === 'judge' && 'bg-yellow-400 text-slate-950 hover:bg-yellow-300'
                        )}
                        onClick={() => setSelectedTeam(team)}
                      >
                        {team === 'all' ? '全部' : teamLabels[team]}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  当前显示 {filteredAgents.length} / {agents.length} 名角色
                </div>
              </div>
              </div>
              </div>
            </section>
          </>
        ) : null}

        {!embedded ? (
        <section className="rounded-[28px] border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="flex-1 rounded-[24px] border border-border/60 bg-background/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-col gap-3">
                  {allTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">标签筛选</span>
                      {allTags.map(tag => (
                        <Badge
                          key={tag}
                          variant={selectedTags.includes(tag) ? 'default' : 'outline'}
                          className="cursor-pointer px-3 py-1"
                          onClick={() => toggleTag(tag)}
                        >
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-[24px] border border-border/60 bg-background/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] xl:min-w-[320px]">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">编队筛选</div>
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={viewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setViewMode('gallery')}
                    >
                      角色墙
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => setViewMode('table')}
                    >
                      表格
                    </Button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                {CATEGORIES.map((cat) => (
                  <Button
                    key={cat}
                    size="sm"
                    variant={selectedCategory === cat ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => setSelectedCategory(selectedCategory === cat ? 'all' : cat)}
                  >
                    {cat}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant={selectedCategory === 'all' ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => setSelectedCategory('all')}
                >
                  全部分类
                </Button>
              </div>
              </div>
            </div>
          </div>
        </section>
        ) : null}

        <section className={cn('flex-1', embedded ? 'pb-20' : 'pb-28')}>
          <div className="space-y-10">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <ClipLoader color="hsl(var(--primary))" size={40} />
              </div>
            ) : filteredAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <span className="material-symbols-outlined text-5xl mb-4">smart_toy</span>
                <p>没有找到匹配的 Agent</p>
              </div>
            ) : (
              viewMode === 'gallery' ? (
                <div className="space-y-8">
                  {TEAM_ORDER.map(team => (
                    groupedAgents[team].length > 0 && (
                      <div key={team} className={cn('relative overflow-hidden rounded-xl border p-4 shadow-sm', teamPanelClass[team])}>
                        <div className="relative flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-3">
                              <span className={`h-3 w-3 rounded-full ${
                                team === 'blue' ? 'bg-blue-500' :
                                team === 'red' ? 'bg-red-500' :
                                team === 'judge' ? 'bg-yellow-400' :
                                team === 'black-gold' ? 'bg-amber-400' :
                                'bg-stone-200'
                              }`} />
                              <h2 className="text-2xl font-semibold">{teamLabels[team]}</h2>
                              <span className="text-sm text-muted-foreground">({groupedAgents[team].length})</span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{teamDescriptions[team]}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="px-3 py-1 text-xs">
                              阵营名册
                            </Badge>
                            <Badge variant="outline" className="px-3 py-1 text-xs">
                              {groupedAgents[team].length} 名角色
                            </Badge>
                          </div>
                        </div>
                        <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                          {groupedAgents[team].map(agent => {
                            const isSelected = selectedAgentNames.includes(agent.name);
                            return (
                              <div
                                key={agent.name}
                                className="group relative min-w-0"
                              >
                                <div className="absolute right-3 top-3 z-20 rounded-md border border-border bg-background/95 p-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.25)] opacity-40 group-hover:opacity-100 transition-opacity duration-200 hover:opacity-100">
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => toggleAgentSelection(agent.name)}
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={isSelected ? `取消选择 Agent ${agent.name}` : `选择 Agent ${agent.name}`}
                                    className="h-4 w-4 rounded-[4px]"
                                  />
                                </div>
                                <AgentHeroCard
                                  agent={agent as any}
                                  className="h-full"
                                  selected={isSelected}
                                  meta={
                                    <div className="space-y-1">
                                      <div className="truncate">{agent.temperature !== undefined ? `温度 ${agent.temperature}` : '默认温度'}</div>
                                      <div className="truncate text-muted-foreground">{agent.category || '未分类'} · {(agent.tags || []).length} 个标签</div>
                                      {getWorkspaceProfileBadges(agent).length > 0 ? (
                                        <div className="flex flex-wrap gap-1 pt-1">
                                          {getWorkspaceProfileBadges(agent).map((badge) => (
                                            <Badge key={badge.label} variant="outline" className={`text-[10px] ${badge.className}`}>
                                              {badge.label}
                                            </Badge>
                                          ))}
                                        </div>
                                      ) : null}
                                    </div>
                                  }
                                  actions={
                                    <>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-7 rounded-full border border-border/60 bg-background px-2.5 text-[11px] text-foreground hover:bg-muted"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleEditAgent(agent);
                                        }}
                                      >
                                        <span className="material-symbols-outlined text-sm mr-1">edit</span>
                                        编辑
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-7 rounded-full border border-border/60 bg-background px-2.5 text-[11px] text-foreground hover:bg-muted"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleReviseAgent(agent);
                                        }}
                                      >
                                        <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
                                        AI 修订
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="destructive"
                                        className="h-7 rounded-full px-2.5 text-[11px]"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleDeleteAgent(agent.name);
                                        }}
                                      >
                                        <span className="material-symbols-outlined text-sm mr-1">delete</span>
                                        删除
                                      </Button>
                                    </>
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              ) : (
                <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/80 shadow-sm">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">
                          <Checkbox
                            checked={allFilteredSelected ? true : hasPartialFilteredSelection ? 'indeterminate' : false}
                            onCheckedChange={toggleSelectAllFiltered}
                          />
                        </TableHead>
                        <TableHead>角色</TableHead>
                        <TableHead>阵营</TableHead>
                        <TableHead>分类</TableHead>
                        <TableHead>温度</TableHead>
                        <TableHead>标签</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAgents.map((agent) => {
                        const { avatarSrc } = getAgentRuntimeMeta(agent);
                        return (
                          <TableRow key={agent.name}>
                            <TableCell>
                              <Checkbox
                                checked={selectedAgentNames.includes(agent.name)}
                                onCheckedChange={() => toggleAgentSelection(agent.name)}
                              />
                            </TableCell>
                            <TableCell className="min-w-[220px]">
                              <div className="flex items-center gap-3">
                                <SpriteAvatar
                                  avatar={avatarSrc}
                                  seed={agent.name}
                                  category="agent-default"
                                  alt={agent.name}
                                  fallback={agent.name.slice(0, 2).toUpperCase()}
                                  className="h-11 w-11 ring-1 ring-border/60"
                                />
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{agent.name}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {agent.roleType === 'supervisor' ? (
                                      <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-200">Supervisor</Badge>
                                    ) : null}
                                    {getWorkspaceProfileBadges(agent).map((badge) => (
                                      <Badge key={badge.label} variant="outline" className={`text-[10px] ${badge.className}`}>
                                        {badge.label}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{teamLabels[agent.team]}</TableCell>
                            <TableCell>{agent.category || '未分类'}</TableCell>
                            <TableCell className="min-w-[120px]">
                              <div className="text-sm">
                                {agent.temperature !== undefined ? agent.temperature : '默认'}
                              </div>
                            </TableCell>
                            <TableCell className="min-w-[220px]">
                              <div className="flex flex-wrap gap-1.5">
                                {(agent.tags || []).slice(0, 4).map((tag) => (
                                  <Badge key={tag} variant="outline">{tag}</Badge>
                                ))}
                                {(agent.tags || []).length === 0 ? (
                                  <span className="text-sm text-muted-foreground">无</span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="secondary" onClick={() => handleEditAgent(agent)}>
                                  编辑
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => handleReviseAgent(agent)}>
                                  AI 修订
                                </Button>
                                <Button size="sm" variant="destructive" onClick={() => handleDeleteAgent(agent.name)}>
                                  删除
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )
            )}
          </div>
        </section>

        {filteredAgents.length > 0 ? (
          <div
            className={cn(
              'pointer-events-none left-1/2 z-40 w-full max-w-fit -translate-x-1/2 px-4',
              embedded ? 'absolute bottom-4' : 'fixed bottom-6',
            )}
          >
            <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-full border border-border/70 bg-background/95 px-3 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.18)] backdrop-blur">
              <div
                className="flex items-center rounded-full border border-border/70 bg-background px-4 py-2 text-sm shadow-sm"
                role="button"
                tabIndex={0}
                onClick={toggleSelectAllFilteredByContainer}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggleSelectAllFilteredByContainer();
                  }
                }}
              >
                <Checkbox
                  checked={allFilteredSelected ? true : hasPartialFilteredSelection ? 'indeterminate' : false}
                  onCheckedChange={toggleSelectAllFiltered}
                  className="mr-2 h-4 w-4 border-border bg-background"
                  aria-label={allFilteredSelected ? '取消全选' : '选择全部'}
                />
                {allFilteredSelected ? '取消全选' : '选择全部'}
              </div>
              <div className="px-3 text-sm font-medium text-foreground/80">
                已选 {selectedAgentNames.length} 项
              </div>
              {selectedAgentNames.length > 0 ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full px-4"
                  onClick={handleExportAgents}
                  disabled={archiveExporting}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {archiveExporting ? '导出中...' : '导出 ZIP'}
                </Button>
              ) : null}
              {selectedAgentNames.length > 0 ? (
                <Button
                  size="sm"
                  variant="destructive"
                  className="rounded-full px-4"
                  onClick={handleBatchDeleteAgents}
                >
                  <span className="material-symbols-outlined mr-2 text-base">delete</span>
                  批量删除
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {editingAgent && (
        <AgentEditModal
          agent={editingAgent}
          isNew={isNewAgent}
          onSave={handleSaveAgent}
          onClose={() => setEditingAgent(null)}
        />
      )}

      <AIAgentCreatorModal
        open={showAICreateModal || Boolean(aiRevisionAgent)}
        engine={globalEngine}
        model={globalDefaultModel}
        mode={aiRevisionAgent ? 'revise' : 'create'}
        baseAgent={aiRevisionAgent}
        onClose={() => {
          setShowAICreateModal(false);
          setAiRevisionAgent(null);
        }}
        onCreate={async (agent) => {
          try {
            const targetName = aiRevisionAgent?.name || agent.name;
            await agentApi.saveAgent(targetName, {
              ...agent,
              name: aiRevisionAgent?.name || agent.name,
            });
            await loadAgents();
            toast('success', aiRevisionAgent ? 'Agent 修订已保存' : 'Agent 配置已保存');
            return true;
          } catch (error: any) {
            toast('error', error.message || '保存 Agent 配置失败');
            return false;
          }
        }}
        onContinueEdit={aiRevisionAgent ? handleContinueEditAIRevisionAgent : handleContinueEditAIAgent}
      />

      {dialogProps && <ConfirmDialog {...dialogProps} />}

      {alertMessage && (
        <ConfirmDialog
          open={true}
          title="提示"
          description={alertMessage}
          confirmLabel="确定"
          cancelLabel=""
          variant="default"
          onConfirm={() => setAlertMessage('')}
          onCancel={() => setAlertMessage('')}
        />
      )}
    </div>
  );
}
