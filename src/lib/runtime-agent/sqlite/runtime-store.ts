import { randomUUID } from 'crypto';
import type { RuntimeSqliteDatabase } from './database';
import { withImmediateTransaction } from './database';

export type RuntimeTurnStatus =
  | 'queued'
  | 'running'
  | 'canceling'
  | 'cancelled'
  | 'completed'
  | 'failed'
  | 'dropped'
  | 'expired'
  | 'invalid';

export type RuntimeInterruptPolicy = 'queue' | 'cancel-and-send' | 'reject';
export type RuntimeProjection = 'chat' | 'workflow' | 'process-block';

export interface RuntimeTurnRecord {
  id: string;
  sessionId: string;
  requestId: string;
  traceId: string;
  status: RuntimeTurnStatus;
  interruptPolicy: RuntimeInterruptPolicy;
  inputText: string;
  queuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  leaseOwner?: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  cancelReason?: string;
  cancelRequestId?: string;
  error?: unknown;
  usage?: unknown;
  cost?: unknown;
}

export interface RuntimeEventRecord {
  id: string;
  sessionId: string;
  turnId?: string;
  traceId: string;
  seq: number;
  type: string;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  payload: unknown;
  redacted: boolean;
  createdAt: string;
}

export interface EnqueueTurnInput {
  id?: string;
  sessionId: string;
  requestId: string;
  traceId?: string;
  interruptPolicy?: RuntimeInterruptPolicy;
  inputText: string;
  queuedAt?: string;
}

export interface ClaimNextTurnInput {
  leaseOwner: string;
  leaseToken?: string;
  leaseDurationMs?: number;
  now?: Date;
}

export interface AppendEventInput {
  id?: string;
  sessionId: string;
  turnId?: string;
  traceId: string;
  type: string;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  payload?: unknown;
  redacted?: boolean;
  createdAt?: string;
  projectionUpdate?: ProjectionUpdateInput;
}

export interface ProjectionUpdateInput {
  id?: string;
  projection: RuntimeProjection;
  version: number;
  payload: unknown;
}

export interface CompleteTurnInput {
  turnId: string;
  leaseToken: string;
  status?: Extract<RuntimeTurnStatus, 'completed' | 'failed' | 'cancelled' | 'expired' | 'invalid'>;
  usage?: unknown;
  cost?: unknown;
  error?: unknown;
  finishedAt?: string;
  projectionUpdate?: ProjectionUpdateInput;
}

export interface CancelQueuedTurnInput {
  turnId: string;
  cancelRequestId?: string;
  reason?: string;
  dropped?: boolean;
  now?: string;
}

type RuntimeTurnRow = Record<string, any> & {
  id: string;
  session_id: string;
  status: RuntimeTurnStatus;
  lease_token?: string | null;
  usage_json?: string | null;
  cost_json?: string | null;
  error_json?: string | null;
};

function nowIso(date = new Date()): string {
  return date.toISOString();
}

function toJson(input: unknown): string {
  return JSON.stringify(input ?? null);
}

function fromJson(input: unknown): unknown {
  if (typeof input !== 'string') return null;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function rowToTurn(row: any): RuntimeTurnRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    requestId: String(row.request_id),
    traceId: String(row.trace_id),
    status: row.status as RuntimeTurnStatus,
    interruptPolicy: row.interrupt_policy as RuntimeInterruptPolicy,
    inputText: String(row.input_text),
    queuedAt: String(row.queued_at),
    startedAt: optionalString(row.started_at),
    finishedAt: optionalString(row.finished_at),
    leaseOwner: optionalString(row.lease_owner),
    leaseToken: optionalString(row.lease_token),
    leaseExpiresAt: optionalString(row.lease_expires_at),
    cancelReason: optionalString(row.cancel_reason),
    cancelRequestId: optionalString(row.cancel_request_id),
    error: fromJson(row.error_json),
    usage: fromJson(row.usage_json),
    cost: fromJson(row.cost_json),
  };
}

function rowToEvent(row: any): RuntimeEventRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    turnId: optionalString(row.turn_id),
    traceId: String(row.trace_id),
    seq: Number(row.seq),
    type: String(row.type),
    correlationId: optionalString(row.correlation_id),
    parentEventId: optionalString(row.parent_event_id),
    messageId: optionalString(row.message_id),
    toolCallId: optionalString(row.tool_call_id),
    payload: fromJson(row.payload_json),
    redacted: Number(row.redacted) === 1,
    createdAt: String(row.created_at),
  };
}

export class RuntimeSqliteStore {
  constructor(private readonly db: RuntimeSqliteDatabase) {}

  enqueueTurn(input: EnqueueTurnInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const existing = this.db
        .prepare('SELECT * FROM runtime_turns WHERE session_id = ? AND request_id = ?')
        .get(input.sessionId, input.requestId);
      if (existing) return rowToTurn(existing);

      const id = input.id ?? randomUUID();
      const queuedAt = input.queuedAt ?? nowIso();
      this.db.prepare(`
        INSERT INTO runtime_turns (
          id, session_id, request_id, trace_id, status, interrupt_policy, input_text, queued_at
        )
        VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
      `).run(
        id,
        input.sessionId,
        input.requestId,
        input.traceId ?? randomUUID(),
        input.interruptPolicy ?? 'queue',
        input.inputText,
        queuedAt,
      );

      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(id));
    });
  }

  claimNextTurn(input: ClaimNextTurnInput): RuntimeTurnRecord | null {
    const now = input.now ?? new Date();
    const nowText = nowIso(now);
    const leaseToken = input.leaseToken ?? randomUUID();
    const leaseExpiresAt = nowIso(new Date(now.getTime() + (input.leaseDurationMs ?? 30_000)));

    return withImmediateTransaction(this.db, () => {
      const queued = this.db.prepare(`
        SELECT *
        FROM runtime_turns AS candidate
        WHERE candidate.status = 'queued'
          AND NOT EXISTS (
            SELECT 1
            FROM runtime_turns AS active
            WHERE active.session_id = candidate.session_id
              AND active.status IN ('running','canceling')
          )
        ORDER BY candidate.queued_at ASC, candidate.id ASC
        LIMIT 1
      `).get() as RuntimeTurnRow | undefined;

      const expired = queued ? null : this.db.prepare(`
        SELECT *
        FROM runtime_turns
        WHERE status IN ('running','canceling')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ?
        ORDER BY lease_expires_at ASC, id ASC
        LIMIT 1
      `).get(nowText) as RuntimeTurnRow | undefined;

      const row = queued ?? expired;
      if (!row) return null;

      const result = this.db.prepare(`
        UPDATE runtime_turns
        SET status = 'running',
          started_at = COALESCE(started_at, ?),
          lease_owner = ?,
          lease_token = ?,
          lease_expires_at = ?
        WHERE id = ?
          AND (
            status = 'queued'
            OR (status IN ('running','canceling') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
          )
      `).run(nowText, input.leaseOwner, leaseToken, leaseExpiresAt, row.id, nowText);

      if (result.changes !== 1) return null;
      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(row.id));
    });
  }

  appendEvent(input: AppendEventInput): RuntimeEventRecord {
    return withImmediateTransaction(this.db, () => {
      const seqRow = this.db
        .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM runtime_events WHERE session_id = ?')
        .get(input.sessionId) as { seq?: number } | undefined;
      const seq = Number(seqRow?.seq ?? 1);
      const id = input.id ?? randomUUID();
      const createdAt = input.createdAt ?? nowIso();

      this.db.prepare(`
        INSERT INTO runtime_events (
          id, session_id, turn_id, trace_id, seq, type, correlation_id, parent_event_id,
          message_id, tool_call_id, payload_json, redacted, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.sessionId,
        input.turnId ?? null,
        input.traceId,
        seq,
        input.type,
        input.correlationId ?? null,
        input.parentEventId ?? null,
        input.messageId ?? null,
        input.toolCallId ?? null,
        toJson(input.payload ?? null),
        input.redacted ? 1 : 0,
        createdAt,
      );

      if (input.projectionUpdate) {
        this.upsertProjectionCache(input.sessionId, seq, input.projectionUpdate, createdAt);
      }

      return rowToEvent(this.db.prepare('SELECT * FROM runtime_events WHERE id = ?').get(id));
    });
  }

  completeTurn(input: CompleteTurnInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId) as RuntimeTurnRow | undefined;
      if (!row) throw new Error(`Runtime turn not found: ${input.turnId}`);
      if (row.lease_token !== input.leaseToken) {
        throw new Error(`Runtime turn lease token mismatch: ${input.turnId}`);
      }
      if (!['running', 'canceling'].includes(String(row.status))) {
        throw new Error(`Runtime turn is not active: ${input.turnId}`);
      }

      const finishedAt = input.finishedAt ?? nowIso();
      this.db.prepare(`
        UPDATE runtime_turns
        SET status = ?,
          finished_at = ?,
          lease_owner = NULL,
          lease_token = NULL,
          lease_expires_at = NULL,
          usage_json = ?,
          cost_json = ?,
          error_json = ?
        WHERE id = ? AND lease_token = ?
      `).run(
        input.status ?? 'completed',
        finishedAt,
        input.usage === undefined ? row.usage_json : toJson(input.usage),
        input.cost === undefined ? row.cost_json : toJson(input.cost),
        input.error === undefined ? row.error_json : toJson(input.error),
        input.turnId,
        input.leaseToken,
      );

      if (input.projectionUpdate) {
        const seqRow = this.db
          .prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM runtime_events WHERE session_id = ?')
          .get(row.session_id) as { seq?: number } | undefined;
        this.upsertProjectionCache(String(row.session_id), Number(seqRow?.seq ?? 0), input.projectionUpdate, finishedAt);
      }

      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId));
    });
  }

  cancelQueuedTurn(input: CancelQueuedTurnInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId) as RuntimeTurnRow | undefined;
      if (!row) throw new Error(`Runtime turn not found: ${input.turnId}`);
      if (row.status !== 'queued') {
        throw new Error(`Runtime turn is not queued: ${input.turnId}`);
      }

      this.db.prepare(`
        UPDATE runtime_turns
        SET status = ?,
          finished_at = ?,
          cancel_reason = ?,
          cancel_request_id = ?
        WHERE id = ? AND status = 'queued'
      `).run(
        input.dropped ? 'dropped' : 'cancelled',
        input.now ?? nowIso(),
        input.reason ?? null,
        input.cancelRequestId ?? null,
        input.turnId,
      );

      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId));
    });
  }

  private upsertProjectionCache(
    sessionId: string,
    lastSeq: number,
    input: ProjectionUpdateInput,
    now: string,
  ): void {
    this.db.prepare(`
      INSERT INTO runtime_projection_cache (
        id, session_id, projection, version, last_seq, payload_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, projection, version) DO UPDATE SET
        last_seq = excluded.last_seq,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      input.id ?? randomUUID(),
      sessionId,
      input.projection,
      input.version,
      lastSeq,
      toJson(input.payload),
      now,
      now,
    );
  }
}
