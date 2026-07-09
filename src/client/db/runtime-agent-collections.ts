import { createCollection, localOnlyCollectionOptions } from '@tanstack/db';
import type {
  CostUsage,
  RuntimeCapabilities,
  RuntimeErrorDto,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeSessionKind,
  RuntimeSessionStatus,
  RuntimeTurnStatus,
  TokenUsage,
} from '@/lib/runtime-agent/contracts';

export type RuntimeProjectionName = 'chat' | 'workflow' | 'process-block';

export type RuntimeSafePayload = null | boolean | number | string | RuntimeSafePayload[] | { [key: string]: RuntimeSafePayload };

export type RuntimeSessionRow = {
  id: string;
  runtimeSessionId: string;
  agentId: string;
  kind: RuntimeSessionKind;
  status: RuntimeSessionStatus;
  modelRouteId?: string;
  runtimeProfileId?: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeTurnRow = {
  id: string;
  turnId: string;
  runtimeSessionId: string;
  requestId: string;
  traceId: string;
  status: RuntimeTurnStatus;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  usage?: TokenUsage;
  cost?: CostUsage;
  error?: RuntimeErrorDto;
  updatedAt?: string;
};

export type RuntimeEventRow = {
  id: string;
  runtimeSessionId: string;
  turnId?: string;
  traceId: string;
  seq: number;
  type: RuntimeEventType;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  payload: RuntimeSafePayload;
  redacted: boolean;
  createdAt: string;
};

export type RuntimeProjectionRow = {
  id: string;
  runtimeSessionId: string;
  projection: RuntimeProjectionName;
  projectionVersion: number;
  lastSeq: number;
  payload: RuntimeSafePayload;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeAgentStateRow = {
  id: string;
  agentId: string;
  runtimeProfileId?: string;
  readiness: 'ready' | 'missing' | 'misconfigured' | 'unknown';
  enabled: boolean;
  capabilities?: RuntimeCapabilities;
  checkedAt?: string;
  updatedAt: string;
};

export type RuntimeModelRouteRow = {
  id: string;
  modelRouteId: string;
  agentId: string;
  status: 'active' | 'inactive' | 'invalid';
  displayName: string;
  capabilities?: RuntimeCapabilities;
  updatedAt: string;
};

export type RuntimeProbeRunRow = {
  id: string;
  probeId: string;
  modelRouteId: string;
  runtimeSessionId?: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled';
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: RuntimeErrorDto;
  updatedAt: string;
};

export type RuntimeBenchmarkRunRow = {
  id: string;
  benchmarkRunId: string;
  modelRouteId: string;
  runtimeSessionId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: string;
  finishedAt?: string;
  score?: number;
  summary?: string;
  error?: RuntimeErrorDto;
  updatedAt: string;
};

export type RuntimeCollectionsSnapshot = {
  sessions: RuntimeSessionRow[];
  turns: RuntimeTurnRow[];
  events: RuntimeEventRow[];
  projections: RuntimeProjectionRow[];
  agentStates: RuntimeAgentStateRow[];
  modelRoutes: RuntimeModelRouteRow[];
  probeRuns: RuntimeProbeRunRow[];
  benchmarkRuns: RuntimeBenchmarkRunRow[];
};

export type RuntimeSnapshotInput = Partial<Omit<RuntimeCollectionsSnapshot, 'events'> & {
  events: Array<RuntimeEvent | RuntimeEventRow>;
}>;

type RuntimeCollection<T extends { id: string }> = {
  has: (id: string) => boolean;
  get?: (id: string) => T | undefined;
  insert: (row: T) => void;
  update?: (id: unknown, updater: (draft: T) => void) => unknown;
  delete: (id: string) => void;
  toArray?: Array<T> | (() => Array<T>);
  values?: () => Iterable<T>;
};

const blockedPayloadKeys = new Set([
  'auth',
  'authorization',
  'acpxRecordId',
  'acpxSessionId',
  'backendSessionId',
  'binding',
  'bindings',
  'externalIds',
  'externalRecordId',
  'externalSessionId',
  'nativeId',
  'providerNativeId',
  'providerSessionId',
  'raw',
  'runtimeBinding',
  'runtimeBindings',
  'runtime_bindings',
  'secret',
  'secretValue',
  'token',
  'value',
]);

export const runtimeSessionsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeSessionRow, string>({
    id: 'runtime-sessions',
    getKey: (item) => item.id,
  }),
);

export const runtimeTurnsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeTurnRow, string>({
    id: 'runtime-turns',
    getKey: (item) => item.id,
  }),
);

export const runtimeEventsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeEventRow, string>({
    id: 'runtime-events',
    getKey: (item) => item.id,
  }),
);

export const runtimeProjectionsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeProjectionRow, string>({
    id: 'runtime-projections',
    getKey: (item) => item.id,
  }),
);

export const runtimeAgentStatesCollection = createCollection(
  localOnlyCollectionOptions<RuntimeAgentStateRow, string>({
    id: 'runtime-agent-states',
    getKey: (item) => item.id,
  }),
);

export const runtimeModelRoutesCollection = createCollection(
  localOnlyCollectionOptions<RuntimeModelRouteRow, string>({
    id: 'runtime-model-routes',
    getKey: (item) => item.id,
  }),
);

export const runtimeProbeRunsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeProbeRunRow, string>({
    id: 'runtime-probe-runs',
    getKey: (item) => item.id,
  }),
);

export const runtimeBenchmarkRunsCollection = createCollection(
  localOnlyCollectionOptions<RuntimeBenchmarkRunRow, string>({
    id: 'runtime-benchmark-runs',
    getKey: (item) => item.id,
  }),
);

export function runtimeEventKey(runtimeSessionId: string, seq: number) {
  return `${runtimeSessionId}:${seq}`;
}

export function runtimeProjectionKey(runtimeSessionId: string, projection: RuntimeProjectionName, projectionVersion: number) {
  return `${runtimeSessionId}:${projection}:${projectionVersion}`;
}

export function applyRuntimeEventsToCollections(events: Array<RuntimeEvent | RuntimeEventRow>) {
  for (const event of events) {
    const row = normalizeRuntimeEventRow(event);
    const existing = runtimeEventsCollection.get(row.id);
    if (existing && existing.seq === row.seq && existing.runtimeSessionId === row.runtimeSessionId) continue;
    upsertRuntimeEvent(row);
  }
}

export function syncRuntimeSnapshotToDb(snapshot: RuntimeSnapshotInput) {
  snapshot.sessions?.forEach(upsertRuntimeSession);
  snapshot.turns?.forEach(upsertRuntimeTurn);
  snapshot.events?.forEach((event) => applyRuntimeEventsToCollections([event]));
  snapshot.projections?.forEach(upsertRuntimeProjection);
  snapshot.agentStates?.forEach(upsertRuntimeAgentState);
  snapshot.modelRoutes?.forEach(upsertRuntimeModelRoute);
  snapshot.probeRuns?.forEach(upsertRuntimeProbeRun);
  snapshot.benchmarkRuns?.forEach(upsertRuntimeBenchmarkRun);
}

export function upsertRuntimeSession(row: RuntimeSessionRow) {
  upsertRuntimeRow(runtimeSessionsCollection as RuntimeCollection<RuntimeSessionRow>, row);
}

export function upsertRuntimeTurn(row: RuntimeTurnRow) {
  upsertRuntimeRow(runtimeTurnsCollection as RuntimeCollection<RuntimeTurnRow>, row);
}

export function upsertRuntimeEvent(row: RuntimeEventRow) {
  upsertRuntimeRow(runtimeEventsCollection as RuntimeCollection<RuntimeEventRow>, {
    ...row,
    id: runtimeEventKey(row.runtimeSessionId, row.seq),
    payload: sanitizeRuntimePayload(row.payload),
  });
}

export function upsertRuntimeProjection(row: RuntimeProjectionRow) {
  upsertRuntimeRow(runtimeProjectionsCollection as RuntimeCollection<RuntimeProjectionRow>, {
    ...row,
    id: runtimeProjectionKey(row.runtimeSessionId, row.projection, row.projectionVersion),
    payload: sanitizeRuntimePayload(row.payload),
  });
}

export function upsertRuntimeAgentState(row: RuntimeAgentStateRow) {
  upsertRuntimeRow(runtimeAgentStatesCollection as RuntimeCollection<RuntimeAgentStateRow>, row);
}

export function upsertRuntimeModelRoute(row: RuntimeModelRouteRow) {
  upsertRuntimeRow(runtimeModelRoutesCollection as RuntimeCollection<RuntimeModelRouteRow>, row);
}

export function upsertRuntimeProbeRun(row: RuntimeProbeRunRow) {
  upsertRuntimeRow(runtimeProbeRunsCollection as RuntimeCollection<RuntimeProbeRunRow>, row);
}

export function upsertRuntimeBenchmarkRun(row: RuntimeBenchmarkRunRow) {
  upsertRuntimeRow(runtimeBenchmarkRunsCollection as RuntimeCollection<RuntimeBenchmarkRunRow>, row);
}

export function getRuntimeCollectionsSnapshot(): RuntimeCollectionsSnapshot {
  return {
    sessions: readCollectionRows(runtimeSessionsCollection as RuntimeCollection<RuntimeSessionRow>),
    turns: readCollectionRows(runtimeTurnsCollection as RuntimeCollection<RuntimeTurnRow>),
    events: readCollectionRows(runtimeEventsCollection as RuntimeCollection<RuntimeEventRow>),
    projections: readCollectionRows(runtimeProjectionsCollection as RuntimeCollection<RuntimeProjectionRow>),
    agentStates: readCollectionRows(runtimeAgentStatesCollection as RuntimeCollection<RuntimeAgentStateRow>),
    modelRoutes: readCollectionRows(runtimeModelRoutesCollection as RuntimeCollection<RuntimeModelRouteRow>),
    probeRuns: readCollectionRows(runtimeProbeRunsCollection as RuntimeCollection<RuntimeProbeRunRow>),
    benchmarkRuns: readCollectionRows(runtimeBenchmarkRunsCollection as RuntimeCollection<RuntimeBenchmarkRunRow>),
  };
}

export function clearRuntimeCollections() {
  clearRuntimeCollection(runtimeSessionsCollection as RuntimeCollection<RuntimeSessionRow>);
  clearRuntimeCollection(runtimeTurnsCollection as RuntimeCollection<RuntimeTurnRow>);
  clearRuntimeCollection(runtimeEventsCollection as RuntimeCollection<RuntimeEventRow>);
  clearRuntimeCollection(runtimeProjectionsCollection as RuntimeCollection<RuntimeProjectionRow>);
  clearRuntimeCollection(runtimeAgentStatesCollection as RuntimeCollection<RuntimeAgentStateRow>);
  clearRuntimeCollection(runtimeModelRoutesCollection as RuntimeCollection<RuntimeModelRouteRow>);
  clearRuntimeCollection(runtimeProbeRunsCollection as RuntimeCollection<RuntimeProbeRunRow>);
  clearRuntimeCollection(runtimeBenchmarkRunsCollection as RuntimeCollection<RuntimeBenchmarkRunRow>);
}

export function sanitizeRuntimePayload(input: unknown): RuntimeSafePayload {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string' || typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((item) => sanitizeRuntimePayload(item));
  if (typeof input !== 'object') return String(input);

  const output: { [key: string]: RuntimeSafePayload } = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (blockedPayloadKeys.has(key)) continue;
    output[key] = sanitizeRuntimePayload(value);
  }
  return output;
}

function normalizeRuntimeEventRow(event: RuntimeEvent | RuntimeEventRow): RuntimeEventRow {
  const runtimeSessionId = 'runtimeSessionId' in event ? event.runtimeSessionId : event.sessionId;
  return {
    id: runtimeEventKey(runtimeSessionId, event.seq),
    runtimeSessionId,
    turnId: event.turnId,
    traceId: event.traceId,
    seq: event.seq,
    type: event.type,
    correlationId: event.correlationId,
    parentEventId: event.parentEventId,
    messageId: event.messageId,
    toolCallId: event.toolCallId,
    payload: sanitizeRuntimePayload(event.payload),
    redacted: event.redacted,
    createdAt: event.createdAt,
  };
}

function upsertRuntimeRow<T extends { id: string }>(collection: RuntimeCollection<T>, row: T) {
  if (collection.has(row.id) && collection.update) {
    collection.update(row.id, (draft) => {
      Object.assign(draft, row);
    });
    return;
  }
  if (collection.has(row.id)) {
    collection.delete(row.id);
  }
  collection.insert(row);
}

function readCollectionRows<T extends { id: string }>(collection: RuntimeCollection<T>): T[] {
  if (Array.isArray(collection.toArray)) return collection.toArray.map(stripCollectionMetadata);
  if (typeof collection.toArray === 'function') return collection.toArray().map(stripCollectionMetadata);
  if (typeof collection.values === 'function') return Array.from(collection.values()).map(stripCollectionMetadata);
  return [];
}

function clearRuntimeCollection<T extends { id: string }>(collection: RuntimeCollection<T>) {
  for (const row of readCollectionRows(collection)) {
    if (collection.has(row.id)) collection.delete(row.id);
  }
}

function stripCollectionMetadata<T>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const {
    $synced: _synced,
    $origin: _origin,
    $key: _key,
    $collectionId: _collectionId,
    ...rest
  } = row as T & Record<string, unknown>;
  return rest as T;
}
