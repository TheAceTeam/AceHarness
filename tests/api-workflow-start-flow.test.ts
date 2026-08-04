import { describe, expect, test, vi, beforeEach } from 'vitest';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';

const chatMocks = vi.hoisted(() => ({
  updateChatSessionCreationBinding: vi.fn(),
}));

const runtimeSessionMocks = vi.hoisted(() => ({
  ensureWorkflowRuntimeConversation: vi.fn(),
  bindWorkflowRunToConversation: vi.fn(),
}));

const transcriptMocks = vi.hoisted(() => ({
  appendWorkflowRuntimeTranscript: vi.fn(),
  toWorkflowRuntimeTranscriptLiveEvent: vi.fn((event) => ({
    runId: event.runId,
    seq: event.seq,
    timestamp: event.timestamp,
    transcript: event.payload,
  })),
}));

// Mock all heavy dependencies before importing the route
vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn(),
}));

vi.mock('@/lib/workflow/preflight', () => ({
  runWorkflowPreflight: vi.fn(),
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getManager: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('@/lib/run/store', () => ({
  createRun: vi.fn(),
}));

vi.mock('@/lib/run/state-persistence', () => ({
  saveRunState: vi.fn(),
  findActiveRuns: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/spec/coding-store', () => ({
  loadCreationSession: vi.fn(),
  loadLatestCreationSessionByFilename: vi.fn().mockResolvedValue(null),
  cloneSpecCodingForRun: vi.fn(),
  updateCreationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/chat/persistence', () => ({
  updateChatSessionCreationBinding: chatMocks.updateChatSessionCreationBinding,
}));

vi.mock('@/lib/workflow/runtime-session', () => ({
  ensureWorkflowRuntimeConversation: runtimeSessionMocks.ensureWorkflowRuntimeConversation,
  bindWorkflowRunToConversation: runtimeSessionMocks.bindWorkflowRunToConversation,
}));

vi.mock('@/lib/workflow/runtime-transcript', () => ({
  appendWorkflowRuntimeTranscript: transcriptMocks.appendWorkflowRuntimeTranscript,
  toWorkflowRuntimeTranscriptLiveEvent: transcriptMocks.toWorkflowRuntimeTranscriptLiveEvent,
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('@/lib/workflow/subworkflow-config', () => ({
  createWorkflowConfigSnapshot: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('workflow:\n  name: Test\n'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('yaml', () => ({
  parse: vi.fn().mockReturnValue({ workflow: { name: 'Test', mode: 'state-machine' } }),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

describe('workflow start flow', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { parse } = await import('yaml');
    (parse as any).mockReset().mockReturnValue({ workflow: { name: 'Test', mode: 'state-machine' } });
    chatMocks.updateChatSessionCreationBinding.mockReset().mockResolvedValue(undefined);
    runtimeSessionMocks.ensureWorkflowRuntimeConversation.mockReset().mockResolvedValue({
      sessionId: 'sess-1',
      sessionWorkbenchState: {
        conversationMode: 'workflow-running',
        embeddedWorkflow: { runId: 'run-pending', configFile: 'test.yaml' },
      },
    });
    runtimeSessionMocks.bindWorkflowRunToConversation.mockReset().mockResolvedValue(true);
    transcriptMocks.appendWorkflowRuntimeTranscript.mockReset().mockResolvedValue(null);
  });

  test('returns 401 when no auth token', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue(
      Response.json({ error: 'unauthorized' }, { status: 401 })
    );

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      json: { configFile: 'test.yaml' },
    }));

    // The route returns the Response from requireAuth directly
    const json = await responseJson(response);
    expect(response.status).toBe(401);
  });

  test('returns 400 when configFile is missing', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: {},
    }));

    const json = await assertErrorResponse(response, 400);
    expect(json.error).toContain('配置文件');
  });

  test('returns 412 when preflight fails', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: false,
      failedCount: 2,
      checks: [{ name: 'check1', ok: false }, { name: 'check2', ok: false }],
      cwd: '/tmp',
    });

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml' },
    }));

    expect(response.status).toBe(412);
    const json = await responseJson(response);
    expect(json.checks).toHaveLength(2);
    expect(json.error).toContain('检查未通过');
  });

  test('skips preflight when skipPreflight is true', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const mockManager = {
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      start: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', skipPreflight: true },
    }));

    expect(response.status).toBe(200);
    expect(runWorkflowPreflight).not.toHaveBeenCalled();
    const json = await responseJson(response);
    expect(json.success).toBe(true);
    expect(json.runId).toBeTruthy();
  });

  test('rehearsal mode returns runId with rehearsal.enabled=true', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: true,
      failedCount: 0,
      checks: [{ name: 'check1', ok: true }],
      cwd: '/tmp',
    });

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', rehearsal: true },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.success).toBe(true);
    expect(json.rehearsal.enabled).toBe(true);
    expect(json.rehearsal.runId).toBeTruthy();
    expect(json.rehearsal.summary).toBeTruthy();
  });

  test('persists lightweight metadata before binding a rehearsal conversation', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', username: 'User', personalDir: '/tmp' });
    const { parse } = await import('yaml');
    (parse as any).mockReturnValue({
      workflow: {
        name: 'Lightweight rehearsal',
        mode: 'state-machine',
        profile: 'lightweight',
        lightweight: {},
        states: [{
          name: 'Execute',
          steps: [{ name: 'Run tasklist', agent: 'developer', skills: ['aceharness-tasklist'] }],
        }],
      },
      context: { projectRoot: '/tmp/project' },
      roles: [],
    });

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'lightweight.yaml', skipPreflight: true, rehearsal: true },
    }));

    expect(response.status).toBe(200);
    const { saveRunState } = await import('@/lib/run/state-persistence');
    const { mkdir } = await import('fs/promises');
    const persistedRun = (saveRunState as any).mock.calls[0][0];
    expect(mkdir).toHaveBeenCalledWith(persistedRun.lightweight.resolvedTasklistDirectory, { recursive: true });
    expect(persistedRun.lightweight.resolvedTasklistDirectory).not.toContain('docs');
    expect(saveRunState).toHaveBeenCalledWith(expect.objectContaining({
      lightweight: expect.objectContaining({
        profile: 'lightweight',
        tasklistDirectory: 'tasklist',
        resolvedTasklistDirectory: expect.stringMatching(/[\\/]runs[\\/]run-/),
      }),
    }));
    expect(persistedRun.workingDirectory).toBe(persistedRun.lightweight.workspaceRoot);
    expect(persistedRun).not.toHaveProperty('supervisorAgent');
    expect(persistedRun).not.toHaveProperty('supervisorSessionId');
    const rehearsalTranscripts = transcriptMocks.appendWorkflowRuntimeTranscript.mock.calls.map(([input]) => input);
    expect(rehearsalTranscripts.every((input: any) => input.speakerName !== 'default-supervisor')).toBe(true);
    expect(JSON.stringify(rehearsalTranscripts)).not.toContain('default-supervisor');
    expect(runtimeSessionMocks.bindWorkflowRunToConversation).toHaveBeenCalledWith(expect.objectContaining({
      requireLightweightMetadata: true,
      lightweight: expect.objectContaining({ profile: 'lightweight' }),
    }));
    expect((saveRunState as any).mock.invocationCallOrder[0]).toBeLessThan(
      runtimeSessionMocks.bindWorkflowRunToConversation.mock.invocationCallOrder[0],
    );
  });

  test('does not reject a lightweight run because another run owns its tasklist directory', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', username: 'User', personalDir: '/tmp' });
    const { parse } = await import('yaml');
    (parse as any).mockReturnValue({
      workflow: {
        name: 'Lightweight conflict',
        mode: 'state-machine',
        profile: 'lightweight',
        lightweight: {},
        states: [{
          name: 'Execute',
          steps: [{ name: 'Run tasklist', agent: 'developer', skills: ['aceharness-tasklist'] }],
        }],
      },
      context: { projectRoot: '/tmp/project' },
      roles: [],
    });
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue({
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      start: vi.fn(),
      emit: vi.fn(),
    });

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'lightweight.yaml', skipPreflight: true, frontendSessionId: 'sess-1' },
    }));

    expect(response.status).toBe(200);
    await expect(responseJson<any>(response)).resolves.toMatchObject({ success: true });
    expect(runtimeSessionMocks.ensureWorkflowRuntimeConversation).toHaveBeenCalled();
  });

  test('returns 409 when workflow is already running', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: true,
      failedCount: 0,
      checks: [],
      cwd: '/tmp',
    });

    const mockManager = {
      getStatus: vi.fn().mockReturnValue({ status: 'running' }),
      start: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml' },
    }));

    expect(response.status).toBe(409);
    const json = await responseJson(response);
    expect(json.error).toContain('已在运行');
  });

  test('normal start calls manager.start()', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: true,
      failedCount: 0,
      checks: [{ name: 'env', ok: true }],
      cwd: '/tmp',
    });

    const mockManager = {
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      start: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.success).toBe(true);
    expect(json.message).toContain('启动');
    expect(json.runId).toBeTruthy();
    expect(runtimeSessionMocks.ensureWorkflowRuntimeConversation).toHaveBeenCalledWith(expect.objectContaining({
      configFile: 'test.yaml',
      runId: json.runId,
    }));

    // manager.start() is called asynchronously (fire-and-forget)
    // Wait a tick for the async call
    await new Promise((r) => setTimeout(r, 10));
    expect(mockManager.start).toHaveBeenCalledWith(
      'test.yaml',
      undefined,
      [{ name: 'env', ok: true }],
      expect.objectContaining({
        globalContext: '',
        phaseContexts: {},
        taskInput: {},
      }),
      json.runId
    );
  });

  test('fans out persisted start transcripts through the manager runtime event path', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', username: 'User', personalDir: '/tmp' });
    transcriptMocks.appendWorkflowRuntimeTranscript.mockImplementation(async (input: any) => ({
      runId: input.runId,
      seq: input.type === 'run-created' ? 1 : 2,
      timestamp: '2026-07-28T00:00:00.000Z',
      payload: { type: input.type, title: input.title },
    }));

    const mockManager = {
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      start: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', skipPreflight: true },
    }));

    const json = await responseJson(response);
    expect(mockManager.emit).toHaveBeenCalledWith('runtime-transcript', expect.objectContaining({
      runId: json.runId,
      transcript: expect.objectContaining({ type: 'run-created' }),
    }));
    expect(mockManager.emit).toHaveBeenCalledWith('runtime-transcript', expect.objectContaining({
      runId: json.runId,
      transcript: expect.objectContaining({ type: 'run-starting' }),
    }));
  });

  test('formal lightweight start emits no default-supervisor event or speaker', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });
    const { parse } = await import('yaml');
    (parse as any).mockReturnValue({
      workflow: {
        name: 'Lightweight formal start',
        mode: 'state-machine',
        profile: 'lightweight',
        lightweight: {},
        states: [{
          name: 'Execute',
          steps: [{ name: 'Run tasklist', agent: 'developer', skills: ['aceharness-tasklist'] }],
        }],
      },
      context: { projectRoot: '/tmp/project' },
      roles: [],
    });
    const mockManager = {
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      start: vi.fn().mockResolvedValue(undefined),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'lightweight-formal.yaml', skipPreflight: true },
    }));

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockManager.start).toHaveBeenCalled();
    const transcriptInputs = transcriptMocks.appendWorkflowRuntimeTranscript.mock.calls.map(([input]) => input);
    expect(transcriptInputs.every((input: any) => input.speakerName !== 'default-supervisor')).toBe(true);
    expect(JSON.stringify(transcriptInputs)).not.toContain('default-supervisor');
  });

  test('concurrent start requests cannot both pass while the start transcript is pending', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', username: 'User', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: true,
      failedCount: 0,
      checks: [],
      cwd: '/tmp',
    });

    let releaseRunStartingMessage!: () => void;
    const runStartingMessage = new Promise<void>((resolve) => {
      releaseRunStartingMessage = resolve;
    });
    transcriptMocks.appendWorkflowRuntimeTranscript.mockImplementation(() => runStartingMessage);

    let managerStatus: 'idle' | 'preparing' | 'running' | 'failed' = 'idle';
    const mockManager = {
      getStatus: vi.fn(() => ({ status: managerStatus })),
      start: vi.fn().mockImplementation(() => {
        if (managerStatus === 'preparing' || managerStatus === 'running') {
          return Promise.reject(new Error('工作流已在运行中'));
        }
        managerStatus = 'preparing';
        return new Promise(() => {});
      }),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const first = POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));
    const second = POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));

    await vi.waitFor(() => {
      expect(transcriptMocks.appendWorkflowRuntimeTranscript).toHaveBeenCalledTimes(1);
      expect(mockManager.start).toHaveBeenCalledTimes(1);
    });
    await expect(second).resolves.toHaveProperty('status', 409);

    releaseRunStartingMessage();

    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    expect(mockManager.start).toHaveBeenCalledTimes(1);
  });

  test('already-running start rejection does not mark the active manager failed', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', username: 'User', personalDir: '/tmp' });

    const { runWorkflowPreflight } = await import('@/lib/workflow/preflight');
    (runWorkflowPreflight as any).mockResolvedValue({
      ok: true,
      failedCount: 0,
      checks: [],
      cwd: '/tmp',
    });

    const mockManager = {
      status: 'running',
      statusReason: null,
      getStatus: vi.fn().mockReturnValue({ status: 'idle', runId: 'run-existing' }),
      start: vi.fn().mockRejectedValue(new Error('工作流已在运行中')),
      emit: vi.fn(),
    };
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    (workflowRegistry.getManager as any).mockResolvedValue(mockManager);

    const { POST } = await import('@/server/api-routes/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockManager.status).toBe('running');
    expect(mockManager.statusReason).toBeNull();
    expect(mockManager.emit).not.toHaveBeenCalledWith('status', expect.objectContaining({ status: 'failed' }));
  });
});
