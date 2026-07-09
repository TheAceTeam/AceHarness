import { describe, expect, test, beforeEach } from 'vitest';
import { queryKeys } from '../src/client/query/query-keys';
import {
  applyRuntimeEventsToCollections,
  clearRuntimeCollections,
  getRuntimeCollectionsSnapshot,
  runtimeEventKey,
  sanitizeRuntimePayload,
  syncRuntimeSnapshotToDb,
} from '../src/client/db/runtime-agent-collections';
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
      }],
      modelRoutes: [{
        id: 'model-route-1',
        modelRouteId: 'model-route-1',
        agentId: 'codex',
        status: 'active',
        displayName: 'GPT route',
        updatedAt: '2026-07-09T00:00:00.000Z',
      }],
      events: [runtimeEvent({
        sessionId: 'runtime-session-1',
        seq: 2,
        payload: {
          message: 'visible',
          backendSessionId: 'legacy-session',
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
    expect(serialized).not.toContain('legacy-session');
    expect(serialized).not.toContain('native-session');
    expect(serialized).not.toContain('super-secret');
    expect(serialized).not.toContain('hidden');
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
