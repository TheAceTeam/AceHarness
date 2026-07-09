import { beforeEach, describe, expect, test, vi } from 'vitest';
import { canAccessRunState } from '@/lib/workflow/run-access';

const routeMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  loadRunState: vi.fn(),
  getManagerByRunId: vi.fn(),
  getManager: vi.fn(),
  getRunningManager: vi.fn(),
  readFile: vi.fn(),
  parse: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: routeMocks.loadRunState,
}));

vi.mock('@/lib/workflow/registry', () => ({
  isStateMachineManagerLike: (manager: any) => Boolean(manager?.forceTransition),
  workflowRegistry: {
    getManagerByRunId: routeMocks.getManagerByRunId,
    getManager: routeMocks.getManager,
    getRunningManager: routeMocks.getRunningManager,
  },
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('@/lib/workflow/audit-log', () => ({
  appendWorkflowAuditEvent: vi.fn().mockResolvedValue(null),
  getWorkflowAuditRequestMeta: vi.fn().mockReturnValue({ requestId: 'req-test' }),
}));

vi.mock('fs/promises', () => ({
  readFile: routeMocks.readFile,
}));

vi.mock('yaml', () => ({
  parse: routeMocks.parse,
}));

function postRequest(body: any) {
  return new Request('http://localhost/api/workflow/force-transition', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

describe('workflow run access control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.readFile.mockResolvedValue('workflow: {}');
    routeMocks.parse.mockReturnValue({
      workflow: {
        mode: 'state-machine',
        states: [{ name: '实施' }],
      },
    });
  });

  test('allows owner, admin, and preRuntime unowned runs but rejects other users', () => {
    expect(canAccessRunState({ id: 'owner', role: 'user' }, { runOwnerId: 'owner' } as any)).toBe(true);
    expect(canAccessRunState({ id: 'admin', role: 'admin' }, { runOwnerId: 'owner' } as any)).toBe(true);
    expect(canAccessRunState({ id: 'user-2', role: 'user' }, {} as any)).toBe(true);
    expect(canAccessRunState({ id: 'user-2', role: 'user' }, { runOwnerId: 'owner' } as any)).toBe(false);
  });

  test('force-transition API rejects non-owner run mutation', async () => {
    routeMocks.requireAuth.mockResolvedValue({ id: 'user-2', username: 'Other', role: 'user' });
    routeMocks.loadRunState.mockResolvedValue({
      runId: 'run-1',
      configFile: 'parent.yaml',
      runOwnerId: 'owner',
      mode: 'state-machine',
    });
    const { POST } = await import('@/server/api-routes/workflow/force-transition/route');

    const response = await POST(postRequest({ runId: 'run-1', targetState: '实施' }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toContain('无权');
    expect(routeMocks.getManagerByRunId).not.toHaveBeenCalled();
  });

  test('force-transition API allows admin and records actor on manager call', async () => {
    const forceTransition = vi.fn();
    routeMocks.requireAuth.mockResolvedValue({ id: 'admin-1', username: 'Admin', role: 'admin' });
    routeMocks.loadRunState.mockResolvedValue({
      runId: 'run-1',
      configFile: 'parent.yaml',
      runOwnerId: 'owner',
      mode: 'state-machine',
    });
    routeMocks.getManagerByRunId.mockResolvedValue({
      forceTransition,
      getStatus: () => ({ status: 'running', runId: 'run-1', currentState: '设计' }),
    });
    const { POST } = await import('@/server/api-routes/workflow/force-transition/route');

    const response = await POST(postRequest({ runId: 'run-1', targetState: '实施', instruction: 'go' }));

    expect(response.status).toBe(200);
    expect(forceTransition).toHaveBeenCalledWith('实施', 'go', { id: 'admin-1', name: 'Admin' });
  });
});
