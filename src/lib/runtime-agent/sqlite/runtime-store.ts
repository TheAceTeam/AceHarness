import { randomUUID } from 'crypto';
import type { RuntimePermissionPolicyId } from '../contracts';
import type { RuntimeEnvProfileDto, RuntimeSecretProfileDto } from '../security/env-secret-profiles';
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
export type RuntimeSessionStatus =
  | 'creating'
  | 'active'
  | 'archived'
  | 'compacted'
  | 'forking'
  | 'compacting'
  | 'invalid'
  | 'deleted';
export type RuntimeSessionKind =
  | 'chat'
  | 'agent'
  | 'workflow-agent'
  | 'workflow-supervisor'
  | 'agora'
  | 'probe'
  | 'diagnostic';
export type RuntimeProfileVisibility = 'private' | 'workspace';

export interface RuntimePermissionPolicyRecord {
  id: string;
  ownerUserId?: string;
  visibility: RuntimeProfileVisibility;
  policyId: RuntimePermissionPolicyId;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeEnvProfileRecord extends RuntimeEnvProfileDto {
  ownerUserId?: string;
  visibility: RuntimeProfileVisibility;
}

export interface RuntimeSecretProfileRecord extends RuntimeSecretProfileDto {
  ownerUserId?: string;
  visibility: RuntimeProfileVisibility;
}

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

export interface RuntimeSessionRecord {
  id: string;
  kind: RuntimeSessionKind;
  agentId: string;
  modelRouteId?: string;
  ownerUserId?: string;
  title?: string;
  status: RuntimeSessionStatus;
  workingDirectory: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeBindingRecord {
  id: string;
  sessionId: string;
  runtime: 'acpx' | 'magic';
  role: 'primary' | 'handoff-source' | 'handoff-target' | 'migration' | 'diagnostic';
  generation: number;
  externalRecordId?: string;
  externalSessionId?: string;
  providerSessionId?: string;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeOperationRecord {
  id: string;
  sessionId: string;
  targetSessionId?: string;
  kind: 'fork' | 'compact' | 'restore' | 'rollback' | 'summary-handoff';
  status: 'pending' | 'external-running' | 'finalizing' | 'completed' | 'failed' | 'compensating' | 'compensated';
  traceId: string;
  request: unknown;
  result?: unknown;
  error?: unknown;
  compensation?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeSessionEdgeRecord {
  id: string;
  operationId?: string;
  fromSessionId: string;
  toSessionId: string;
  kind: RuntimeOperationRecord['kind'];
  status: 'pending' | 'active' | 'failed';
  atTurnId?: string;
  atMessageId?: string;
  summary?: string;
  error?: unknown;
  metadata: unknown;
  createdAt: string;
}

export interface RuntimeTraceRecord {
  id: string;
  traceId: string;
  sessionId?: string;
  turnId?: string;
  level: AppendTraceInput['level'];
  source: AppendTraceInput['source'];
  payload: unknown;
  redacted: boolean;
  createdAt: string;
}

export interface RuntimeProjectionCacheRecord {
  id: string;
  sessionId: string;
  projection: RuntimeProjection;
  version: number;
  lastSeq: number;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AgentRuntimeStateRecord {
  agentId: string;
  enabled: boolean;
  hidden: boolean;
  override: unknown;
  availabilityStatus: 'unknown' | 'available' | 'missing' | 'error' | 'misconfigured' | 'failed';
  availabilityCheckedAt?: string;
  envReadiness: unknown;
  capabilityProbe: unknown;
  discovery: unknown;
  createdAt: string;
  updatedAt: string;
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

export interface ClaimTurnInput {
  turnId: string;
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

export interface MarkTurnCancelingInput {
  turnId: string;
  cancelRequestId?: string;
  reason?: string;
  now?: string;
}

export interface RejectQueuedTurnInput {
  turnId: string;
  error?: unknown;
  now?: string;
}

export interface CreateSessionInput {
  id?: string;
  kind: RuntimeSessionKind;
  agentId: string;
  modelRouteId?: string;
  ownerUserId?: string;
  title?: string;
  status?: RuntimeSessionStatus;
  workingDirectory: string;
  now?: string;
}

export interface UpdateSessionStatusInput {
  sessionId: string;
  status: RuntimeSessionStatus;
  now?: string;
}

export interface SaveSessionSnapshotInput {
  id?: string;
  sessionId: string;
  turnId?: string;
  agentId: string;
  modelRouteId?: string;
  systemPromptHash?: string;
  skillsRevision?: string;
  mcpRevision?: string;
  interruptPolicy: RuntimeInterruptPolicy;
  skills?: unknown[];
  mcpServers?: unknown[];
  envProfileId?: string;
  secretProfileId?: string;
  permissionPolicyId?: string;
  cwd: string;
  snapshot: unknown;
  createdAt?: string;
}

export interface UpsertBindingInput {
  id: string;
  sessionId: string;
  runtime: 'acpx' | 'magic';
  role?: RuntimeBindingRecord['role'];
  generation?: number;
  externalRecordId?: string;
  externalSessionId?: string;
  providerSessionId?: string;
  raw?: unknown;
  now?: string;
}

export interface AppendTraceInput {
  id?: string;
  traceId: string;
  sessionId?: string;
  turnId?: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  source: 'orchestrator' | 'adapter' | 'permission' | 'profile' | 'queue' | 'projection' | 'diagnostic';
  payload?: unknown;
  redacted?: boolean;
  createdAt?: string;
}

export interface CreateOperationInput {
  id?: string;
  sessionId: string;
  targetSessionId?: string;
  kind: RuntimeOperationRecord['kind'];
  status?: RuntimeOperationRecord['status'];
  traceId: string;
  request?: unknown;
  now?: string;
}

export interface CompleteOperationInput {
  operationId: string;
  status: Extract<RuntimeOperationRecord['status'], 'completed' | 'failed'>;
  targetSessionId?: string;
  result?: unknown;
  error?: unknown;
  compensation?: unknown;
  now?: string;
}

export interface UpdateOperationStatusInput {
  operationId: string;
  status: RuntimeOperationRecord['status'];
  targetSessionId?: string;
  result?: unknown;
  error?: unknown;
  compensation?: unknown;
  now?: string;
}

export interface CreateSessionEdgeInput {
  id?: string;
  operationId?: string;
  fromSessionId: string;
  toSessionId: string;
  kind: RuntimeOperationRecord['kind'];
  status?: 'pending' | 'active' | 'failed';
  atTurnId?: string;
  atMessageId?: string;
  summary?: string;
  error?: unknown;
  metadata?: unknown;
  createdAt?: string;
}

export interface UpsertAgentRuntimeStateInput {
  agentId: string;
  enabled?: boolean;
  hidden?: boolean;
  override?: unknown;
  availabilityStatus?: AgentRuntimeStateRecord['availabilityStatus'];
  availabilityCheckedAt?: string;
  envReadiness?: unknown;
  capabilityProbe?: unknown;
  discovery?: unknown;
  now?: string;
}

export interface RuntimeProfileAccessInput {
  ownerUserId?: string;
  includeWorkspace?: boolean;
}

export interface UpsertPermissionPolicyInput {
  id?: string;
  ownerUserId?: string;
  visibility?: RuntimeProfileVisibility;
  policyId: RuntimePermissionPolicyId;
  displayName?: string;
  now?: string;
}

export interface UpsertEnvProfileInput extends RuntimeEnvProfileDto {
  ownerUserId?: string;
  visibility?: RuntimeProfileVisibility;
}

export interface UpsertSecretProfileInput extends RuntimeSecretProfileDto {
  ownerUserId?: string;
  visibility?: RuntimeProfileVisibility;
}

export interface ReclaimExpiredLeasesInput {
  leaseOwner: string;
  leaseToken?: string;
  leaseDurationMs?: number;
  now?: Date;
  limit?: number;
}

export interface RestoreTurnRunningInput {
  turnId: string;
  error?: unknown;
  now?: string;
}

export interface RebuildProjectionCacheInput {
  sessionId: string;
  projection: RuntimeProjection;
  version?: number;
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

function toStoredAvailabilityStatus(
  status: UpsertAgentRuntimeStateInput['availabilityStatus'] | undefined,
): 'unknown' | 'available' | 'missing' | 'misconfigured' | 'failed' | undefined {
  return status === 'error' ? 'failed' : status;
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

function rowToSession(row: any): RuntimeSessionRecord {
  return {
    id: String(row.id),
    kind: row.kind as RuntimeSessionKind,
    agentId: String(row.agent_id),
    modelRouteId: optionalString(row.model_route_id),
    ownerUserId: optionalString(row.owner_user_id),
    title: optionalString(row.title),
    status: row.status as RuntimeSessionStatus,
    workingDirectory: String(row.working_directory),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToBinding(row: any): RuntimeBindingRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runtime: row.runtime,
    role: row.role,
    generation: Number(row.generation),
    externalRecordId: optionalString(row.external_record_id),
    externalSessionId: optionalString(row.external_session_id),
    providerSessionId: optionalString(row.provider_session_id),
    raw: fromJson(row.raw_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToOperation(row: any): RuntimeOperationRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    targetSessionId: optionalString(row.target_session_id),
    kind: row.kind,
    status: row.status,
    traceId: String(row.trace_id),
    request: fromJson(row.request_json),
    result: fromJson(row.result_json),
    error: fromJson(row.error_json),
    compensation: fromJson(row.compensation_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToTrace(row: any): RuntimeTraceRecord {
  return {
    id: String(row.id),
    traceId: String(row.trace_id),
    sessionId: optionalString(row.session_id),
    turnId: optionalString(row.turn_id),
    level: row.level,
    source: row.source,
    payload: fromJson(row.payload_json),
    redacted: Number(row.redacted) === 1,
    createdAt: String(row.created_at),
  };
}

function rowToSessionEdge(row: any): RuntimeSessionEdgeRecord {
  return {
    id: String(row.id),
    operationId: optionalString(row.operation_id),
    fromSessionId: String(row.from_session_id),
    toSessionId: String(row.to_session_id),
    kind: row.kind,
    status: row.status,
    atTurnId: optionalString(row.at_turn_id),
    atMessageId: optionalString(row.at_message_id),
    summary: optionalString(row.summary),
    error: fromJson(row.error_json),
    metadata: fromJson(row.metadata_json),
    createdAt: String(row.created_at),
  };
}

function rowToPermissionPolicy(row: any): RuntimePermissionPolicyRecord {
  return {
    id: String(row.id),
    ownerUserId: optionalString(row.owner_user_id),
    visibility: (row.visibility ?? 'workspace') as RuntimeProfileVisibility,
    policyId: (row.policy_id ?? row.id ?? 'unrestricted') as RuntimePermissionPolicyId,
    displayName: String(row.display_name ?? row.id ?? 'Unrestricted'),
    createdAt: String(row.created_at ?? '1970-01-01T00:00:00.000Z'),
    updatedAt: String(row.updated_at ?? '1970-01-01T00:00:00.000Z'),
  };
}

function rowToEnvProfile(row: any): RuntimeEnvProfileRecord {
  return {
    id: String(row.id),
    ownerUserId: optionalString(row.owner_user_id),
    visibility: (row.visibility ?? 'private') as RuntimeProfileVisibility,
    displayName: String(row.display_name ?? row.id),
    agentId: optionalString(row.agent_id),
    variables: Array.isArray(fromJson(row.variables_json)) ? fromJson(row.variables_json) as RuntimeEnvProfileRecord['variables'] : [],
    createdAt: optionalString(row.created_at),
    updatedAt: optionalString(row.updated_at),
  };
}

function rowToSecretProfile(row: any): RuntimeSecretProfileRecord {
  return {
    id: String(row.id),
    ownerUserId: optionalString(row.owner_user_id),
    visibility: (row.visibility ?? 'private') as RuntimeProfileVisibility,
    displayName: String(row.display_name ?? row.id),
    agentId: optionalString(row.agent_id),
    encrypted: Number(row.encrypted ?? 0) === 1,
    encryptionKeyReady: Number(row.encryption_key_ready ?? 0) === 1,
    secrets: Array.isArray(fromJson(row.secrets_json)) ? fromJson(row.secrets_json) as RuntimeSecretProfileRecord['secrets'] : [],
    createdAt: optionalString(row.created_at),
    updatedAt: optionalString(row.updated_at),
  };
}

function rowToProjectionCache(row: any): RuntimeProjectionCacheRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    projection: row.projection,
    version: Number(row.version),
    lastSeq: Number(row.last_seq),
    payload: fromJson(row.payload_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function rowToAgentRuntimeState(row: any): AgentRuntimeStateRecord {
  return {
    agentId: String(row.agent_id),
    enabled: Number(row.enabled) === 1,
    hidden: Number(row.hidden) === 1,
    override: fromJson(row.override_json),
    availabilityStatus: row.availability_status,
    availabilityCheckedAt: optionalString(row.availability_checked_at),
    envReadiness: fromJson(row.env_readiness_json),
    capabilityProbe: fromJson(row.capability_probe_json),
    discovery: fromJson(row.discovery_json),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function buildProjectionPayload(projection: RuntimeProjection, events: RuntimeEventRecord[]): unknown {
  if (projection === 'chat') {
    return {
      messages: events
        .filter((event) => event.type === 'message.delta' || event.type === 'message.completed')
        .map((event) => ({
          eventId: event.id,
          seq: event.seq,
          turnId: event.turnId,
          messageId: event.messageId,
          payload: event.payload,
        })),
    };
  }
  if (projection === 'workflow') {
    return {
      statusEvents: events
        .filter((event) => event.type === 'status.changed' || event.type.startsWith('turn.'))
        .map((event) => ({
          eventId: event.id,
          seq: event.seq,
          turnId: event.turnId,
          type: event.type,
          payload: event.payload,
        })),
    };
  }
  return {
    processBlocks: events
      .filter((event) => event.type.startsWith('tool.') || event.type === 'command.invoked')
      .map((event) => ({
        eventId: event.id,
        seq: event.seq,
        turnId: event.turnId,
        toolCallId: event.toolCallId,
        type: event.type,
        payload: event.payload,
      })),
  };
}

export class RuntimeSqliteStore {
  constructor(private readonly db: RuntimeSqliteDatabase) {}

  transaction<T>(fn: () => T): T {
    return withImmediateTransaction(this.db, fn);
  }

  upsertPermissionPolicy(input: UpsertPermissionPolicyInput): RuntimePermissionPolicyRecord {
    const id = input.id ?? input.policyId;
    const now = input.now ?? nowIso();
    this.db.prepare(`
      INSERT INTO permission_policies (
        id, owner_user_id, visibility, policy_id, display_name, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        visibility = excluded.visibility,
        policy_id = excluded.policy_id,
        display_name = excluded.display_name,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.ownerUserId ?? null,
      input.visibility ?? 'workspace',
      input.policyId,
      input.displayName ?? input.policyId,
      now,
      now,
    );
    return this.getPermissionPolicy(id)!;
  }

  getPermissionPolicy(id: string, access: RuntimeProfileAccessInput = {}): RuntimePermissionPolicyRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM permission_policies
      WHERE id = ?
        AND (
          (? = 1 AND visibility = 'workspace')
          OR owner_user_id = ?
        )
    `).get(id, access.includeWorkspace === false ? 0 : 1, access.ownerUserId ?? null);
    return row ? rowToPermissionPolicy(row) : null;
  }

  listPermissionPolicies(access: RuntimeProfileAccessInput = {}): RuntimePermissionPolicyRecord[] {
    return this.db.prepare(`
      SELECT *
      FROM permission_policies
      WHERE owner_user_id = ?
        OR (? = 1 AND visibility = 'workspace')
      ORDER BY display_name ASC, id ASC
    `).all(access.ownerUserId ?? null, access.includeWorkspace === false ? 0 : 1).map(rowToPermissionPolicy);
  }

  upsertEnvProfile(input: UpsertEnvProfileInput): RuntimeEnvProfileRecord {
    const now = input.updatedAt ?? input.createdAt ?? nowIso();
    this.db.prepare(`
      INSERT INTO env_profiles (
        id, owner_user_id, visibility, display_name, agent_id, variables_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        visibility = excluded.visibility,
        display_name = excluded.display_name,
        agent_id = excluded.agent_id,
        variables_json = excluded.variables_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.ownerUserId ?? null,
      input.visibility ?? 'private',
      input.displayName,
      input.agentId ?? null,
      toJson(input.variables),
      input.createdAt ?? now,
      now,
    );
    return this.getEnvProfile(input.id, { ownerUserId: input.ownerUserId })!;
  }

  getEnvProfile(id: string, access: RuntimeProfileAccessInput = {}): RuntimeEnvProfileRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM env_profiles
      WHERE id = ?
        AND (
          (? = 1 AND visibility = 'workspace')
          OR owner_user_id = ?
        )
    `).get(id, access.includeWorkspace === false ? 0 : 1, access.ownerUserId ?? null);
    return row ? rowToEnvProfile(row) : null;
  }

  listEnvProfiles(access: RuntimeProfileAccessInput = {}): RuntimeEnvProfileRecord[] {
    return this.db.prepare(`
      SELECT *
      FROM env_profiles
      WHERE owner_user_id = ?
        OR (? = 1 AND visibility = 'workspace')
      ORDER BY display_name ASC, id ASC
    `).all(access.ownerUserId ?? null, access.includeWorkspace === false ? 0 : 1).map(rowToEnvProfile);
  }

  upsertSecretProfile(input: UpsertSecretProfileInput): RuntimeSecretProfileRecord {
    const now = input.updatedAt ?? input.createdAt ?? nowIso();
    this.db.prepare(`
      INSERT INTO secret_profiles (
        id, owner_user_id, visibility, display_name, agent_id, encrypted,
        encryption_key_ready, secrets_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        owner_user_id = excluded.owner_user_id,
        visibility = excluded.visibility,
        display_name = excluded.display_name,
        agent_id = excluded.agent_id,
        encrypted = excluded.encrypted,
        encryption_key_ready = excluded.encryption_key_ready,
        secrets_json = excluded.secrets_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.ownerUserId ?? null,
      input.visibility ?? 'private',
      input.displayName,
      input.agentId ?? null,
      input.encrypted ? 1 : 0,
      input.encryptionKeyReady ? 1 : 0,
      toJson(input.secrets),
      input.createdAt ?? now,
      now,
    );
    return this.getSecretProfile(input.id, { ownerUserId: input.ownerUserId })!;
  }

  getSecretProfile(id: string, access: RuntimeProfileAccessInput = {}): RuntimeSecretProfileRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM secret_profiles
      WHERE id = ?
        AND (
          (? = 1 AND visibility = 'workspace')
          OR owner_user_id = ?
        )
    `).get(id, access.includeWorkspace === false ? 0 : 1, access.ownerUserId ?? null);
    return row ? rowToSecretProfile(row) : null;
  }

  listSecretProfiles(access: RuntimeProfileAccessInput = {}): RuntimeSecretProfileRecord[] {
    return this.db.prepare(`
      SELECT *
      FROM secret_profiles
      WHERE owner_user_id = ?
        OR (? = 1 AND visibility = 'workspace')
      ORDER BY display_name ASC, id ASC
    `).all(access.ownerUserId ?? null, access.includeWorkspace === false ? 0 : 1).map(rowToSecretProfile);
  }

  createSession(input: CreateSessionInput): RuntimeSessionRecord {
    return withImmediateTransaction(this.db, () => {
      const id = input.id ?? randomUUID();
      const now = input.now ?? nowIso();
      this.db.prepare(`
        INSERT INTO runtime_sessions (
          id, kind, agent_id, model_route_id, owner_user_id, title, status,
          working_directory, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.kind,
        input.agentId,
        input.modelRouteId ?? null,
        input.ownerUserId ?? null,
        input.title ?? null,
        input.status ?? 'active',
        input.workingDirectory,
        now,
        now,
      );

      return rowToSession(this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(id));
    });
  }

  getSession(sessionId: string): RuntimeSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(sessionId);
    return row ? rowToSession(row) : null;
  }

  updateSessionStatus(input: UpdateSessionStatusInput): RuntimeSessionRecord {
    return withImmediateTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE runtime_sessions
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(input.status, input.now ?? nowIso(), input.sessionId);
      if (result.changes !== 1) throw new Error(`Runtime session not found: ${input.sessionId}`);
      return rowToSession(this.db.prepare('SELECT * FROM runtime_sessions WHERE id = ?').get(input.sessionId));
    });
  }

  saveSessionSnapshot(input: SaveSessionSnapshotInput): string {
    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO runtime_session_snapshots (
        id, session_id, turn_id, agent_id, model_route_id, system_prompt_hash,
        skills_revision, mcp_revision, interrupt_policy, skills_json, mcp_servers_json,
        env_profile_id, secret_profile_id, permission_policy_id, cwd, snapshot_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sessionId,
      input.turnId ?? null,
      input.agentId,
      input.modelRouteId ?? null,
      input.systemPromptHash ?? null,
      input.skillsRevision ?? null,
      input.mcpRevision ?? null,
      input.interruptPolicy,
      toJson(input.skills ?? []),
      toJson(input.mcpServers ?? []),
      input.envProfileId ?? null,
      input.secretProfileId ?? null,
      input.permissionPolicyId ?? null,
      input.cwd,
      toJson(input.snapshot),
      input.createdAt ?? nowIso(),
    );
    return id;
  }

  upsertBinding(input: UpsertBindingInput): RuntimeBindingRecord {
    const now = input.now ?? nowIso();
    this.db.prepare(`
      INSERT INTO runtime_bindings (
        id, session_id, runtime, role, generation, external_record_id, external_session_id,
        provider_session_id, raw_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id, runtime, role, generation) DO UPDATE SET
        external_record_id = excluded.external_record_id,
        external_session_id = excluded.external_session_id,
        provider_session_id = excluded.provider_session_id,
        raw_json = excluded.raw_json,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.sessionId,
      input.runtime,
      input.role ?? 'primary',
      input.generation ?? 1,
      input.externalRecordId ?? null,
      input.externalSessionId ?? null,
      input.providerSessionId ?? null,
      toJson(input.raw ?? null),
      now,
      now,
    );

    return rowToBinding(this.db.prepare(`
      SELECT * FROM runtime_bindings
      WHERE session_id = ? AND runtime = ? AND role = ? AND generation = ?
    `).get(input.sessionId, input.runtime, input.role ?? 'primary', input.generation ?? 1));
  }

  getPrimaryBinding(sessionId: string): RuntimeBindingRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM runtime_bindings
      WHERE session_id = ? AND role = 'primary'
      ORDER BY generation DESC
      LIMIT 1
    `).get(sessionId);
    return row ? rowToBinding(row) : null;
  }

  listBindings(sessionId: string): RuntimeBindingRecord[] {
    return this.db.prepare(`
      SELECT * FROM runtime_bindings
      WHERE session_id = ?
      ORDER BY runtime ASC, role ASC, generation DESC
    `).all(sessionId).map(rowToBinding);
  }

  getTurn(turnId: string): RuntimeTurnRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(turnId);
    return row ? rowToTurn(row) : null;
  }

  getTurnByRequestId(sessionId: string, requestId: string): RuntimeTurnRecord | null {
    const row = this.db
      .prepare('SELECT * FROM runtime_turns WHERE session_id = ? AND request_id = ?')
      .get(sessionId, requestId);
    return row ? rowToTurn(row) : null;
  }

  hasOtherTurns(sessionId: string, excludedTurnId: string): boolean {
    return Boolean(this.db.prepare(`
      SELECT 1
      FROM runtime_turns
      WHERE session_id = ? AND id <> ?
      LIMIT 1
    `).get(sessionId, excludedTurnId));
  }

  getActiveTurn(sessionId: string): RuntimeTurnRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM runtime_turns
      WHERE session_id = ? AND status IN ('queued','running','canceling')
      ORDER BY
        CASE status
          WHEN 'running' THEN 0
          WHEN 'canceling' THEN 1
          ELSE 2
        END,
        queued_at ASC,
        id ASC
      LIMIT 1
    `).get(sessionId);
    return row ? rowToTurn(row) : null;
  }

  listEventsAfter(sessionId: string, afterSeq = 0, limit = 100): RuntimeEventRecord[] {
    return this.db.prepare(`
      SELECT * FROM runtime_events
      WHERE session_id = ? AND seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(sessionId, afterSeq, Math.max(1, Math.min(limit, 1000))).map(rowToEvent);
  }

  getEvent(eventId: string): RuntimeEventRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_events WHERE id = ?').get(eventId);
    return row ? rowToEvent(row) : null;
  }

  appendTrace(input: AppendTraceInput): string {
    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO runtime_traces (
        id, trace_id, session_id, turn_id, level, source, payload_json, redacted, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.traceId,
      input.sessionId ?? null,
      input.turnId ?? null,
      input.level,
      input.source,
      toJson(input.payload ?? null),
      input.redacted ? 1 : 0,
      input.createdAt ?? nowIso(),
    );
    return id;
  }

  getTrace(id: string): RuntimeTraceRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_traces WHERE id = ?').get(id);
    return row ? rowToTrace(row) : null;
  }

  listTraces(traceId: string, limit = 100): RuntimeTraceRecord[] {
    return this.db.prepare(`
      SELECT * FROM runtime_traces
      WHERE trace_id = ?
      ORDER BY created_at ASC, id ASC
      LIMIT ?
    `).all(traceId, Math.max(1, Math.min(limit, 1000))).map(rowToTrace);
  }

  createOperation(input: CreateOperationInput): RuntimeOperationRecord {
    const id = input.id ?? randomUUID();
    const now = input.now ?? nowIso();
    this.db.prepare(`
      INSERT INTO runtime_session_operations (
        id, session_id, target_session_id, kind, status, trace_id, request_json,
        result_json, error_json, compensation_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      input.sessionId,
      input.targetSessionId ?? null,
      input.kind,
      input.status ?? 'pending',
      input.traceId,
      toJson(input.request ?? null),
      now,
      now,
    );
    return rowToOperation(this.db.prepare('SELECT * FROM runtime_session_operations WHERE id = ?').get(id));
  }

  completeOperation(input: CompleteOperationInput): RuntimeOperationRecord {
    const result = this.db.prepare(`
      UPDATE runtime_session_operations
      SET status = ?, target_session_id = COALESCE(?, target_session_id), result_json = ?,
        error_json = ?, compensation_json = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.targetSessionId ?? null,
      toJson(input.result ?? null),
      toJson(input.error ?? null),
      toJson(input.compensation ?? null),
      input.now ?? nowIso(),
      input.operationId,
    );
    if (result.changes !== 1) throw new Error(`Runtime session operation not found: ${input.operationId}`);
    return rowToOperation(this.db.prepare('SELECT * FROM runtime_session_operations WHERE id = ?').get(input.operationId));
  }

  updateOperationStatus(input: UpdateOperationStatusInput): RuntimeOperationRecord {
    const result = this.db.prepare(`
      UPDATE runtime_session_operations
      SET status = ?,
        target_session_id = COALESCE(?, target_session_id),
        result_json = COALESCE(?, result_json),
        error_json = COALESCE(?, error_json),
        compensation_json = COALESCE(?, compensation_json),
        updated_at = ?
      WHERE id = ?
    `).run(
      input.status,
      input.targetSessionId ?? null,
      input.result === undefined ? null : toJson(input.result),
      input.error === undefined ? null : toJson(input.error),
      input.compensation === undefined ? null : toJson(input.compensation),
      input.now ?? nowIso(),
      input.operationId,
    );
    if (result.changes !== 1) throw new Error(`Runtime session operation not found: ${input.operationId}`);
    return rowToOperation(this.db.prepare('SELECT * FROM runtime_session_operations WHERE id = ?').get(input.operationId));
  }

  getOperation(operationId: string): RuntimeOperationRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_session_operations WHERE id = ?').get(operationId);
    return row ? rowToOperation(row) : null;
  }

  listOperations(sessionId: string): RuntimeOperationRecord[] {
    return this.db.prepare(`
      SELECT * FROM runtime_session_operations
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(sessionId).map(rowToOperation);
  }

  createSessionEdge(input: CreateSessionEdgeInput): string {
    const id = input.id ?? randomUUID();
    this.db.prepare(`
      INSERT INTO runtime_session_edges (
        id, operation_id, from_session_id, to_session_id, kind, status, at_turn_id,
        at_message_id, summary, error_json, metadata_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(from_session_id, to_session_id, kind) DO UPDATE SET
        status = excluded.status,
        summary = excluded.summary,
        error_json = excluded.error_json,
        metadata_json = excluded.metadata_json
    `).run(
      id,
      input.operationId ?? null,
      input.fromSessionId,
      input.toSessionId,
      input.kind,
      input.status ?? 'active',
      input.atTurnId ?? null,
      input.atMessageId ?? null,
      input.summary ?? null,
      toJson(input.error ?? null),
      toJson(input.metadata ?? {}),
      input.createdAt ?? nowIso(),
    );
    return id;
  }

  getSessionEdge(edgeId: string): RuntimeSessionEdgeRecord | null {
    const row = this.db.prepare('SELECT * FROM runtime_session_edges WHERE id = ?').get(edgeId);
    return row ? rowToSessionEdge(row) : null;
  }

  listSessionEdges(sessionId: string): RuntimeSessionEdgeRecord[] {
    return this.db.prepare(`
      SELECT * FROM runtime_session_edges
      WHERE from_session_id = ? OR to_session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(sessionId, sessionId).map(rowToSessionEdge);
  }

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
        -- queued_at is only millisecond precision; rowid preserves insertion order
        -- when multiple turns are enqueued in the same tick.
        ORDER BY candidate.queued_at ASC, candidate.rowid ASC
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

  claimTurn(input: ClaimTurnInput): RuntimeTurnRecord | null {
    const now = input.now ?? new Date();
    const nowText = nowIso(now);
    const leaseToken = input.leaseToken ?? randomUUID();
    const leaseExpiresAt = nowIso(new Date(now.getTime() + (input.leaseDurationMs ?? 30_000)));

    return withImmediateTransaction(this.db, () => {
      const row = this.db.prepare(`
        SELECT *
        FROM runtime_turns
        WHERE id = ?
          AND (
            status = 'queued'
            OR (status IN ('running','canceling') AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
          )
      `).get(input.turnId, nowText) as RuntimeTurnRow | undefined;
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
      `).run(nowText, input.leaseOwner, leaseToken, leaseExpiresAt, input.turnId, nowText);

      if (result.changes !== 1) return null;
      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId));
    });
  }

  reclaimExpiredLeases(input: ReclaimExpiredLeasesInput): RuntimeTurnRecord[] {
    const now = input.now ?? new Date();
    const nowText = nowIso(now);
    const leaseDurationMs = input.leaseDurationMs ?? 30_000;
    const limit = Math.max(1, Math.min(input.limit ?? 100, 1000));

    return withImmediateTransaction(this.db, () => {
      const rows = this.db.prepare(`
        SELECT *
        FROM runtime_turns
        WHERE status IN ('running','canceling')
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < ?
        ORDER BY lease_expires_at ASC, id ASC
        LIMIT ?
      `).all(nowText, limit) as RuntimeTurnRow[];

      const reclaimed: RuntimeTurnRecord[] = [];
      for (const row of rows) {
        const leaseToken = rows.length === 1 && input.leaseToken ? input.leaseToken : randomUUID();
        const leaseExpiresAt = nowIso(new Date(now.getTime() + leaseDurationMs));
        const result = this.db.prepare(`
          UPDATE runtime_turns
          SET status = 'running',
            started_at = COALESCE(started_at, ?),
            lease_owner = ?,
            lease_token = ?,
            lease_expires_at = ?
          WHERE id = ?
            AND status IN ('running','canceling')
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < ?
        `).run(nowText, input.leaseOwner, leaseToken, leaseExpiresAt, row.id, nowText);

        if (result.changes === 1) {
          reclaimed.push(rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(row.id)));
        }
      }
      return reclaimed;
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

  getProjectionCache(
    sessionId: string,
    projection: RuntimeProjection,
    version: number,
  ): RuntimeProjectionCacheRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM runtime_projection_cache
      WHERE session_id = ? AND projection = ? AND version = ?
    `).get(sessionId, projection, version);
    return row ? rowToProjectionCache(row) : null;
  }

  rebuildProjectionCache(input: RebuildProjectionCacheInput): RuntimeProjectionCacheRecord {
    const events = this.listEventsAfter(input.sessionId, 0, 1000);
    const version = input.version ?? 1;
    const lastSeq = events.at(-1)?.seq ?? 0;
    const payload = buildProjectionPayload(input.projection, events);
    const now = nowIso();
    this.upsertProjectionCache(input.sessionId, lastSeq, {
      projection: input.projection,
      version,
      payload,
    }, now);
    return this.getProjectionCache(input.sessionId, input.projection, version)!;
  }

  upsertAgentRuntimeState(input: UpsertAgentRuntimeStateInput): AgentRuntimeStateRecord {
    const existing = this.getAgentRuntimeState(input.agentId);
    const now = input.now ?? nowIso();
    this.db.prepare(`
      INSERT INTO agent_runtime_state (
        agent_id, enabled, hidden, override_json, availability_status,
        availability_checked_at, env_readiness_json, capability_probe_json,
        discovery_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        enabled = excluded.enabled,
        hidden = excluded.hidden,
        override_json = excluded.override_json,
        availability_status = excluded.availability_status,
        availability_checked_at = excluded.availability_checked_at,
        env_readiness_json = excluded.env_readiness_json,
        capability_probe_json = excluded.capability_probe_json,
        discovery_json = excluded.discovery_json,
        updated_at = excluded.updated_at
    `).run(
      input.agentId,
      input.enabled ?? existing?.enabled ?? true ? 1 : 0,
      input.hidden ?? existing?.hidden ?? (input.discovery !== undefined && input.discovery !== null) ? 1 : 0,
      toJson(input.override ?? existing?.override ?? null),
      toStoredAvailabilityStatus(input.availabilityStatus) ?? existing?.availabilityStatus ?? 'unknown',
      input.availabilityCheckedAt ?? existing?.availabilityCheckedAt ?? null,
      toJson(input.envReadiness ?? existing?.envReadiness ?? null),
      toJson(input.capabilityProbe ?? existing?.capabilityProbe ?? null),
      toJson(input.discovery ?? existing?.discovery ?? null),
      existing?.createdAt ?? now,
      now,
    );
    return this.getAgentRuntimeState(input.agentId)!;
  }

  getAgentRuntimeState(agentId: string): AgentRuntimeStateRecord | null {
    const row = this.db.prepare('SELECT * FROM agent_runtime_state WHERE agent_id = ?').get(agentId);
    return row ? rowToAgentRuntimeState(row) : null;
  }

  listAgentRuntimeStates(): AgentRuntimeStateRecord[] {
    return this.db.prepare(`
      SELECT *
      FROM agent_runtime_state
      ORDER BY agent_id ASC
    `).all().map(rowToAgentRuntimeState);
  }

  rejectQueuedTurn(input: RejectQueuedTurnInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const row = this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId) as RuntimeTurnRow | undefined;
      if (!row) throw new Error(`Runtime turn not found: ${input.turnId}`);
      if (row.status !== 'queued') {
        throw new Error(`Runtime turn is not queued: ${input.turnId}`);
      }

      this.db.prepare(`
        UPDATE runtime_turns
        SET status = 'invalid',
          finished_at = ?,
          error_json = ?
        WHERE id = ? AND status = 'queued'
      `).run(
        input.now ?? nowIso(),
        toJson(input.error ?? null),
        input.turnId,
      );

      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId));
    });
  }

  markTurnCanceling(input: MarkTurnCancelingInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE runtime_turns
        SET status = 'canceling',
          cancel_reason = ?,
          cancel_request_id = ?
        WHERE id = ? AND status = 'running'
      `).run(
        input.reason ?? null,
        input.cancelRequestId ?? null,
        input.turnId,
      );
      if (result.changes !== 1) throw new Error(`Runtime turn is not running: ${input.turnId}`);
      return rowToTurn(this.db.prepare('SELECT * FROM runtime_turns WHERE id = ?').get(input.turnId));
    });
  }

  restoreTurnRunning(input: RestoreTurnRunningInput): RuntimeTurnRecord {
    return withImmediateTransaction(this.db, () => {
      const result = this.db.prepare(`
        UPDATE runtime_turns
        SET status = 'running',
          error_json = ?,
          lease_expires_at = COALESCE(lease_expires_at, ?)
        WHERE id = ? AND status = 'canceling'
      `).run(
        toJson(input.error ?? null),
        input.now ?? nowIso(),
        input.turnId,
      );
      if (result.changes !== 1) throw new Error(`Runtime turn is not canceling: ${input.turnId}`);
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
