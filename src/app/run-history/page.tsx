'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  History,
  Play,
  Search,
  TrendingUp,
  User2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { PaginationBar } from '@/components/PaginationBar';
import { MultiCombobox } from '@/components/ui/combobox';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';

type HistoryView = 'runs' | 'token-ranking';
type RunSortKey = 'name' | 'startTime' | 'totalTokens' | 'cost';
type TokenRankingSortKey = 'name' | 'totalTokens' | 'runs' | 'cost';
type SortDirection = 'asc' | 'desc';
type TokenRankingDimension = 'workflow' | 'user';

interface RunRow {
  id: string;
  configFile: string;
  configName: string;
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

function formatTokens(value: number): string {
  return Number(value || 0).toLocaleString();
}

function formatMoney(value: number): string {
  return `$${Number(value || 0).toFixed(4)}`;
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

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-500" />;
  if (status === 'running') return <Play className="h-4 w-4 text-blue-500" />;
  if (status === 'stopped') return <AlertCircle className="h-4 w-4 text-muted-foreground" />;
  if (status === 'crashed') return <XCircle className="h-4 w-4 text-orange-500" />;
  return <Clock className="h-4 w-4 text-yellow-500" />;
}

function SortIndicator({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) return <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />;
  return direction === 'asc'
    ? <ArrowUp className="h-3.5 w-3.5 text-primary" />
    : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
}

export default function RunHistoryPage() {
  const router = useRouter();
  const dockWorkspace = useDashboardDockWorkspace();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle('运行记录');

  const queryString = searchParams.toString();
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), 20);
  const view = parseHistoryView(searchParams.get('view'));
  const runSortKey = parseRunSortKey(searchParams.get('sortKey'));
  const tokenRankingSortKey = parseTokenRankingSortKey(searchParams.get('sortKey'));
  const sortDirection = parseSortDirection(searchParams.get('sortDirection'));
  const dimension = parseTokenRankingDimension(searchParams.get('dimension'));
  const ownerIds = (searchParams.get('ownerId') || '').split(',').filter(Boolean);
  const keyword = searchParams.get('keyword') || '';
  const activeSortKey = view === 'token-ranking' ? tokenRankingSortKey : runSortKey;

  const updateQuery = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    const next = params.toString();
    router.replace(next ? `${pathname}?${next}` : pathname);
  };

  useEffect(() => {
    let cancelled = false;

    const loadRuns = async () => {
      try {
        setLoading(true);
        setError(null);
        const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
        const res = await fetch(`/api/run-history${queryString ? `?${queryString}` : ''}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });

        if (res.status === 401) {
          localStorage.removeItem('auth-token');
          localStorage.removeItem('auth-user');
          router.push('/login');
          return;
        }

        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || '运行记录加载失败');
        if (!cancelled) setData(json);
      } catch (loadError: any) {
        if (!cancelled) setError(loadError?.message || '运行记录加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadRuns();
    return () => {
      cancelled = true;
    };
  }, [queryString, router]);

  const totalLabel = useMemo(() => {
    if (!data?.pagination.total) return view === 'token-ranking' ? '暂无 Token 排行数据' : '暂无运行记录';
    const start = (data.pagination.page - 1) * data.pagination.pageSize + 1;
    const end = Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total);
    return `显示 ${start}-${end} / ${data.pagination.total} 条`;
  }, [data, view]);

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

  const pageTitle = view === 'token-ranking' ? 'Token 使用排行' : '全部运行记录';
  const pageSubtitle = view === 'token-ranking'
    ? (dimension === 'workflow'
      ? '按工作流聚合查看累计 Token、成本和运行次数'
      : '按用户聚合查看累计 Token、成本和运行次数')
    : '按名称、日期和用户维度查看历史流水线运行';
  const searchPlaceholder = view === 'token-ranking'
    ? (dimension === 'workflow' ? '搜索工作流...' : '搜索用户...')
    : '搜索运行记录...';
  const rankingItems = data?.view === 'token-ranking' ? data.rankings || [] : [];
  const runItems = data?.view === 'runs' || !data?.view ? data?.runs || [] : [];
  const { isDashboardShell } = useDashboardShellHeader({
    title: pageTitle,
    subtitle: pageSubtitle,
  }, [pageTitle, pageSubtitle]);

  return (
    <div className="min-h-screen bg-background">
      {!isDashboardShell ? (
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/85 px-6 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回首页
            </Link>
          </Button>
          <div className="h-6 w-px bg-border" />
          <div>
            <h1 className="text-2xl font-bold">{pageTitle}</h1>
            <p className="text-xs text-muted-foreground">{pageSubtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <LanguageToggle />
          <ThemeToggle />
        </div>
      </header>
      ) : null}

      <main className="container mx-auto space-y-6 px-6 py-8">
        <section className="rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={view === 'runs' ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => switchView('runs')}
                >
                  <History className="mr-1.5 h-4 w-4" />
                  运行记录
                </Button>
                <Button
                  size="sm"
                  variant={view === 'token-ranking' ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => switchView('token-ranking')}
                >
                  <TrendingUp className="mr-1.5 h-4 w-4" />
                  Token 排行
                </Button>
              </div>
              <div className="flex w-full max-w-sm items-center gap-2">
                <Input
                  value={keyword}
                  onChange={(event) => updateQuery({ keyword: event.target.value || null, page: '1' })}
                  onKeyDown={(event) => { if (event.key === 'Enter') updateQuery({ keyword: keyword || null, page: '1' }); }}
                  placeholder={searchPlaceholder}
                  className="h-11"
                />
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  onClick={() => updateQuery({ keyword: keyword || null, page: '1' })}
                >
                  <Search className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {view === 'token-ranking' ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={dimension === 'workflow' ? 'default' : 'outline'}
                    className="rounded-full"
                    onClick={() => switchDimension('workflow')}
                  >
                    按工作流
                  </Button>
                  <Button
                    size="sm"
                    variant={dimension === 'user' ? 'default' : 'outline'}
                    className="rounded-full"
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
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <History className="h-4 w-4" />
              <span>{totalLabel}</span>
            </span>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/70 shadow-sm backdrop-blur">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                {view === 'token-ranking' ? (
                  <TableRow>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        {dimension === 'workflow' ? '工作流名称' : '用户'}
                        <SortIndicator active={activeSortKey === 'name'} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('runs')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        运行次数
                        <SortIndicator active={activeSortKey === 'runs'} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('totalTokens')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        总 Token
                        <SortIndicator active={activeSortKey === 'totalTokens'} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>明细</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('cost')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        成本
                        <SortIndicator active={activeSortKey === 'cost'} direction={sortDirection} />
                      </button>
                    </TableHead>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('name')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        工作流名称
                        <SortIndicator active={activeSortKey === 'name'} direction={sortDirection} />
                      </button>
                    </TableHead>
                    {data?.isAdmin ? <TableHead>用户</TableHead> : null}
                    <TableHead>状态</TableHead>
                    <TableHead>当前阶段</TableHead>
                    <TableHead>
                      <button
                        type="button"
                        onClick={() => toggleSort('startTime')}
                        className="inline-flex items-center gap-2 font-medium"
                      >
                        运行日期
                        <SortIndicator active={activeSortKey === 'startTime'} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>进度</TableHead>
                  </TableRow>
                )}
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={view === 'token-ranking' ? 5 : (data?.isAdmin ? 6 : 5)} className="h-32 text-center text-muted-foreground">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={view === 'token-ranking' ? 5 : (data?.isAdmin ? 6 : 5)} className="h-32 text-center text-red-500">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : view === 'token-ranking' ? (
                  rankingItems.length ? (
                    rankingItems.map((item, index) => {
                      const cacheTokens = (item.cacheCreationInputTokens || 0) + (item.cacheReadInputTokens || 0);
                      return (
                        <TableRow key={`${item.configFile || item.name}-${index}`}>
                          <TableCell>
                            <div className="min-w-[220px]">
                              <div className="font-medium">{item.name || '-'}</div>
                              {dimension === 'workflow' ? (
                                <div className="mt-1 text-xs text-muted-foreground">{item.configFile || '-'}</div>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{item.runs.toLocaleString()}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm font-medium">{formatTokens(item.totalTokens)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            输入 {formatTokens(item.inputTokens)} · 输出 {formatTokens(item.outputTokens)} · 缓存 {formatTokens(cacheTokens)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{formatMoney(item.cost)}</TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                        暂无 Token 排行数据
                      </TableCell>
                    </TableRow>
                  )
                ) : runItems.length ? (
                  runItems.map((run) => (
                    <TableRow
                      key={run.id}
                      className={run.configFile ? 'cursor-pointer' : undefined}
                      onClick={() => {
                        if (!run.configFile) return;
                        const route = `/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`;
                        if (dockWorkspace) {
                          dockWorkspace.openTab({
                            id: `workbench:${run.configFile}:history:${run.id}`,
                            title: run.configName || run.configFile,
                            kind: 'workbench',
                            config: run.configFile,
                            mode: 'history',
                            runId: run.id,
                          });
                          const params = new URLSearchParams(searchParams.toString());
                          params.delete('panel');
                          params.delete('reload');
                          params.set('route', route);
                          router.push(`/dashboard?${params.toString()}`);
                        } else {
                          router.push(route);
                        }
                      }}
                    >
                      <TableCell>
                        <div className="min-w-[220px]">
                          <div className="font-medium">{run.configName || run.configFile || '-'}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{run.configFile || '-'}</div>
                        </div>
                      </TableCell>
                      {data?.isAdmin ? (
                        <TableCell>
                          <div className="inline-flex items-center gap-2 text-sm">
                            <User2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>{run.ownerName || '未知用户'}</span>
                          </div>
                        </TableCell>
                      ) : null}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StatusIcon status={run.status} />
                          <Badge variant={run.status === 'completed' ? 'default' : 'secondary'}>
                            {formatStatusLabel(run.status)}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatStateName(run.currentPhase || '') || '开始中'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {run.startTime ? new Date(run.startTime).toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {run.completedSteps || 0}/{run.totalSteps || 0}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={data?.isAdmin ? 6 : 5} className="h-32 text-center text-muted-foreground">
                      暂无运行记录
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </section>

        {(data?.pagination.totalPages || 1) > 1 && (
          <PaginationBar
            current={data?.pagination.page || 1}
            total={data?.pagination.total || 0}
            pageSize={pageSize}
            onPageChange={(p) => updateQuery({ page: String(p) })}
            pageSizeOptions={[20, 50, 100]}
            onPageSizeChange={(size) => updateQuery({ pageSize: String(size), page: '1' })}
            itemLabel="条记录"
            paginationStyle="numbered"
          />
        )}
      </main>
    </div>
  );
}
