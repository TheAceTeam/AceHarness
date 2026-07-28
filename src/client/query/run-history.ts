import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type HistoryView = 'runs' | 'token-ranking';
export type TokenRankingDimension = 'workflow' | 'user';
export type RunSortKey = 'name' | 'startTime' | 'totalTokens' | 'cost';
export type TokenRankingSortKey = 'name' | 'totalTokens' | 'runs' | 'cost';
export type SortDirection = 'asc' | 'desc';

export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

export type RunHistoryItem = TokenUsageSummary & {
  id: string;
  configFile: string;
  configName: string;
  parentRunId?: string;
  rootRunId?: string;
  parentConfigFile?: string;
  parentStateName?: string;
  parentStepId?: string;
  parentStepName?: string;
  childRunIds?: Array<string>;
  childRuns?: Array<RunHistoryItem>;
  startTime: string;
  endTime: string | null;
  status: string;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  totalTokens: number;
  cost: number;
  ownerId: string;
  ownerName: string;
};

export type TokenRankingItem = TokenUsageSummary & {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  cost: number;
};

export type RunHistoryParams = {
  page: number;
  pageSize: number;
  view?: HistoryView;
  dimension?: TokenRankingDimension;
  sortKey?: RunSortKey | TokenRankingSortKey;
  sortDirection?: SortDirection;
  ownerId?: string;
  keyword?: string;
  tree?: boolean;
};

export type RunHistoryResponse = {
  view: HistoryView;
  runs?: Array<RunHistoryItem>;
  rankings?: Array<TokenRankingItem>;
  tree?: boolean;
  pagination: {
    total: number;
    totalPages: number;
    page: number;
    pageSize: number;
  };
  filters: {
    view: HistoryView;
    dimension: TokenRankingDimension;
    sortKey: RunSortKey | TokenRankingSortKey;
    sortDirection: SortDirection;
    ownerId: string;
    keyword: string;
  };
  userOptions: Array<{ id: string; username: string }>;
  isAdmin: boolean;
};

export function buildRunHistoryPath(params: RunHistoryParams) {
  const search = new URLSearchParams();
  search.set('page', String(params.page));
  search.set('pageSize', String(params.pageSize));
  if (params.view) search.set('view', params.view);
  if (params.dimension) search.set('dimension', params.dimension);
  if (params.sortKey) search.set('sortKey', params.sortKey);
  if (params.sortDirection) search.set('sortDirection', params.sortDirection);
  if (params.ownerId) search.set('ownerId', params.ownerId);
  if (params.keyword) search.set('keyword', params.keyword);
  if (params.tree) search.set('tree', '1');
  return `/api/run-history?${search.toString()}`;
}

export function useRunHistoryQuery(params: RunHistoryParams) {
  return useQuery({
    queryKey: queryKeys.runHistory(params),
    queryFn: () => apiRequest<RunHistoryResponse>(buildRunHistoryPath(params)),
    placeholderData: (previous) => previous,
    staleTime: 10_000,
  });
}
