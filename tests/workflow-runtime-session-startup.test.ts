import { beforeEach, describe, expect, test, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => {
  const orchestrator = {
    openSession: vi.fn(),
    getSessionStatus: vi.fn(),
    runTurn: vi.fn(),
    cancelTurn: vi.fn(),
    cancelSession: vi.fn(),
  };
  return {
    orchestrator,
    createRuntimeOrchestrator: vi.fn(() => orchestrator),
    resolveRuntimeModelRoute: vi.fn(),
    openRuntimeSqliteDatabase: vi.fn(() => ({})),
    createRuntimeAdapterRegistry: vi.fn(() => ({})),
    createAcpxRuntimeClient: vi.fn(() => ({})),
  };
});

vi.mock('@/lib/runtime-agent/orchestrator', () => ({
  createRuntimeOrchestrator: runtimeMocks.createRuntimeOrchestrator,
}));

vi.mock('@/lib/runtime-agent/models/model-routes-api', () => ({
  resolveRuntimeModelRoute: runtimeMocks.resolveRuntimeModelRoute,
}));

vi.mock('@/lib/runtime-agent/sqlite/database', () => ({
  openRuntimeSqliteDatabase: runtimeMocks.openRuntimeSqliteDatabase,
}));

vi.mock('@/lib/runtime-agent/sqlite/runtime-store', () => ({
  RuntimeSqliteStore: class RuntimeSqliteStore {},
}));

vi.mock('@/lib/runtime-agent/adapters/adapter-registry', () => ({
  createRuntimeAdapterRegistry: runtimeMocks.createRuntimeAdapterRegistry,
}));

vi.mock('@/lib/runtime-agent/adapters/acpx-runtime-client', () => ({
  createAcpxRuntimeClient: runtimeMocks.createAcpxRuntimeClient,
}));

import {
  createWorkflowRuntime,
  prewarmWorkflowRuntimeSession,
} from '@/lib/workflow/runtime-facade';

describe('workflow runtime session startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.resolveRuntimeModelRoute.mockReturnValue({
      agentId: 'codex',
      modelRouteId: 'codex-route',
    });
    runtimeMocks.orchestrator.openSession.mockImplementation(async () => ({
      runtimeSessionId: `runtime-session-${runtimeMocks.orchestrator.openSession.mock.calls.length}`,
      agentId: 'codex',
      kind: 'workflow-agent',
      status: 'active',
      modelRouteId: 'codex-route',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
    }));
    runtimeMocks.orchestrator.getSessionStatus.mockResolvedValue('active');
    runtimeMocks.orchestrator.cancelTurn.mockResolvedValue(undefined);
    runtimeMocks.orchestrator.cancelSession.mockResolvedValue(undefined);
    runtimeMocks.orchestrator.runTurn.mockImplementation(async function* () {
      yield {
        id: 'event-1',
        sessionId: 'runtime-session',
        traceId: 'trace-1',
        seq: 1,
        type: 'turn.completed',
        payload: { reason: 'done' },
        redacted: true,
        createdAt: new Date(0).toISOString(),
      };
    });
  });

  test('creates a fresh lazy binding for each first Agent turn and resumes only an explicit session', async () => {
    const runtime = await createWorkflowRuntime('codex');
    expect(runtime).not.toBeNull();
    const execute = runtime!.execute.bind(runtime);
    const base = {
      prompt: 'complete the task',
      systemPrompt: 'You are a coding assistant.',
      model: 'codex-route',
      workingDirectory: process.cwd(),
      timeoutMs: 60_000,
    };

    await execute({ ...base, agent: 'developer', step: 'implement' });
    await execute({ ...base, agent: 'reviewer', step: 'review' });

    expect(runtimeMocks.orchestrator.openSession).toHaveBeenCalledTimes(2);
    expect(runtimeMocks.orchestrator.openSession).toHaveBeenNthCalledWith(1, expect.objectContaining({
      agentId: 'codex',
      deferAdapterSessionInitialization: true,
    }));
    expect(runtimeMocks.orchestrator.openSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
      agentId: 'codex',
      deferAdapterSessionInitialization: true,
    }));
    expect(runtimeMocks.orchestrator.getSessionStatus).not.toHaveBeenCalled();

    await execute({
      ...base,
      agent: 'developer',
      step: 'continue',
      sessionId: 'runtime-session-explicit',
    });

    expect(runtimeMocks.orchestrator.getSessionStatus).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-explicit',
    });
    expect(runtimeMocks.orchestrator.openSession).toHaveBeenCalledTimes(2);
  });

  test('prewarms workflow Agents without creating an empty native session', async () => {
    await prewarmWorkflowRuntimeSession({
      runtimeType: 'codex',
      agent: 'reviewer',
      step: 'verify',
      model: 'codex-route',
      workingDirectory: process.cwd(),
    });

    expect(runtimeMocks.orchestrator.openSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      kind: 'workflow-agent',
      deferAdapterSessionInitialization: true,
    }));
  });

  test('keeps consuming a cancelled turn so terminal usage is retained', async () => {
    let releaseTerminal: (() => void) | undefined;
    runtimeMocks.orchestrator.runTurn.mockImplementation(async function* () {
      yield {
        id: 'event-started',
        sessionId: 'runtime-session',
        turnId: 'turn-cancel-usage',
        traceId: 'trace-1',
        seq: 1,
        type: 'turn.started',
        payload: {},
        redacted: true,
        createdAt: new Date(0).toISOString(),
      };
      await new Promise<void>((resolve) => {
        releaseTerminal = resolve;
      });
      yield {
        id: 'event-cancelled',
        sessionId: 'runtime-session',
        turnId: 'turn-cancel-usage',
        traceId: 'trace-1',
        seq: 2,
        type: 'turn.cancelled',
        payload: { reason: 'cancelled' },
        usage: {
          inputTokens: 41,
          outputTokens: 43,
          cacheCreationInputTokens: 47,
          cacheReadInputTokens: 53,
          missing: false,
          sourceStatus: 'reported',
        },
        cost: { costUsd: 0.123, missing: false, estimated: false, sourceStatus: 'reported' },
        redacted: true,
        createdAt: new Date(0).toISOString(),
      };
    });
    const runtime = await createWorkflowRuntime('codex');
    const executePromise = runtime!.execute({
      agent: 'developer',
      step: 'implement',
      prompt: 'complete the task',
      systemPrompt: 'You are a coding assistant.',
      model: 'codex-route',
      workingDirectory: process.cwd(),
      timeoutMs: 60_000,
    });

    await vi.waitFor(() => expect(runtimeMocks.orchestrator.runTurn).toHaveBeenCalledTimes(1));
    runtime!.cancel();
    await vi.waitFor(() => expect(runtimeMocks.orchestrator.cancelTurn).toHaveBeenCalled());
    releaseTerminal?.();
    const result = await executePromise;

    expect(result.success).toBe(false);
    expect(result.stopReason).toBe('cancelled');
    expect(result.metadata?.usage).toEqual({
      input_tokens: 41,
      output_tokens: 43,
      cache_creation_input_tokens: 47,
      cache_read_input_tokens: 53,
    });
    expect(result.metadata?.costUsd).toBe(0.123);
  });
});
