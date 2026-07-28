import { beforeEach, describe, expect, test, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  loadChatSession: vi.fn(),
  saveChatSession: vi.fn(),
  deleteChatSession: vi.fn(),
  loadRunState: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: routeMocks.loadChatSession,
  saveChatSession: routeMocks.saveChatSession,
  deleteChatSession: routeMocks.deleteChatSession,
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: routeMocks.loadRunState,
}));

function makeRequest(path: string, init?: ConstructorParameters<typeof Request>[1]) {
  return new Request(`http://localhost${path}`, init);
}

function makeSession(id: string, patch: Record<string, any> = {}) {
  return {
    id,
    title: id,
    model: 'test-model',
    createdAt: 1,
    updatedAt: 2,
    messages: [],
    createdBy: 'user-1',
    ...patch,
  };
}

describe('chat session delete protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.requireAuth.mockResolvedValue({ id: 'user-1', role: 'user' });
    routeMocks.deleteChatSession.mockResolvedValue(true);
    routeMocks.loadRunState.mockResolvedValue(null);
  });

  test('DELETE rejects a workflow conversation when persisted run state is active', async () => {
    routeMocks.loadChatSession.mockResolvedValue(makeSession('chat-run', {
      workflowBinding: {
        configFile: 'workflow.yaml',
        runId: 'run-active',
        createdAt: 1,
        updatedAt: 2,
      },
    }));
    routeMocks.loadRunState.mockResolvedValue({ runId: 'run-active', status: 'running' });

    const route = await import('@/server/api-routes/chat/sessions/[id]/route');
    const response = await route.DELETE(makeRequest('/api/chat/sessions/chat-run'), {
      params: Promise.resolve({ id: 'chat-run' }),
    });

    expect(response.status).toBe(409);
    expect(routeMocks.deleteChatSession).not.toHaveBeenCalled();
  });

  test('DELETE rejects a workflow-running conversation even without persisted run state', async () => {
    routeMocks.loadChatSession.mockResolvedValue(makeSession('chat-mode', {
      conversationMode: 'workflow-running',
      sessionWorkbenchState: { conversationMode: 'workflow-running' },
      workflowBinding: {
        configFile: 'workflow.yaml',
        runId: 'run-missing-state',
        createdAt: 1,
        updatedAt: 2,
      },
    }));
    routeMocks.loadRunState.mockResolvedValue(null);

    const route = await import('@/server/api-routes/chat/sessions/[id]/route');
    const response = await route.DELETE(makeRequest('/api/chat/sessions/chat-mode'), {
      params: Promise.resolve({ id: 'chat-mode' }),
    });

    expect(response.status).toBe(409);
    expect(routeMocks.deleteChatSession).not.toHaveBeenCalled();
  });

  test('batch-delete skips protected running workflow conversations and deletes the rest', async () => {
    const sessions = new Map([
      ['plain-1', makeSession('plain-1')],
      ['run-1', makeSession('run-1', {
        workflowBinding: {
          configFile: 'workflow.yaml',
          runId: 'run-active',
          createdAt: 1,
          updatedAt: 2,
        },
      })],
    ]);
    routeMocks.loadChatSession.mockImplementation(async (id: string) => sessions.get(id) || null);
    routeMocks.loadRunState.mockImplementation(async (runId: string) => (
      runId === 'run-active' ? { runId, status: 'waiting-human' } : null
    ));

    const route = await import('@/server/api-routes/chat/sessions/batch-delete/route');
    const response = await route.POST(makeRequest('/api/chat/sessions/batch-delete', {
      method: 'POST',
      body: JSON.stringify({ ids: ['plain-1', 'run-1'] }),
    }));
    const body = await response.json();

    expect(response.status).toBe(207);
    expect(body.deleted).toEqual(['plain-1']);
    expect(body.protectedRunning).toEqual(['run-1']);
    expect(routeMocks.deleteChatSession).toHaveBeenCalledTimes(1);
    expect(routeMocks.deleteChatSession).toHaveBeenCalledWith('plain-1');
  });
});
