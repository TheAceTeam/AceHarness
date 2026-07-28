import { createFileRoute, useNavigate } from '@tanstack/react-router';
import KnowledgeLibraryPage from '@/client/pages/KnowledgeLibraryPage';

export type KnowledgeLibrarySearch = {
  kb?: string;
  document?: string;
};

export const Route = createFileRoute('/knowledge/library')({
  validateSearch: normalizeKnowledgeLibrarySearch,
  component: KnowledgeLibraryRoute,
});

function KnowledgeLibraryRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/knowledge/library' });
  return (
    <KnowledgeLibraryPage
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

export function normalizeKnowledgeLibrarySearch(search: Record<string, unknown>): KnowledgeLibrarySearch {
  return {
    kb: normalizeSearchText(search.kb),
    document: normalizeSearchText(search.document),
  };
}

function normalizeSearchText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
