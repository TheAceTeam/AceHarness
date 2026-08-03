export interface WorkflowRunTimingInput {
  startTime?: string | null;
  endTime?: string | null;
  nowMs?: number;
  accumulatedWaitMs?: number;
  waitStartedAt?: string | null;
}

export interface WorkflowRunTiming {
  totalMs: number;
  executionMs: number;
  waitMs: number;
  executionRatio: number;
  waitRatio: number;
  isWaiting: boolean;
}

export interface WorkflowRunTimingSource {
  id?: string | null;
  runId?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  updatedAt?: string | null;
  summary?: {
    endTime?: string | null;
  } | null;
}

export interface WorkflowOverviewTimingInput {
  actionRunId?: string | null;
  actionIsRunning: boolean;
  runtimeRunId?: string | null;
  runtimeStartTime?: string | null;
  runtimeEndTime?: string | null;
  status?: WorkflowRunTimingSource | null;
  historyRuns?: WorkflowRunTimingSource[] | null;
  runDetail?: WorkflowRunTimingSource | null;
  selectedRun?: WorkflowRunTimingSource | null;
}

export interface WorkflowOverviewTiming {
  startTime: string | null;
  endTime: string | null;
}

function timestampMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyTimestamp(...values: Array<string | null | undefined>): string | null {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) || null;
}

function timingSourceMatchesRun(source: WorkflowRunTimingSource | null | undefined, runId: string | null | undefined): boolean {
  if (!source) return false;
  if (!runId) return true;
  return [source.id, source.runId].some((value) => String(value || '') === runId);
}

/**
 * Select overview timestamps from run-scoped live and historical records.
 * A recorded end time stays authoritative even while a stale running status is
 * still being reconciled by the client.
 */
export function resolveWorkflowOverviewTiming({
  actionRunId,
  actionIsRunning,
  runtimeRunId,
  runtimeStartTime,
  runtimeEndTime,
  status,
  historyRuns,
  runDetail,
  selectedRun,
}: WorkflowOverviewTimingInput): WorkflowOverviewTiming {
  const matchingStatus = timingSourceMatchesRun(status, actionRunId) ? status : null;
  const matchingHistoryRun = (historyRuns || []).find((run) => timingSourceMatchesRun(run, actionRunId)) || null;
  const matchingRuntime = !actionRunId || String(runtimeRunId || '') === actionRunId;
  const matchingDetail = timingSourceMatchesRun(runDetail, actionRunId) ? runDetail : null;
  const matchingSelectedRun = timingSourceMatchesRun(selectedRun, actionRunId) ? selectedRun : null;

  const startTime = nonEmptyTimestamp(
    matchingStatus?.startTime,
    matchingHistoryRun?.startTime,
    matchingRuntime ? runtimeStartTime : null,
    matchingDetail?.startTime,
    matchingSelectedRun?.startTime,
  );
  const endTime = nonEmptyTimestamp(
    matchingStatus?.endTime,
    matchingHistoryRun?.endTime,
    matchingRuntime ? runtimeEndTime : null,
    matchingDetail?.endTime,
    matchingDetail?.summary?.endTime,
    matchingSelectedRun?.endTime,
    !actionIsRunning ? matchingDetail?.updatedAt : null,
    !actionIsRunning ? matchingSelectedRun?.updatedAt : null,
  );

  return { startTime, endTime };
}

/**
 * 将一次工作流的墙钟总历时拆分为实际运行与停摆等待。
 * accumulatedWaitMs 只包含已结束的等待区间，waitStartedAt 表示当前仍在进行的等待。
 */
export function calculateWorkflowRunTiming({
  startTime,
  endTime,
  nowMs = Date.now(),
  accumulatedWaitMs = 0,
  waitStartedAt,
}: WorkflowRunTimingInput): WorkflowRunTiming {
  const startMs = timestampMs(startTime);
  if (startMs === null) {
    return {
      totalMs: 0,
      executionMs: 0,
      waitMs: 0,
      executionRatio: 0,
      waitRatio: 0,
      isWaiting: false,
    };
  }

  const parsedEndMs = timestampMs(endTime);
  const effectiveEndMs = Math.max(startMs, parsedEndMs ?? nowMs);
  const totalMs = Math.max(0, effectiveEndMs - startMs);
  const waitStartMs = timestampMs(waitStartedAt);
  const activeWaitMs = waitStartMs === null
    ? 0
    : Math.max(0, effectiveEndMs - Math.max(startMs, waitStartMs));
  const completedWaitMs = Number.isFinite(accumulatedWaitMs) ? Math.max(0, accumulatedWaitMs) : 0;
  const waitMs = Math.min(totalMs, completedWaitMs + activeWaitMs);
  const executionMs = Math.max(0, totalMs - waitMs);

  return {
    totalMs,
    executionMs,
    waitMs,
    executionRatio: totalMs > 0 ? executionMs / totalMs : 0,
    waitRatio: totalMs > 0 ? waitMs / totalMs : 0,
    isWaiting: waitStartMs !== null,
  };
}
