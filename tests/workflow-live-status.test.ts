import { describe, expect, test } from 'vitest';
import {
  compactWorkflowStatusDeltaForLive,
  compactWorkflowStatusForLive,
} from '@/lib/workflow/live-status';

describe('workflow live status normalization', () => {
  test('clears active runtime fields for completed snapshots', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'completed',
      runId: 'run-001',
      currentPhase: '完成',
      currentStep: '完成-final-step',
      activeSteps: ['完成-final-step'],
      activeConcurrencyGroups: [{ id: 'group-1', status: 'completed' }],
      completedSteps: ['完成-final-step'],
      failedSteps: [],
    }, 'workflow.yaml') as any;

    expect(snapshot.status).toBe('completed');
    expect(snapshot.currentStep).toBeNull();
    expect(snapshot.activeSteps).toEqual([]);
    expect(snapshot.activeConcurrencyGroups).toEqual([]);
  });

  test('clears active runtime fields for completed deltas', () => {
    const delta = compactWorkflowStatusDeltaForLive({
      status: 'completed',
      runId: 'run-001',
      currentPhase: '完成',
      currentStep: '完成-final-step',
      activeSteps: ['完成-final-step'],
      activeConcurrencyGroups: [{ id: 'group-1', status: 'completed' }],
    }, 'workflow.yaml') as any;

    expect(delta.currentStep).toBeNull();
    expect(delta.activeSteps).toEqual([]);
    expect(delta.activeConcurrencyGroups).toEqual([]);
  });

  test('keeps superseded step attempts visible in compact status history', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'running',
      runId: 'run-001',
      currentPhase: '设计',
      currentStep: '设计-review-step',
      activeSteps: ['设计-review-step'],
      activeConcurrencyGroups: [],
      completedSteps: [],
      failedSteps: [],
      stepLogs: [{
        id: 'attempt-1',
        stepName: '设计-review-step',
        agent: 'reviewer',
        status: 'failed',
        error: 'old failure',
        superseded: true,
        supersededAt: '2026-07-30T08:00:00.000Z',
        supersededByStep: '设计-review-step',
      }],
    }, 'workflow.yaml') as any;

    expect(snapshot.stepLogs).toEqual([expect.objectContaining({
      id: 'attempt-1',
      status: 'failed',
      superseded: true,
      supersededAt: '2026-07-30T08:00:00.000Z',
      supersededByStep: '设计-review-step',
    })]);
  });
});
