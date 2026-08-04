import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/agent/chat-service', () => ({
  buildAgentChatMemoryV2RecoverySource: vi.fn(),
  finalizeAgentChatExecution: vi.fn(),
  prepareAgentChat: vi.fn(),
}));

vi.mock('@/lib/ai/result-channel', () => ({
  extractStructuredResult: vi.fn(),
}));

vi.mock('@/lib/chat/chat-engine-runtime', () => ({
  executeChatRuntimeWithContextRecovery: vi.fn(),
  resolveRecoveredRuntimeSessionId: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    id: 'diagnostic-user',
    username: 'diagnostic-user',
    personalDir: '/tmp/diagnostic-user',
  }),
}));

describe('agent chat stream diagnostics', () => {
  test('returns an SSE failed event with the stream-state diagnosis when the stream is missing', async () => {
    const { GET } = await import('@/server/api-routes/agents/[name]/chat/stream/route');

    const response = await GET(new Request('http://localhost/api/agents/demo/chat/stream?id=missing-stream-42'));
    const body = await response.text();
    const payload = JSON.parse(body.match(/^data:\s*(.+)$/m)?.[1] || '{}');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(body).toContain('event: failed');
    expect(payload).toMatchObject({
      code: 'AGENT_STREAM_NOT_FOUND',
      source: 'aceharness-stream',
      sourceLabel: 'ACEHarness 流状态管理',
    });
    expect(payload.message).toContain('missing-stream-42');
    expect(payload.message).toContain('服务端流状态已过期');
  });

  test('replays an early provider error with its source label after SSE connects', async () => {
    const chatService = await import('@/lib/agent/chat-service');
    const runtime = await import('@/lib/chat/chat-engine-runtime');
    const listeners = new Set<(event: any) => void>();
    const engine = {
      on: vi.fn((_event: string, listener: (event: any) => void) => listeners.add(listener)),
      off: vi.fn((_event: string, listener: (event: any) => void) => listeners.delete(listener)),
      cancel: vi.fn(),
    };
    const providerError = 'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE"}';
    vi.mocked(chatService.prepareAgentChat).mockResolvedValue({
      roleConfig: { name: 'demo', systemPrompt: '', allowedTools: [], mcpServers: [] },
      mode: 'standalone-chat',
      resumeSessionId: '',
      frontendSessionId: '',
      workingDirectory: '/tmp',
      workflowContext: null,
      engine,
      engineType: 'codex',
      model: 'demo-model',
      prompt: 'diagnostic prompt',
      sessionReuseKey: '',
      userId: 'diagnostic-user',
      isTemporaryAgora: false,
      memoryV2: { status: { ready: false }, manifest: null, promptBlock: '' },
      getLatestMemoryV2PromptBlock: () => '',
      getMemoryV2HandoffEligibleProposals: () => [],
      releaseMemoryV2: vi.fn(),
    } as any);
    vi.mocked(runtime.executeChatRuntimeWithContextRecovery).mockImplementation(async () => {
      listeners.forEach((listener) => listener({ type: 'error', content: providerError }));
      return { success: false, output: '', error: providerError, sessionId: 'runtime-demo' };
    });
    vi.mocked(runtime.resolveRecoveredRuntimeSessionId).mockImplementation((result: any, fallback?: string | null) => result.sessionId || fallback || null);
    vi.mocked(chatService.finalizeAgentChatExecution).mockResolvedValue({
      ok: false,
      output: '',
      rawOutput: '',
      sessionId: 'runtime-demo',
      mode: 'standalone-chat',
      agent: 'demo',
      engine: 'codex',
      model: 'demo-model',
      isError: true,
      error: providerError,
      specCodingRevision: null,
      reusePolicy: 'test',
    } as any);
    const { GET, POST } = await import('@/server/api-routes/agents/[name]/chat/stream/route');

    const started = await POST(new Request('http://localhost/api/agents/demo/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'diagnostic prompt' }),
    }), { params: { name: 'demo' } });
    const { streamId } = await started.json();
    const response = await GET(new Request(`http://localhost/api/agents/demo/chat/stream?id=${streamId}`));
    const body = await response.text();
    const match = body.match(/event: engine_error\ndata: (.+)\n\n/);
    const payload = JSON.parse(match?.[1] || '{}');

    expect(payload).toMatchObject({
      message: providerError,
      source: 'api-provider',
      sourceLabel: 'API 提供商响应',
      engine: 'codex',
      model: 'demo-model',
    });
  });
});
