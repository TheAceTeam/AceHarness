import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';
import { MockEngine } from './helpers/mock-engine';

const routeMocks = vi.hoisted(() => ({
  createEngine: vi.fn(),
  resolveRequestedEngineType: vi.fn(),
  buildChatRequestContext: vi.fn(),
  ensureEngineRuntimeSkillsAvailable: vi.fn(),
  executeEngineWithContextRecovery: vi.fn(),
  resolveRecoveredSessionId: vi.fn(),
  getWorkspaceRoot: vi.fn(),
}));

vi.mock('@/lib/engines/engine-factory', () => ({
  createEngine: routeMocks.createEngine,
  resolveRequestedEngineType: routeMocks.resolveRequestedEngineType,
}));

vi.mock('@/lib/chat/request-options', () => ({
  buildChatRequestContext: routeMocks.buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable: routeMocks.ensureEngineRuntimeSkillsAvailable,
}));

vi.mock('@/lib/engines/context-recovery', () => ({
  executeEngineWithContextRecovery: routeMocks.executeEngineWithContextRecovery,
  resolveRecoveredSessionId: routeMocks.resolveRecoveredSessionId,
}));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceRoot: routeMocks.getWorkspaceRoot,
}));

describe('/api/chat route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    routeMocks.resolveRequestedEngineType.mockResolvedValue('opencode-sdk');
    routeMocks.buildChatRequestContext.mockResolvedValue({ systemPrompt: 'system prompt' });
    routeMocks.ensureEngineRuntimeSkillsAvailable.mockResolvedValue(undefined);
    routeMocks.resolveRecoveredSessionId.mockImplementation((result: { sessionId?: string }, sessionId?: string) => result.sessionId || sessionId || undefined);
    routeMocks.getWorkspaceRoot.mockReturnValue('/tmp/workspace');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('returns engine error details for non-throwing execution failures', async () => {
    const engine = new MockEngine();
    const partialRaw = '\n<ace-process>{"kind":"tool-call","toolName":"glob","title":"🔍 搜索文件","pattern":"*","path":"C:\\\\workspace\\\\bin","body":"","toolId":"tool-1"}</ace-process>\n';

    routeMocks.createEngine.mockResolvedValue(engine);
    routeMocks.executeEngineWithContextRecovery.mockImplementation(async (target: MockEngine) => {
      target.emit('stream', { type: 'text', content: partialRaw });
      return {
        success: false,
        output: '',
        error: 'child exited early code=1',
        sessionId: 'ses_failure_1',
        metadata: {},
      };
    });

    const { POST } = await import('@/app/api/chat/route');
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
      sessionId: 'ses_failure_1',
      engine: 'opencode-sdk',
      isError: true,
      error: 'child exited early code=1',
    });
  });
});
