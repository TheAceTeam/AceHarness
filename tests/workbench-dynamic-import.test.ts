import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

describe('Workbench dynamic module boundary', () => {
  test('loads WorkbenchClient through the Vite module graph', async () => {
    const module = await import('@/client/pages/workbench/WorkbenchClient');

    expect(module.default).toBeTypeOf('function');
  });

  test('keeps the dashboard context outside the dashboard provider module', async () => {
    const module = await import('@/components/dashboard/dashboard-dock-workspace-context');
    const workbenchSource = await readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8');

    expect(module.DashboardDockWorkspaceContext).toBeDefined();
    expect(module.useDashboardDockWorkspace).toBeTypeOf('function');
    expect(workbenchSource).toContain('dashboard-dock-workspace-context');
    expect(workbenchSource).not.toContain('components/dashboard/DashboardDockWorkspace');
  });

});
