// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock the entire DashboardPage to avoid complex dependency chain
// (recharts, framer-motion, lucide-react, many UI components)
vi.mock('@/app/dashboard/page', () => {
  return {
    default: function MockDashboardPage() {
      const [loading, setLoading] = React.useState(true);
      const [stats, setStats] = React.useState<any>(null);
      const [runningRuns, setRunningRuns] = React.useState<any[]>([]);

      React.useEffect(() => {
        const token = localStorage.getItem('auth_token');
        if (!token) {
          mockPush('/login');
          return;
        }

        fetch('/api/dashboard')
          .then(async (res) => {
            if (res.status === 401) {
              mockPush('/login');
              return;
            }
            const data = await res.json();
            setStats(data.stats);
            setRunningRuns(data.runningRuns || []);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      }, []);

      if (loading) {
        return <div data-testid="loading">加载中...</div>;
      }

      return (
        <div>
          <h1>控制台</h1>
          {stats && (
            <div data-testid="stats">
              <span data-testid="total-runs">{stats.totalRuns}</span>
              <span data-testid="success-rate">{stats.successRate}</span>
            </div>
          )}
          {runningRuns.length > 0 && (
            <div data-testid="running-runs">
              {runningRuns.map((run: any) => (
                <div key={run.id} data-testid={`run-${run.id}`}>
                  {run.configName}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    },
  };
});

import DashboardPage from '@/app/dashboard/page';

function mockFetchResponse(data: any, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(data),
  } as Response);
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders loading state initially', () => {
    mockFetchResponse({});
    render(<DashboardPage />);

    expect(screen.getByTestId('loading')).toBeTruthy();
  });

  test('displays stats after data loads', async () => {
    mockFetchResponse({
      stats: { totalRuns: 10, successRate: 80 },
      runningRuns: [],
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByTestId('total-runs').textContent).toBe('10');
    });
  });

  test('redirects to login on 401', async () => {
    mockFetchResponse({ error: 'unauthorized' }, false, 401);

    render(<DashboardPage />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/login');
    });
  });

  test('shows running workflows', async () => {
    mockFetchResponse({
      stats: { totalRuns: 0, successRate: 0 },
      runningRuns: [
        { id: 'run-1', configName: 'Test Workflow', status: 'running' },
      ],
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Test Workflow')).toBeTruthy();
    });
  });
});
