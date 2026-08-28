/**
 * 系统挂起（睡眠/休眠）检测。
 *
 * 背景：步骤时长来自引擎上报的 `duration_ms`，那是墙钟时间。机器一旦睡眠，
 * 引擎的计时照走，醒来后一次调用会被记成十几个小时。实测过一次：机器
 * 20:59 睡、09:11 醒，模型实际只工作了约 12 分钟，却被记成 743.6 分钟且
 * 状态标为 completed。
 *
 * 为什么不能用「流静默」判断：模型生成工具参数期间本来就不发 chunk，
 * 单次静默 277 秒是正常的。按静默扣时会把正常生成误判成挂起。
 *
 * 做法：跑一个固定间隔的心跳。事件循环在等待引擎响应时是空闲的，心跳照常
 * 触发；只有进程真被系统挂起才会出现远超间隔的跳变。把这段跳变计入挂起时长。
 */

const TICK_MS = 1_000;
/** 超过这个倍数才算挂起，避免把 GC 暂停、负载抖动误判进去。 */
const SUSPEND_FACTOR = 5;

let timer: NodeJS.Timeout | null = null;
let lastTickAt = Date.now();
let totalSuspendedMs = 0;

function tick(): void {
  const now = Date.now();
  const drift = now - lastTickAt;
  lastTickAt = now;
  if (drift > TICK_MS * SUSPEND_FACTOR) {
    // 只计入超出正常间隔的部分。
    totalSuspendedMs += drift - TICK_MS;
  }
}

/** 幂等；进程内只会有一个心跳。 */
export function startSystemSuspendTracker(): void {
  if (timer) return;
  lastTickAt = Date.now();
  timer = setInterval(tick, TICK_MS);
  // 不要因为这个心跳而拖住进程退出。
  timer.unref?.();
}

export function stopSystemSuspendTracker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** 进程启动以来累计的挂起毫秒数，单调不减。 */
export function getSuspendedMs(): number {
  return totalSuspendedMs;
}

/**
 * 圈定一段区间，返回该区间内的挂起时长。
 * 用法：`const since = markSuspendCheckpoint(); ... ; const slept = suspendedSince(since);`
 */
export function markSuspendCheckpoint(): number {
  startSystemSuspendTracker();
  return totalSuspendedMs;
}

export function suspendedSince(checkpoint: number): number {
  return Math.max(0, totalSuspendedMs - checkpoint);
}

/** 仅供测试：重置内部状态。 */
export function __resetSystemSuspendTrackerForTest(): void {
  stopSystemSuspendTracker();
  lastTickAt = Date.now();
  totalSuspendedMs = 0;
}

/** 仅供测试：直接注入一次跳变，免得测试真的去睡。 */
export function __simulateSuspendForTest(driftMs: number): void {
  lastTickAt = Date.now() - driftMs;
  tick();
}
