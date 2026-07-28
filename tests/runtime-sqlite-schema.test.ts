import { describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { bootstrapRuntimeSqlite, openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';

function insertSession(db: RuntimeSqliteDatabase, id: string): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO runtime_sessions (
      id, kind, agent_id, status, working_directory, created_at, updated_at
    )
    VALUES (?, 'chat', 'codex', 'active', ?, ?, ?)
  `).run(id, process.cwd(), now, now);
}

function makeStore(): { db: RuntimeSqliteDatabase; store: RuntimeSqliteStore } {
  const db = openRuntimeSqliteDatabase(':memory:');
  return { db, store: new RuntimeSqliteStore(db) };
}

describe('runtime sqlite schema and store', () => {
  test('bootstraps required pragmas and tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runtime-sqlite-'));
    const db = openRuntimeSqliteDatabase(join(dir, 'runtime.db'));
    try {
      bootstrapRuntimeSqlite(db);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
      for (const table of [
        'runtime_sessions',
        'runtime_bindings',
        'runtime_turns',
        'runtime_events',
        'runtime_traces',
        'runtime_session_operations',
        'runtime_session_edges',
        'runtime_projection_cache',
        'agent_runtime_state',
      ]) {
        expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeTruthy();
      }
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_projection_cache'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_turns_one_active_per_session'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_events_session_seq'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_projection_cache_session_projection_version'").get()).toBeTruthy();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('enqueueTurn is idempotent by session and request id', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      const first = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'hello' });
      const second = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'ignored' });

      expect(second.id).toBe(first.id);
      expect(second.inputText).toBe('hello');
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_turns').get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  test('claimNextTurn leases the oldest queued turn', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'first', queuedAt: '2026-01-01T00:00:00.000Z' });
      store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-2', inputText: 'second', queuedAt: '2026-01-01T00:00:01.000Z' });

      const claimed = store.claimNextTurn({
        leaseOwner: 'worker-1',
        leaseToken: 'lease-1',
        now: new Date('2026-01-01T00:00:02.000Z'),
      });

      expect(claimed).toMatchObject({
        requestId: 'request-1',
        status: 'running',
        leaseOwner: 'worker-1',
        leaseToken: 'lease-1',
      });
    } finally {
      db.close();
    }
  });

  test('partial unique index rejects duplicate running turns in a session', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      const first = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'first' });
      const second = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-2', inputText: 'second' });
      db.prepare("UPDATE runtime_turns SET status = 'running' WHERE id = ?").run(first.id);

      expect(() => {
        db.prepare("UPDATE runtime_turns SET status = 'running' WHERE id = ?").run(second.id);
      }).toThrow();
    } finally {
      db.close();
    }
  });

  test('appendEvent assigns monotonic session seq and updates projection in the same transaction', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      const turn = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', traceId: 'trace-1', inputText: 'hello' });
      const first = store.appendEvent({ sessionId: 'session-1', turnId: turn.id, traceId: 'trace-1', type: 'message.delta', payload: { text: 'a' } });
      const second = store.appendEvent({
        sessionId: 'session-1',
        turnId: turn.id,
        traceId: 'trace-1',
        type: 'message.delta',
        payload: { text: 'b' },
        projectionUpdate: { projection: 'chat', version: 1, payload: { messages: ['a', 'b'] } },
      });

      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);
      expect(db.prepare('SELECT last_seq, payload_json FROM runtime_projection_cache WHERE session_id = ?').get('session-1')).toMatchObject({
        last_seq: 2,
        payload_json: JSON.stringify({ messages: ['a', 'b'] }),
      });
      expect(store.getProjectionCache('session-1', 'chat', 1)).toMatchObject({
        sessionId: 'session-1',
        projection: 'chat',
        version: 1,
        lastSeq: 2,
        payload: { messages: ['a', 'b'] },
      });
    } finally {
      db.close();
    }
  });

  test('appendEvent rolls back event insert when projection update fails', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');

      expect(() => store.appendEvent({
        sessionId: 'session-1',
        traceId: 'trace-1',
        type: 'message.delta',
        payload: { text: 'not committed' },
        projectionUpdate: {
          projection: 'invalid-projection',
          version: 1,
          payload: { messages: ['not committed'] },
        } as any,
      })).toThrow();

      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_events').get()).toMatchObject({ count: 0 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_projection_cache').get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  test('cancelQueuedTurn transitions queued turns to cancelled or dropped', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      const cancelled = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'cancel me' });
      const dropped = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-2', inputText: 'drop me' });

      expect(store.cancelQueuedTurn({ turnId: cancelled.id, cancelRequestId: 'cancel-1', reason: 'user' })).toMatchObject({
        status: 'cancelled',
        cancelRequestId: 'cancel-1',
        cancelReason: 'user',
      });
      expect(store.cancelQueuedTurn({ turnId: dropped.id, dropped: true })).toMatchObject({ status: 'dropped' });
    } finally {
      db.close();
    }
  });

  test('claimNextTurn recovers expired running leases', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      const turn = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'recover me' });
      db.prepare(`
        UPDATE runtime_turns
        SET status = 'running',
          lease_owner = 'old-worker',
          lease_token = 'old-token',
          lease_expires_at = '2026-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(turn.id);

      const recovered = store.claimNextTurn({
        leaseOwner: 'new-worker',
        leaseToken: 'new-token',
        now: new Date('2026-01-01T00:00:01.000Z'),
      });

      expect(recovered).toMatchObject({
        id: turn.id,
        status: 'running',
        leaseOwner: 'new-worker',
        leaseToken: 'new-token',
      });
    } finally {
      db.close();
    }
  });

  test('reclaimExpiredLeases separately recovers expired leases in order', () => {
    const { db, store } = makeStore();
    try {
      insertSession(db, 'session-1');
      insertSession(db, 'session-2');
      const first = store.enqueueTurn({ sessionId: 'session-1', requestId: 'request-1', inputText: 'recover first' });
      const second = store.enqueueTurn({ sessionId: 'session-2', requestId: 'request-2', inputText: 'recover second' });
      db.prepare(`
        UPDATE runtime_turns
        SET status = 'running', lease_owner = 'old-worker', lease_token = 'old-token', lease_expires_at = ?
        WHERE id = ?
      `).run('2026-01-01T00:00:00.000Z', first.id);
      db.prepare(`
        UPDATE runtime_turns
        SET status = 'running', lease_owner = 'old-worker', lease_token = 'old-token', lease_expires_at = ?
        WHERE id = ?
      `).run('2026-01-01T00:00:01.000Z', second.id);

      const reclaimed = store.reclaimExpiredLeases({
        leaseOwner: 'reclaimer',
        leaseToken: 'reclaimed-token',
        limit: 1,
        now: new Date('2026-01-01T00:00:02.000Z'),
      });

      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]).toMatchObject({
        id: first.id,
        status: 'running',
        leaseOwner: 'reclaimer',
        leaseToken: 'reclaimed-token',
      });
      expect(store.getTurn(second.id)).toMatchObject({ leaseOwner: 'old-worker', leaseToken: 'old-token' });
    } finally {
      db.close();
    }
  });

  test('store APIs cover bindings traces operations edges and agent runtime state', () => {
    const { db, store } = makeStore();
    try {
      const source = store.createSession({ id: 'session-1', kind: 'agent', agentId: 'codex', workingDirectory: process.cwd() });
      const target = store.createSession({ id: 'session-2', kind: 'agent', agentId: 'codex', workingDirectory: process.cwd() });
      const binding = store.upsertBinding({
        id: 'binding-1',
        sessionId: source.id,
        runtime: 'acpx',
        providerSessionId: 'provider-1',
        raw: { provider: 'acpx' },
      });
      const traceId = store.appendTrace({
        id: 'trace-row-1',
        traceId: 'trace-1',
        sessionId: source.id,
        level: 'info',
        source: 'orchestrator',
        payload: { ok: true },
      });
      const operation = store.createOperation({
        id: 'operation-1',
        sessionId: source.id,
        targetSessionId: target.id,
        kind: 'fork',
        traceId: 'trace-1',
        request: { from: source.id },
      });
      const edgeId = store.createSessionEdge({
        id: 'edge-1',
        operationId: operation.id,
        fromSessionId: source.id,
        toSessionId: target.id,
        kind: 'fork',
        metadata: { reason: 'test' },
      });
      const state = store.upsertAgentRuntimeState({
        agentId: 'codex',
        enabled: true,
        hidden: false,
        availabilityStatus: 'available',
        envReadiness: { ready: true },
      });

      expect(binding.providerSessionId).toBe('provider-1');
      expect(store.listBindings(source.id)).toHaveLength(1);
      expect(store.getTrace(traceId)).toMatchObject({ payload: { ok: true } });
      expect(store.listTraces('trace-1')).toHaveLength(1);
      expect(store.getOperation(operation.id)).toMatchObject({ kind: 'fork', request: { from: source.id } });
      expect(store.listOperations(source.id)).toHaveLength(1);
      expect(store.getSessionEdge(edgeId)).toMatchObject({ fromSessionId: source.id, toSessionId: target.id, metadata: { reason: 'test' } });
      expect(store.listSessionEdges(source.id)).toHaveLength(1);
      expect(state).toMatchObject({ agentId: 'codex', enabled: true, hidden: false, availabilityStatus: 'available' });
      expect(store.getAgentRuntimeState('codex')).toMatchObject({ envReadiness: { ready: true } });
    } finally {
      db.close();
    }
  });
});
