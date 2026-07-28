'use client';

import { RefreshCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusPill } from '@/components/ui/status-pill';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiError } from '@/client/query/query-client';
import { useMemoryV2DiagnosticsQuery, type MemoryV2Diagnostics } from '@/client/query/memory-v2';

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 403) return '当前账户没有查看 Memory V2 诊断信息的权限。';
  return error instanceof Error && error.message ? error.message : '诊断信息加载失败。';
}

function metricValue(value: number | undefined) {
  return Number.isFinite(value) ? String(value) : '-';
}

function Metric({ label, value, description }: { label: string; value: number | string | undefined; description?: string }) {
  return (
    <div className="border border-border bg-card px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold tabular-nums text-foreground">{typeof value === 'number' ? metricValue(value) : value || '-'}</div>
      {description ? <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div> : null}
    </div>
  );
}

function DiagnosticsContent({ diagnostics }: { diagnostics: MemoryV2Diagnostics }) {
  const { status, telemetry, budgets, store, legacyZeroAccess } = diagnostics;
  const receiptTelemetry = telemetry.handoffs.receipts;

  return (
    <div className="space-y-5">
      <section className="border-b border-border pb-4" aria-labelledby="memory-v2-cutover-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 id="memory-v2-cutover-title" className="text-sm font-semibold text-foreground">切换状态</h3>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">仅展示空库、归档元数据和零访问校验结果，不读取旧记忆内容。</p>
          </div>
          <StatusPill tone={status.ready ? 'success' : status.enabled ? 'warning' : 'neutral'}>
            {status.ready ? '已就绪' : status.enabled ? '初始化未完成' : '未启用'}
          </StatusPill>
        </div>
        {status.reason ? (
          <div className="mt-3 flex items-start gap-2 border border-amber-300/50 bg-amber-50/50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{status.reason}</span>
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="索引行" value={store?.itemCount ?? status.itemCount} />
          <Metric label="详情行" value={store?.detailCount ?? status.detailCount} />
          <Metric label="归档登记" value={store?.archiveRegistry.count ?? status.archiveRegistryCount} />
          <Metric label="旧内容访问" value={legacyZeroAccess.contentReadsAllowed ? '允许' : '禁止'} description={`拒绝尝试 ${legacyZeroAccess.deniedAttempts}`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <StatusPill tone={legacyZeroAccess.verified ? 'success' : 'warning'}>
            {legacyZeroAccess.verified ? '旧内容零访问已校验' : '旧内容零访问待校验'}
          </StatusPill>
          {store ? (
            <StatusPill tone={store.archiveRegistry.pendingVerificationCount === 0 ? 'success' : 'warning'}>
              归档校验：{store.archiveRegistry.verifiedNoAccessCount}/{store.archiveRegistry.count}
            </StatusPill>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="memory-v2-budget-title">
        <div>
          <h3 id="memory-v2-budget-title" className="text-sm font-semibold text-foreground">服务器预算</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">这些是服务端执行的字符上限；客户端不通过诊断接口获取任何记忆正文。</p>
        </div>
        {budgets ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Metric label="摘要上限" value={budgets.maxSummaryChars} />
            <Metric label="读取条件上限" value={budgets.maxReadWhenChars} />
            <Metric label="索引项上限" value={budgets.maxIndexItemChars} />
            <Metric label="默认清单上限" value={budgets.maxManifestChars} />
            <Metric label="搜索索引上限" value={budgets.maxSearchIndexChars} />
            <Metric label="详情页上限" value={budgets.maxDetailReadChars} />
            <Metric label="必读索引上限" value={budgets.maxRequiredReadIndexChars} />
            <Metric label="必读摘录上限" value={budgets.maxRequiredReadExtractChars} />
            <Metric label="详情存储上限" value={budgets.maxDetailChars} />
            <Metric label="FTS 投影上限" value={budgets.maxFtsProjectionChars} />
          </div>
        ) : <div className="mt-3 text-sm text-muted-foreground">Memory V2 未就绪，暂没有可用预算。</div>}
      </section>

      <section aria-labelledby="memory-v2-payload-title">
        <div>
          <h3 id="memory-v2-payload-title" className="text-sm font-semibold text-foreground">索引与详情读取</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">计数用于确认默认清单、搜索和交接载荷保持索引化与受预算控制。</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="清单请求" value={telemetry.manifest.calls} />
          <Metric label="清单返回项" value={telemetry.manifest.returnedItems} />
          <Metric label="清单省略项" value={telemetry.manifest.omittedItems} />
          <Metric label="清单总字符" value={telemetry.manifest.totalSerializedChars} description={`单次最高 ${telemetry.manifest.maxSerializedChars}`} />
          <Metric label="搜索请求" value={telemetry.search.calls} />
          <Metric label="搜索返回项" value={telemetry.search.returnedItems} />
          <Metric label="搜索省略项" value={telemetry.search.omittedItems} />
          <Metric label="搜索总字符" value={telemetry.search.totalSerializedChars} description={`单次最高 ${telemetry.search.maxSerializedChars}`} />
          <Metric label="详情页读取" value={telemetry.detailReadMetrics.pages} />
          <Metric label="详情返回字符" value={telemetry.detailReadMetrics.returnedChars} />
          <Metric label="必读详情页" value={telemetry.detailReadMetrics.requiredReadPages} />
          <Metric label="被阻断必读" value={telemetry.detailReadMetrics.blockedRequiredReads} />
        </div>
      </section>

      <section aria-labelledby="memory-v2-handoff-title">
        <div>
          <h3 id="memory-v2-handoff-title" className="text-sm font-semibold text-foreground">交接与回执</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">显示工作流交接的运行态统计，不包含交接详情或原始输出。</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="运行态重建" value={telemetry.handoffs.runStateReconstructions} />
          <Metric label="已发出批次" value={telemetry.handoffs.batchesEmitted} />
          <Metric label="必读预算失败" value={telemetry.handoffs.requiredReadBudgetFailures} />
          <Metric label="待处理回执" value={receiptTelemetry.pending} />
          <Metric label="已读回执" value={receiptTelemetry.read} />
          <Metric label="已确认回执" value={receiptTelemetry.acknowledged} />
          <Metric label="失败回执" value={receiptTelemetry.failed} />
          <Metric label="取消 / 重试回执" value={`${receiptTelemetry.cancelled} / ${receiptTelemetry.retrying}`} />
        </div>
      </section>

      <section aria-labelledby="memory-v2-policy-title">
        <div>
          <h3 id="memory-v2-policy-title" className="text-sm font-semibold text-foreground">生命周期与授权信号</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">汇总审核写入、重复合并和明确读取拒绝，便于观察切换后的行为趋势。</p>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="创建 / 更新" value={`${telemetry.writes.creates} / ${telemetry.writes.upserts}`} />
          <Metric label="解决 / 丢弃" value={`${telemetry.writes.resolves} / ${telemetry.writes.discards}`} />
          <Metric label="拒绝 / 重复合并" value={`${telemetry.writes.rejected} / ${telemetry.writes.duplicateMerges}`} />
          <Metric label="治理操作" value={telemetry.governanceActions} description={`失败 ${telemetry.governanceActionFailures}`} />
          <Metric label="显式详情拒绝" value={telemetry.authorization.explicitReadDenied} />
          <Metric label="搜索拒绝" value={telemetry.authorization.searchDenied} />
          <Metric label="旧内容拒绝" value={telemetry.legacyContentAccessDenied} />
          <Metric label="新库初始化" value={telemetry.freshStartInitializations} description={`失败 ${telemetry.freshStartInitializationFailures}`} />
        </div>
      </section>
    </div>
  );
}

export function MemoryV2DiagnosticsPanel() {
  const diagnosticsQuery = useMemoryV2DiagnosticsQuery();

  return (
    <TooltipProvider delayDuration={240}>
      <section className="space-y-4" aria-labelledby="memory-v2-diagnostics-title">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 id="memory-v2-diagnostics-title" className="text-base font-semibold text-foreground">Memory V2 诊断与切换</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">用于核对预算、索引载荷、交接回执和新库切换状态。</p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8"
                aria-label="刷新 Memory V2 诊断"
                disabled={diagnosticsQuery.isFetching}
                onClick={() => void diagnosticsQuery.refetch()}
              >
                <RefreshCw className={diagnosticsQuery.isFetching ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>刷新诊断</TooltipContent>
          </Tooltip>
        </div>
        {diagnosticsQuery.isLoading ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">正在加载诊断信息...</div>
        ) : null}
        {diagnosticsQuery.isError ? (
          <div className="border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{getErrorMessage(diagnosticsQuery.error)}</div>
        ) : null}
        {diagnosticsQuery.data ? <DiagnosticsContent diagnostics={diagnosticsQuery.data} /> : null}
        {!diagnosticsQuery.isLoading && !diagnosticsQuery.isError && !diagnosticsQuery.data ? (
          <EmptyState icon={<ShieldCheck className="h-5 w-5" />} title="暂无诊断结果" description="刷新后将显示 Memory V2 的当前切换状态。" />
        ) : null}
      </section>
    </TooltipProvider>
  );
}
