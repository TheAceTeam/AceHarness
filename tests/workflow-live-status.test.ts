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
});
