// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { queryKeys } from '@/client/query/query-keys';

const mockPush = vi.fn();
vi.mock('@/lib/navigation/client', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import AuthGuard from '@/components/AuthGuard';

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

function renderAuthGuard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <AuthGuard>
        <div data-testid="protected-content">Protected Page</div>
      </AuthGuard>
    </QueryClientProvider>
  );

  return { ...result, queryClient };
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ user: { id: 'u1', username: 'test' } }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders children for cookie-backed auth without a localStorage token', async () => {
    renderAuthGuard();

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      credentials: 'same-origin',
    }));
    expect(localStorage.getItem('auth-token')).toBeNull();
  });

  test('redirects to /login and clears storage when auth token is invalid', async () => {
    localStorage.setItem('auth-token', 'invalid-token');
    localStorage.setItem('auth-user', JSON.stringify({ username: 'stale' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { error: 'Unauthorized' },
      { status: 401 },
    ));

    const { queryClient } = renderAuthGuard();
    queryClient.setQueryData(queryKeys.auth.currentUser(), { id: 'stale', username: 'stale' });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    await waitFor(() => {
      expect(localStorage.getItem('auth-token')).toBeNull();
      expect(localStorage.getItem('auth-user')).toBeNull();
      expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toBeUndefined();
    });
  });

  test('renders children when auth token is valid', async () => {
    localStorage.setItem('auth-token', 'valid-token');

    const { queryClient } = renderAuthGuard();
    queryClient.setQueryData(queryKeys.auth.currentUser(), { id: 'stale', username: 'stale' });

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      headers: expect.any(Headers),
    }));
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect((requestInit?.headers as Headers).get('authorization')).toBe('Bearer valid-token');

    await waitFor(() => {
      const storedUser = localStorage.getItem('auth-user');
      expect(storedUser).toBeTruthy();
      expect(JSON.parse(storedUser!)).toEqual({ id: 'u1', username: 'test' });
    });
  });

  test('shows loading state while checking authentication', async () => {
    localStorage.setItem('auth-token', 'valid-token');
    // Make fetch hang to keep loading state visible
    let resolveFetch!: (value: Response) => void;
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise((resolve) => { resolveFetch = resolve; })
    );

    renderAuthGuard();

    // Loading text should be visible
    expect(screen.getByText('加载中...')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();

    // Resolve the fetch
    await act(async () => {
      resolveFetch(jsonResponse({ user: { id: 'u1', username: 'test' } }));
    });

    // Now children should render
    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });

  test('redirects to /login when fetch throws a network error', async () => {
    localStorage.setItem('auth-token', 'valid-token');
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network error'));

    renderAuthGuard();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    await waitFor(() => {
      expect(localStorage.getItem('auth-token')).toBeNull();
    });
  });

  test('listens for auth:expired event and redirects to /login', async () => {
    localStorage.setItem('auth-token', 'valid-token');

    const { queryClient } = renderAuthGuard();
    queryClient.setQueryData(queryKeys.auth.currentUser(), { id: 'stale', username: 'stale' });

    // Wait for initial auth check to complete
    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    await act(async () => {
      window.dispatchEvent(new Event('auth:expired'));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(localStorage.getItem('auth-user')).toBeNull();
      expect(queryClient.getQueryData(queryKeys.auth.currentUser())).toBeUndefined();
    });
  });
});
