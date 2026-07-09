import { describe, expect, test } from 'vitest';
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
    const db = openRuntimeSqliteDatabase(':memory:');
    try {
      bootstrapRuntimeSqlite(db);
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_projection_cache'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_runtime_turns_one_active_per_session'").get()).toBeTruthy();
    } finally {
      db.close();
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
});
