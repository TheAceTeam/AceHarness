import { createFileRoute, useNavigate } from '@tanstack/react-router';
import ModelsPage from '@/client/pages/ModelsPage';

export type ModelsSearch = {
  tab?: 'catalog' | 'probe' | 'diagnostics';
};

export const Route = createFileRoute('/models')({
  validateSearch: normalizeModelsSearch,
  component: ModelsRoute,
});

function ModelsRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/models' });
  return (
    <ModelsPage
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

export function normalizeModelsSearch(search: Record<string, unknown>): ModelsSearch {
  return {
    tab: isModelsTab(search.tab) ? search.tab : 'catalog',
  };
}

function isModelsTab(value: unknown): value is NonNullable<ModelsSearch['tab']> {
  return value === 'catalog' || value === 'probe' || value === 'diagnostics';
}
