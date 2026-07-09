import type {
  CancelTurnInput,
  CompactResult,
  CompactSessionInput,
  CostUsage,
  ForkResult,
  ForkSessionInput,
  OpenRuntimeSessionInput,
  RunRuntimeTurnInput,
  RuntimeEvent,
  RuntimeSessionKind,
  RuntimeSessionRef,
  RuntimeSessionStatus,
  RuntimeTurnRef,
  TokenUsage,
} from '@/lib/runtime-agent/contracts';
import { createRuntimeOrchestrator } from '@/lib/runtime-agent/orchestrator';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore, type RuntimeSessionRecord, type RuntimeTurnRecord } from '@/lib/runtime-agent/sqlite/runtime-store';
import { createRuntimeAdapterRegistry } from '@/lib/runtime-agent/adapters/adapter-registry';
import { createAcpxRuntimeClient } from '@/lib/runtime-agent/adapters/acpx-runtime-client';

export interface RuntimeSessionEventsInput {
  runtimeSessionId: string;
  afterSeq: number;
  limit: number;
}

export interface RuntimeSessionEventsPage {
  events: RuntimeEvent[];
  nextSeq: number;
}

export interface RuntimeSessionTracesInput {
  runtimeSessionId: string;
  limit: number;
  traceId?: string;
  turnId?: string;
}

export interface RuntimeSessionDiagnosticsInput {
  runtimeSessionId: string;
  eventLimit: number;
  traceLimit: number;
}

export interface RuntimeSessionAccess {
  runtimeSessionId: string;
  ownerUserId?: string;
}

export interface RuntimeTraceRow {
  id: string;
  traceId: string;
  runtimeSessionId?: string;
  turnId?: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  source: string;
  payload: unknown;
  redacted: boolean;
  createdAt: string;
}

export interface RuntimeDiagnosticBindingRow {
  id: string;
  runtimeSessionId: string;
  runtime: 'acpx' | 'magic';
  role: 'primary' | 'handoff-source' | 'handoff-target' | 'migration' | 'diagnostic';
  generation: number;
  raw: unknown;
  rawRedacted: true;
  externalIdsRedacted: true;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeSessionDiagnosticsBundle {
  session: RuntimeSessionRef;
  events: RuntimeEvent[];
  traces: RuntimeTraceRow[];
  bindings: RuntimeDiagnosticBindingRow[];
}

export interface CreateRuntimeTurnResult {
  turn: RuntimeTurnRef;
  created: boolean;
  events?: AsyncIterable<RuntimeEvent>;
}

export interface RuntimeSessionsApiService {
  createSession(input: OpenRuntimeSessionInput): Promise<RuntimeSessionRef>;
  getSession(runtimeSessionId: string): Promise<RuntimeSessionRef | null>;
  getSessionAccess(runtimeSessionId: string): Promise<RuntimeSessionAccess | null>;
  createTurn(input: RunRuntimeTurnInput): Promise<CreateRuntimeTurnResult>;
  readEvents(input: RuntimeSessionEventsInput): Promise<RuntimeSessionEventsPage>;
  readTraces(input: RuntimeSessionTracesInput): Promise<{ traces: RuntimeTraceRow[] }>;
  readDiagnostics(input: RuntimeSessionDiagnosticsInput): Promise<RuntimeSessionDiagnosticsBundle>;
  compactSession(input: CompactSessionInput): Promise<CompactResult>;
  forkSession(input: ForkSessionInput): Promise<ForkResult>;
  cancelTurn(input: CancelTurnInput): Promise<void>;
  cancelSession(input: { runtimeSessionId: string; requestId: string; reason?: string }): Promise<void>;
}

class SqliteRuntimeSessionsApiService implements RuntimeSessionsApiService {
  private readonly db: RuntimeSqliteDatabase;
  private readonly store: RuntimeSqliteStore;
  private readonly orchestrator;

  constructor(options: { db?: RuntimeSqliteDatabase; store?: RuntimeSqliteStore } = {}) {
    this.db = options.db ?? openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
    this.store = options.store ?? new RuntimeSqliteStore(this.db);
    this.orchestrator = createRuntimeOrchestrator({
      db: this.db,
      store: this.store,
      adapterRegistry: createRuntimeAdapterRegistry({
        acpxClient: createAcpxRuntimeClient(),
      }),
    });
  }

  async createSession(input: OpenRuntimeSessionInput): Promise<RuntimeSessionRef> {
    return this.orchestrator.openSession(input);
  }

  async getSession(runtimeSessionId: string): Promise<RuntimeSessionRef | null> {
    const session = this.store.getSession(runtimeSessionId);
    return session ? sessionRecordToRef(session) : null;
  }

  async getSessionAccess(runtimeSessionId: string): Promise<RuntimeSessionAccess | null> {
    const session = this.store.getSession(runtimeSessionId);
    return session ? { runtimeSessionId: session.id, ownerUserId: session.ownerUserId } : null;
  }

  async createTurn(input: RunRuntimeTurnInput): Promise<CreateRuntimeTurnResult> {
    const existing = this.store.getTurnByRequestId(input.runtimeSessionId, input.requestId);
    if (existing) {
      return { turn: turnRecordToRef(existing), created: false };
    }

    const events = backgroundRuntimeEvents(this.orchestrator.runTurn(input));
    const turn = await waitForRuntimeTurn(() => this.store.getTurnByRequestId(input.runtimeSessionId, input.requestId));
    return { turn: turnRecordToRef(turn), created: true, events };
  }

  async readEvents(input: RuntimeSessionEventsInput): Promise<RuntimeSessionEventsPage> {
    const events = this.store.listEventsAfter(input.runtimeSessionId, input.afterSeq, input.limit);
    return {
      events: events.map((event) => ({
        id: event.id,
        sessionId: event.sessionId,
        turnId: event.turnId,
        traceId: event.traceId,
        seq: event.seq,
        type: event.type as RuntimeEvent['type'],
        correlationId: event.correlationId,
        parentEventId: event.parentEventId,
        messageId: event.messageId,
        toolCallId: event.toolCallId,
        payload: event.payload,
        redacted: event.redacted,
        createdAt: event.createdAt,
      })),
      nextSeq: events.length > 0 ? events[events.length - 1]!.seq : input.afterSeq,
    };
  }

  async readTraces(input: RuntimeSessionTracesInput): Promise<{ traces: RuntimeTraceRow[] }> {
    const clauses = ['session_id = ?'];
    const values: unknown[] = [input.runtimeSessionId];
    if (input.traceId) {
      clauses.push('trace_id = ?');
      values.push(input.traceId);
    }
    if (input.turnId) {
      clauses.push('turn_id = ?');
      values.push(input.turnId);
    }
    values.push(Math.max(1, Math.min(input.limit, 1000)));
    const rows = this.db.prepare(`
      SELECT id, trace_id, session_id, turn_id, level, source, payload_json, redacted, created_at
      FROM runtime_traces
      WHERE ${clauses.join(' AND ')}
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(...values);
    return { traces: rows.map(rowToTrace) };
  }

  async readDiagnostics(input: RuntimeSessionDiagnosticsInput): Promise<RuntimeSessionDiagnosticsBundle> {
    const session = this.store.getSession(input.runtimeSessionId);
    if (!session) {
      const error = new Error('Runtime session not found') as Error & { code?: string };
      error.code = 'NOT_FOUND';
      throw error;
    }

    const events = await this.readEvents({
      runtimeSessionId: input.runtimeSessionId,
      afterSeq: 0,
      limit: input.eventLimit,
    });
    const traces = await this.readTraces({
      runtimeSessionId: input.runtimeSessionId,
      limit: input.traceLimit,
    });
    const bindings = this.db.prepare(`
      SELECT id, session_id, runtime, role, generation, raw_json, created_at, updated_at
      FROM runtime_bindings
      WHERE session_id = ?
      ORDER BY generation ASC, runtime ASC, role ASC, id ASC
    `).all(input.runtimeSessionId);

    return {
      session: sessionRecordToRef(session),
      events: events.events,
      traces: traces.traces,
      bindings: bindings.map(rowToDiagnosticBinding),
    };
  }

  async compactSession(input: CompactSessionInput): Promise<CompactResult> {
    return this.orchestrator.compactSession(input);
  }

  async forkSession(input: ForkSessionInput): Promise<ForkResult> {
    return this.orchestrator.forkSession(input);
  }

  async cancelTurn(input: CancelTurnInput): Promise<void> {
    return this.orchestrator.cancelTurn(input);
  }

  async cancelSession(input: { runtimeSessionId: string; requestId: string; reason?: string }): Promise<void> {
    const active = this.store.getActiveTurn(input.runtimeSessionId);
    if (!active) return;
    await this.orchestrator.cancelTurn({
      runtimeSessionId: input.runtimeSessionId,
      turnId: active.id,
      requestId: input.requestId,
      reason: input.reason,
    });
  }
}

let runtimeSessionsApiService: RuntimeSessionsApiService | null = null;

export function createSqliteRuntimeSessionsApiService(
  options: { db?: RuntimeSqliteDatabase; store?: RuntimeSqliteStore } = {},
): RuntimeSessionsApiService {
  return new SqliteRuntimeSessionsApiService(options);
}

export function getRuntimeSessionsApiService(): RuntimeSessionsApiService {
  runtimeSessionsApiService ??= new SqliteRuntimeSessionsApiService();
  return runtimeSessionsApiService;
}

export function setRuntimeSessionsApiServiceForTesting(service: RuntimeSessionsApiService): void {
  runtimeSessionsApiService = service;
}

export function resetRuntimeSessionsApiServiceForTesting(): void {
  runtimeSessionsApiService = null;
}

function sessionRecordToRef(session: RuntimeSessionRecord): RuntimeSessionRef {
  return {
    runtimeSessionId: session.id,
    agentId: session.agentId,
    kind: session.kind as RuntimeSessionKind,
    status: session.status as RuntimeSessionStatus,
    modelRouteId: session.modelRouteId,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function turnRecordToRef(turn: RuntimeTurnRecord): RuntimeTurnRef {
  return {
    turnId: turn.id,
    runtimeSessionId: turn.sessionId,
    requestId: turn.requestId,
    traceId: turn.traceId,
    status: turn.status,
    queuedAt: turn.queuedAt,
    startedAt: turn.startedAt,
    finishedAt: turn.finishedAt,
    usage: turn.usage as TokenUsage | undefined,
    cost: turn.cost as CostUsage | undefined,
    error: turn.error as RuntimeTurnRef['error'],
  };
}

function rowToTrace(row: any): RuntimeTraceRow {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    runtimeSessionId: typeof row.session_id === 'string' && row.session_id.length > 0 ? row.session_id : undefined,
    turnId: typeof row.turn_id === 'string' && row.turn_id.length > 0 ? row.turn_id : undefined,
    level: row.level,
    source: String(row.source),
    payload: parseTracePayload(row.payload_json),
    redacted: Number(row.redacted) === 1,
    createdAt: String(row.created_at),
  };
}

function rowToDiagnosticBinding(row: any): RuntimeDiagnosticBindingRow {
  return {
    id: String(row.id),
    runtimeSessionId: String(row.session_id),
    runtime: row.runtime,
    role: row.role,
    generation: Number(row.generation),
    raw: parseTracePayload(row.raw_json),
    rawRedacted: true,
    externalIdsRedacted: true,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseTracePayload(input: unknown): unknown {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function backgroundRuntimeEvents(source: AsyncIterable<RuntimeEvent>): AsyncIterable<RuntimeEvent> {
  const events: RuntimeEvent[] = [];
  const waiters: Array<() => void> = [];
  let done = false;
  let error: unknown;

  const notify = () => {
    for (const waiter of waiters.splice(0)) waiter();
  };

  const waitForEvent = () => new Promise<void>((resolve) => {
    waiters.push(resolve);
  });

  void (async () => {
    try {
      for await (const event of source) {
        events.push(event);
        notify();
      }
    } catch (caught) {
      error = caught;
    } finally {
      done = true;
      notify();
    }
  })();

  return {
    async *[Symbol.asyncIterator]() {
      let index = 0;
      while (true) {
        while (index < events.length) {
          yield events[index++]!;
        }
        if (done) {
          if (error) throw error;
          return;
        }
        await waitForEvent();
      }
    },
  };
}

async function waitForRuntimeTurn(read: () => RuntimeTurnRecord | null): Promise<RuntimeTurnRecord> {
  const deadline = Date.now() + 2000;
  let turn = read();
  while (!turn && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    turn = read();
  }
  if (!turn) {
    throw new Error('Runtime turn was not created by orchestrator');
  }
  return turn;
}
