import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import {
  startSystemSuspendTracker,
  stopSystemSuspendTracker,
  getSuspendedMs,
  markSuspendCheckpoint,
  suspendedSince,
  __resetSystemSuspendTrackerForTest,
  __simulateSuspendForTest,
} from '@/lib/core/system-suspend-tracker';

// 回归背景：步骤时长取自引擎上报的墙钟 duration_ms。机器睡眠期间引擎照常计时，
// 实测一次 `代码实现-编码实施` 被记成 743.6 分钟且状态 completed，而模型实际只
// 工作了约 12 分钟（Windows 事件确认 20:59:46 睡、09:11:45 醒）。
describe('系统挂起检测', () => {
  beforeEach(() => __resetSystemSuspendTrackerForTest());
  afterEach(() => __resetSystemSuspendTrackerForTest());

  test('没有跳变时不累计挂起时长', () => {
    startSystemSuspendTracker();
    expect(getSuspendedMs()).toBe(0);
  });

  test('普通抖动不算挂起', () => {
    startSystemSuspendTracker();
    // 心跳间隔 1 秒，3 秒的抖动仍在容忍范围内（阈值是 5 倍）。
    __simulateSuspendForTest(3_000);
    expect(getSuspendedMs()).toBe(0);
  });

  test('长时间跳变计入挂起，且只算超出正常间隔的部分', () => {
    startSystemSuspendTracker();
    __simulateSuspendForTest(60_000);
    // 扣掉一个正常的心跳间隔
    expect(getSuspendedMs()).toBe(59_000);
  });

  test('多次挂起累加', () => {
    startSystemSuspendTracker();
    __simulateSuspendForTest(30_000);
    __simulateSuspendForTest(20_000);
    expect(getSuspendedMs()).toBe(29_000 + 19_000);
  });

  test('checkpoint 只统计区间内的挂起', () => {
    startSystemSuspendTracker();
    __simulateSuspendForTest(30_000);   // 区间之前发生的，不该算进来
    const checkpoint = markSuspendCheckpoint();
    __simulateSuspendForTest(45_000);
    expect(suspendedSince(checkpoint)).toBe(44_000);
  });

  test('区间内没有挂起时返回 0', () => {
    startSystemSuspendTracker();
    const checkpoint = markSuspendCheckpoint();
    expect(suspendedSince(checkpoint)).toBe(0);
  });

  test('复现那次 12.2 小时睡眠：扣掉后只剩真实工作时间', () => {
    startSystemSuspendTracker();
    const checkpoint = markSuspendCheckpoint();
    const sleptMs = 732 * 60_000;           // 实测静默 732 分钟
    __simulateSuspendForTest(sleptMs);
    const reportedMs = 743.6 * 60_000;      // 引擎上报的墙钟
    const actual = reportedMs - suspendedSince(checkpoint);
    // 真实工作时间约 12 分钟（睡前 7 分 + 醒后 5 分）
    expect(actual / 60_000).toBeGreaterThan(10);
    expect(actual / 60_000).toBeLessThan(14);
  });

  test('重复启动是幂等的', () => {
    startSystemSuspendTracker();
    startSystemSuspendTracker();
    stopSystemSuspendTracker();
    expect(getSuspendedMs()).toBe(0);
  });
});
