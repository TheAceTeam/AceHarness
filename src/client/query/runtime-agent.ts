import { useQuery } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import type {
  RuntimeAgentStateRow,
  RuntimeBenchmarkRunRow,
  RuntimeEventRow,
  RuntimeModelRouteRow,
  RuntimeProbeRunRow,
  RuntimeProjectionRow,
  RuntimeSessionRow,
  RuntimeTurnRow,
} from '@/client/db/runtime-agent-collections';

export type RuntimePageParams = {
  runtimeSessionId: string;
  offset?: number;
  limit?: number;
};

export type RuntimeEventPageParams = {
  runtimeSessionId: string;
  afterSeq?: number;
  limit?: number;
};

export type RuntimeProjectionParams = {
  runtimeSessionId: string;
  projectionVersion: number;
  projection: RuntimeProjectionRow['projection'];
};

export type RuntimeListResponse<T> = {
  items: T[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    nextOffset: number | null;
  };
};

export type RuntimeEventsResponse = {
  events: RuntimeEventRow[];
  nextSeq: number;
};

export type RuntimeSnapshotResponse = {
  sessions?: RuntimeSessionRow[];
  turns?: RuntimeTurnRow[];
  events?: RuntimeEventRow[];
  projections?: RuntimeProjectionRow[];
  agentStates?: RuntimeAgentStateRow[];
  modelRoutes?: RuntimeModelRouteRow[];
  probeRuns?: RuntimeProbeRunRow[];
  benchmarkRuns?: RuntimeBenchmarkRunRow[];
};

export function buildRuntimeSessionPath(runtimeSessionId: string) {
  return `/api/runtime/sessions/${encodeURIComponent(runtimeSessionId)}`;
}

export function buildRuntimeTurnsPath({ runtimeSessionId, offset = 0, limit = 100 }: RuntimePageParams) {
  const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
  return `${buildRuntimeSessionPath(runtimeSessionId)}/turns?${search.toString()}`;
}

export function buildRuntimeEventsPath({ runtimeSessionId, afterSeq = 0, limit = 100 }: RuntimeEventPageParams) {
  const search = new URLSearchParams({ afterSeq: String(afterSeq), limit: String(limit) });
  return `${buildRuntimeSessionPath(runtimeSessionId)}/events?${search.toString()}`;
}

export function buildRuntimeProjectionPath({ runtimeSessionId, projectionVersion, projection }: RuntimeProjectionParams) {
  const search = new URLSearchParams({ projectionVersion: String(projectionVersion), projection });
  return `${buildRuntimeSessionPath(runtimeSessionId)}/projection?${search.toString()}`;
}

export function buildRuntimeSnapshotPath(runtimeSessionId: string) {
  return `${buildRuntimeSessionPath(runtimeSessionId)}/snapshot`;
}

export function fetchRuntimeSession(runtimeSessionId: string) {
  return apiRequest<RuntimeSessionRow>(buildRuntimeSessionPath(runtimeSessionId));
}

export function fetchRuntimeTurns(params: RuntimePageParams) {
  return apiRequest<RuntimeListResponse<RuntimeTurnRow>>(buildRuntimeTurnsPath(params));
}

export function fetchRuntimeEvents(params: RuntimeEventPageParams) {
  return apiRequest<RuntimeEventsResponse>(buildRuntimeEventsPath(params));
}

export function fetchRuntimeProjection(params: RuntimeProjectionParams) {
  return apiRequest<RuntimeProjectionRow>(buildRuntimeProjectionPath(params));
}

export function fetchRuntimeSnapshot(runtimeSessionId: string) {
  return apiRequest<RuntimeSnapshotResponse>(buildRuntimeSnapshotPath(runtimeSessionId));
}

export function useRuntimeSessionQuery(runtimeSessionId?: string) {
  return useQuery({
    queryKey: queryKeys.runtime.session(runtimeSessionId || ''),
    queryFn: () => fetchRuntimeSession(runtimeSessionId || ''),
    enabled: Boolean(runtimeSessionId),
    staleTime: 2_000,
  });
}

export function useRuntimeTurnsQuery({ runtimeSessionId, offset = 0, limit = 100 }: RuntimePageParams) {
  return useQuery({
    queryKey: queryKeys.runtime.turns(runtimeSessionId, { offset, limit }),
    queryFn: () => fetchRuntimeTurns({ runtimeSessionId, offset, limit }),
    enabled: Boolean(runtimeSessionId),
    placeholderData: (previous) => previous,
    staleTime: 2_000,
  });
}

export function useRuntimeEventsQuery({ runtimeSessionId, afterSeq = 0, limit = 100 }: RuntimeEventPageParams) {
  return useQuery({
    queryKey: queryKeys.runtime.events(runtimeSessionId, { afterSeq, limit }),
    queryFn: () => fetchRuntimeEvents({ runtimeSessionId, afterSeq, limit }),
    enabled: Boolean(runtimeSessionId),
    placeholderData: (previous) => previous,
    staleTime: 1_000,
  });
}

export function useRuntimeProjectionQuery(params: RuntimeProjectionParams) {
  return useQuery({
    queryKey: queryKeys.runtime.projection(params.runtimeSessionId, params.projectionVersion, params.projection),
    queryFn: () => fetchRuntimeProjection(params),
    enabled: Boolean(params.runtimeSessionId),
    staleTime: 1_000,
  });
}

export function useRuntimeSnapshotQuery(runtimeSessionId?: string) {
  return useQuery({
    queryKey: queryKeys.runtime.snapshot(runtimeSessionId || ''),
    queryFn: () => fetchRuntimeSnapshot(runtimeSessionId || ''),
    enabled: Boolean(runtimeSessionId),
    staleTime: 1_000,
  });
}
