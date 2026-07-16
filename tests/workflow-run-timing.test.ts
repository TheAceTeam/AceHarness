import { describe, expect, it } from 'vitest';
import { calculateWorkflowRunTiming } from '@/lib/workflow/run-timing';

describe('calculateWorkflowRunTiming', () => {
  it('separates completed wait time from execution time', () => {
    const timing = calculateWorkflowRunTiming({
      startTime: '2026-07-16T00:00:00.000Z',
      endTime: '2026-07-16T01:00:00.000Z',
      accumulatedWaitMs: 15 * 60 * 1000,
    });

    expect(timing.totalMs).toBe(60 * 60 * 1000);
    expect(timing.waitMs).toBe(15 * 60 * 1000);
    expect(timing.executionMs).toBe(45 * 60 * 1000);
    expect(timing.waitRatio).toBeCloseTo(0.25);
    expect(timing.isWaiting).toBe(false);
  });

  it('includes an active human wait interval in real time', () => {
    const timing = calculateWorkflowRunTiming({
      startTime: '2026-07-16T00:00:00.000Z',
      nowMs: new Date('2026-07-16T00:40:00.000Z').getTime(),
      accumulatedWaitMs: 5 * 60 * 1000,
      waitStartedAt: '2026-07-16T00:30:00.000Z',
    });

    expect(timing.totalMs).toBe(40 * 60 * 1000);
    expect(timing.waitMs).toBe(15 * 60 * 1000);
    expect(timing.executionMs).toBe(25 * 60 * 1000);
    expect(timing.isWaiting).toBe(true);
  });

  it('clamps invalid or excessive wait values to the total duration', () => {
    const timing = calculateWorkflowRunTiming({
      startTime: '2026-07-16T00:00:00.000Z',
      endTime: '2026-07-16T00:10:00.000Z',
      accumulatedWaitMs: 99 * 60 * 1000,
    });

    expect(timing.totalMs).toBe(10 * 60 * 1000);
    expect(timing.waitMs).toBe(10 * 60 * 1000);
    expect(timing.executionMs).toBe(0);
  });

  it('returns zeroes when the start time is unavailable', () => {
    expect(calculateWorkflowRunTiming({ accumulatedWaitMs: 1000 })).toEqual({
      totalMs: 0,
      executionMs: 0,
      waitMs: 0,
      executionRatio: 0,
      waitRatio: 0,
      isWaiting: false,
    });
  });
});
