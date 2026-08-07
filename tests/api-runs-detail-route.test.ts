import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

function minimalRunState(overrides: Record<string, any> = {}): any {
  return {
    runId: 'run-detail-route-session-bindings',
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
  test('backfills workflow session bindings for pre-runtime event-store snapshots', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      const { saveRunState } = await import('@/lib/run/state-persistence');
      const { getWorkflowEventStore } = await import('@/lib/workflow/event-store');
      const { createWorkflowConfigSnapshot } = await import('@/lib/workflow/subworkflow-config');

      const state = minimalRunState({
        supervisorAgent: 'default-supervisor',
        supervisorSessionId: 'supervisor-session-preRuntime',
        attachedAgentSessions: {
          'default-supervisor': 'supervisor-session-preRuntime',
          developer: 'developer-session-preRuntime',
        },
        workflowFrontendSessionId: 'workflow-frontend-preRuntime',
        agents: [
          {
            name: 'default-supervisor',
            team: 'black-gold',
            model: 'supervisor-model',
            status: 'completed',
            completedTasks: 1,
            tokenUsage: { inputTokens: 10, outputTokens: 5 },
            costUsd: 0,
            sessionId: 'supervisor-session-preRuntime',
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
            sessionId: 'developer-session-preRuntime',
            iterationCount: 0,
            summary: 'done',
          },
        ],
      });

      const effectiveConfig = {
        workflow: {
          name: 'Runtime promoted workflow',
          mode: 'state-machine',
          states: [
            {
              name: '执行与对抗',
              isInitial: true,
              isFinal: false,
              steps: [{ name: '执行任务', agent: 'developer', task: '执行任务', role: 'defender' }],
              transitions: [
                { to: '完成', condition: { verdict: 'pass' } },
                { to: '执行与对抗', condition: { verdict: 'conditional_pass' } },
                { to: '执行与对抗', condition: { verdict: 'fail' } },
              ],
            },
            {
              name: '完成',
              isInitial: false,
              isFinal: true,
              steps: [{ name: '汇总', agent: 'developer', task: '汇总' }],
              transitions: [],
            },
          ],
          supervisor: { enabled: true, agent: 'default-supervisor' },
        },
        context: { projectRoot: '{project_root}' },
      };
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, state.configFile), stringify(effectiveConfig), 'utf-8');
      await createWorkflowConfigSnapshot({ rootConfigFile: state.configFile, runId: state.runId });

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
      expect(body.workflowFrontendSessionId).toBe('workflow-frontend-preRuntime');
      expect(body.supervisorSessionId).toBe('supervisor-session-preRuntime');
      expect(body.workflow).toMatchObject({
        mode: 'state-machine',
        states: [expect.objectContaining({ name: '执行与对抗' }), expect.objectContaining({ name: '完成' })],
      });
      expect(body.attachedAgentSessions).toEqual({
        'default-supervisor': 'supervisor-session-preRuntime',
        developer: 'developer-session-preRuntime',
      });
      expect(body.agents).toEqual(expect.arrayContaining([
        expect.objectContaining({
          name: 'default-supervisor',
          sessionId: 'supervisor-session-preRuntime',
          tokenUsage: { inputTokens: 10, outputTokens: 5 },
        }),
        expect.objectContaining({
          name: 'developer',
          sessionId: 'developer-session-preRuntime',
          tokenUsage: { inputTokens: 20, outputTokens: 15 },
        }),
      ]));
    });
  });
});
