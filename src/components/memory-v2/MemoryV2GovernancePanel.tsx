'use client';

import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, ChevronDown, Eye, RefreshCw, RotateCcw, ShieldAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/client/query/query-client';
import {
  useMemoryV2GovernanceActionMutation,
  useMemoryV2GovernanceDetailQuery,
  useMemoryV2GovernanceQuery,
  type MemoryV2DetailParams,
  type MemoryV2GovernanceActionInput,
} from '@/client/query/memory-v2';
import type {
  MemoryDetailPage,
  MemoryGovernanceAction,
  MemoryGovernanceRecord,
  MemoryItemStatus,
  PersistedMemoryRetention,
} from '@/lib/memory-v2';

const RETENTION_OPTIONS: Array<{ value: PersistedMemoryRetention; label: string }> = [
  { value: 'short', label: '短期' },
  { value: 'long', label: '长期' },
];

const STATUS_OPTIONS: Array<{ value: MemoryItemStatus; label: string }> = [
  { value: 'pending-review', label: '待审核' },
  { value: 'active', label: '生效' },
  { value: 'resolved', label: '已解决' },
  { value: 'superseded', label: '已替代' },
  { value: 'expired', label: '已过期' },
  { value: 'rejected', label: '已拒绝' },
];

type GovernanceActionTarget = {
  record: MemoryGovernanceRecord;
  action: Exclude<MemoryGovernanceAction, 'supersede'>;
};

type GovernanceDetailTarget = Pick<MemoryGovernanceRecord['index'], 'memoryId' | 'detailVersion' | 'summary'>;

type LoadedGovernancePages = {
  filterKey: string;
  items: MemoryGovernanceRecord[];
  total: number;
  nextOffset: number | null;
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return '当前账户没有系统级 Memory V2 治理权限。';
    if (error.status === 409) return 'Memory V2 尚未完成初始化或当前不可用。';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatTimestamp(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

function compactId(value: string) {
  return value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-8)}` : value;
}

function statusLabel(status: string) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || status;
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'accent' {
  if (status === 'active' || status === 'resolved') return 'success';
  if (status === 'pending-review') return 'warning';
  if (status === 'rejected') return 'danger';
  if (status === 'superseded') return 'accent';
  return 'neutral';
}

function actionLabel(action: MemoryGovernanceAction) {
  if (action === 'approve') return '通过';
  if (action === 'reject') return '拒绝';
  if (action === 'expire') return '过期';
  if (action === 'supersede') return '替代';
  return '改为短期';
}

function actionDescription(action: MemoryGovernanceAction) {
  if (action === 'approve') return '将这条长期记忆设为生效，保留当前详情版本且不修改正文。';
  if (action === 'reject') return '拒绝这条长期记忆候选，保留审计记录且不修改正文。';
  if (action === 'expire') return '将这条长期记忆标记为过期，保留审计记录且不修改正文。';
  if (action === 'reclassify') return '由服务端以当前版本创建短期替代索引，并把原长期候选标记为已替代。';
  return '用一个已有、同一所有者和保留类型的服务端索引替代当前候选。';
}

function toggleSelection<T extends string>(current: T[], all: readonly T[], value: T): T[] {
  const next = new Set(current.length ? current : all);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next.size === all.length ? [] : Array.from(next);
}

function isSelected<T extends string>(current: T[], value: T) {
  return current.length === 0 || current.includes(value);
}

function pageKey(page: MemoryDetailPage) {
  return `${page.memoryId}:${page.detailVersion}:${page.cursor || 'first'}`;
}

function GovernanceDetailDrawer({
  target,
  onOpenChange,
}: {
  target: GovernanceDetailTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const targetKey = target ? `${target.memoryId}:${target.detailVersion}` : '';
  const [cursor, setCursor] = useState<string | undefined>();
  const [pageState, setPageState] = useState<{ key: string; pages: MemoryDetailPage[] }>({ key: '', pages: [] });
  const activeCursor = pageState.key === targetKey ? cursor : undefined;
  const request: MemoryV2DetailParams | null = target ? {
    memoryId: target.memoryId,
    detailVersion: target.detailVersion,
    ...(activeCursor ? { cursor: activeCursor } : {}),
    maxChars: 4_000,
  } : null;
  const detailQuery = useMemoryV2GovernanceDetailQuery(request);
  const pages = pageState.key === targetKey ? pageState.pages : [];
  const lastPage = pages[pages.length - 1];

  useEffect(() => {
    setCursor(undefined);
    setPageState({ key: targetKey, pages: [] });
  }, [targetKey]);

  useEffect(() => {
    const page = detailQuery.data?.page;
    if (!page || !targetKey) return;
    setPageState((current) => {
      const existing = current.key === targetKey ? current.pages : [];
      if (existing.some((item) => pageKey(item) === pageKey(page))) return { key: targetKey, pages: existing };
      return { key: targetKey, pages: [...existing, page] };
    });
  }, [detailQuery.data?.page, targetKey]);

  return (
    <DetailDrawer open={Boolean(target)} onOpenChange={onOpenChange}>
      <DetailDrawerContent widthClassName="w-[min(760px,calc(100vw-1rem))]">
        <DetailDrawerHeader>
          <DetailDrawerTitle>记忆详情</DetailDrawerTitle>
          <DetailDrawerDescription>
            {target ? `${target.summary || '未命名记忆'} · 版本 ${target.detailVersion}` : '仅在此处按需读取版本化详情。'}
          </DetailDrawerDescription>
        </DetailDrawerHeader>
        <DetailDrawerBody className="space-y-4">
          {detailQuery.isLoading && pages.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">正在读取版本化详情...</div>
          ) : null}
          {detailQuery.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{getErrorMessage(detailQuery.error, '详情读取失败。')}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={detailQuery.isFetching}
                onClick={() => void detailQuery.refetch()}
              >
                <RefreshCw className={detailQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                重试读取
              </Button>
            </div>
          ) : null}
          {pages.map((page, index) => (
            <section key={pageKey(page)} className="space-y-2">
              {pages.length > 1 ? (
                <div className="text-xs font-medium text-muted-foreground">详情片段 {index + 1}</div>
              ) : null}
              <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/25 p-3 text-sm leading-6 text-foreground">
                {page.details}
              </pre>
              <div className="text-xs text-muted-foreground">本页 {page.detailChars} 字符</div>
            </section>
          ))}
          {!detailQuery.isLoading && !detailQuery.isError && pages.length === 0 ? (
            <EmptyState title="暂无详情页" description="该详情版本没有返回可显示内容。" />
          ) : null}
        </DetailDrawerBody>
        <DetailDrawerFooter>
          {lastPage?.nextCursor ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={detailQuery.isFetching}
              onClick={() => setCursor(lastPage.nextCursor)}
            >
              <ChevronDown className="h-4 w-4" />
              {detailQuery.isFetching ? '加载中...' : '加载后续详情'}
            </Button>
          ) : null}
          {lastPage?.complete ? <span className="text-xs text-muted-foreground">已读取当前版本的全部详情</span> : null}
        </DetailDrawerFooter>
      </DetailDrawerContent>
    </DetailDrawer>
  );
}

function GovernanceRecord({
  record,
  onReadDetails,
  onAction,
  onSupersede,
}: {
  record: MemoryGovernanceRecord;
  onReadDetails: (record: MemoryGovernanceRecord) => void;
  onAction: (record: MemoryGovernanceRecord, action: Exclude<MemoryGovernanceAction, 'supersede'>) => void;
  onSupersede: (record: MemoryGovernanceRecord) => void;
}) {
  const { index, handoffState, scopeBindings } = record;
  const source = index.source;
  const sourceText = [
    source.sourceAgentId ? `Agent ${source.sourceAgentId}` : null,
    source.sourceRunId ? `运行 ${source.sourceRunId}` : null,
    source.sourceSessionId ? `会话 ${source.sourceSessionId}` : null,
  ].filter(Boolean).join(' · ');
  const canReview = index.retention === 'long' && index.status === 'pending-review';
  const receiptSummary = handoffState.receipts;

  return (
    <article className="border border-border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-foreground">{index.summary || '未命名记忆'}</h3>
            <StatusPill tone={index.retention === 'long' ? 'accent' : 'info'}>{index.retention === 'long' ? '长期' : '短期'}</StatusPill>
            <StatusPill tone={statusTone(index.status)}>{statusLabel(index.status)}</StatusPill>
            <StatusPill tone="neutral" dot={false}>{index.kind || '未分类'}</StatusPill>
          </div>
          <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{index.readWhen.text || '未提供读取条件'}</p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label="读取版本化详情"
              onClick={() => onReadDetails(record)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>读取版本化详情</TooltipContent>
        </Tooltip>
      </div>

      <dl className="mt-4 grid gap-x-5 gap-y-3 border-y border-border py-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-muted-foreground">读取触发</dt>
          <dd className="mt-1 break-words text-foreground">{index.readWhen.triggers.join('、') || '-'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">交接</dt>
          <dd className="mt-1 break-words text-foreground">{index.handoff.mode} / {index.handoff.target}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">索引 / 详情字符</dt>
          <dd className="mt-1 text-foreground">{index.indexChars} / {record.detailChars}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">来源</dt>
          <dd className="mt-1 break-words text-foreground">{sourceText || '-'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">详情版本</dt>
          <dd className="mt-1 text-foreground">v{index.detailVersion}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">更新时间</dt>
          <dd className="mt-1 break-words text-foreground">{formatTimestamp(index.updatedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">交接授权</dt>
          <dd className="mt-1 text-foreground">{handoffState.authorizedTargetCount}/{handoffState.targetCount} 已授权</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">回执</dt>
          <dd className="mt-1 text-foreground">{receiptSummary.read + receiptSummary.acknowledged}/{receiptSummary.total} 已读取或确认</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        {scopeBindings.length ? scopeBindings.map((binding) => (
          <span key={`${binding.scopeType}:${binding.scopeKey}:${binding.role}`} className="max-w-full break-all rounded-md border border-border bg-muted/30 px-2 py-1">
            {binding.scopeType}:{binding.scopeKey} · {binding.role} · {binding.visibility}
          </span>
        )) : <span>没有可展示的作用域绑定。</span>}
        {handoffState.unauthorizedTargetCount > 0 ? (
          <span className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1 text-destructive">
            {handoffState.unauthorizedTargetCount} 个目标未获授权
          </span>
        ) : null}
      </div>

      {canReview ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="mr-1 text-xs font-medium text-muted-foreground">审核操作</span>
          <Button type="button" size="sm" className="h-8" onClick={() => onAction(record, 'approve')}>
            <Check className="h-3.5 w-3.5" />
            通过
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onAction(record, 'reclassify')}>
            <RotateCcw className="h-3.5 w-3.5" />
            改为短期
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onSupersede(record)}>
            <Archive className="h-3.5 w-3.5" />
            替代
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => onAction(record, 'expire')}>
            <ShieldAlert className="h-3.5 w-3.5" />
            过期
          </Button>
          <Button type="button" variant="destructive" size="sm" className="h-8" onClick={() => onAction(record, 'reject')}>
            <X className="h-3.5 w-3.5" />
            拒绝
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function MemoryV2GovernancePanel() {
  const { toast } = useToast();
  const [retentions, setRetentions] = useState<PersistedMemoryRetention[]>([]);
  const [statuses, setStatuses] = useState<MemoryItemStatus[]>([]);
  const filterKey = useMemo(() => JSON.stringify({
    retentions: [...retentions].sort(),
    statuses: [...statuses].sort(),
  }), [retentions, statuses]);
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<LoadedGovernancePages>({
    filterKey: '',
    items: [],
    total: 0,
    nextOffset: null,
  });
  const [awaitingGovernanceRefresh, setAwaitingGovernanceRefresh] = useState(false);
  const [actionTarget, setActionTarget] = useState<GovernanceActionTarget | null>(null);
  const [supersedeTarget, setSupersedeTarget] = useState<MemoryGovernanceRecord | null>(null);
  const [replacementMemoryId, setReplacementMemoryId] = useState('');
  const [detailTarget, setDetailTarget] = useState<GovernanceDetailTarget | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const governanceQuery = useMemoryV2GovernanceQuery({
    retentions: retentions.length ? retentions : undefined,
    statuses: statuses.length ? statuses : undefined,
    offset,
    limit: 100,
    auditLimit: 20,
  });
  const actionMutation = useMemoryV2GovernanceActionMutation();
  const activeLoaded = loaded.filterKey === filterKey ? loaded : null;
  const allRecords = activeLoaded?.items || [];
  const replacementOptions = useMemo(() => {
    if (!supersedeTarget) return [];
    return allRecords.filter((candidate) => (
      candidate.index.memoryId !== supersedeTarget.index.memoryId
      && candidate.index.ownerUserId === supersedeTarget.index.ownerUserId
      && candidate.index.retention === supersedeTarget.index.retention
      && (candidate.index.status === 'active' || candidate.index.status === 'pending-review')
    ));
  }, [allRecords, supersedeTarget]);

  useEffect(() => {
    setReplacementMemoryId('');
  }, [supersedeTarget?.index.memoryId]);

  useEffect(() => {
    setOffset(0);
    setLoaded({ filterKey, items: [], total: 0, nextOffset: null });
    setAwaitingGovernanceRefresh(false);
  }, [filterKey]);

  useEffect(() => {
    const page = governanceQuery.data;
    if (!page || page.pagination.offset !== offset || (awaitingGovernanceRefresh && (governanceQuery.isFetching || governanceQuery.isError))) return;
    setLoaded((current) => {
      const previous = current.filterKey === filterKey && offset > 0 ? current.items : [];
      const byMemoryId = new Map(previous.map((item) => [item.index.memoryId, item]));
      page.items.forEach((item) => byMemoryId.set(item.index.memoryId, item));
      return {
        filterKey,
        items: Array.from(byMemoryId.values()),
        total: page.total,
        nextOffset: page.pagination.nextOffset,
      };
    });
    if (awaitingGovernanceRefresh) setAwaitingGovernanceRefresh(false);
  }, [awaitingGovernanceRefresh, filterKey, governanceQuery.data, governanceQuery.isError, governanceQuery.isFetching, offset]);

  const loadNextPage = () => {
    if (activeLoaded?.nextOffset === null || activeLoaded?.nextOffset === undefined) return;
    if (offset === activeLoaded.nextOffset) {
      void governanceQuery.refetch();
      return;
    }
    setOffset(activeLoaded.nextOffset);
  };

  const executeAction = async (target: MemoryGovernanceRecord, action: MemoryGovernanceAction, replacementId?: string) => {
    setActionError(null);
    const input: MemoryV2GovernanceActionInput = {
      action,
      memoryId: target.index.memoryId,
      expectedDetailVersion: target.index.detailVersion,
      expectedFingerprint: target.index.fingerprint,
      ...(replacementId ? { replacementMemoryId: replacementId } : {}),
      ...(action === 'reclassify' ? { requestedRetention: 'short' } : {}),
    };
    try {
      const response = await actionMutation.mutateAsync(input);
      toast('success', `已${actionLabel(action)}该长期记忆。当前状态：${statusLabel(response.result.status)}。`);
      setAwaitingGovernanceRefresh(true);
      setOffset(0);
      setLoaded({ filterKey, items: [], total: 0, nextOffset: null });
      setActionTarget(null);
      setSupersedeTarget(null);
    } catch (error) {
      const message = getErrorMessage(error, '治理操作失败。');
      setActionError(message);
      toast('error', message);
    }
  };

  const openAction = (record: MemoryGovernanceRecord, action: Exclude<MemoryGovernanceAction, 'supersede'>) => {
    setActionError(null);
    setActionTarget({ record, action });
  };

  return (
    <TooltipProvider delayDuration={240}>
      <section className="space-y-4" aria-labelledby="memory-v2-governance-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 id="memory-v2-governance-title" className="text-base font-semibold text-foreground">Memory V2 治理</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">列表只展示索引、交接与审计元数据；详情仅在明确打开后按版本分页读取。</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="刷新治理列表"
                disabled={governanceQuery.isFetching}
                onClick={() => void governanceQuery.refetch()}
              >
                <RefreshCw className={governanceQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新治理列表</TooltipContent>
          </Tooltip>
        </div>

        <div className="grid gap-4 border-b border-border pb-4 lg:grid-cols-2">
          <fieldset className="min-w-0">
            <legend className="text-xs font-medium text-muted-foreground">保留类型</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {RETENTION_OPTIONS.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={isSelected(retentions, option.value)}
                    onCheckedChange={() => setRetentions((current) => toggleSelection(current, RETENTION_OPTIONS.map((item) => item.value), option.value))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className="text-xs font-medium text-muted-foreground">生命周期状态</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {STATUS_OPTIONS.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={isSelected(statuses, option.value)}
                    onCheckedChange={() => setStatuses((current) => toggleSelection(current, STATUS_OPTIONS.map((item) => item.value), option.value))}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {(governanceQuery.isLoading || (awaitingGovernanceRefresh && governanceQuery.isFetching)) && allRecords.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">正在加载治理索引...</div>
        ) : null}
        {governanceQuery.isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <span>{getErrorMessage(governanceQuery.error, '治理索引加载失败。')}</span>
            <Button type="button" variant="outline" size="sm" disabled={governanceQuery.isFetching} onClick={() => void governanceQuery.refetch()}>
              <RefreshCw className={governanceQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              重试读取
            </Button>
          </div>
        ) : null}
        {!governanceQuery.isLoading && !governanceQuery.isError && !awaitingGovernanceRefresh && allRecords.length === 0 ? (
          <EmptyState title="没有匹配的记忆索引" description="调整保留类型或生命周期状态后再查看。" />
        ) : null}
        {allRecords.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>当前加载 {allRecords.length} 条，共 {activeLoaded?.total || 0} 条。</span>
              <span>长期待审核项可执行带审计的生命周期操作。</span>
            </div>
            {allRecords.map((record) => (
              <GovernanceRecord
                key={record.index.memoryId}
                record={record}
                onReadDetails={(item) => setDetailTarget({
                  memoryId: item.index.memoryId,
                  detailVersion: item.index.detailVersion,
                  summary: item.index.summary,
                })}
                onAction={openAction}
                onSupersede={(item) => {
                  setActionError(null);
                  setSupersedeTarget(item);
                }}
              />
            ))}
            {activeLoaded?.nextOffset !== null && activeLoaded?.nextOffset !== undefined ? (
              <div className="flex justify-center py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={governanceQuery.isFetching}
                  onClick={loadNextPage}
                >
                  <ChevronDown className="h-4 w-4" />
                  {governanceQuery.isFetching ? '加载中...' : governanceQuery.isError && offset === activeLoaded.nextOffset ? '重试加载更多' : '加载更多索引'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <section className="border-t border-border pt-4" aria-labelledby="memory-v2-audit-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 id="memory-v2-audit-title" className="text-sm font-semibold text-foreground">最近审计记录</h3>
              <p className="mt-1 text-xs text-muted-foreground">审计只包含已许可的动作与索引元数据，不展示详情正文。</p>
            </div>
            <span className="text-xs text-muted-foreground">{governanceQuery.data?.audit.length || 0} 条</span>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {(governanceQuery.data?.audit || []).length ? (governanceQuery.data?.audit || []).map((audit) => (
              <div key={audit.id} className="grid gap-1 px-1 py-3 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-foreground">
                    <StatusPill tone="neutral" dot={false}>{audit.action}</StatusPill>
                    <span className="break-all">{audit.memoryId ? compactId(audit.memoryId) : '系统事件'}</span>
                    {audit.metadata.status ? <span>{statusLabel(audit.metadata.status)}</span> : null}
                    {audit.metadata.requestedRetention ? <span>目标：{audit.metadata.requestedRetention}</span> : null}
                  </div>
                  {audit.reason ? <div className="mt-1 break-words text-muted-foreground">{audit.reason}</div> : null}
                </div>
                <div className="text-muted-foreground">{formatTimestamp(audit.createdAt)}</div>
              </div>
            )) : (
              <div className="px-1 py-4 text-sm text-muted-foreground">暂无审计记录。</div>
            )}
          </div>
        </section>
      </section>

      <ConfirmModal
        open={Boolean(actionTarget)}
        variant={actionTarget?.action === 'reject' ? 'delete' : actionTarget?.action === 'expire' ? 'archive' : 'default'}
        title={actionTarget ? `${actionLabel(actionTarget.action)}长期记忆` : '长期记忆操作'}
        objectName={actionTarget?.record.index.summary || actionTarget?.record.index.memoryId}
        consequence={actionTarget ? (
          <div className="space-y-2">
            <p>{actionDescription(actionTarget.action)}</p>
            {actionError ? <p className="text-destructive">{actionError}</p> : null}
          </div>
        ) : ''}
        confirmLabel={actionTarget ? actionLabel(actionTarget.action) : '确认'}
        loading={actionMutation.isPending}
        onOpenChange={(open) => {
          if (!open && !actionMutation.isPending) {
            setActionTarget(null);
            setActionError(null);
          }
        }}
        onConfirm={async () => {
          if (!actionTarget) return;
          await executeAction(actionTarget.record, actionTarget.action);
        }}
      />

      <Dialog open={Boolean(supersedeTarget)} onOpenChange={(open) => {
        if (!open && !actionMutation.isPending) {
          setSupersedeTarget(null);
          setActionError(null);
        }
      }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
          <DialogHeader>
            <DialogTitle>替代长期记忆</DialogTitle>
            <DialogDescription>{supersedeTarget ? actionDescription('supersede') : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm text-foreground">
              {supersedeTarget?.index.summary || supersedeTarget?.index.memoryId}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground" htmlFor="memory-v2-replacement">替代索引</label>
              <Select value={replacementMemoryId} onValueChange={setReplacementMemoryId}>
                <SelectTrigger id="memory-v2-replacement"><SelectValue placeholder="选择已加载的候选索引" /></SelectTrigger>
                <SelectContent>
                  {replacementOptions.map((candidate) => (
                    <SelectItem key={candidate.index.memoryId} value={candidate.index.memoryId}>
                      {candidate.index.summary || compactId(candidate.index.memoryId)} · {statusLabel(candidate.index.status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs leading-5 text-muted-foreground">可按页加载同一所有者和保留类型的候选索引；服务端会再次验证可替代性。</p>
              {activeLoaded?.nextOffset !== null && activeLoaded?.nextOffset !== undefined ? (
                <Button type="button" variant="outline" size="sm" disabled={governanceQuery.isFetching} onClick={loadNextPage}>
                  <ChevronDown className="h-4 w-4" />
                  {governanceQuery.isFetching ? '加载中...' : governanceQuery.isError && offset === activeLoaded.nextOffset ? '重试加载更多候选' : '加载更多候选索引'}
                </Button>
              ) : null}
              {!replacementOptions.length ? <p className="text-xs text-destructive">当前筛选范围没有可选替代索引。</p> : null}
              {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={actionMutation.isPending} onClick={() => setSupersedeTarget(null)}>取消</Button>
            <Button
              type="button"
              disabled={!supersedeTarget || !replacementMemoryId || actionMutation.isPending}
              onClick={() => {
                if (!supersedeTarget || !replacementMemoryId) return;
                void executeAction(supersedeTarget, 'supersede', replacementMemoryId);
              }}
            >
              {actionMutation.isPending ? '处理中...' : '确认替代'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <GovernanceDetailDrawer target={detailTarget} onOpenChange={(open) => {
        if (!open) setDetailTarget(null);
      }} />
    </TooltipProvider>
  );
}
