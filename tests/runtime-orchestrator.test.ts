import { describe, expect, test } from 'vitest';
import { createRuntimeOrchestrator } from '@/lib/runtime-agent/orchestrator';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import type {
  AdapterRuntimeEvent,
  AdapterSessionInput,
  AdapterTurnInput,
  ResolvedModelRoute,
  RuntimeAdapter,
  RuntimeBinding,
  RuntimeCapabilities,
  RuntimeOrchestrator,
} from '@/lib/runtime-agent/contracts';

function makeHarness(adapter = new FakeRuntimeAdapter()): {
  db: RuntimeSqliteDatabase;
  store: RuntimeSqliteStore;
  orchestrator: RuntimeOrchestrator;
  adapter: FakeRuntimeAdapter;
} {
  const db = openRuntimeSqliteDatabase(':memory:');
  db.prepare('INSERT INTO model_routes (id) VALUES (?)').run('route-codex');
  db.prepare('INSERT INTO permission_policies (id) VALUES (?)').run('unrestricted');
  const store = new RuntimeSqliteStore(db);
  const route = createModelRoute('codex', 'acpx');
  const orchestrator = createRuntimeOrchestrator({
    store,
    adapterRegistry: {
      getAdapter: () => adapter,
      getAdapterForAgent: () => adapter,
    },
    resolveModelRoute: () => route,
    leaseOwner: 'test-worker',
  });
  return { db, store, orchestrator, adapter };
}

function makeHarnessWithoutPermissionPolicy(adapter = new FakeRuntimeAdapter()): {
  db: RuntimeSqliteDatabase;
  store: RuntimeSqliteStore;
  orchestrator: RuntimeOrchestrator;
  adapter: FakeRuntimeAdapter;
} {
  const db = openRuntimeSqliteDatabase(':memory:');
  db.prepare('INSERT INTO model_routes (id) VALUES (?)').run('route-codex');
  const store = new RuntimeSqliteStore(db);
  const route = createModelRoute('codex', 'acpx');
  const orchestrator = createRuntimeOrchestrator({
    store,
    adapterRegistry: {
      getAdapter: () => adapter,
      getAdapterForAgent: () => adapter,
    },
    resolveModelRoute: () => route,
    leaseOwner: 'test-worker',
  });
  return { db, store, orchestrator, adapter };
}

describe('runtime orchestrator', () => {
  test('openSession creates the default permission policy before saving the snapshot', async () => {
    const { db, orchestrator } = makeHarnessWithoutPermissionPolicy();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
        modelRouteId: 'route-codex',
      });

      expect(session.modelRouteId).toBe('route-codex');
      expect(db.prepare('SELECT id FROM permission_policies WHERE id = ?').get('unrestricted')).toMatchObject({
        id: 'unrestricted',
      });
      expect(db.prepare('SELECT permission_policy_id FROM runtime_session_snapshots WHERE session_id = ?').get(session.runtimeSessionId)).toMatchObject({
        permission_policy_id: 'unrestricted',
      });
    } finally {
      db.close();
    }
  });

  test('openSession creates a public session ref and persists private binding ids only in SQLite', async () => {
    const { db, orchestrator } = makeHarness();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
        modelRouteId: 'route-codex',
      });

      expect(session).toMatchObject({
        agentId: 'codex',
        kind: 'chat',
        status: 'active',
        modelRouteId: 'route-codex',
      });
      expect(JSON.stringify(session)).not.toContain('provider-session-private');
      expect(db.prepare('SELECT provider_session_id FROM runtime_bindings WHERE session_id = ?').get(session.runtimeSessionId)).toMatchObject({
        provider_session_id: 'provider-session-private',
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_session_snapshots').get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  test('openSession persists MCP servers in the profile snapshot passed to adapters', async () => {
    const { db, orchestrator, adapter } = makeHarness();
    try {
      const mcpServers = [{
        name: 'filesystem',
        type: 'stdio',
        command: 'npx -y @modelcontextprotocol/server-filesystem C:\\tmp',
      }];
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
        modelRouteId: 'route-codex',
        mcpServers,
      });

      expect(adapter.createSessionInputs[0]?.profileSnapshot.mcpServers).toEqual(mcpServers);
      const snapshot = db.prepare('SELECT mcp_servers_json, snapshot_json FROM runtime_session_snapshots WHERE session_id = ?')
        .get(session.runtimeSessionId) as { mcp_servers_json: string; snapshot_json: string };
      expect(JSON.parse(snapshot.mcp_servers_json)).toEqual(mcpServers);
      expect(JSON.parse(snapshot.snapshot_json).mcpServers).toEqual(mcpServers);
    } finally {
      db.close();
    }
  });

  test('refreshes an existing adapter binding before a resumed turn and persists the new binding', async () => {
    const adapter = new ReconnectingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
        ownerUserId: 'user-env-owner',
      });

      await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-resume-env',
        input: 'resume',
      }));

      expect(adapter.reconnectInputs).toHaveLength(1);
      expect(adapter.reconnectInputs[0]?.profileSnapshot.ownerUserId).toBe('user-env-owner');
      expect(adapter.reconnectInputs[0]?.existingBinding).toBeDefined();
      expect(db.prepare('SELECT provider_session_id FROM runtime_bindings WHERE session_id = ?').get(session.runtimeSessionId)).toMatchObject({
        provider_session_id: 'provider-session-refreshed',
      });
    } finally {
      db.close();
    }
  });

  test('runTurn claims the requested turn, persists normalized events, and completes the turn', async () => {
    const { db, orchestrator } = makeHarness();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const events = await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-1',
        input: 'hello',
      }));

      expect(events.map((event) => event.type)).toEqual(['turn.started', 'message.delta', 'turn.completed']);
      expect(events.map((event) => event.seq)).toEqual([1, 2, 3]);
      expect(events[2]?.payload).toMatchObject({
        ok: true,
        usage: {
          inputTokens: 1,
          outputTokens: 2,
          missing: false,
          sourceStatus: 'reported',
        },
      });
      expect(db.prepare('SELECT status, usage_json FROM runtime_turns WHERE request_id = ?').get('request-1')).toMatchObject({
        status: 'completed',
        usage_json: JSON.stringify({ inputTokens: 1, outputTokens: 2, missing: false, sourceStatus: 'reported' }),
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_traces').get()).toMatchObject({ count: 5 });
    } finally {
      db.close();
    }
  });

  test('runTurn is idempotent by request id after a terminal turn', async () => {
    const { db, orchestrator } = makeHarness();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });
      const input = {
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-1',
        input: 'hello',
      };

      const first = await collect(orchestrator.runTurn(input));
      const second = await collect(orchestrator.runTurn(input));

      expect(second.map((event) => event.id)).toEqual(first.map((event) => event.id));
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_turns').get()).toMatchObject({ count: 1 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_events').get()).toMatchObject({ count: 3 });
    } finally {
      db.close();
    }
  });

  test('runTurn is idempotent by request id while the turn is still running', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });
      const input = {
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-running-idempotent',
        input: 'wait',
      };

      const run = collect(orchestrator.runTurn(input));
      const turnId = await adapter.started;
      const duplicateEvents = await collect(orchestrator.runTurn(input));

      expect(duplicateEvents.map((event) => event.type)).toEqual(['turn.started']);
      expect(duplicateEvents[0]?.turnId).toBe(turnId);
      expect(adapter.runTurnInputs).toHaveLength(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_turns').get()).toMatchObject({ count: 1 });

      adapter.finish();
      await run;
    } finally {
      db.close();
    }
  });

  test('runTurn with reject policy records a conflict and does not start another adapter turn', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const activeRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-active',
        input: 'wait',
      }));
      const activeTurnId = await adapter.started;
      const rejectedEvents = await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-rejected',
        input: 'new input',
        interruptPolicy: 'reject',
      }));

      expect(rejectedEvents.map((event) => event.type)).toEqual(['turn.failed']);
      expect(adapter.runTurnInputs).toHaveLength(1);
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'running',
      });
      expect(db.prepare('SELECT status, error_json FROM runtime_turns WHERE request_id = ?').get('request-rejected')).toMatchObject({
        status: 'invalid',
        error_json: JSON.stringify({
          code: 'CONFLICT',
          message: `Runtime session already has active turn: ${activeTurnId}`,
          retryable: false,
          redacted: true,
        }),
      });

      adapter.finish();
      await activeRun;
    } finally {
      db.close();
    }
  });

  test('runTurn with queue policy keeps the new turn queued while an active turn is running', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const activeRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-active',
        input: 'wait',
      }));
      const activeTurnId = await adapter.started;
      const queuedEvents = await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-queued',
        input: 'new input',
        interruptPolicy: 'queue',
      }));

      expect(queuedEvents.map((event) => event.type)).toEqual(['turn.queued']);
      expect(queuedEvents[0]?.payload).toMatchObject({ activeTurnId, interruptPolicy: 'queue' });
      expect(adapter.runTurnInputs).toHaveLength(1);
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'running',
      });
      expect(db.prepare('SELECT status FROM runtime_turns WHERE request_id = ?').get('request-queued')).toMatchObject({
        status: 'queued',
      });

      adapter.finish();
      await activeRun;
      expect(db.prepare('SELECT status FROM runtime_turns WHERE request_id = ?').get('request-queued')).toMatchObject({
        status: 'queued',
      });
    } finally {
      db.close();
    }
  });

  test('runTurn with cancel-and-send cancels the active turn before starting the new one', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const activeRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-active',
        input: 'wait',
      }));
      const activeTurnId = await adapter.started;
      const replacementRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-replacement',
        input: 'new input',
        interruptPolicy: 'cancel-and-send',
      }));
      const startedTurnIds = await adapter.waitForStarts(2);
      const replacementTurnId = startedTurnIds[1];

      expect(replacementTurnId).not.toBe(activeTurnId);
      expect(adapter.cancelledTurnIds).toEqual([activeTurnId]);
      expect(db.prepare('SELECT status, cancel_reason FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'interrupted by a newer runtime turn',
      });
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(replacementTurnId)).toMatchObject({
        status: 'running',
      });

      adapter.finish();
      await Promise.all([activeRun, replacementRun]);
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'cancelled',
      });
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(replacementTurnId)).toMatchObject({
        status: 'completed',
      });
      expect(db.prepare("SELECT type FROM runtime_events WHERE turn_id = ? AND type = 'turn.canceling'").get(activeTurnId)).toMatchObject({
        type: 'turn.canceling',
      });
    } finally {
      db.close();
    }
  });

  test('cancel-and-send isolates the replacement in a fork when active cancel fails', async () => {
    const adapter = new CancelFailingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const activeRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-active-cancel-fails',
        input: 'wait',
      }));
      const activeTurnId = await adapter.started;
      const replacementRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-isolated-replacement',
        input: 'new input',
        interruptPolicy: 'cancel-and-send',
      }));
      const startedTurnIds = await adapter.waitForStarts(2);
      const replacementTurnId = startedTurnIds[1];

      const replacementRow = db.prepare('SELECT session_id, status FROM runtime_turns WHERE id = ?').get(replacementTurnId) as {
        session_id: string;
        status: string;
      };
      expect(replacementRow.session_id).not.toBe(session.runtimeSessionId);
      expect(replacementRow.status).toBe('running');
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'running',
      });
      expect(db.prepare('SELECT status, kind, at_turn_id FROM runtime_session_edges WHERE from_session_id = ?').get(session.runtimeSessionId)).toMatchObject({
        status: 'active',
        kind: 'fork',
        at_turn_id: activeTurnId,
      });
      expect(db.prepare("SELECT status FROM runtime_session_operations WHERE kind = 'fork'").get()).toMatchObject({
        status: 'compensated',
      });

      adapter.finish();
      await Promise.all([activeRun, replacementRun]);
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(activeTurnId)).toMatchObject({
        status: 'completed',
      });
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(replacementTurnId)).toMatchObject({
        status: 'completed',
      });
    } finally {
      db.close();
    }
  });

  test('queued turns keep request idempotency and can be claimed in FIFO order after the active turn completes', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, store, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const activeRun = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-active-queue-order',
        input: 'wait',
      }));
      await adapter.started;
      await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-queued-a',
        input: 'a',
        interruptPolicy: 'queue',
      }));
      await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-queued-b',
        input: 'b',
        interruptPolicy: 'queue',
      }));
      await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-queued-a',
        input: 'a',
        interruptPolicy: 'queue',
      }));

      adapter.finish();
      await activeRun;
      const claimed = store.claimNextTurn({ leaseOwner: 'queue-test' });
      expect(claimed?.requestId).toBe('request-queued-a');
      expect(db.prepare("SELECT COUNT(*) AS count FROM runtime_turns WHERE request_id = 'request-queued-a'").get()).toMatchObject({
        count: 1,
      });
    } finally {
      db.close();
    }
  });

  test('cancelTurn marks queued turns cancelled and appends a canonical event', async () => {
    const { db, store, orchestrator } = makeHarness();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });
      const turn = store.enqueueTurn({
        sessionId: session.runtimeSessionId,
        requestId: 'request-cancel',
        inputText: 'wait',
      });

      await orchestrator.cancelTurn({
        runtimeSessionId: session.runtimeSessionId,
        turnId: turn.id,
        requestId: 'cancel-1',
        reason: 'user cancel',
      });

      expect(db.prepare('SELECT status, cancel_reason FROM runtime_turns WHERE id = ?').get(turn.id)).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'user cancel',
      });
      expect(db.prepare('SELECT type FROM runtime_events WHERE turn_id = ?').get(turn.id)).toMatchObject({
        type: 'turn.cancelled',
      });
    } finally {
      db.close();
    }
  });

  test('cancelTurn keeps a running turn cancelled when the adapter exits without a cancelled event', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const run = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-running-cancel',
        input: 'wait',
      }));
      const turnId = await adapter.started;

      await orchestrator.cancelTurn({
        runtimeSessionId: session.runtimeSessionId,
        turnId,
        requestId: 'cancel-running-1',
        reason: 'user cancel',
      });

      adapter.finish();
      const events = await run;

      expect(events.map((event) => event.type)).toEqual(['turn.started', 'turn.completed']);
      expect(db.prepare('SELECT status, cancel_reason FROM runtime_turns WHERE id = ?').get(turnId)).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'user cancel',
      });
      expect(adapter.cancelledTurnId).toBe(turnId);
    } finally {
      db.close();
    }
  });

  test('cancelSession cancels a turn before the adapter emits its first event', async () => {
    const adapter = new SilentBlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const run = collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-session-cancel-before-event',
        input: 'wait',
      }));
      const turnId = await adapter.started;

      await orchestrator.cancelSession({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'cancel-session-before-event',
        reason: 'timeout',
      });

      expect(adapter.cancelledTurnId).toBe(turnId);
      adapter.finish();
      await run;
      expect(db.prepare('SELECT status, cancel_reason FROM runtime_turns WHERE id = ?').get(turnId)).toMatchObject({
        status: 'cancelled',
        cancel_reason: 'timeout',
      });
    } finally {
      db.close();
    }
  });

  test('browser disconnect stops reading without cancelling the adapter turn', async () => {
    const adapter = new BlockingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });
      const iterator = orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-browser-disconnect',
        input: 'wait',
      })[Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.value.type).toBe('turn.started');
      await iterator.return?.();

      expect(adapter.cancelledTurnIds).toEqual([]);
      expect(adapter.closeCalls).toEqual([session.runtimeSessionId]);
      expect(db.prepare('SELECT status FROM runtime_turns WHERE id = ?').get(first.value.turnId)).toMatchObject({
        status: 'running',
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM runtime_traces WHERE payload_json LIKE '%turn.consumer.detached%'").get()).toMatchObject({
        count: 1,
      });
      adapter.finish();
    } finally {
      db.close();
    }
  });

  test('compactSession and forkSession write operation trace and session graph records', async () => {
    const { db, orchestrator } = makeHarness();
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const compacted = await orchestrator.compactSession({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'compact-1',
      });
      const forked = await orchestrator.forkSession({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'fork-1',
        title: 'Fork',
      });

      expect(compacted).toMatchObject({ status: 'completed' });
      expect(forked.status).toBe('completed');
      expect(forked.forkedSessionId).toBeTruthy();
      expect(db.prepare("SELECT COUNT(*) AS count FROM runtime_session_operations WHERE status = 'completed'").get()).toMatchObject({ count: 2 });
      expect(db.prepare('SELECT from_session_id, to_session_id, kind FROM runtime_session_edges').get()).toMatchObject({
        from_session_id: session.runtimeSessionId,
        to_session_id: forked.forkedSessionId,
        kind: 'fork',
      });
      expect(db.prepare("SELECT COUNT(*) AS count FROM runtime_session_operations WHERE status IN ('pending','external-running','finalizing')").get()).toMatchObject({
        count: 0,
      });
    } finally {
      db.close();
    }
  });

  test('compact and fork failures write operation errors, traces, and graph compensation state', async () => {
    const adapter = new SagaFailingRuntimeAdapter();
    const { db, orchestrator } = makeHarness(adapter);
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const compacted = await orchestrator.compactSession({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'compact-fails',
        strategy: 'adapter-native',
      });
      const forked = await orchestrator.forkSession({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'fork-fails',
      });

      expect(compacted.status).toBe('failed');
      expect(forked.status).toBe('failed');
      expect(db.prepare("SELECT status FROM runtime_session_operations WHERE kind = 'compact'").get()).toMatchObject({
        status: 'failed',
      });
      expect(db.prepare("SELECT status FROM runtime_session_operations WHERE kind = 'fork'").get()).toMatchObject({
        status: 'compensated',
      });
      expect(db.prepare("SELECT status FROM runtime_session_edges WHERE kind = 'fork'").get()).toMatchObject({
        status: 'failed',
      });
      expect(JSON.stringify(db.prepare('SELECT payload_json FROM runtime_traces').all())).not.toContain('provider-session-private');
    } finally {
      db.close();
    }
  });

  test('adapter events update projections and projection caches can be rebuilt', async () => {
    const { db, store, orchestrator } = makeHarness(new ProjectionRuntimeAdapter());
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-projections',
        input: 'project',
      }));

      expect(store.getProjectionCache(session.runtimeSessionId, 'chat', 1)?.payload).toMatchObject({
        lastMessageEvent: { text: 'hello' },
      });
      expect(store.getProjectionCache(session.runtimeSessionId, 'workflow', 1)?.payload).toMatchObject({
        lastStatusEvent: 'turn.completed',
      });
      expect(store.getProjectionCache(session.runtimeSessionId, 'process-block', 1)?.payload).toMatchObject({
        lastProcessEvent: 'tool.completed',
      });

      db.prepare('DELETE FROM runtime_projection_cache').run();
      expect(store.rebuildProjectionCache({ sessionId: session.runtimeSessionId, projection: 'chat' }).payload).toMatchObject({
        messages: [{ payload: { text: 'hello' } }],
      });
      expect(store.rebuildProjectionCache({ sessionId: session.runtimeSessionId, projection: 'workflow' }).payload).toMatchObject({
        statusEvents: [
          { type: 'turn.started' },
          { type: 'status.changed' },
          { type: 'turn.completed' },
        ],
      });
      expect(store.rebuildProjectionCache({ sessionId: session.runtimeSessionId, projection: 'process-block' }).payload).toMatchObject({
        processBlocks: [
          { type: 'tool.started' },
          { type: 'tool.completed' },
        ],
      });
    } finally {
      db.close();
    }
  });

  test('adapter native ids are redacted from public events and traces on adapter failure', async () => {
    const { db, orchestrator } = makeHarness(new NativeIdFailingRuntimeAdapter());
    try {
      const session = await orchestrator.openSession({
        agentId: 'codex',
        kind: 'chat',
        cwd: process.cwd(),
      });

      const events = await collect(orchestrator.runTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId: 'request-native-redaction',
        input: 'fail',
      }));

      expect(events.map((event) => JSON.stringify(event))).not.toContain('provider-session-private');
      expect(events.map((event) => JSON.stringify(event))).not.toContain('native-session-private');
      expect(JSON.stringify(db.prepare('SELECT payload_json FROM runtime_events').all())).not.toContain('native-session-private');
      expect(JSON.stringify(db.prepare('SELECT payload_json FROM runtime_traces').all())).not.toContain('native-session-private');
    } finally {
      db.close();
    }
  });
});

class FakeRuntimeAdapter implements RuntimeAdapter {
  readonly createSessionInputs: AdapterSessionInput[] = [];
  readonly runTurnInputs: AdapterTurnInput[] = [];
  readonly closeCalls: string[] = [];

  async createOrLoadSession(input: AdapterSessionInput): Promise<RuntimeBinding> {
    this.createSessionInputs.push(input);
    const now = new Date().toISOString();
    return {
      id: `${input.runtimeSessionId}:fake:1`,
      runtimeSessionId: input.runtimeSessionId,
      runtime: input.modelRoute.runtime,
      role: 'primary',
      generation: 1,
      externalIds: {
        externalRecordId: 'record-private',
        externalSessionId: 'session-private',
        providerSessionId: 'provider-session-private',
      },
      raw: { private: true },
      createdAt: now,
      updatedAt: now,
    };
  }

  async *runTurn(_binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    this.runTurnInputs.push(input);
    yield {
      type: 'turn.started',
      payload: { ok: true },
      usage: missingUsage(),
      cost: missingCost(),
      redacted: true,
    };
    yield {
      type: 'message.delta',
      payload: { text: 'hello' },
      usage: missingUsage(),
      cost: missingCost(),
      redacted: true,
    };
    yield {
      type: 'turn.completed',
      payload: { ok: true },
      usage: { inputTokens: 1, outputTokens: 2, missing: false, sourceStatus: 'reported' },
      cost: missingCost(),
      redacted: true,
    };
  }

  async cancel(_binding: RuntimeBinding, _input: Parameters<RuntimeAdapter['cancel']>[1]): Promise<void> {}
  async close(binding: RuntimeBinding): Promise<void> {
    this.closeCalls.push(binding.runtimeSessionId);
  }
  async getCapabilities(): Promise<RuntimeCapabilities> {
    return createCapabilities();
  }
  async getStatus() {
    return { runtime: 'acpx' as const, status: 'idle' as const };
  }
}

class BlockingRuntimeAdapter extends FakeRuntimeAdapter {
  readonly started: Promise<string>;
  readonly cancelledTurnIds: string[] = [];
  cancelledTurnId?: string;
  private resolveStarted!: (turnId: string) => void;
  private resolveFinish!: () => void;
  private readonly finished: Promise<void>;
  private readonly startedTurnIds: string[] = [];
  private readonly startWaiters: Array<(turnIds: string[]) => void> = [];

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.finished = new Promise((resolve) => {
      this.resolveFinish = resolve;
    });
  }

  override async *runTurn(_binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    this.runTurnInputs.push(input);
    yield {
      type: 'turn.started',
      payload: { ok: true },
      usage: missingUsage(),
      cost: missingCost(),
      redacted: true,
    };
    this.startedTurnIds.push(input.turnId);
    this.resolveStarted(input.turnId);
    this.flushStartWaiters();
    await this.finished;
    yield {
      type: 'turn.completed',
      payload: { ok: true },
      usage: { inputTokens: 1, outputTokens: 2, missing: false, sourceStatus: 'reported' },
      cost: missingCost(),
      redacted: true,
    };
  }

  override async cancel(_binding: RuntimeBinding, input: Parameters<RuntimeAdapter['cancel']>[1]): Promise<void> {
    this.cancelledTurnId = input.turnId;
    this.cancelledTurnIds.push(input.turnId);
  }

  finish(): void {
    this.resolveFinish();
  }

  waitForStarts(count: number): Promise<string[]> {
    if (this.startedTurnIds.length >= count) return Promise.resolve([...this.startedTurnIds]);
    return new Promise((resolve) => {
      this.startWaiters.push((turnIds) => {
        if (turnIds.length >= count) resolve([...turnIds]);
      });
    });
  }

  private flushStartWaiters(): void {
    for (const waiter of this.startWaiters.splice(0)) waiter(this.startedTurnIds);
  }
}

class SilentBlockingRuntimeAdapter extends FakeRuntimeAdapter {
  readonly started: Promise<string>;
  cancelledTurnId?: string;
  private resolveStarted!: (turnId: string) => void;
  private resolveFinish!: () => void;
  private readonly finished: Promise<void>;

  constructor() {
    super();
    this.started = new Promise((resolve) => {
      this.resolveStarted = resolve;
    });
    this.finished = new Promise((resolve) => {
      this.resolveFinish = resolve;
    });
  }

  override async *runTurn(_binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    this.runTurnInputs.push(input);
    this.resolveStarted(input.turnId);
    await this.finished;
    yield {
      type: 'turn.completed',
      payload: { ok: true },
      usage: missingUsage(),
      cost: missingCost(),
      redacted: true,
    };
  }

  override async cancel(_binding: RuntimeBinding, input: Parameters<RuntimeAdapter['cancel']>[1]): Promise<void> {
    this.cancelledTurnId = input.turnId;
  }

  finish(): void {
    this.resolveFinish();
  }
}

class ReconnectingRuntimeAdapter extends FakeRuntimeAdapter {
  readonly reconnectInputs: AdapterSessionInput[] = [];

  async reconnectSession(input: AdapterSessionInput): Promise<RuntimeBinding> {
    this.reconnectInputs.push(input);
    const existing = input.existingBinding!;
    return {
      ...existing,
      externalIds: {
        ...existing.externalIds,
        providerSessionId: 'provider-session-refreshed',
      },
      updatedAt: new Date().toISOString(),
    };
  }
}

class CancelFailingRuntimeAdapter extends BlockingRuntimeAdapter {
  override async cancel(_binding: RuntimeBinding, input: Parameters<RuntimeAdapter['cancel']>[1]): Promise<void> {
    this.cancelledTurnId = input.turnId;
    this.cancelledTurnIds.push(input.turnId);
    throw new Error('native-session-private refused cancellation');
  }
}

class SagaFailingRuntimeAdapter extends FakeRuntimeAdapter {
  async compact(): Promise<never> {
    throw new Error('provider-session-private compact failed');
  }

  async fork(): Promise<never> {
    throw new Error('provider-session-private fork failed');
  }
}

class ProjectionRuntimeAdapter extends FakeRuntimeAdapter {
  override async *runTurn(_binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    this.runTurnInputs.push(input);
    yield { type: 'turn.started', payload: { ok: true }, usage: missingUsage(), cost: missingCost(), redacted: true };
    yield { type: 'status.changed', payload: { state: 'running' }, usage: missingUsage(), cost: missingCost(), redacted: true };
    yield { type: 'message.delta', payload: { text: 'hello' }, messageId: 'message-1', usage: missingUsage(), cost: missingCost(), redacted: true };
    yield { type: 'tool.started', payload: { name: 'shell' }, toolCallId: 'tool-1', usage: missingUsage(), cost: missingCost(), redacted: true };
    yield { type: 'tool.completed', payload: { exitCode: 0 }, toolCallId: 'tool-1', usage: missingUsage(), cost: missingCost(), redacted: true };
    yield { type: 'turn.completed', payload: { ok: true }, usage: missingUsage(), cost: missingCost(), redacted: true };
  }
}

class NativeIdFailingRuntimeAdapter extends FakeRuntimeAdapter {
  override async *runTurn(_binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    this.runTurnInputs.push(input);
    yield {
      type: 'message.delta',
      payload: {
        text: 'before failure',
        providerSessionId: 'native-session-private',
      },
      usage: missingUsage(),
      cost: missingCost(),
      redacted: true,
    };
    throw new Error('native-session-private exploded');
  }
}

function createModelRoute(agentId: string, runtime: 'acpx' | 'magic'): ResolvedModelRoute {
  return {
    modelRouteId: `route-${agentId}`,
    agentId,
    runtime,
    providerModel: 'test-model',
    configOptions: {},
    envRequirements: [],
    capabilities: createCapabilities(),
  };
}

function createCapabilities(): RuntimeCapabilities {
  return {
    streaming: true,
    cancel: true,
    commands: true,
    compact: true,
    fork: true,
    handoff: false,
    permissions: true,
    toolCalls: true,
    usage: 'reported',
  };
}

function missingUsage() {
  return { missing: true, sourceStatus: 'missing' as const };
}

function missingCost() {
  return { estimated: false, missing: true, sourceStatus: 'missing' as const };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
