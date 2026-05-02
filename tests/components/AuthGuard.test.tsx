// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';

// Mock next/navigation
const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

import AuthGuard from '@/components/AuthGuard';

function renderAuthGuard() {
  return render(
    <AuthGuard>
      <div data-testid="protected-content">Protected Page</div>
    </AuthGuard>
  );
}

describe('AuthGuard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Default: mock fetch to succeed
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: { id: 'u1', username: 'test' } }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('redirects to /login when no auth token exists in localStorage', async () => {
    renderAuthGuard();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    // Should not render children while checking
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  test('redirects to /login and clears storage when auth token is invalid', async () => {
    localStorage.setItem('auth-token', 'invalid-token');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    } as Response);

    renderAuthGuard();

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });

    await waitFor(() => {
      expect(localStorage.getItem('auth-token')).toBeNull();
      expect(localStorage.getItem('auth-user')).toBeNull();
    });
  });

  test('renders children when auth token is valid', async () => {
    localStorage.setItem('auth-token', 'valid-token');

    renderAuthGuard();

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    // Should not redirect
    expect(mockPush).not.toHaveBeenCalled();

    // Should persist user info
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
      resolveFetch({
        ok: true,
        json: () => Promise.resolve({ user: { id: 'u1' } }),
      } as Response);
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

    renderAuthGuard();

    // Wait for initial auth check to complete
    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });

    // Simulate auth:expired event (as dispatched by authFetch on 401)
    await act(async () => {
      window.dispatchEvent(new Event('auth:expired'));
    });

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
      expect(localStorage.getItem('auth-user')).toBeNull();
    });
  });
});
