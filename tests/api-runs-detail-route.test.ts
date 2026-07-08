import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

function minimalRunState(overrides: Record<string, any> = {}): any {
  return {
    runId: 'run-detail-route-agora-bindings',
    configFile: 'test-workflow.yaml',
    status: 'completed' as const,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    currentPhase: 'Done',
    currentStep: '',
    completedSteps: ['Done'],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    ...overrides,
  };
}

describe('runs detail route', () => {
  test('backfills workflow agora session bindings for legacy event-store snapshots', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { saveRunState } = await import('@/lib/run/state-persistence');
      const { getWorkflowEventStore } = await import('@/lib/workflow/event-store');

      const state = minimalRunState({
        supervisorAgent: 'default-supervisor',
        supervisorSessionId: 'supervisor-session-legacy',
        attachedAgentSessions: {
          'default-supervisor': 'supervisor-session-legacy',
          developer: 'developer-session-legacy',
        },
        workflowFrontendSessionId: 'workflow-frontend-legacy',
        agents: [
          {
            name: 'default-supervisor',
            team: 'black-gold',
            model: 'supervisor-model',
            status: 'completed',
            completedTasks: 1,
            tokenUsage: { inputTokens: 10, outputTokens: 5 },
            costUsd: 0,
            sessionId: 'supervisor-session-legacy',
            iterationCount: 0,
            summary: 'done',
          },
          {
            name: 'developer',
            team: 'blue',
            model: 'developer-model',
            status: 'completed',
            completedTasks: 1,
            tokenUsage: { inputTokens: 20, outputTokens: 15 },
            costUsd: 0.01,
            sessionId: 'developer-session-legacy',
            iterationCount: 0,
            summary: 'done',
          },
        ],
      });

      await saveRunState(state);
      await getWorkflowEventStore().saveSnapshot(state.runId, {
        runId: state.runId,
        configFile: state.configFile,
        workflowName: state.workflowName,
        status: state.status,
        startTime: state.startTime,
        endTime: state.endTime,
        currentPhase: state.currentPhase,
        currentStep: state.currentStep,
        completedSteps: state.completedSteps,
        failedSteps: state.failedSteps,
        supervisorAgent: state.supervisorAgent,
        agents: [
          { name: 'default-supervisor', team: 'black-gold', model: 'supervisor-model', status: 'completed' },
          { name: 'developer', team: 'blue', model: 'developer-model', status: 'completed' },
        ],
      });

      const { GET } = await import('@/server/api-routes/runs/[id]/detail/route');
      const response = await GET(
        makeRequest(`/api/runs/${state.runId}/detail`),
        { params: Promise.resolve({ id: state.runId }) },
      );
      const body = await responseJson<any>(response);

      expect(response.status).toBe(200);
      expect(body.__source).toBe('event-store');
      expect(body.workflowFrontendSessionId).toBe('workflow-frontend-legacy');
      expect(body.supervisorSessionId).toBe('supervisor-session-legacy');
      expect(body.attachedAgentSessions).toEqual({
        'default-supervisor': 'supervisor-session-legacy',
        developer: 'developer-session-legacy',
      });
      expect(body.agents).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'default-supervisor', sessionId: 'supervisor-session-legacy' }),
        expect.objectContaining({ name: 'developer', sessionId: 'developer-session-legacy' }),
      ]));
    });
  });
});
