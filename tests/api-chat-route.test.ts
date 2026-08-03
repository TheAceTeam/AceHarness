import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';
import { MockEngine } from './helpers/mock-engine';

const routeMocks = vi.hoisted(() => ({
  createChatRuntimeEngine: vi.fn(),
  resolveRequestedChatRuntimeEngineType: vi.fn(),
  buildChatRequestContext: vi.fn(),
  ensureEngineRuntimeSkillsAvailable: vi.fn(),
  executeChatRuntimeWithContextRecovery: vi.fn(),
  resolveRecoveredRuntimeSessionId: vi.fn(),
  getWorkspaceRoot: vi.fn(),
  getWorkspaceRunsDir: vi.fn(),
  getWorkspaceDataFile: vi.fn(),
  requireAuth: vi.fn(),
  resolveActiveChatModelRoute: vi.fn(),
}));

vi.mock('@/lib/chat/chat-engine-runtime', () => ({
  createChatRuntimeEngine: routeMocks.createChatRuntimeEngine,
  executeChatRuntimeWithContextRecovery: routeMocks.executeChatRuntimeWithContextRecovery,
  resolveRecoveredRuntimeSessionId: routeMocks.resolveRecoveredRuntimeSessionId,
  resolveRequestedChatRuntimeEngineType: routeMocks.resolveRequestedChatRuntimeEngineType,
}));

vi.mock('@/lib/chat/request-options', () => ({
  buildChatRequestContext: routeMocks.buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable: routeMocks.ensureEngineRuntimeSkillsAvailable,
}));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceRoot: routeMocks.getWorkspaceRoot,
  getWorkspaceRunsDir: routeMocks.getWorkspaceRunsDir,
  getWorkspaceDataFile: routeMocks.getWorkspaceDataFile,
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/chat/model-route-validation', () => ({
  chatModelRouteError: (engine: string, model: string) => `模型「${model}」当前没有可用于引擎「${engine}」的有效运行路由，请选择已配置的模型后重试。`,
  resolveActiveChatModelRoute: routeMocks.resolveActiveChatModelRoute,
}));

describe('/api/chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    routeMocks.resolveRequestedChatRuntimeEngineType.mockResolvedValue('opencode');
    routeMocks.buildChatRequestContext.mockResolvedValue({ systemPrompt: 'system prompt' });
    routeMocks.ensureEngineRuntimeSkillsAvailable.mockResolvedValue(undefined);
    routeMocks.resolveRecoveredRuntimeSessionId.mockImplementation((result: { sessionId?: string }, sessionId?: string) => result.sessionId || sessionId || undefined);
    routeMocks.getWorkspaceRoot.mockReturnValue('/tmp/workspace');
    routeMocks.getWorkspaceRunsDir.mockReturnValue('/tmp/workspace/runs');
    routeMocks.getWorkspaceDataFile.mockImplementation((...segments: string[]) => ['/tmp/workspace/data', ...segments].join('/'));
    routeMocks.resolveActiveChatModelRoute.mockReturnValue({ modelRouteId: 'route-opencode-glm' });
    routeMocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      username: 'Tester',
      email: 'tester@example.com',
      role: 'user',
      personalDir: '/tmp/personal',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns engine error details for non-throwing execution failures', async () => {
    const engine = new MockEngine();
    const partialRaw = '\n<ace-process>{"kind":"tool-call","toolName":"glob","title":"🔍 搜索文件","pattern":"*","path":"C:\\\\workspace\\\\bin","body":"","toolId":"tool-1"}</ace-process>\n';

    routeMocks.createChatRuntimeEngine.mockResolvedValue(engine);
    routeMocks.executeChatRuntimeWithContextRecovery.mockImplementation(async () => {
      engine.emit('stream', { type: 'text', content: partialRaw });
      return {
        success: false,
        output: '',
        error: 'child exited early code=1',
        sessionId: 'runtime-session-failure-1',
        metadata: {},
      };
    });

    const { POST } = await import('@/server/api-routes/chat/route');
    const responsePromise = POST(makeRequest('/api/chat', {
      json: {
        message: '列出 bin 目录文件',
        model: 'glm-5.1',
        engine: 'opencode-sdk',
        sessionId: null,
      },
    }));

    await vi.advanceTimersByTimeAsync(1000);
    const response = await responsePromise;
    expect(response.status).toBe(200);

    const json = await responseJson(response);
    expect(json).toMatchObject({
      result: partialRaw,
      sessionId: 'runtime-session-failure-1',
      engine: 'opencode',
      isError: true,
      error: 'child exited early code=1',
    });
    expect(routeMocks.buildChatRequestContext).toHaveBeenCalledWith(expect.objectContaining({
      personalDir: '/tmp/personal',
    }));
    expect(routeMocks.executeChatRuntimeWithContextRecovery).toHaveBeenCalledWith(
      expect.objectContaining({
        getName: expect.any(Function),
        on: expect.any(Function),
      }),
      expect.objectContaining({ userId: 'user-1' }),
      expect.any(Object),
    );
  });

  test('hard fails when authentication fails', async () => {
    routeMocks.requireAuth.mockResolvedValue(new Response(JSON.stringify({ error: '未登录或登录已过期' }), { status: 401 }));

    const { POST } = await import('@/server/api-routes/chat/route');
    const response = await POST(makeRequest('/api/chat', {
      json: {
        message: 'hello',
        model: 'glm-5.1',
        engine: 'opencode-sdk',
      },
    }));

    expect(response.status).toBe(401);
    const json = await responseJson(response);
    expect(json).toEqual({ error: '未登录或登录已过期' });
    expect(routeMocks.createChatRuntimeEngine).not.toHaveBeenCalled();
    expect(routeMocks.executeChatRuntimeWithContextRecovery).not.toHaveBeenCalled();
  });
});
