import { describe, expect, test, vi, beforeEach } from 'vitest';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';

const chatMocks = vi.hoisted(() => ({
  loadChatSession: vi.fn(),
  saveChatSession: vi.fn(),
  updateChatSessionCreationBinding: vi.fn(),
  updateChatSessionWorkflowBinding: vi.fn(),
}));

const agoraMocks = vi.hoisted(() => ({
  appendWorkflowAgoraMessage: vi.fn(),
  appendWorkflowAgoraOpeningMessages: vi.fn(),
  createWorkflowAgoraWorkbenchState: vi.fn(),
  createWorkflowParticipants: vi.fn(),
  ensureWorkflowAgoraSession: vi.fn(),
  extractWorkflowParticipantNames: vi.fn(),
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
  },
}));

vi.mock('@/lib/run/store', () => ({
  createRun: vi.fn(),
}));

vi.mock('@/lib/run/state-persistence', () => ({
  saveRunState: vi.fn(),
}));

vi.mock('@/lib/spec/coding-store', () => ({
  loadCreationSession: vi.fn(),
  loadLatestCreationSessionByFilename: vi.fn().mockResolvedValue(null),
  cloneSpecCodingForRun: vi.fn(),
  updateCreationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: chatMocks.loadChatSession,
  saveChatSession: chatMocks.saveChatSession,
  updateChatSessionCreationBinding: chatMocks.updateChatSessionCreationBinding,
  updateChatSessionWorkflowBinding: chatMocks.updateChatSessionWorkflowBinding,
}));

vi.mock('@/lib/agora/workflow-topic', () => ({
  appendWorkflowAgoraMessage: agoraMocks.appendWorkflowAgoraMessage,
  appendWorkflowAgoraOpeningMessages: agoraMocks.appendWorkflowAgoraOpeningMessages,
  createWorkflowAgoraWorkbenchState: agoraMocks.createWorkflowAgoraWorkbenchState,
  createWorkflowParticipants: agoraMocks.createWorkflowParticipants,
  ensureWorkflowAgoraSession: agoraMocks.ensureWorkflowAgoraSession,
  extractWorkflowParticipantNames: agoraMocks.extractWorkflowParticipantNames,
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('workflow:\n  name: Test\n'),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('yaml', () => ({
  parse: vi.fn().mockReturnValue({ workflow: { name: 'Test' } }),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('mock-uuid-1234'),
}));

describe('workflow start flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatMocks.loadChatSession.mockReset().mockResolvedValue({
      id: 'sess-1',
      title: 'existing session',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    chatMocks.saveChatSession.mockReset().mockResolvedValue(undefined);
    chatMocks.updateChatSessionCreationBinding.mockReset().mockResolvedValue(undefined);
    chatMocks.updateChatSessionWorkflowBinding.mockReset().mockResolvedValue(undefined);
    agoraMocks.appendWorkflowAgoraMessage.mockReset().mockResolvedValue(undefined);
    agoraMocks.appendWorkflowAgoraOpeningMessages.mockReset().mockResolvedValue(undefined);
    agoraMocks.createWorkflowAgoraWorkbenchState.mockReset().mockReturnValue({ kind: 'workflow-agora' });
    agoraMocks.createWorkflowParticipants.mockReset().mockImplementation((names: string[] = [], options: any = {}) =>
      (names.length ? names : [options.coordinatorAgent || 'default-supervisor']).map((name: string) => ({ name }))
    );
    agoraMocks.ensureWorkflowAgoraSession.mockReset().mockResolvedValue({ kind: 'workflow-agora' });
    agoraMocks.extractWorkflowParticipantNames.mockReset().mockReturnValue(['default-supervisor']);
  });

  test('returns 401 when no auth token', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    const { NextResponse } = await import('next/server');
    (requireAuth as any).mockResolvedValue(
      NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    );

    const { POST } = await import('@/app/api/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      json: { configFile: 'test.yaml' },
    }));

    // The route returns the NextResponse from requireAuth directly
    const json = await responseJson(response);
    expect(response.status).toBe(401);
  });

  test('returns 400 when configFile is missing', async () => {
    const { requireAuth } = await import('@/lib/auth/middleware');
    (requireAuth as any).mockResolvedValue({ id: 'user-1', personalDir: '/tmp' });

    const { POST } = await import('@/app/api/workflow/start/route');
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

    const { POST } = await import('@/app/api/workflow/start/route');
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

    const { POST } = await import('@/app/api/workflow/start/route');
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

    const { POST } = await import('@/app/api/workflow/start/route');
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

    const { POST } = await import('@/app/api/workflow/start/route');
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

    const { POST } = await import('@/app/api/workflow/start/route');
    const response = await POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.success).toBe(true);
    expect(json.message).toContain('启动');
    expect(json.runId).toBeTruthy();

    // manager.start() is called asynchronously (fire-and-forget)
    // Wait a tick for the async call
    await new Promise((r) => setTimeout(r, 10));
    expect(mockManager.start).toHaveBeenCalledWith(
      'test.yaml',
      undefined,
      [{ name: 'env', ok: true }],
      { globalContext: '', phaseContexts: {} },
      json.runId
    );
  });

  test('concurrent start requests cannot both pass while run-starting message is pending', async () => {
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
    agoraMocks.appendWorkflowAgoraMessage.mockImplementation(() => runStartingMessage);

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

    const { POST } = await import('@/app/api/workflow/start/route');
    const first = POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));
    const second = POST(makeRequest('/api/workflow/start', {
      token: 'valid-token',
      json: { configFile: 'test.yaml', frontendSessionId: 'sess-1' },
    }));

    await vi.waitFor(() => {
      expect(agoraMocks.appendWorkflowAgoraMessage).toHaveBeenCalledTimes(1);
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

    const { POST } = await import('@/app/api/workflow/start/route');
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
