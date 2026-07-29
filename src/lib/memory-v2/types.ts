export const MEMORY_RETENTIONS = ['none', 'short', 'long'] as const;
export type MemoryRetention = (typeof MEMORY_RETENTIONS)[number];
export type PersistedMemoryRetention = Exclude<MemoryRetention, 'none'>;

export const MEMORY_SCOPE_TYPES = ['agent', 'workflow', 'project', 'session', 'run', 'channel'] as const;
export type MemoryScopeType = (typeof MEMORY_SCOPE_TYPES)[number];

export const MEMORY_SCOPE_BINDING_ROLES = ['lifecycle-anchor', 'relevance'] as const;
export type MemoryScopeBindingRole = (typeof MEMORY_SCOPE_BINDING_ROLES)[number];

export const MEMORY_VISIBILITIES = ['private', 'workspace', 'workflow-participant', 'channel-member'] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITIES)[number];

export const MEMORY_HANDOFF_MODES = ['none', 'manifest', 'on-demand', 'required-read'] as const;
export type MemoryHandoffMode = (typeof MEMORY_HANDOFF_MODES)[number];

export const MEMORY_HANDOFF_TARGETS = ['none', 'next-step', 'matching-steps', 'named-agents'] as const;
export type MemoryHandoffTargetKind = (typeof MEMORY_HANDOFF_TARGETS)[number];

export const MEMORY_READ_TRIGGERS = [
  'conversation-turn',
  'task-start',
  'step-start',
  'workflow-resume',
  'explicit-search',
] as const;
export type MemoryReadTrigger = (typeof MEMORY_READ_TRIGGERS)[number];

export const MEMORY_ITEM_STATUSES = [
  'pending-review',
  'active',
  'resolved',
  'superseded',
  'expired',
  'rejected',
] as const;
export type MemoryItemStatus = (typeof MEMORY_ITEM_STATUSES)[number];

export const MEMORY_GOVERNANCE_MODES = ['manual', 'review', 'auto'] as const;
export type MemoryGovernanceMode = (typeof MEMORY_GOVERNANCE_MODES)[number];

export const MEMORY_GOVERNANCE_ACTIONS = ['approve', 'reject', 'expire', 'supersede', 'reclassify'] as const;
export type MemoryGovernanceAction = (typeof MEMORY_GOVERNANCE_ACTIONS)[number];

export const MEMORY_AUDIT_ACTIONS = [
  'discard',
  'create',
  'upsert',
  'resolve',
  'expire',
  'read',
  'handoff',
  'receipt',
  'archive',
  'approve',
  'reject',
  'supersede',
  'reclassify',
] as const;
export type MemoryAuditAction = (typeof MEMORY_AUDIT_ACTIONS)[number];

export const MEMORY_HANDOFF_BATCH_STATUSES = ['no-op', 'emitted', 'failed', 'cancelled', 'retrying', 'superseded'] as const;
export type MemoryHandoffBatchStatus = (typeof MEMORY_HANDOFF_BATCH_STATUSES)[number];

export const MEMORY_HANDOFF_STATUSES = ['pending', 'resolved', 'cancelled', 'failed'] as const;
export type MemoryHandoffStatus = (typeof MEMORY_HANDOFF_STATUSES)[number];

export const MEMORY_HANDOFF_RECEIPT_STATUSES = [
  'pending',
  'read',
  'acknowledged',
  'failed',
  'cancelled',
  'retrying',
] as const;
export type MemoryHandoffReceiptStatus = (typeof MEMORY_HANDOFF_RECEIPT_STATUSES)[number];

export const MEMORY_ARTIFACT_KINDS = ['run-output', 'log', 'diff', 'generated-file'] as const;
export type MemoryArtifactKind = (typeof MEMORY_ARTIFACT_KINDS)[number];

export type MemoryLifecycleAnchor =
  | { scopeType: 'session'; sessionId: string }
  | { scopeType: 'run'; runId: string; workflowId: string };

export interface MemoryScopeBindingProposal {
  scopeType: MemoryScopeType;
  scopeKey: string;
}

export interface MemoryScopeBinding extends MemoryScopeBindingProposal {
  role: MemoryScopeBindingRole;
  ownerUserId: string;
  workspaceId: string;
  visibility: MemoryVisibility;
}

export interface MemoryReadWhen {
  text: string;
  triggers: MemoryReadTrigger[];
  workflowStates?: string[];
  stepIds?: string[];
  stepTags?: string[];
  agentIds?: string[];
  keywords?: string[];
}

export interface MemoryHandoff {
  mode: MemoryHandoffMode;
  target: MemoryHandoffTargetKind;
  stepIds?: string[];
  stepTags?: string[];
  workflowStates?: string[];
  agentIds?: string[];
}

/**
 * This is the untrusted shape an AI may propose. Owner, workspace, visibility,
 * participants, and channel membership are intentionally absent.
 */
export interface MemoryDecisionProposal {
  action: 'discard' | 'create' | 'upsert' | 'resolve';
  retention: MemoryRetention;
  lifecycleAnchor?: MemoryLifecycleAnchor;
  scopeBindings?: MemoryScopeBindingProposal[];
  summary?: string;
  readWhen?: MemoryReadWhen;
  handoff?: MemoryHandoff;
  details?: string;
  kind?: string;
  confidence?: number;
  sourceEventId: string;
  idempotencyKey: string;
  targetMemoryId?: string;
  expectedDetailVersion?: number;
  expectedFingerprint?: string;
  expiresAt?: string;
  replacesMemoryId?: string;
}

/**
 * The server creates this context from authenticated request/run state. Never
 * accept it from an AI tool payload.
 */
export interface MemoryRequestContext {
  ownerUserId: string;
  workspaceId: string;
  actor: 'ai' | 'system' | 'reviewer';
  actorId?: string;
  agentId?: string;
  sessionId?: string;
  runId?: string;
  workflowId?: string;
  channelId?: string;
  stepAttemptId?: string;
  workflowState?: string;
  stepId?: string;
  stepTags?: string[];
  projectIds?: string[];
  authorizedAgentIds?: string[];
  authorizedWorkflowIds?: string[];
  authorizedProjectIds?: string[];
  authorizedSessionIds?: string[];
  authorizedRunIds?: string[];
  authorizedChannelIds?: string[];
  /** Server-resolved capture policy. AI input must never provide this field. */
  captureEnabled?: boolean;
  governanceMode?: MemoryGovernanceMode;
  allowLongAutoApproval?: boolean;
  /** Server-derived administrator capability; never accepted from model or client input. */
  reviewAllWorkspaces?: boolean;
  longMemoryVisibility?: Extract<MemoryVisibility, 'private' | 'workspace'>;
}

export interface MemorySourceProvenance {
  sourceAgentId?: string;
  sourceSessionId?: string;
  sourceRunId?: string;
  sourceWorkflowId?: string;
  sourceStepAttemptId?: string;
}

export interface MemoryIndexRecord {
  memoryId: string;
  retention: PersistedMemoryRetention;
  kind: string;
  lifecycleAnchor?: MemoryLifecycleAnchor;
  summary: string;
  readWhen: MemoryReadWhen;
  handoff: MemoryHandoff;
  detailVersion: number;
  status: MemoryItemStatus;
  confidence: number;
  fingerprint: string;
  indexChars: number;
  source: MemorySourceProvenance;
  ownerUserId: string;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface MemoryManifestItem extends MemoryIndexRecord {
  delivery?: {
    handoffId: string;
    targetStepAttemptId: string;
    targetAgentId: string;
    requiredRead: boolean;
    receiptStatus?: MemoryHandoffReceiptStatus;
  };
}

export interface MemoryManifest {
  items: MemoryManifestItem[];
  requiredReadItems: MemoryManifestItem[];
  serializedChars: number;
  omittedCount: number;
  requiredReadPreflight: 'ready' | 'blocked';
}

export interface MemoryManifestQuery {
  context: MemoryRequestContext;
  trigger: Exclude<MemoryReadTrigger, 'explicit-search'>;
  queryText?: string;
  maxManifestChars?: number;
  targetStepAttemptId?: string;
}

export interface MemorySearchQuery {
  context: MemoryRequestContext;
  query: string;
  maxIndexChars?: number;
  limit?: number;
}

export interface MemorySearchResult {
  items: MemoryIndexRecord[];
  serializedChars: number;
  omittedCount: number;
}

export interface MemoryDetailPage {
  memoryId: string;
  detailVersion: number;
  details: string;
  detailChars: number;
  contentHash: string;
  cursor?: string;
  nextCursor?: string;
  complete: boolean;
  requiredReadExtract?: {
    extract: string;
    extractHash: string;
    extractChars: number;
  };
}

export interface ReadMemoryDetailsInput {
  context: MemoryRequestContext;
  memoryId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
  handoffId?: string;
  targetStepAttemptId?: string;
}

/**
 * Admin governance views may expose only structured index and delivery
 * metadata. They deliberately have no `details` field.
 */
export interface MemoryGovernanceScopeBinding {
  scopeType: MemoryScopeType;
  scopeKey: string;
  role: MemoryScopeBindingRole;
  visibility: MemoryVisibility;
}

export interface MemoryGovernanceReceiptCounts {
  total: number;
  pending: number;
  read: number;
  acknowledged: number;
  failed: number;
  cancelled: number;
  retrying: number;
}

export interface MemoryGovernanceHandoffState {
  handoffCount: number;
  targetCount: number;
  authorizedTargetCount: number;
  unauthorizedTargetCount: number;
  receipts: MemoryGovernanceReceiptCounts;
}

export interface MemoryGovernanceRecord {
  index: MemoryIndexRecord;
  governanceMode: MemoryGovernanceMode;
  detailChars: number;
  scopeBindings: MemoryGovernanceScopeBinding[];
  handoffState: MemoryGovernanceHandoffState;
}

export interface ListMemoryGovernanceInput {
  /** Must be a server-derived reviewer context. */
  context: MemoryRequestContext;
  statuses?: MemoryItemStatus[];
  retentions?: PersistedMemoryRetention[];
  ownerUserId?: string;
  /** Zero-based page offset for the index-only governance projection. */
  offset?: number;
  limit?: number;
}

export interface MemoryGovernanceListResult {
  items: MemoryGovernanceRecord[];
  total: number;
  pagination: {
    offset: number;
    limit: number;
    nextOffset: number | null;
  };
}

/**
 * This is a deliberately allowlisted projection of an audit decision. The
 * raw JSON audit payload may contain index fields and is never returned from
 * governance list APIs.
 */
export interface MemoryGovernanceAuditMetadata {
  retention?: PersistedMemoryRetention;
  detailVersion?: number;
  status?: MemoryItemStatus;
  targetMemoryId?: string;
  replacementMemoryId?: string;
  requestedRetention?: PersistedMemoryRetention;
}

export interface MemoryGovernanceAuditRecord {
  id: string;
  memoryId?: string;
  action: MemoryAuditAction;
  actor: string;
  sourceEventId: string;
  reason?: string;
  createdAt: string;
  metadata: MemoryGovernanceAuditMetadata;
}

export interface ListMemoryGovernanceAuditInput {
  /** Must be a server-derived reviewer context. */
  context: MemoryRequestContext;
  memoryId?: string;
  limit?: number;
}

export interface MemoryGovernanceActionInput {
  /** Must be a server-derived reviewer context. */
  context: MemoryRequestContext;
  action: MemoryGovernanceAction;
  memoryId: string;
  expectedDetailVersion: number;
  expectedFingerprint?: string;
  sourceEventId: string;
  idempotencyKey: string;
  reason?: string;
  /** Required for supersede; it refers to an existing server-persisted item. */
  replacementMemoryId?: string;
  /** Reclassification never accepts a detail body; it copies the exact persisted version. */
  requestedRetention?: PersistedMemoryRetention;
}

export interface MemoryGovernanceActionResult {
  action: MemoryGovernanceAction;
  memoryId: string;
  status: MemoryItemStatus;
  detailVersion: number;
  idempotent: boolean;
  replacement?: MemoryIndexRecord;
}

export interface MemoryProposalResult {
  action: MemoryDecisionProposal['action'];
  memoryId?: string;
  status: 'discarded' | MemoryItemStatus;
  detailVersion?: number;
  fingerprint?: string;
  idempotent: boolean;
}

export interface ServerRunParticipantSnapshot {
  runId: string;
  ownerUserId: string;
  workspaceId: string;
  membershipVersion: number;
  participants: Array<{
    agentId: string;
    grantedAt?: string;
    revokedAt?: string;
  }>;
}

export interface ServerRunChannelMemberSnapshot {
  runId: string;
  channelId: string;
  ownerUserId: string;
  workspaceId: string;
  membershipVersion: number;
  members: Array<{
    agentId: string;
    grantedAt?: string;
    revokedAt?: string;
  }>;
}

export interface MemoryHandoffDeliveryInput {
  memoryId: string;
}

/**
 * Server-derived target metadata used to validate a frozen handoff selector.
 * Channel identity is carried only for authorization; delivery persistence
 * keeps the target step attempt and Agent identity as the addressable pair.
 */
export interface MemoryHandoffResolvedTarget {
  targetStepAttemptId: string;
  targetAgentId: string;
  stepId?: string;
  workflowState?: string;
  stepTags?: string[];
  /** Server-derived channels available to the target step attempt. */
  channelIds?: string[];
}

export interface EmitResolvedHandoffDeliveryInput {
  memoryId: string;
  /** The server-observed current detail revision eligible for this handoff. */
  detailVersion: number;
  /** Server-observed selector mode, checked against the persisted memory row. */
  expectedMode: Exclude<MemoryHandoffMode, 'none'>;
  /** Server-observed selector target, checked against the persisted memory row. */
  expectedTarget: Exclude<MemoryHandoffTargetKind, 'none'>;
}

export interface EmitResolvedHandoffBatchInput {
  context: MemoryRequestContext;
  runId: string;
  sourceStepAttemptId: string;
  sourceEventId: string;
  deliveries: EmitResolvedHandoffDeliveryInput[];
  /**
   * Server-derived direct successor. Only a persisted `next-step` selector
   * may consume this target.
   */
  nextTarget?: MemoryHandoffResolvedTarget;
  /**
   * Server-derived candidate workflow attempts. The service filters this list
   * using the frozen persisted selector; AI output must never choose targets.
   */
  candidateTargets: MemoryHandoffResolvedTarget[];
}

export interface EmitResolvedHandoffBatchResult {
  batch: MemoryHandoffBatchRecord;
  handoffs: MemoryHandoffRecord[];
}

export interface ReissueResolvedHandoffTargetsForRetryInput {
  context: MemoryRequestContext;
  runId: string;
  previousTargetStepAttemptId: string;
  retryTarget: MemoryHandoffResolvedTarget;
}

export interface ReissueResolvedHandoffTargetsForRetryResult {
  handoffs: MemoryHandoffRecord[];
  receipts: MemoryHandoffReceiptRecord[];
}

/**
 * The immutable index-only view captured when a handoff is emitted. It
 * intentionally has no detail body, extract, artifact body, owner, or
 * workspace fields. A later upsert may change the live item index without
 * changing what a previously resolved target was asked to read.
 */
export interface MemoryHandoffIndexSnapshot {
  memoryId: string;
  retention: PersistedMemoryRetention;
  kind: string;
  lifecycleAnchor?: MemoryLifecycleAnchor;
  summary: string;
  readWhen: MemoryReadWhen;
  handoff: MemoryHandoff;
  detailVersion: number;
  confidence: number;
  fingerprint: string;
  indexChars: number;
  source: MemorySourceProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface CompleteHandoffBatchInput {
  context: MemoryRequestContext;
  runId: string;
  sourceStepAttemptId: string;
  sourceEventId: string;
  status: MemoryHandoffBatchStatus;
  parentRunId?: string;
  parentStepAttemptId?: string;
  deliveries?: MemoryHandoffDeliveryInput[];
}

export interface ResolveHandoffTargetsInput {
  context: MemoryRequestContext;
  handoffId: string;
  targets: MemoryHandoffResolvedTarget[];
}

export interface RecordHandoffReceiptInput {
  context: MemoryRequestContext;
  handoffId: string;
  targetStepAttemptId: string;
  targetAgentId: string;
  detailVersion: number;
  status: Exclude<MemoryHandoffReceiptStatus, 'acknowledged'>;
  extractHash?: string;
  failureCode?: string;
}

export interface AcknowledgeRequiredReadInput {
  context: MemoryRequestContext;
  handoffId: string;
  targetStepAttemptId: string;
  targetAgentId: string;
  detailVersion: number;
  extractHash: string;
}

export interface MemoryHandoffBatchRecord {
  id: string;
  runId: string;
  sourceStepAttemptId: string;
  sourceEventId: string;
  status: MemoryHandoffBatchStatus;
  parentRunId?: string;
  parentStepAttemptId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryHandoffRecord {
  id: string;
  batchId: string;
  memoryId: string;
  detailVersion: number;
  mode: Exclude<MemoryHandoffMode, 'none'>;
  target: MemoryHandoff;
  status: MemoryHandoffStatus;
  /**
   * Present for all handoffs emitted by the V2 service. It is optional only
   * so an early V2 schema can be opened and inspected before backfill.
   */
  indexSnapshot?: MemoryHandoffIndexSnapshot;
  resolvedTargets: Array<{
    targetStepAttemptId: string;
    targetAgentId: string;
  }>;
}

export interface MemoryHandoffReceiptRecord {
  id: string;
  handoffId: string;
  targetStepAttemptId: string;
  targetAgentId: string;
  detailVersion: number;
  extractHash?: string;
  status: MemoryHandoffReceiptStatus;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryHandoffRunState {
  batches: MemoryHandoffBatchRecord[];
  handoffs: MemoryHandoffRecord[];
  receipts: MemoryHandoffReceiptRecord[];
}

export interface MemoryArtifactRefInput {
  context: MemoryRequestContext;
  memoryId: string;
  detailVersion: number;
  runId: string;
  artifactKind: MemoryArtifactKind;
  relativePath: string;
  contentHash: string;
  createdAt?: string;
}

export interface MemoryArtifactRef {
  id: string;
  memoryId: string;
  detailVersion: number;
  runId: string;
  artifactKind: MemoryArtifactKind;
  relativePath: string;
  contentHash: string;
  createdAt: string;
}

export interface LegacyArchiveMetadata {
  sourcePath: string;
  sourceType: 'sqlite' | 'yaml' | 'json' | 'run-output' | 'other';
  contentHash: string;
  retentionPolicy: string;
  verificationStatus: 'verified-no-access' | 'pending-verification';
  archivedAt?: string;
}

export interface InitializeFreshMemoryStoreInput {
  legacyArchives?: LegacyArchiveMetadata[];
}

export interface InitializeFreshMemoryStoreResult {
  initializedNow: boolean;
  itemCount: number;
  detailCount: number;
  archiveRegistryCount: number;
}

/** Metadata-only cutover inspection. Archive entries never include file bodies. */
export interface MemoryLegacyArchiveRegistryRecord extends LegacyArchiveMetadata {
  accessProhibited: true;
}

export interface MemoryV2StoreCutoverDiagnostics {
  itemCount: number;
  detailCount: number;
  freshStartInitializedAt?: string;
  freshStartMode?: string;
  legacyAccessMode?: string;
  storeCreatedOnOpen?: boolean;
  archiveRegistry: {
    count: number;
    verifiedNoAccessCount: number;
    pendingVerificationCount: number;
    entries: MemoryLegacyArchiveRegistryRecord[];
  };
}

export interface MemoryServiceBudgets {
  maxSummaryChars: number;
  maxReadWhenChars: number;
  maxDetailChars: number;
  maxIndexItemChars: number;
  maxManifestChars: number;
  maxSearchIndexChars: number;
  maxRequiredReadIndexChars: number;
  maxDetailReadChars: number;
  maxRequiredReadExtractChars: number;
  maxFtsProjectionChars: number;
}

export type MemoryServiceErrorCode =
  | 'MEMORY_INVALID_INPUT'
  | 'MEMORY_UNAUTHORIZED'
  | 'MEMORY_NOT_FOUND'
  | 'MEMORY_CONFLICT'
  | 'MEMORY_LIMIT_EXCEEDED'
  | 'MEMORY_CAPTURE_DISABLED'
  | 'MEMORY_REQUIRED_READ_BLOCKED'
  | 'MEMORY_LEGACY_IMPORT_FORBIDDEN';

export class MemoryServiceError extends Error {
  constructor(
    public readonly code: MemoryServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MemoryServiceError';
  }
}
