'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  History,
  Play,
  User2,
  XCircle,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { cn } from '@/lib/utils';

type RunSortKey = 'name' | 'startTime';
type SortDirection = 'asc' | 'desc';

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
}

interface HistoryResponse {
  runs: RunRow[];
  pagination: {
    total: number;
    totalPages: number;
    page: number;
    pageSize: number;
  };
  filters: {
    sortKey: RunSortKey;
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

function parseSortKey(value: string | null): RunSortKey {
  return value === 'name' ? 'name' : 'startTime';
}

function parseSortDirection(value: string | null): SortDirection {
  return value === 'asc' ? 'asc' : 'desc';
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useDocumentTitle('运行记录');

  const queryString = searchParams.toString();
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('pageSize'), 20);
  const sortKey = parseSortKey(searchParams.get('sortKey'));
  const sortDirection = parseSortDirection(searchParams.get('sortDirection'));
  const ownerId = searchParams.get('ownerId') || 'all';
  const keyword = searchParams.get('keyword') || '';

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
    if (!data?.pagination.total) return '暂无运行记录';
    const start = (data.pagination.page - 1) * data.pagination.pageSize + 1;
    const end = Math.min(data.pagination.page * data.pagination.pageSize, data.pagination.total);
    return `显示 ${start}-${end} / ${data.pagination.total} 条`;
  }, [data]);

  const toggleSort = (key: RunSortKey) => {
    if (sortKey === key) {
      updateQuery({
        sortDirection: sortDirection === 'asc' ? 'desc' : 'asc',
        page: '1',
      });
      return;
    }

    updateQuery({
      sortKey: key,
      sortDirection: key === 'startTime' ? 'desc' : 'asc',
      page: '1',
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-card/85 backdrop-blur-xl">
        <div className="container mx-auto flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                返回首页
              </Link>
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <h1 className="text-2xl font-bold">全部运行记录</h1>
              <p className="text-xs text-muted-foreground">按名称、日期和用户维度查看历史流水线运行</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="container mx-auto space-y-6 px-6 py-8">
        <section className="rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
              <Input
                value={keyword}
                onChange={(event) => updateQuery({ keyword: event.target.value || null, page: '1' })}
                placeholder="搜索运行记录..."
                className="h-11 w-full max-w-sm"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={sortKey === 'startTime' ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => updateQuery({ sortKey: 'startTime', page: '1' })}
                >
                  按日期
                </Button>
                <Button
                  size="sm"
                  variant={sortKey === 'name' ? 'default' : 'outline'}
                  className="rounded-full"
                  onClick={() => updateQuery({ sortKey: 'name', page: '1' })}
                >
                  按名称
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => updateQuery({ sortDirection: sortDirection === 'asc' ? 'desc' : 'asc', page: '1' })}
                >
                  {sortDirection === 'asc' ? '升序' : '降序'}
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {data?.isAdmin ? (
                <Select value={ownerId} onValueChange={(value) => updateQuery({ ownerId: value, page: '1' })}>
                  <SelectTrigger className="h-10 w-[180px]">
                    <SelectValue placeholder="全部用户" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部用户</SelectItem>
                    {data.userOptions.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.username}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: '1' })}>
                <SelectTrigger className={cn('h-10', data?.isAdmin ? 'w-[110px]' : 'w-[120px]')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="20">20 / 页</SelectItem>
                  <SelectItem value="50">50 / 页</SelectItem>
                  <SelectItem value="100">100 / 页</SelectItem>
                </SelectContent>
              </Select>
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
                <TableRow>
                  <TableHead>
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-2 font-medium"
                    >
                      工作流名称
                      <SortIndicator active={sortKey === 'name'} direction={sortDirection} />
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
                      <SortIndicator active={sortKey === 'startTime'} direction={sortDirection} />
                    </button>
                  </TableHead>
                  <TableHead>进度</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={data?.isAdmin ? 6 : 5} className="h-32 text-center text-muted-foreground">
                      加载中...
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell colSpan={data?.isAdmin ? 6 : 5} className="h-32 text-center text-red-500">
                      {error}
                    </TableCell>
                  </TableRow>
                ) : data?.runs.length ? (
                  data.runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className={run.configFile ? 'cursor-pointer' : undefined}
                      onClick={() => {
                        if (!run.configFile) return;
                        router.push(`/workbench/${encodeURIComponent(run.configFile)}?mode=history&runId=${run.id}`);
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

        <section className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-muted-foreground">{totalLabel}</div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!data || data.pagination.page <= 1}
              onClick={() => updateQuery({ page: String(Math.max(1, page - 1)) })}
            >
              <ArrowLeft className="mr-1 h-4 w-4" />
              上一页
            </Button>
            <Badge variant="secondary">
              第 {data?.pagination.page || 1} / {data?.pagination.totalPages || 1} 页
            </Badge>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || data.pagination.page >= data.pagination.totalPages}
              onClick={() => updateQuery({ page: String(page + 1) })}
            >
              下一页
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
