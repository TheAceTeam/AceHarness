import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  getWorkspaceDataFile: vi.fn(),
  getRunningManagers: vi.fn(),
  getRunningManager: vi.fn(),
  getAllProcesses: vi.fn(),
  killAllSystem: vi.fn(),
  listRuns: vi.fn(),
  listRunsByConfig: vi.fn(),
  loadRunState: vi.fn(),
  saveRunState: vi.fn(),
  openRuntimeSqliteDatabase: vi.fn(),
  getPrimaryBinding: vi.fn(),
  runtimeTurnRows: vi.fn(),
  closeRuntimeDb: vi.fn(),
}));

vi.mock('fs', () => ({
  existsSync: mocks.existsSync,
}));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceDataFile: mocks.getWorkspaceDataFile,
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getRunningManagers: mocks.getRunningManagers,
    getRunningManager: mocks.getRunningManager,
  },
}));

vi.mock('@/lib/core/process-manager', () => ({
  processManager: {
    getAllProcesses: mocks.getAllProcesses,
    killAllSystem: mocks.killAllSystem,
  },
}));

vi.mock('@/lib/run/store', () => ({
  listRuns: mocks.listRuns,
  listRunsByConfig: mocks.listRunsByConfig,
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: mocks.loadRunState,
  saveRunState: mocks.saveRunState,
}));

vi.mock('@/lib/runtime-agent/sqlite/database', () => ({
  openRuntimeSqliteDatabase: mocks.openRuntimeSqliteDatabase,
}));

vi.mock('@/lib/runtime-agent/sqlite/runtime-store', () => ({
  RuntimeSqliteStore: class {
    getPrimaryBinding(sessionId: string) {
      return mocks.getPrimaryBinding(sessionId);
    }
  },
}));

function makeRunState(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-target',
    configFile: 'workflow.yaml',
    status: 'running',
    workingDirectory: '/workspace/project',
    agents: [],
    stepLogs: [],
    attachedAgentSessions: {},
    humanQuestions: [],
    activeSteps: [],
    activeConcurrencyGroups: [],
    processes: [],
    ...overrides,
  };
}

function makeRuntimeDb() {
  return {
    prepare: vi.fn(() => ({ all: mocks.runtimeTurnRows })),
    close: mocks.closeRuntimeDb,
  };
}

describe('workflow stop route ACPX cleanup scope', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(true);
    mocks.getWorkspaceDataFile.mockReturnValue('/tmp/runtime-agent.sqlite');
    mocks.getRunningManagers.mockReturnValue([]);
    mocks.getRunningManager.mockReturnValue(null);
    mocks.getAllProcesses.mockReturnValue([]);
    mocks.listRuns.mockResolvedValue([]);
    mocks.listRunsByConfig.mockResolvedValue([]);
    mocks.loadRunState.mockImplementation(async () => makeRunState());
    mocks.saveRunState.mockResolvedValue(undefined);
    mocks.runtimeTurnRows.mockReturnValue([]);
    mocks.getPrimaryBinding.mockReturnValue(null);
    mocks.closeRuntimeDb.mockReset();
    mocks.openRuntimeSqliteDatabase.mockImplementation(() => makeRuntimeDb());
    mocks.killAllSystem.mockResolvedValue({
      killed: 0,
      pids: [],
      agentRootsMatched: 0,
      registeredKilled: 0,
      registeredProcessIds: [],
    });
  });

  test('recovers an active runtime session before manager stop and sweeps its exact ACP record', async () => {
    const manager = {
      getStatus: vi.fn(() => ({ runId: 'run-target' })),
      stop: vi.fn().mockResolvedValue({ stopped: true, cleanupErrors: [] }),
    };
    mocks.getRunningManagers.mockReturnValue([{ manager }]);
    mocks.loadRunState.mockImplementation(async () => makeRunState({ workingDirectory: undefined }));
    // The active turn disappears after manager.stop(); the initial scope collection must retain it.
    mocks.runtimeTurnRows
      .mockReturnValueOnce([{ session_id: 'runtime-session-a' }])
      .mockReturnValue([]);
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => (
      sessionId === 'runtime-session-a'
        ? { externalRecordId: 'acpx-record-a', raw: { handle: { acpxRecordId: 'acpx-record-a' } } }
        : null
    ));
    mocks.killAllSystem.mockResolvedValue({
      killed: 2,
      pids: [1001, 1002],
      agentRootsMatched: 1,
      registeredKilled: 0,
      registeredProcessIds: [],
    });

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-target' },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(manager.stop).toHaveBeenCalledOnce();
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: true,
      workspacePaths: [],
      runIds: ['run-target'],
      acpxRecordIds: expect.arrayContaining(['runtime-session-a', 'acpx-record-a']),
    }));
    expect(mocks.getPrimaryBinding).toHaveBeenCalledWith('runtime-session-a');
    expect(mocks.runtimeTurnRows).toHaveBeenCalledWith('run-target', 'run-target');
    expect(manager.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.killAllSystem.mock.invocationCallOrder[0]);
    expect(body.steps.map((step: { id: string }) => step.id)).not.toContain('agent-sweep-session-scope');
    expect(body.steps.map((step: { id: string }) => step.id)).not.toContain('agent-sweep-scope');
    expect(body.steps.map((step: { id: string }) => step.id)).not.toContain('agent-sweep-empty');
    expect(body).not.toHaveProperty('pids');
    expect(body).not.toHaveProperty('managerStopResult');
    expect(body).not.toHaveProperty('cleanupErrors');
  });

  test.each([
    {
      name: 'persisted run state',
      state: { attachedAgentSessions: { architect: 'runtime-session-persisted' } },
      processes: [],
      sessionId: 'runtime-session-persisted',
    },
    {
      name: 'live process registration',
      state: {},
      processes: [{ runId: 'run-target', sessionId: 'runtime-session-live' }],
      sessionId: 'runtime-session-live',
    },
  ])('uses $name when no active runtime turn remains', async ({ state, processes, sessionId }) => {
    mocks.loadRunState.mockImplementation(async () => makeRunState(state));
    mocks.getAllProcesses.mockReturnValue(processes);
    mocks.getPrimaryBinding.mockImplementation((candidate: string) => (
      candidate === sessionId ? { externalRecordId: 'acpx-record-fallback' } : null
    ));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-target' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: true,
      acpxRecordIds: expect.arrayContaining([sessionId, 'acpx-record-fallback']),
      runIds: ['run-target'],
    }));
  });

  test('continues exact ACPX cleanup after manager stop rejects', async () => {
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = {
      getStatus: vi.fn(() => ({ runId: 'run-target' })),
      stop: vi.fn().mockRejectedValue(new Error('engine shutdown failed')),
    };
    mocks.getRunningManagers.mockReturnValue([{ manager }]);
    mocks.runtimeTurnRows.mockReturnValue([{ session_id: 'runtime-session-a' }]);
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => (
      sessionId === 'runtime-session-a' ? { externalRecordId: 'acpx-record-a' } : null
    ));
    mocks.killAllSystem.mockResolvedValue({
      killed: 2,
      pids: [1001, 1002],
      agentRootsMatched: 1,
      registeredKilled: 0,
      registeredProcessIds: [],
    });

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-target' },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toBe('工作流停止未完全完成，请检查运行状态后重试');
    expect(body.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manager-stop', status: 'failed' }),
      expect.objectContaining({ id: 'process-cleanup', status: 'success' }),
    ]));
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: true,
      acpxRecordIds: expect.arrayContaining(['runtime-session-a', 'acpx-record-a']),
      runIds: ['run-target'],
    }));
    expect(diagnostic).toHaveBeenCalledWith(
      '[workflow/stop] manager stop failed; continuing run-scoped process cleanup',
      expect.objectContaining({ runId: 'run-target' }),
    );
  });

  test('continues exact ACPX cleanup after manager stop times out', async () => {
    vi.useFakeTimers();
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = {
      getStatus: vi.fn(() => ({ runId: 'run-target' })),
      stop: vi.fn(() => new Promise(() => {})),
    };
    mocks.getRunningManagers.mockReturnValue([{ manager }]);
    mocks.runtimeTurnRows.mockReturnValue([{ session_id: 'runtime-session-a' }]);
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => (
      sessionId === 'runtime-session-a' ? { externalRecordId: 'acpx-record-a' } : null
    ));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const responsePromise = POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-target' },
    }));
    for (let attempt = 0; attempt < 10 && manager.stop.mock.calls.length === 0; attempt += 1) {
      await Promise.resolve();
    }
    expect(manager.stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000);
    const response = await responsePromise;
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manager-stop', status: 'failed' }),
      expect.objectContaining({ id: 'process-cleanup', status: 'success' }),
    ]));
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: true,
      acpxRecordIds: expect.arrayContaining(['runtime-session-a', 'acpx-record-a']),
      runIds: ['run-target'],
    }));
    expect(diagnostic).toHaveBeenCalledWith(
      '[workflow/stop] manager stop failed; continuing run-scoped process cleanup',
      expect.objectContaining({ runId: 'run-target' }),
    );
  });

  test('fails closed when no run-scoped ACP record can be resolved and exposes no diagnostic step', async () => {
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.loadRunState.mockImplementation(async () => makeRunState({
      workingDirectory: '/workspace/project',
      supervisorSessionId: null,
    }));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-target' },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: false,
      workspacePaths: ['/workspace/project'],
      acpxRecordIds: [],
      runIds: ['run-target'],
    }));
    expect(body.steps.map((step: { id: string }) => step.id)).not.toContain('agent-sweep-session-scope');
    expect(body.steps.map((step: { label: string }) => step.label).join('\n')).not.toContain('ACP');
    expect(diagnostic).toHaveBeenCalledWith(
      '[workflow/stop] ACPX cleanup skipped because no run-scoped ACP record was resolved',
      expect.objectContaining({ runCount: 1 }),
    );
  });

  test('recursively scopes active known child runs while excluding detached children', async () => {
    const states: Record<string, ReturnType<typeof makeRunState>> = {
      'run-parent': makeRunState({
        runId: 'run-parent',
        attachedAgentSessions: { parent: 'runtime-parent' },
        childRunIds: ['run-child', 'run-detached'],
        subworkflowRuns: [
          { runId: 'run-child', status: 'running' },
          { runId: 'run-detached', status: 'detached' },
        ],
        activeSubworkflowRunId: 'run-child',
      }),
      // Older child records can lack parentRunId. The parent's explicit persisted reference is
      // sufficient for this legacy form, while a conflicting parent link is rejected by the route.
      'run-child': makeRunState({
        runId: 'run-child',
        status: 'running',
        attachedAgentSessions: { child: 'runtime-child' },
        childRunIds: ['run-grandchild'],
        subworkflowRuns: [{ runId: 'run-grandchild', status: 'running' }],
      }),
      'run-grandchild': makeRunState({
        runId: 'run-grandchild',
        parentRunId: 'run-child',
        status: 'preparing',
        attachedAgentSessions: { grandchild: 'runtime-grandchild' },
        // The known-child graph can contain stale cycles; the route must not expand one twice.
        childRunIds: ['run-parent'],
      }),
      'run-detached': makeRunState({
        runId: 'run-detached',
        parentRunId: 'run-parent',
        status: 'running',
        attachedAgentSessions: { detached: 'runtime-detached' },
      }),
    };
    mocks.loadRunState.mockImplementation(async (runId: string) => states[runId] || null);
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => ({
      externalRecordId: `acpx-${sessionId}`,
    }));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-parent' },
    }));

    expect(response.status).toBe(200);
    const cleanupScope = mocks.killAllSystem.mock.calls[0]?.[0];
    expect(cleanupScope).toEqual(expect.objectContaining({
      sweepAgentProcesses: true,
      runIds: ['run-parent', 'run-child', 'run-grandchild'],
      acpxRecordIds: expect.arrayContaining([
        'runtime-parent',
        'acpx-runtime-parent',
        'runtime-child',
        'acpx-runtime-child',
        'runtime-grandchild',
        'acpx-runtime-grandchild',
      ]),
    }));
    expect(cleanupScope.runIds).not.toContain('run-detached');
    expect(cleanupScope.acpxRecordIds).not.toContain('runtime-detached');
    expect(cleanupScope.acpxRecordIds).not.toContain('acpx-runtime-detached');
    expect(mocks.loadRunState.mock.calls.some(([id]) => id === 'run-detached')).toBe(false);
    expect(mocks.getPrimaryBinding).not.toHaveBeenCalledWith('runtime-detached');
  });

  test('fails closed for an unreadable child state without aborting parent cleanup', async () => {
    const diagnostic = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const parentState = makeRunState({
      runId: 'run-parent',
      attachedAgentSessions: { parent: 'runtime-parent' },
      childRunIds: ['run-child'],
      subworkflowRuns: [{ runId: 'run-child', status: 'running' }],
    });
    mocks.loadRunState.mockImplementation(async (runId: string) => {
      if (runId === 'run-child') throw new Error('child state unavailable');
      return parentState;
    });
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => ({
      externalRecordId: `acpx-${sessionId}`,
    }));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-parent' },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.killAllSystem).toHaveBeenCalledWith(expect.objectContaining({
      sweepAgentProcesses: true,
      runIds: ['run-parent'],
      acpxRecordIds: expect.arrayContaining(['runtime-parent', 'acpx-runtime-parent']),
    }));
    expect(mocks.saveRunState).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-parent', status: 'stopped' }));
    expect(mocks.saveRunState).not.toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-child' }));
    expect(diagnostic).toHaveBeenCalledWith(
      '[workflow/stop] failed to load persisted run state for cleanup scope',
      expect.objectContaining({ runId: 'run-child' }),
    );
  });

  test('coordinates active descendant managers and durable stopped state without touching detached children', async () => {
    const parentManager = {
      getStatus: vi.fn(() => ({ runId: 'run-parent' })),
      stop: vi.fn().mockResolvedValue({ stopped: true, cleanupErrors: [] }),
    };
    const childManager = {
      getStatus: vi.fn(() => ({ runId: 'run-child' })),
      stop: vi.fn().mockResolvedValue({ stopped: true, cleanupErrors: [] }),
    };
    const detachedManager = {
      getStatus: vi.fn(() => ({ runId: 'run-detached' })),
      stop: vi.fn().mockResolvedValue({ stopped: true, cleanupErrors: [] }),
    };
    mocks.getRunningManagers.mockReturnValue([
      { manager: parentManager },
      { manager: childManager },
      { manager: detachedManager },
    ]);
    const states: Record<string, ReturnType<typeof makeRunState>> = {
      'run-parent': makeRunState({
        runId: 'run-parent',
        attachedAgentSessions: { parent: 'runtime-parent' },
        childRunIds: ['run-child', 'run-detached'],
        subworkflowRuns: [
          { runId: 'run-child', status: 'running' },
          { runId: 'run-detached', status: 'detached' },
        ],
      }),
      'run-child': makeRunState({
        runId: 'run-child',
        parentRunId: 'run-parent',
        status: 'running',
        attachedAgentSessions: { child: 'runtime-child' },
      }),
      'run-detached': makeRunState({
        runId: 'run-detached',
        parentRunId: 'run-parent',
        status: 'running',
        attachedAgentSessions: { detached: 'runtime-detached' },
      }),
    };
    mocks.loadRunState.mockImplementation(async (runId: string) => states[runId] || null);
    mocks.saveRunState.mockImplementation(async (state: ReturnType<typeof makeRunState>) => {
      Object.assign(states[state.runId], state);
    });
    mocks.getPrimaryBinding.mockImplementation((sessionId: string) => ({
      externalRecordId: `acpx-${sessionId}`,
    }));

    const { POST } = await import('@/server/api-routes/workflow/stop/route');
    const response = await POST(makeRequest('/api/workflow/stop', {
      json: { runId: 'run-parent' },
    }));
    const body = await responseJson(response);
    const cleanupScope = mocks.killAllSystem.mock.calls[0]?.[0];

    expect(response.status).toBe(200);
    expect(parentManager.stop).toHaveBeenCalledOnce();
    expect(childManager.stop).toHaveBeenCalledOnce();
    expect(detachedManager.stop).not.toHaveBeenCalled();
    expect(states['run-child'].status).toBe('stopped');
    expect(states['run-detached'].status).toBe('running');
    expect(mocks.saveRunState).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-child',
      status: 'stopped',
    }));
    expect(body.runIds).toEqual(expect.arrayContaining(['run-parent', 'run-child']));
    expect(body.runIds).not.toContain('run-detached');
    expect(cleanupScope).toEqual(expect.objectContaining({
      runIds: ['run-parent', 'run-child'],
      acpxRecordIds: expect.arrayContaining([
        'runtime-parent',
        'acpx-runtime-parent',
        'runtime-child',
        'acpx-runtime-child',
      ]),
    }));
    expect(cleanupScope.runIds).not.toContain('run-detached');
    expect(cleanupScope.acpxRecordIds).not.toContain('runtime-detached');
  });
});
