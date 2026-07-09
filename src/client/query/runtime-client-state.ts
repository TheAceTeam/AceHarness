import { apiFetch } from './api-client';
import { buildRuntimeEventsPath, buildRuntimeSessionPath, type RuntimeEventsResponse } from './runtime-agent';
import {
  applyRuntimeEventsToCollections,
  assertRuntimeClientStateIsSafe,
  syncRuntimeSnapshotToDb,
  type RuntimeSessionRow,
  type RuntimeSnapshotInput,
} from '@/client/db/runtime-agent-collections';
import type { RuntimeEvent } from '@/lib/runtime-agent/contracts';

export type RuntimeStreamEnvelope = RuntimeSnapshotInput & {
  event?: RuntimeEvent;
};

export type RuntimeSnapshotFetcher = (path: string, init?: RequestInit) => Promise<Response>;

export type RuntimeInitialSnapshotOptions = {
  fetcher?: RuntimeSnapshotFetcher;
  signal?: AbortSignal;
  authRedirect?: boolean;
};

export async function fetchRuntimeSessionInitialSnapshot(
  runtimeSessionId: string,
  options: RuntimeInitialSnapshotOptions = {},
): Promise<RuntimeSnapshotInput> {
  const fetcher = options.fetcher || ((path, init) => apiFetch(path, init, { authRedirect: options.authRedirect }));
  const [sessionResponse, eventsResponse] = await Promise.all([
    fetcher(buildRuntimeSessionPath(runtimeSessionId), { signal: options.signal }),
    fetcher(buildRuntimeEventsPath({ runtimeSessionId, afterSeq: 0, limit: 100 }), { signal: options.signal }),
  ]);
  const sessionPayload = await readJsonResponse<{ session?: RuntimeSessionRow }>(sessionResponse);
  const eventsPayload = await readJsonResponse<RuntimeEventsResponse>(eventsResponse);
  const snapshot: RuntimeSnapshotInput = {
    sessions: sessionPayload.session ? [{
      ...sessionPayload.session,
      id: sessionPayload.session.id || sessionPayload.session.runtimeSessionId,
    }] : [],
    events: eventsPayload.events || [],
  };
  assertRuntimeClientStateIsSafe(snapshot);
  syncRuntimeSnapshotToDb(snapshot);
  return snapshot;
}

export type RuntimeDeltaBatcherOptions = {
  flushDelayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
};

export type RuntimeDeltaBatcher = {
  enqueue: (envelope: RuntimeStreamEnvelope) => void;
  flush: () => void;
  dispose: () => void;
};

export function createRuntimeDeltaBatcher(options: RuntimeDeltaBatcherOptions = {}): RuntimeDeltaBatcher {
  const flushDelayMs = options.flushDelayMs ?? 64;
  const schedule = options.schedule || defaultRuntimeDeltaSchedule;
  const cancel = options.cancel || defaultRuntimeDeltaCancel;
  const pending: RuntimeStreamEnvelope[] = [];
  let scheduled: unknown;

  const flush = () => {
    scheduled = undefined;
    const batch = pending.splice(0, pending.length);
    for (const envelope of batch) {
      applyRuntimeStreamEnvelope(envelope);
    }
  };

  return {
    enqueue(envelope) {
      pending.push(envelope);
      if (scheduled !== undefined) return;
      scheduled = schedule(flush, flushDelayMs);
    },
    flush,
    dispose() {
      if (scheduled !== undefined) cancel(scheduled);
      scheduled = undefined;
      pending.length = 0;
    },
  };
}

export function applyRuntimeStreamEnvelope(envelope: RuntimeStreamEnvelope) {
  assertRuntimeClientStateIsSafe(envelope);
  const { event, ...snapshot } = envelope;
  if (event) applyRuntimeEventsToCollections([event]);
  syncRuntimeSnapshotToDb(snapshot);
}

export function upsertRuntimeStreamText(text: string, batcher: RuntimeDeltaBatcher = createRuntimeDeltaBatcher()) {
  for (const envelope of parseRuntimeStreamText(text)) {
    batcher.enqueue(envelope);
  }
  return batcher;
}

export function parseRuntimeStreamText(text: string): RuntimeStreamEnvelope[] {
  const envelopes: RuntimeStreamEnvelope[] = [];
  const sseBlocks = text.split(/\r?\n\r?\n/).filter((block) => /^data:/m.test(block));

  if (sseBlocks.length > 0) {
    for (const block of sseBlocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (data && data !== '[DONE]') envelopes.push(parseRuntimeStreamEnvelope(data));
    }
    return envelopes;
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === '[DONE]') continue;
    envelopes.push(parseRuntimeStreamEnvelope(trimmed));
  }
  return envelopes;
}

function parseRuntimeStreamEnvelope(data: string): RuntimeStreamEnvelope {
  const parsed = JSON.parse(data) as RuntimeStreamEnvelope;
  assertRuntimeClientStateIsSafe(parsed);
  return parsed;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

function defaultRuntimeDeltaSchedule(callback: () => void, delayMs: number) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return setTimeout(callback, delayMs);
}

function defaultRuntimeDeltaCancel(handle: unknown) {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function' && typeof handle === 'number') {
    window.cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle as ReturnType<typeof setTimeout>);
}
