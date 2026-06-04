import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

async function createAuthToken(): Promise<string> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `event-log-${suffix}`,
    email: `event-log-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role: 'admin',
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return token;
}

describe('workflow event log route', () => {
  test('rejects unauthenticated requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const route = await import('@/app/api/workflow/event-log/route');
      await assertErrorResponse(await route.GET(makeRequest('/api/workflow/event-log?runId=run-1')), 401);
    });
  });

  test('returns events after the requested sequence', async () => {
    await withIsolatedAceHome(async () => {
      const token = await createAuthToken();
      const { getWorkflowEventStore } = await import('@/lib/workflow/event-store');
      const store = getWorkflowEventStore();
      await store.append('run-event-log-route', 'run.state.saved', { status: 'running' });
      await store.append('run-event-log-route', 'workflow.step-start', { step: 'Build' });
      const route = await import('@/app/api/workflow/event-log/route');

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
});
