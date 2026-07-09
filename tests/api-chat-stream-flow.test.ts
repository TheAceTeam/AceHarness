import { describe, expect, test, vi, beforeEach } from 'vitest';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';
import { MockEngine } from './helpers/mock-engine';
import { REAL_OPENCODE_CONNECTED_REPLAY } from './fixtures/real-engine-events';

vi.mock('@/lib/chat/chat-engine-runtime', () => ({
  getOrCreateChatRuntimeEngine: vi.fn(),
  executeChatRuntimeWithContextRecovery: vi.fn(async (engine: MockEngine) => {
    const result = await engine.execute({ prompt: '', systemPrompt: '', model: '', workingDirectory: '' } as any);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      sessionId: result.sessionId ?? 'runtime-session-1',
      metadata: result.metadata ?? {},
    };
  }),
  isChatRuntimeTimingDebug: vi.fn().mockReturnValue(false),
  resolveRecoveredRuntimeSessionId: vi.fn((result: { sessionId?: string }, fallback?: string) => result.sessionId || fallback || null),
  resolveRequestedChatRuntimeEngineType: vi.fn().mockResolvedValue('mock-engine'),
}));

vi.mock('@/lib/core/process-manager', () => ({
  processManager: {
    registerExternalProcess: vi.fn().mockReturnValue({
      status: 'running',
      sessionId: null,
      frontendSessionId: undefined,
      streamContent: '',
    }),
    registerActiveStream: vi.fn(),
    appendStreamContent: vi.fn(),
    setProcessOutput: vi.fn(),
    getProcess: vi.fn(),
    getActiveStreamChatId: vi.fn(),
    killProcess: vi.fn(),
    removeActiveStream: vi.fn(),
  },
}));

vi.mock('@/lib/chat/stream-state', () => ({
  registerEngineStream: vi.fn(),
  appendEngineStreamContent: vi.fn(),
  setEngineStreamSessionId: vi.fn(),
  setEngineStreamStatus: vi.fn(),
  setEngineStreamLiveSession: vi.fn(),
  updateEngineStreamLiveSession: vi.fn(),
  getEngineStream: vi.fn().mockReturnValue(null),
  getEngineStreamByFrontendSessionId: vi.fn().mockReturnValue(null),
  getRuntimeSessionIdByFrontendSessionId: vi.fn().mockReturnValue(undefined),
  removeEngineStream: vi.fn(),
}));

vi.mock('@/lib/chat/settings', () => ({
  loadChatSettings: vi.fn().mockResolvedValue({
    skills: {},
    workingDirectory: '/tmp',
  }),
}));

vi.mock('@/lib/chat/system-prompt', () => ({
  buildDashboardSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    id: 'user-1',
    username: 'tester',
    email: 'tester@example.com',
    role: 'user',
    personalDir: '/home/tester',
  }),
}));

vi.mock('@/lib/core/app-paths', () => ({
  getRepoRoot: vi.fn().mockReturnValue('/tmp/repo'),
  getInstallPath: vi.fn().mockReturnValue('/tmp/install'),
  getWorkspaceCacheFile: vi.fn().mockReturnValue('/tmp/workspace-cache'),
  getWorkspaceDataFile: vi.fn().mockReturnValue('/tmp/workspace-data'),
  getWorkspaceSkillPath: vi.fn().mockReturnValue('/tmp/workspace/skills/demo'),
  getWorkspaceSkillsDir: vi.fn().mockReturnValue('/tmp/workspace/skills'),
  getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
}));

vi.mock('@/lib/run/runtime-skills', () => ({
  getRuntimeSkillsDirPath: vi.fn().mockResolvedValue('/tmp/skills'),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineConfigDir: vi.fn().mockReturnValue('.engine'),
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: vi.fn().mockResolvedValue(null),
  saveChatSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/spec/coding-store', () => ({
  loadCreationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getManager: vi.fn(),
  },
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: vi.fn().mockResolvedValue(null),
}));

describe('chat stream flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('POST returns 400 for empty message', async () => {
    const { POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: '' },
    }));

    await assertErrorResponse(response, 400);
  });

  test('POST returns 500 when engine is unavailable', async () => {
    const { getOrCreateChatRuntimeEngine } = await import('@/lib/chat/chat-engine-runtime');
    (getOrCreateChatRuntimeEngine as any).mockResolvedValue(null);

    const { POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello' },
    }));

    expect(response.status).toBe(500);
    const json = await responseJson(response);
    expect(json.error).toContain('不可用');
  });

  test('POST returns chatId on success', async () => {
    const engine = new MockEngine({ success: true, output: 'Hello!' });
    const { getOrCreateChatRuntimeEngine } = await import('@/lib/chat/chat-engine-runtime');
    (getOrCreateChatRuntimeEngine as any).mockResolvedValue(engine);

    const { POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello', mode: 'dashboard' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.chatId).toMatch(/^chat-/);
  });

  test('POST registers scoped streams separately from the visible frontend session', async () => {
    const engine = new MockEngine({ success: true, output: 'Planning only' });
    const { getOrCreateChatRuntimeEngine } = await import('@/lib/chat/chat-engine-runtime');
    const { registerEngineStream } = await import('@/lib/chat/stream-state');
    const { processManager } = await import('@/lib/core/process-manager');
    (getOrCreateChatRuntimeEngine as any).mockResolvedValue(engine);

    const { POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: {
        message: 'Create workflow plan',
        mode: 'dashboard',
        frontendSessionId: 'front-1',
        streamScope: 'workflow-planning',
      },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(getOrCreateChatRuntimeEngine).toHaveBeenCalledWith('mock-engine', 'front-1:workflow-planning', 'user-1');
    expect(registerEngineStream).toHaveBeenCalledWith(json.chatId, 'front-1:workflow-planning', 'mock-engine', '');
    expect(processManager.registerActiveStream).toHaveBeenCalledWith('front-1:workflow-planning', json.chatId);
  });

  test('GET checks active streams by scoped recovery key', async () => {
    const { getEngineStreamByFrontendSessionId } = await import('@/lib/chat/stream-state');
    (getEngineStreamByFrontendSessionId as any).mockReturnValueOnce({
      chatId: 'chat-scoped',
      frontendSessionId: 'front-1:workflow-planning',
      status: 'running',
      streamContent: 'planning output',
      engine: 'mock-engine',
      model: '',
    });

    const { GET } = await import('@/server/api-routes/chat/stream/route');
    const response = await GET(makeRequest('/api/chat/stream?checkActive=front-1&streamScope=workflow-planning'));

    expect(response.status).toBe(200);
    expect(getEngineStreamByFrontendSessionId).toHaveBeenCalledWith('front-1:workflow-planning');
    const json = await responseJson(response);
    expect(json).toMatchObject({
      active: true,
      chatId: 'chat-scoped',
      streamContent: 'planning output',
    });
  });

  test('GET returns backend live session snapshot when available', async () => {
    const { getEngineStreamByFrontendSessionId } = await import('@/lib/chat/stream-state');
    (getEngineStreamByFrontendSessionId as any).mockReturnValueOnce({
      chatId: 'chat-live',
      frontendSessionId: 'front-2',
      status: 'completed',
      streamContent: 'partial output',
      engine: 'mock-engine',
      model: 'claude-sonnet-4-20250514',
      liveSession: {
        id: 'front-2',
        title: 'Recovered Session',
        model: 'claude-sonnet-4-20250514',
        engine: 'mock-engine',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { id: 'm1', role: 'user', content: 'hello', timestamp: 1 },
          { id: 'm2', role: 'assistant', content: 'world', timestamp: 2 },
        ],
      },
    });

    const { GET } = await import('@/server/api-routes/chat/stream/route');
    const response = await GET(makeRequest('/api/chat/stream?checkActive=front-2'));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json).toMatchObject({
      active: false,
      found: true,
      chatId: 'chat-live',
      status: 'completed',
      liveSession: {
        id: 'front-2',
        title: 'Recovered Session',
      },
    });
    expect(json.liveSession.messages[1].content).toBe('world');
  });

  test('GET does not replay buffered delta content before connected', async () => {
    const engine = new MockEngine({ success: true, output: 'Hello!' });
    const { getOrCreateChatRuntimeEngine } = await import('@/lib/chat/chat-engine-runtime');
    const { getEngineStream } = await import('@/lib/chat/stream-state');
    (getOrCreateChatRuntimeEngine as any).mockResolvedValue(engine);

    const { POST, GET } = await import('@/server/api-routes/chat/stream/route');
    const createResponse = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello', mode: 'dashboard' },
    }));
    const { chatId } = await responseJson(createResponse);

    (getEngineStream as any).mockReturnValueOnce({
      chatId,
      runtimeSessionId: 'runtime-session-replay',
      streamContent: REAL_OPENCODE_CONNECTED_REPLAY.replayDelta,
      status: 'running',
      engine: 'mock-engine',
      model: '',
    });

    const response = await GET(makeRequest(`/api/chat/stream?id=${chatId}`));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain('event: connected');
    expect(body).toContain('event: session');
    expect(body).toContain('runtime-session-replay');
    expect(body).not.toContain(REAL_OPENCODE_CONNECTED_REPLAY.replayDelta);
  });

  test('DELETE cancels engine and returns killed=true', async () => {
    const engine = new MockEngine();
    const { getOrCreateChatRuntimeEngine } = await import('@/lib/chat/chat-engine-runtime');
    (getOrCreateChatRuntimeEngine as any).mockResolvedValue(engine);

    // First create a chat to get a chatId
    const { POST, DELETE } = await import('@/server/api-routes/chat/stream/route');
    const createResponse = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello' },
    }));
    const { chatId } = await responseJson(createResponse);

    // Now delete it
    const deleteResponse = await DELETE(makeRequest(`/api/chat/stream?id=${chatId}`, {
      method: 'DELETE',
    }));

    expect(deleteResponse.status).toBe(200);
    const json = await responseJson(deleteResponse);
    expect(json.killed).toBe(true);
  });

  test('GET returns 400 when id is missing', async () => {
    const { GET } = await import('@/server/api-routes/chat/stream/route');
    const response = await GET(makeRequest('/api/chat/stream'));

    await assertErrorResponse(response, 400);
  });
});
