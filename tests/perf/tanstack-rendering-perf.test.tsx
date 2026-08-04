// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('TanStack Start rendering performance gates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiMocks.listCreationSessions.mockResolvedValue({ sessions: [] });
    apiMocks.listShareableUsers.mockResolvedValue([]);
  });

  test('workflow config list keeps rendered DOM rows bounded for large result sets', async () => {
    const configs = Array.from({ length: 1000 }, (_, index) => ({
      filename: `workflow-${index}.yaml`,
      name: `Workflow ${index}`,
      description: `Workflow ${index} description`,
      mode: 'state-machine',
      createdAt: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      stepCount: 8,
      stateCount: 8,
      agentCount: 3,
    }));
    const firstPage = configs.slice(0, 500);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      configs: firstPage,
      pagination: {
        total: configs.length,
        totalPages: 2,
        page: 1,
        pageSize: 500,
        unfilteredTotal: configs.length,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    renderWithQuery(<WorkflowsPage />);

    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(21);
    }, { timeout: 5_000 });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/configs?page=1&pageSize=500&sortKey=name&sortDirection=asc'),
      expect.any(Object),
    );
    expect(screen.queryByText('Workflow 20')).not.toBeInTheDocument();
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
