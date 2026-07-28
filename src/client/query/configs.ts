import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type WorkflowSortKey = 'name' | 'createdAt';
export type SortDirection = 'asc' | 'desc';

export type WorkflowConfigSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
  phaseCount?: number;
  stepCount?: number;
  agentCount?: number;
  createdAt?: number | string;
  visibility?: 'private' | 'shared' | 'public';
  ownerName?: string;
};

export type ConfigListParams = {
  page: number;
  pageSize: number;
  keyword?: string;
  mode?: string;
  sortKey?: WorkflowSortKey;
  sortDirection?: SortDirection;
};

export type ConfigListResponse = {
  files: Array<string>;
  configs: Array<WorkflowConfigSummary>;
  pagination: {
    total: number;
    totalPages: number;
    page: number;
    pageSize: number;
    unfilteredTotal: number;
  };
};

export type WorkflowConfigResponse = {
  config: Record<string, unknown>;
  raw?: string;
  agents?: Array<unknown>;
  meta?: Record<string, unknown>;
  validation?: Record<string, unknown>;
};

export function buildConfigsPath(params: ConfigListParams) {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.keyword) search.set('keyword', params.keyword);
  if (params.mode && params.mode !== 'all') search.set('mode', params.mode);
  if (params.sortKey) search.set('sortKey', params.sortKey);
  if (params.sortDirection) search.set('sortDirection', params.sortDirection);
  return `/api/configs?${search.toString()}`;
}

export function useConfigsQuery(params: ConfigListParams) {
  return useQuery({
    queryKey: queryKeys.configs(params),
    queryFn: () => apiRequest<ConfigListResponse>(buildConfigsPath(params)),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useWorkflowConfigQuery(filename: string) {
  return useQuery({
    queryKey: queryKeys.config(filename),
    queryFn: () => apiRequest<WorkflowConfigResponse>(`/api/configs/${encodeURIComponent(filename)}`),
    enabled: Boolean(filename),
    staleTime: 15_000,
  });
}

export type ConfigOptionsParams = {
  keyword?: string;
  mode?: string;
  sortKey?: WorkflowSortKey;
  sortDirection?: SortDirection;
};

export function useConfigOptionsQuery(params: ConfigOptionsParams = {}) {
  const queryParams = {
    page: 1,
    pageSize: 500,
    sortKey: params.sortKey ?? 'name',
    sortDirection: params.sortDirection ?? 'asc',
    keyword: params.keyword,
    mode: params.mode,
  } satisfies ConfigListParams;

  return useQuery({
    queryKey: queryKeys.configOptions(queryParams),
    queryFn: () => apiRequest<ConfigListResponse>(buildConfigsPath(queryParams)),
    staleTime: 60_000,
  });
}
