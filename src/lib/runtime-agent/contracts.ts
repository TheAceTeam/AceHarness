export type RuntimeAdapterKind = 'acpx' | 'magic';

export type RuntimeSessionKind =
  | 'chat'
  | 'agent'
  | 'workflow-agent'
  | 'workflow-supervisor'
  | 'agora'
  | 'probe'
  | 'diagnostic';

export type RuntimeSessionStatus =
  | 'creating'
  | 'active'
  | 'archived'
  | 'compacted'
  | 'forking'
  | 'compacting'
  | 'invalid'
  | 'deleted';

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

export type RuntimeEventType =
  | 'turn.started'
  | 'turn.queued'
  | 'turn.canceling'
  | 'turn.cancelled'
  | 'turn.completed'
  | 'turn.failed'
  | 'message.delta'
  | 'message.completed'
  | 'thought.delta'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.output'
  | 'tool.completed'
  | 'tool.failed'
  | 'usage.updated'
  | 'permission.requested'
  | 'permission.resolved'
  | 'command.available'
  | 'command.invoked'
  | 'status.changed'
  | 'diagnostic';

export type RuntimePermissionPolicyId =
  | 'unrestricted'
  | 'approve-reads'
  | 'ask'
  | 'deny-destructive'
  | 'deny-all';

export const defaultPermissionPolicy = 'unrestricted' satisfies RuntimePermissionPolicyId;

export type RuntimePermissionOperation = 'read' | 'write' | 'execute' | 'network' | 'mcp' | 'unknown';

export type RuntimePermissionRisk = 'low' | 'medium' | 'high';

export type RuntimePermissionDecision = 'approved' | 'denied' | 'auto-approved' | 'auto-denied';

export type RuntimeTraceLevel = 'debug' | 'info' | 'warning' | 'error';

export type RuntimeTraceSource =
  | 'orchestrator'
  | 'adapter'
  | 'permission'
  | 'profile'
  | 'queue'
  | 'projection'
  | 'diagnostic';

export type RuntimeReadiness = 'ready' | 'missing' | 'misconfigured' | 'unknown';

export type RuntimeErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'LIMIT_EXCEEDED'
  | 'ADAPTER_UNAVAILABLE'
  | 'ADAPTER_FAILED'
  | 'PERMISSION_DENIED'
  | 'CANCEL_FAILED'
  | 'PROFILE_MISCONFIGURED'
  | 'PROJECTION_FAILED'
  | 'UNKNOWN';

export interface RuntimeErrorDto {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
  cause?: {
    code?: string;
    message: string;
  };
  redacted: boolean;
}

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
  missing?: boolean;
  sourceStatus?: 'reported' | 'estimated' | 'missing' | 'partial';
}

export interface CostUsage {
  amount?: number;
  currency?: string;
  costUsd?: number;
  estimated: boolean;
  missing?: boolean;
  sourceStatus?: 'reported' | 'estimated' | 'missing' | 'partial';
}

export interface RuntimeCapabilities {
  streaming: boolean;
  cancel: boolean;
  commands: boolean;
  compact: boolean;
  fork: boolean;
  handoff: boolean;
  permissions: boolean;
  toolCalls: boolean;
  usage: 'reported' | 'estimated' | 'missing' | 'partial';
  models?: string[];
  metadata?: Record<string, unknown>;
}

export interface EnvRequirement {
  key: string;
  required: boolean;
  secret: boolean;
  allowedValues?: readonly string[];
  description?: string;
}

export interface ResolvedModelRoute {
  modelRouteId: string;
  agentId: string;
  runtime: RuntimeAdapterKind;
  /** Configured provider route, used internally by provider-aware runtimes. */
  providerId?: string;
  providerModel: string;
  configOptions: Record<string, unknown>;
  envRequirements: EnvRequirement[];
  capabilities: RuntimeCapabilities;
}

export interface RuntimeEnvVarSnapshot {
  key: string;
  value?: string;
  source: 'turn-override' | 'env-profile' | 'secret-profile' | 'agent-default' | 'process-env';
  secret: boolean;
  readiness: RuntimeReadiness;
}

export interface RuntimeProfileSnapshot {
  agentId: string;
  ownerUserId?: string;
  modelRouteId: string;
  cwd: string;
  systemPromptHash: string;
  skillsRevision: string;
  mcpRevision: string;
  envProfileId?: string;
  secretProfileId?: string;
  permissionPolicyId: RuntimePermissionPolicyId;
  interruptPolicy: RuntimeInterruptPolicy;
  env?: RuntimeEnvVarSnapshot[];
  skills?: unknown[];
  mcpServers?: unknown[];
}

export interface RuntimeSessionRef {
  runtimeSessionId: string;
  agentId: string;
  kind: RuntimeSessionKind;
  status: RuntimeSessionStatus;
  modelRouteId?: string;
  runtimeProfileId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeTurnRef {
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
}

export interface RuntimeEvent<TPayload = unknown> {
  id: string;
  sessionId: string;
  turnId?: string;
  traceId: string;
  seq: number;
  type: RuntimeEventType;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  payload: TPayload;
  usage?: TokenUsage;
  cost?: CostUsage;
  redacted: boolean;
  createdAt: string;
}

export interface AdapterRuntimeEvent<TPayload = unknown> {
  type: RuntimeEventType;
  payload: TPayload;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  usage?: TokenUsage;
  cost?: CostUsage;
  error?: RuntimeErrorDto;
  redacted: boolean;
  raw?: unknown;
  createdAt?: string;
}

export interface RuntimeTraceEvent<TPayload = unknown> {
  id: string;
  traceId: string;
  sessionId?: string;
  turnId?: string;
  level: RuntimeTraceLevel;
  source: RuntimeTraceSource;
  payload: TPayload;
  redacted: boolean;
  createdAt: string;
}

export interface RuntimePermissionRequest {
  id: string;
  sessionId: string;
  turnId: string;
  agentId: string;
  operation: RuntimePermissionOperation;
  resource?: string;
  cwd?: string;
  proposedCommand?: string;
  proposedDiff?: string;
  risk: RuntimePermissionRisk;
  raw: unknown;
}

export interface RuntimePermissionResolution {
  requestId: string;
  decision: RuntimePermissionDecision;
  policyId: RuntimePermissionPolicyId;
  reason?: string;
  resolvedBy: 'policy' | 'user' | 'system';
  resolvedAt: string;
}

export interface OpenRuntimeSessionInput {
  agentId: string;
  modelRouteId?: string;
  cwd: string;
  kind: RuntimeSessionKind;
  /**
   * Persist the logical session now and create its native adapter binding when
   * the first turn is claimed. This avoids starting then immediately
   * reconnecting a backend session that has not produced a turn yet.
   */
  deferAdapterSessionInitialization?: boolean;
  runtimeProfileId?: string;
  mcpServers?: unknown[];
  ownerUserId?: string;
  title?: string;
}

export interface RunRuntimeTurnInput {
  runtimeSessionId: string;
  requestId: string;
  input: string;
  interruptPolicy?: RuntimeInterruptPolicy;
  profileSnapshot?: RuntimeProfileSnapshot;
  metadata?: Record<string, unknown>;
}

export interface CancelTurnInput {
  runtimeSessionId: string;
  turnId: string;
  requestId: string;
  reason?: string;
}

export interface CancelSessionInput {
  runtimeSessionId: string;
  requestId: string;
  reason?: string;
}

export interface SessionStatusInput {
  runtimeSessionId: string;
}

export interface CompactSessionInput {
  runtimeSessionId: string;
  requestId: string;
  atTurnId?: string;
  strategy?: 'summary' | 'adapter-native';
}

export interface ForkSessionInput {
  runtimeSessionId: string;
  requestId: string;
  atTurnId?: string;
  atMessageId?: string;
  title?: string;
}

export interface CompactResult {
  runtimeSessionId: string;
  compactedSessionId?: string;
  status: 'completed' | 'failed';
  summary?: string;
  error?: RuntimeErrorDto;
}

export interface ForkResult {
  runtimeSessionId: string;
  forkedSessionId?: string;
  status: 'completed' | 'failed';
  error?: RuntimeErrorDto;
}

export interface RuntimeOrchestrator {
  openSession(input: OpenRuntimeSessionInput): Promise<RuntimeSessionRef>;
  runTurn(input: RunRuntimeTurnInput): AsyncIterable<RuntimeEvent>;
  cancelTurn(input: CancelTurnInput): Promise<void>;
  cancelSession(input: CancelSessionInput): Promise<void>;
  getSessionStatus(input: SessionStatusInput): Promise<RuntimeSessionStatus>;
  compactSession(input: CompactSessionInput): Promise<CompactResult>;
  forkSession(input: ForkSessionInput): Promise<ForkResult>;
}

export interface RuntimeBindingExternalIds {
  externalRecordId?: string;
  externalSessionId?: string;
  providerSessionId?: string;
}

export interface RuntimeBinding {
  id: string;
  runtimeSessionId: string;
  runtime: RuntimeAdapterKind;
  role: 'primary' | 'handoff-source' | 'handoff-target' | 'migration' | 'diagnostic';
  generation: number;
  externalIds: RuntimeBindingExternalIds;
  raw: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface RedactedRuntimeBindingDto {
  id: string;
  runtimeSessionId: string;
  runtime: RuntimeAdapterKind;
  role: RuntimeBinding['role'];
  generation: number;
  externalIdsRedacted: true;
  rawRedacted: true;
  createdAt: string;
  updatedAt: string;
}

export interface AdapterSessionInput {
  runtimeSessionId: string;
  agentId: string;
  modelRoute: ResolvedModelRoute;
  profileSnapshot: RuntimeProfileSnapshot;
  existingBinding?: RuntimeBinding;
}

export interface AdapterTurnInput {
  turnId: string;
  requestId: string;
  traceId: string;
  input: string;
  interruptPolicy: RuntimeInterruptPolicy;
  profileSnapshot: RuntimeProfileSnapshot;
  metadata?: Record<string, unknown>;
}

export interface AdapterCancelInput {
  turnId: string;
  requestId: string;
  reason?: string;
}

export interface AdapterCommandInput {
  turnId: string;
  traceId: string;
  command: string;
  args?: Record<string, unknown>;
}

export interface AdapterCompactInput {
  traceId: string;
  atTurnId?: string;
  strategy?: 'summary' | 'adapter-native';
}

export interface AdapterForkInput {
  traceId: string;
  targetRuntimeSessionId: string;
  atTurnId?: string;
  atMessageId?: string;
}

export interface AdapterHandoffInput {
  sourceBinding: RuntimeBinding;
  targetRuntimeSessionId: string;
  targetProfileSnapshot: RuntimeProfileSnapshot;
}

export interface AdapterCapabilitiesInput {
  agentId: string;
  modelRoute?: ResolvedModelRoute;
  profileSnapshot?: RuntimeProfileSnapshot;
}

export interface AdapterSessionHandoff {
  binding: RuntimeBinding;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface AdapterRuntimeStatus {
  runtime: RuntimeAdapterKind;
  status: 'idle' | 'running' | 'canceling' | 'closed' | 'failed' | 'unknown';
  activeTurnId?: string;
  lastEventAt?: string;
  error?: RuntimeErrorDto;
  metadata?: Record<string, unknown>;
}

export interface RuntimeAdapter {
  createOrLoadSession(input: AdapterSessionInput): Promise<RuntimeBinding>;
  reconnectSession?(input: AdapterSessionInput): Promise<RuntimeBinding>;
  runTurn(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent>;
  cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void>;
  invokeCommand?(binding: RuntimeBinding, input: AdapterCommandInput): AsyncIterable<AdapterRuntimeEvent>;
  compact?(binding: RuntimeBinding, input: AdapterCompactInput): Promise<AdapterSessionHandoff>;
  fork?(binding: RuntimeBinding, input: AdapterForkInput): Promise<AdapterSessionHandoff>;
  handoff?(input: AdapterHandoffInput): Promise<RuntimeBinding>;
  close(binding: RuntimeBinding): Promise<void>;
  getCapabilities(input: AdapterCapabilitiesInput): Promise<RuntimeCapabilities>;
  getStatus(binding: RuntimeBinding): Promise<AdapterRuntimeStatus>;
}
