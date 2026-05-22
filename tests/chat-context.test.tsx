// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ChatProvider, useChat } from '@/contexts/ChatContext';

const ACTIVE_SESSION_STORAGE_KEY = 'aceharness:chat:active-session-id';
let sessionSummaries: any[] = [];

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

describe('ChatProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, 'sess-2');

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

  test('deleting the active agora topic does not fall back to a normal conversation', async () => {
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

    expect(screen.getByTestId('active-session').textContent).toBe('none');
  });

  test('batch deleting active agora topics leaves no active selection when only conversations remain', async () => {
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

    expect(screen.getByTestId('active-session').textContent).toBe('none');
  });
});
