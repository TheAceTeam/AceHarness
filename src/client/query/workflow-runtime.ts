import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import type { HumanQuestion } from '@/lib/run/state-persistence';

export type PagedResponse<T> = {
  runId: string;
  items?: Array<T>;
  events?: Array<T>;
  nextSeq?: number;
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
};

export type WorkflowRuntimePageParams = {
  configFile: string;
  runId?: string;
  offset?: number;
  limit?: number;
  afterSeq?: number;
};

export type WorkflowHumanQuestionsParams = {
  configFile?: string;
  runId?: string;
  status?: HumanQuestion['status'];
  limit?: number;
};

export type RunDocumentsParams = {
  runId?: string;
  offset?: number;
  limit?: number;
  includeChildren?: boolean;
  scope?: 'root' | 'children' | 'child';
  childRunId?: string;
  groupKey?: string;
  documentKind?: 'conclusion' | 'detail';
  summaryOnly?: boolean;
  sortDirection?: 'asc' | 'desc';
};

export type WorkflowEventsResponse<T = Record<string, unknown>> = PagedResponse<T> & {
  events: Array<T>;
  nextSeq: number;
};

export type WorkflowItemsResponse<T = Record<string, unknown>> = PagedResponse<T> & {
  items: Array<T>;
};

export type WorkflowHumanQuestionsResponse = {
  questions: Array<HumanQuestion>;
};

export type RunDocumentsResponse = {
  runId: string;
  includeChildren?: boolean;
  files: Array<Record<string, unknown>>;
  aceDir?: string;
  documentDirectory?: string;
  childRuns?: Array<Record<string, unknown>>;
  pagination?: PagedResponse<Record<string, unknown>>['pagination'];
  lazy?: {
    content: boolean;
    summaryOnly: boolean;
    groupKey: string | null;
    scope: string;
  };
};

export function buildWorkflowStatusCompactPath(configFile: string, runId?: string) {
  const search = new URLSearchParams();
  search.set('compact', '1');
  search.set('configFile', configFile);
  if (runId) search.set('runId', runId);
  return `/api/workflow/status?${search.toString()}`;
}

export function fetchWorkflowStatusCompact(configFile: string, runId?: string) {
  return apiRequest<Record<string, unknown>>(buildWorkflowStatusCompactPath(configFile, runId));
}

export function buildWorkflowEventsPath({ runId, afterSeq = 0, limit = 100 }: WorkflowRuntimePageParams) {
  const search = new URLSearchParams();
  search.set('runId', runId || '');
  search.set('afterSeq', String(afterSeq));
  search.set('limit', String(limit));
  return `/api/workflow/event-log?${search.toString()}`;
}

export function fetchWorkflowEvents(params: WorkflowRuntimePageParams) {
  return apiRequest<WorkflowEventsResponse>(buildWorkflowEventsPath(params));
}

export function buildWorkflowStateHistoryPath({ runId, offset = 0, limit = 100 }: WorkflowRuntimePageParams) {
  const search = new URLSearchParams();
  search.set('runId', runId || '');
  search.set('offset', String(offset));
  search.set('limit', String(limit));
  return `/api/workflow/state-history?${search.toString()}`;
}

export function fetchWorkflowStateHistory(params: WorkflowRuntimePageParams) {
  return apiRequest<WorkflowItemsResponse>(buildWorkflowStateHistoryPath(params));
}

export function buildWorkflowStepLogsPath({ runId, offset = 0, limit = 100 }: WorkflowRuntimePageParams) {
  const search = new URLSearchParams();
  search.set('runId', runId || '');
  search.set('offset', String(offset));
  search.set('limit', String(limit));
  return `/api/workflow/step-logs?${search.toString()}`;
}

export function fetchWorkflowStepLogs(params: WorkflowRuntimePageParams) {
  return apiRequest<WorkflowItemsResponse>(buildWorkflowStepLogsPath(params));
}

export function buildWorkflowHumanQuestionsPath(params: WorkflowHumanQuestionsParams = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.runId) search.set('runId', params.runId);
  if (params.configFile) search.set('configFile', params.configFile);
  if (params.limit) search.set('limit', String(params.limit));
  const query = search.toString();
  return `/api/workflow/human-questions${query ? `?${query}` : ''}`;
}

export function fetchWorkflowHumanQuestions(params: WorkflowHumanQuestionsParams = {}) {
  return apiRequest<WorkflowHumanQuestionsResponse>(buildWorkflowHumanQuestionsPath(params));
}

export function buildRunDocumentsPath(params: RunDocumentsParams) {
  const runId = params.runId || '';
  const search = new URLSearchParams();
  search.set('includeChildren', params.includeChildren ? '1' : '0');
  search.set('offset', String(params.offset ?? 0));
  search.set('limit', String(params.limit ?? 100));
  if (params.scope) search.set('scope', params.scope);
  if (params.childRunId) search.set('childRunId', params.childRunId);
  if (params.groupKey) search.set('groupKey', params.groupKey);
  if (params.documentKind) search.set('documentKind', params.documentKind);
  if (params.summaryOnly) search.set('summaryOnly', '1');
  if (params.sortDirection) search.set('sortDirection', params.sortDirection);
  return `/api/runs/${encodeURIComponent(runId)}/documents?${search.toString()}`;
}

export function fetchRunDocuments(params: RunDocumentsParams) {
  return apiRequest<RunDocumentsResponse>(buildRunDocumentsPath(params));
}

export function useWorkflowStatusCompactQuery(configFile: string, runId?: string) {
  return useQuery({
    queryKey: queryKeys.workflowStatusCompact(configFile, runId),
    queryFn: () => fetchWorkflowStatusCompact(configFile, runId),
    enabled: Boolean(configFile),
    staleTime: 1_000,
  });
}

export function useWorkflowEventsQuery({ configFile, runId, afterSeq = 0, limit = 100 }: WorkflowRuntimePageParams) {
  return useQuery({
    queryKey: queryKeys.workflowEvents(configFile, runId || '', { afterSeq, limit }),
    queryFn: () => fetchWorkflowEvents({ configFile, runId, afterSeq, limit }),
    enabled: Boolean(runId),
    staleTime: 2_000,
  });
}

export function useWorkflowStateHistoryQuery({ configFile, runId, offset = 0, limit = 100 }: WorkflowRuntimePageParams) {
  return useQuery({
    queryKey: queryKeys.workflowStateHistory(configFile, runId || '', { offset, limit }),
    queryFn: () => fetchWorkflowStateHistory({ configFile, runId, offset, limit }),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
    staleTime: 5_000,
  });
}

export function useWorkflowStepLogsQuery({ configFile, runId, offset = 0, limit = 100 }: WorkflowRuntimePageParams) {
  return useQuery({
    queryKey: queryKeys.workflowStepLogs(configFile, runId || '', { offset, limit }),
    queryFn: () => fetchWorkflowStepLogs({ configFile, runId, offset, limit }),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
    staleTime: 5_000,
  });
}

export function useWorkflowHumanQuestionsQuery(params: WorkflowHumanQuestionsParams = {}) {
  const queryParams = {
    configFile: params.configFile || '',
    runId: params.runId || '',
    status: params.status || '',
    limit: params.limit ?? 50,
  };
  return useQuery({
    queryKey: queryKeys.workflowHumanQuestions(queryParams),
    queryFn: () => fetchWorkflowHumanQuestions(params),
    enabled: Boolean(params.configFile || params.runId || params.status),
    placeholderData: (previous) => previous,
    staleTime: 2_000,
  });
}

export function useRunDocumentsQuery(runId?: string, offset = 0, limit = 100, options: Omit<RunDocumentsParams, 'runId' | 'offset' | 'limit'> = {}) {
  const params = { runId, offset, limit, ...options };
  return useQuery({
    queryKey: queryKeys.workflowRunDocuments(runId || '', {
      offset,
      limit,
      includeChildren: options.includeChildren ?? false,
      scope: options.scope || '',
      childRunId: options.childRunId || '',
      groupKey: options.groupKey || '',
      documentKind: options.documentKind || '',
      summaryOnly: options.summaryOnly ?? false,
      sortDirection: options.sortDirection || '',
    }),
    queryFn: () => fetchRunDocuments(params),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}
