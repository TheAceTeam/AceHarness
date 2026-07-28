import { createFileRoute } from '@tanstack/react-router';
import NotebookPage from '@/client/pages/NotebookPage';
import type { NotebookScope } from '@/lib/core/api';

export type NotebookSearch = {
  notebook?: '1';
  notebookScope?: NotebookScope;
  notebookFile?: string;
  notebookShare?: string;
  notebookPermission?: 'read' | 'write';
  returnTo?: string;
};

export const Route = createFileRoute('/notebook')({
  validateSearch: normalizeNotebookSearch,
  component: NotebookRoute,
});

function NotebookRoute() {
  const search = Route.useSearch();
  return <NotebookPage routeSearch={search} />;
}

export function normalizeNotebookSearch(search: Record<string, unknown>): NotebookSearch {
  return {
    notebook: search.notebook === '1' ? '1' : undefined,
    notebookScope: search.notebookScope === 'personal' ? 'personal' : 'global',
    notebookFile: normalizeSearchText(search.notebookFile),
    notebookShare: normalizeSearchText(search.notebookShare),
    notebookPermission: search.notebookPermission === 'read' ? 'read' : 'write',
    returnTo: normalizeSearchText(search.returnTo),
  };
}

function normalizeSearchText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
