import { describe, expect, test, vi, beforeEach } from 'vitest';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';
import { MockEngine } from './helpers/mock-engine';

vi.mock('@/lib/engines/engine-factory', () => ({
  getOrCreateEngine: vi.fn(),
  getConfiguredEngine: vi.fn().mockResolvedValue('mock-engine'),
}));

vi.mock('@/lib/process-manager', () => ({
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

vi.mock('@/lib/chat-stream-state', () => ({
  registerEngineStream: vi.fn(),
  appendEngineStreamContent: vi.fn(),
  setEngineStreamSessionId: vi.fn(),
  setEngineStreamStatus: vi.fn(),
  getEngineStream: vi.fn().mockReturnValue(null),
  getEngineStreamByFrontendSessionId: vi.fn().mockReturnValue(null),
  removeEngineStream: vi.fn(),
}));

vi.mock('@/lib/chat-settings', () => ({
  loadChatSettings: vi.fn().mockResolvedValue({
    skills: {},
    workingDirectory: '/tmp',
  }),
}));

vi.mock('@/lib/chat-system-prompt', () => ({
  buildDashboardSystemPrompt: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('@/lib/app-paths', () => ({
  getRepoRoot: vi.fn().mockReturnValue('/tmp/repo'),
  getWorkspaceDataFile: vi.fn().mockReturnValue('/tmp/workspace-data'),
  getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
}));

vi.mock('@/lib/runtime-skills', () => ({
  getRuntimeSkillsDirPath: vi.fn().mockResolvedValue('/tmp/skills'),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineConfigDir: vi.fn().mockReturnValue('.engine'),
}));

vi.mock('@/lib/chat-persistence', () => ({
  loadChatSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/spec-coding-store', () => ({
  loadCreationSession: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/workflow-registry', () => ({
  workflowRegistry: {
    getManager: vi.fn(),
  },
}));

vi.mock('@/lib/run-state-persistence', () => ({
  loadRunState: vi.fn().mockResolvedValue(null),
}));

describe('chat stream flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('POST returns 400 for empty message', async () => {
    const { POST } = await import('@/app/api/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: '' },
    }));

    await assertErrorResponse(response, 400);
  });

  test('POST returns 500 when engine is unavailable', async () => {
    const { getOrCreateEngine } = await import('@/lib/engines/engine-factory');
    (getOrCreateEngine as any).mockResolvedValue(null);

    const { POST } = await import('@/app/api/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello' },
    }));

    expect(response.status).toBe(500);
    const json = await responseJson(response);
    expect(json.error).toContain('不可用');
  });

  test('POST returns chatId on success', async () => {
    const engine = new MockEngine({ success: true, output: 'Hello!' });
    const { getOrCreateEngine } = await import('@/lib/engines/engine-factory');
    (getOrCreateEngine as any).mockResolvedValue(engine);

    const { POST } = await import('@/app/api/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: { message: 'Hello', mode: 'dashboard' },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.chatId).toMatch(/^chat-/);
  });

  test('DELETE cancels engine and returns killed=true', async () => {
    const engine = new MockEngine();
    const { getOrCreateEngine } = await import('@/lib/engines/engine-factory');
    (getOrCreateEngine as any).mockResolvedValue(engine);

    // First create a chat to get a chatId
    const { POST, DELETE } = await import('@/app/api/chat/stream/route');
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
    const { GET } = await import('@/app/api/chat/stream/route');
    const response = await GET(makeRequest('/api/chat/stream'));

    await assertErrorResponse(response, 400);
  });
});
