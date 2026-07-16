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

function timestampMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
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
