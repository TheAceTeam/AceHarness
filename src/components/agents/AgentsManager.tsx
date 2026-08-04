'use client';

import { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import Link from '@/lib/navigation/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ThemeToggle } from '@/components/theme-toggle';
import { Columns3, Download, Edit, FolderOpen, Loader2, RefreshCw, Search, Sparkles, Trash2, Upload } from 'lucide-react';
import AgentEditModal from '@/components/AgentEditModal';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import SpriteAvatar from '@/components/SpriteAvatar';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { ActionMenu, type ActionMenuGroup } from '@/components/ui/action-menu';
import {
  DataCard,
  DataCardActions,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { cn } from '@/lib/core/utils';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import { EXPERT_PACKS, isRetiredCatalogAgent, isSystemCatalogAgent } from '@/lib/agent/catalog';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import type { ReturnTarget } from '@/lib/navigation/return-target';
import {
  useAgentsQuery,
  useBatchDeleteAgentsMutation,
  useDeleteAgentMutation,
  useExportAgentsMutation,
  useImportAgentZipMutation,
  useSaveAgentMutation,
  type AgentConfig,
} from '@/client/query/agents';
import { useEngineConfigQuery } from '@/client/query/engines';
import { useAgentConfigRows, useSyncAgentConfigsToDb } from '@/client/db/collections';

const CATEGORIES = ['通用协作', '研究', '分析', '产品', '体验设计', '内容', '架构', '编码', '测试', '性能', '问题诊断', '审查', '文档', '系统协调', '其他'];
const EMPTY_AGENTS: AgentConfig[] = [];
const EXPERT_PACK_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  EXPERT_PACKS.map((pack) => [pack.id, pack.label]),
);
type DisplayTeam = 'blue' | 'red' | 'judge' | 'black-gold';
type AgentSortKey = 'name' | 'team' | 'category' | 'temperature';

interface AgentsManagerProps {
  embedded?: boolean;
  returnTarget?: ReturnTarget;
  highlightedAgentName?: string;
}

export default function AgentsManager({
  embedded = false,
  returnTarget = { href: '/dashboard', label: '返回仪表盘' },
  highlightedAgentName,
}: AgentsManagerProps) {
  const VIEW_MODE_STORAGE_KEY = 'aceharness:agents:view-mode';
  const { toast } = useToast();
  useDocumentTitle(embedded ? null : 'Agent 管理');
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
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [archiveImporting, setArchiveImporting] = useState(false);
  const [archiveExporting, setArchiveExporting] = useState(false);
  const [deleteTargetAgentName, setDeleteTargetAgentName] = useState<string | null>(null);
  const [batchDeleteConfirmOpen, setBatchDeleteConfirmOpen] = useState(false);
  const [agentSortKey, setAgentSortKey] = useState<AgentSortKey>('name');
  const [agentSortDirection, setAgentSortDirection] = useState<'asc' | 'desc'>('asc');
  const [visibleAgentColumnIds, setVisibleAgentColumnIds] = useState<string[]>(['agent', 'team', 'category', 'temperature', 'tags']);
  const archiveInputRef = useRef<HTMLInputElement | null>(null);
  const highlightedAgentLookupRef = useRef('');
  const agentsQuery = useAgentsQuery();
  const engineConfigQuery = useEngineConfigQuery();
  const saveAgentMutation = useSaveAgentMutation();
  const deleteAgentMutation = useDeleteAgentMutation();
  const batchDeleteAgentsMutation = useBatchDeleteAgentsMutation();
  const importAgentZipMutation = useImportAgentZipMutation();
  const exportAgentsMutation = useExportAgentsMutation();
  const sourceAgents = agentsQuery.data?.agents || EMPTY_AGENTS;
  const agents = useMemo(
    () => sourceAgents.filter((agent) => !isRetiredCatalogAgent(agent)),
    [sourceAgents],
  );
  const normalizedHighlightedAgentName = highlightedAgentName?.trim() || '';
  useSyncAgentConfigsToDb(agents);
  const dbAgents = (useAgentConfigRows({
    keyword: '',
    group: 'all',
    team: 'all',
    category: 'all',
    tags: [],
  }) as AgentConfig[]).filter((agent) => !isRetiredCatalogAgent(agent));
  const runtimeAgentsDir = agentsQuery.data?.runtimeAgentsDir || '';
  const loading = agentsQuery.isLoading && dbAgents.length === 0;
  const agentError = agentsQuery.error instanceof Error ? agentsQuery.error.message : null;
  const refreshAgents = async () => {
    await agentsQuery.refetch();
  };

  useEffect(() => {
    const data = engineConfigQuery.data;
    if (!data) return;
    if (data.engine) setGlobalEngine(data.engine);
    setGlobalDefaultModel(typeof data.defaultModel === 'string' ? data.defaultModel : '');
  }, [engineConfigQuery.data]);

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

  useEffect(() => {
    setSelectedAgentNames((prev) => {
      const next = prev.filter((name) => dbAgents.some((agent) => agent.name === name));
      if (next.length === prev.length && next.every((name, index) => name === prev[index])) return prev;
      return next;
    });
  }, [dbAgents]);

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

  useEffect(() => {
    if (!normalizedHighlightedAgentName) {
      highlightedAgentLookupRef.current = '';
      return;
    }
    if (agentsQuery.isLoading || highlightedAgentLookupRef.current === normalizedHighlightedAgentName) return;

    setSelectedGroup('all');
    setSelectedTeam('all');
    setSelectedCategory('all');
    setSelectedTags([]);
    setSearchQuery(normalizedHighlightedAgentName);
    setEmbeddedSearchDraft(normalizedHighlightedAgentName);

    const matchedAgent = agents.find((agent) => agent.name === normalizedHighlightedAgentName);
    if (matchedAgent) {
      setViewMode('gallery');
      setEditingAgent(matchedAgent);
      setIsNewAgent(false);
      highlightedAgentLookupRef.current = normalizedHighlightedAgentName;
      return;
    }

    if (!agentsQuery.isFetching) {
      highlightedAgentLookupRef.current = normalizedHighlightedAgentName;
      setAlertMessage(`未找到 Agent：${normalizedHighlightedAgentName}`);
    }
  }, [agents, agentsQuery.isFetching, agentsQuery.isLoading, normalizedHighlightedAgentName]);

  const handleReviseAgent = (agent: AgentConfig) => {
    setShowAICreateModal(false);
    setAiRevisionAgent(agent);
  };

  const handleSaveAgent = async (agent: AgentConfig) => {
    try {
      const targetName = isNewAgent ? agent.name : (editingAgent?.name || agent.name);
      await saveAgentMutation.mutateAsync({ name: targetName, agent });
      setEditingAgent(null);
      toast('success', 'Agent 配置已保存');
    } catch (error: any) {
      toast('error', error.message || '保存 Agent 配置失败');
    }
  };

  const handleDeleteAgent = (name: string) => {
    if (isSystemCatalogAgent({ name })) {
      toast('warning', '系统协调角色不能删除');
      return;
    }
    setDeleteTargetAgentName(name);
  };

  const confirmDeleteAgent = async () => {
    if (!deleteTargetAgentName) return;
    try {
      await deleteAgentMutation.mutateAsync(deleteTargetAgentName);
      setSelectedAgentNames((prev) => prev.filter((item) => item !== deleteTargetAgentName));
      setDeleteTargetAgentName(null);
    } catch (error) {
      console.error('Failed to delete agent:', error);
      setAlertMessage('删除失败: ' + (error as Error).message);
    }
  };

  const toggleAgentSelection = (name: string) => {
    if (isSystemCatalogAgent({ name })) return;
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
      setSelectedAgentNames(filteredAgents
        .filter((agent) => !isSystemCatalogAgent(agent))
        .map((agent) => agent.name));
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
    setBatchDeleteConfirmOpen(true);
  };

  const confirmBatchDeleteAgents = async () => {
    if (selectedAgentNames.length === 0) return;
    try {
      const result = await batchDeleteAgentsMutation.mutateAsync(selectedAgentNames);
      setSelectedAgentNames([]);
      setBatchDeleteConfirmOpen(false);
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
      const result = await importAgentZipMutation.mutateAsync(file);
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
      const blob = await exportAgentsMutation.mutateAsync(selectedAgentNames);
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
  const allTags = Array.from(new Set(dbAgents.flatMap(a => a.tags || [])));

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
  const filteredAgents = (useAgentConfigRows({
    keyword: searchQuery,
    group: selectedGroup,
    team: selectedTeam,
    category: selectedCategory,
    tags: selectedTags,
  }) as AgentConfig[]).filter((agent) => !isRetiredCatalogAgent(agent));
  const sortedAgents = [...filteredAgents].sort((a, b) => {
    const readValue = (agent: AgentConfig) => {
      if (agentSortKey === 'name') return agent.name || '';
      if (agentSortKey === 'team') return agent.team || '';
      if (agentSortKey === 'category') return agent.category || '';
      return agent.temperature ?? Number.NEGATIVE_INFINITY;
    };
    const aValue = readValue(a);
    const bValue = readValue(b);
    const result = typeof aValue === 'number' && typeof bValue === 'number'
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue), 'zh-CN');
    return agentSortDirection === 'asc' ? result : -result;
  });

  // Group agents by team
  const TEAM_ORDER: DisplayTeam[] = ['black-gold', 'red', 'blue', 'judge'];
  const groupedAgents = Object.fromEntries(
    TEAM_ORDER.map((team) => [team, sortedAgents.filter((agent) => normalizeTeam(agent.team) === team)])
  ) as Record<DisplayTeam, AgentConfig[]>;

  const teamCounts = Object.fromEntries(
    TEAM_ORDER.map((team) => [team, dbAgents.filter((agent) => normalizeTeam(agent.team) === team).length])
  ) as Record<DisplayTeam, number>;

  // Group agents by first tag (for sidebar counts)
  const groupCounts = {
    all: dbAgents.length,
    common: dbAgents.filter(a => getAgentGroup(a) === 'common').length,
    compiler: dbAgents.filter(a => getAgentGroup(a) === 'compiler').length,
    openharmony: dbAgents.filter(a => getAgentGroup(a) === 'openharmony').length,
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
  const teamDotClass: Record<DisplayTeam, string> = {
    'black-gold': 'bg-amber-500',
    blue: 'bg-sky-500',
    red: 'bg-rose-500',
    judge: 'bg-yellow-500',
  };
  const teamTone: Record<DisplayTeam, 'warning' | 'info' | 'danger' | 'neutral'> = {
    'black-gold': 'warning',
    blue: 'info',
    red: 'danger',
    judge: 'neutral',
  };
  const groupLabels: Record<string, string> = { all: '全部', common: '通用', compiler: '编译器', openharmony: '仓颉' };
  const supervisorAgents = dbAgents.filter((agent) => agent.roleType === 'supervisor');
  const selectableFilteredAgents = filteredAgents.filter((agent) => !isSystemCatalogAgent(agent));
  const allFilteredSelected = selectableFilteredAgents.length > 0 && selectableFilteredAgents.every((agent) => selectedAgentNames.includes(agent.name));
  const hasPartialFilteredSelection = selectableFilteredAgents.some((agent) => selectedAgentNames.includes(agent.name));

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

  const agentTableColumns: DataTableColumn<AgentConfig>[] = [
    {
      id: 'agent',
      header: '角色',
      width: '32%',
      render: (agent) => {
        const { avatarSrc } = getAgentRuntimeMeta(agent);
        return (
          <div className="flex min-w-[220px] items-center gap-3">
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
                {agent.roleType === 'supervisor' ? <StatusPill tone="warning">Supervisor</StatusPill> : null}
                {(agent.expertPacks || []).map((pack) => (
                  <Badge key={pack} variant="outline">{EXPERT_PACK_LABELS[pack] || pack}</Badge>
                ))}
                {getWorkspaceProfileBadges(agent).map((badge) => (
                  <Badge key={badge.label} variant="outline" className={`text-[10px] ${badge.className}`}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'team',
      header: '阵营',
      accessor: (agent) => teamLabels[agent.team] || agent.team || '未分配',
      priority: 2,
    },
    {
      id: 'category',
      header: '分类',
      accessor: (agent) => agent.category || '未分类',
      priority: 2,
    },
    {
      id: 'temperature',
      header: '温度',
      accessor: (agent) => agent.temperature !== undefined ? agent.temperature : '默认',
      priority: 3,
    },
    {
      id: 'tags',
      header: '标签',
      priority: 3,
      render: (agent) => (
        <div className="flex min-w-[180px] flex-wrap gap-1.5">
          {(agent.tags || []).slice(0, 4).map((tag) => (
            <Badge key={tag} variant="outline">{tag}</Badge>
          ))}
          {(agent.tags || []).length > 4 ? <Badge variant="outline">+{(agent.tags || []).length - 4}</Badge> : null}
          {(agent.tags || []).length === 0 ? <span className="text-sm text-muted-foreground">无</span> : null}
        </div>
      ),
    },
  ];
  const visibleAgentTableColumns = agentTableColumns.filter((column) => visibleAgentColumnIds.includes(column.id));

  const getAgentRowActions = (agent: AgentConfig): ActionMenuGroup[] => [
    {
      actions: [
        {
          id: 'edit',
          label: '编辑',
          icon: <Edit className="h-4 w-4" />,
          primary: true,
          onSelect: () => handleEditAgent(agent),
        },
        {
          id: 'ai-revise',
          label: 'AI 修订',
          icon: <Sparkles className="h-4 w-4" />,
          onSelect: () => handleReviseAgent(agent),
        },
        ...(!isSystemCatalogAgent(agent) ? [{
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          onSelect: () => handleDeleteAgent(agent.name),
        }] : []),
      ],
    },
  ];
  const { isDashboardShell } = useDashboardShellHeader({
    title: 'Agent 管理',
    subtitle: `管理 ${dbAgents.length} 个可调度角色与 Agent 编队`,
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
  }, [dbAgents.length, runtimeAgentsDir, archiveImporting, archiveExporting, selectedAgentNames.length]);

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
          title="Agent 配置目录"
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
        <PageHeader
          className="sticky top-0 z-20 bg-card/95 supports-[backdrop-filter]:bg-card/90"
          title="Agent 管理"
          subtitle={`管理 ${dbAgents.length} 个可调度角色与 Agent 编队`}
          status={<StatusPill tone={agentError ? 'danger' : 'accent'}>{agentError ? '加载异常' : `${filteredAgents.length} 可见`}</StatusPill>}
          leading={(
            <Button variant="ghost" size="icon" asChild>
              <Link href={returnTarget.href} aria-label={returnTarget.label} title={returnTarget.label}>
                <span className="material-symbols-outlined text-lg">arrow_back</span>
              </Link>
            </Button>
          )}
          secondaryActions={(
            <>
              <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeAgentsDir}>
                <FolderOpen className="mr-2 h-4 w-4" />
                工作目录
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => archiveInputRef.current?.click()}
                disabled={archiveImporting}
              >
                <Upload className={cn('mr-2 h-4 w-4', archiveImporting && 'animate-bounce')} />
                {archiveImporting ? '导入中' : '导入 ZIP'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setAiRevisionAgent(null); setShowAICreateModal(true); }}>
                <span className="material-symbols-outlined mr-1 text-sm">auto_awesome</span>
                AI 创建
              </Button>
              <ThemeToggle />
            </>
          )}
          primaryAction={(
            <Button size="sm" variant="outline" onClick={handleCreateAgent} data-tour-step-id="agent-create">
              <span className="material-symbols-outlined mr-1 text-sm">add</span>
              新建 Agent
            </Button>
          )}
        />
      ) : null}

      <div
        data-agent-manager-scroll-root
        className={cn(
          'mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-6',
          embedded && 'min-h-0 flex-1 gap-3 overflow-auto px-4 py-4 pb-24',
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-tour-step-id="agent-hall">
          <DataCard>
            <DataCardTitle>角色总数</DataCardTitle>
            <div className="mt-3 text-2xl font-semibold">{dbAgents.length}</div>
            <DataCardDescription>全部可调度 Agent</DataCardDescription>
          </DataCard>
          <DataCard>
            <DataCardTitle>当前筛选</DataCardTitle>
            <div className="mt-3 text-2xl font-semibold">{filteredAgents.length}</div>
            <DataCardDescription>可直接编辑、导出或批量整理</DataCardDescription>
          </DataCard>
          <DataCard>
            <DataCardTitle>Supervisor</DataCardTitle>
            <div className="mt-3 text-2xl font-semibold">{supervisorAgents.length}</div>
            <DataCardDescription>承担统筹、复核与阶段指挥</DataCardDescription>
          </DataCard>
          <DataCard>
            <DataCardTitle>工作目录</DataCardTitle>
            <DataCardDescription>{runtimeAgentsDir ? 'Agent 配置目录已连接' : '暂无可打开目录'}</DataCardDescription>
            <DataCardActions className="mt-3 justify-start">
              <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeAgentsDir}>
                <FolderOpen className="mr-2 h-4 w-4" />
                打开
              </Button>
            </DataCardActions>
          </DataCard>
        </div>

        <PageToolbar
          className={cn(
            'sticky z-40 rounded-xl border border-border bg-card px-4 shadow-none',
            embedded ? 'top-0' : 'top-[4.5rem]',
          )}
          search={(
            <div className="flex items-center gap-2">
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
                className="h-10"
              />
              <Button size="sm" variant="outline" onClick={handleApplySearch} className="h-10 shrink-0">
                <Search className="mr-2 h-4 w-4" />
                搜索
              </Button>
            </div>
          )}
          filters={(
            <>
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'common', 'compiler', 'openharmony'] as const).map((group) => (
                  <Button
                    key={group}
                    size="sm"
                    variant={selectedGroup === group ? 'secondary' : 'outline'}
                    onClick={() => setSelectedGroup(group)}
                  >
                    {groupLabels[group]}
                    <span className="ml-2 text-xs text-muted-foreground">{groupCounts[group]}</span>
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['all', 'black-gold', 'blue', 'red', 'judge'] as const).map((team) => (
                  <Button
                    key={team}
                    size="sm"
                    variant={selectedTeam === team ? 'secondary' : 'outline'}
                    onClick={() => setSelectedTeam(team)}
                  >
                    {team === 'all' ? '全部阵营' : teamLabels[team]}
                  </Button>
                ))}
              </div>
            </>
          )}
          sort={(
            <div className="inline-flex items-center gap-2">
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                value={agentSortKey}
                onChange={(event) => setAgentSortKey(event.target.value as AgentSortKey)}
                aria-label="Agent 排序字段"
              >
                <option value="name">名称</option>
                <option value="team">阵营</option>
                <option value="category">分类</option>
                <option value="temperature">温度</option>
              </select>
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => setAgentSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))}
              >
                {agentSortDirection === 'asc' ? '升序' : '降序'}
              </Button>
            </div>
          )}
          viewToggle={(
            <div className="inline-flex rounded-lg border border-border bg-background p-1">
              <Button
                size="sm"
                variant={viewMode === 'gallery' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => setViewMode('gallery')}
              >
                角色墙
              </Button>
              <Button
                size="sm"
                variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                className="h-8 px-3"
                onClick={() => setViewMode('table')}
              >
                表格
              </Button>
            </div>
          )}
          refresh={(
            <Button size="icon" variant="outline" onClick={() => void refreshAgents()} disabled={agentsQuery.isFetching} title="刷新 Agent">
              <RefreshCw className={cn('h-4 w-4', agentsQuery.isFetching && 'animate-spin')} />
            </Button>
          )}
          actions={(
            <>
              <ActionMenu
                triggerLabel="Agent 列显示"
                trigger={(
                  <Button size="icon" variant="outline" title="列显示" onClick={(event) => event.stopPropagation()}>
                    <Columns3 className="h-4 w-4" />
                  </Button>
                )}
                actions={[{
                  label: '列显示',
                  actions: agentTableColumns.map((column) => ({
                    id: column.id,
                    label: visibleAgentColumnIds.includes(column.id) ? `隐藏 ${String(column.header)}` : `显示 ${String(column.header)}`,
                    disabled: column.id === 'agent',
                    disabledReason: '主列必须显示',
                    onSelect: () => {
                      if (column.id === 'agent') return;
                      setVisibleAgentColumnIds((prev) => (
                        prev.includes(column.id)
                          ? prev.filter((id) => id !== column.id)
                          : [...prev, column.id]
                      ));
                    },
                  })),
                }]}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={handleExportAgents}
                disabled={archiveExporting || selectedAgentNames.length === 0}
              >
                <Download className={cn('mr-2 h-4 w-4', archiveExporting && 'animate-bounce')} />
                {archiveExporting ? '导出中' : '导出 ZIP'}
              </Button>
            </>
          )}
          activeFilters={(
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">分类</span>
                <Button
                  size="sm"
                  variant={selectedCategory === 'all' ? 'secondary' : 'outline'}
                  onClick={() => setSelectedCategory('all')}
                >
                  全部分类
                </Button>
                {CATEGORIES.map((cat) => (
                  <Button
                    key={cat}
                    size="sm"
                    variant={selectedCategory === cat ? 'secondary' : 'outline'}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? 'all' : cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">标签</span>
                {allTags.length > 0 ? (
                  allTags.map((tag) => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? 'secondary' : 'outline'}
                      className="cursor-pointer px-3 py-1"
                      onClick={() => toggleTag(tag)}
                    >
                      {tag}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">暂无标签</span>
                )}
              </div>
            </>
          )}
        />

        <section className={cn('flex-1', embedded ? 'pb-20' : 'pb-28')}>
          <div className="space-y-10">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-10 w-10 animate-spin text-primary" aria-label="加载中" />
              </div>
            ) : agentError ? (
              <div className="flex flex-col items-center justify-center h-64 gap-4">
                <p className="text-destructive">{agentError || '获取 Agent 列表失败'}</p>
                <Button onClick={() => void agentsQuery.refetch()}>重试</Button>
              </div>
            ) : sortedAgents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <span className="material-symbols-outlined text-5xl mb-4">smart_toy</span>
                <p>没有找到匹配的 Agent</p>
              </div>
            ) : (
              viewMode === 'gallery' ? (
                <div className="space-y-8">
                  {TEAM_ORDER.map(team => (
                    groupedAgents[team].length > 0 && (
                      <div key={team} className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-none">
                        <div className="relative flex flex-wrap items-end justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-3">
                              <span className={cn('h-2.5 w-2.5 rounded-full', teamDotClass[team])} />
                              <h2 className="text-lg font-semibold">{teamLabels[team]}</h2>
                              <span className="text-sm text-muted-foreground">({groupedAgents[team].length})</span>
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">{teamDescriptions[team]}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <StatusPill tone={teamTone[team]}>
                              {groupedAgents[team].length} 名角色
                            </StatusPill>
                          </div>
                        </div>
                        <div className="relative mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                          {groupedAgents[team].map(agent => {
                            const isSelected = selectedAgentNames.includes(agent.name);
                            const isSystemAgent = isSystemCatalogAgent(agent);
                            const { avatarSrc } = getAgentRuntimeMeta(agent);
                            return (
                              <DataCard
                                key={agent.name}
                                selected={isSelected}
                                className="group relative min-w-0 cursor-pointer"
                                onClick={() => handleEditAgent(agent)}
                              >
                                <div className="absolute right-3 top-3 z-10 rounded-md border border-border bg-background p-1.5 opacity-70 transition-opacity duration-150 group-hover:opacity-100">
                                  {isSystemAgent ? (
                                    <span className="px-1 text-[10px] text-muted-foreground">系统</span>
                                  ) : (
                                    <Checkbox
                                      checked={isSelected}
                                      onCheckedChange={() => toggleAgentSelection(agent.name)}
                                      onClick={(event) => event.stopPropagation()}
                                      aria-label={isSelected ? `取消选择 Agent ${agent.name}` : `选择 Agent ${agent.name}`}
                                      className="h-4 w-4 rounded-[4px]"
                                    />
                                  )}
                                </div>
                                <DataCardHeader className="pr-9">
                                  <div className="flex min-w-0 items-center gap-3">
                                    <SpriteAvatar
                                      avatar={avatarSrc}
                                      seed={agent.name}
                                      category="agent-default"
                                      alt={agent.name}
                                      fallback={agent.name.slice(0, 2).toUpperCase()}
                                      className="h-11 w-11 ring-1 ring-border/60"
                                    />
                                    <div className="min-w-0">
                                      <DataCardTitle>{agent.name}</DataCardTitle>
                                      <DataCardDescription className="truncate">
                                        {agent.category || '未分类'} · {agent.temperature !== undefined ? `温度 ${agent.temperature}` : '默认温度'}
                                      </DataCardDescription>
                                    </div>
                                  </div>
                                </DataCardHeader>
                                <DataCardMeta>
                                  {agent.roleType === 'supervisor' ? <StatusPill tone="warning">Supervisor</StatusPill> : null}
                                  {(agent.expertPacks || []).map((pack) => (
                                    <Badge key={pack} variant="outline">{EXPERT_PACK_LABELS[pack] || pack}</Badge>
                                  ))}
                                  <StatusPill tone={teamTone[team]}>{teamLabels[team]}</StatusPill>
                                  {(agent.tags || []).slice(0, 3).map((tag) => (
                                    <Badge key={tag} variant="outline">{tag}</Badge>
                                  ))}
                                  {(agent.tags || []).length > 3 ? (
                                    <Badge variant="outline">+{(agent.tags || []).length - 3}</Badge>
                                  ) : null}
                                  {getWorkspaceProfileBadges(agent).map((badge) => (
                                    <Badge key={badge.label} variant="outline" className={`text-[10px] ${badge.className}`}>
                                      {badge.label}
                                    </Badge>
                                  ))}
                                </DataCardMeta>
                                <DataCardActions>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleEditAgent(agent);
                                    }}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleReviseAgent(agent);
                                    }}
                                  >
                                    AI 修订
                                  </Button>
                                  {!isSystemAgent ? (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDeleteAgent(agent.name);
                                      }}
                                    >
                                      删除
                                    </Button>
                                  ) : null}
                                </DataCardActions>
                              </DataCard>
                            );
                          })}
                        </div>
                      </div>
                    )
                  ))}
                </div>
              ) : (
                <DataTable
                  aria-label="Agent 列表"
                  columns={visibleAgentTableColumns}
                  rows={sortedAgents}
                  rowKey="name"
                  density="comfortable"
                  onRowClick={handleEditAgent}
                  rowActions={(agent) => getAgentRowActions(agent)}
                  selection={{
                    selectedKeys: selectedAgentNames,
                    onSelectedKeysChange: (keys) => setSelectedAgentNames(keys.map(String)),
                    ariaLabel: allFilteredSelected ? '取消全选 Agent' : '选择全部 Agent',
                  }}
                  emptyState={{
                    title: '没有找到匹配的 Agent',
                    description: '尝试调整搜索、阵营、分类或标签过滤条件。',
                  }}
                />
              )
            )}
          </div>
        </section>

        {filteredAgents.length > 0 ? (
          <BulkActionBar
            selectedCount={selectedAgentNames.length}
            onClear={() => setSelectedAgentNames([])}
            className={cn(
              'bg-card/95',
              embedded && 'absolute bottom-4',
            )}
            actions={(
              <>
                <div
                  className="flex cursor-pointer items-center rounded-lg border border-border bg-background px-3 py-2 text-sm"
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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportAgents}
                  disabled={archiveExporting}
                >
                  <Download className="mr-2 h-4 w-4" />
                  {archiveExporting ? '导出中' : '导出 ZIP'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={handleBatchDeleteAgents}
                >
                  <span className="material-symbols-outlined mr-2 text-base">delete</span>
                  批量删除
                </Button>
              </>
            )}
          />
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
            await saveAgentMutation.mutateAsync({
              name: targetName,
              agent: {
              ...agent,
              name: aiRevisionAgent?.name || agent.name,
              },
            });
            toast('success', aiRevisionAgent ? 'Agent 修订已保存' : 'Agent 配置已保存');
            return true;
          } catch (error: any) {
            toast('error', error.message || '保存 Agent 配置失败');
            return false;
          }
        }}
        onContinueEdit={aiRevisionAgent ? handleContinueEditAIRevisionAgent : handleContinueEditAIAgent}
      />

      <ConfirmModal
        open={Boolean(deleteTargetAgentName)}
        variant="delete"
        title="删除 Agent"
        objectName={deleteTargetAgentName}
        consequence="删除后将移除该 Agent 配置，此操作无法撤销。"
        confirmLabel="删除"
        loading={deleteAgentMutation.isPending}
        onConfirm={confirmDeleteAgent}
        onCancel={() => setDeleteTargetAgentName(null)}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetAgentName(null);
        }}
      />

      <ConfirmModal
        open={batchDeleteConfirmOpen}
        variant="delete"
        title="批量删除 Agent"
        objectName={`${selectedAgentNames.length} 个 Agent`}
        consequence="删除后将移除所选 Agent 配置，此操作无法撤销。"
        confirmLabel={`删除 ${selectedAgentNames.length} 个`}
        loading={batchDeleteAgentsMutation.isPending}
        affectedItems={selectedAgentNames.map((name) => ({ id: name, label: name }))}
        onConfirm={confirmBatchDeleteAgents}
        onCancel={() => setBatchDeleteConfirmOpen(false)}
        onOpenChange={setBatchDeleteConfirmOpen}
      />

      <ConfirmModal
        open={Boolean(alertMessage)}
        title="提示"
        consequence={alertMessage}
        confirmLabel="确定"
        onConfirm={() => setAlertMessage('')}
        onCancel={() => setAlertMessage('')}
        onOpenChange={(open) => {
          if (!open) setAlertMessage('');
        }}
      />
    </div>
  );
}
