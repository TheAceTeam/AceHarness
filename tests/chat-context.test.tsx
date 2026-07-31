// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatProvider, useChat } from '@/contexts/ChatContext';
import { buildForkSessionOptions, createForkedCollaborationWorkbenchState } from '@/lib/chat/fork-session';

const ACTIVE_SESSION_STORAGE_KEY = 'aceharness:chat:active-session-id';
let sessionSummaries: any[] = [];
let sessionStore: Record<string, any> = {};
let missingSessionIds = new Set<string>();
let streamStateBySessionId: Record<string, any> = {};
const INITIAL_WORKFLOW_LIVE_STATE = {
  connected: false,
  pendingHumanQuestions: [],
  runStatusById: {},
  workflowStatusByConfig: {},
  chatStreamsBySessionId: {},
  chatSessionSignalsById: {},
  lastEventAt: null as number | null,
};
let workflowLiveState = { ...INITIAL_WORKFLOW_LIVE_STATE };
const workflowLiveListeners = new Set<() => void>();

function resetWorkflowLiveState() {
  workflowLiveState = { ...INITIAL_WORKFLOW_LIVE_STATE };
  workflowLiveListeners.forEach((listener) => listener());
}

function setWorkflowLiveState(patch: Partial<typeof INITIAL_WORKFLOW_LIVE_STATE>) {
  workflowLiveState = {
    ...workflowLiveState,
    ...patch,
  };
  workflowLiveListeners.forEach((listener) => listener());
}

vi.mock('@/lib/workflow/live-store', async () => {
  const ReactModule = await import('react');
  return {
    useWorkflowLiveState: () => ReactModule.useSyncExternalStore(
      (listener) => {
        workflowLiveListeners.add(listener);
        return () => {
          workflowLiveListeners.delete(listener);
        };
      },
      () => workflowLiveState,
      () => workflowLiveState,
    ),
  };
});

vi.mock('@/client/query/engines', () => ({
  useRuntimeEngineSelectionQuery: () => ({
    data: {
      engine: 'claude-code',
      model: 'claude-sonnet-4-20250514',
      defaultModel: 'claude-sonnet-4-20250514',
      isReady: true,
    },
    isLoading: false,
    isFetching: false,
    isError: false,
  }),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jsonResponse(data: any, ok = true) {
  return {
    ok,
    json: async () => data,
  } as Response;
}

function ContextProbe() {
  const { sessions, activeSessionId, setActiveSessionId, deleteSession, deleteSessions } = useChat();
  return (
    <div>
      <div data-testid="session-count">{sessions.length}</div>
      <div data-testid="active-session">{activeSessionId ?? 'none'}</div>
      <button type="button" onClick={() => setActiveSessionId('agora-1')}>select-agora</button>
      <button type="button" onClick={() => deleteSession('agora-1')}>delete-agora</button>
      <button type="button" onClick={() => deleteSessions(['agora-1', 'agora-2'])}>delete-agora-batch</button>
    </div>
  );
}

function StreamingProbe() {
  const { sessions, activeSessionId, activeSession, setActiveSessionId, sendMessage } = useChat();
  const sess1 = sessions.find((session) => session.id === 'sess-1');
  const sess2 = sessions.find((session) => session.id === 'sess-2');
  return (
    <div>
      <div data-testid="stream-active-session">{activeSessionId ?? 'none'}</div>
      <div data-testid="stream-message-count">{activeSession?.messages.length ?? 0}</div>
      <div data-testid="stream-messages">{(activeSession?.messages || []).map((message) => message.content).join('|')}</div>
      <div data-testid="sess-1-last">{sess1?.lastMessage ?? ''}</div>
      <div data-testid="sess-2-last">{sess2?.lastMessage ?? ''}</div>
      <button type="button" onClick={() => setActiveSessionId('sess-1')}>open-sess-1</button>
      <button type="button" onClick={() => setActiveSessionId('sess-2')}>open-sess-2</button>
      <button type="button" onClick={() => { void sendMessage('hello from sess-1'); }}>send-hello</button>
    </div>
  );
}

function NewSessionSendProbe() {
  const { sessions, activeSession, createSession, isModelSelectionReady, sendMessage } = useChat();
  return (
    <div>
      <div data-testid="new-session-ready">{isModelSelectionReady ? 'ready' : 'loading'}</div>
      <div data-testid="new-session-count">{sessions.length}</div>
      <div data-testid="new-session-last">{sessions[0]?.lastMessage || ''}</div>
      <div data-testid="new-session-messages">{(activeSession?.messages || []).map((message) => message.content).join('|')}</div>
      <button
        type="button"
        onClick={() => {
          const sessionId = createSession({
            title: '新对话',
            agentBinding: { agentName: 'dev-agent' },
            sessionWorkbenchState: {
              chatWorkspace: {
                workingDirectory: '/tmp/project',
                autoCreated: false,
                gitBaselineReady: true,
                updatedAt: Date.now(),
              },
            },
          });
          void sendMessage('首条消息', { targetSessionId: sessionId });
        }}
      >
        send-first-message
      </button>
    </div>
  );
}

function LiveStateProbe() {
  const { activeSessionId, activeStreamingSessionIds, recentlyCompletedSessionIds, setActiveSessionId } = useChat();
  return (
    <div>
      <div data-testid="live-active-session">{activeSessionId ?? 'none'}</div>
      <div data-testid="live-streaming-count">{activeStreamingSessionIds.length}</div>
      <div data-testid="live-completed-count">{recentlyCompletedSessionIds.length}</div>
      <button type="button" onClick={() => setActiveSessionId('sess-1')}>open-live-sess-1</button>
    </div>
  );
}

describe('ChatProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-2');
    resetWorkflowLiveState();

    vi.stubGlobal('EventSource', class MockEventSource {
      close() {}
    });

    sessionSummaries = [
      {
        id: 'sess-1',
        title: '第一条',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 3,
      },
      {
        id: 'sess-2',
        title: '第二条',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 4,
        messageCount: 1,
      },
    ];
    sessionStore = {
      'sess-1': {
        id: 'sess-1',
        title: '第一条',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 1,
        updatedAt: 2,
      },
      'sess-2': {
        id: 'sess-2',
        title: '第二条',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 3,
        updatedAt: 4,
      },
    };
    missingSessionIds = new Set();
    streamStateBySessionId = {};

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        return jsonResponse({
          sessions: sessionSummaries,
        });
      }
      if (url.startsWith('/api/chat/sessions/')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/sessions/')[1] || '');
        if (missingSessionIds.has(sessionId)) {
          return jsonResponse({ session: null }, false);
        }
        return jsonResponse({ session: sessionStore[sessionId] || null }, Boolean(sessionStore[sessionId]));
      }
      if (url.startsWith('/api/chat/stream?checkActive=')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/stream?checkActive=')[1] || '');
        return jsonResponse(streamStateBySessionId[sessionId] || { active: false });
      }
      return jsonResponse({});
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test('loads session summaries and restores the stored active session', async () => {
    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2');
    });

    await waitFor(() => {
      expect(screen.getByTestId('active-session').textContent).toBe('sess-2');
    });
    expect(sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBe('sess-2');
  });

  test('reloads session summaries after login completes in an already mounted provider', async () => {
    localStorage.removeItem('auth-token');
    let sessionListCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        sessionListCalls += 1;
        if (!localStorage.getItem('auth-token')) {
          return jsonResponse({ error: '未登录或登录已过期' }, false);
        }
        return jsonResponse({ sessions: sessionSummaries });
      }
      if (url.startsWith('/api/chat/stream?checkActive=')) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({});
    }));

    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(sessionListCalls).toBe(1);
    });
    expect(screen.getByTestId('session-count').textContent).toBe('0');

    act(() => {
      localStorage.setItem('auth-token', 'token-after-login');
      window.dispatchEvent(new CustomEvent('auth:changed'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2');
    });
  });

  test('drops a stale stored active session id when it no longer exists', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'missing-session');

    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2');
    });

    expect(screen.getByTestId('active-session').textContent).toBe('none');
    expect(sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY)).toBeNull();
  });

  test('keeps a new first message visible while session creation and initial list loading are delayed', async () => {
    sessionStorage.clear();
    sessionSummaries = [];
    sessionStore = {};
    const initialList = createDeferred<Response>();
    const createResponse = createDeferred<Response>();
    let createBody: any = null;
    const putBodies: any[] = [];

    vi.stubGlobal('fetch', vi.fn((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          createBody = body;
          return createResponse.promise.then((response) => {
            sessionStore[body.id] = body;
            return response;
          });
        }
        return initialList.promise;
      }
      if (url.startsWith('/api/chat/sessions/')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/sessions/')[1] || '');
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body || '{}'));
          putBodies.push(body);
          if (!sessionStore[sessionId]) {
            return jsonResponse({ error: '会话不存在' }, false);
          }
          sessionStore[sessionId] = body;
          return jsonResponse({ ok: true });
        }
        return jsonResponse({ session: sessionStore[sessionId] || null }, Boolean(sessionStore[sessionId]));
      }
      if (url === '/api/agents/dev-agent/chat') {
        return jsonResponse({
          output: '首条回复',
          sessionId: 'backend-new-session',
          engine: 'claude-code',
          model: 'claude-sonnet-4-20250514',
        });
      }
      if (url.startsWith('/api/chat/stream?checkActive=')) {
        return jsonResponse({ active: false });
      }
      return jsonResponse({});
    }) as typeof fetch));

    render(
      <ChatProvider>
        <NewSessionSendProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('new-session-ready').textContent).toBe('ready');
    });

    fireEvent.click(screen.getByText('send-first-message'));

    await waitFor(() => {
      expect(screen.getByTestId('new-session-messages').textContent).toContain('首条消息');
    });
    await waitFor(() => {
      expect(createBody).not.toBeNull();
    });
    await waitFor(() => {
      expect(screen.getByTestId('new-session-last').textContent).toBe('首条回复');
    });

    act(() => {
      initialList.resolve(jsonResponse({
        sessions: [{
          id: createBody.id,
          title: '新对话',
          model: 'claude-sonnet-4-20250514',
          createdAt: createBody.createdAt,
          updatedAt: createBody.updatedAt + 1000,
          messageCount: 0,
        }],
      }));
    });
    await waitFor(() => {
      expect(screen.getByTestId('new-session-count').textContent).toBe('1');
    });
    expect(screen.getByTestId('new-session-last').textContent).toBe('首条回复');

    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(putBodies).toEqual([]);

    act(() => {
      createResponse.resolve(jsonResponse({ ok: true }));
    });
    await waitFor(() => {
      expect(putBodies).toHaveLength(1);
    });
    expect(sessionStore[createBody.id].messages.map((message: any) => message.content)).toContain('首条消息');
  });

  test('sanitizes the sidebar session preview when recovered assistant content includes a chunk boundary tail', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');
    sessionSummaries = [
      {
        id: 'sess-1',
        title: '第一条',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 2,
        lastMessage: '<!-- chunk-boundary --> {"active":false',
      },
      {
        id: 'sess-2',
        title: '第二条',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 4,
        messageCount: 0,
      },
    ];
    sessionStore = {
      'sess-1': {
        id: 'sess-1',
        title: '第一条',
        model: 'claude-sonnet-4-20250514',
        messages: [
          { id: 'u-1', role: 'user', content: '请回复一个json：{"active":false}', timestamp: 1 },
          {
            id: 'a-1',
            role: 'assistant',
            content: '<!-- chunk-boundary -->\n{"active":false',
            rawContent: '<!-- chunk-boundary -->\n{"active":false',
            timestamp: 2,
          },
        ],
        createdAt: 1,
        updatedAt: 2,
      },
      'sess-2': {
        id: 'sess-2',
        title: '第二条',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 3,
        updatedAt: 4,
      },
    };

    render(
      <ChatProvider>
        <StreamingProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('sess-1-last').textContent).toBe('请回复一个json：{"active":false}');
    });
  });

  test('preserves streamed assistant content when a dashboard stream reports engine_error', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');
    const eventSources: Array<EventTarget & { close: () => void }> = [];
    class MockEventSource extends EventTarget {
      url: string;
      constructor(url: string) {
        super();
        this.url = url;
        eventSources.push(this);
      }
      close() {}
    }
    vi.stubGlobal('EventSource', MockEventSource);
    vi.stubGlobal('fetch', vi.fn((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || 'GET';
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        if (method === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[body.id] = body;
          sessionSummaries = [
            {
              id: body.id,
              title: body.title,
              model: body.model,
              createdAt: body.createdAt,
              updatedAt: body.updatedAt,
              messageCount: body.messages.length,
              lastMessage: body.messages.at(-1)?.content,
            },
            ...sessionSummaries.filter((item) => item.id !== body.id),
          ];
          return jsonResponse({});
        }
        return jsonResponse({ sessions: sessionSummaries });
      }
      if (url.startsWith('/api/chat/sessions/')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/sessions/')[1] || '');
        if (method === 'PUT') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[sessionId] = body;
          sessionSummaries = sessionSummaries.map((item) => item.id === sessionId ? {
            ...item,
            title: body.title,
            updatedAt: body.updatedAt,
            messageCount: body.messages.length,
            lastMessage: body.messages.at(-1)?.content,
          } : item);
          return jsonResponse({});
        }
        return jsonResponse({ session: sessionStore[sessionId] || null }, Boolean(sessionStore[sessionId]));
      }
      if (url.startsWith('/api/chat/stream?checkActive=')) {
        return jsonResponse({ active: false });
      }
      if (url === '/api/chat/stream' && method === 'POST') {
        return jsonResponse({ chatId: 'chat-429' });
      }
      return jsonResponse({});
    }) as typeof fetch));

    render(
      <ChatProvider>
        <StreamingProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });

    fireEvent.click(screen.getByText('send-hello'));

    await waitFor(() => {
      expect(eventSources.length).toBeGreaterThan(0);
    });

    const source = eventSources[0];
    act(() => {
      source.dispatchEvent(new MessageEvent('connected', { data: '{}' }));
      source.dispatchEvent(new MessageEvent('delta', { data: JSON.stringify({ content: '已经生成的内容' }) }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('stream-messages').textContent).toContain('已经生成的内容');
    });

    act(() => {
      source.dispatchEvent(new MessageEvent('engine_error', {
        data: JSON.stringify({
          message: 'exceeded retry limit, last status: 429 Too Many Requests, request id: req_relay_098e0e64',
        }),
      }));
    });

    await waitFor(() => {
      const text = screen.getByTestId('stream-messages').textContent || '';
      expect(text).toContain('已经生成的内容');
      expect(text).toContain('请求失败：exceeded retry limit, last status: 429 Too Many Requests');
    });
  });

  test('deleting the active group chat falls back to the next unified conversation', async () => {
    sessionSummaries = [
      {
        id: 'agora-1',
        title: '议题一',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 10,
        messageCount: 0,
        sessionWorkbenchState: {
          collaborationRoom: {
            topic: '议题一',
          },
        },
      },
      {
        id: 'conv-1',
        title: '普通对话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 2,
        updatedAt: 9,
        messageCount: 0,
      },
    ];

    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2');
    });

    fireEvent.click(screen.getByText('select-agora'));

    await waitFor(() => {
      expect(screen.getByTestId('active-session').textContent).toBe('agora-1');
    });

    fireEvent.click(screen.getByText('delete-agora'));

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1');
    });

    expect(screen.getByTestId('active-session').textContent).toBe('conv-1');
  });

  test('batch deleting active group chats falls back to the remaining unified conversation', async () => {
    sessionSummaries = [
      {
        id: 'agora-1',
        title: '议题一',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 12,
        messageCount: 0,
        sessionWorkbenchState: {
          collaborationRoom: {
            topic: '议题一',
          },
        },
      },
      {
        id: 'agora-2',
        title: '议题二',
        model: 'claude-sonnet-4-20250514',
        createdAt: 2,
        updatedAt: 11,
        messageCount: 0,
        sessionWorkbenchState: {
          collaborationRoom: {
            topic: '议题二',
          },
        },
      },
      {
        id: 'conv-1',
        title: '普通对话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 10,
        messageCount: 0,
      },
    ];

    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('3');
    });

    fireEvent.click(screen.getByText('select-agora'));

    await waitFor(() => {
      expect(screen.getByTestId('active-session').textContent).toBe('agora-1');
    });

    fireEvent.click(screen.getByText('delete-agora-batch'));

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1');
    });

    expect(screen.getByTestId('active-session').textContent).toBe('conv-1');
  });

  test('keeps agent replies attached to the original session after switching active sessions', async () => {
    const agentResponse = createDeferred<Response>();
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');
    sessionSummaries = [
      {
        id: 'sess-1',
        title: 'Agent 会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        agentBinding: {
          agentName: 'dev-agent',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 4,
        messageCount: 0,
      },
    ];
    sessionStore = {
      'sess-1': {
        id: 'sess-1',
        title: 'Agent 会话',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        agentBinding: {
          agentName: 'dev-agent',
          createdAt: 1,
          updatedAt: 1,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      'sess-2': {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 3,
        updatedAt: 4,
      },
    };

    vi.stubGlobal('fetch', vi.fn((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        if ((init?.method || 'GET') === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[body.id] = body;
          sessionSummaries = [
            {
              id: body.id,
              title: body.title,
              model: body.model,
              createdAt: body.createdAt,
              updatedAt: body.updatedAt,
              messageCount: body.messages.length,
              lastMessage: body.messages.at(-1)?.content,
              agentBinding: body.agentBinding,
            },
            ...sessionSummaries.filter((item) => item.id !== body.id),
          ];
          return jsonResponse({});
        }
        return jsonResponse({ sessions: sessionSummaries });
      }
      if (url.startsWith('/api/chat/sessions/')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/sessions/')[1] || '');
        if ((init?.method || 'GET') === 'PUT') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[sessionId] = body;
          sessionSummaries = sessionSummaries.map((item) => item.id === sessionId ? {
            ...item,
            title: body.title,
            updatedAt: body.updatedAt,
            messageCount: body.messages.length,
            lastMessage: body.messages.at(-1)?.content,
            agentBinding: body.agentBinding,
          } : item);
          return jsonResponse({});
        }
        return jsonResponse({ session: sessionStore[sessionId] || null }, Boolean(sessionStore[sessionId]));
      }
      if (url === '/api/agents/dev-agent/chat') {
        return agentResponse.promise;
      }
      return jsonResponse({});
    }) as typeof fetch));

    render(
      <ChatProvider>
        <StreamingProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });

    fireEvent.click(screen.getByText('send-hello'));

    await waitFor(() => {
      expect(screen.getByTestId('sess-1-last').textContent).toBe('hello from sess-1');
    });

    fireEvent.click(screen.getByText('open-sess-2'));

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-2');
    });

    agentResponse.resolve(jsonResponse({
      output: 'reply bound to sess-1',
      runtimeSessionId: 'runtime-sess-1',
      engine: 'claude-code',
      model: 'claude-sonnet-4-20250514',
    }) as Response);

    await waitFor(() => {
      expect(screen.getByTestId('sess-1-last').textContent).toBe('reply bound to sess-1');
    });

    expect(screen.getByTestId('sess-2-last').textContent).toBe('');
  });

  test('restores backend live session snapshot when persisted session data is unavailable', async () => {
    const agentResponse = createDeferred<Response>();
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');
    sessionSummaries = [
      {
        id: 'sess-1',
        title: 'Agent 会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        agentBinding: {
          agentName: 'dev-agent',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 4,
        messageCount: 0,
      },
    ];
    sessionStore = {
      'sess-1': {
        id: 'sess-1',
        title: 'Agent 会话',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        agentBinding: {
          agentName: 'dev-agent',
          createdAt: 1,
          updatedAt: 1,
        },
        createdAt: 1,
        updatedAt: 2,
      },
      'sess-2': {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 3,
        updatedAt: 4,
      },
    };
    missingSessionIds = new Set();

    vi.stubGlobal('fetch', vi.fn((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/engine') {
        return jsonResponse({ engine: 'claude-code', defaultModel: 'claude-sonnet-4-20250514' });
      }
      if (url === '/api/chat/settings') {
        return jsonResponse({ skills: {}, discoveredSkills: [], workingDirectory: '/tmp/project' });
      }
      if (url === '/api/chat/sessions') {
        if ((init?.method || 'GET') === 'POST') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[body.id] = body;
          sessionSummaries = [
            {
              id: body.id,
              title: body.title,
              model: body.model,
              createdAt: body.createdAt,
              updatedAt: body.updatedAt,
              messageCount: body.messages.length,
              lastMessage: body.messages.at(-1)?.content,
              agentBinding: body.agentBinding,
            },
            ...sessionSummaries.filter((item) => item.id !== body.id),
          ];
          return jsonResponse({});
        }
        return jsonResponse({ sessions: sessionSummaries });
      }
      if (url.startsWith('/api/chat/sessions/')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/sessions/')[1] || '');
        if (missingSessionIds.has(sessionId)) {
          return jsonResponse({ session: null }, false);
        }
        if ((init?.method || 'GET') === 'PUT') {
          const body = JSON.parse(String(init?.body || '{}'));
          sessionStore[sessionId] = body;
          sessionSummaries = sessionSummaries.map((item) => item.id === sessionId ? {
            ...item,
            title: body.title,
            updatedAt: body.updatedAt,
            messageCount: body.messages.length,
            lastMessage: body.messages.at(-1)?.content,
            agentBinding: body.agentBinding,
          } : item);
          return jsonResponse({});
        }
        return jsonResponse({ session: sessionStore[sessionId] || null }, Boolean(sessionStore[sessionId]));
      }
      if (url.startsWith('/api/chat/stream?checkActive=')) {
        const sessionId = decodeURIComponent(url.split('/api/chat/stream?checkActive=')[1] || '');
        return jsonResponse(streamStateBySessionId[sessionId] || { active: false });
      }
      if (url === '/api/agents/dev-agent/chat') {
        return agentResponse.promise;
      }
      return jsonResponse({});
    }) as typeof fetch));

    render(
      <ChatProvider>
        <StreamingProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });

    fireEvent.click(screen.getByText('send-hello'));

    await waitFor(() => {
      expect(screen.getByTestId('sess-1-last').textContent).toBe('hello from sess-1');
    });

    fireEvent.click(screen.getByText('open-sess-2'));

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-2');
    });

    missingSessionIds.add('sess-1');
    streamStateBySessionId['sess-1'] = {
      active: false,
      found: true,
      status: 'completed',
      liveSession: {
        id: 'sess-1',
        title: 'Agent 会话',
        model: 'claude-sonnet-4-20250514',
        runtimeSessionId: 'runtime-sess-1',
        agentBinding: {
          agentName: 'dev-agent',
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [
          { id: 'u1', role: 'user', content: 'hello from sess-1', timestamp: 10 },
          { id: 'a1', role: 'assistant', content: 'reply restored from backend', timestamp: 11 },
        ],
        createdAt: 1,
        updatedAt: 12,
      },
    };

    fireEvent.click(screen.getByText('open-sess-1'));

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('stream-messages').textContent).toContain('reply restored from backend');
    });

    agentResponse.resolve(jsonResponse({
      output: 'reply still on sess-1',
      runtimeSessionId: 'runtime-sess-1',
      engine: 'claude-code',
      model: 'claude-sonnet-4-20250514',
    }) as Response);
  });

  test('refreshes the active session from a chat session update signal', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');
    sessionSummaries = [
      {
        id: 'sess-1',
        title: '工作流会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 1,
        updatedAt: 2,
        messageCount: 0,
        workflowBinding: {
          configFile: 'demo.yaml',
          runId: 'run-1',
          createdAt: 1,
          updatedAt: 1,
        },
      },
      {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        createdAt: 3,
        updatedAt: 4,
        messageCount: 0,
      },
    ];
    sessionStore = {
      'sess-1': {
        id: 'sess-1',
        title: '工作流会话',
        model: 'claude-sonnet-4-20250514',
        workflowBinding: {
          configFile: 'demo.yaml',
          runId: 'run-1',
          createdAt: 1,
          updatedAt: 1,
        },
        messages: [],
        createdAt: 1,
        updatedAt: 2,
      },
      'sess-2': {
        id: 'sess-2',
        title: '普通会话',
        model: 'claude-sonnet-4-20250514',
        messages: [],
        createdAt: 3,
        updatedAt: 4,
      },
    };

    render(
      <ChatProvider>
        <StreamingProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('stream-active-session').textContent).toBe('sess-1');
    });
    expect(screen.getByTestId('stream-message-count').textContent).toBe('0');

    sessionStore['sess-1'] = {
      ...sessionStore['sess-1'],
      updatedAt: 20,
      messages: [
        { id: 'a-1', role: 'assistant', content: '后台补回来了', timestamp: 20 },
      ],
    };

    act(() => {
      setWorkflowLiveState({
        chatSessionSignalsById: {
          'sess-1': {
            updatedAt: 20,
          },
        },
        lastEventAt: 20,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('stream-message-count').textContent).toBe('1');
    });
    expect(screen.getByTestId('stream-messages').textContent).toContain('后台补回来了');
    expect(screen.getByTestId('sess-1-last').textContent).toBe('后台补回来了');
  });

  test('does not enter a render loop when a running chat stream state is pushed', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');

    render(
      <ChatProvider>
        <LiveStateProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('live-active-session').textContent).toBe('sess-1');
    });

    expect(() => {
      act(() => {
        setWorkflowLiveState({
          chatStreamsBySessionId: {
            'sess-1': {
              chatId: 'chat-1',
              frontendSessionId: 'sess-1',
              status: 'running',
              updatedAt: 20,
            },
          },
          lastEventAt: 20,
        });
      });
    }).not.toThrow();

    await waitFor(() => {
      expect(screen.getByTestId('live-streaming-count').textContent).toBe('1');
    });
    expect(screen.getByTestId('live-completed-count').textContent).toBe('0');
  });

  test('removes the session and clears the active selection from a chat session removal signal', async () => {
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-1');

    render(
      <ChatProvider>
        <ContextProbe />
      </ChatProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('2');
    });
    await waitFor(() => {
      expect(screen.getByTestId('active-session').textContent).toBe('sess-1');
    });

    act(() => {
      setWorkflowLiveState({
        chatSessionSignalsById: {
          'sess-1': {
            updatedAt: 30,
            removed: true,
          },
        },
        lastEventAt: 30,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('session-count').textContent).toBe('1');
    });
    expect(screen.getByTestId('active-session').textContent).toBe('sess-2');
  });

  test('builds a group chat fork without reusing agent runtime sessions or writable workspace', () => {
    const sourceWorkbenchState = {
      conversationMode: 'agent-chat' as const,
      chatWorkspace: {
        workingDirectory: 'C:/workspaces/original-chat',
        sourceWorkspace: 'C:/repo',
        autoCreated: true,
        gitBaselineReady: true,
        updatedAt: 100,
      },
      collaborationRoom: {
        roomId: 'room-1',
        topic: '是否发布新版本',
        selectedAgents: ['alice', 'bob'],
        mode: 'group-chat' as const,
        agentSessions: {
          alice: 'runtime-agent-session-a',
          bob: 'runtime-agent-session-b',
        },
        messages: [
          {
            id: 'room-message-1',
            speakerType: 'human' as const,
            speakerName: '主持人',
            content: '请讨论发布风险',
            createdAt: 10,
          },
        ],
        rounds: [
          {
            id: 'round-1',
            topic: '是否发布新版本',
            participants: ['alice', 'bob'],
            status: 'completed' as const,
            startedAt: 11,
            completedAt: 12,
          },
        ],
        chatroom: {
          status: 'running' as const,
          topic: '是否发布新版本',
          participants: ['alice', 'bob'],
          rounds: [],
          voteHistory: [],
          summaries: [],
          settings: {
            responseMode: 'mention-driven' as const,
            maxTurnsPerRound: 4,
            maxRepliesPerAgent: 1,
            autoSummarize: true,
            workspacePath: 'C:/workspaces/original-chat',
          },
          participantRoster: [
            {
              id: 'p-alice',
              name: 'alice',
              sourceType: 'agent' as const,
              sourceAgent: 'alice',
              createdAt: 1,
            },
            {
              id: 'p-bob',
              name: 'bob',
              sourceType: 'agent' as const,
              sourceAgent: 'bob',
              createdAt: 2,
            },
          ],
        },
      },
    };
    const activeSession = {
      title: '议场讨论',
      agentBinding: undefined,
      sessionWorkbenchState: sourceWorkbenchState,
      messages: [
        { id: 'u-1', role: 'user' as const, content: '开始议题', timestamp: 1 },
        { id: 'a-1', role: 'assistant' as const, content: '已进入议场', timestamp: 2 },
      ],
    };
    const forkOptions = {
      ...buildForkSessionOptions(activeSession),
      sessionWorkbenchState: createForkedCollaborationWorkbenchState(sourceWorkbenchState),
    };

    expect(forkOptions.title).toBe('议场讨论 分支');
    expect(forkOptions.sessionWorkbenchState?.conversationMode).toBe('agent-chat');
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.topic).toBe('是否发布新版本');
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.selectedAgents).toEqual(['alice', 'bob']);
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.chatroom?.participants).toEqual(['alice', 'bob']);
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.chatroom?.participantRoster?.map((item) => item.name)).toEqual(['alice', 'bob']);
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.messages.map((message) => message.content)).toEqual(['请讨论发布风险']);
    expect(forkOptions.messages.map((message) => message.content)).toEqual(['开始议题', '已进入议场']);
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.agentSessions).toEqual({});
    expect(forkOptions.sessionWorkbenchState?.chatWorkspace?.workingDirectory).not.toBe('C:/workspaces/original-chat');
    expect(forkOptions.sessionWorkbenchState?.collaborationRoom?.chatroom?.settings.workspacePath).not.toBe('C:/workspaces/original-chat');
  });

  test('builds a plain agent chat fork with messages and agent binding intact', () => {
    const agentBinding = {
      agentName: 'dev-agent',
      team: 'blue' as const,
      roleType: 'normal' as const,
      createdAt: 1,
      updatedAt: 2,
    };
    const forkOptions = buildForkSessionOptions({
      title: '普通 Agent 对话',
      agentBinding,
      sessionWorkbenchState: {
        conversationMode: 'agent-chat',
      },
      messages: [
        { id: 'u-1', role: 'user' as const, content: '修一个测试', timestamp: 10 },
        { id: 'a-1', role: 'assistant' as const, content: '测试已补充', timestamp: 20, model: 'model-a' },
      ],
    });

    expect(forkOptions.title).toBe('普通 Agent 对话 分支');
    expect(forkOptions.agentBinding).toEqual(agentBinding);
    expect(forkOptions.sessionWorkbenchState).toEqual({ conversationMode: 'agent-chat' });
    expect(forkOptions.messages).toEqual([
      { role: 'user', content: '修一个测试' },
      { role: 'assistant', content: '测试已补充', model: 'model-a' },
    ]);
  });
});
