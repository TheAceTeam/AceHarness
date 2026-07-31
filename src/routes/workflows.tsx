import { createFileRoute, useNavigate } from '@tanstack/react-router';
import WorkflowsPage from '@/client/pages/WorkflowsPage';

export type WorkflowsSearch = {
  keyword?: string;
  mode?: 'all' | 'state-machine' | 'lightweight';
  sortKey?: 'name' | 'createdAt';
  sortDirection?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export const Route = createFileRoute('/workflows')({
  validateSearch: (search: Record<string, unknown>): WorkflowsSearch => ({
    keyword: typeof search.keyword === 'string' ? search.keyword : '',
    mode: isWorkflowMode(search.mode) ? search.mode : 'all',
    sortKey: search.sortKey === 'name' ? 'name' : 'createdAt',
    sortDirection: search.sortDirection === 'asc' ? 'asc' : 'desc',
    page: toPositiveNumber(search.page, 1),
    pageSize: isPageSize(search.pageSize) ? Number(search.pageSize) : 20,
  }),
  component: WorkflowsRoute,
});

function WorkflowsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/workflows' });
  return (
    <WorkflowsPage
      routeSearch={search}
      onRouteSearchChange={(next) => {
        void navigate({
          search: (prev) => ({
            ...prev,
            ...next,
          }),
        });
      }}
    />
  );
}

function isWorkflowMode(value: unknown): value is NonNullable<WorkflowsSearch['mode']> {
  return value === 'all' || value === 'state-machine' || value === 'lightweight';
}

function isPageSize(value: unknown) {
  return value === 20 || value === 50 || value === 100 || value === '20' || value === '50' || value === '100';
}

function toPositiveNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}
