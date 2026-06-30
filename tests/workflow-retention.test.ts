import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

function minimalRunState(overrides: Record<string, any> = {}) {
  return {
    runId: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    configFile: 'workflow.yaml',
    status: 'completed' as const,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T00:10:00.000Z',
    currentPhase: null,
    currentStep: null,
    completedSteps: [],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    ...overrides,
  };
}

describe('workflow retention and access governance', () => {
  test('prunes workflow audit logs by event count and age', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { appendWorkflowAuditEvent, pruneWorkflowAuditLog, readWorkflowAuditEvents } = await import('@/lib/workflow/audit-log');
      await appendWorkflowAuditEvent({
        runId: 'run-audit-prune',
        action: 'old',
        requestId: 'old',
      });
      await appendWorkflowAuditEvent({
        runId: 'run-audit-prune',
        action: 'new-1',
        requestId: 'new-1',
      });
      await appendWorkflowAuditEvent({
        runId: 'run-audit-prune',
        action: 'new-2',
        requestId: 'new-2',
      });

      const result = await pruneWorkflowAuditLog('run-audit-prune', { maxEvents: 2 });
      const events = await readWorkflowAuditEvents('run-audit-prune');

      expect(result).toMatchObject({ before: 3, after: 2, pruned: 1 });
      expect(events.map((event) => event.requestId)).toEqual(['new-1', 'new-2']);
    });
  });

  test('marks expired detached children abandoned without deleting run data', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { saveRunState, loadRunState } = await import('@/lib/run/state-persistence');
      const { applyWorkflowRunRetention } = await import('@/lib/workflow/run-retention');
      await saveRunState(minimalRunState({
        runId: 'run-parent-retention',
        subworkflowRuns: [{
          parentStepId: 'child-step',
          parentStepName: 'Child',
          configFile: 'child.yaml',
          runId: 'run-child-detached-old',
          attempt: 1,
          status: 'detached',
          startedAt: '2026-01-01T00:00:00.000Z',
        }],
      }) as any);

      const dry = await applyWorkflowRunRetention({
        detachedMaxAgeMs: 60 * 60 * 1000,
        now: new Date('2026-01-02T00:00:00.000Z'),
        dryRun: true,
      });
      expect(dry.abandonedDetachedChildren).toHaveLength(1);
      expect((await loadRunState('run-parent-retention'))?.subworkflowRuns?.[0].status).toBe('detached');

      const applied = await applyWorkflowRunRetention({
        detachedMaxAgeMs: 60 * 60 * 1000,
        now: new Date('2026-01-02T00:00:00.000Z'),
        dryRun: false,
      });
      const loaded = await loadRunState('run-parent-retention');

      expect(applied.updatedRuns).toBe(1);
      expect(loaded?.subworkflowRuns?.[0]).toMatchObject({
        runId: 'run-child-detached-old',
        status: 'abandoned',
      });
    });
  });

  test('run access capabilities distinguish viewer, reviewer, operator, and admin lists', async () => {
    const { canAccessRunState } = await import('@/lib/workflow/run-access');
    const runState = {
      runOwnerId: 'owner',
      runAccess: {
        viewers: ['viewer'],
        reviewers: ['reviewer'],
        operators: ['operator'],
        admins: ['run-admin'],
      },
    } as any;

    expect(canAccessRunState({ id: 'viewer', role: 'user' }, runState, 'view')).toBe(true);
    expect(canAccessRunState({ id: 'viewer', role: 'user' }, runState, 'review')).toBe(false);
    expect(canAccessRunState({ id: 'reviewer', role: 'user' }, runState, 'review')).toBe(true);
    expect(canAccessRunState({ id: 'operator', role: 'user' }, runState, 'operate')).toBe(true);
    expect(canAccessRunState({ id: 'run-admin', role: 'user' }, runState, 'admin')).toBe(true);
    expect(canAccessRunState({ id: 'platform-admin', role: 'admin' }, runState, 'admin')).toBe(true);
    expect(canAccessRunState({ id: 'stranger', role: 'user' }, runState, 'view')).toBe(false);
  });
});
