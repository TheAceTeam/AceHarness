// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import WorkflowsPage from '@/client/pages/WorkflowsPage';

const apiMocks = vi.hoisted(() => ({
  listCreationSessions: vi.fn(),
  listShareableUsers: vi.fn(),
}));

vi.mock('@/lib/core/api', () => ({
  configApi: {},
  specCodingApi: {
    listCreationSessions: apiMocks.listCreationSessions,
  },
  usersApi: {
    listShareableUsers: apiMocks.listShareableUsers,
  },
}));

describe('WorkflowsPage Start client entry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      configs: [],
      pagination: {
        total: 0,
        totalPages: 1,
        page: 1,
        pageSize: 20,
        unfilteredTotal: 0,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    apiMocks.listCreationSessions.mockResolvedValue({ sessions: [] });
    apiMocks.listShareableUsers.mockResolvedValue([]);
  });

  test('renders the restored workflow manager empty state', async () => {
    renderWithQuery(<WorkflowsPage />);

    expect(screen.getByRole('heading', { name: '工作流管理' })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('还没有工作流')).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/configs?page=1&pageSize=500&sortKey=name&sortDirection=asc'),
      expect.any(Object),
    );
  });

  test('consumes typed route search for workflow filters and emits typed sort updates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      configs: [
        {
          filename: 'alpha.yaml',
          name: 'Alpha Flow',
          mode: 'phase-based',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          filename: 'beta.yaml',
          name: 'Beta Machine',
          mode: 'state-machine',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      pagination: {
        total: 2,
        totalPages: 1,
        page: 1,
        pageSize: 20,
        unfilteredTotal: 2,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }) as any);
    const onRouteSearchChange = vi.fn();

    renderWithQuery(
      <WorkflowsPage
        routeSearch={{
          keyword: 'Beta',
          mode: 'state-machine',
          sortKey: 'createdAt',
          sortDirection: 'desc',
          page: 1,
          pageSize: 20,
        }}
        onRouteSearchChange={onRouteSearchChange}
      />,
    );

    expect(await screen.findByText('Beta Machine')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Flow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /名称/ }));
    expect(onRouteSearchChange).toHaveBeenCalledWith(expect.objectContaining({
      keyword: 'Beta',
      mode: 'state-machine',
      sortKey: 'name',
      sortDirection: 'asc',
      page: 1,
      pageSize: 20,
    }));
  });
});

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
}
