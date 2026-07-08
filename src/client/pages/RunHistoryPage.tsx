'use client';

import { type ComponentProps, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from '@/lib/navigation/client';
import { usePathname, useRouter, useSearchParams } from '@/lib/navigation/client';
import {
  ArrowLeft,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
  Search,
  Square,
  Trash2,
  TrendingUp,
  User2,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ActionMenuGroup } from '@/components/ui/action-menu';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { BulkActionBar } from '@/components/ui/bulk-action-bar';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { MultiCombobox } from '@/components/ui/combobox';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useToast } from '@/components/ui/toast';
import { useRunDocumentsQuery } from '@/client/query/documents';
import { useRunHistoryQuery } from '@/client/query/run-history';
import { apiRequest } from '@/client/query/api-client';
import {
  useDocumentMetadataRows,
  useRunHistoryRows,
  useSyncDocumentsMetadataToDb,
  useSyncRunHistoryToDb,
  type RunHistoryRow,
} from '@/client/db/collections';
import { runsApi } from '@/lib/core/api';
import { buildDashboardWorkbenchPath, buildWorkbenchSearch } from '@/client/navigation/workbench-links';

type HistoryView = 'runs' | 'token-ranking';
type RunSortKey = 'name' | 'startTime' | 'totalTokens' | 'cost';
type TokenRankingSortKey = 'name' | 'totalTokens' | 'runs' | 'cost';
type SortDirection = 'asc' | 'desc';
type TokenRankingDimension = 'workflow' | 'user';
type RunStatusFilter = 'all' | 'running' | 'completed' | 'failed' | 'stopped' | 'preparing';

const WORKFLOW_RUN_DELETED_EVENT = 'ace:workflow-run-deleted';

interface RunRow {
  id: string;
  configFile: string;
  configName: string;
  parentRunId?: string;
  rootRunId?: string;
  parentStateName?: string;
  parentStepName?: string;
  childRuns?: RunRow[];
  childSummary?: {
    total: number;
    active: number;
    failed: number;
    waitingHuman: number;
    detached: number;
    completed: number;
    superseded: number;
    abandoned: number;
  };
  startTime: string;
  endTime: string | null;
  status: string;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  ownerId: string;
  ownerName: string;
  totalTokens: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface TokenRankingRow {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number;
}

interface HistoryResponse {
  view: HistoryView;
  runs?: RunRow[];
  rankings?: TokenRankingRow[];
  pagination: {
    total: number;
    totalPages: number;
    page: number;
    pageSize: number;
  };
  filters: {
    view: HistoryView;
    dimension: TokenRankingDimension;
    sortKey: RunSortKey | TokenRankingSortKey;
    sortDirection: SortDirection;
    ownerId: string;
    keyword?: string;
  };
  userOptions: Array<{ id: string; username: string }>;
  isAdmin: boolean;
}

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseHistoryView(value: string | null): HistoryView {
  return value === 'token-ranking' ? 'token-ranking' : 'runs';
}

function parseRunSortKey(value: string | null): RunSortKey {
  if (value === 'name' || value === 'totalTokens' || value === 'cost') return value;
  return 'startTime';
}

function parseTokenRankingSortKey(value: string | null): TokenRankingSortKey {
  if (value === 'name' || value === 'runs' || value === 'cost') return value;
  return 'totalTokens';
}

function parseSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
}

function parseTokenRankingDimension(value: string | null): TokenRankingDimension {
  return value === 'user' ? 'user' : 'workflow';
}

function parseRunStatusFilter(value: string | null): RunStatusFilter {
  if (value === 'running' || value === 'completed' || value === 'failed' || value === 'stopped' || value === 'preparing') return value;
  return 'all';
}

function formatTokens(value: number): string {
  return Number(value || 0).toLocaleString();
}

function formatMoney(value: number): string {
  return `$${Number(value || 0).toFixed(4)}`;
}

function formatDuration(startTime?: string | null, endTime?: string | null): string {
  if (!startTime) return '-';
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '-';
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${restSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatStateName(name: string) {
  if (name === '__origin__') return '开始';
  if (name === '__human_approval__') return '人工审查';
  return name;
}

function formatStatusLabel(status: string) {
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  if (status === 'running') return '运行中';
  if (status === 'stopped') return '已停止';
  if (status === 'crashed') return '崩溃';
  if (status === 'preparing') return '准备中';
  return status || '未知';
}

function statusTone(status: string): ComponentProps<typeof StatusPill>['tone'] {
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'crashed') return 'danger';
  if (status === 'running' || status === 'preparing') return 'info';
  if (status === 'stopped') return 'neutral';
  return 'warning';
}

function runRowFromDb(row: RunHistoryRow): RunRow {
  return {
    id: row.id,
    configFile: row.configFile,
    configName: row.configName,
    parentRunId: row.parentRunId,
    rootRunId: row.rootRunId,
    parentStateName: row.parentStateName,
    parentStepName: row.parentStepName,
    childRuns: [],
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    currentPhase: row.currentPhase,
    totalSteps: row.totalSteps,
    completedSteps: row.completedSteps,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    totalTokens: row.totalTokens,
    cost: row.cost,
    inputTokens: row.inputTokens || 0,
    outputTokens: row.outputTokens || 0,
    cacheCreationInputTokens: row.cacheCreationInputTokens || 0,
    cacheReadInputTokens: row.cacheReadInputTokens || 0,
  };
}

function buildRunTreeFromRows(rows: RunHistoryRow[]): RunRow[] {
  const byId = new Map<string, RunRow>();
  rows.forEach((row) => byId.set(row.id, runRowFromDb(row)));

  const roots: RunRow[] = [];
  rows.forEach((row) => {
    const item = byId.get(row.id);
    if (!item) return;
    const parent = row.parentRunId ? byId.get(row.parentRunId) : null;
    if (parent) {
      parent.childRuns = [...(parent.childRuns || []), item];
    } else {
      roots.push(item);
    }
  });

  return roots;
}

type RunHistoryPageProps = {
  embeddedSearch?: string;
  onEmbeddedSearchChange?: (search: string) => void;
};

export default function RunHistoryPage({ embeddedSearch, onEmbeddedSearchChange }: RunHistoryPageProps = {}) {
  const router = useRouter();
  const { toast } = useToast();
  const dockWorkspace = useDashboardDockWorkspace();
  const pathname = usePathname();
  const routeSearchParams = useSearchParams();
  const isEmbeddedSearchControlled = embeddedSearch !== undefined;
  const searchParams = useMemo(
    () => new URLSearchParams(isEmbeddedSearchControlled ? embeddedSearch : routeSearchParams.toString()),
    [embeddedSearch, isEmbeddedSearchControlled, routeSearchParams],
  );
  const [expandedRunIds, setExpandedRunIds] = useState<Set<string>>(() => new Set());
  const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);
  const [pendingRunAction, setPendingRunAction] = useState<string | null>(null);
  const [selectedRunIds, setSelectedRunIds] = useState<Set<string>>(() => new Set());

  useDocumentTitle('运行记录');

  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), 20);
  const view = parseHistoryView(searchParams.get('view'));
  const runSortKey = parseRunSortKey(searchParams.get('sortKey'));
  const tokenRankingSortKey = parseTokenRankingSortKey(searchParams.get('sortKey'));
  const sortDirection = parseSortDirection(searchParams.get('sortDirection'));
  const dimension = parseTokenRankingDimension(searchParams.get('dimension'));
  const statusFilter = parseRunStatusFilter(searchParams.get('status'));
  const configFileFilter = searchParams.get('configFile') || '';
  const ownerIds = (searchParams.get('ownerId') || '').split(',').filter(Boolean);
  const keyword = searchParams.get('keyword') || '';
  const activeSortKey = view === 'token-ranking' ? tokenRankingSortKey : runSortKey;
  const historyQuery = useRunHistoryQuery({
    page: view === 'token-ranking' ? page : 1,
    pageSize: view === 'token-ranking' ? pageSize : 500,
    view,
    dimension,
    sortKey: view === 'token-ranking' ? activeSortKey : 'startTime',
    sortDirection: view === 'token-ranking' ? sortDirection : 'desc',
    ownerId: view === 'token-ranking' ? ownerIds.join(',') : '',
    keyword: view === 'token-ranking' ? keyword : '',
    tree: view === 'runs',
  });
  const data = historyQuery.data as HistoryResponse | undefined;
  useSyncRunHistoryToDb(data?.view === 'runs' ? (data.runs as any[] || []) : []);
  const dbRunRows = useRunHistoryRows({
    keyword,
    ownerId: ownerIds.join(','),
    sortKey: runSortKey,
    sortDirection,
  });
  const statusFilteredRunRows = useMemo(() => {
    const workflowRows = configFileFilter
      ? dbRunRows.filter((row) => row.configFile === configFileFilter)
      : dbRunRows;
    if (statusFilter === 'all') return workflowRows;
    if (statusFilter === 'failed') return workflowRows.filter((row) => row.status === 'failed' || row.status === 'crashed');
    return workflowRows.filter((row) => row.status === statusFilter);
  }, [configFileFilter, dbRunRows, statusFilter]);
  const filteredRunTree = useMemo(() => buildRunTreeFromRows(statusFilteredRunRows), [statusFilteredRunRows]);
  const runTotalPages = Math.max(1, Math.ceil(filteredRunTree.length / pageSize));
  const runCurrentPage = Math.min(page, runTotalPages);
  const pagedRunTree = useMemo(() => filteredRunTree.slice((runCurrentPage - 1) * pageSize, runCurrentPage * pageSize), [filteredRunTree, runCurrentPage, pageSize]);
  const runPagination = useMemo(() => ({
    total: filteredRunTree.length,
    totalPages: runTotalPages,
    page: runCurrentPage,
    pageSize,
  }), [filteredRunTree.length, pageSize, runCurrentPage, runTotalPages]);
  const loading = historyQuery.isLoading && (view === 'token-ranking' || dbRunRows.length === 0);
  const error = historyQuery.error ? (historyQuery.error as Error).message || '运行记录加载失败' : null;
  const drawerDocumentParams = useMemo(() => ({
    includeChildren: true,
    summaryOnly: true,
    pageSize: 8,
    sortDirection: 'desc' as const,
  }), []);
  const drawerDocumentsQuery = useRunDocumentsQuery(selectedRun?.id, drawerDocumentParams);
  useSyncDocumentsMetadataToDb(selectedRun?.id, drawerDocumentsQuery.data?.files || []);
  const drawerDocuments = useDocumentMetadataRows(selectedRun?.id);

  const updateQuery = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    const next = params.toString();
    if (isEmbeddedSearchControlled) {
      onEmbeddedSearchChange?.(next);
      return;
    }
    router.replace(next ? `${pathname}?${next}` : pathname);
  };

  const totalLabel = useMemo(() => {
    const pagination = view === 'token-ranking' ? data?.pagination : runPagination;
    if (!pagination?.total) return view === 'token-ranking' ? '暂无 Token 排行数据' : '暂无运行记录';
    const start = (pagination.page - 1) * pagination.pageSize + 1;
    const end = Math.min(pagination.page * pagination.pageSize, pagination.total);
    return `显示 ${start}-${end} / ${pagination.total} 条`;
  }, [data?.pagination, runPagination, view]);

  const switchView = (nextView: HistoryView) => {
    if (nextView === 'token-ranking') {
      updateQuery({
        view: 'token-ranking',
        dimension,
        sortKey: 'totalTokens',
        sortDirection: 'desc',
        page: '1',
      });
      return;
    }

    updateQuery({
      view: null,
      dimension: null,
      sortKey: 'startTime',
      sortDirection: 'desc',
      page: '1',
    });
  };

  const switchDimension = (nextDimension: TokenRankingDimension) => {
    updateQuery({
      view: 'token-ranking',
      dimension: nextDimension,
      sortKey: 'totalTokens',
      sortDirection: 'desc',
      page: '1',
    });
  };

  const toggleSort = (key: RunSortKey | TokenRankingSortKey) => {
    if (activeSortKey === key) {
      updateQuery({
        sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
        page: '1',
      });
      return;
    }

    updateQuery({
      sortKey: key,
      sortDirection: key === 'name' ? 'asc' : 'desc',
      page: '1',
    });
  };

  const pageTitle = view === 'token-ranking' ? 'Token 使用排行' : '运行记录';
  const pageSubtitle = view === 'token-ranking'
    ? (dimension === 'workflow'
      ? '按工作流聚合查看累计 Token、成本和运行次数'
      : '按用户聚合查看累计 Token、成本和运行次数')
    : configFileFilter
      ? `查看 ${configFileFilter} 的历史运行`
      : '按名称、日期和用户维度查看历史流水线运行';
  const searchPlaceholder = view === 'token-ranking'
    ? (dimension === 'workflow' ? '搜索工作流...' : '搜索用户...')
    : '搜索运行记录...';
  const rankingItems = data?.view === 'token-ranking' ? data.rankings || [] : [];
  const runItems = view === 'runs' ? pagedRunTree : [];
  const activePagination = view === 'token-ranking'
    ? (data?.pagination || { total: 0, totalPages: 1, page, pageSize })
    : runPagination;
  const flattenRunItems = (items: RunRow[], depth = 0): Array<RunRow & { depth: number }> =>
    items.flatMap((item) => {
      const children = item.childRuns || [];
      const visibleChildren = expandedRunIds.has(item.id) ? flattenRunItems(children, depth + 1) : [];
      return [{ ...item, depth }, ...visibleChildren];
    });
  const displayedRunItems = useMemo(() => flattenRunItems(runItems), [runItems, expandedRunIds]);
  const selectedDisplayedRunIds = useMemo(
    () => displayedRunItems.filter((run) => selectedRunIds.has(run.id)).map((run) => run.id),
    [displayedRunItems, selectedRunIds],
  );
  const toggleExpandedRun = (runId: string) => {
    setExpandedRunIds((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  };
  const { isDashboardShell } = useDashboardShellHeader({
    title: pageTitle,
    subtitle: pageSubtitle,
  }, [pageTitle, pageSubtitle]);
  const openRunInWorkbench = (run: RunRow) => {
    if (!run.configFile) return;
    if (dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${run.configFile}:run:${run.id}`,
        title: run.configName || run.configFile,
        kind: 'workbench',
        config: run.configFile,
        mode: 'run',
        runId: run.id,
        search: buildWorkbenchSearch('run', run.id),
      });
    } else {
      router.push(buildDashboardWorkbenchPath(run.configFile, 'run', run.id));
    }
  };
  const copyRunId = async (run: RunRow) => {
    if (!navigator.clipboard?.writeText) return;
    await navigator.clipboard.writeText(run.id);
    toast('success', '已复制 Run ID');
  };
  const refreshRuns = async () => {
    await historyQuery.refetch();
  };
  const runAction = async (actionKey: string, run: RunRow, action: () => Promise<void>) => {
    setPendingRunAction(`${actionKey}:${run.id}`);
    try {
      await action();
      await refreshRuns();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '操作失败');
    } finally {
      setPendingRunAction(null);
    }
  };
  const stopRun = (run: RunRow) => runAction('stop', run, async () => {
    await apiRequest('/api/workflow/stop', { method: 'POST', body: { configFile: run.configFile, runId: run.id } });
    toast('success', '已发送停止请求');
  });
  const resumeRun = (run: RunRow) => runAction('resume', run, async () => {
    await apiRequest('/api/workflow/resume', { method: 'POST', body: { configFile: run.configFile, runId: run.id } });
    toast('success', '已发送恢复请求');
  });
  const deleteRun = (run: RunRow) => {
    const ok = window.confirm(`删除运行记录 ${run.id}？该操作会删除运行目录，无法撤销。`);
    if (!ok) return;
    void runAction('delete', run, async () => {
      await runsApi.deleteRun(run.id);
      setSelectedRunIds((current) => {
        const next = new Set(current);
        next.delete(run.id);
        return next;
      });
      if (selectedRun?.id === run.id) setSelectedRun(null);
      window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_DELETED_EVENT, {
        detail: { runId: run.id, configFile: run.configFile },
      }));
      toast('success', '运行记录已删除');
    });
  };
  const deleteSelectedRuns = async () => {
    const ids = Array.from(selectedRunIds).filter(Boolean);
    if (ids.length === 0) return;
    const ok = window.confirm(`删除已选 ${ids.length} 条运行记录？该操作会删除运行目录，无法撤销。`);
    if (!ok) return;
    setPendingRunAction('bulk-delete');
    try {
      const result = await apiRequest<{ deletedCount?: number; errors?: string[]; message?: string }>('/api/runs/batch', {
        method: 'POST',
        body: { action: 'delete', runIds: ids },
      });
      if (selectedRun && ids.includes(selectedRun.id)) setSelectedRun(null);
      for (const runId of ids) {
        const run = statusFilteredRunRows.find((item) => item.id === runId);
        window.dispatchEvent(new CustomEvent(WORKFLOW_RUN_DELETED_EVENT, {
          detail: { runId, configFile: run?.configFile },
        }));
      }
      setSelectedRunIds(new Set());
      await refreshRuns();
      toast(result.errors?.length ? 'warning' : 'success', result.message || `已删除 ${result.deletedCount ?? ids.length} 条运行记录`);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '批量删除失败');
    } finally {
      setPendingRunAction(null);
    }
  };
  const analyzeRun = (run: RunRow) => runAction('analyze', run, async () => {
    const result = await apiRequest<{ steps?: unknown[]; summary?: { totalSteps?: number; avgScore?: number } }>(`/api/prompt-analysis?runId=${encodeURIComponent(run.id)}`);
    const total = result.summary?.totalSteps ?? result.steps?.length ?? 0;
    toast('success', total ? `已完成 ${total} 个步骤的 Prompt 分析` : '分析完成，暂无可展示步骤');
    setSelectedRun(run);
  });
  const getRunActions = (run: RunRow & { depth: number }): ActionMenuGroup[] => [
    {
      id: 'open',
      actions: [
        {
          id: 'workbench',
          label: '打开运行工作台',
          icon: <ExternalLink className="h-4 w-4" />,
          primary: true,
          disabled: !run.configFile,
          disabledReason: '缺少工作流配置路径',
          onSelect: () => openRunInWorkbench(run),
        },
        {
          id: 'details',
          label: '查看详情',
          icon: <FileText className="h-4 w-4" />,
          onSelect: () => setSelectedRun(run),
        },
      ],
    },
    {
      id: 'run-control',
      label: '运行操作',
      actions: [
        {
          id: 'resume',
          label: '恢复运行',
          icon: <RotateCcw className="h-4 w-4" />,
          disabled: !run.configFile || run.status === 'running' || pendingRunAction === `resume:${run.id}`,
          disabledReason: !run.configFile ? '缺少工作流配置路径' : run.status === 'running' ? '当前运行正在执行' : '正在恢复',
          onSelect: () => { void resumeRun(run); },
        },
        {
          id: 'stop',
          label: '停止运行',
          icon: <Square className="h-4 w-4" />,
          disabled: !run.configFile || !['running', 'preparing'].includes(run.status) || pendingRunAction === `stop:${run.id}`,
          disabledReason: !run.configFile ? '缺少工作流配置路径' : !['running', 'preparing'].includes(run.status) ? '只有运行中记录可停止' : '正在停止',
          onSelect: () => { void stopRun(run); },
        },
        {
          id: 'analyze',
          label: '优化 / 分析',
          icon: <BarChart3 className="h-4 w-4" />,
          disabled: pendingRunAction === `analyze:${run.id}`,
          disabledReason: '正在分析',
          onSelect: () => { void analyzeRun(run); },
        },
      ],
    },
    {
      id: 'copy',
      actions: [
        {
          id: 'copy-id',
          label: '复制 Run ID',
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => { void copyRunId(run); },
        },
        {
          id: 'delete',
          label: '删除',
          icon: <Trash2 className="h-4 w-4" />,
          destructive: true,
          disabled: pendingRunAction === `delete:${run.id}`,
          disabledReason: '正在删除',
          onSelect: () => deleteRun(run),
        },
      ],
    },
  ];
  const runColumns = useMemo<DataTableColumn<RunRow & { depth: number }>[]>(() => [
    {
      id: 'name',
      header: '工作流名称',
      sortable: true,
      priority: 0,
      render: (run) => (
        <div className="min-w-[220px]" style={{ paddingLeft: run.depth ? `${run.depth * 18}px` : undefined }}>
          <div className="flex min-w-0 items-center gap-2">
            {run.childRuns?.length ? (
              <button
                type="button"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={expandedRunIds.has(run.id) ? '折叠子运行' : '展开子运行'}
                onClick={(event) => {
                  event.stopPropagation();
                  toggleExpandedRun(run.id);
                }}
              >
                {expandedRunIds.has(run.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            ) : run.depth > 0 ? (
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground">└</span>
            ) : (
              <span className="h-6 w-6 shrink-0" />
            )}
            <div className="truncate font-medium">{run.configName || run.configFile || '-'}</div>
            {run.parentRunId ? <StatusPill tone="neutral" className="px-2 py-0.5 text-[10px]">子流程</StatusPill> : null}
            {run.status === 'detached' || run.status === 'superseded' || run.status === 'abandoned' ? (
              <StatusPill tone="warning" className="px-2 py-0.5 text-[10px]">{formatStatusLabel(run.status)}</StatusPill>
            ) : null}
            {run.childSummary?.total ? (
              <StatusPill tone="accent" className="px-2 py-0.5 text-[10px]">
                子流程 {run.childSummary.total}
              </StatusPill>
            ) : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">{run.configFile || '-'}</div>
          {run.parentStepName ? (
            <div className="mt-1 text-xs text-muted-foreground">
              来源：{[run.parentStateName, run.parentStepName].filter(Boolean).join(' / ')}
            </div>
          ) : null}
        </div>
      ),
    },
    ...(data?.isAdmin ? [{
      id: 'owner',
      header: '用户',
      priority: 2,
      render: (run: RunRow & { depth: number }) => (
        <div className="inline-flex items-center gap-2 text-sm">
          <User2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{run.ownerName || '未知用户'}</span>
        </div>
      ),
    } satisfies DataTableColumn<RunRow & { depth: number }>] : []),
    {
      id: 'status',
      header: '状态',
      priority: 1,
      render: (run) => (
        <StatusPill tone={statusTone(run.status)}>
          {formatStatusLabel(run.status)}
        </StatusPill>
      ),
    },
    {
      id: 'phase',
      header: '当前阶段',
      priority: 3,
      className: 'text-sm text-muted-foreground',
      render: (run) => formatStateName(run.currentPhase || '') || '开始中',
    },
    {
      id: 'startTime',
      header: '运行日期',
      sortable: true,
      priority: 2,
      className: 'whitespace-nowrap text-sm',
      render: (run) => run.startTime ? new Date(run.startTime).toLocaleString() : '-',
    },
    {
      id: 'progress',
      header: '进度',
      priority: 3,
      className: 'text-sm text-muted-foreground',
      render: (run) => (
        <div>
          <div>{run.completedSteps || 0}/{run.totalSteps || 0}</div>
          {run.childSummary?.total ? (
            <div className="mt-1 text-xs text-muted-foreground">
              完成 {run.childSummary.completed} · 失败 {run.childSummary.failed} · 等待 {run.childSummary.waitingHuman}
            </div>
          ) : null}
        </div>
      ),
    },
  ], [data?.isAdmin, expandedRunIds]);
  const rankingColumns = useMemo<DataTableColumn<TokenRankingRow>[]>(() => [
    {
      id: 'name',
      header: dimension === 'workflow' ? '工作流名称' : '用户',
      sortable: true,
      priority: 0,
      render: (item) => (
        <div className="min-w-[220px]">
          <div className="font-medium">{item.name || '-'}</div>
          {dimension === 'workflow' ? (
            <div className="mt-1 text-xs text-muted-foreground">{item.configFile || '-'}</div>
          ) : null}
        </div>
      ),
    },
    {
      id: 'runs',
      header: '运行次数',
      sortable: true,
      priority: 1,
      className: 'text-sm text-muted-foreground',
      render: (item) => item.runs.toLocaleString(),
    },
    {
      id: 'totalTokens',
      header: '总 Token',
      sortable: true,
      priority: 0,
      className: 'whitespace-nowrap text-sm font-medium',
      render: (item) => formatTokens(item.totalTokens),
    },
    {
      id: 'details',
      header: '明细',
      priority: 3,
      className: 'text-xs text-muted-foreground',
      render: (item) => {
        const cacheTokens = (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0);
        return `输入 ${formatTokens(item.inputTokens)} · 输出 ${formatTokens(item.outputTokens)} · 缓存 ${formatTokens(cacheTokens)}`;
      },
    },
    {
      id: 'cost',
      header: '成本',
      sortable: true,
      priority: 2,
      className: 'whitespace-nowrap text-sm text-muted-foreground',
      render: (item) => formatMoney(item.cost),
    },
  ], [dimension]);

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
        <PageHeader
          title={pageTitle}
          subtitle={pageSubtitle}
          status={<StatusPill tone={view === 'token-ranking' ? 'accent' : 'info'}>{view === 'token-ranking' ? 'Token 排行' : '运行记录'}</StatusPill>}
          leading={(
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回仪表盘
              </Link>
            </Button>
          )}
          secondaryActions={<><LanguageToggle /><ThemeToggle /></>}
        />
      ) : null}

      <main className="container mx-auto space-y-4 px-6 py-6">
        <PageToolbar
          viewToggle={(
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={view === 'runs' ? 'secondary' : 'outline'}
                onClick={() => switchView('runs')}
              >
                <History className="mr-1.5 h-4 w-4" />
                运行记录
              </Button>
              <Button
                size="sm"
                variant={view === 'token-ranking' ? 'secondary' : 'outline'}
                onClick={() => switchView('token-ranking')}
              >
                <TrendingUp className="mr-1.5 h-4 w-4" />
                Token 排行
              </Button>
            </div>
          )}
          search={(
            <div className="flex items-center gap-2">
              <Input
                value={keyword}
                onChange={(event) => updateQuery({ keyword: event.target.value || null, page: '1' })}
                onKeyDown={(event) => { if (event.key === 'Enter') updateQuery({ keyword: keyword || null, page: '1' }); }}
                placeholder={searchPlaceholder}
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => updateQuery({ keyword: keyword || null, page: '1' })}
                aria-label="搜索"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          )}
          filters={(
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-2">
              {view === 'token-ranking' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={dimension === 'workflow' ? 'secondary' : 'outline'}
                    onClick={() => switchDimension('workflow')}
                  >
                    按工作流
                  </Button>
                  <Button
                    size="sm"
                    variant={dimension === 'user' ? 'secondary' : 'outline'}
                    onClick={() => switchDimension('user')}
                  >
                    按用户
                  </Button>
                </div>
              ) : null}
              {data?.isAdmin ? (
                <MultiCombobox
                  value={ownerIds}
                  onValueChange={(values) => updateQuery({ ownerId: values.length ? values.join(',') : null, page: '1' })}
                  options={(data.userOptions || []).map((user) => ({ value: user.id, label: user.username }))}
                  placeholder="筛选用户..."
                  triggerClassName="min-h-10 w-[240px]"
                  emptyText="无匹配用户"
                />
              ) : null}
              {view === 'runs' ? (
                <select
                  className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground shadow-none outline-none transition-colors hover:bg-muted/35 focus:border-ring"
                  value={statusFilter}
                  onChange={(event) => updateQuery({ status: event.target.value === 'all' ? null : event.target.value, page: '1' })}
                  aria-label="筛选运行状态"
                >
                  <option value="all">全部状态</option>
                  <option value="running">运行中</option>
                  <option value="preparing">准备中</option>
                  <option value="completed">已完成</option>
                  <option value="failed">失败 / 崩溃</option>
                  <option value="stopped">已停止</option>
                </select>
              ) : null}
              </div>
            </div>
          )}
          refresh={(
            <Button variant="outline" size="sm" onClick={() => historyQuery.refetch()}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              刷新
            </Button>
          )}
          activeFilters={<span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><History className="h-3.5 w-3.5" />{totalLabel}</span>}
        />

        {view === 'token-ranking' ? (
          <DataTable
            aria-label="Token 使用排行"
            columns={rankingColumns}
            rows={rankingItems}
            rowKey={(item, index) => `${item.configFile || item.name}-${index}`}
            loading={loading}
            error={error ? { title: 'Token 排行加载失败', message: error, onRetry: () => historyQuery.refetch() } : undefined}
            emptyState={{
              icon: <TrendingUp className="h-5 w-5" />,
              title: '暂无 Token 排行数据',
              description: '运行完成后会在这里汇总 Token、成本和运行次数。',
              className: 'min-h-[180px] border-0',
            }}
            sort={{
              columnId: activeSortKey,
              direction: sortDirection,
              onSortChange: ({ columnId }) => toggleSort(columnId as TokenRankingSortKey),
            }}
            pagination={{
              page: activePagination.page || 1,
              pageSize,
              total: activePagination.total || 0,
              onPageChange: (p) => updateQuery({ page: String(p) }),
              label: totalLabel,
            }}
            density="comfortable"
          />
        ) : (
          <DataTable
            aria-label="运行记录"
            columns={runColumns}
            rows={displayedRunItems}
            rowKey="id"
            loading={loading}
            error={error ? { title: '运行记录加载失败', message: error, onRetry: () => historyQuery.refetch() } : undefined}
            emptyState={{
              icon: <History className="h-5 w-5" />,
              title: '暂无运行记录',
              description: '工作流运行后会在这里显示历史、状态和 Workbench 入口。',
              className: 'min-h-[180px] border-0',
            }}
            sort={{
              columnId: activeSortKey,
              direction: sortDirection,
              onSortChange: ({ columnId }) => toggleSort(columnId as RunSortKey),
            }}
            selection={{
              selectedKeys: selectedDisplayedRunIds,
              onSelectedKeysChange: (keys) => setSelectedRunIds(new Set(keys.map(String))),
              ariaLabel: '选择当前页运行记录',
            }}
            pagination={{
              page: activePagination.page || 1,
              pageSize,
              total: activePagination.total || 0,
              onPageChange: (p) => updateQuery({ page: String(p) }),
              label: totalLabel,
            }}
            onRowClick={(run) => setSelectedRun(run)}
            rowActions={getRunActions}
            density="comfortable"
          />
        )}

        {view === 'runs' ? (
          <BulkActionBar
            selectedCount={selectedRunIds.size}
            onClear={() => setSelectedRunIds(new Set())}
            actions={(
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={pendingRunAction === 'bulk-delete'}
                onClick={() => { void deleteSelectedRuns(); }}
              >
                <Trash2 className="mr-1.5 h-4 w-4" />
                {pendingRunAction === 'bulk-delete' ? '删除中...' : '删除已选'}
              </Button>
            )}
          />
        ) : null}
      </main>
      <DetailDrawer open={!!selectedRun} onOpenChange={(open) => { if (!open) setSelectedRun(null); }}>
        <DetailDrawerContent widthClassName="w-[min(560px,calc(100vw-1rem))]">
          <DetailDrawerHeader>
            <DetailDrawerTitle>{selectedRun?.configName || selectedRun?.configFile || '运行详情'}</DetailDrawerTitle>
            <DetailDrawerDescription>{selectedRun?.id || ''}</DetailDrawerDescription>
          </DetailDrawerHeader>
          {selectedRun ? (
            <>
              <DetailDrawerBody className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill tone={statusTone(selectedRun.status)}>{formatStatusLabel(selectedRun.status)}</StatusPill>
                  {selectedRun.parentRunId ? <StatusPill tone="neutral">子流程</StatusPill> : null}
                  <StatusPill tone="info">{formatDuration(selectedRun.startTime, selectedRun.endTime)}</StatusPill>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <RunMetric label="总 Token" value={formatTokens(selectedRun.totalTokens)} />
                  <RunMetric label="成本" value={formatMoney(selectedRun.cost)} />
                  <RunMetric label="进度" value={`${selectedRun.completedSteps || 0}/${selectedRun.totalSteps || 0}`} />
                  <RunMetric label="用户" value={selectedRun.ownerName || '未知用户'} />
                </div>

                <DrawerSection title="运行摘要">
                  <DrawerRow label="工作流文件" value={selectedRun.configFile || '-'} mono />
                  <DrawerRow label="当前阶段" value={formatStateName(selectedRun.currentPhase || '') || '开始中'} />
                  <DrawerRow label="开始时间" value={selectedRun.startTime ? new Date(selectedRun.startTime).toLocaleString() : '-'} />
                  <DrawerRow label="结束时间" value={selectedRun.endTime ? new Date(selectedRun.endTime).toLocaleString() : selectedRun.status === 'running' ? '运行中' : '-'} />
                  {selectedRun.parentStepName ? (
                    <DrawerRow label="来源步骤" value={[selectedRun.parentStateName, selectedRun.parentStepName].filter(Boolean).join(' / ')} />
                  ) : null}
                </DrawerSection>

                <DrawerSection title="Token 明细">
                  <DrawerRow label="输入" value={formatTokens(selectedRun.inputTokens)} />
                  <DrawerRow label="输出" value={formatTokens(selectedRun.outputTokens)} />
                  <DrawerRow label="缓存写入" value={formatTokens(selectedRun.cacheCreationInputTokens)} />
                  <DrawerRow label="缓存读取" value={formatTokens(selectedRun.cacheReadInputTokens)} />
                </DrawerSection>

                <DrawerSection title="子运行">
                  {selectedRun.childRuns?.length ? (
                    <div className="space-y-2">
                      {selectedRun.childRuns.slice(0, 8).map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-muted/35"
                          onClick={() => setSelectedRun(child)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium">{child.configName || child.configFile || child.id}</div>
                              <div className="mt-1 truncate text-xs text-muted-foreground">{child.id}</div>
                            </div>
                            <StatusPill tone={statusTone(child.status)} className="shrink-0 text-[10px]">{formatStatusLabel(child.status)}</StatusPill>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : selectedRun.childSummary?.total ? (
                    <div className="text-sm text-muted-foreground">
                      子运行摘要：共 {selectedRun.childSummary.total}，完成 {selectedRun.childSummary.completed}，失败 {selectedRun.childSummary.failed}，等待 {selectedRun.childSummary.waitingHuman}。
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">暂无子运行。</div>
                  )}
                </DrawerSection>

                <DrawerSection title="文档 / 输出">
                  {drawerDocumentsQuery.isLoading ? (
                    <div className="text-sm text-muted-foreground">文档列表加载中...</div>
                  ) : drawerDocuments.length > 0 ? (
                    <div className="space-y-2">
                      {drawerDocuments.slice(0, 8).map((doc) => (
                        <div key={doc.id} className="rounded-lg border border-border bg-card px-3 py-2">
                          <div className="truncate text-sm font-medium">{doc.logicalName || doc.baseName || doc.filename || doc.name}</div>
                          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span>{doc.documentKind || 'document'}</span>
                            {doc.phaseName ? <span>{doc.phaseName}</span> : null}
                            {doc.agent ? <span>{doc.agent}</span> : null}
                            {doc.modifiedTime ? <span>{new Date(doc.modifiedTime).toLocaleString()}</span> : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">未取到文档或输出摘要；运行工作台仍保留完整文档和输出视图。</div>
                  )}
                </DrawerSection>
              </DetailDrawerBody>
              <DetailDrawerFooter className="flex-wrap justify-between">
                <Button variant="outline" size="sm" onClick={() => { void copyRunId(selectedRun); }}>
                  <Copy className="mr-2 h-4 w-4" />
                  复制 ID
                </Button>
                <Button size="sm" onClick={() => openRunInWorkbench(selectedRun)} disabled={!selectedRun.configFile}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  打开运行工作台
                </Button>
              </DetailDrawerFooter>
            </>
          ) : null}
        </DetailDrawerContent>
      </DetailDrawer>
    </div>
  );
}

function RunMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-lg font-semibold">{value}</div>
    </div>
  );
}

function DrawerSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function DrawerRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={`min-w-0 truncate text-right ${mono ? 'font-mono text-xs' : 'font-medium'}`}>{value}</span>
    </div>
  );
}
