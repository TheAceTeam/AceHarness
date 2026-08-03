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

vi.mock('@/components/NewConfigModal', () => ({
  default: ({
    isOpen,
    initialMode,
    initialRequirements,
    aiGuidedEntry,
  }: {
    isOpen: boolean;
    initialMode?: string;
    initialRequirements?: string;
    aiGuidedEntry?: boolean;
  }) => isOpen ? (
    <div data-testid="new-config-modal" data-mode={initialMode} data-ai-guided-entry={String(Boolean(aiGuidedEntry))}>
      {initialRequirements}
    </div>
  ) : null,
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

  test('AI guided creation opens the explicit AI planning entry', async () => {
    renderWithQuery(<WorkflowsPage />);

    const buttons = await screen.findAllByRole('button', { name: /AI 引导创建/ });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);

    expect(screen.getByTestId('new-config-modal')).toHaveAttribute('data-mode', 'ai-guided');
    expect(screen.getByTestId('new-config-modal')).toHaveAttribute('data-ai-guided-entry', 'true');
    expect(screen.getByTestId('new-config-modal')).toHaveTextContent('我想围绕【目标】创建一个工作流');
  });

  test('consumes typed route search for workflow filters and emits typed sort updates', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      configs: [
        {
          filename: 'alpha.yaml',
          name: 'Alpha Flow',
          mode: 'state-machine',
          kind: 'lightweight',
          profile: 'lightweight',
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

  test('shows lightweight workflows as a distinct kind and filters them without phase modes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      configs: [
        {
          filename: 'tasklist.yaml',
          name: 'Tasklist Flow',
          mode: 'state-machine',
          kind: 'lightweight',
          profile: 'lightweight',
          stateCount: 1,
          stepCount: 1,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          filename: 'orchestration.yaml',
          name: 'Orchestration',
          mode: 'state-machine',
          kind: 'state-machine',
          stateCount: 3,
          stepCount: 5,
          createdAt: '2026-01-04T00:00:00.000Z',
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

    renderWithQuery(
      <WorkflowsPage
        routeSearch={{
          keyword: '',
          mode: 'lightweight',
          sortKey: 'createdAt',
          sortDirection: 'desc',
          page: 1,
          pageSize: 20,
        }}
      />,
    );

    expect(await screen.findByText('Tasklist Flow')).toBeInTheDocument();
    expect(screen.getAllByText('轻量工作流').length).toBeGreaterThan(0);
    expect(screen.queryByText('Orchestration')).not.toBeInTheDocument();
    expect(screen.queryByText('阶段模式')).not.toBeInTheDocument();
  });

  test('normalizes an ai-guided route filter to all persisted workflow modes', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      configs: [
        {
          filename: 'tasklist.yaml',
          name: 'Tasklist Flow',
          mode: 'state-machine',
          kind: 'lightweight',
          profile: 'lightweight',
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          filename: 'state-machine.yaml',
          name: 'State Machine Flow',
          mode: 'state-machine',
          kind: 'state-machine',
          createdAt: '2026-01-04T00:00:00.000Z',
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

    renderWithQuery(
      <WorkflowsPage
        routeSearch={{
          keyword: '',
          mode: 'ai-guided' as never,
          sortKey: 'createdAt',
          sortDirection: 'desc',
          page: 1,
          pageSize: 20,
        }}
      />,
    );

    expect(await screen.findByText('Tasklist Flow')).toBeInTheDocument();
    expect(screen.getByText('State Machine Flow')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')[0]).toHaveTextContent('全部模式');
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
