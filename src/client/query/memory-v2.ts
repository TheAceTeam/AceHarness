import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import type {
  MemoryDetailPage,
  MemoryGovernanceAction,
  MemoryGovernanceAuditRecord,
  MemoryGovernanceRecord,
  MemoryHandoff,
  MemoryHandoffBatchStatus,
  MemoryHandoffIndexSnapshot,
  MemoryHandoffReceiptRecord,
  MemoryHandoffStatus,
  MemoryItemStatus,
  MemoryServiceBudgets,
  MemorySourceProvenance,
  MemoryV2StoreCutoverDiagnostics,
  PersistedMemoryRetention,
} from '@/lib/memory-v2';
import type { MemoryV2CutoverStatus } from '@/lib/memory-v2-cutover/feature-flag';
import type { MemoryV2CutoverTelemetry } from '@/lib/memory-v2-cutover/telemetry';

export type MemoryV2GovernanceFilters = {
  statuses?: MemoryItemStatus[];
  retentions?: PersistedMemoryRetention[];
  ownerUserId?: string;
  offset?: number;
  limit?: number;
  memoryId?: string;
  auditLimit?: number;
};

export type MemoryV2DetailParams = {
  memoryId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
};

export type MemoryV2GovernanceResponse = {
  items: MemoryGovernanceRecord[];
  total: number;
  pagination: {
    offset: number;
    limit: number;
    nextOffset: number | null;
  };
  audit: MemoryGovernanceAuditRecord[];
};

export type MemoryV2GovernanceDetailResponse = {
  page: MemoryDetailPage;
};

export type MemoryV2GovernanceActionInput = {
  action: MemoryGovernanceAction;
  memoryId: string;
  expectedDetailVersion: number;
  expectedFingerprint?: string;
  reason?: string;
  replacementMemoryId?: string;
  requestedRetention?: PersistedMemoryRetention;
};

export type MemoryV2GovernanceActionResponse = {
  result: {
    action: MemoryGovernanceAction;
    memoryId: string;
    status: MemoryItemStatus;
    detailVersion: number;
    idempotent: boolean;
    replacement?: {
      memoryId: string;
      retention: PersistedMemoryRetention;
      summary: string;
      detailVersion: number;
      status: MemoryItemStatus;
    };
  };
};

export type MemoryV2Diagnostics = {
  status: MemoryV2CutoverStatus;
  telemetry: MemoryV2CutoverTelemetry;
  budgets?: MemoryServiceBudgets;
  store?: MemoryV2StoreCutoverDiagnostics;
  legacyZeroAccess: {
    contentReadsAllowed: false;
    verified: boolean;
    deniedAttempts: number;
  };
};

export type WorkflowMemoryHandoffDetailAccess =
  | { state: 'allowed'; mode: 'admin' | 'owner' }
  | { state: 'denied'; reason: 'requires-run-owner-or-admin' };

export type WorkflowMemoryHandoffReadState = {
  required: boolean;
  state: 'not-required' | 'blocked' | 'acknowledged' | 'pending' | 'unread';
  receiptCount: number;
};

export type WorkflowMemoryHandoffReceipt = Pick<
  MemoryHandoffReceiptRecord,
  'targetStepAttemptId' | 'targetAgentId' | 'detailVersion' | 'status' | 'createdAt' | 'updatedAt'
>;

export type WorkflowMemoryHandoffIndexSnapshot = Omit<MemoryHandoffIndexSnapshot, 'fingerprint'> & {
  source: MemorySourceProvenance;
};

export type WorkflowMemoryHandoff = {
  id: string;
  memoryId: string;
  detailVersion: number;
  mode: Exclude<MemoryHandoff['mode'], 'none'>;
  target: MemoryHandoff;
  status: MemoryHandoffStatus;
  indexSnapshot: WorkflowMemoryHandoffIndexSnapshot | null;
  resolvedTargets: Array<{
    targetStepAttemptId: string;
    targetAgentId: string;
  }>;
  receipts: WorkflowMemoryHandoffReceipt[];
  detailAccess: WorkflowMemoryHandoffDetailAccess;
  readState: WorkflowMemoryHandoffReadState;
};

export type WorkflowMemoryHandoffBatch = {
  id: string;
  sourceStepAttemptId: string;
  status: MemoryHandoffBatchStatus;
  parentRunId?: string;
  parentStepAttemptId?: string;
  createdAt: string;
  updatedAt: string;
  handoffs: WorkflowMemoryHandoff[];
};

export type WorkflowMemoryHandoffFilters = {
  statuses?: MemoryHandoffStatus[];
  batchStatuses?: MemoryHandoffBatchStatus[];
  modes?: Array<Exclude<MemoryHandoff['mode'], 'none'>>;
  targets?: Array<Exclude<MemoryHandoff['target'], 'none'>>;
  requiredRead?: boolean;
  offset?: number;
  limit?: number;
};

export type WorkflowMemoryHandoffsResponse = {
  runId: string;
  state: 'available' | 'uninitialized';
  items: WorkflowMemoryHandoffBatch[];
  pagination: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
  totals?: {
    batches: number;
    handoffs: number;
    receipts: number;
  };
};

export type WorkflowMemoryHandoffDetailParams = {
  runId: string;
  handoffId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
};

export type WorkflowMemoryHandoffDetailResponse = {
  runId: string;
  handoffId: string;
  detailVersion: number;
  detailAccess: WorkflowMemoryHandoffDetailAccess;
  readState?: WorkflowMemoryHandoffReadState;
  handoffState?: 'uninitialized';
  error?: string;
  page?: MemoryDetailPage;
};

function appendArray(search: URLSearchParams, key: string, values: readonly string[] | undefined) {
  values?.forEach((value) => search.append(key, value));
}

export function buildMemoryV2GovernancePath(filters: MemoryV2GovernanceFilters = {}) {
  const search = new URLSearchParams();
  appendArray(search, 'status', filters.statuses);
  appendArray(search, 'retention', filters.retentions);
  if (filters.ownerUserId) search.set('ownerUserId', filters.ownerUserId);
  if (filters.offset !== undefined) search.set('offset', String(filters.offset));
  if (filters.limit !== undefined) search.set('limit', String(filters.limit));
  if (filters.memoryId) search.set('memoryId', filters.memoryId);
  if (filters.auditLimit) search.set('auditLimit', String(filters.auditLimit));
  const query = search.toString();
  return `/api/memory-v2/governance${query ? `?${query}` : ''}`;
}

export function fetchMemoryV2Governance(filters: MemoryV2GovernanceFilters = {}) {
  return apiRequest<MemoryV2GovernanceResponse>(buildMemoryV2GovernancePath(filters));
}

export function buildMemoryV2GovernanceDetailPath(params: MemoryV2DetailParams) {
  const search = new URLSearchParams({
    memoryId: params.memoryId,
    detailVersion: String(params.detailVersion),
  });
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.maxChars) search.set('maxChars', String(params.maxChars));
  return `/api/memory-v2/governance/details?${search.toString()}`;
}

export function fetchMemoryV2GovernanceDetail(params: MemoryV2DetailParams) {
  return apiRequest<MemoryV2GovernanceDetailResponse>(buildMemoryV2GovernanceDetailPath(params));
}

export function postMemoryV2GovernanceAction(input: MemoryV2GovernanceActionInput) {
  return apiRequest<MemoryV2GovernanceActionResponse>('/api/memory-v2/governance/actions', {
    method: 'POST',
    body: input,
  });
}

export function fetchMemoryV2Diagnostics() {
  return apiRequest<MemoryV2Diagnostics>('/api/memory-v2/diagnostics');
}

export function buildWorkflowMemoryHandoffsPath(runId: string, filters: WorkflowMemoryHandoffFilters = {}) {
  const search = new URLSearchParams();
  appendArray(search, 'status', filters.statuses);
  appendArray(search, 'batchStatus', filters.batchStatuses);
  appendArray(search, 'mode', filters.modes);
  appendArray(search, 'target', filters.targets);
  if (filters.requiredRead !== undefined) search.set('requiredRead', String(filters.requiredRead));
  if (filters.offset !== undefined) search.set('offset', String(filters.offset));
  if (filters.limit !== undefined) search.set('limit', String(filters.limit));
  const query = search.toString();
  return `/api/memory-v2/workflows/${encodeURIComponent(runId)}/handoffs${query ? `?${query}` : ''}`;
}

export function fetchWorkflowMemoryHandoffs(runId: string, filters: WorkflowMemoryHandoffFilters = {}) {
  return apiRequest<WorkflowMemoryHandoffsResponse>(buildWorkflowMemoryHandoffsPath(runId, filters));
}

export function buildWorkflowMemoryHandoffDetailPath(params: WorkflowMemoryHandoffDetailParams) {
  const search = new URLSearchParams({ detailVersion: String(params.detailVersion) });
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.maxChars) search.set('maxChars', String(params.maxChars));
  return `/api/memory-v2/workflows/${encodeURIComponent(params.runId)}/handoffs/${encodeURIComponent(params.handoffId)}/details?${search.toString()}`;
}

export function fetchWorkflowMemoryHandoffDetail(params: WorkflowMemoryHandoffDetailParams) {
  return apiRequest<WorkflowMemoryHandoffDetailResponse>(buildWorkflowMemoryHandoffDetailPath(params));
}

export function useMemoryV2GovernanceQuery(filters: MemoryV2GovernanceFilters = {}) {
  const queryFilters = {
    statuses: filters.statuses || [],
    retentions: filters.retentions || [],
    ownerUserId: filters.ownerUserId || '',
    offset: filters.offset ?? 0,
    limit: filters.limit ?? 100,
    memoryId: filters.memoryId || '',
    auditLimit: filters.auditLimit ?? 20,
  };
  const requestFilters: MemoryV2GovernanceFilters = {
    ...(filters.statuses?.length ? { statuses: filters.statuses } : {}),
    ...(filters.retentions?.length ? { retentions: filters.retentions } : {}),
    ...(filters.ownerUserId ? { ownerUserId: filters.ownerUserId } : {}),
    offset: queryFilters.offset,
    limit: queryFilters.limit,
    ...(filters.memoryId ? { memoryId: filters.memoryId } : {}),
    auditLimit: queryFilters.auditLimit,
  };
  return useQuery({
    queryKey: queryKeys.memoryV2.governance(queryFilters),
    queryFn: () => fetchMemoryV2Governance(requestFilters),
    staleTime: 10_000,
  });
}

export function useMemoryV2GovernanceDetailQuery(params: MemoryV2DetailParams | null) {
  const queryParams = {
    cursor: params?.cursor || '',
    maxChars: params?.maxChars ?? 4_000,
  };
  const requestParams = params ? { ...params, maxChars: queryParams.maxChars } : null;
  return useQuery({
    queryKey: queryKeys.memoryV2.governanceDetail(params?.memoryId || '', params?.detailVersion || 0, queryParams),
    queryFn: () => fetchMemoryV2GovernanceDetail(requestParams!),
    enabled: Boolean(requestParams?.memoryId && requestParams.detailVersion > 0),
    staleTime: 60_000,
  });
}

export function useMemoryV2GovernanceActionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: postMemoryV2GovernanceAction,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.memoryV2.root() });
    },
  });
}

export function useMemoryV2DiagnosticsQuery() {
  return useQuery({
    queryKey: queryKeys.memoryV2.diagnostics(),
    queryFn: fetchMemoryV2Diagnostics,
    staleTime: 10_000,
  });
}

export function useWorkflowMemoryHandoffsQuery(
  runId: string | null | undefined,
  filters: WorkflowMemoryHandoffFilters = {},
) {
  const queryFilters = {
    statuses: filters.statuses || [],
    batchStatuses: filters.batchStatuses || [],
    modes: filters.modes || [],
    targets: filters.targets || [],
    requiredRead: filters.requiredRead ?? null,
    offset: filters.offset ?? 0,
    limit: filters.limit ?? 50,
  };
  const requestFilters: WorkflowMemoryHandoffFilters = {
    ...(filters.statuses?.length ? { statuses: filters.statuses } : {}),
    ...(filters.batchStatuses?.length ? { batchStatuses: filters.batchStatuses } : {}),
    ...(filters.modes?.length ? { modes: filters.modes } : {}),
    ...(filters.targets?.length ? { targets: filters.targets } : {}),
    ...(filters.requiredRead !== undefined ? { requiredRead: filters.requiredRead } : {}),
    offset: queryFilters.offset,
    limit: queryFilters.limit,
  };
  return useQuery({
    queryKey: queryKeys.memoryV2.workflowHandoffs(runId || '', queryFilters),
    queryFn: () => fetchWorkflowMemoryHandoffs(runId || '', requestFilters),
    enabled: Boolean(runId),
    placeholderData: (previous) => previous,
    staleTime: 5_000,
  });
}

export function useWorkflowMemoryHandoffDetailQuery(
  params: WorkflowMemoryHandoffDetailParams | null,
  enabled = true,
) {
  const queryParams = {
    cursor: params?.cursor || '',
    maxChars: params?.maxChars ?? 4_000,
  };
  const requestParams = params ? { ...params, maxChars: queryParams.maxChars } : null;
  return useQuery({
    queryKey: queryKeys.memoryV2.workflowHandoffDetail(
      params?.runId || '',
      params?.handoffId || '',
      params?.detailVersion || 0,
      queryParams,
    ),
    queryFn: () => fetchWorkflowMemoryHandoffDetail(requestParams!),
    enabled: Boolean(enabled && requestParams?.runId && requestParams.handoffId && requestParams.detailVersion > 0),
    staleTime: 60_000,
  });
}
