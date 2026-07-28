import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('run outputs route', () => {
  test('loads externalized step log output by step log id', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { saveRunState } = await import('@/lib/run/state-persistence');
      await saveRunState({
        runId: 'run-output-route',
        configFile: 'workflow.yaml',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        currentPhase: 'State',
        currentStep: null,
        completedSteps: ['State-Step'],
        failedSteps: [],
        stepLogs: [{
          id: 'step-log-1',
          stepName: 'State-Step',
          agent: 'agent',
          status: 'completed',
          output: 'externalized output content',
          error: '',
          timestamp: new Date().toISOString(),
        }],
        agents: [],
        iterationStates: {},
        processes: [],
      } as any);
      const route = await import('@/server/api-routes/runs/[id]/outputs/route');

      const response = await route.GET(
        makeRequest('/api/runs/run-output-route/outputs?stepLogId=step-log-1'),
        { params: { id: 'run-output-route' } },
      );
      const json = await responseJson<any>(response);

      expect(response.status).toBe(200);
      expect(json.stepName).toBe('State-Step');
      expect(json.content).toBe('externalized output content');
    });
  });
});
