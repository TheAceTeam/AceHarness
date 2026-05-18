import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

interface AuthResult {
  token: string;
  user: { id: string; username: string };
}

async function createAuthToken(role: 'admin' | 'user' = 'user', usernamePrefix: string = role): Promise<AuthResult> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `${usernamePrefix}-${suffix}`,
    email: `${usernamePrefix}-${suffix}@example.com`,
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

async function loadRouteWithMockedRuns(mockRuns: any[], configNameMap: Record<string, string>) {
  vi.resetModules();
  vi.doMock('@/lib/run/history', async () => {
    const actual = await vi.importActual<typeof import('@/lib/run/history')>('@/lib/run/history');
    return {
      ...actual,
      readAllRunsSummary: vi.fn(async () => ({
        runs: mockRuns,
        agentUsage: {},
        tokenRankingByUser: [],
        tokenRankingByWorkflow: [],
      })),
      readAccessibleConfigNameMap: vi.fn(async () => configNameMap),
    };
  });
  return import('@/app/api/run-history/route');
}

function sampleRun(overrides: Record<string, any>) {
  return {
    id: overrides.id || 'run',
    configFile: overrides.configFile || 'default.yaml',
    configName: overrides.configName || overrides.configFile || 'default.yaml',
    startTime: overrides.startTime || '2026-05-08T10:00:00.000Z',
    endTime: overrides.endTime ?? null,
    status: overrides.status || 'completed',
    currentPhase: overrides.currentPhase || 'build',
    totalSteps: overrides.totalSteps ?? 4,
    completedSteps: overrides.completedSteps ?? 4,
    totalTokens: overrides.totalTokens ?? 100,
    cost: overrides.cost ?? 0.1,
    inputTokens: overrides.inputTokens ?? 50,
    outputTokens: overrides.outputTokens ?? 50,
    cacheCreationInputTokens: overrides.cacheCreationInputTokens ?? 0,
    cacheReadInputTokens: overrides.cacheReadInputTokens ?? 0,
    ownerId: overrides.ownerId || '',
    ownerName: overrides.ownerName || '未知用户',
  };
}

describe('run history route', () => {
  test('rejects unauthenticated requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const route = await import('@/app/api/run-history/route');
      await assertErrorResponse(await route.GET(makeRequest('/api/run-history')), 401);
    });
  });

  test('supports keyword filtering, sorting by name, and pagination for normal users', async () => {
    await withIsolatedAceHome(async () => {
      const { token, user } = await createAuthToken('user', 'member');
      const route = await loadRouteWithMockedRuns([
        sampleRun({
          id: 'run-b',
          configFile: 'beta.yaml',
          startTime: '2026-05-07T12:00:00.000Z',
          ownerId: user.id,
          ownerName: user.username,
        }),
        sampleRun({
          id: 'run-a1',
          configFile: 'alpha.yaml',
          startTime: '2026-05-08T12:00:00.000Z',
          ownerId: user.id,
          ownerName: user.username,
        }),
        sampleRun({
          id: 'run-a2',
          configFile: 'alpha-2.yaml',
          startTime: '2026-05-06T12:00:00.000Z',
          ownerId: user.id,
          ownerName: user.username,
        }),
      ], {
        'alpha.yaml': 'Alpha Workflow',
        'alpha-2.yaml': 'Alpha Extra',
        'beta.yaml': 'Beta Workflow',
      });

      const response = await route.GET(makeRequest('/api/run-history?keyword=alpha&sortKey=name&sortDirection=asc&pageSize=1&page=2', {
        token,
      }));

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.isAdmin).toBe(false);
      expect(json.filters.keyword).toBe('alpha');
      expect(json.pagination.total).toBe(2);
      expect(json.pagination.totalPages).toBe(2);
      expect(json.pagination.page).toBe(2);
      expect(json.runs).toHaveLength(1);
      expect(json.runs[0].id).toBe('run-a1');
      expect(json.runs[0].configName).toBe('Alpha Workflow');
    });
  });

  test('allows admins to filter by owner and returns user options', async () => {
    await withIsolatedAceHome(async () => {
      const { token: adminToken } = await createAuthToken('admin', 'admin');
      const { user: alice } = await createAuthToken('user', 'alice');
      const { user: bob } = await createAuthToken('user', 'bob');

      const route = await loadRouteWithMockedRuns([
        sampleRun({
          id: 'run-alice',
          configFile: 'alpha.yaml',
          startTime: '2026-05-08T12:00:00.000Z',
          ownerId: alice.id,
          ownerName: alice.username,
        }),
        sampleRun({
          id: 'run-bob',
          configFile: 'beta.yaml',
          startTime: '2026-05-07T12:00:00.000Z',
          ownerId: bob.id,
          ownerName: bob.username,
        }),
      ], {
        'alpha.yaml': 'Alpha Workflow',
        'beta.yaml': 'Beta Workflow',
      });

      const response = await route.GET(makeRequest(`/api/run-history?ownerId=${encodeURIComponent(alice.id)}`, {
        token: adminToken,
      }));

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.isAdmin).toBe(true);
      expect(json.filters.ownerId).toBe(alice.id);
      expect(json.runs).toHaveLength(1);
      expect(json.runs[0].ownerId).toBe(alice.id);
      expect(json.runs[0].ownerName).toBe(alice.username);
      expect(json.userOptions.some((entry: any) => entry.id === alice.id && entry.username === alice.username)).toBe(true);
      expect(json.userOptions.some((entry: any) => entry.id === bob.id && entry.username === bob.username)).toBe(true);
    });
  });
});
