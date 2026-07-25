'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Eye, LockKeyhole, RefreshCw, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/client/query/query-client';
import {
  useWorkflowMemoryHandoffDetailQuery,
  useWorkflowMemoryHandoffsQuery,
  type WorkflowMemoryHandoff,
  type WorkflowMemoryHandoffBatch,
  type WorkflowMemoryHandoffDetailParams,
  type WorkflowMemoryHandoffReadState,
} from '@/client/query/memory-v2';
import type { MemoryDetailPage } from '@/lib/memory-v2';

type HandoffDetailTarget = {
  runId: string;
  handoff: WorkflowMemoryHandoff;
};

type LoadedHandoffPages = {
  runId: string;
  state: 'available' | 'uninitialized' | null;
  items: WorkflowMemoryHandoffBatch[];
  total: number;
  nextOffset: number | null;
  totals?: {
    batches: number;
    handoffs: number;
    receipts: number;
  };
};

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    if (error.status === 403) return '当前账户无权查看该运行的交接索引或详情。';
    if (error.status === 404) return '该运行记录已不存在或当前账户无权访问。';
    if (error.status === 409) return 'Memory V2 尚未完成初始化，暂不能读取该运行的交接状态。';
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

function handoffStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'accent' {
  if (status === 'resolved' || status === 'emitted') return 'success';
  if (status === 'pending' || status === 'retrying') return 'warning';
  if (status === 'failed') return 'danger';
  if (status === 'superseded') return 'accent';
  return 'neutral';
}

function handoffStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: '待处理',
    resolved: '已解析',
    cancelled: '已取消',
    failed: '失败',
    'no-op': '无交接',
    emitted: '已发出',
    retrying: '重试中',
    superseded: '已替代',
  };
  return labels[status] || status;
}

function readStateTone(state: WorkflowMemoryHandoffReadState['state']): 'neutral' | 'success' | 'warning' | 'info' | 'danger' {
  if (state === 'acknowledged') return 'success';
  if (state === 'pending' || state === 'unread') return 'warning';
  if (state === 'blocked') return 'danger';
  return 'neutral';
}

function readStateLabel(readState: WorkflowMemoryHandoffReadState) {
  if (!readState.required) return '非必读';
  const labels: Record<WorkflowMemoryHandoffReadState['state'], string> = {
    'not-required': '非必读',
    acknowledged: '必读已确认',
    pending: '必读待处理',
    unread: '必读未读',
    blocked: '必读已阻断',
  };
  return labels[readState.state];
}

function pageKey(page: MemoryDetailPage) {
  return `${page.memoryId}:${page.detailVersion}:${page.cursor || 'first'}`;
}

function HandoffDetailDrawer({
  target,
  onOpenChange,
}: {
  target: HandoffDetailTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const targetKey = target ? `${target.runId}:${target.handoff.id}:${target.handoff.detailVersion}` : '';
  const mayRead = target?.handoff.detailAccess.state === 'allowed';
  const [cursor, setCursor] = useState<string | undefined>();
  const [pageState, setPageState] = useState<{ key: string; pages: MemoryDetailPage[] }>({ key: '', pages: [] });
  const activeCursor = pageState.key === targetKey ? cursor : undefined;
  const request: WorkflowMemoryHandoffDetailParams | null = target && mayRead ? {
    runId: target.runId,
    handoffId: target.handoff.id,
    detailVersion: target.handoff.detailVersion,
    ...(activeCursor ? { cursor: activeCursor } : {}),
    maxChars: 4_000,
  } : null;
  const detailQuery = useWorkflowMemoryHandoffDetailQuery(request, mayRead);
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

  const deniedReason = target?.handoff.detailAccess.state === 'denied'
    ? '该交接详情只允许此运行的所有者或系统管理员按版本读取。'
    : null;

  return (
    <DetailDrawer open={Boolean(target)} onOpenChange={onOpenChange}>
      <DetailDrawerContent widthClassName="w-[min(760px,calc(100vw-1rem))]">
        <DetailDrawerHeader>
          <DetailDrawerTitle>交接详情</DetailDrawerTitle>
          <DetailDrawerDescription>
            {target ? `交接 ${compactId(target.handoff.id)} · 详情版本 ${target.handoff.detailVersion}` : '按需读取交接时冻结的详情版本。'}
          </DetailDrawerDescription>
        </DetailDrawerHeader>
        <DetailDrawerBody className="space-y-4">
          {deniedReason ? (
            <div className="flex items-start gap-2 border border-amber-300/50 bg-amber-50/50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{deniedReason}</span>
            </div>
          ) : null}
          {detailQuery.isLoading && !deniedReason && pages.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">正在读取冻结详情版本...</div>
          ) : null}
          {detailQuery.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <span>{getErrorMessage(detailQuery.error, '交接详情读取失败。')}</span>
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
              {pages.length > 1 ? <div className="text-xs font-medium text-muted-foreground">详情片段 {index + 1}</div> : null}
              <pre className="max-h-[52vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/25 p-3 text-sm leading-6 text-foreground">
                {page.details}
              </pre>
              <div className="text-xs text-muted-foreground">本页 {page.detailChars} 字符</div>
            </section>
          ))}
          {!deniedReason && !detailQuery.isLoading && !detailQuery.isError && pages.length === 0 ? (
            <EmptyState title="暂无详情页" description="该交接版本没有返回可显示内容。" />
          ) : null}
        </DetailDrawerBody>
        <DetailDrawerFooter>
          {lastPage?.nextCursor && !deniedReason ? (
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
          {lastPage?.complete && !deniedReason ? <span className="text-xs text-muted-foreground">已读取该冻结版本的全部详情</span> : null}
        </DetailDrawerFooter>
      </DetailDrawerContent>
    </DetailDrawer>
  );
}

function HandoffItem({ handoff, onReadDetail }: { handoff: WorkflowMemoryHandoff; onReadDetail: () => void }) {
  const snapshot = handoff.indexSnapshot;
  const sourceText = snapshot ? [
    snapshot.source.sourceAgentId ? `Agent ${snapshot.source.sourceAgentId}` : null,
    snapshot.source.sourceStepAttemptId ? `步骤 ${snapshot.source.sourceStepAttemptId}` : null,
    snapshot.source.sourceRunId ? `运行 ${snapshot.source.sourceRunId}` : null,
  ].filter(Boolean).join(' · ') : '';
  const hasDeniedDetail = handoff.detailAccess.state !== 'allowed';

  return (
    <article className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="break-words text-sm font-semibold text-foreground">{snapshot?.summary || `记忆 ${compactId(handoff.memoryId)}`}</h4>
            {snapshot ? (
              <StatusPill tone={snapshot.retention === 'long' ? 'accent' : 'info'}>{snapshot.retention === 'long' ? '长期' : '短期'}</StatusPill>
            ) : <StatusPill tone="neutral" dot={false}>无冻结快照</StatusPill>}
            <StatusPill tone={handoffStatusTone(handoff.status)}>{handoffStatusLabel(handoff.status)}</StatusPill>
            <StatusPill tone={readStateTone(handoff.readState.state)}>{readStateLabel(handoff.readState)}</StatusPill>
          </div>
          {snapshot?.readWhen.text ? <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{snapshot.readWhen.text}</p> : null}
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={onReadDetail}>
          {hasDeniedDetail ? <LockKeyhole className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {hasDeniedDetail ? '详情受限' : '读取详情'}
        </Button>
      </div>

      {hasDeniedDetail ? (
        <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>索引可见，但详情读取受限于运行所有者或管理员权限。</span>
        </div>
      ) : null}

      <dl className="mt-4 grid gap-x-5 gap-y-3 border-y border-border py-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-muted-foreground">交接方式</dt>
          <dd className="mt-1 break-words text-foreground">{handoff.mode} / {handoff.target.target}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">详情版本</dt>
          <dd className="mt-1 text-foreground">v{handoff.detailVersion}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">冻结索引字符</dt>
          <dd className="mt-1 text-foreground">{snapshot?.indexChars ?? '-'}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">来源</dt>
          <dd className="mt-1 break-words text-foreground">{sourceText || '-'}</dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">解析目标</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {handoff.resolvedTargets.length ? handoff.resolvedTargets.map((target) => (
              <span key={`${target.targetStepAttemptId}:${target.targetAgentId}`} className="max-w-full break-all rounded-md border border-border bg-muted/25 px-2 py-1 text-xs text-foreground">
                {target.targetStepAttemptId} · {target.targetAgentId}
              </span>
            )) : <span className="text-xs text-muted-foreground">尚未解析到目标。</span>}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">回执与读取状态</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {handoff.receipts.length ? handoff.receipts.map((receipt) => (
              <span key={`${receipt.targetStepAttemptId}:${receipt.targetAgentId}:${receipt.detailVersion}`} className="max-w-full break-all rounded-md border border-border bg-muted/25 px-2 py-1 text-xs text-foreground">
                {receipt.targetStepAttemptId} · {handoffStatusLabel(receipt.status)}
              </span>
            )) : <span className="text-xs text-muted-foreground">尚无回执。</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

function HandoffBatch({ batch, onReadDetail }: { batch: WorkflowMemoryHandoffBatch; onReadDetail: (handoff: WorkflowMemoryHandoff) => void }) {
  return (
    <section className="border border-border bg-card px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-all text-sm font-semibold text-foreground">来源步骤：{batch.sourceStepAttemptId}</h3>
            <StatusPill tone={handoffStatusTone(batch.status)}>{handoffStatusLabel(batch.status)}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">批次 {compactId(batch.id)} · 更新于 {formatTimestamp(batch.updatedAt)}</p>
        </div>
        <span className="text-xs text-muted-foreground">{batch.handoffs.length} 条交接</span>
      </div>
      <div className="mt-4 space-y-4">
        {batch.handoffs.length ? batch.handoffs.map((handoff) => (
          <HandoffItem key={handoff.id} handoff={handoff} onReadDetail={() => onReadDetail(handoff)} />
        )) : <div className="text-sm text-muted-foreground">该批次没有匹配当前筛选条件的交接索引。</div>}
      </div>
    </section>
  );
}

export function WorkflowMemoryHandoffPanel({ runId }: { runId: string | null | undefined }) {
  const [offset, setOffset] = useState(0);
  const [loaded, setLoaded] = useState<LoadedHandoffPages>({
    runId: '',
    state: null,
    items: [],
    total: 0,
    nextOffset: null,
  });
  const [detailTarget, setDetailTarget] = useState<HandoffDetailTarget | null>(null);
  const handoffsQuery = useWorkflowMemoryHandoffsQuery(runId, { offset, limit: 30 });

  useEffect(() => {
    setOffset(0);
    setLoaded({ runId: runId || '', state: null, items: [], total: 0, nextOffset: null });
    setDetailTarget(null);
  }, [runId]);

  useEffect(() => {
    const page = handoffsQuery.data;
    if (!page || !runId || page.runId !== runId || page.pagination.offset !== offset) return;
    setLoaded((current) => {
      const previous = current.runId === runId && offset > 0 ? current.items : [];
      const byId = new Map(previous.map((item) => [item.id, item]));
      page.items.forEach((item) => byId.set(item.id, item));
      return {
        runId,
        state: page.state,
        items: Array.from(byId.values()),
        total: page.pagination.total,
        nextOffset: page.pagination.nextOffset,
        totals: page.totals,
      };
    });
  }, [handoffsQuery.data, offset, runId]);

  const activeLoaded = loaded.runId === (runId || '') ? loaded : null;

  return (
    <TooltipProvider delayDuration={240}>
      <section className="flex h-full min-h-0 flex-col space-y-4 overflow-y-auto p-4" aria-labelledby="workflow-memory-handoffs-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 id="workflow-memory-handoffs-title" className="text-base font-semibold text-foreground">记忆交接</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">查看当前运行中冻结的交接索引、目标、回执与必读状态；详情只在明确请求时读取。</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="刷新当前交接页"
                disabled={!runId || handoffsQuery.isFetching}
                onClick={() => void handoffsQuery.refetch()}
              >
                <RefreshCw className={handoffsQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新当前交接页</TooltipContent>
          </Tooltip>
        </div>

        {!runId ? (
          <EmptyState title="尚未选择运行记录" description="从运行记录中选择一次实际运行后，可查看该运行的 Memory V2 交接状态。" />
        ) : null}
        {runId && handoffsQuery.isLoading && !activeLoaded?.items.length ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">正在加载交接索引...</div>
        ) : null}
        {runId && handoffsQuery.isError ? (
          <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {getErrorMessage(handoffsQuery.error, '交接索引加载失败。')}
          </div>
        ) : null}
        {runId && activeLoaded?.state === 'uninitialized' ? (
          <EmptyState title="该运行尚未初始化交接状态" description="Memory V2 没有为此运行建立可用的交接索引。" />
        ) : null}
        {runId && activeLoaded?.state === 'available' && activeLoaded.items.length === 0 ? (
          <EmptyState title="没有交接索引" description="该运行目前没有已发出的 Memory V2 交接批次。" />
        ) : null}
        {runId && activeLoaded?.state === 'available' && activeLoaded.items.length ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>已加载 {activeLoaded.items.length}/{activeLoaded.total} 个批次。</span>
              {activeLoaded.totals ? <span>交接 {activeLoaded.totals.handoffs} · 回执 {activeLoaded.totals.receipts}</span> : null}
            </div>
            {activeLoaded.items.map((batch) => (
              <HandoffBatch
                key={batch.id}
                batch={batch}
                onReadDetail={(handoff) => setDetailTarget({ runId: activeLoaded.runId, handoff })}
              />
            ))}
            {activeLoaded.nextOffset !== null ? (
              <div className="flex justify-center py-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={handoffsQuery.isFetching}
                  onClick={() => setOffset(activeLoaded.nextOffset || 0)}
                >
                  <ChevronDown className="h-4 w-4" />
                  {handoffsQuery.isFetching ? '加载中...' : '加载更多批次'}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <HandoffDetailDrawer target={detailTarget} onOpenChange={(open) => {
        if (!open) setDetailTarget(null);
      }} />
    </TooltipProvider>
  );
}
