import { beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRequest } from './helpers/route-helpers';

const workflowMocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(data: any) => void>>();
  const manager = {
    getStatus: vi.fn(),
    getHumanQuestions: vi.fn(() => []),
  };
  const registry: any = {
    getRunningManagers: vi.fn(() => []),
    getAllManagers: vi.fn(() => [{ configFile: 'workflow.yaml', manager }]),
    on: vi.fn((event: string, handler: (data: any) => void) => {
      const handlers = listeners.get(event) || new Set<(data: any) => void>();
      handlers.add(handler);
      listeners.set(event, handlers);
      return registry;
    }),
    off: vi.fn((event: string, handler: (data: any) => void) => {
      listeners.get(event)?.delete(handler);
      return registry;
    }),
  };

  return {
    manager,
    registry,
    emit(event: string, data: any) {
      listeners.get(event)?.forEach((handler) => handler(data));
    },
    reset() {
      listeners.clear();
      manager.getStatus.mockReset();
      registry.getRunningManagers.mockReset().mockReturnValue([]);
      registry.getAllManagers.mockReset().mockReturnValue([{ configFile: 'workflow.yaml', manager }]);
      registry.on.mockClear();
      registry.off.mockClear();
    },
  };
});

const statusSnapshot = {
  status: 'running',
  runId: 'run-events-route',
  currentConfigFile: 'workflow.yaml',
  currentState: 'Build',
  currentPhase: 'Build',
  currentStep: 'Build-Compile',
};

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(async () => []),
}));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceRunsDir: vi.fn(() => '/tmp/aceharness-runs'),
}));

vi.mock('@/lib/chat/persistence', () => ({
  chatSessionEvents: { on: vi.fn(), off: vi.fn() },
}));

vi.mock('@/lib/chat/stream-state', () => ({
  engineStreamStateEvents: { on: vi.fn(), off: vi.fn() },
  listPublicEngineStreams: vi.fn(() => []),
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: vi.fn(async () => null),
}));

vi.mock('@/lib/workflow/registry', () => ({
  isStateMachineManagerLike: vi.fn(() => true),
  workflowRegistry: workflowMocks.registry,
}));

vi.mock('@/lib/workflow/live-status', () => ({
  compactWorkflowEventPayloadForLive: vi.fn((value) => value),
  compactWorkflowStatusDeltaForLive: vi.fn((status, configFile) => ({
    ...status,
    currentConfigFile: configFile,
  })),
  compactWorkflowStatusForLive: vi.fn((status, configFile) => ({
    ...status,
    currentConfigFile: configFile,
  })),
}));

async function readSseEvent(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const { value, done } = await reader.read();
  if (done || !value) throw new Error('SSE stream ended before the expected event');
  const text = new TextDecoder().decode(value);
  const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
  if (!dataLine) throw new Error(`SSE chunk did not contain a data line: ${text}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

describe('workflow events SSE route', () => {
  beforeEach(() => {
    workflowMocks.reset();
    workflowMocks.manager.getStatus.mockReturnValue(statusSnapshot);
  });

  test('forwards state-machine events with explicit state semantics and live snapshots', async () => {
    const { GET } = await import('@/server/api-routes/workflow/events/route');
    const controller = new AbortController();
    const response = await GET(makeRequest('/api/workflow/events', { signal: controller.signal }));
    const reader = response.body?.getReader();

    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(reader).toBeDefined();
    await expect(readSseEvent(reader!)).resolves.toMatchObject({ type: 'connected' });
    await expect(readSseEvent(reader!)).resolves.toMatchObject({
      type: 'snapshot',
      data: {
        workflowStatuses: {
          'workflow.yaml': statusSnapshot,
        },
      },
    });

    workflowMocks.emit('state-change', {
      __configFile: 'workflow.yaml',
      state: 'Build',
      message: '进入 Build',
      from: 'Plan',
      to: 'Build',
    });
    const stateChange = await readSseEvent(reader!);
    expect(stateChange).toMatchObject({
      type: 'state-change',
      data: {
        state: 'Build',
        stateName: 'Build',
        message: '进入 Build',
        from: 'Plan',
        to: 'Build',
        configFile: 'workflow.yaml',
        statusSnapshot,
      },
    });
    expect(stateChange.data.phase).toBeUndefined();

    workflowMocks.emit('step-start', {
      __configFile: 'workflow.yaml',
      id: 'step-1',
      state: 'Build',
      step: 'Compile',
      agent: 'builder',
    });
    const stepStart = await readSseEvent(reader!);
    expect(stepStart).toMatchObject({
      type: 'step-start',
      data: {
        id: 'step-1',
        state: 'Build',
        stateName: 'Build',
        step: 'Compile',
        stepName: 'Compile',
        agent: 'builder',
        configFile: 'workflow.yaml',
        statusSnapshot,
      },
    });

    workflowMocks.emit('step-complete', {
      __configFile: 'workflow.yaml',
      id: 'step-1',
      state: 'Build',
      step: 'Compile',
      output: 'compiled',
      outputBytes: 8,
    });
    const stepComplete = await readSseEvent(reader!);
    expect(stepComplete).toMatchObject({
      type: 'step-complete',
      data: {
        id: 'step-1',
        state: 'Build',
        stateName: 'Build',
        step: 'Compile',
        stepName: 'Compile',
        output: 'compiled',
        outputBytes: 8,
        configFile: 'workflow.yaml',
        statusSnapshot,
      },
    });

    expect(stepComplete.data.phase).toBeUndefined();
    expect(stepComplete.data.step).not.toBe('Build-Compile');

    controller.abort();
    await reader!.cancel();
  });
});
