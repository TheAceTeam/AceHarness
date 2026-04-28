'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { agentApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { FolderOpen, Globe } from 'lucide-react';
import { EngineIcon } from '@/components/EngineIcon';
import { getConcreteEngines, getEngineMeta } from '@/lib/engine-metadata';
import AgentEditModal from '@/components/AgentEditModal';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import { ClipLoader } from 'react-spinners';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { ModelOption } from '@/lib/models';
import { SingleCombobox, type ComboboxOption, type ComboboxGroupDef } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  listSessionsForAgent,
  type ChatSessionSummaryLike,
} from '@/lib/agent-conversations';
import { cn } from '@/lib/utils';
import { resolveAgentAvatarSrc } from '@/lib/agent-personas';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';

interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'yellow' | 'black-gold';
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
  description?: string;
  alwaysAvailableForChat?: boolean;
}

const CATEGORIES = ['测试', '编码', '设计', '压力测试', '审查', '文档', '其他'];
type DisplayTeam = 'blue' | 'red' | 'judge' | 'black-gold';

export default function AgentsPage() {
  const VIEW_MODE_STORAGE_KEY = 'aceharness:agents:view-mode';
  const router = useRouter();
  const { toast } = useToast();
  useDocumentTitle('Agent 管理');
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedTeam, setSelectedTeam] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [isNewAgent, setIsNewAgent] = useState(false);
  const [showAICreateModal, setShowAICreateModal] = useState(false);
  const [showBatchReplaceModal, setShowBatchReplaceModal] = useState(false);
  const [fromModel, setFromModel] = useState('');
  const [toModel, setToModel] = useState('');
  const [batchReplacing, setBatchReplacing] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [chatSessions, setChatSessions] = useState<ChatSessionSummaryLike[]>([]);
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('table');
  const [runtimeAgentsDir, setRuntimeAgentsDir] = useState('');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [floatingFilterBar, setFloatingFilterBar] = useState(false);
  const filterBarAnchorRef = useRef<HTMLDivElement | null>(null);
  const filterBarMeasureRef = useRef<HTMLDivElement | null>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);
  const { confirm, dialogProps } = useConfirmDialog();

  useEffect(() => {
    loadAgents();
    loadModels();
    loadChatSessions();
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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateFloatingState = () => {
      const anchor = filterBarAnchorRef.current;
      if (!anchor) return;
      const topOffset = 8;
      const rect = anchor.getBoundingClientRect();
      setFloatingFilterBar(rect.top <= topOffset);
    };

    const updateMeasure = () => {
      if (filterBarMeasureRef.current) {
        setFilterBarHeight(filterBarMeasureRef.current.getBoundingClientRect().height);
      }
    };

    updateMeasure();
    updateFloatingState();
    window.addEventListener('scroll', updateFloatingState, { passive: true });
    window.addEventListener('resize', updateMeasure);
    window.addEventListener('resize', updateFloatingState);
    return () => {
      window.removeEventListener('scroll', updateFloatingState);
      window.removeEventListener('resize', updateMeasure);
      window.removeEventListener('resize', updateFloatingState);
    };
  }, []);

  const loadModels = async () => {
    try {
      const response = await fetch('/api/models');
      const data = await response.json();
      setAvailableModels(data.models || []);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

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

  const loadChatSessions = async () => {
    try {
      const response = await fetch('/api/chat/sessions');
      const data = await response.json();
      setChatSessions(data.sessions || []);
    } catch {
      setChatSessions([]);
    }
  };

  const handleCreateAgent = () => {
      setEditingAgent({
        name: '',
        team: 'blue',
        roleType: 'normal',
        engineModels: {},
        activeEngine: '',
        tags: [],
      capabilities: [],
      systemPrompt: '',
    });
    setIsNewAgent(true);
  };

  const handleContinueEditAIAgent = (agent: AgentConfig) => {
    setShowAICreateModal(false);
    setEditingAgent({
      ...agent,
      team: agent.team || 'blue',
      roleType: agent.roleType || 'normal',
      engineModels: agent.engineModels || {},
      activeEngine: agent.activeEngine || '',
      tags: agent.tags || [],
      capabilities: agent.capabilities || [],
      systemPrompt: agent.systemPrompt || '',
    });
    setIsNewAgent(true);
  };

  const handleEditAgent = (agent: AgentConfig) => {
    setEditingAgent(agent);
    setIsNewAgent(false);
  };

  const handleSaveAgent = async (agent: AgentConfig) => {
    try {
      await agentApi.saveAgent(agent.name, agent);
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

  const handleBatchReplaceModel = async () => {
    if (!fromModel || !toModel) {
      setAlertMessage('请选择源模型和目标模型');
      return;
    }
    // Parse composite "engine::model" values
    const [fromEng, ...fromRest] = fromModel.split('::');
    const fromMod = fromRest.join('::');
    const [toEng, ...toRest] = toModel.split('::');
    const toMod = toRest.join('::');

    if (fromEng === toEng && fromMod === toMod) {
      setAlertMessage('源模型和目标模型不能相同');
      return;
    }
    const confirmed = await confirm({
      title: '确认批量替换',
      description: `确定要将引擎 "${fromEng || '跟随全局'}" 下使用 "${fromMod}" 的 Agent 替换为 "${toEng || '跟随全局'}" 的 "${toMod}" 吗？`,
      confirmLabel: '确认替换',
      cancelLabel: '取消',
      variant: 'default',
    });
    if (!confirmed) return;

    setBatchReplacing(true);
    try {
      const result = await agentApi.batchReplaceModel(fromEng, fromMod, toMod);
      setAlertMessage(result.message);
      await loadAgents();
      setShowBatchReplaceModal(false);
      setFromModel('');
      setToModel('');
    } catch (error: any) {
      setAlertMessage('批量替换失败: ' + error.message);
    } finally {
      setBatchReplacing(false);
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

  // Get all unique models (from engineModels values)
  const allModels = Array.from(new Set(agents.flatMap(a => Object.values(a.engineModels || {})).filter(Boolean)));

  const ALL_ENGINES = [
    {
      id: '',
      name: '跟随全局',
      icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
    },
    ...getConcreteEngines().map((engine) => ({
      id: engine.id,
      name: engine.name,
      icon: <EngineIcon engineId={engine.id} className="h-4 w-4" />,
    })),
  ];

  // Source: only engine::model combos that actually exist in agents
  const batchSourceGroups: ComboboxGroupDef[] = (() => {
    // Collect all existing engine::model pairs from agents
    const existing = new Map<string, Set<string>>();
    for (const a of agents) {
      for (const [eng, mod] of Object.entries(a.engineModels || {})) {
        if (!mod) continue;
        if (!existing.has(eng)) existing.set(eng, new Set());
        existing.get(eng)!.add(mod);
      }
    }
    return ALL_ENGINES
      .filter(eng => existing.has(eng.id))
      .map(eng => ({
        label: eng.name,
        icon: eng.icon,
        items: Array.from(existing.get(eng.id)!).map(mod => {
          const label = availableModels.find(m => m.value === mod)?.label || mod;
          return { value: `${eng.id}::${mod}`, label, icon: eng.icon };
        }),
      }))
      .filter(g => g.items.length > 0);
  })();

  // Target: filter by effective engine (follow-global uses globalEngine)
  const batchTargetGroups: ComboboxGroupDef[] = (() => {
    if (!fromModel) return [];
    const [srcEng] = fromModel.split('::');
    const effectiveEng = srcEng || globalEngine;
    const eng = ALL_ENGINES.find(e => e.id === srcEng) || ALL_ENGINES[0];
    const engineModels = availableModels.filter(
      m => !m.engines || m.engines.length === 0 || m.engines.includes(effectiveEng),
    );
    if (engineModels.length === 0) return [];
    return [{
      label: eng.name,
      icon: eng.icon,
      items: engineModels.map(m => ({
        value: `${srcEng}::${m.value}`,
        label: m.label,
        icon: eng.icon,
      })),
    }];
  })();

  const normalizeTeam = (team: AgentConfig['team']): DisplayTeam =>
    team === 'yellow' ? 'judge' : (team as DisplayTeam);

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
  const TEAM_ORDER: DisplayTeam[] = ['black-gold', 'blue', 'red', 'judge'];
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
    judge: '黄队',
  };
  const teamDescriptions: Record<string, string> = {
    'black-gold': '统筹、评估、给出阶段指导',
    blue: '实施、防守、稳定推进主任务',
    red: '攻击、挑战、寻找风险与反例',
    judge: '裁定、复核、形成结论与分歧意见',
  };
  const teamPanelClass: Record<DisplayTeam, string> = {
    'black-gold': 'border-amber-300/20 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.1),_transparent_45%),linear-gradient(180deg,rgba(24,24,27,0.82),rgba(10,10,10,0.64))]',
    blue: 'border-sky-400/20 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.1),_transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.82),rgba(15,23,42,0.64))]',
    red: 'border-rose-400/20 bg-[radial-gradient(circle_at_top,_rgba(251,113,133,0.1),_transparent_45%),linear-gradient(180deg,rgba(69,10,10,0.82),rgba(39,17,28,0.64))]',
    judge: 'border-stone-300/20 bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.08),_transparent_45%),linear-gradient(180deg,rgba(30,41,59,0.84),rgba(15,23,42,0.64))]',
  };
  const groupLabels: Record<string, string> = { all: '全部', common: '通用', compiler: '编译器', openharmony: '仓颉' };
  const chatReadyAgents = agents.filter((agent) => agent.alwaysAvailableForChat);
  const supervisorAgents = agents.filter((agent) => agent.roleType === 'supervisor');

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const openHomepageChatForAgent = (agent: AgentConfig) => {
    const params = new URLSearchParams({
      sidebarTab: 'agent',
      sessionTitle: `${agent.name} 对话`,
      agentName: agent.name,
      agentTeam: agent.team,
      agentRoleType: agent.roleType || 'normal',
    });
    router.push(`/?${params.toString()}`);
  };

  const continueBoundSessionForAgent = (agent: AgentConfig) => {
    const target = listSessionsForAgent(chatSessions, agent.name)[0];
    if (!target) {
      openHomepageChatForAgent(agent);
      return;
    }
    const params = new URLSearchParams({
      sessionId: target.id,
      sidebarTab: agent.roleType === 'supervisor' ? 'commander' : 'agent',
    });
    router.push(`/?${params.toString()}`);
  };

  const getAgentRuntimeMeta = (agent: AgentConfig) => {
    const relatedSessions = listSessionsForAgent(chatSessions, agent.name);
    const latestSession = relatedSessions[0];
    const resolved = resolveAgentSelection(agent as any, {
      engine: globalEngine,
      defaultModel: globalDefaultModel,
    });
    const engineLabel = resolved.effectiveEngine
      ? (getEngineMeta(resolved.effectiveEngine)?.name || resolved.effectiveEngine)
      : '未配置';
    return {
      latestSession,
      resolved,
      engineLabel,
      avatarSrc: resolveAgentAvatarSrc(agent.avatar, agent.name, {
        team: agent.team,
        roleType: agent.roleType || 'normal',
      }),
    };
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.08),_transparent_25%),radial-gradient(circle_at_20%_20%,_rgba(59,130,246,0.1),_transparent_30%),radial-gradient(circle_at_80%_10%,_rgba(244,63,94,0.08),_transparent_28%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--background)))]">
      {runtimeAgentsDir ? (
        <WorkspaceEditor
          open={workspaceOpen}
          onOpenChange={setWorkspaceOpen}
          workspacePath={runtimeAgentsDir}
          title="Runtime Agents"
        />
      ) : null}
      <div className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <span className="material-symbols-outlined text-lg">arrow_back</span>
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">Agent 管理</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setWorkspaceOpen(true)} disabled={!runtimeAgentsDir}>
            <FolderOpen className="w-4 h-4 mr-1" />
            打开工作目录
          </Button>
          <Button size="sm" onClick={() => setShowAICreateModal(true)} variant="outline">
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

      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-6 py-6">
        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(135deg,rgba(8,11,21,0.98),rgba(19,19,20,0.94))] px-8 py-8 text-white shadow-[0_32px_120px_rgba(2,6,23,0.28)]">
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

        <section className="sticky top-[4.5rem] z-10 rounded-[28px] border border-border/70 bg-card/85 p-5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/75">
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
                  onClick={() => setShowAICreateModal(true)}
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
                  onClick={() => router.push('/?sidebarTab=agent&starterAction=create_agent&sessionTitle=Agent%20%E8%A7%84%E5%88%92')}
                >
                  <div className="w-full break-words">
                    <div className="text-sm font-medium">首页先规划</div>
                    <div className="mt-2 text-xs leading-6 text-muted-foreground">回到首页按对话方式先收敛需求，再回这里落地成角色。</div>
                  </div>
                </Button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>工具操作后置处理：</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 rounded-full px-3 text-xs"
                  onClick={() => setShowBatchReplaceModal(true)}
                >
                  <span className="material-symbols-outlined mr-1 text-sm">swap_horiz</span>
                  批量替换模型
                </Button>
              </div>
            </div>

            <div className="rounded-[26px] border border-border/60 bg-background/80 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">编队总览</div>
                  <div className="mt-1 text-xs text-muted-foreground">当前大厅中最常被调起的常驻角色与席位分布。</div>
                </div>
                <Badge variant="secondary">{chatReadyAgents.length + supervisorAgents.length}</Badge>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/5 p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-600">常驻对话</div>
                  <div className="mt-2 text-2xl font-semibold">{chatReadyAgents.length}</div>
                  <div className="mt-1 text-xs text-muted-foreground">适合首页长期协作与反复追问</div>
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
              {chatReadyAgents.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {chatReadyAgents.slice(0, 5).map((agent) => (
                    <Button key={agent.name} size="sm" variant="outline" onClick={() => openHomepageChatForAgent(agent)}>
                      {agent.name}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <div ref={filterBarAnchorRef} className="h-px" />
        {floatingFilterBar ? <div style={{ height: filterBarHeight }} /> : null}
        <section
          className={cn(
            floatingFilterBar
              ? 'fixed inset-x-0 top-2 z-40 px-6'
              : 'relative z-10'
          )}
        >
          <div className={cn(floatingFilterBar && 'mx-auto max-w-[1680px]')}>
            <div ref={filterBarMeasureRef} className="relative rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
            <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_55%)]" />
            <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
              <Input
                placeholder="搜索 Agent..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-11 w-full max-w-sm"
              />
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

        <section className="flex-1 pb-10">
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
                <div className="space-y-10">
                  {TEAM_ORDER.map(team => (
                    groupedAgents[team].length > 0 && (
                      <div key={team} className={cn('relative overflow-hidden rounded-[30px] border p-5 shadow-sm backdrop-blur', teamPanelClass[team])}>
                        <div className="absolute -right-16 top-0 h-44 w-44 rounded-full bg-white/5 blur-3xl" />
                        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),transparent_20%,transparent_75%,rgba(255,255,255,0.02))]" />
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
                            <p className="mt-1 text-sm text-white/70">{teamDescriptions[team]}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                              阵营名册
                            </Badge>
                            <Badge variant="outline" className="border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                              {groupedAgents[team].length} 名角色
                            </Badge>
                          </div>
                        </div>
                        <div className="relative mt-5 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
                          {groupedAgents[team].map(agent => {
                            const { latestSession, resolved, engineLabel } = getAgentRuntimeMeta(agent);
                            return (
                              <div
                                key={agent.name}
                                className="group relative min-w-0"
                              >
                                <AgentHeroCard
                                  agent={agent as any}
                                  className="h-full"
                                  meta={
                                    <div className="space-y-1">
                                      <div className="truncate">{engineLabel} / {resolved.effectiveModel || '未配置模型'}{agent.temperature !== undefined ? ` / temp ${agent.temperature}` : ''}</div>
                                      {latestSession?.workflowBinding ? (
                                        <div className="truncate text-white/45">
                                          Run {latestSession.workflowBinding.runId} · {latestSession.workflowBinding.configFile}
                                        </div>
                                      ) : null}
                                    </div>
                                  }
                                  actions={
                                    <>
                                      <Button size="sm" variant="outline" className="h-8 rounded-full border-white/15 bg-white/5 px-3 text-white hover:bg-white/10 hover:text-white" onClick={() => openHomepageChatForAgent(agent)}>
                                        <span className="material-symbols-outlined text-sm mr-1">chat</span>
                                        首页对话
                                      </Button>
                                      {latestSession ? (
                                        <Button size="sm" variant="outline" className="h-8 rounded-full border-white/15 bg-white/5 px-3 text-white hover:bg-white/10 hover:text-white" onClick={() => continueBoundSessionForAgent(agent)}>
                                          <span className="material-symbols-outlined text-sm mr-1">history</span>
                                          最近会话
                                        </Button>
                                      ) : null}
                                      <Button
                                        size="sm"
                                        variant="secondary"
                                        className="h-8 rounded-full bg-white/10 px-3 text-white hover:bg-white/15"
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
                                        className="h-8 rounded-full bg-white/10 px-3 text-white hover:bg-white/15"
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
                        <TableHead>角色</TableHead>
                        <TableHead>阵营</TableHead>
                        <TableHead>分类</TableHead>
                        <TableHead>模型</TableHead>
                        <TableHead>标签</TableHead>
                        <TableHead>会话</TableHead>
                        <TableHead className="text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAgents.map((agent) => {
                        const { latestSession, resolved, engineLabel, avatarSrc } = getAgentRuntimeMeta(agent);
                        return (
                          <TableRow key={agent.name}>
                            <TableCell className="min-w-[220px]">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-11 w-11 ring-1 ring-border/60">
                                  <AvatarImage src={avatarSrc} alt={agent.name} className="object-cover" />
                                  <AvatarFallback>{agent.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0">
                                  <div className="truncate font-medium">{agent.name}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5">
                                    {agent.roleType === 'supervisor' ? (
                                      <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-200">Supervisor</Badge>
                                    ) : null}
                                    {agent.alwaysAvailableForChat ? (
                                      <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">常驻对话</Badge>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{teamLabels[agent.team]}</TableCell>
                            <TableCell>{agent.category || '未分类'}</TableCell>
                            <TableCell className="min-w-[240px]">
                              <div className="truncate">{engineLabel} / {resolved.effectiveModel || '未配置模型'}</div>
                              <div className="text-xs text-muted-foreground">
                                {agent.temperature !== undefined ? `temp ${agent.temperature}` : '默认温度'}
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
                            <TableCell className="min-w-[180px]">
                              {latestSession ? (
                                <div>
                                  <div className="font-medium">已有会话</div>
                                  <div className="truncate text-xs text-muted-foreground">
                                    {latestSession.workflowBinding ? `Run ${latestSession.workflowBinding.runId}` : '独立会话'}
                                  </div>
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">未开始</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" onClick={() => openHomepageChatForAgent(agent)}>
                                  对话
                                </Button>
                                {latestSession ? (
                                  <Button size="sm" variant="outline" onClick={() => continueBoundSessionForAgent(agent)}>
                                    会话
                                  </Button>
                                ) : null}
                                <Button size="sm" variant="secondary" onClick={() => handleEditAgent(agent)}>
                                  编辑
                                </Button>
                                <Button size="sm" variant="secondary" onClick={() => handleDeleteAgent(agent.name)}>
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
        open={showAICreateModal}
        engine={globalEngine}
        model={globalDefaultModel}
        onClose={() => setShowAICreateModal(false)}
        onCreate={async (agent) => {
          try {
            await agentApi.saveAgent(agent.name, agent);
            await loadAgents();
            toast('success', 'Agent 配置已保存');
            return true;
          } catch (error: any) {
            toast('error', error.message || '保存 Agent 配置失败');
            return false;
          }
        }}
        onContinueEdit={handleContinueEditAIAgent}
      />

      {showBatchReplaceModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowBatchReplaceModal(false)}>
          <div className="bg-card rounded-lg w-[500px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold">批量替换模型</h3>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">源（引擎 + 模型）</label>
                <SingleCombobox
                  value={fromModel}
                  onValueChange={(v) => { setFromModel(v); setToModel(''); }}
                  groups={batchSourceGroups}
                  placeholder="选择当前使用的引擎和模型"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">替换为</label>
                <SingleCombobox
                  value={toModel}
                  onValueChange={setToModel}
                  groups={batchTargetGroups}
                  placeholder={fromModel ? "选择目标模型" : "请先选择源模型"}
                />
              </div>
              {fromModel && toModel && (() => {
                const [fEng] = fromModel.split('::');
                const fMod = fromModel.split('::').slice(1).join('::');
                const tMod = toModel.split('::').slice(1).join('::');
                const fEngName = ALL_ENGINES.find(e => e.id === fEng)?.name || fEng || '跟随全局';
                const affected = agents.filter(a => a.engineModels?.[fEng] === fMod).length;
                return (
                  <div className="text-sm text-muted-foreground">
                    将引擎 "{fEngName}" 下使用 "{fMod}" 的 Agent 模型替换为 "{tMod}"（影响 {affected} 个 Agent）
                  </div>
                );
              })()}
            </div>
            <div className="p-5 border-t flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowBatchReplaceModal(false)} disabled={batchReplacing}>
                取消
              </Button>
              <Button onClick={handleBatchReplaceModel} disabled={batchReplacing}>
                {batchReplacing ? '替换中...' : '确认替换'}
              </Button>
            </div>
          </div>
        </div>
      )}

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
