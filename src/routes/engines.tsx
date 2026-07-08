import { createFileRoute, useNavigate } from '@tanstack/react-router';
import EnginesPage from '@/client/pages/EnginesPage';

export type EnginesSearch = {
  engine?: string;
};

const VALID_ENGINE_IDS = new Set([
  'claude-code',
  'kiro-cli',
  'opencode',
  'nga',
  'codegenie',
  'codex',
  'cursor',
  'trae-cli',
  'magic-cli',
]);

export const Route = createFileRoute('/engines')({
  validateSearch: normalizeEnginesSearch,
  component: EnginesRoute,
});

function EnginesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/engines' });
  return (
    <EnginesPage
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

export function normalizeEnginesSearch(search: Record<string, unknown>): EnginesSearch {
  return {
    engine: isEngineId(search.engine) ? search.engine : undefined,
  };
}

function isEngineId(value: unknown): value is string {
  return typeof value === 'string' && VALID_ENGINE_IDS.has(value);
}
