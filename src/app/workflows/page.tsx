'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { configApi, specCodingApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { Plus, LogIn, Edit, Trash2, ArrowLeft, ArrowRight, FileText, ArrowDown, ArrowUp, ArrowUpDown, History } from 'lucide-react';
import NewConfigModal from '@/components/NewConfigModal';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/core/utils';

interface WorkflowConfig {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
  phaseCount?: number;
  stepCount?: number;
  agentCount?: number;
  phases?: number;
  steps?: number;
  createdAt?: number | string;
}

type WorkflowSortKey = 'name' | 'createdAt';
type SortDirection = 'asc' | 'desc';
type WorkflowsPageTab = 'workflows' | 'drafts';
type DraftViewMode = 'gallery' | 'table';
type DraftSortDirection = 'desc' | 'asc';

const VIEW_MODE_KEY = 'aceharness:workflows:view-mode';
const DRAFT_VIEW_MODE_KEY = 'aceharness:workflows:drafts:view-mode';
const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

interface WorkflowPagination {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  unfilteredTotal: number;
}

type CreationDraftSession = {
  id: string;
  filename?: string;
  workflowName?: string;
  status: string;
  mode?: 'phase-based' | 'state-machine' | 'ai-guided';
  planningEngine?: string;
  planningModel?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
  uiState?: {
    formStep?: number;
    planningStage?: string;
  };
};

export default function WorkflowsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [sortKey, setSortKey] = useState<WorkflowSortKey>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pagination, setPagination] = useState<WorkflowPagination>({
    total: 0,
    totalPages: 1,
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    unfilteredTotal: 0,
  });
  const [showNewModal, setShowNewModal] = useState(false);
  const [resumeCreationDraftId, setResumeCreationDraftId] = useState<string | null>(null);
  const [creationDrafts, setCreationDrafts] = useState<CreationDraftSession[]>([]);
  const [creationDraftsLoading, setCreationDraftsLoading] = useState(false);
  const [showAIGuide, setShowAIGuide] = useState(false);
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('table');
  const [draftViewMode, setDraftViewMode] = useState<DraftViewMode>('table');
  const [draftSortDirection, setDraftSortDirection] = useState<DraftSortDirection>('desc');
  const [activeTab, setActiveTab] = useState<WorkflowsPageTab>('workflows');
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());
  const [floatingFilterBar, setFloatingFilterBar] = useState(false);
  const filterBarAnchorRef = useRef<HTMLDivElement | null>(null);
  const filterBarMeasureRef = useRef<HTMLDivElement | null>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);

  useDocumentTitle('工作流管理');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === 'gallery' || saved === 'table') setViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DRAFT_VIEW_MODE_KEY);
      if (saved === 'gallery' || saved === 'table') setDraftViewMode(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    setPage(1);
  }, [selectedMode, sortKey, sortDirection, pageSize]);

  useEffect(() => {
    const updateFloatingState = () => {
      const anchor = filterBarAnchorRef.current;
      if (!anchor) return;
      setFloatingFilterBar(anchor.getBoundingClientRect().top <= 8);
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

  const toggleViewMode = (mode: 'gallery' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
  };

  const toggleDraftViewMode = (mode: DraftViewMode) => {
    setDraftViewMode(mode);
    try { localStorage.setItem(DRAFT_VIEW_MODE_KEY, mode); } catch {}
  };

  const loadWorkflows = useCallback(async () => {
    try {
      setLoading(true);
      const data = await configApi.listConfigs({
        page,
        pageSize,
        keyword: debouncedSearchQuery,
        mode: selectedMode,
        sortKey,
        sortDirection,
      });
      setWorkflows(data.configs || []);
      if (data.pagination?.page && data.pagination.page !== page) {
        setPage(data.pagination.page);
      }
      setPagination(data.pagination || {
        total: data.configs?.length || 0,
        totalPages: 1,
        page,
        pageSize,
        unfilteredTotal: data.configs?.length || 0,
      });
      setSelectedWorkflows((prev) => {
        if (prev.size === 0) return prev;
        const visibleFiles = new Set((data.configs || []).map((workflow) => workflow.filename));
        const next = new Set([...prev].filter((filename) => visibleFiles.has(filename)));
        return next.size === prev.size ? prev : next;
      });
    } catch (error) {
      toast('error', '无法加载工作流列表');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchQuery, page, pageSize, selectedMode, sortDirection, sortKey, toast]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  const loadCreationDrafts = useCallback(async () => {
    setCreationDraftsLoading(true);
    try {
      const data = await specCodingApi.listCreationSessions();
      setCreationDrafts(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      setCreationDrafts([]);
    } finally {
      setCreationDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCreationDrafts();
  }, [loadCreationDrafts]);

  const handleAICreate = () => {
    setShowAIGuide(true);
  };

  const AI_GUIDE_SAMPLE_MESSAGE = '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理需求、阶段、候选 Agent 和任务拆分。';

  const handleAIGuideConfirm = () => {
    setShowAIGuide(false);
    const encoded = encodeURIComponent(AI_GUIDE_SAMPLE_MESSAGE);
    router.push(`/?starterPrompt=${encoded}&sidebarTab=workflow&sessionTitle=创建工作流`);
  };

  const handleDelete = async (filename: string) => {
    const confirmed = await confirm({
      title: '删除工作流',
      description: `确定要删除工作流 "${filename}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        await configApi.deleteConfig(filename);
        toast('success', `工作流 "${filename}" 已删除`);
        setSelectedWorkflows((prev) => { const next = new Set(prev); next.delete(filename); return next; });
        loadWorkflows();
      } catch (error) {
        toast('error', '无法删除工作流');
      }
    }
  };

  const handleBatchDelete = async () => {
    if (selectedWorkflows.size === 0) return;
    const confirmed = await confirm({
      title: '批量删除工作流',
      description: `确定要删除选中的 ${selectedWorkflows.size} 个工作流吗？此操作无法撤销。`,
      confirmLabel: `删除 ${selectedWorkflows.size} 个`,
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        const result = await configApi.batchDeleteConfigs([...selectedWorkflows]);
        toast('success', `已删除 ${result.deletedCount} 个工作流`);
        setSelectedWorkflows(new Set());
        loadWorkflows();
      } catch (error) {
        toast('error', '批量删除失败');
      }
    }
  };

  const handleDeleteCreationDraft = useCallback(async (session: CreationDraftSession) => {
    const confirmed = await confirm({
      title: '删除创建草稿',
      description: `确定要删除草稿 "${session.workflowName || session.filename || session.id}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;
    try {
      await specCodingApi.deleteCreationSession(session.id);
      toast('success', '创建草稿已删除');
      if (resumeCreationDraftId === session.id) {
        setResumeCreationDraftId(null);
      }
      void loadCreationDrafts();
    } catch (error) {
      toast('error', '删除创建草稿失败');
    }
  }, [confirm, loadCreationDrafts, resumeCreationDraftId, toast]);

  const toggleSelect = (filename: string) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allDisplayedSelected = displayedWorkflows.length > 0
      && displayedWorkflows.every((workflow) => selectedWorkflows.has(workflow.filename));
    if (allDisplayedSelected) {
      setSelectedWorkflows((prev) => {
        const next = new Set(prev);
        displayedWorkflows.forEach((workflow) => next.delete(workflow.filename));
        return next;
      });
    } else {
      setSelectedWorkflows((prev) => {
        const next = new Set(prev);
        displayedWorkflows.forEach((workflow) => next.add(workflow.filename));
        return next;
      });
    }
  };

  const formatWorkflowCreatedAt = (value?: number | string) => {
    let timestamp = 0;
    if (typeof value === 'number') timestamp = Number.isFinite(value) ? value : 0;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Date.parse(value);
      timestamp = Number.isFinite(parsed) ? parsed : 0;
    }
    if (!timestamp) return '-';
    return new Date(timestamp).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleSort = (key: WorkflowSortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => prev === 'asc' ? 'desc' : 'asc');
      return;
    }
    setSortKey(key);
    setSortDirection(key === 'createdAt' ? 'desc' : 'asc');
  };

  const SortIcon = ({ column }: { column: WorkflowSortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };

  const toggleDraftSortDirection = useCallback(() => {
    setDraftSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'));
  }, []);

  const DraftSortIcon = () => (
    draftSortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary" />
  );

  const displayedWorkflows = workflows;
  const creationDraftGroups = useMemo(() => {
    const visibleDrafts = creationDrafts
      .filter((session) => session?.id && session.status !== 'archived')
      .sort((a, b) => {
        const aTime = Number(new Date(a.updatedAt || a.createdAt || 0));
        const bTime = Number(new Date(b.updatedAt || b.createdAt || 0));
        return draftSortDirection === 'desc' ? bTime - aTime : aTime - bTime;
      });
    const inProgress = visibleDrafts.filter((session) => session.status === 'draft' || session.status === 'confirmed');
    const completed = visibleDrafts.filter((session) => session.status === 'config-generated' || session.status === 'run-bound');
    return { inProgress, completed };
  }, [creationDrafts, draftSortDirection]);
  const allDisplayedWorkflowsSelected = displayedWorkflows.length > 0
    && displayedWorkflows.every((workflow) => selectedWorkflows.has(workflow.filename));
  const totalLabel = useMemo(() => {
    if (!pagination.total) return '暂无工作流';
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
    return `显示 ${start}-${end} / ${pagination.total} 个工作流`;
  }, [pagination]);

  const modeLabel = (mode?: string) => mode === 'state-machine' ? '状态机' : '阶段模式';
  const modeBadgeClass = (mode?: string) =>
    mode === 'state-machine'
      ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  const getCreationStageLabel = (session: CreationDraftSession) => {
    if (session.status === 'run-bound') return '已生成工作流并启动运行';
    if (session.status === 'config-generated') return '已生成工作流';
    const step = session.uiState?.formStep;
    const labels: Record<number, string> = {
      1: '填写基础信息',
      2: '补充问答',
      3: '生成计划',
      4: '确认计划',
      5: '生成工作流',
    };
    return labels[step || 1] || '填写基础信息';
  };
  const getCreationProgressTone = (session: CreationDraftSession) => (
    session.status === 'config-generated' || session.status === 'run-bound'
      ? 'secondary'
      : 'default'
  );
  const renderCreationDraftCard = (session: CreationDraftSession) => (
    <div key={session.id} className="rounded-2xl border bg-background/80 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {session.workflowName || '未命名工作流'}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {session.filename || '未命名配置'}
          </div>
        </div>
        <Badge variant={getCreationProgressTone(session)} className="shrink-0 text-[10px]">
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成' : '进行中'}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Badge variant="outline" className="text-[10px]">
          当前阶段: {getCreationStageLabel(session)}
        </Badge>
        <Badge variant="outline" className="text-[10px]">
          {session.status === 'config-generated' || session.status === 'run-bound' ? '已完成创建工作流' : '未完成创建'}
        </Badge>
        {session.mode ? (
          <Badge variant="outline" className="text-[10px]">
            {session.mode === 'state-machine' ? '状态机' : session.mode === 'ai-guided' ? 'AI 引导' : '阶段模式'}
          </Badge>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {session.planningEngine ? <span>引擎: {session.planningEngine}</span> : null}
        {session.planningModel ? <span>模型: {session.planningModel}</span> : null}
        {session.updatedAt || session.createdAt ? <span>更新于 {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}</span> : null}
      </div>
      <div className="mt-4 flex justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => void handleDeleteCreationDraft(session)}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          删除
        </Button>
        {session.status === 'config-generated' || session.status === 'run-bound' ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/workbench/${encodeURIComponent(session.filename || '')}?mode=design`)}
            disabled={!session.filename}
          >
            打开工作流
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setResumeCreationDraftId(session.id);
              setShowNewModal(true);
            }}
          >
            继续创建
          </Button>
        )}
      </div>
    </div>
  );
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="w-4 h-4 mr-2" />
              返回首页
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-2xl font-bold">工作流管理</h1>
            <p className="text-xs text-muted-foreground">管理和配置工作流 · 代码生产黑灯车间</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
          <Button size="sm" variant="outline" onClick={handleAICreate}>
            <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
            AI 创建
          </Button>
          <Button onClick={() => setShowNewModal(true)}>
            <Plus className="w-4 h-4 mr-2" />
            手动创建
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Floating filter anchor */}
        <div ref={filterBarAnchorRef} className="h-px" />
        {floatingFilterBar && activeTab === 'workflows' ? <div style={{ height: filterBarHeight }} /> : null}

        <section className="flex items-center justify-between gap-4">
          <div className="inline-flex rounded-full border border-border/60 bg-card/70 p-1 shadow-sm backdrop-blur">
            <Button
              size="sm"
              variant={activeTab === 'workflows' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => setActiveTab('workflows')}
            >
              工作流列表
            </Button>
            <Button
              size="sm"
              variant={activeTab === 'drafts' ? 'default' : 'ghost'}
              className="rounded-full px-4"
              onClick={() => setActiveTab('drafts')}
            >
              创建草稿箱
            </Button>
          </div>
          {activeTab === 'drafts' ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={draftSortDirection} onValueChange={(value: DraftSortDirection) => setDraftSortDirection(value)}>
                <SelectTrigger className="h-9 w-[132px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">最近更新</SelectItem>
                  <SelectItem value="asc">最早更新</SelectItem>
                </SelectContent>
              </Select>
              <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                <Button
                  size="sm"
                  variant={draftViewMode === 'gallery' ? 'default' : 'ghost'}
                  className="h-8 rounded-full px-3"
                  onClick={() => toggleDraftViewMode('gallery')}
                >
                  <span className="material-symbols-outlined text-sm">grid_view</span>
                </Button>
                <Button
                  size="sm"
                  variant={draftViewMode === 'table' ? 'default' : 'ghost'}
                  className="h-8 rounded-full px-3"
                  onClick={() => toggleDraftViewMode('table')}
                >
                  <span className="material-symbols-outlined text-sm">table_rows</span>
                </Button>
              </div>
              <Button variant="outline" size="sm" onClick={() => void loadCreationDrafts()}>
                刷新
              </Button>
            </div>
          ) : null}
        </section>

        {/* Filter bar */}
        {activeTab === 'workflows' ? (
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
                    placeholder="搜索工作流..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 w-full max-w-sm"
                  />
                  {viewMode === 'gallery' ? (
                    <div className="flex flex-wrap gap-2">
                      {(['all', 'state-machine', 'phase-based'] as const).map((mode) => (
                        <Button
                          key={mode}
                          size="sm"
                          variant={selectedMode === mode ? 'default' : 'outline'}
                          className={cn(
                            'rounded-full',
                            selectedMode === mode && mode === 'state-machine' && 'bg-sky-500 text-white hover:bg-sky-400',
                            selectedMode === mode && mode === 'phase-based' && 'bg-amber-500 text-white hover:bg-amber-400',
                          )}
                          onClick={() => setSelectedMode(mode)}
                        >
                          {mode === 'all' ? '全部' : mode === 'state-machine' ? '状态机' : '阶段模式'}
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {totalLabel}
                  </span>
                  <Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}>
                    <SelectTrigger className="h-9 w-[112px] bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAGE_SIZE_OPTIONS.map((option) => (
                        <SelectItem key={option} value={String(option)}>
                          {option} / 页
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/* View mode toggle */}
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={viewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('gallery')}
                    >
                      <span className="material-symbols-outlined text-sm">grid_view</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('table')}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        ) : null}
        {/* Batch action bar */}
        {activeTab === 'workflows' && selectedWorkflows.size > 0 && (
          <div className="flex items-center gap-4 rounded-[20px] border border-destructive/30 bg-destructive/5 px-5 py-3">
            <span className="text-sm font-medium">已选 {selectedWorkflows.size} 个工作流</span>
            <Button size="sm" variant="destructive" onClick={handleBatchDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              批量删除
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedWorkflows(new Set())}>
              取消选择
            </Button>
          </div>
        )}

        {/* Content */}
        {activeTab === 'workflows' ? (
          <>
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-muted-foreground">加载中...</div>
              </div>
            ) : displayedWorkflows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {pagination.unfilteredTotal === 0 ? '还没有工作流' : '没有匹配的工作流'}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {pagination.unfilteredTotal === 0 ? '创建你的第一个工作流配置' : '尝试调整搜索条件'}
                </p>
                {pagination.unfilteredTotal === 0 && (
                  <div className="flex items-center gap-3">
                    <Button size="sm" variant="outline" onClick={handleAICreate}>
                      <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
                      AI 创建
                    </Button>
                    <Button onClick={() => setShowNewModal(true)}>
                      <Plus className="w-4 h-4 mr-2" />
                      手动创建
                    </Button>
                  </div>
                )}
              </div>
            ) : viewMode === 'table' ? (
              <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/80 shadow-sm">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={allDisplayedWorkflowsSelected}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="min-w-[220px]">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 gap-1.5 px-2"
                          onClick={() => handleSort('name')}
                        >
                          名称
                          <SortIcon column="name" />
                        </Button>
                      </TableHead>
                      <TableHead>文件名</TableHead>
                      <TableHead className="min-w-[132px] whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span>模式</span>
                          <Select value={selectedMode} onValueChange={setSelectedMode}>
                            <SelectTrigger className="h-8 w-[96px] bg-background">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">全部</SelectItem>
                              <SelectItem value="state-machine">状态机</SelectItem>
                              <SelectItem value="phase-based">阶段模式</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </TableHead>
                      <TableHead className="min-w-[72px] whitespace-normal leading-tight">阶段/状态</TableHead>
                      <TableHead>步骤</TableHead>
                      <TableHead className="min-w-[160px] whitespace-nowrap">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="-ml-3 h-8 gap-1.5 px-2"
                          onClick={() => handleSort('createdAt')}
                        >
                          创建时间
                          <SortIcon column="createdAt" />
                        </Button>
                      </TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayedWorkflows.map((wf) => (
                      <TableRow key={wf.filename} data-state={selectedWorkflows.has(wf.filename) ? 'selected' : undefined}>
                        <TableCell>
                          <Checkbox
                            checked={selectedWorkflows.has(wf.filename)}
                            onCheckedChange={() => toggleSelect(wf.filename)}
                          />
                        </TableCell>
                        <TableCell className="min-w-[200px]">
                          <div className="font-medium">{wf.name}</div>
                          {wf.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{wf.description}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono">{wf.filename}</TableCell>
                        <TableCell className="min-w-[92px] whitespace-nowrap">
                          <Badge className={cn('min-w-[72px] justify-center whitespace-nowrap', modeBadgeClass(wf.mode))}>{modeLabel(wf.mode)}</Badge>
                        </TableCell>
                        <TableCell className="min-w-[72px] whitespace-nowrap">{wf.phaseCount ?? 0}</TableCell>
                        <TableCell>{wf.stepCount ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatWorkflowCreatedAt(wf.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-start gap-2">
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}`}>
                                <LogIn className="w-3 h-3 mr-1" />
                                进入
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}?mode=history`}>
                                <History className="w-3 h-3 mr-1" />
                                历史
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" asChild>
                              <Link href={`/workbench/${encodeURIComponent(wf.filename)}?mode=design`}>
                                <Edit className="w-3 h-3" />
                              </Link>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleDelete(wf.filename)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <>
              {displayedWorkflows.length > 0 && (
                <div className="mb-3 flex items-center">
                  <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={toggleSelectAll}
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary ${
                        allDisplayedWorkflowsSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-transparent'
                      }`}
                    >
                      {allDisplayedWorkflowsSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M8.5 2.5L3.8 7.5L1.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {allDisplayedWorkflowsSelected ? '取消全选' : '全选当前页'}
                  </button>
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayedWorkflows.map((workflow, index) => (
              <motion.div
                key={workflow.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index, 12) * 0.03 }}
                className={cn(
                  'relative group rounded-xl border bg-card p-5 hover:shadow-md transition-all',
                  selectedWorkflows.has(workflow.filename)
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-border/50'
                )}
              >
                {/* Checkbox */}
                <div className="absolute top-3 left-3 z-10">
                  <Checkbox
                    checked={selectedWorkflows.has(workflow.filename)}
                    onCheckedChange={() => toggleSelect(workflow.filename)}
                  />
                </div>

                <div className="pl-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{workflow.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{workflow.filename}</p>
                    </div>
                    <Badge className={cn('ml-2 shrink-0', modeBadgeClass(workflow.mode))}>
                      {modeLabel(workflow.mode)}
                    </Badge>
                  </div>

                  {workflow.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{workflow.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span>{workflow.phaseCount ?? 0} 个{workflow.mode === 'state-machine' ? '状态' : '阶段'}</span>
                    <span>{workflow.stepCount ?? 0} 个步骤</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}`}>
                        <LogIn className="w-3 h-3 mr-1" />
                        进入
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}?mode=history`}>
                        <History className="w-3 h-3 mr-1" />
                        历史
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}?mode=design`}>
                        <Edit className="w-3 h-3" />
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(workflow.filename)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
              </div>
              </>
            )}

            {!loading && pagination.total > 0 ? (
              <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted-foreground">{totalLabel}</div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ArrowLeft className="mr-1 h-4 w-4" />
                    上一页
                  </Button>
                  <Badge variant="secondary">
                    第 {pagination.page} / {pagination.totalPages} 页
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    下一页
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </div>
              </section>
            ) : null}
          </>
        ) : (
          <section className="rounded-[24px] border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[18px]">inventory_2</span>
                  <h2 className="text-lg font-semibold">创建草稿箱</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  还没创建完的 workflow 草稿、补充问答和 Spec 规划会先落在这里，按需恢复继续做。
                </p>
              </div>
            </div>

            <div className="mt-4">
              {creationDraftsLoading ? (
                <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  正在读取创建草稿...
                </div>
              ) : creationDraftGroups.inProgress.length > 0 || creationDraftGroups.completed.length > 0 ? (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">进行中</h3>
                      <Badge variant="outline" className="text-[10px]">{creationDraftGroups.inProgress.length}</Badge>
                    </div>
                    {creationDraftGroups.inProgress.length > 0 ? (
                      draftViewMode === 'table' ? (
                        <div className="overflow-hidden rounded-[24px] border border-border/70 bg-card/80 shadow-sm">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>名称</TableHead>
                                <TableHead>文件名</TableHead>
                                <TableHead>当前阶段</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead className="min-w-[160px] whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="-ml-3 h-8 gap-1.5 px-2"
                                    onClick={toggleDraftSortDirection}
                                  >
                                    最近更新
                                    <DraftSortIcon />
                                  </Button>
                                </TableHead>
                                <TableHead>操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {creationDraftGroups.inProgress.map((session) => (
                                <TableRow key={session.id}>
                                  <TableCell className="font-medium">{session.workflowName || '未命名工作流'}</TableCell>
                                  <TableCell className="font-mono text-sm text-muted-foreground">{session.filename || '未命名配置'}</TableCell>
                                  <TableCell>{getCreationStageLabel(session)}</TableCell>
                                  <TableCell>
                                    <Badge variant={getCreationProgressTone(session)} className="text-[10px]">进行中</Badge>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                          setResumeCreationDraftId(session.id);
                                          setShowNewModal(true);
                                        }}
                                      >
                                        继续创建
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => void handleDeleteCreationDraft(session)}
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.inProgress.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        当前没有进行中的创建草稿。
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium">已完成创建</h3>
                      <Badge variant="outline" className="text-[10px]">{creationDraftGroups.completed.length}</Badge>
                    </div>
                    {creationDraftGroups.completed.length > 0 ? (
                      draftViewMode === 'table' ? (
                        <div className="overflow-hidden rounded-[24px] border border-border/70 bg-card/80 shadow-sm">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>名称</TableHead>
                                <TableHead>文件名</TableHead>
                                <TableHead>当前阶段</TableHead>
                                <TableHead>状态</TableHead>
                                <TableHead className="min-w-[160px] whitespace-nowrap">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="-ml-3 h-8 gap-1.5 px-2"
                                    onClick={toggleDraftSortDirection}
                                  >
                                    最近更新
                                    <DraftSortIcon />
                                  </Button>
                                </TableHead>
                                <TableHead>操作</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {creationDraftGroups.completed.map((session) => (
                                <TableRow key={session.id}>
                                  <TableCell className="font-medium">{session.workflowName || '未命名工作流'}</TableCell>
                                  <TableCell className="font-mono text-sm text-muted-foreground">{session.filename || '未命名配置'}</TableCell>
                                  <TableCell>{getCreationStageLabel(session)}</TableCell>
                                  <TableCell>
                                    <Badge variant={getCreationProgressTone(session)} className="text-[10px]">已完成</Badge>
                                  </TableCell>
                                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                                    {formatWorkflowCreatedAt(session.updatedAt || session.createdAt)}
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => router.push(`/workbench/${encodeURIComponent(session.filename || '')}?mode=design`)}
                                        disabled={!session.filename}
                                      >
                                        打开工作流
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="text-destructive hover:text-destructive"
                                        onClick={() => void handleDeleteCreationDraft(session)}
                                      >
                                        删除
                                      </Button>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ) : (
                        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                          {creationDraftGroups.completed.map(renderCreationDraftCard)}
                        </div>
                      )
                    ) : (
                      <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                        还没有已完成创建的工作流草稿记录。
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed px-4 py-6 text-sm text-muted-foreground">
                  暂无创建草稿记录。
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => {
            setShowNewModal(false);
            setResumeCreationDraftId(null);
            void loadCreationDrafts();
          }}
          hideAiGuided
          onSuccess={(filename) => {
            setShowNewModal(false);
            setResumeCreationDraftId(null);
            loadWorkflows();
            void loadCreationDrafts();
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }}
          resumeCreationSessionId={resumeCreationDraftId}
        />
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}

      {/* AI 引导创建指南弹窗 */}
      <Dialog open={showAIGuide} onOpenChange={setShowAIGuide}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xl">auto_awesome</span>
              AI 引导创建工作流
            </DialogTitle>
            <DialogDescription>
              先描述目标，再创建工作流
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              这类操作依赖当前对话上下文。先把目标、工作目录和约束告诉 AI，再让它生成右侧表单预填信息会更稳定。
            </p>

            <div className="text-sm font-medium">建议先发送这样一条消息</div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base text-primary mt-0.5">smart_toy</span>
                <p className="text-sm italic text-muted-foreground">
                  {AI_GUIDE_SAMPLE_MESSAGE}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-primary">auto_awesome</span>
                AI 将这样推进
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground pl-6">
                <li>先确认你的目标、输入、工作目录和约束。</li>
                <li>整理出阶段、候选 Agent、工作流结构和关键风险。</li>
                <li>把这些信息同步到右侧工作流表单，再进入创建。</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              点击下面按钮后，这条示例消息会直接放入输入框，不会自动发送。你可以先补充细节，再手动发出。
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAIGuide(false)}>
              稍后再说
            </Button>
            <Button onClick={handleAIGuideConfirm}>
              <span className="material-symbols-outlined text-sm mr-1.5">edit_note</span>
              把示例消息放入输入框
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
