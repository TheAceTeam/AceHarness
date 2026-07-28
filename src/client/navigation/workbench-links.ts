export type WorkbenchMode = 'run' | 'design';

export function buildWorkbenchSearch(mode: WorkbenchMode = 'run', runId?: string | null) {
  const normalizedMode: WorkbenchMode = mode === 'design' ? 'design' : 'run';
  const params = new URLSearchParams();
  params.set('mode', normalizedMode);
  if (runId) {
    params.set('mode', 'run');
    params.set('runId', runId);
    params.set('history', '1');
  }
  return params.toString();
}

export function buildWorkbenchPath(configFile: string, mode: WorkbenchMode = 'run', runId?: string | null) {
  const encoded = encodeURIComponent(configFile);
  const normalizedMode: WorkbenchMode = mode === 'design' ? 'design' : 'run';
  const search = buildWorkbenchSearch(normalizedMode, runId);
  return `/workbench/${encoded}${search ? `?${search}` : ''}`;
}

export function buildDashboardWorkbenchPath(configFile: string, mode: WorkbenchMode = 'run', runId?: string | null) {
  const params = new URLSearchParams();
  params.set('route', buildWorkbenchPath(configFile, mode, runId));
  return `/dashboard?${params.toString()}`;
}
