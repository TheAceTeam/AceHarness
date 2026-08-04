'use client';

import { createContext, useContext } from 'react';
import type { AddPanelPositionOptions } from 'dockview';

export type DashboardDockTab =
  | { id: 'chat'; title: string; kind: 'chat' }
  | { id: 'overview'; title: string; kind: 'overview' }
  | { id: 'agents'; title: string; kind: 'agents' }
  | { id: 'skills'; title: string; kind: 'skills' }
  | { id: 'settings'; title: string; kind: 'settings' }
  | { id: 'channels'; title: string; kind: 'channels' }
  | { id: 'users'; title: string; kind: 'users' }
  | { id: 'workflows'; title: string; kind: 'workflows' }
  | { id: 'models'; title: string; kind: 'models' }
  | { id: 'engines'; title: string; kind: 'engines' }
  | { id: 'schedules'; title: string; kind: 'schedules' }
  | { id: 'run-history'; title: string; kind: 'run-history'; search?: string }
  | { id: 'knowledge'; title: string; kind: 'knowledge' }
  | { id: 'knowledge-library'; title: string; kind: 'knowledge-library' }
  | { id: 'api-docs'; title: string; kind: 'api-docs' }
  | { id: 'office'; title: string; kind: 'office' }
  | { id: string; title: string; kind: 'notebook'; search?: string }
  | { id: string; title: string; kind: 'account'; search?: string }
  | { id: string; title: string; kind: 'workbench'; config: string; mode?: string; runId?: string | null; search?: string };

export type DashboardDockOpenOptions = {
  position?: AddPanelPositionOptions;
};

export type DashboardDockWorkspaceHandle = {
  openTab: (tab: DashboardDockTab, options?: DashboardDockOpenOptions) => void;
  refreshActiveTab: () => void;
};

export type DashboardDockWorkspaceContextValue = {
  openTab: (tab: DashboardDockTab, options?: DashboardDockOpenOptions) => void;
  updateActiveWorkbenchSearch: (config: string, search: string) => void;
  updateActiveRunHistorySearch: (search: string) => void;
  updateActiveNotebookSearch: (search: string) => void;
};

export const DashboardDockWorkspaceContext = createContext<DashboardDockWorkspaceContextValue | null>(null);

export function useDashboardDockWorkspace() {
  return useContext(DashboardDockWorkspaceContext);
}
