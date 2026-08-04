import { describe, expect, test, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
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

  test('enriches output files from state-machine state metadata', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await mkdir(path.join(aceHome, 'configs'), { recursive: true });
      await writeFile(
        path.join(aceHome, 'configs', 'state-output.yaml'),
        stringify({
          workflow: {
            mode: 'state-machine',
            states: [{
              name: 'Review',
              steps: [{ name: 'Review-Step', role: 'reviewer' }],
            }],
          },
        }),
        'utf8',
      );

      vi.resetModules();
      const { saveProcessOutput, saveRunState } = await import('@/lib/run/state-persistence');
      await saveProcessOutput('run-state-output-route', 'Review-Step', 'state output');
      await saveRunState({
        runId: 'run-state-output-route',
        configFile: 'state-output.yaml',
        status: 'completed',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        currentPhase: null,
        currentState: 'Review',
        currentStep: null,
        completedSteps: ['Review-Step'],
        failedSteps: [],
        stepLogs: [{
          id: 'state-step-log-1',
          stepName: 'Review-Step',
          agent: 'reviewer-agent',
          status: 'completed',
          output: '',
          error: '',
          costUsd: 0,
          durationMs: 1,
          timestamp: new Date().toISOString(),
        }],
        agents: [],
        iterationStates: {
          Review: {
            currentIteration: 2,
            maxIterations: 3,
            consecutiveCleanRounds: 0,
            status: 'running',
            bugsFoundPerRound: [],
          },
        },
        processes: [],
      } as any);

      const route = await import('@/server/api-routes/runs/[id]/outputs/route');
      const response = await route.GET(
        makeRequest('/api/runs/run-state-output-route/outputs'),
        { params: { id: 'run-state-output-route' } },
      );
      const json = await responseJson<any>(response);

      expect(response.status).toBe(200);
      expect(json.files).toEqual([
        expect.objectContaining({
          stepName: 'Review-Step',
          stateName: 'Review',
          phaseName: 'Review',
          role: 'reviewer',
          iteration: 2,
          maxIterations: 3,
        }),
      ]);
    });
  });
});
