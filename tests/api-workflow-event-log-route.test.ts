import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

async function createAuthToken(role: 'admin' | 'user' = 'admin', label = ''): Promise<{ token: string; user: { id: string; username: string } }> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `event-log-${suffix}`,
    email: `event-log-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role,
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user: { id: user.id, username: user.username } };
}

describe('workflow event log route', () => {
  test('rejects unauthenticated requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const route = await import('@/server/api-routes/workflow/event-log/route');
      await assertErrorResponse(await route.GET(makeRequest('/api/workflow/event-log?runId=run-1')), 401);
    });
  });

  test('returns events after the requested sequence', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { getWorkflowEventStore } = await import('@/lib/workflow/event-store');
      const store = getWorkflowEventStore();
      await store.append('run-event-log-route', 'run.state.saved', { status: 'running' });
      await store.append('run-event-log-route', 'workflow.step-start', { step: 'Build' });
      const route = await import('@/server/api-routes/workflow/event-log/route');

      const response = await route.GET(makeRequest('/api/workflow/event-log?runId=run-event-log-route&afterSeq=1', {
        token,
      }));

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.runId).toBe('run-event-log-route');
      expect(json.events).toHaveLength(1);
      expect(json.events[0]).toMatchObject({
        seq: 2,
        type: 'workflow.step-start',
        payload: { step: 'Build' },
      });
      expect(json.nextSeq).toBe(2);
    });
  });

  test('returns lightweight run state fields for live recovery', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { saveRunState } = await import('@/lib/run/state-persistence');
      await saveRunState({
        runId: 'run-event-log-live-recovery',
        configFile: 'live-recovery.yaml',
        status: 'running',
        startTime: new Date().toISOString(),
        endTime: null,
        currentPhase: '编码',
        currentState: '编码',
        currentStep: '编码-实现',
        activeSteps: ['编码-实现'],
        activeConcurrencyGroups: [],
        completedSteps: ['设计-方案'],
        failedSteps: [],
        stepLogs: [{
          id: 'log-1',
          stepName: '设计-方案',
          agent: 'planner',
          status: 'completed',
          output: 'large output should not be required for live recovery',
          timestamp: '2026-07-18T00:00:00.000Z',
        }],
        stateHistory: [{
          from: '设计',
          to: '编码',
          reason: '方案完成',
          issues: [],
          timestamp: '2026-07-18T00:00:00.000Z',
        }],
        transitionCount: 1,
        agents: [],
        iterationStates: {},
        processes: [],
      } as any);
      const route = await import('@/server/api-routes/workflow/event-log/route');

      const response = await route.GET(makeRequest('/api/workflow/event-log?runId=run-event-log-live-recovery', {
        token,
      }));
      const json = await responseJson<any>(response);
      const saved = json.events.find((event: any) => event.type === 'run.state.saved');

      expect(saved?.payload).toMatchObject({
        currentState: '编码',
        currentStep: '编码-实现',
        activeSteps: ['编码-实现'],
        completedSteps: ['设计-方案'],
        transitionCount: 1,
      });
      expect(saved?.payload.stateHistory).toHaveLength(1);
      expect(saved?.payload.stepLogs[0]).toMatchObject({
        id: 'log-1',
        stepName: '设计-方案',
        status: 'completed',
      });
      expect(saved?.payload.stepLogs[0].output).toBeUndefined();
    });
  });

  test('rejects event-log access for non-owner users', async () => {
    await withIsolatedAceHome(async () => {
      const owner = await createAuthToken('user', 'owner');
      const other = await createAuthToken('user', 'other');
      const { saveRunState } = await import('@/lib/run/state-persistence');
      await saveRunState({
        runId: 'run-private-event-log',
        configFile: 'private.yaml',
        runOwnerId: owner.user.id,
        status: 'running',
        startTime: new Date().toISOString(),
        endTime: null,
        currentPhase: null,
        currentStep: null,
        completedSteps: [],
        failedSteps: [],
        stepLogs: [],
        agents: [],
        iterationStates: {},
        processes: [],
      } as any);
      const route = await import('@/server/api-routes/workflow/event-log/route');

      const response = await route.GET(makeRequest('/api/workflow/event-log?runId=run-private-event-log', {
        token: other.token,
      }));

      expect(response.status).toBe(403);
    });
  });

  test('workflow audit-log records and returns request metadata for owner', async () => {
    await withIsolatedAceHome(async () => {
      const owner = await createAuthToken('user', 'audit-owner');
      const { saveRunState } = await import('@/lib/run/state-persistence');
      const { appendWorkflowAuditEvent } = await import('@/lib/workflow/audit-log');
      await saveRunState({
        runId: 'run-audit-route',
        configFile: 'audit.yaml',
        runOwnerId: owner.user.id,
        status: 'running',
        startTime: new Date().toISOString(),
        endTime: null,
        currentPhase: null,
        currentStep: null,
        completedSteps: [],
        failedSteps: [],
        stepLogs: [],
        agents: [],
        iterationStates: {},
        processes: [],
      } as any);
      await appendWorkflowAuditEvent({
        action: 'force-transition',
        runId: 'run-audit-route',
        actorId: owner.user.id,
        actorName: owner.user.username,
        requestId: 'req-1',
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
      const route = await import('@/server/api-routes/workflow/audit-log/route');

      const response = await route.GET(makeRequest('/api/workflow/audit-log?runId=run-audit-route', {
        token: owner.token,
      }));
      const json = await responseJson<any>(response);

      expect(response.status).toBe(200);
      expect(json.events[0]).toMatchObject({
        action: 'force-transition',
        requestId: 'req-1',
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });
    });
  });
});
