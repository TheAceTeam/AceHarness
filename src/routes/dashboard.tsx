import { createFileRoute } from '@tanstack/react-router';
import DashboardPageShell from '@/components/dashboard/DashboardPageShell';

export type DashboardSearch = {
  panel?: 'chat' | 'overview' | 'agents' | 'skills' | 'settings';
  route?: string;
};

const EMBEDDED_DASHBOARD_ROUTE_BASES = new Set([
  '/office',
  '/workflows',
  '/models',
  '/engines',
  '/schedules',
  '/run-history',
  '/knowledge',
  '/knowledge/library',
  '/notebook',
  '/account',
  '/account/system-settings',
  '/account/channels',
  '/users',
  '/api-docs',
]);

export const Route = createFileRoute('/dashboard')({
  validateSearch: normalizeDashboardSearch,
  component: DashboardPageShell,
});

export function normalizeDashboardSearch(search: Record<string, unknown>): DashboardSearch {
  const route = normalizeEmbeddedDashboardRoute(search.route);
  return {
    panel: route ? undefined : normalizeDashboardPanel(search.panel),
    route,
  };
}

function normalizeDashboardPanel(value: unknown): DashboardSearch['panel'] {
  return value === 'chat' || value === 'overview' || value === 'agents' || value === 'skills' || value === 'settings'
    ? value
    : undefined;
}

function normalizeEmbeddedDashboardRoute(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return undefined;
  const basePath = getEmbeddedRouteBasePath(trimmed);
  if (basePath === '/dashboard' || basePath.startsWith('/dashboard/')) return undefined;
  if (basePath.startsWith('/workbench/')) return trimmed;
  return EMBEDDED_DASHBOARD_ROUTE_BASES.has(basePath) ? trimmed : undefined;
}

function getEmbeddedRouteBasePath(route: string): string {
  return route.split(/[?#]/, 1)[0] || '/';
}
