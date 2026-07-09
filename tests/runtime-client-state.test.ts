import { describe, expect, test, beforeEach } from 'vitest';
import { queryKeys } from '../src/client/query/query-keys';
import {
  assertRuntimeClientStateIsSafe,
  applyRuntimeEventsToCollections,
  clearRuntimeCollections,
  findUnsafeRuntimeClientState,
  getRuntimeCollectionsSnapshot,
  runtimeEventKey,
  sanitizeRuntimePayload,
  syncRuntimeSnapshotToDb,
} from '../src/client/db/runtime-agent-collections';
import {
  createRuntimeDeltaBatcher,
  fetchRuntimeSessionInitialSnapshot,
  parseRuntimeStreamText,
  upsertRuntimeStreamText,
} from '../src/client/query/runtime-client-state';
import type { RuntimeEvent } from '../src/lib/runtime-agent/contracts';

describe('runtime client state', () => {
  beforeEach(() => {
    clearRuntimeCollections();
  });

  test('runtime query keys use platform ids', () => {
    expect(queryKeys.runtime.session('runtime-session-1')).toEqual(['runtime', 'sessions', 'runtime-session-1']);
    expect(queryKeys.runtime.snapshot('runtime-session-1')).toEqual(['runtime', 'sessions', 'runtime-session-1', 'snapshot']);
    expect(queryKeys.runtime.turn('runtime-session-1', 'turn-1')).toEqual([
      'runtime',
      'sessions',
      'runtime-session-1',
      'turns',
      'turn-1',
    ]);
    expect(queryKeys.runtime.modelRoute('model-route-1')).toEqual(['runtime', 'modelRoutes', 'model-route-1']);
    expect(queryKeys.runtime.probeRun('probe-1')).toEqual(['runtime', 'probeRuns', 'probe-1']);
    expect(queryKeys.runtime.projection('runtime-session-1', 3, 'chat')).toEqual([
      'runtime',
      'sessions',
      'runtime-session-1',
      'projections',
      3,
      'chat',
    ]);
    expect(queryKeys.runtime.events('runtime-session-1', { afterSeq: 3, limit: 50 })).toEqual([
      'runtime',
      'sessions',
      'runtime-session-1',
      'events',
      { afterSeq: 3, limit: 50 },
    ]);
    expect(queryKeys.runtime.benchmarkRun('benchmark-run-1')).toEqual(['runtime', 'benchmarkRuns', 'benchmark-run-1']);
    expect(() => queryKeys.runtime.session('provider-native-session-1')).toThrow(/Unsafe runtime query key id/);
    expect(() => queryKeys.runtime.sessions({ token: 'raw-secret' } as never)).toThrow(/Unsafe runtime query key part/);
  });

  test('initial snapshot fetch syncs platform shaped rows', async () => {
    const session = {
        id: 'server-row-id-is-ignored',
        runtimeSessionId: 'runtime-session-1',
        agentId: 'codex',
        kind: 'chat' as const,
        status: 'active' as const,
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
    };
    const events = [runtimeEvent({ seq: 1, payload: { text: 'hello' } })];
    const paths: string[] = [];
    const result = await fetchRuntimeSessionInitialSnapshot('runtime-session-1', {
      fetcher: async (path) => {
        paths.push(path);
        if (path.includes('/events?')) return jsonResponse({ events, nextSeq: 1, cursor: 'cursor-1' });
        return jsonResponse({ session });
      },
    });

    expect(paths).toEqual([
      '/api/runtime-sessions/runtime-session-1',
      '/api/runtime-sessions/runtime-session-1/events?afterSeq=0&limit=100',
    ]);
    expect(result).toEqual({
      sessions: [{ ...session, id: 'server-row-id-is-ignored' }],
      events,
    });
    const db = getRuntimeCollectionsSnapshot();
    expect(db.sessions[0]).toMatchObject({ id: 'runtime-session-1', runtimeSessionId: 'runtime-session-1' });
    expect(db.events[0]).toMatchObject({ id: runtimeEventKey('runtime-session-1', 1), payload: { text: 'hello' } });
  });

  test('SSE and NDJSON stream text parse and upsert incrementally', () => {
    const sse = [
      `data: ${JSON.stringify({ event: runtimeEvent({ seq: 1, payload: { text: 'a' } }) })}`,
      '',
      `data: ${JSON.stringify({ events: [runtimeEvent({ seq: 2, payload: { text: 'b' } })] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    const ndjson = [
      JSON.stringify({ event: runtimeEvent({ seq: 3, payload: { text: 'c' } }) }),
      JSON.stringify({ projections: [{
        id: 'projection-row',
        runtimeSessionId: 'runtime-session-1',
        projection: 'chat',
        projectionVersion: 2,
        lastSeq: 3,
        payload: { visible: true },
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
      }] }),
    ].join('\n');

    const batcher = createRuntimeDeltaBatcher({ schedule: (callback) => callback() });
    upsertRuntimeStreamText(sse, batcher);
    upsertRuntimeStreamText(ndjson, batcher);

    expect(parseRuntimeStreamText(sse)).toHaveLength(2);
    const db = getRuntimeCollectionsSnapshot();
    expect(db.events.map((event) => event.seq).sort()).toEqual([1, 2, 3]);
    expect(db.projections[0]).toMatchObject({ runtimeSessionId: 'runtime-session-1', projectionVersion: 2 });
  });

  test('runtime delta batcher defers and flushes without browser raf', () => {
    const scheduled: Array<() => void> = [];
    const batcher = createRuntimeDeltaBatcher({
      flushDelayMs: 75,
      schedule: (callback, delayMs) => {
        expect(delayMs).toBe(75);
        scheduled.push(callback);
        return callback;
      },
    });

    batcher.enqueue({ event: runtimeEvent({ seq: 1 }) });
    batcher.enqueue({ event: runtimeEvent({ seq: 2 }) });
    expect(getRuntimeCollectionsSnapshot().events).toHaveLength(0);
    expect(scheduled).toHaveLength(1);

    scheduled[0]();
    expect(getRuntimeCollectionsSnapshot().events.map((event) => event.seq)).toEqual([1, 2]);
  });

  test('event upserts are idempotent by runtime session and seq', () => {
    const first = runtimeEvent({
      id: 'server-event-a',
      sessionId: 'runtime-session-1',
      seq: 1,
      payload: { text: 'hello' },
    });
    const duplicate = runtimeEvent({
      id: 'server-event-b',
      sessionId: 'runtime-session-1',
      seq: 1,
      payload: { text: 'ignored duplicate' },
    });

    applyRuntimeEventsToCollections([first, duplicate]);

    const snapshot = getRuntimeCollectionsSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toMatchObject({
      id: runtimeEventKey('runtime-session-1', 1),
      runtimeSessionId: 'runtime-session-1',
      seq: 1,
      payload: { text: 'hello' },
    });
  });

  test('runtime collections store only redacted platform-facing fields', () => {
    syncRuntimeSnapshotToDb({
      sessions: [{
        id: 'runtime-session-1',
        runtimeSessionId: 'runtime-session-1',
        agentId: 'codex',
        kind: 'chat',
        status: 'active',
        modelRouteId: 'model-route-1',
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
        providerNativeId: 'provider-native-session',
      } as never],
      modelRoutes: [{
        id: 'model-route-1',
        modelRouteId: 'model-route-1',
        agentId: 'codex',
        status: 'active',
        displayName: 'GPT route',
        updatedAt: '2026-07-09T00:00:00.000Z',
        runtime_bindings: { raw: 'native' },
      } as never],
      events: [runtimeEvent({
        sessionId: 'runtime-session-1',
        seq: 2,
        payload: {
          message: 'visible',
          backendSessionId: 'preRuntime-session',
          providerSessionId: 'native-session',
          acpxSessionId: 'acpx-session',
          secretValue: 'super-secret',
          nested: { token: 'hidden', keep: 'ok' },
        },
      })],
    });

    const serialized = JSON.stringify(getRuntimeCollectionsSnapshot());
    expect(serialized).toContain('runtime-session-1');
    expect(serialized).toContain('model-route-1');
    expect(serialized).toContain('visible');
    expect(serialized).toContain('ok');
    expect(serialized).not.toContain('preRuntime-session');
    expect(serialized).not.toContain('native-session');
    expect(serialized).not.toContain('provider-native-session');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('hidden');
  });

  test('unsafe runtime stream and snapshot shapes are blocked before cache writes', async () => {
    expect(findUnsafeRuntimeClientState({ ok: { runtime_bindings: { id: 'binding' } } })).toBe('$.ok.runtime_bindings');
    expect(() => assertRuntimeClientStateIsSafe({ providerNativeId: 'native-id' })).toThrow(/providerNativeId/);
    expect(() => parseRuntimeStreamText(JSON.stringify({
      event: runtimeEvent({ seq: 1 }),
      runtime_bindings: { raw: 'native' },
    }))).toThrow(/runtime_bindings/);

    await expect(fetchRuntimeSessionInitialSnapshot('runtime-session-1', {
      fetcher: async (path) => {
        if (path.includes('/events?')) return jsonResponse({ events: [], nextSeq: 0, cursor: 'cursor-0' });
        return jsonResponse({
          session: {
          id: 'runtime-session-1',
          runtimeSessionId: 'runtime-session-1',
          agentId: 'codex',
          kind: 'chat',
          status: 'active',
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
          secretValue: 'blocked',
          },
        });
      },
    })).rejects.toThrow(/secretValue/);
    expect(getRuntimeCollectionsSnapshot().sessions).toHaveLength(0);
  });

  test('payload sanitizer removes binding and secret shaped keys recursively', () => {
    expect(sanitizeRuntimePayload({
      keep: 'value-visible',
      runtime_bindings: { id: 'binding-row' },
      externalSessionId: 'external',
      child: {
        value: 'raw-secret',
        safe: ['one', { raw: { nativeId: 'native' }, ok: true }],
      },
    })).toEqual({
      keep: 'value-visible',
      child: {
        safe: ['one', { ok: true }],
      },
    });
  });
});

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
}

function runtimeEvent(overrides: Partial<RuntimeEvent> = {}): RuntimeEvent {
  return {
    id: overrides.id || `event-${overrides.seq ?? 1}`,
    sessionId: overrides.sessionId || 'runtime-session-1',
    turnId: overrides.turnId || 'turn-1',
    traceId: overrides.traceId || 'trace-1',
    seq: overrides.seq ?? 1,
    type: overrides.type || 'message.delta',
    payload: overrides.payload ?? {},
    redacted: overrides.redacted ?? true,
    createdAt: overrides.createdAt || '2026-07-09T00:00:00.000Z',
  };
}
