import { createHash, randomUUID } from 'crypto';
import { isAbsolute } from 'path';
import {
  openMemoryV2Database,
  type MemoryV2Database,
  withMemoryV2ImmediateTransaction,
} from './database';
import {
  recordMemoryV2AuthorizationDenied,
  recordMemoryV2BlockedRequiredRead,
  recordMemoryV2DetailReadTelemetry,
  recordMemoryV2FreshStartRows,
  recordMemoryV2HandoffBatchEmitted,
  recordMemoryV2IdempotentReplay,
  recordMemoryV2ManifestTelemetry,
  recordMemoryV2ReceiptStatus,
  recordMemoryV2RequiredReadBudgetFailure,
  recordMemoryV2RunStateReconstruction,
  recordMemoryV2SearchTelemetry,
  recordMemoryV2Write,
} from '../memory-v2-cutover/telemetry';
import {
  MEMORY_ARTIFACT_KINDS,
  MEMORY_AUDIT_ACTIONS,
  MEMORY_GOVERNANCE_ACTIONS,
  MEMORY_GOVERNANCE_MODES,
  MEMORY_HANDOFF_BATCH_STATUSES,
  MEMORY_HANDOFF_MODES,
  MEMORY_HANDOFF_RECEIPT_STATUSES,
  MEMORY_HANDOFF_STATUSES,
  MEMORY_HANDOFF_TARGETS,
  MEMORY_READ_TRIGGERS,
  MEMORY_RETENTIONS,
  MEMORY_SCOPE_TYPES,
  type AcknowledgeRequiredReadInput,
  type CompleteHandoffBatchInput,
  type EmitResolvedHandoffBatchInput,
  type EmitResolvedHandoffBatchResult,
  type EmitResolvedHandoffDeliveryInput,
  type InitializeFreshMemoryStoreInput,
  type InitializeFreshMemoryStoreResult,
  type LegacyArchiveMetadata,
  type MemoryArtifactRef,
  type MemoryArtifactRefInput,
  type ListMemoryGovernanceAuditInput,
  type ListMemoryGovernanceInput,
  type MemoryDecisionProposal,
  type MemoryDetailPage,
  type MemoryAuditAction,
  type MemoryGovernanceAction,
  type MemoryGovernanceActionInput,
  type MemoryGovernanceActionResult,
  type MemoryGovernanceAuditMetadata,
  type MemoryGovernanceAuditRecord,
  type MemoryGovernanceHandoffState,
  type MemoryGovernanceListResult,
  type MemoryGovernanceRecord,
  type MemoryGovernanceScopeBinding,
  type MemoryGovernanceMode,
  type MemoryHandoff,
  type MemoryHandoffBatchStatus,
  type MemoryHandoffBatchRecord,
  type MemoryHandoffDeliveryInput,
  type MemoryHandoffIndexSnapshot,
  type MemoryHandoffReceiptRecord,
  type MemoryHandoffReceiptStatus,
  type MemoryHandoffResolvedTarget,
  type MemoryHandoffRecord,
  type MemoryHandoffRunState,
  type MemoryHandoffStatus,
  type MemoryIndexRecord,
  type MemoryItemStatus,
  type MemoryLegacyArchiveRegistryRecord,
  type MemoryLifecycleAnchor,
  type MemoryManifest,
  type MemoryManifestItem,
  type MemoryManifestQuery,
  type MemoryProposalResult,
  type MemoryReadWhen,
  type MemoryRequestContext,
  type MemoryScopeBinding,
  type MemoryScopeBindingProposal,
  type MemorySearchQuery,
  type MemorySearchResult,
  type MemoryServiceBudgets,
  type MemorySourceProvenance,
  type MemoryVisibility,
  type MemoryV2StoreCutoverDiagnostics,
  type PersistedMemoryRetention,
  type ReadMemoryDetailsInput,
  type RecordHandoffReceiptInput,
  type ReissueResolvedHandoffTargetsForRetryInput,
  type ReissueResolvedHandoffTargetsForRetryResult,
  type ResolveHandoffTargetsInput,
  type ServerRunChannelMemberSnapshot,
  type ServerRunParticipantSnapshot,
  MemoryServiceError,
} from './types';

const HARD_MEMORY_BUDGETS: Readonly<MemoryServiceBudgets> = {
  maxSummaryChars: 1_200,
  maxReadWhenChars: 1_200,
  maxDetailChars: 60_000,
  maxIndexItemChars: 3_000,
  maxManifestChars: 16_000,
  maxSearchIndexChars: 12_000,
  maxRequiredReadIndexChars: 6_000,
  maxDetailReadChars: 8_000,
  maxRequiredReadExtractChars: 8_000,
  maxFtsProjectionChars: 3_000,
};

const DEFAULT_MEMORY_BUDGETS: MemoryServiceBudgets = {
  maxSummaryChars: 800,
  maxReadWhenChars: 800,
  maxDetailChars: 40_000,
  maxIndexItemChars: 2_000,
  maxManifestChars: 10_000,
  maxSearchIndexChars: 8_000,
  maxRequiredReadIndexChars: 3_000,
  maxDetailReadChars: 6_000,
  maxRequiredReadExtractChars: 6_000,
  maxFtsProjectionChars: 2_000,
};

const INDEX_TIMESTAMP_PLACEHOLDER = '9999-12-31T23:59:59.999Z';

const PERSISTED_STATUSES = new Set(['pending-review', 'active', 'resolved', 'superseded', 'expired', 'rejected']);
const AUDIT_ACTION_SET = new Set<string>(MEMORY_AUDIT_ACTIONS);
const GOVERNANCE_ACTION_SET = new Set<string>(MEMORY_GOVERNANCE_ACTIONS);
const HANDOFF_MODE_SET = new Set<string>(MEMORY_HANDOFF_MODES);
const HANDOFF_TARGET_SET = new Set<string>(MEMORY_HANDOFF_TARGETS);
const TRIGGER_SET = new Set<string>(MEMORY_READ_TRIGGERS);
const SCOPE_SET = new Set<string>(MEMORY_SCOPE_TYPES);
const GOVERNANCE_SET = new Set<string>(MEMORY_GOVERNANCE_MODES);
const ARTIFACT_KIND_SET = new Set<string>(MEMORY_ARTIFACT_KINDS);
const BATCH_STATUS_SET = new Set<string>(MEMORY_HANDOFF_BATCH_STATUSES);
const HANDOFF_STATUS_SET = new Set<string>(MEMORY_HANDOFF_STATUSES);
const RECEIPT_STATUS_SET = new Set<string>(MEMORY_HANDOFF_RECEIPT_STATUSES);
const BATCH_STATUS_TRANSITIONS: Readonly<Record<MemoryHandoffBatchStatus, readonly MemoryHandoffBatchStatus[]>> = {
  'no-op': [],
  emitted: [],
  failed: ['retrying', 'superseded'],
  cancelled: ['retrying', 'superseded'],
  retrying: ['no-op', 'emitted', 'failed', 'cancelled', 'superseded'],
  superseded: [],
};

type SqliteRow = Record<string, unknown>;

interface MemoryItemRow extends SqliteRow {
  id: string;
  retention: PersistedMemoryRetention;
  kind: string;
  lifecycle_anchor_type: 'session' | 'run' | null;
  lifecycle_anchor_key: string | null;
  lifecycle_anchor_workflow_id: string | null;
  summary: string;
  read_when: string;
  read_when_json: string;
  handoff_mode: MemoryHandoff['mode'];
  handoff_target_json: string;
  index_chars: number;
  detail_version: number;
  status: string;
  confidence: number;
  fingerprint: string;
  governance_mode: MemoryGovernanceMode;
  source_event_id: string;
  idempotency_key: string;
  source_agent_id: string | null;
  source_session_id: string | null;
  source_run_id: string | null;
  source_workflow_id: string | null;
  source_step_attempt_id: string | null;
  owner_user_id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  expires_at: string | null;
}

interface MemoryDetailRow extends SqliteRow {
  memory_id: string;
  detail_version: number;
  details: string;
  detail_chars: number;
  content_hash: string;
  required_read_extract: string | null;
  required_read_extract_chars: number | null;
  required_read_extract_hash: string | null;
}

interface HandoffDeliveryRow extends SqliteRow {
  handoff_id: string;
  target_step_attempt_id: string;
  target_agent_id: string;
  receipt_status: string | null;
  handoff_mode: string;
  handoff_detail_version: number;
  index_snapshot_json: string;
}

interface ManifestDeliveryMatch {
  delivery: NonNullable<MemoryManifestItem['delivery']>;
  indexSnapshot?: MemoryHandoffIndexSnapshot;
}

interface NormalizedMemoryWrite {
  proposal: MemoryDecisionProposal;
  retention: PersistedMemoryRetention;
  lifecycleAnchor?: MemoryLifecycleAnchor;
  scopeBindings: MemoryScopeBinding[];
  summary: string;
  readWhen: MemoryReadWhen;
  handoff: MemoryHandoff;
  details: string;
  kind: string;
  confidence: number;
  expiresAt?: string;
  fingerprint: string;
  indexChars: number;
  ftsProjection: string;
}

interface NormalizedResolvedHandoffTarget extends MemoryHandoffResolvedTarget {
  stepTags: string[];
  channelIds: string[];
}

interface NormalizedResolvedHandoffDelivery {
  memoryId: string;
  detailVersion: number;
  expectedMode: Exclude<MemoryHandoff['mode'], 'none'>;
  expectedTarget: Exclude<MemoryHandoff['target'], 'none'>;
}

interface NormalizedServerHandoffTargetPlan {
  nextTarget?: NormalizedResolvedHandoffTarget;
  candidateTargets: NormalizedResolvedHandoffTarget[];
}

interface PreparedResolvedHandoffDelivery {
  memory: MemoryItemRow;
  index: MemoryIndexRecord;
  selector: MemoryHandoff;
  targets: NormalizedResolvedHandoffTarget[];
  requiredReadExtractHash?: string;
}

interface PersistedHandoffRow extends SqliteRow {
  id: string;
  batch_id: string;
  memory_id: string;
  detail_version: number;
  mode: string;
  status: string;
  target_selector_json: string;
}

interface PreparedRetryHandoff {
  handoff: PersistedHandoffRow;
  selector: MemoryHandoff;
  requiredReadExtractHash?: string;
  needsTargetInsert: boolean;
}

export interface MemoryServiceOptions {
  /** The canonical V2 database path; `:memory:` is allowed only under `NODE_ENV=test`. */
  filename?: string;
  budgets?: Partial<MemoryServiceBudgets>;
  now?: () => string;
  validateSensitiveContent?: (input: { proposal: MemoryDecisionProposal; context: MemoryRequestContext }) => string | undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireText(value: unknown, label: string): string {
  const normalized = text(value);
  if (!normalized) throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} is required`);
  return normalized;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function requireSha256(value: unknown, label: string): string {
  const normalized = requireText(value, label);
  if (!/^(?:sha256:)?[a-f0-9]{64}$/i.test(normalized)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} must be a SHA-256 checksum`);
  }
  return normalized;
}

function clampInteger(value: unknown, fallback: number, ceiling: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(ceiling, Math.floor(parsed)));
}

function clampNonNegativeInteger(value: unknown, fallback: number, ceiling: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(ceiling, Math.floor(parsed)));
}

function requirePositiveInteger(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > Number.MAX_SAFE_INTEGER) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} must be a positive integer`);
  }
  return parsed;
}

function normalizeBudgets(input: Partial<MemoryServiceBudgets> | undefined): MemoryServiceBudgets {
  const budget = {} as MemoryServiceBudgets;
  for (const key of Object.keys(DEFAULT_MEMORY_BUDGETS) as Array<keyof MemoryServiceBudgets>) {
    budget[key] = clampInteger(input?.[key], DEFAULT_MEMORY_BUDGETS[key], HARD_MEMORY_BUDGETS[key]);
  }
  budget.maxRequiredReadExtractChars = Math.min(budget.maxRequiredReadExtractChars, budget.maxDetailReadChars);
  budget.maxRequiredReadIndexChars = Math.min(budget.maxRequiredReadIndexChars, budget.maxManifestChars);
  return budget;
}

function uniqueStrings(values: unknown, maxItems = 40, maxChars = 160): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || normalized.length > maxChars || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function assertMaxChars(value: string, maxChars: number, label: string): string {
  if (value.length > maxChars) {
    throw new MemoryServiceError('MEMORY_LIMIT_EXCEEDED', `${label} exceeds the server character budget`);
  }
  return value;
}

function normalizeReadWhen(input: unknown, budgets: MemoryServiceBudgets): MemoryReadWhen {
  if (!input || typeof input !== 'object') {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'readWhen is required');
  }
  const candidate = input as Partial<MemoryReadWhen>;
  const triggers = uniqueStrings(candidate.triggers, 8, 64);
  if (!triggers.length || triggers.some((trigger) => !TRIGGER_SET.has(trigger))) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'readWhen.triggers must contain allowlisted trigger values');
  }
  const normalized: MemoryReadWhen = {
    text: assertMaxChars(requireText(candidate.text, 'readWhen.text'), budgets.maxReadWhenChars, 'readWhen.text'),
    triggers: triggers as MemoryReadWhen['triggers'],
  };
  const optionalLists: Array<keyof Pick<MemoryReadWhen, 'workflowStates' | 'stepIds' | 'stepTags' | 'agentIds' | 'keywords'>> = [
    'workflowStates',
    'stepIds',
    'stepTags',
    'agentIds',
    'keywords',
  ];
  for (const key of optionalLists) {
    const values = uniqueStrings(candidate[key], 32, 160);
    if (values.length) normalized[key] = values;
  }
  return normalized;
}

function normalizeHandoff(input: unknown): MemoryHandoff {
  if (!input || typeof input !== 'object') {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff is required');
  }
  const candidate = input as Partial<MemoryHandoff>;
  const mode = text(candidate.mode);
  const target = text(candidate.target);
  if (!HANDOFF_MODE_SET.has(mode) || !HANDOFF_TARGET_SET.has(target)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff mode or target is invalid');
  }
  if ((mode === 'none') !== (target === 'none')) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff.mode none must be paired with handoff.target none');
  }
  if (mode === 'required-read' && target === 'none') {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'required-read requires a concrete handoff target');
  }
  const normalized: MemoryHandoff = { mode: mode as MemoryHandoff['mode'], target: target as MemoryHandoff['target'] };
  const optionalLists: Array<keyof Pick<MemoryHandoff, 'stepIds' | 'stepTags' | 'workflowStates' | 'agentIds'>> = [
    'stepIds',
    'stepTags',
    'workflowStates',
    'agentIds',
  ];
  for (const key of optionalLists) {
    const values = uniqueStrings(candidate[key], 64, 160);
    if (values.length) normalized[key] = values;
  }
  if (target === 'matching-steps' && !normalized.stepIds?.length && !normalized.stepTags?.length && !normalized.workflowStates?.length) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'matching-steps requires at least one step selector');
  }
  if (target === 'named-agents' && !normalized.agentIds?.length) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'named-agents requires agentIds');
  }
  return normalized;
}

function normalizeAnchor(input: unknown): MemoryLifecycleAnchor | undefined {
  if (!input) return undefined;
  if (typeof input !== 'object') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'lifecycleAnchor is invalid');
  const candidate = input as Partial<MemoryLifecycleAnchor>;
  if (candidate.scopeType === 'session') {
    return { scopeType: 'session', sessionId: requireText(candidate.sessionId, 'lifecycleAnchor.sessionId') };
  }
  if (candidate.scopeType === 'run') {
    return {
      scopeType: 'run',
      runId: requireText(candidate.runId, 'lifecycleAnchor.runId'),
      workflowId: requireText(candidate.workflowId, 'lifecycleAnchor.workflowId'),
    };
  }
  throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'lifecycleAnchor scope type is invalid');
}

function normalizeScopeProposal(input: unknown): MemoryScopeBindingProposal[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'scopeBindings must be an array');
  const result: MemoryScopeBindingProposal[] = [];
  const seen = new Set<string>();
  for (const candidate of input) {
    if (!candidate || typeof candidate !== 'object') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'scope binding is invalid');
    const scopeType = text((candidate as Partial<MemoryScopeBindingProposal>).scopeType);
    const scopeKey = requireText((candidate as Partial<MemoryScopeBindingProposal>).scopeKey, 'scopeBinding.scopeKey');
    if (!SCOPE_SET.has(scopeType)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'scopeBinding.scopeType is invalid');
    const key = `${scopeType}\n${scopeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ scopeType: scopeType as MemoryScopeBindingProposal['scopeType'], scopeKey });
    if (result.length > 20) throw new MemoryServiceError('MEMORY_LIMIT_EXCEEDED', 'too many scope bindings');
  }
  return result;
}

function normalizeIsoDate(input: unknown, label: string): string | undefined {
  if (input === undefined || input === null || input === '') return undefined;
  const value = requireText(input, label);
  if (!Number.isFinite(Date.parse(value))) throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} must be an ISO timestamp`);
  return new Date(value).toISOString();
}

function contextValues(context: MemoryRequestContext, key: 'agent' | 'workflow' | 'project' | 'session' | 'run' | 'channel'): Set<string> {
  const values = new Set<string>();
  const add = (value: unknown) => {
    const normalized = text(value);
    if (normalized) values.add(normalized);
  };
  switch (key) {
    case 'agent':
      add(context.agentId);
      for (const value of context.authorizedAgentIds ?? []) add(value);
      break;
    case 'workflow':
      add(context.workflowId);
      for (const value of context.authorizedWorkflowIds ?? []) add(value);
      break;
    case 'project':
      for (const value of context.projectIds ?? []) add(value);
      for (const value of context.authorizedProjectIds ?? []) add(value);
      break;
    case 'session':
      add(context.sessionId);
      for (const value of context.authorizedSessionIds ?? []) add(value);
      break;
    case 'run':
      add(context.runId);
      for (const value of context.authorizedRunIds ?? []) add(value);
      break;
    case 'channel':
      add(context.channelId);
      for (const value of context.authorizedChannelIds ?? []) add(value);
      break;
  }
  return values;
}

function assertContext(context: MemoryRequestContext): void {
  requireText(context.ownerUserId, 'context.ownerUserId');
  requireText(context.workspaceId, 'context.workspaceId');
  if (!['ai', 'system', 'reviewer'].includes(context.actor)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'context.actor is invalid');
  }
  if (context.governanceMode !== undefined && !GOVERNANCE_SET.has(context.governanceMode)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'context.governanceMode is invalid');
  }
}

function containsSensitiveCredential(value: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{20,}\b/i.test(value);
}

function cursorFor(detailVersion: number, offset: number): string {
  return Buffer.from(stableJson({ detailVersion, offset }), 'utf8').toString('base64url');
}

function parseCursor(cursor: string | undefined, detailVersion: number): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { detailVersion?: unknown; offset?: unknown };
    const offset = Number(parsed.offset);
    if (Number(parsed.detailVersion) !== detailVersion || !Number.isInteger(offset) || offset < 0) throw new Error('invalid cursor');
    return offset;
  } catch {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'detail cursor is invalid for this detail revision');
  }
}

function sameAnchor(left: MemoryLifecycleAnchor | undefined, right: MemoryLifecycleAnchor | undefined): boolean {
  if (!left || !right) return left === right;
  if (left.scopeType !== right.scopeType) return false;
  if (left.scopeType === 'session' && right.scopeType === 'session') return left.sessionId === right.sessionId;
  return left.scopeType === 'run' && right.scopeType === 'run' && left.runId === right.runId && left.workflowId === right.workflowId;
}

export class MemoryService {
  readonly budgets: MemoryServiceBudgets;

  private readonly db: MemoryV2Database;
  private readonly storeCreated: boolean;
  private readonly clock: () => string;
  private readonly validateSensitiveContent?: MemoryServiceOptions['validateSensitiveContent'];

  constructor(options: MemoryServiceOptions = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'db') || Object.prototype.hasOwnProperty.call(options, 'testPath')) {
      throw new Error('MemoryService does not accept injected databases or test filesystem paths; use filename: :memory: for an isolated store');
    }
    const opened = openMemoryV2Database({
      ...(options.filename === undefined ? {} : { filename: options.filename }),
    });
    this.db = opened.db;
    this.storeCreated = opened.created;
    this.budgets = normalizeBudgets(options.budgets);
    this.clock = options.now ?? nowIso;
    this.validateSensitiveContent = options.validateSensitiveContent;
  }

  close(): void {
    this.db.close();
  }

  initializeFreshStore(input: InitializeFreshMemoryStoreInput = {}): InitializeFreshMemoryStoreResult {
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const itemCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM memory_items').get() as { count?: number }).count ?? 0);
      const detailCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM memory_details').get() as { count?: number }).count ?? 0);
      const marker = this.db.prepare("SELECT value FROM memory_v2_metadata WHERE key = 'fresh_start_initialized_at'").get() as { value?: string } | undefined;
      const initializedNow = !marker && itemCount === 0 && detailCount === 0;
      const now = this.clock();
      if (!marker) {
        this.upsertMetadata('fresh_start_initialized_at', now, now);
        this.upsertMetadata('fresh_start_mode', itemCount === 0 && detailCount === 0 ? 'empty-v2' : 'reused-v2', now);
        this.upsertMetadata('legacy_access', 'disabled', now);
        this.upsertMetadata('store_created_on_open', this.storeCreated ? 'true' : 'false', now);
      }
      const archives = input.legacyArchives ?? [];
      this.assertLegacyArchiveRegistryMatches(archives);
      for (const archive of archives) this.registerLegacyArchiveMetadataInternal(archive, now);
      const archiveRegistryCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM legacy_archive_registry').get() as { count?: number }).count ?? 0);
      return { initializedNow, itemCount, detailCount, archiveRegistryCount };
    });
    recordMemoryV2FreshStartRows({ itemCount: result.itemCount, detailCount: result.detailCount });
    return result;
  }

  /**
   * Returns only fresh-store and archive-registry metadata. It never opens,
   * parses, or exposes a legacy archive body.
   */
  getCutoverDiagnostics(): MemoryV2StoreCutoverDiagnostics {
    const itemCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM memory_items').get() as { count?: number }).count ?? 0);
    const detailCount = Number((this.db.prepare('SELECT COUNT(*) AS count FROM memory_details').get() as { count?: number }).count ?? 0);
    const metadataRows = this.db.prepare(`
      SELECT key, value FROM memory_v2_metadata
      WHERE key IN ('fresh_start_initialized_at', 'fresh_start_mode', 'legacy_access', 'store_created_on_open')
    `).all() as Array<{ key?: string; value?: string }>;
    const metadata = new Map(metadataRows.map((row) => [String(row.key), String(row.value)]));
    const entries = (this.db.prepare(`
      SELECT source_path, source_type, content_hash, archived_at, retention_policy, verification_status, access_prohibited
      FROM legacy_archive_registry
      ORDER BY source_path ASC, source_type ASC, content_hash ASC
    `).all() as Array<SqliteRow>).flatMap((row): MemoryLegacyArchiveRegistryRecord[] => {
      const sourceType = text(row.source_type);
      const verificationStatus = text(row.verification_status);
      if (!['sqlite', 'yaml', 'json', 'run-output', 'other'].includes(sourceType)
        || !['verified-no-access', 'pending-verification'].includes(verificationStatus)
        || Number(row.access_prohibited) !== 1) {
        return [];
      }
      return [{
        sourcePath: String(row.source_path),
        sourceType: sourceType as MemoryLegacyArchiveRegistryRecord['sourceType'],
        contentHash: String(row.content_hash),
        archivedAt: String(row.archived_at),
        retentionPolicy: String(row.retention_policy),
        verificationStatus: verificationStatus as MemoryLegacyArchiveRegistryRecord['verificationStatus'],
        accessProhibited: true,
      }];
    });
    return {
      itemCount,
      detailCount,
      freshStartInitializedAt: metadata.get('fresh_start_initialized_at') || undefined,
      freshStartMode: metadata.get('fresh_start_mode') || undefined,
      legacyAccessMode: metadata.get('legacy_access') || undefined,
      storeCreatedOnOpen: metadata.get('store_created_on_open') === 'true',
      archiveRegistry: {
        count: entries.length,
        verifiedNoAccessCount: entries.filter((entry) => entry.verificationStatus === 'verified-no-access').length,
        pendingVerificationCount: entries.filter((entry) => entry.verificationStatus === 'pending-verification').length,
        entries,
      },
    };
  }

  registerLegacyArchiveMetadata(input: LegacyArchiveMetadata): void {
    withMemoryV2ImmediateTransaction(this.db, () => {
      this.assertLegacyArchiveRegistryMatches([input]);
      this.registerLegacyArchiveMetadataInternal(input, this.clock());
    });
  }

  assertLegacyImportForbidden(): never {
    throw new MemoryServiceError('MEMORY_LEGACY_IMPORT_FORBIDDEN', 'Memory V2 only accepts new proposals; legacy content import is forbidden');
  }

  persistRunParticipantSnapshot(input: ServerRunParticipantSnapshot): void {
    const runId = requireText(input.runId, 'runId');
    const ownerUserId = requireText(input.ownerUserId, 'ownerUserId');
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const membershipVersion = requirePositiveInteger(input.membershipVersion, 'membershipVersion');
    if (!Array.isArray(input.participants)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'participants must be an array');
    const participants = input.participants.map((participant) => ({
      agentId: requireText(participant.agentId, 'participant.agentId'),
      grantedAt: normalizeIsoDate(participant.grantedAt, 'participant.grantedAt') ?? this.clock(),
      revokedAt: normalizeIsoDate(participant.revokedAt, 'participant.revokedAt'),
    }));
    if (new Set(participants.map((participant) => participant.agentId)).size !== participants.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'participant snapshot contains duplicate agent IDs');
    }
    withMemoryV2ImmediateTransaction(this.db, () => {
      const now = this.clock();
      const currentVersion = Number((this.db.prepare(`
        SELECT COALESCE(MAX(membership_version), 0) AS version
        FROM run_participants WHERE run_id = ? AND owner_user_id = ? AND workspace_id = ?
      `).get(runId, ownerUserId, workspaceId) as { version?: number }).version ?? 0);
      if (membershipVersion < currentVersion) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'run participant snapshot membershipVersion cannot move backwards');
      }
      if (membershipVersion === currentVersion && currentVersion > 0) {
        const existing = this.db.prepare(`
          SELECT agent_id, revoked_at FROM run_participants
          WHERE run_id = ? AND owner_user_id = ? AND workspace_id = ? AND membership_version = ?
          ORDER BY agent_id ASC
        `).all(runId, ownerUserId, workspaceId, membershipVersion) as Array<{ agent_id: string; revoked_at: string | null }>;
        const requested = participants
          .map((participant) => `${participant.agentId}\n${participant.revokedAt ?? ''}`)
          .sort();
        const persisted = existing
          .map((participant) => `${participant.agent_id}\n${participant.revoked_at ?? ''}`)
          .sort();
        if (requested.length !== persisted.length || requested.some((value, index) => value !== persisted[index])) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'run participant snapshot version is immutable');
        }
        return;
      }
      this.db.prepare(`
        UPDATE run_participants
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE run_id = ? AND owner_user_id = ? AND workspace_id = ?
          AND membership_version < ? AND revoked_at IS NULL
      `).run(now, runId, ownerUserId, workspaceId, membershipVersion);
      const insert = this.db.prepare(`
        INSERT INTO run_participants (
          run_id, agent_id, owner_user_id, workspace_id, membership_version, granted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, agent_id, membership_version) DO UPDATE SET
          granted_at = excluded.granted_at,
          revoked_at = excluded.revoked_at
      `);
      for (const participant of participants) {
        insert.run(runId, participant.agentId, ownerUserId, workspaceId, membershipVersion, participant.grantedAt, participant.revokedAt ?? null);
      }
    });
  }

  persistRunChannelMemberSnapshot(input: ServerRunChannelMemberSnapshot): void {
    const runId = requireText(input.runId, 'runId');
    const channelId = requireText(input.channelId, 'channelId');
    const ownerUserId = requireText(input.ownerUserId, 'ownerUserId');
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const membershipVersion = requirePositiveInteger(input.membershipVersion, 'membershipVersion');
    if (!Array.isArray(input.members)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'channel members must be an array');
    const members = input.members.map((member) => ({
      agentId: requireText(member.agentId, 'channel member.agentId'),
      grantedAt: normalizeIsoDate(member.grantedAt, 'channel member.grantedAt') ?? this.clock(),
      revokedAt: normalizeIsoDate(member.revokedAt, 'channel member.revokedAt'),
    }));
    if (new Set(members.map((member) => member.agentId)).size !== members.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'channel member snapshot contains duplicate agent IDs');
    }
    withMemoryV2ImmediateTransaction(this.db, () => {
      const now = this.clock();
      const currentVersion = Number((this.db.prepare(`
        SELECT COALESCE(MAX(membership_version), 0) AS version
        FROM run_channel_members
        WHERE run_id = ? AND channel_id = ? AND owner_user_id = ? AND workspace_id = ?
      `).get(runId, channelId, ownerUserId, workspaceId) as { version?: number }).version ?? 0);
      if (membershipVersion < currentVersion) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'run channel member snapshot membershipVersion cannot move backwards');
      }
      if (membershipVersion === currentVersion && currentVersion > 0) {
        const existing = this.db.prepare(`
          SELECT agent_id, revoked_at FROM run_channel_members
          WHERE run_id = ? AND channel_id = ? AND owner_user_id = ? AND workspace_id = ? AND membership_version = ?
          ORDER BY agent_id ASC
        `).all(runId, channelId, ownerUserId, workspaceId, membershipVersion) as Array<{ agent_id: string; revoked_at: string | null }>;
        const requested = members
          .map((member) => `${member.agentId}\n${member.revokedAt ?? ''}`)
          .sort();
        const persisted = existing
          .map((member) => `${member.agent_id}\n${member.revoked_at ?? ''}`)
          .sort();
        if (requested.length !== persisted.length || requested.some((value, index) => value !== persisted[index])) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'run channel member snapshot version is immutable');
        }
        return;
      }
      this.db.prepare(`
        UPDATE run_channel_members
        SET revoked_at = COALESCE(revoked_at, ?)
        WHERE run_id = ? AND channel_id = ? AND owner_user_id = ? AND workspace_id = ?
          AND membership_version < ? AND revoked_at IS NULL
      `).run(now, runId, channelId, ownerUserId, workspaceId, membershipVersion);
      const insert = this.db.prepare(`
        INSERT INTO run_channel_members (
          run_id, channel_id, agent_id, owner_user_id, workspace_id, membership_version, granted_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id, channel_id, agent_id, membership_version) DO UPDATE SET
          granted_at = excluded.granted_at,
          revoked_at = excluded.revoked_at
      `);
      for (const member of members) {
        insert.run(runId, channelId, member.agentId, ownerUserId, workspaceId, membershipVersion, member.grantedAt, member.revokedAt ?? null);
      }
    });
  }

  propose(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryProposalResult {
    assertContext(context);
    const action = text(proposal?.action);
    if (!['discard', 'create', 'upsert', 'resolve'].includes(action)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'memory proposal action is invalid');
    }
    if (action !== 'discard') this.assertCaptureEnabled(context);
    if (action === 'discard') return this.discard(proposal, context);
    if (action === 'create') return this.create(proposal, context);
    if (action === 'upsert') return this.upsert(proposal, context);
    return this.resolve(proposal, context);
  }

  upsert(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryProposalResult {
    if (proposal.action !== 'upsert') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'upsert requires action upsert');
    assertContext(context);
    this.assertCaptureEnabled(context);
    const existing = this.getIdempotentResult('upsert', proposal, context);
    if (existing) {
      recordMemoryV2IdempotentReplay();
      return existing;
    }
    const normalized = this.normalizeWritableProposal(proposal, context);
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const idempotent = this.getIdempotentResult('upsert', proposal, context);
      if (idempotent) return idempotent;
      const target = this.findMutationTarget(proposal, context);
      this.assertExpectedRevisionAndFingerprint(target, proposal);
      if (!['active', 'pending-review'].includes(target.status)) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'only active or pending-review memory can be upserted');
      }
      const currentIndex = this.rowToIndex(target);
      if (currentIndex.retention !== normalized.retention || !sameAnchor(currentIndex.lifecycleAnchor, normalized.lifecycleAnchor)) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'upsert cannot change retention or lifecycle anchor; create a replacement instead');
      }
      if (proposal.replacesMemoryId) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'upsert cannot use replacesMemoryId');
      const nextDetailVersion = currentIndex.detailVersion + 1;
      const now = this.clock();
      const nextIndexChars = this.indexCharsFor(target.id, nextDetailVersion, normalized, context);
      this.db.prepare('UPDATE memory_details SET is_current = 0, updated_at = ? WHERE memory_id = ? AND is_current = 1').run(now, target.id);
      this.insertDetail(target.id, nextDetailVersion, normalized, now);
      this.db.prepare('DELETE FROM memory_scope_bindings WHERE memory_id = ?').run(target.id);
      this.insertBindings(target.id, normalized.scopeBindings, now);
      this.db.prepare(`
        UPDATE memory_items
        SET kind = ?, summary = ?, read_when = ?, read_when_json = ?, handoff_mode = ?, handoff_target_json = ?,
          index_chars = ?, detail_version = ?, confidence = ?, fingerprint = ?, source_event_id = ?, idempotency_key = ?,
          source_agent_id = ?, source_session_id = ?, source_run_id = ?, source_workflow_id = ?, source_step_attempt_id = ?,
          updated_at = ?, expires_at = ?
        WHERE id = ?
      `).run(
        normalized.kind,
        normalized.summary,
        normalized.readWhen.text,
        stableJson(normalized.readWhen),
        normalized.handoff.mode,
        stableJson(normalized.handoff),
        nextIndexChars,
        nextDetailVersion,
        normalized.confidence,
        normalized.fingerprint,
        proposal.sourceEventId,
        proposal.idempotencyKey,
        context.agentId ?? null,
        context.sessionId ?? null,
        context.runId ?? null,
        context.workflowId ?? null,
        context.stepAttemptId ?? null,
        now,
        normalized.expiresAt ?? null,
        target.id,
      );
      this.replaceFtsProjection(target.id, normalized, now);
      this.insertAudit({
        memoryId: target.id,
        action: 'upsert',
        actor: this.actorLabel(context),
        sourceEventId: proposal.sourceEventId,
        idempotencyKey: proposal.idempotencyKey,
        decision: this.auditDecision(proposal, normalized),
        createdAt: now,
      });
      return {
        action: 'upsert',
        memoryId: target.id,
        status: target.status as MemoryProposalResult['status'],
        detailVersion: nextDetailVersion,
        fingerprint: normalized.fingerprint,
        idempotent: false,
      };
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('upserts');
      // An upsert is the only current protocol action that merges a proposal
      // into an existing active/pending index rather than creating a new item.
      recordMemoryV2Write('duplicateMerges');
    }
    return result;
  }

  resolve(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryProposalResult {
    if (proposal.action !== 'resolve') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolve requires action resolve');
    assertContext(context);
    this.assertCaptureEnabled(context);
    const existing = this.getIdempotentResult('resolve', proposal, context);
    if (existing) {
      recordMemoryV2IdempotentReplay();
      return existing;
    }
    if (proposal.retention === 'none') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolve cannot use retention none');
    const sourceEventId = requireText(proposal.sourceEventId, 'sourceEventId');
    const idempotencyKey = requireText(proposal.idempotencyKey, 'idempotencyKey');
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const idempotent = this.getIdempotentResult('resolve', proposal, context);
      if (idempotent) return idempotent;
      const target = this.findMutationTarget(proposal, context);
      this.assertExpectedRevisionAndFingerprint(target, proposal);
      if (target.retention !== proposal.retention) throw new MemoryServiceError('MEMORY_CONFLICT', 'resolve retention does not match target memory');
      if (!['active', 'pending-review'].includes(target.status)) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'only active or pending-review memory can be resolved');
      }
      const now = this.clock();
      this.db.prepare(`
        UPDATE memory_items
        SET status = 'resolved', resolved_at = ?, updated_at = ?, source_event_id = ?, idempotency_key = ?
        WHERE id = ?
      `).run(now, now, sourceEventId, idempotencyKey, target.id);
      this.removeFtsProjection(target.id);
      this.insertAudit({
        memoryId: target.id,
        action: 'resolve',
        actor: this.actorLabel(context),
        sourceEventId,
        idempotencyKey,
        decision: this.auditDecision(proposal),
        createdAt: now,
      });
      return {
        action: 'resolve',
        memoryId: target.id,
        status: 'resolved',
        detailVersion: Number(target.detail_version),
        fingerprint: target.fingerprint,
        idempotent: false,
      };
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('resolves');
    }
    return result;
  }

  expire(input: {
    context: MemoryRequestContext;
    memoryId: string;
    sourceEventId: string;
    idempotencyKey: string;
    expectedDetailVersion?: number;
    reason?: string;
  }): MemoryProposalResult {
    assertContext(input.context);
    const proposal = {
      action: 'resolve' as const,
      retention: 'short' as const,
      sourceEventId: requireText(input.sourceEventId, 'sourceEventId'),
      idempotencyKey: requireText(input.idempotencyKey, 'idempotencyKey'),
    };
    const audit = this.db.prepare(`
      SELECT memory_id FROM memory_audit
      WHERE action = 'expire' AND source_event_id = ? AND idempotency_key = ?
    `).get(proposal.sourceEventId, proposal.idempotencyKey) as { memory_id?: string } | undefined;
    if (audit?.memory_id) {
      const row = this.getMemoryRow(audit.memory_id);
      if (row) {
        recordMemoryV2IdempotentReplay();
        return { action: 'resolve', memoryId: row.id, status: row.status as MemoryProposalResult['status'], detailVersion: row.detail_version, fingerprint: row.fingerprint, idempotent: true };
      }
    }
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const target = this.requireMemoryRow(requireText(input.memoryId, 'memoryId'));
      this.assertOwned(target, input.context);
      if (input.expectedDetailVersion !== undefined && Number(input.expectedDetailVersion) !== Number(target.detail_version)) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'memory detail version is stale');
      }
      if (!['active', 'pending-review'].includes(target.status)) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'only active or pending-review memory can expire');
      }
      const now = this.clock();
      this.db.prepare(`
        UPDATE memory_items
        SET status = 'expired', updated_at = ?, source_event_id = ?, idempotency_key = ?
        WHERE id = ?
      `).run(now, now, proposal.sourceEventId, proposal.idempotencyKey, target.id);
      this.removeFtsProjection(target.id);
      this.insertAudit({
        memoryId: target.id,
        action: 'expire',
        actor: this.actorLabel(input.context),
        sourceEventId: proposal.sourceEventId,
        idempotencyKey: proposal.idempotencyKey,
        decision: { expectedDetailVersion: input.expectedDetailVersion },
        reason: text(input.reason) || undefined,
        createdAt: now,
      });
      return { action: 'resolve', memoryId: target.id, status: 'expired', detailVersion: target.detail_version, fingerprint: target.fingerprint, idempotent: false };
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('resolves');
    }
    return result;
  }

  /**
   * Global administration starts with the index/metadata projection. Detail
   * bodies are intentionally unavailable here and require readGovernanceDetails.
   */
  listGovernance(input: ListMemoryGovernanceInput): MemoryGovernanceListResult {
    this.assertReviewerContext(input.context);
    const statuses = this.normalizeGovernanceStatuses(input.statuses);
    const retentions = this.normalizeGovernanceRetentions(input.retentions);
    const ownerUserId = text(input.ownerUserId);
    const offset = clampNonNegativeInteger(input.offset, 0, Number.MAX_SAFE_INTEGER);
    const limit = clampInteger(input.limit, 100, 200);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (input.context.reviewAllWorkspaces !== true) {
      clauses.push('workspace_id = ?');
      params.push(input.context.workspaceId);
    }
    if (ownerUserId) {
      clauses.push('owner_user_id = ?');
      params.push(ownerUserId);
    }
    if (statuses.length) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (retentions.length) {
      clauses.push(`retention IN (${retentions.map(() => '?').join(', ')})`);
      params.push(...retentions);
    }
    const where = clauses.length ? clauses.join(' AND ') : '1 = 1';
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM memory_items WHERE ${where}`).get(...params) as { count?: number }).count ?? 0);
    const rows = this.db.prepare(`
      SELECT * FROM memory_items
      WHERE ${where}
      ORDER BY CASE status WHEN 'pending-review' THEN 0 ELSE 1 END, updated_at DESC, id ASC
      LIMIT ?
      OFFSET ?
    `).all(...params, limit, offset) as MemoryItemRow[];
    return {
      items: rows.map((row) => this.toGovernanceRecord(row)),
      total,
      pagination: {
        offset,
        limit,
        nextOffset: offset + rows.length < total ? offset + rows.length : null,
      },
    };
  }

  listGovernanceAudit(input: ListMemoryGovernanceAuditInput): MemoryGovernanceAuditRecord[] {
    this.assertReviewerContext(input.context);
    const memoryId = text(input.memoryId);
    const limit = clampInteger(input.limit, 200, 500);
    const workspaceClause = input.context.reviewAllWorkspaces === true ? '' : ' AND item.workspace_id = ?';
    const workspaceParams = input.context.reviewAllWorkspaces === true ? [] : [input.context.workspaceId];
    const rows = memoryId
      ? this.db.prepare(`
        SELECT audit.*
        FROM memory_audit audit
        JOIN memory_items item ON item.id = audit.memory_id
        WHERE audit.memory_id = ?${workspaceClause}
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT ?
      `).all(memoryId, ...workspaceParams, limit) as SqliteRow[]
      : this.db.prepare(`
        SELECT audit.*
        FROM memory_audit audit
        JOIN memory_items item ON item.id = audit.memory_id
        WHERE 1 = 1${workspaceClause}
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT ?
      `).all(...workspaceParams, limit) as SqliteRow[];
    return rows.map((row) => this.toGovernanceAuditRecord(row));
  }

  /** Reviewer-only, explicit, versioned detail access. It never mutates a detail revision. */
  readGovernanceDetails(input: ReadMemoryDetailsInput): MemoryDetailPage {
    this.assertReviewerContext(input.context);
    const memoryId = requireText(input.memoryId, 'memoryId');
    const detailVersion = requirePositiveInteger(input.detailVersion, 'detailVersion');
    const item = this.requireMemoryRow(memoryId);
    try {
      this.assertGovernanceWorkspace(item, input.context);
    } catch (error) {
      if (error instanceof MemoryServiceError && error.code === 'MEMORY_UNAUTHORIZED') {
        recordMemoryV2AuthorizationDenied('explicitReadDenied');
      }
      throw error;
    }
    if (detailVersion > Number(item.detail_version)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'requested detail revision is newer than memory item');
    }
    const detail = this.db.prepare(`
      SELECT memory_id, detail_version, details, detail_chars, content_hash,
        required_read_extract, required_read_extract_chars, required_read_extract_hash
      FROM memory_details WHERE memory_id = ? AND detail_version = ?
    `).get(memoryId, detailVersion) as MemoryDetailRow | undefined;
    if (!detail) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'memory detail revision was not found');
    const offset = parseCursor(input.cursor, detailVersion);
    const maxChars = clampInteger(input.maxChars, this.budgets.maxDetailReadChars, this.budgets.maxDetailReadChars);
    const details = detail.details.slice(offset, offset + maxChars);
    const nextOffset = offset + details.length;
    const complete = nextOffset >= detail.details.length;
    const now = this.clock();
    this.insertAudit({
      memoryId,
      action: 'read',
      actor: this.actorLabel(input.context),
      sourceEventId: `governance-read:${memoryId}:${detailVersion}:${now}`,
      idempotencyKey: randomUUID(),
      decision: { detailVersion, offset, chars: details.length, complete, reviewerRead: true },
      createdAt: now,
    });
    recordMemoryV2DetailReadTelemetry({ returnedChars: details.length });
    return {
      memoryId,
      detailVersion,
      details,
      detailChars: Number(detail.detail_chars),
      contentHash: detail.content_hash,
      cursor: input.cursor,
      nextCursor: complete ? undefined : cursorFor(detailVersion, nextOffset),
      complete,
    };
  }

  /**
   * Applies only server-authorized reviewer lifecycle changes. No action input
   * accepts a detail body or a replacement payload.
   */
  applyGovernanceAction(input: MemoryGovernanceActionInput): MemoryGovernanceActionResult {
    this.assertReviewerContext(input.context);
    const action = text(input.action);
    if (!GOVERNANCE_ACTION_SET.has(action)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance action is invalid');
    }
    const normalizedAction = action as MemoryGovernanceAction;
    const memoryId = requireText(input.memoryId, 'memoryId');
    requirePositiveInteger(input.expectedDetailVersion, 'expectedDetailVersion');
    const sourceEventId = requireText(input.sourceEventId, 'sourceEventId');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const existing = this.findGovernanceActionReplay(normalizedAction, memoryId, sourceEventId, idempotencyKey, input.context);
    if (existing) {
      recordMemoryV2IdempotentReplay();
      return existing;
    }

    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const replay = this.findGovernanceActionReplay(normalizedAction, memoryId, sourceEventId, idempotencyKey, input.context);
      if (replay) return replay;
      const target = this.requirePendingGovernanceTarget(input);
      const now = this.clock();
      const reason = text(input.reason) ? assertMaxChars(text(input.reason), 1_200, 'governance reason') : undefined;

      switch (normalizedAction) {
        case 'approve':
          this.updateGovernanceStatus(target.id, 'active', input, now);
          this.insertGovernanceAudit(input, target.id, now, { status: 'active', detailVersion: target.detail_version }, reason);
          return this.governanceActionResult(normalizedAction, target.id, 'active', target.detail_version, false);
        case 'reject':
          this.updateGovernanceStatus(target.id, 'rejected', input, now);
          this.insertGovernanceAudit(input, target.id, now, { status: 'rejected', detailVersion: target.detail_version }, reason);
          return this.governanceActionResult(normalizedAction, target.id, 'rejected', target.detail_version, false);
        case 'expire':
          this.updateGovernanceStatus(target.id, 'expired', input, now);
          this.insertGovernanceAudit(input, target.id, now, { status: 'expired', detailVersion: target.detail_version }, reason);
          return this.governanceActionResult(normalizedAction, target.id, 'expired', target.detail_version, false);
        case 'supersede': {
          const replacement = this.requireGovernanceReplacement(input.replacementMemoryId, target, input.context);
          this.updateGovernanceStatus(target.id, 'superseded', input, now);
          this.linkSupersession(replacement.id, target.id, now);
          this.insertGovernanceAudit(input, target.id, now, {
            status: 'superseded',
            detailVersion: target.detail_version,
            replacementMemoryId: replacement.id,
          }, reason);
          return this.governanceActionResult(normalizedAction, target.id, 'superseded', target.detail_version, false, this.rowToIndex(replacement));
        }
        case 'reclassify': {
          const replacement = this.reclassifyPendingLongMemory(input, target, now);
          this.insertGovernanceAudit(input, target.id, now, {
            status: 'superseded',
            detailVersion: target.detail_version,
            replacementMemoryId: replacement.memoryId,
            requestedRetention: 'short',
          }, reason);
          return this.governanceActionResult(normalizedAction, target.id, 'superseded', target.detail_version, false, replacement);
        }
      }
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('governanceActions');
      if (normalizedAction === 'reject') recordMemoryV2Write('rejected');
    }
    return result;
  }

  buildManifest(query: MemoryManifestQuery): MemoryManifest {
    assertContext(query.context);
    if (query.trigger === 'explicit-search') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'buildManifest cannot use explicit-search trigger');
    }
    const maxManifestChars = clampInteger(query.maxManifestChars, this.budgets.maxManifestChars, this.budgets.maxManifestChars);
    const candidates = this.selectActiveIndexRows();
    const matching: Array<{ item: MemoryManifestItem; chars: number; required: boolean; score: number }> = [];
    let preOmittedCount = 0;

    const addCandidate = (index: MemoryIndexRecord, delivery?: MemoryManifestItem['delivery']) => {
      const provisional: MemoryManifestItem = delivery ? { ...index, delivery } : index;
      let chars = 0;
      let item: MemoryManifestItem = { ...provisional, indexChars: chars };
      for (;;) {
        item = { ...provisional, indexChars: chars };
        const next = this.manifestItemChars(item);
        if (next === chars) break;
        chars = next;
      }
      if (chars > this.budgets.maxIndexItemChars) {
        if (index.handoff.mode === 'required-read') {
          recordMemoryV2RequiredReadBudgetFailure();
          throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read memory index exceeds the per-item manifest budget');
        }
        preOmittedCount += 1;
        return;
      }
      matching.push({
        item,
        chars,
        required: index.handoff.mode === 'required-read',
        score: this.manifestScore(index, delivery, query.queryText),
      });
    };

    for (const row of candidates) {
      if (!this.isReadable(row, query.context)) continue;
      const liveIndex = this.rowToIndex(row);
      const deliveries = this.listManifestDeliveries(liveIndex.memoryId, query.context, query.targetStepAttemptId);
      if (deliveries.length) {
        for (const match of deliveries) {
          const index = match.indexSnapshot
            ? this.indexFromHandoffSnapshot(match.indexSnapshot, row)
            : liveIndex;
          if (!this.readWhenMatches(index.readWhen, query.trigger, query.context, query.queryText)) continue;
          if (index.handoff.mode === 'none' || index.handoff.mode === 'on-demand') continue;
          addCandidate(index, match.delivery);
        }
        continue;
      }

      if (!this.readWhenMatches(liveIndex.readWhen, query.trigger, query.context, query.queryText)) continue;
      // Ordinary retrieval is only for records with no active delivery. Workflow
      // manifest and required-read records must use their frozen delivery targets.
      if (liveIndex.handoff.mode !== 'none') continue;
      addCandidate(liveIndex);
    }
    matching.sort((left, right) => right.score - left.score || left.item.memoryId.localeCompare(right.item.memoryId));
    const required = matching.filter((candidate) => candidate.required);
    const ordinary = matching.filter((candidate) => !candidate.required);
    const requiredBudget = Math.min(this.budgets.maxRequiredReadIndexChars, maxManifestChars);
    const requiredItems = required.map((candidate) => candidate.item);
    const requiredChars = this.manifestPayloadChars(requiredItems);
    if (requiredChars > requiredBudget || requiredChars > maxManifestChars) {
      recordMemoryV2RequiredReadBudgetFailure();
      throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read memory indexes exceed the reserved manifest budget');
    }
    const items = [...requiredItems];
    let usedChars = requiredChars;
    let omittedCount = preOmittedCount;
    for (const candidate of ordinary) {
      const nextItems = [...items, candidate.item];
      const nextChars = this.manifestPayloadChars(nextItems);
      if (nextChars > maxManifestChars) {
        omittedCount += 1;
        continue;
      }
      items.push(candidate.item);
      usedChars = nextChars;
    }
    const manifest: MemoryManifest = {
      items,
      requiredReadItems: required.map((candidate) => candidate.item),
      serializedChars: usedChars,
      omittedCount,
      requiredReadPreflight: 'ready',
    };
    recordMemoryV2ManifestTelemetry({
      returnedItems: manifest.items.length,
      omittedItems: manifest.omittedCount,
      serializedChars: manifest.serializedChars,
      maxItemChars: Math.max(0, ...manifest.items.map((item) => this.manifestItemChars(item))),
    });
    return manifest;
  }

  search(query: MemorySearchQuery): MemorySearchResult {
    assertContext(query.context);
    const phrase = requireText(query.query, 'search query');
    const maxIndexChars = clampInteger(query.maxIndexChars, this.budgets.maxSearchIndexChars, this.budgets.maxSearchIndexChars);
    const limit = clampInteger(query.limit, 50, 200);
    const ftsQuery = this.toFtsQuery(phrase);
    let rows: MemoryItemRow[] = [];
    try {
      rows = this.db.prepare(`
        SELECT item.*
        FROM memory_fts
        JOIN memory_items item ON item.id = memory_fts.memory_id
        WHERE memory_fts MATCH ?
          AND item.status = 'active'
          AND (item.expires_at IS NULL OR item.expires_at > ?)
        ORDER BY bm25(memory_fts), item.updated_at DESC, item.id ASC
        LIMIT ?
      `).all(ftsQuery, this.clock(), limit * 4) as MemoryItemRow[];
    } catch {
      rows = [];
    }
    const items: MemoryIndexRecord[] = [];
    let usedChars = this.searchPayloadChars(items);
    let omittedCount = 0;
    for (const row of rows) {
      if (!this.isReadable(row, query.context)) {
        recordMemoryV2AuthorizationDenied('searchDenied');
        continue;
      }
      const index = this.rowToIndex(row);
      if (!this.readWhenMatches(index.readWhen, 'explicit-search', query.context, phrase)) continue;
      const nextItems = [...items, index];
      const nextChars = this.searchPayloadChars(nextItems);
      if (items.length >= limit || nextChars > maxIndexChars) {
        omittedCount += 1;
        continue;
      }
      items.push(index);
      usedChars = nextChars;
    }
    const result = { items, serializedChars: usedChars, omittedCount };
    recordMemoryV2SearchTelemetry({
      returnedItems: result.items.length,
      omittedItems: result.omittedCount,
      serializedChars: result.serializedChars,
      maxItemChars: Math.max(0, ...result.items.map((item) => item.indexChars)),
    });
    return result;
  }

  readDetails(input: ReadMemoryDetailsInput): MemoryDetailPage {
    assertContext(input.context);
    const memoryId = requireText(input.memoryId, 'memoryId');
    const detailVersion = requirePositiveInteger(input.detailVersion, 'detailVersion');
    const item = this.requireMemoryRow(memoryId);
    if (!this.assertReadable(item, input.context)) {
      recordMemoryV2AuthorizationDenied('explicitReadDenied');
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'memory is not readable in the current server context');
    }
    if (detailVersion > Number(item.detail_version)) throw new MemoryServiceError('MEMORY_CONFLICT', 'requested detail revision is newer than memory item');
    const detail = this.db.prepare(`
      SELECT memory_id, detail_version, details, detail_chars, content_hash,
        required_read_extract, required_read_extract_chars, required_read_extract_hash
      FROM memory_details WHERE memory_id = ? AND detail_version = ?
    `).get(memoryId, detailVersion) as MemoryDetailRow | undefined;
    if (!detail) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'memory detail revision was not found');

    let handoff: { id: string; mode: string } | undefined;
    try {
      handoff = input.handoffId ? this.requireHandoffForRead(input, item, detail) : undefined;
    } catch (error) {
      if (error instanceof MemoryServiceError && error.code === 'MEMORY_UNAUTHORIZED') {
        recordMemoryV2AuthorizationDenied('explicitReadDenied');
      }
      throw error;
    }
    const requiresRequiredReadTarget = item.handoff_mode === 'required-read'
      || this.hasRequiredReadHandoff(memoryId, detailVersion);
    if (requiresRequiredReadTarget && handoff?.mode !== 'required-read') {
      recordMemoryV2AuthorizationDenied('explicitReadDenied');
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'required-read details require their persisted handoff target');
    }
    const now = this.clock();
    if (handoff?.mode === 'required-read') {
      const extract = detail.required_read_extract;
      const extractHash = detail.required_read_extract_hash;
      if (!extract || !extractHash) {
        recordMemoryV2BlockedRequiredRead();
        throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read extract is unavailable');
      }
      this.markRequiredRead({
        context: input.context,
        handoffId: handoff.id,
        targetStepAttemptId: requireText(input.targetStepAttemptId, 'targetStepAttemptId'),
        targetAgentId: requireText(input.context.agentId, 'context.agentId'),
        detailVersion,
        status: 'read',
        extractHash,
      }, now);
      this.insertAudit({
        memoryId,
        action: 'read',
        actor: this.actorLabel(input.context),
        sourceEventId: `read:${memoryId}:${detailVersion}:${now}`,
        idempotencyKey: randomUUID(),
        decision: { detailVersion, requiredRead: true, extractHash },
        createdAt: now,
      });
      recordMemoryV2DetailReadTelemetry({ returnedChars: extract.length, requiredRead: true });
      return {
        memoryId,
        detailVersion,
        details: extract,
        detailChars: Number(detail.detail_chars),
        contentHash: detail.content_hash,
        complete: true,
        requiredReadExtract: {
          extract,
          extractHash,
          extractChars: Number(detail.required_read_extract_chars ?? extract.length),
        },
      };
    }

    const offset = parseCursor(input.cursor, detailVersion);
    const maxChars = clampInteger(input.maxChars, this.budgets.maxDetailReadChars, this.budgets.maxDetailReadChars);
    const page = detail.details.slice(offset, offset + maxChars);
    const nextOffset = offset + page.length;
    const complete = nextOffset >= detail.details.length;
    this.insertAudit({
      memoryId,
      action: 'read',
      actor: this.actorLabel(input.context),
      sourceEventId: `read:${memoryId}:${detailVersion}:${now}`,
      idempotencyKey: randomUUID(),
      decision: { detailVersion, offset, chars: page.length, complete },
      createdAt: now,
    });
    recordMemoryV2DetailReadTelemetry({ returnedChars: page.length });
    return {
      memoryId,
      detailVersion,
      details: page,
      detailChars: Number(detail.detail_chars),
      contentHash: detail.content_hash,
      cursor: input.cursor,
      nextCursor: complete ? undefined : cursorFor(detailVersion, nextOffset),
      complete,
    };
  }

  completeHandoffBatch(input: CompleteHandoffBatchInput): MemoryHandoffBatchRecord {
    assertContext(input.context);
    const runId = requireText(input.runId, 'runId');
    const sourceStepAttemptId = requireText(input.sourceStepAttemptId, 'sourceStepAttemptId');
    const sourceEventId = requireText(input.sourceEventId, 'sourceEventId');
    const status = text(input.status);
    if (!BATCH_STATUS_SET.has(status)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff batch status is invalid');
    const batchStatus = status as MemoryHandoffBatchStatus;
    if (input.context.runId !== runId) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff batch run must match server context');
    if (input.context.stepAttemptId !== sourceStepAttemptId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff batch source step must match server context');
    }
    this.assertRunParticipant(input.context, runId);
    const deliveries = this.normalizeDeliveries(input.deliveries);
    const parentRunId = text(input.parentRunId) || undefined;
    const parentStepAttemptId = text(input.parentStepAttemptId) || undefined;
    if (Boolean(parentRunId) !== Boolean(parentStepAttemptId)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'parent run and parent step attempt must be supplied together');
    }
    return withMemoryV2ImmediateTransaction(this.db, () => {
      const existing = this.db.prepare(`
        SELECT * FROM memory_handoff_batches WHERE run_id = ? AND source_step_attempt_id = ?
      `).get(runId, sourceStepAttemptId) as SqliteRow | undefined;
      if (existing) {
        const existingRecord = this.rowToBatch(existing);
        if (
          existingRecord.sourceEventId !== sourceEventId
          || existingRecord.parentRunId !== parentRunId
          || existingRecord.parentStepAttemptId !== parentStepAttemptId
        ) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff batch retry changed immutable source provenance');
        }
        if (existingRecord.status === batchStatus) {
          this.assertBatchDeliveryEquals(existingRecord.id, deliveries);
          return existingRecord;
        }
        this.assertBatchDeliveryShape(batchStatus, deliveries);
        this.assertBatchStatusTransition(existingRecord.status, batchStatus);
        this.assertBatchHasNoDeliveries(existingRecord.id);
        const now = this.clock();
        if (batchStatus === 'emitted') {
          for (const delivery of deliveries) this.insertHandoffDelivery(existingRecord.id, delivery, input.context, now);
        }
        this.db.prepare(`
          UPDATE memory_handoff_batches
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(batchStatus, now, existingRecord.id);
        this.insertAudit({
          action: 'handoff',
          actor: this.actorLabel(input.context),
          sourceEventId,
          idempotencyKey: `batch-transition:${existingRecord.id}:${existingRecord.status}:${batchStatus}:${randomUUID()}`,
          decision: {
            runId,
            sourceStepAttemptId,
            previousStatus: existingRecord.status,
            status: batchStatus,
            deliveryMemoryIds: deliveries.map((delivery) => delivery.memoryId),
          },
          createdAt: now,
        });
        return this.rowToBatch(this.db.prepare('SELECT * FROM memory_handoff_batches WHERE id = ?').get(existingRecord.id) as SqliteRow);
      }
      this.assertBatchDeliveryShape(batchStatus, deliveries);
      const now = this.clock();
      const batchId = randomUUID();
      this.db.prepare(`
        INSERT INTO memory_handoff_batches (
          id, run_id, source_step_attempt_id, source_event_id, status,
          parent_run_id, parent_step_attempt_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batchId,
        runId,
        sourceStepAttemptId,
        sourceEventId,
        batchStatus,
        parentRunId ?? null,
        parentStepAttemptId ?? null,
        now,
        now,
      );
      for (const delivery of deliveries) this.insertHandoffDelivery(batchId, delivery, input.context, now);
      this.insertAudit({
        action: 'handoff',
        actor: this.actorLabel(input.context),
        sourceEventId,
        idempotencyKey: `batch:${sourceStepAttemptId}`,
        decision: { runId, sourceStepAttemptId, previousStatus: undefined, status: batchStatus, deliveryMemoryIds: deliveries.map((delivery) => delivery.memoryId) },
        createdAt: now,
      });
      return {
        id: batchId,
        runId,
        sourceStepAttemptId,
        sourceEventId,
        status: batchStatus,
        parentRunId,
        parentStepAttemptId,
        createdAt: now,
        updatedAt: now,
      };
    });
  }

  emitResolvedHandoffBatch(input: EmitResolvedHandoffBatchInput): EmitResolvedHandoffBatchResult {
    assertContext(input.context);
    const runId = requireText(input.runId, 'runId');
    const sourceStepAttemptId = requireText(input.sourceStepAttemptId, 'sourceStepAttemptId');
    const sourceEventId = requireText(input.sourceEventId, 'sourceEventId');
    if (input.context.runId !== runId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff batch run must match server context');
    }
    if (input.context.stepAttemptId !== sourceStepAttemptId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff batch source step must match server context');
    }
    const deliveries = this.normalizeResolvedHandoffDeliveries(input.deliveries);
    const targetPlan = this.normalizeServerHandoffTargetPlan(input.nextTarget, input.candidateTargets);

    let replayed = false;
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      this.assertRunParticipant(input.context, runId);
      const existing = this.db.prepare(`
        SELECT * FROM memory_handoff_batches WHERE run_id = ? AND source_step_attempt_id = ?
      `).get(runId, sourceStepAttemptId) as SqliteRow | undefined;
      let retryingBatch: MemoryHandoffBatchRecord | undefined;
      if (existing) {
        const batch = this.rowToBatch(existing);
        if (batch.sourceEventId !== sourceEventId) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff batch retry changed immutable source provenance');
        }
        if (batch.status === 'emitted') {
          const handoffs = this.listBatchHandoffRecords(batch.id);
          this.assertResolvedHandoffBatchReplay(handoffs, deliveries, targetPlan);
          replayed = true;
          return { batch, handoffs };
        }
        if (batch.status !== 'retrying') {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff batch can replay only an emitted batch');
        }
        if (batch.parentRunId || batch.parentStepAttemptId) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'retrying handoff batch provenance does not match atomic resolved emission');
        }
        this.assertBatchHasNoDeliveries(batch.id);
        this.assertBatchStatusTransition(batch.status, 'emitted');
        retryingBatch = batch;
      }

      // Every database-backed authorization and frozen-detail check completes
      // before the transaction writes the batch or any dependent row.
      const preparedDeliveries = this.prepareResolvedHandoffDeliveries(deliveries, targetPlan, input.context, runId);
      const now = this.clock();
      const batchId = retryingBatch?.id ?? randomUUID();
      if (retryingBatch) {
        this.db.prepare(`
          UPDATE memory_handoff_batches
          SET status = 'emitted', updated_at = ?
          WHERE id = ?
        `).run(now, batchId);
      } else {
        this.db.prepare(`
          INSERT INTO memory_handoff_batches (
            id, run_id, source_step_attempt_id, source_event_id, status,
            parent_run_id, parent_step_attempt_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'emitted', NULL, NULL, ?, ?)
        `).run(batchId, runId, sourceStepAttemptId, sourceEventId, now, now);
      }

      const handoffIds = preparedDeliveries.map((delivery) => this.insertResolvedHandoffDelivery(
        batchId,
        delivery,
        input.context,
        runId,
        sourceEventId,
        now,
      ));
      this.insertAudit({
        action: 'handoff',
        actor: this.actorLabel(input.context),
        sourceEventId,
        idempotencyKey: `resolved-batch:${sourceStepAttemptId}`,
        decision: {
          runId,
          sourceStepAttemptId,
          previousStatus: retryingBatch?.status,
          status: 'emitted',
          deliveries: preparedDeliveries.map((delivery) => ({
            memoryId: delivery.memory.id,
            detailVersion: delivery.index.detailVersion,
            mode: delivery.selector.mode,
            target: delivery.selector.target,
          })),
        },
        createdAt: now,
      });

      const batch = this.rowToBatch(this.db.prepare(
        'SELECT * FROM memory_handoff_batches WHERE id = ?',
      ).get(batchId) as SqliteRow);
      return {
        batch,
        handoffs: handoffIds.map((handoffId) => this.getHandoffRecord(handoffId)!),
      };
    });
    if (replayed) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2HandoffBatchEmitted();
      for (const handoff of result.handoffs) {
        if (handoff.mode !== 'required-read') continue;
        for (let targetIndex = 0; targetIndex < handoff.resolvedTargets.length; targetIndex += 1) {
          recordMemoryV2ReceiptStatus('pending');
        }
      }
    }
    return result;
  }

  reissueResolvedHandoffTargetsForRetry(
    input: ReissueResolvedHandoffTargetsForRetryInput,
  ): ReissueResolvedHandoffTargetsForRetryResult {
    assertContext(input.context);
    const runId = requireText(input.runId, 'runId');
    const previousTargetStepAttemptId = requireText(input.previousTargetStepAttemptId, 'previousTargetStepAttemptId');
    const retryTarget = this.normalizeResolvedHandoffTarget(input.retryTarget);
    if (input.context.actor !== 'system' || text(input.context.actorId) !== 'workflow-memory-v2') {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'only the workflow memory scheduler can reissue a handoff target');
    }
    if (input.context.runId !== runId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff retry run must match server context');
    }
    if (retryTarget.targetStepAttemptId === previousTargetStepAttemptId) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'retry target step attempt must differ from the previous target');
    }

    let pendingReceiptCount = 0;
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      this.assertRunParticipant(input.context, runId);
      this.assertRunParticipant({ ...input.context, agentId: retryTarget.targetAgentId }, runId);

      const handoffRows = this.db.prepare(`
        SELECT handoff.*
        FROM memory_handoffs handoff
        JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
        JOIN memory_handoff_targets target ON target.handoff_id = handoff.id
        WHERE batch.run_id = ? AND batch.status = 'emitted'
          AND handoff.status = 'resolved' AND target.status = 'resolved'
          AND target.target_step_attempt_id = ?
        ORDER BY handoff.created_at ASC, handoff.id ASC
      `).all(runId, previousTargetStepAttemptId) as PersistedHandoffRow[];
      if (!handoffRows.length) return { handoffs: [], receipts: [] };

      // Validate every frozen selector, authorization boundary, existing retry
      // address, and required-read extract before adding a single retry target.
      const prepared = handoffRows.map((handoff) => this.prepareRetryHandoff(
        handoff,
        retryTarget,
        input.context,
        runId,
      ));
      const now = this.clock();
      for (const item of prepared) {
        if (!item.needsTargetInsert) continue;
        this.db.prepare(`
          INSERT INTO memory_handoff_targets (
            id, handoff_id, target_step_attempt_id, target_agent_id, status, resolved_at
          ) VALUES (?, ?, ?, ?, 'resolved', ?)
        `).run(
          randomUUID(),
          item.handoff.id,
          retryTarget.targetStepAttemptId,
          retryTarget.targetAgentId,
          now,
        );
        if (item.handoff.mode === 'required-read') {
          this.db.prepare(`
            INSERT INTO memory_handoff_receipts (
              id, handoff_id, target_step_attempt_id, target_agent_id, detail_version,
              extract_hash, status, failure_code, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
          `).run(
            randomUUID(),
            item.handoff.id,
            retryTarget.targetStepAttemptId,
            retryTarget.targetAgentId,
            item.handoff.detail_version,
            item.requiredReadExtractHash!,
            now,
            now,
          );
          pendingReceiptCount += 1;
        }
        const targets = this.listHandoffTargets(item.handoff.id);
        this.db.prepare(`
          UPDATE memory_handoffs
          SET resolved_targets_json = ?, updated_at = ?
          WHERE id = ?
        `).run(stableJson(targets), now, item.handoff.id);
        this.insertAudit({
          memoryId: item.handoff.memory_id,
          action: 'handoff',
          actor: this.actorLabel(input.context),
          sourceEventId: `handoff-retry:${item.handoff.id}:${retryTarget.targetStepAttemptId}:${now}`,
          idempotencyKey: randomUUID(),
          decision: {
            handoffId: item.handoff.id,
            previousTargetStepAttemptId,
            retryTargetStepAttemptId: retryTarget.targetStepAttemptId,
            retryTargetAgentId: retryTarget.targetAgentId,
            detailVersion: item.handoff.detail_version,
          },
          createdAt: now,
        });
      }

      const handoffs = prepared.map((item) => this.getHandoffRecord(item.handoff.id)!);
      const receipts = prepared.flatMap((item) => {
        if (item.handoff.mode !== 'required-read') return [];
        const receipt = this.db.prepare(`
          SELECT * FROM memory_handoff_receipts
          WHERE handoff_id = ? AND target_step_attempt_id = ? AND detail_version = ?
        `).get(
          item.handoff.id,
          retryTarget.targetStepAttemptId,
          item.handoff.detail_version,
        ) as SqliteRow | undefined;
        return receipt ? [this.rowToReceipt(receipt)] : [];
      });
      return { handoffs, receipts };
    });
    for (let index = 0; index < pendingReceiptCount; index += 1) {
      recordMemoryV2ReceiptStatus('pending');
    }
    return result;
  }

  resolveHandoffTargets(input: ResolveHandoffTargetsInput): MemoryHandoffRecord {
    assertContext(input.context);
    const handoffId = requireText(input.handoffId, 'handoffId');
    if (!Array.isArray(input.targets) || !input.targets.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff targets must be a non-empty array');
    }
    return withMemoryV2ImmediateTransaction(this.db, () => {
      const handoff = this.requireHandoffRow(handoffId);
      const batch = this.requireBatchForHandoff(handoffId);
      if (input.context.runId !== batch.run_id) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff target resolution run does not match context');
      this.assertRunParticipant(input.context, batch.run_id);
      if (batch.status !== 'emitted') throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff targets require an emitted batch');
      if (!['pending', 'resolved'].includes(String(handoff.status))) throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff cannot receive targets in its current state');
      const target = parseJson<MemoryHandoff>(handoff.target_selector_json, { mode: 'none', target: 'none' });
      const normalizedTargets = input.targets.map((item) => ({
        targetStepAttemptId: requireText(item.targetStepAttemptId, 'targetStepAttemptId'),
        targetAgentId: requireText(item.targetAgentId, 'targetAgentId'),
        stepId: text(item.stepId) || undefined,
        workflowState: text(item.workflowState) || undefined,
        stepTags: uniqueStrings(item.stepTags, 64, 160),
      }));
      if (new Set(normalizedTargets.map((item) => item.targetStepAttemptId)).size !== normalizedTargets.length) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff target step attempts must be unique');
      }
      if (handoff.status === 'resolved') {
        const existingTargets = this.listHandoffTargets(handoffId);
        const requested = normalizedTargets
          .map((item) => `${item.targetStepAttemptId}\n${item.targetAgentId}`)
          .sort();
        const existing = existingTargets
          .map((item) => `${item.targetStepAttemptId}\n${item.targetAgentId}`)
          .sort();
        if (requested.length !== existing.length || requested.some((item, index) => item !== existing[index])) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff targets are immutable');
        }
        return this.getHandoffRecord(handoffId)!;
      }
      if (target.target === 'none') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'a persisted handoff requires a concrete target selector');
      }
      if (target.target === 'next-step' && normalizedTargets.length !== 1) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'next-step handoff must resolve exactly one target step attempt');
      }
      if (target.target === 'matching-steps') {
        for (const item of normalizedTargets) {
          if (target.stepIds?.length && (!item.stepId || !target.stepIds.includes(item.stepId))) {
            throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required step ID');
          }
          if (target.workflowStates?.length && (!item.workflowState || !target.workflowStates.includes(item.workflowState))) {
            throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required workflow state');
          }
          if (target.stepTags?.length && !target.stepTags.some((tag) => item.stepTags.includes(tag))) {
            throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required step tags');
          }
        }
      }
      for (const item of normalizedTargets) {
        if (target.target === 'named-agents' && !target.agentIds?.includes(item.targetAgentId)) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target is not named by the memory contract');
        }
        this.assertRunParticipant({ ...input.context, agentId: item.targetAgentId }, batch.run_id);
      }
      const now = this.clock();
      const currentDetail = this.db.prepare(`
        SELECT required_read_extract_hash FROM memory_details
        WHERE memory_id = ? AND detail_version = ?
      `).get(handoff.memory_id, handoff.detail_version) as { required_read_extract_hash?: string | null } | undefined;
      const insertTarget = this.db.prepare(`
        INSERT INTO memory_handoff_targets (
          id, handoff_id, target_step_attempt_id, target_agent_id, status, resolved_at
        ) VALUES (?, ?, ?, ?, 'resolved', ?)
        ON CONFLICT(handoff_id, target_step_attempt_id) DO NOTHING
      `);
      const insertReceipt = this.db.prepare(`
        INSERT INTO memory_handoff_receipts (
          id, handoff_id, target_step_attempt_id, target_agent_id, detail_version,
          extract_hash, status, failure_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
        ON CONFLICT(handoff_id, target_step_attempt_id, detail_version) DO NOTHING
      `);
      for (const item of normalizedTargets) {
        const existingTarget = this.db.prepare(`
          SELECT target_agent_id FROM memory_handoff_targets
          WHERE handoff_id = ? AND target_step_attempt_id = ?
        `).get(handoffId, item.targetStepAttemptId) as { target_agent_id?: string } | undefined;
        if (existingTarget && existingTarget.target_agent_id !== item.targetAgentId) {
          throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff target step attempt was already resolved to another agent');
        }
        insertTarget.run(randomUUID(), handoffId, item.targetStepAttemptId, item.targetAgentId, now);
        if (handoff.mode === 'required-read') {
          const extractHash = text(currentDetail?.required_read_extract_hash);
          if (!extractHash) throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read handoff has no versioned extract');
          insertReceipt.run(randomUUID(), handoffId, item.targetStepAttemptId, item.targetAgentId, handoff.detail_version, extractHash, now, now);
        }
      }
      const targets = this.listHandoffTargets(handoffId);
      this.db.prepare(`
        UPDATE memory_handoffs
        SET resolved_targets_json = ?, status = 'resolved', updated_at = ?
        WHERE id = ?
      `).run(stableJson(targets), now, handoffId);
      this.insertAudit({
        memoryId: handoff.memory_id,
        action: 'handoff',
        actor: this.actorLabel(input.context),
        sourceEventId: `handoff-targets:${handoffId}:${now}`,
        idempotencyKey: randomUUID(),
        decision: { handoffId, targets },
        createdAt: now,
      });
      return this.getHandoffRecord(handoffId)!;
    });
  }

  recordHandoffReceipt(input: RecordHandoffReceiptInput): MemoryHandoffReceiptRecord {
    assertContext(input.context);
    const now = this.clock();
    return withMemoryV2ImmediateTransaction(this.db, () => this.markRequiredRead(input, now));
  }

  acknowledgeRequiredRead(input: AcknowledgeRequiredReadInput): MemoryHandoffReceiptRecord {
    assertContext(input.context);
    const now = this.clock();
    return withMemoryV2ImmediateTransaction(this.db, () => {
      const handoff = this.requireHandoffRow(requireText(input.handoffId, 'handoffId'));
      if (handoff.mode !== 'required-read') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'only required-read handoffs can be acknowledged');
      this.assertHandoffTargetContext(input.context, handoff.id, input.targetStepAttemptId, input.targetAgentId);
      if (Number(input.detailVersion) !== Number(handoff.detail_version)) throw new MemoryServiceError('MEMORY_CONFLICT', 'required-read detail revision is stale');
      const detail = this.db.prepare(`
        SELECT required_read_extract_hash FROM memory_details WHERE memory_id = ? AND detail_version = ?
      `).get(handoff.memory_id, handoff.detail_version) as { required_read_extract_hash?: string | null } | undefined;
      const extractHash = requireText(input.extractHash, 'extractHash');
      if (!detail?.required_read_extract_hash || detail.required_read_extract_hash !== extractHash) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'required-read extract hash does not match the persisted detail revision');
      }
      const receipt = this.requireReceipt(handoff.id, input.targetStepAttemptId, handoff.detail_version);
      if (receipt.status === 'acknowledged') return this.rowToReceipt(receipt);
      if (receipt.status !== 'read') {
        recordMemoryV2BlockedRequiredRead();
        throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read must be read before acknowledgement');
      }
      this.db.prepare(`
        UPDATE memory_handoff_receipts
        SET status = 'acknowledged', extract_hash = ?, failure_code = NULL, updated_at = ?
        WHERE id = ?
      `).run(extractHash, now, receipt.id);
      this.insertAudit({
        memoryId: handoff.memory_id,
        action: 'receipt',
        actor: this.actorLabel(input.context),
        sourceEventId: `receipt:${handoff.id}:${input.targetStepAttemptId}:${now}`,
        idempotencyKey: randomUUID(),
        decision: { handoffId: handoff.id, targetStepAttemptId: input.targetStepAttemptId, status: 'acknowledged', detailVersion: handoff.detail_version },
        createdAt: now,
      });
      recordMemoryV2ReceiptStatus('acknowledged');
      return this.rowToReceipt(this.db.prepare('SELECT * FROM memory_handoff_receipts WHERE id = ?').get(receipt.id) as SqliteRow);
    });
  }

  getRequiredReadStatus(input: {
    context: MemoryRequestContext;
    targetStepAttemptId: string;
  }): { receipts: MemoryHandoffReceiptRecord[]; blocked: boolean } {
    assertContext(input.context);
    const targetStepAttemptId = requireText(input.targetStepAttemptId, 'targetStepAttemptId');
    const agentId = requireText(input.context.agentId, 'context.agentId');
    const runId = requireText(input.context.runId, 'context.runId');
    this.assertRunParticipant(input.context, runId);
    const rows = this.db.prepare(`
      SELECT receipt.*
      FROM memory_handoff_receipts receipt
      JOIN memory_handoffs handoff ON handoff.id = receipt.handoff_id
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      WHERE receipt.target_step_attempt_id = ? AND receipt.target_agent_id = ?
        AND handoff.mode = 'required-read' AND handoff.status = 'resolved'
        AND batch.run_id = ? AND batch.status = 'emitted'
      ORDER BY receipt.created_at ASC, receipt.id ASC
    `).all(targetStepAttemptId, agentId, runId) as SqliteRow[];
    const receipts = rows.map((row) => this.rowToReceipt(row));
    return { receipts, blocked: receipts.some((receipt) => receipt.status !== 'acknowledged') };
  }

  /**
   * Builds the smallest possible server-owned context for an ACL-authorized
   * workflow handoff inspection route. The route never accepts owner,
   * workspace, or agent identity from the browser.
   */
  createServerHandoffRunReadContext(runId: string): {
    context: MemoryRequestContext;
  } | undefined {
    const normalizedRunId = requireText(runId, 'runId');
    const rows = this.db.prepare(`
      SELECT agent_id, owner_user_id, workspace_id
      FROM run_participants
      WHERE run_id = ? AND revoked_at IS NULL
      ORDER BY agent_id ASC
    `).all(normalizedRunId) as Array<{
      agent_id?: unknown;
      owner_user_id?: unknown;
      workspace_id?: unknown;
    }>;
    if (!rows.length) return undefined;

    const ownerUserId = text(rows[0].owner_user_id);
    const workspaceId = text(rows[0].workspace_id);
    if (!ownerUserId || !workspaceId || rows.some((row) => (
      text(row.owner_user_id) !== ownerUserId || text(row.workspace_id) !== workspaceId
    ))) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'run participant snapshot has inconsistent owner or workspace provenance');
    }

    const participantAgentIds = uniqueStrings(rows.map((row) => row.agent_id), 128, 320);
    if (!participantAgentIds.length) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'run participant snapshot has no active participant');
    }
    return {
      context: {
        ownerUserId,
        workspaceId,
        actor: 'system',
        actorId: 'memory-v2-workflow-handoff-route',
        agentId: participantAgentIds[0],
        runId: normalizedRunId,
        authorizedAgentIds: participantAgentIds,
        authorizedRunIds: [normalizedRunId],
      },
    };
  }

  listHandoffRunState(context: MemoryRequestContext, runId: string): MemoryHandoffRunState {
    assertContext(context);
    const normalizedRunId = requireText(runId, 'runId');
    if (context.runId !== normalizedRunId) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'run state must match server context');
    this.assertRunParticipant(context, normalizedRunId);
    const batches = this.db.prepare(`
      SELECT * FROM memory_handoff_batches WHERE run_id = ? ORDER BY created_at ASC, id ASC
    `).all(normalizedRunId) as SqliteRow[];
    const handoffs = this.db.prepare(`
      SELECT handoff.*
      FROM memory_handoffs handoff
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      WHERE batch.run_id = ?
      ORDER BY handoff.created_at ASC, handoff.id ASC
    `).all(normalizedRunId) as SqliteRow[];
    const receipts = this.db.prepare(`
      SELECT receipt.*
      FROM memory_handoff_receipts receipt
      JOIN memory_handoffs handoff ON handoff.id = receipt.handoff_id
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      WHERE batch.run_id = ?
      ORDER BY receipt.created_at ASC, receipt.id ASC
    `).all(normalizedRunId) as SqliteRow[];
    const state = {
      batches: batches.map((row) => this.rowToBatch(row)),
      handoffs: handoffs.map((row) => this.rowToHandoff(row)),
      receipts: receipts.map((row) => this.rowToReceipt(row)),
    };
    recordMemoryV2RunStateReconstruction();
    return state;
  }

  recordArtifactRef(input: MemoryArtifactRefInput): MemoryArtifactRef {
    assertContext(input.context);
    const memoryId = requireText(input.memoryId, 'memoryId');
    const detailVersion = requirePositiveInteger(input.detailVersion, 'detailVersion');
    const runId = requireText(input.runId, 'runId');
    if (input.context.runId !== runId) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'artifact run must match server context');
    this.assertRunParticipant(input.context, runId);
    const artifactKind = requireText(input.artifactKind, 'artifactKind');
    if (!ARTIFACT_KIND_SET.has(artifactKind)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'artifact kind is invalid');
    const relativePath = this.normalizeArtifactPath(input.relativePath);
    const contentHash = requireSha256(input.contentHash, 'contentHash');
    const memory = this.requireMemoryRow(memoryId);
    this.assertReadable(memory, input.context, true);
    const detail = this.db.prepare('SELECT 1 FROM memory_details WHERE memory_id = ? AND detail_version = ?').get(memoryId, detailVersion);
    if (!detail) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'detail revision was not found for artifact reference');
    const createdAt = normalizeIsoDate(input.createdAt, 'artifact.createdAt') ?? this.clock();
    return withMemoryV2ImmediateTransaction(this.db, () => {
      const existing = this.db.prepare(`
        SELECT * FROM memory_artifact_refs
        WHERE memory_id = ? AND detail_version = ? AND run_id = ? AND artifact_kind = ? AND relative_path = ? AND content_hash = ?
      `).get(memoryId, detailVersion, runId, artifactKind, relativePath, contentHash) as SqliteRow | undefined;
      if (existing) return this.rowToArtifactRef(existing);
      const id = randomUUID();
      this.db.prepare(`
        INSERT INTO memory_artifact_refs (
          id, memory_id, detail_version, run_id, artifact_kind, relative_path, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, memoryId, detailVersion, runId, artifactKind, relativePath, contentHash, createdAt);
      return { id, memoryId, detailVersion, runId, artifactKind: artifactKind as MemoryArtifactRef['artifactKind'], relativePath, contentHash, createdAt };
    });
  }

  private assertCaptureEnabled(context: MemoryRequestContext): void {
    if (context.actor === 'ai' && context.captureEnabled !== true) {
      throw new MemoryServiceError('MEMORY_CAPTURE_DISABLED', 'Memory V2 capture is disabled by the server policy');
    }
  }

  private assertReviewerContext(context: MemoryRequestContext): void {
    assertContext(context);
    if (context.actor !== 'reviewer' || !text(context.actorId)) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'memory governance requires a server-derived reviewer context');
    }
  }

  private assertGovernanceWorkspace(item: MemoryItemRow, context: MemoryRequestContext): void {
    if (context.reviewAllWorkspaces !== true && item.workspace_id !== context.workspaceId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'memory is outside the reviewer workspace');
    }
  }

  private normalizeGovernanceStatuses(input: ListMemoryGovernanceInput['statuses']): MemoryItemStatus[] {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance statuses must be an array');
    const values = uniqueStrings(input, 8, 64);
    if (values.length !== input.length || values.some((value) => !PERSISTED_STATUSES.has(value))) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance statuses contain an invalid value');
    }
    return values as MemoryItemStatus[];
  }

  private normalizeGovernanceRetentions(input: ListMemoryGovernanceInput['retentions']): PersistedMemoryRetention[] {
    if (input === undefined) return [];
    if (!Array.isArray(input)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance retentions must be an array');
    const values = uniqueStrings(input, 2, 16);
    if (values.length !== input.length || values.some((value) => value !== 'short' && value !== 'long')) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance retentions contain an invalid value');
    }
    return values as PersistedMemoryRetention[];
  }

  private toGovernanceRecord(row: MemoryItemRow): MemoryGovernanceRecord {
    const detail = this.db.prepare(`
      SELECT detail_chars FROM memory_details
      WHERE memory_id = ? AND detail_version = ?
    `).get(row.id, row.detail_version) as { detail_chars?: number } | undefined;
    if (!detail) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'current memory detail is missing');
    return {
      index: this.rowToIndex(row),
      governanceMode: GOVERNANCE_SET.has(row.governance_mode) ? row.governance_mode : 'review',
      detailChars: Number(detail.detail_chars ?? 0),
      scopeBindings: this.listGovernanceScopeBindings(row.id),
      handoffState: this.governanceHandoffState(row),
    };
  }

  private listGovernanceScopeBindings(memoryId: string): MemoryGovernanceScopeBinding[] {
    return (this.db.prepare(`
      SELECT scope_type, scope_key, binding_role, visibility
      FROM memory_scope_bindings
      WHERE memory_id = ?
      ORDER BY binding_role ASC, scope_type ASC, scope_key ASC
    `).all(memoryId) as Array<SqliteRow>).flatMap((row) => {
      const scopeType = text(row.scope_type);
      const scopeKey = text(row.scope_key);
      const role = text(row.binding_role);
      const visibility = text(row.visibility);
      if (!SCOPE_SET.has(scopeType) || !scopeKey
        || (role !== 'lifecycle-anchor' && role !== 'relevance')
        || !['private', 'workspace', 'workflow-participant', 'channel-member'].includes(visibility)) {
        return [];
      }
      return [{
        scopeType: scopeType as MemoryGovernanceScopeBinding['scopeType'],
        scopeKey,
        role: role as MemoryGovernanceScopeBinding['role'],
        visibility: visibility as MemoryGovernanceScopeBinding['visibility'],
      }];
    });
  }

  private governanceHandoffState(item: MemoryItemRow): MemoryGovernanceHandoffState {
    const row = this.db.prepare(`
      SELECT
        COUNT(DISTINCT handoff.id) AS handoff_count,
        COUNT(DISTINCT target.id) AS target_count,
        COUNT(DISTINCT CASE WHEN participant.agent_id IS NOT NULL THEN target.id END) AS authorized_target_count,
        COUNT(DISTINCT receipt.id) AS receipt_total,
        COUNT(DISTINCT CASE WHEN receipt.status = 'pending' THEN receipt.id END) AS receipt_pending,
        COUNT(DISTINCT CASE WHEN receipt.status = 'read' THEN receipt.id END) AS receipt_read,
        COUNT(DISTINCT CASE WHEN receipt.status = 'acknowledged' THEN receipt.id END) AS receipt_acknowledged,
        COUNT(DISTINCT CASE WHEN receipt.status = 'failed' THEN receipt.id END) AS receipt_failed,
        COUNT(DISTINCT CASE WHEN receipt.status = 'cancelled' THEN receipt.id END) AS receipt_cancelled,
        COUNT(DISTINCT CASE WHEN receipt.status = 'retrying' THEN receipt.id END) AS receipt_retrying
      FROM memory_handoffs handoff
      LEFT JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      LEFT JOIN memory_handoff_targets target ON target.handoff_id = handoff.id
      LEFT JOIN run_participants participant
        ON participant.run_id = batch.run_id
        AND participant.agent_id = target.target_agent_id
        AND participant.owner_user_id = ?
        AND participant.workspace_id = ?
        AND participant.revoked_at IS NULL
      LEFT JOIN memory_handoff_receipts receipt ON receipt.handoff_id = handoff.id
      WHERE handoff.memory_id = ?
    `).get(item.owner_user_id, item.workspace_id, item.id) as Record<string, unknown> | undefined;
    const count = (key: string) => Math.max(0, Number(row?.[key] ?? 0) || 0);
    const targetCount = count('target_count');
    const authorizedTargetCount = count('authorized_target_count');
    return {
      handoffCount: count('handoff_count'),
      targetCount,
      authorizedTargetCount,
      unauthorizedTargetCount: Math.max(0, targetCount - authorizedTargetCount),
      receipts: {
        total: count('receipt_total'),
        pending: count('receipt_pending'),
        read: count('receipt_read'),
        acknowledged: count('receipt_acknowledged'),
        failed: count('receipt_failed'),
        cancelled: count('receipt_cancelled'),
        retrying: count('receipt_retrying'),
      },
    };
  }

  private toGovernanceAuditRecord(row: SqliteRow): MemoryGovernanceAuditRecord {
    const decision = parseJson<Record<string, unknown>>(row.decision_json, {});
    const retention = text(decision.retention);
    const status = text(decision.status);
    const requestedRetention = text(decision.requestedRetention);
    const detailVersion = Number(decision.detailVersion);
    const metadata: MemoryGovernanceAuditMetadata = {
      ...(retention === 'short' || retention === 'long' ? { retention } : {}),
      ...(Number.isInteger(detailVersion) && detailVersion > 0 ? { detailVersion } : {}),
      ...(PERSISTED_STATUSES.has(status) ? { status: status as MemoryItemStatus } : {}),
      ...(text(decision.targetMemoryId) ? { targetMemoryId: text(decision.targetMemoryId) } : {}),
      ...(text(decision.replacementMemoryId) ? { replacementMemoryId: text(decision.replacementMemoryId) } : {}),
      ...(requestedRetention === 'short' || requestedRetention === 'long'
        ? { requestedRetention: requestedRetention as PersistedMemoryRetention }
        : {}),
    };
    const action = text(row.action);
    return {
      id: String(row.id),
      memoryId: text(row.memory_id) || undefined,
      action: (AUDIT_ACTION_SET.has(action) ? action : 'archive') as MemoryAuditAction,
      actor: String(row.actor),
      sourceEventId: String(row.source_event_id),
      reason: text(row.reason) || undefined,
      createdAt: String(row.created_at),
      metadata,
    };
  }

  private requirePendingGovernanceTarget(input: MemoryGovernanceActionInput): MemoryItemRow {
    const target = this.requireMemoryRow(requireText(input.memoryId, 'memoryId'));
    this.assertGovernanceWorkspace(target, input.context);
    this.assertLongGovernanceTarget(target);
    const expectedDetailVersion = requirePositiveInteger(input.expectedDetailVersion, 'expectedDetailVersion');
    if (target.detail_version !== expectedDetailVersion) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'memory detail version is stale');
    }
    const expectedFingerprint = text(input.expectedFingerprint);
    if (expectedFingerprint && target.fingerprint !== expectedFingerprint) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'memory fingerprint is stale');
    }
    if (target.status !== 'pending-review') {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'governance actions apply only to pending-review memory');
    }
    return target;
  }

  private assertLongGovernanceTarget(target: MemoryItemRow): void {
    if (target.retention !== 'long') {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'governance actions apply only to long memory');
    }
  }

  private findGovernanceActionReplay(
    action: MemoryGovernanceAction,
    memoryId: string,
    sourceEventId: string,
    idempotencyKey: string,
    context: MemoryRequestContext,
  ): MemoryGovernanceActionResult | undefined {
    const audit = this.db.prepare(`
      SELECT memory_id, decision_json FROM memory_audit
      WHERE action = ? AND source_event_id = ? AND idempotency_key = ?
    `).get(action, sourceEventId, idempotencyKey) as { memory_id?: string | null; decision_json?: string } | undefined;
    if (!audit?.memory_id) return undefined;
    if (audit.memory_id !== memoryId) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'governance idempotency key is already bound to another memory');
    }
    const target = this.requireMemoryRow(audit.memory_id);
    this.assertGovernanceWorkspace(target, context);
    this.assertLongGovernanceTarget(target);
    const decision = parseJson<Record<string, unknown>>(audit.decision_json, {});
    const replacementMemoryId = text(decision.replacementMemoryId);
    const replacement = replacementMemoryId ? this.getMemoryRow(replacementMemoryId) : null;
    if (replacement) this.assertGovernanceWorkspace(replacement, context);
    return this.governanceActionResult(
      action,
      target.id,
      target.status as MemoryItemStatus,
      target.detail_version,
      true,
      replacement ? this.rowToIndex(replacement) : undefined,
    );
  }

  private governanceActionResult(
    action: MemoryGovernanceAction,
    memoryId: string,
    status: MemoryItemStatus,
    detailVersion: number,
    idempotent: boolean,
    replacement?: MemoryIndexRecord,
  ): MemoryGovernanceActionResult {
    return {
      action,
      memoryId,
      status,
      detailVersion,
      idempotent,
      ...(replacement ? { replacement } : {}),
    };
  }

  private updateGovernanceStatus(
    memoryId: string,
    status: Extract<MemoryItemStatus, 'active' | 'rejected' | 'expired' | 'superseded'>,
    input: MemoryGovernanceActionInput,
    now: string,
  ): void {
    const terminal = status !== 'active';
    this.db.prepare(`
      UPDATE memory_items
      SET status = ?, updated_at = ?, resolved_at = ?, source_event_id = ?, idempotency_key = ?
      WHERE id = ?
    `).run(status, now, terminal ? now : null, input.sourceEventId, input.idempotencyKey, memoryId);
    if (terminal) this.removeFtsProjection(memoryId);
  }

  private insertGovernanceAudit(
    input: MemoryGovernanceActionInput,
    memoryId: string,
    now: string,
    metadata: MemoryGovernanceAuditMetadata,
    reason?: string,
  ): void {
    this.insertAudit({
      memoryId,
      action: input.action,
      actor: this.actorLabel(input.context),
      sourceEventId: input.sourceEventId,
      idempotencyKey: input.idempotencyKey,
      decision: metadata,
      reason,
      createdAt: now,
    });
  }

  private requireGovernanceReplacement(
    replacementMemoryId: string | undefined,
    target: MemoryItemRow,
    context: MemoryRequestContext,
  ): MemoryItemRow {
    const replacement = this.requireMemoryRow(requireText(replacementMemoryId, 'replacementMemoryId'));
    this.assertGovernanceWorkspace(replacement, context);
    if (replacement.id === target.id
      || replacement.owner_user_id !== target.owner_user_id
      || replacement.retention !== target.retention
      || !['active', 'pending-review'].includes(replacement.status)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'replacement must be another active or pending memory with the same owner and retention');
    }
    return replacement;
  }

  private linkSupersession(replacementMemoryId: string, supersededMemoryId: string, now: string): void {
    this.db.prepare(`
      INSERT INTO memory_links (from_memory_id, to_memory_id, relation, created_at)
      VALUES (?, ?, 'supersedes', ?)
      ON CONFLICT(from_memory_id, to_memory_id, relation) DO NOTHING
    `).run(replacementMemoryId, supersededMemoryId, now);
  }

  private reclassifyPendingLongMemory(
    input: MemoryGovernanceActionInput,
    target: MemoryItemRow,
    now: string,
  ): MemoryIndexRecord {
    if (target.retention !== 'long' || input.requestedRetention !== 'short') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'pending long memory can only be reclassified to short memory');
    }
    const lifecycleAnchor = target.source_run_id && target.source_workflow_id
      ? { scopeType: 'run' as const, runId: target.source_run_id, workflowId: target.source_workflow_id }
      : target.source_session_id
        ? { scopeType: 'session' as const, sessionId: target.source_session_id }
        : undefined;
    if (!lifecycleAnchor) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'reclassification needs a persisted source session or workflow run anchor');
    }
    const detail = this.db.prepare(`
      SELECT details FROM memory_details WHERE memory_id = ? AND detail_version = ?
    `).get(target.id, target.detail_version) as { details?: string } | undefined;
    if (typeof detail?.details !== 'string') {
      throw new MemoryServiceError('MEMORY_NOT_FOUND', 'current memory detail is missing');
    }
    const readWhen = normalizeReadWhen(parseJson<MemoryReadWhen>(target.read_when_json, {
      text: target.read_when,
      triggers: [],
    }), this.budgets);
    const handoff = normalizeHandoff(parseJson<MemoryHandoff>(target.handoff_target_json, {
      mode: target.handoff_mode,
      target: 'none',
    }));
    const scopeBindings = this.reclassifiedShortBindings(target, lifecycleAnchor);
    const fingerprint = this.memoryFingerprint('short', target.kind, lifecycleAnchor, scopeBindings);
    const source: MemorySourceProvenance = {
      sourceAgentId: target.source_agent_id ?? undefined,
      sourceSessionId: target.source_session_id ?? undefined,
      sourceRunId: target.source_run_id ?? undefined,
      sourceWorkflowId: target.source_workflow_id ?? undefined,
      sourceStepAttemptId: target.source_step_attempt_id ?? undefined,
    };
    const replacementId = randomUUID();
    // The original row records the reviewer action as its latest transition.
    // Its replacement needs a distinct, deterministic write identity so the
    // memory_items uniqueness constraint cannot collide inside this transaction.
    const replacementSourceEventId = `${input.sourceEventId}:reclassify:${target.id}`;
    const replacementIdempotencyKey = `${input.idempotencyKey}:replacement`;
    const replacementIndex = {
      memoryId: replacementId,
      retention: 'short' as const,
      kind: target.kind,
      lifecycleAnchor,
      summary: target.summary,
      readWhen,
      handoff,
      detailVersion: 1,
      status: 'active' as const,
      confidence: target.confidence,
      fingerprint,
      indexChars: 0,
      source,
      ownerUserId: target.owner_user_id,
      workspaceId: target.workspace_id,
      createdAt: INDEX_TIMESTAMP_PLACEHOLDER,
      updatedAt: INDEX_TIMESTAMP_PLACEHOLDER,
      expiresAt: target.expires_at ?? undefined,
    } satisfies MemoryIndexRecord;
    const indexChars = this.indexChars(replacementIndex);
    if (indexChars > this.budgets.maxIndexItemChars) {
      throw new MemoryServiceError('MEMORY_LIMIT_EXCEEDED', 'reclassified memory index exceeds the server character budget');
    }
    const normalized: NormalizedMemoryWrite = {
      proposal: {
        action: 'create',
        retention: 'short',
        lifecycleAnchor,
        summary: target.summary,
        readWhen,
        handoff,
        details: detail.details,
        kind: target.kind,
        confidence: target.confidence,
        sourceEventId: input.sourceEventId,
        idempotencyKey: input.idempotencyKey,
        expiresAt: target.expires_at ?? undefined,
      },
      retention: 'short',
      lifecycleAnchor,
      scopeBindings,
      summary: target.summary,
      readWhen,
      handoff,
      details: detail.details,
      kind: target.kind,
      confidence: target.confidence,
      expiresAt: target.expires_at ?? undefined,
      fingerprint,
      indexChars,
      ftsProjection: assertMaxChars(
        [target.summary, readWhen.text, ...(readWhen.keywords ?? [])].filter(Boolean).join('\n'),
        this.budgets.maxFtsProjectionChars,
        'reclassified memory FTS projection',
      ),
    };
    this.db.prepare(`
      INSERT INTO memory_items (
        id, retention, kind, lifecycle_anchor_type, lifecycle_anchor_key, lifecycle_anchor_workflow_id,
        summary, read_when, read_when_json, handoff_mode, handoff_target_json, index_chars, detail_version,
        status, confidence, fingerprint, governance_mode, source_event_id, idempotency_key,
        source_agent_id, source_session_id, source_run_id, source_workflow_id, source_step_attempt_id,
        owner_user_id, workspace_id, created_at, updated_at, resolved_at, expires_at
      ) VALUES (?, 'short', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      replacementId,
      target.kind,
      lifecycleAnchor.scopeType,
      lifecycleAnchor.scopeType === 'session' ? lifecycleAnchor.sessionId : lifecycleAnchor.runId,
      lifecycleAnchor.scopeType === 'run' ? lifecycleAnchor.workflowId : null,
      target.summary,
      readWhen.text,
      stableJson(readWhen),
      handoff.mode,
      stableJson(handoff),
      indexChars,
      target.confidence,
      fingerprint,
      GOVERNANCE_SET.has(target.governance_mode) ? target.governance_mode : 'review',
      replacementSourceEventId,
      replacementIdempotencyKey,
      target.source_agent_id,
      target.source_session_id,
      target.source_run_id,
      target.source_workflow_id,
      target.source_step_attempt_id,
      target.owner_user_id,
      target.workspace_id,
      now,
      now,
      target.expires_at,
    );
    this.insertDetail(replacementId, 1, normalized, now);
    this.insertBindings(replacementId, scopeBindings, now);
    this.replaceFtsProjection(replacementId, normalized, now);
    this.updateGovernanceStatus(target.id, 'superseded', input, now);
    this.linkSupersession(replacementId, target.id, now);
    return this.rowToIndex(this.requireMemoryRow(replacementId));
  }

  private reclassifiedShortBindings(
    target: MemoryItemRow,
    lifecycleAnchor: MemoryLifecycleAnchor,
  ): MemoryScopeBinding[] {
    const visibility: MemoryVisibility = lifecycleAnchor.scopeType === 'run' ? 'workflow-participant' : 'private';
    const result: MemoryScopeBinding[] = [];
    const add = (scopeType: MemoryScopeBinding['scopeType'], scopeKey: string, role: MemoryScopeBinding['role']) => {
      const key = `${role}\n${scopeType}\n${scopeKey}`;
      if (result.some((binding) => `${binding.role}\n${binding.scopeType}\n${binding.scopeKey}` === key)) return;
      result.push({
        scopeType,
        scopeKey,
        role,
        ownerUserId: target.owner_user_id,
        workspaceId: target.workspace_id,
        visibility,
      });
    };
    if (lifecycleAnchor.scopeType === 'session') {
      add('session', lifecycleAnchor.sessionId, 'lifecycle-anchor');
    } else {
      add('run', lifecycleAnchor.runId, 'lifecycle-anchor');
      add('workflow', lifecycleAnchor.workflowId, 'relevance');
    }
    for (const binding of this.listGovernanceScopeBindings(target.id)) {
      if (binding.role !== 'relevance') continue;
      if (binding.scopeType !== 'agent' && binding.scopeType !== 'project') continue;
      add(binding.scopeType, binding.scopeKey, 'relevance');
    }
    return result;
  }

  private create(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryProposalResult {
    const existing = this.getIdempotentResult('create', proposal, context);
    if (existing) {
      recordMemoryV2IdempotentReplay();
      return existing;
    }
    const normalized = this.normalizeWritableProposal(proposal, context);
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const idempotent = this.getIdempotentResult('create', proposal, context);
      if (idempotent) return idempotent;
      const now = this.clock();
      const memoryId = randomUUID();
      const status = this.initialStatus(normalized.retention, context);
      const indexChars = this.indexCharsFor(memoryId, 1, normalized, context);
      if (proposal.replacesMemoryId) this.assertReplacementTarget(proposal, context, normalized);
      this.db.prepare(`
        INSERT INTO memory_items (
          id, retention, kind, lifecycle_anchor_type, lifecycle_anchor_key, lifecycle_anchor_workflow_id,
          summary, read_when, read_when_json, handoff_mode, handoff_target_json, index_chars, detail_version,
          status, confidence, fingerprint, governance_mode, source_event_id, idempotency_key,
          source_agent_id, source_session_id, source_run_id, source_workflow_id, source_step_attempt_id,
          owner_user_id, workspace_id, created_at, updated_at, resolved_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
      `).run(
        memoryId,
        normalized.retention,
        normalized.kind,
        normalized.lifecycleAnchor?.scopeType ?? null,
        normalized.lifecycleAnchor?.scopeType === 'session' ? normalized.lifecycleAnchor.sessionId : normalized.lifecycleAnchor?.runId ?? null,
        normalized.lifecycleAnchor?.scopeType === 'run' ? normalized.lifecycleAnchor.workflowId : null,
        normalized.summary,
        normalized.readWhen.text,
        stableJson(normalized.readWhen),
        normalized.handoff.mode,
        stableJson(normalized.handoff),
        indexChars,
        status,
        normalized.confidence,
        normalized.fingerprint,
        context.governanceMode ?? 'review',
        proposal.sourceEventId,
        proposal.idempotencyKey,
        context.agentId ?? null,
        context.sessionId ?? null,
        context.runId ?? null,
        context.workflowId ?? null,
        context.stepAttemptId ?? null,
        context.ownerUserId,
        context.workspaceId,
        now,
        now,
        normalized.expiresAt ?? null,
      );
      this.insertDetail(memoryId, 1, normalized, now);
      this.insertBindings(memoryId, normalized.scopeBindings, now);
      this.replaceFtsProjection(memoryId, normalized, now);
      if (proposal.replacesMemoryId) {
        const replacementId = requireText(proposal.replacesMemoryId, 'replacesMemoryId');
        this.db.prepare(`
          UPDATE memory_items SET status = 'superseded', updated_at = ?, resolved_at = ? WHERE id = ?
        `).run(now, now, replacementId);
        this.removeFtsProjection(replacementId);
        this.db.prepare(`
          INSERT INTO memory_links (from_memory_id, to_memory_id, relation, created_at)
          VALUES (?, ?, 'supersedes', ?)
        `).run(memoryId, replacementId, now);
      }
      this.insertAudit({
        memoryId,
        action: 'create',
        actor: this.actorLabel(context),
        sourceEventId: proposal.sourceEventId,
        idempotencyKey: proposal.idempotencyKey,
        decision: this.auditDecision(proposal, normalized),
        createdAt: now,
      });
      return { action: 'create', memoryId, status, detailVersion: 1, fingerprint: normalized.fingerprint, idempotent: false };
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('creates');
    }
    return result;
  }

  private discard(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryProposalResult {
    if (proposal.retention !== 'none') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'discard requires retention none');
    if (proposal.lifecycleAnchor || (proposal.scopeBindings?.length ?? 0) > 0 || text(proposal.details)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'discard cannot persist lifecycle, scope, or details');
    }
    if (proposal.handoff && (proposal.handoff.mode !== 'none' || proposal.handoff.target !== 'none')) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'discard cannot create a handoff');
    }
    const sourceEventId = requireText(proposal.sourceEventId, 'sourceEventId');
    const idempotencyKey = requireText(proposal.idempotencyKey, 'idempotencyKey');
    const existing = this.db.prepare(`
      SELECT 1 FROM memory_audit WHERE action = 'discard' AND source_event_id = ? AND idempotency_key = ?
    `).get(sourceEventId, idempotencyKey);
    if (existing) {
      recordMemoryV2IdempotentReplay();
      return { action: 'discard', status: 'discarded', idempotent: true };
    }
    const result = withMemoryV2ImmediateTransaction(this.db, () => {
      const repeated = this.db.prepare(`
        SELECT 1 FROM memory_audit WHERE action = 'discard' AND source_event_id = ? AND idempotency_key = ?
      `).get(sourceEventId, idempotencyKey);
      if (repeated) return { action: 'discard', status: 'discarded', idempotent: true };
      this.insertAudit({
        action: 'discard',
        actor: this.actorLabel(context),
        sourceEventId,
        idempotencyKey,
        decision: { retention: 'none' },
        createdAt: this.clock(),
      });
      return { action: 'discard', status: 'discarded', idempotent: false };
    });
    if (result.idempotent) {
      recordMemoryV2IdempotentReplay();
    } else {
      recordMemoryV2Write('discards');
    }
    return result;
  }

  private normalizeWritableProposal(proposal: MemoryDecisionProposal, context: MemoryRequestContext): NormalizedMemoryWrite {
    const retention = text(proposal.retention);
    if (!MEMORY_RETENTIONS.includes(retention as MemoryDecisionProposal['retention']) || retention === 'none') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'create or upsert requires short or long retention');
    }
    requireText(proposal.sourceEventId, 'sourceEventId');
    requireText(proposal.idempotencyKey, 'idempotencyKey');
    const lifecycleAnchor = normalizeAnchor(proposal.lifecycleAnchor);
    const scopeProposals = normalizeScopeProposal(proposal.scopeBindings);
    const readWhen = normalizeReadWhen(proposal.readWhen, this.budgets);
    const handoff = normalizeHandoff(proposal.handoff);
    if (handoff.mode !== 'none') {
      if (!context.runId || !context.workflowId || !context.stepAttemptId) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'workflow handoff requires a server run, workflow, and source step attempt');
      }
      this.assertRunParticipant(context, context.runId);
    }
    if (handoff.mode === 'on-demand' && !readWhen.triggers.includes('explicit-search')) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'on-demand memory must allow explicit-search reads');
    }
    const summary = assertMaxChars(requireText(proposal.summary, 'summary'), this.budgets.maxSummaryChars, 'summary');
    const details = assertMaxChars(requireText(proposal.details, 'details'), this.budgets.maxDetailChars, 'details');
    if (containsSensitiveCredential(details) || containsSensitiveCredential(summary)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'memory proposal contains a credential-like secret');
    }
    const externalSensitiveReason = this.validateSensitiveContent?.({ proposal, context });
    if (externalSensitiveReason) throw new MemoryServiceError('MEMORY_INVALID_INPUT', externalSensitiveReason);
    const kind = assertMaxChars(requireText(proposal.kind, 'kind'), 120, 'kind');
    const confidence = Number(proposal.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'confidence must be a number between 0 and 1');
    }
    const expiresAt = normalizeIsoDate(proposal.expiresAt, 'expiresAt');
    const scopeBindings = this.deriveBindings(retention as PersistedMemoryRetention, lifecycleAnchor, scopeProposals, context);
    const fingerprint = this.memoryFingerprint(retention as PersistedMemoryRetention, kind, lifecycleAnchor, scopeBindings);
    const indexChars = this.indexChars({
      memoryId: '00000000-0000-0000-0000-000000000000',
      retention: retention as PersistedMemoryRetention,
      kind,
      lifecycleAnchor,
      summary,
      readWhen,
      handoff,
      detailVersion: 2_147_483_647,
      status: 'pending-review',
      confidence,
      fingerprint,
      indexChars: 0,
      source: this.contextSource(context),
      ownerUserId: context.ownerUserId,
      workspaceId: context.workspaceId,
      createdAt: INDEX_TIMESTAMP_PLACEHOLDER,
      updatedAt: INDEX_TIMESTAMP_PLACEHOLDER,
      expiresAt,
    });
    if (indexChars > this.budgets.maxIndexItemChars) {
      throw new MemoryServiceError('MEMORY_LIMIT_EXCEEDED', 'memory index exceeds the server character budget');
    }
    const ftsProjection = assertMaxChars(
      [summary, readWhen.text, ...(readWhen.keywords ?? [])].filter(Boolean).join('\n'),
      this.budgets.maxFtsProjectionChars,
      'memory FTS projection',
    );
    return {
      proposal,
      retention: retention as PersistedMemoryRetention,
      lifecycleAnchor,
      scopeBindings,
      summary,
      readWhen,
      handoff,
      details,
      kind,
      confidence,
      expiresAt,
      fingerprint,
      indexChars,
      ftsProjection,
    };
  }

  private deriveBindings(
    retention: PersistedMemoryRetention,
    lifecycleAnchor: MemoryLifecycleAnchor | undefined,
    proposals: MemoryScopeBindingProposal[],
    context: MemoryRequestContext,
  ): MemoryScopeBinding[] {
    const bindings: MemoryScopeBinding[] = [];
    const insert = (scopeType: MemoryScopeBindingProposal['scopeType'], scopeKey: string, role: MemoryScopeBinding['role']) => {
      if (!this.contextAllowsScope(context, scopeType, scopeKey)) {
        throw new MemoryServiceError('MEMORY_UNAUTHORIZED', `server context does not authorize ${scopeType} scope ${scopeKey}`);
      }
      const visibility = this.deriveVisibility(retention, lifecycleAnchor, scopeType, context);
      const key = `${role}\n${scopeType}\n${scopeKey}`;
      if (bindings.some((binding) => `${binding.role}\n${binding.scopeType}\n${binding.scopeKey}` === key)) return;
      bindings.push({ scopeType, scopeKey, role, ownerUserId: context.ownerUserId, workspaceId: context.workspaceId, visibility });
    };

    if (retention === 'short') {
      if (!lifecycleAnchor) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'short memory requires a lifecycle anchor');
      if (lifecycleAnchor.scopeType === 'session') {
        if (context.sessionId !== lifecycleAnchor.sessionId) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'conversation short memory must use the current server session');
        }
        insert('session', lifecycleAnchor.sessionId, 'lifecycle-anchor');
      } else {
        if (context.runId !== lifecycleAnchor.runId || context.workflowId !== lifecycleAnchor.workflowId) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'workflow short memory must use the current server run and workflow');
        }
        this.assertRunParticipant(context, lifecycleAnchor.runId);
        insert('run', lifecycleAnchor.runId, 'lifecycle-anchor');
        insert('workflow', lifecycleAnchor.workflowId, 'relevance');
      }
    } else if (lifecycleAnchor) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'long memory cannot have a lifecycle anchor');
    }

    for (const proposal of proposals) {
      if (retention === 'short' && lifecycleAnchor?.scopeType === 'session') {
        if (proposal.scopeType === 'session' && proposal.scopeKey !== lifecycleAnchor.sessionId) {
          throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'conversation short memory cannot bind another session');
        }
        if (proposal.scopeType === 'run' || proposal.scopeType === 'channel') {
          throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'conversation short memory cannot bind to run or channel scope');
        }
      }
      if (retention === 'short' && lifecycleAnchor?.scopeType === 'run') {
        if (proposal.scopeType === 'run' && proposal.scopeKey !== lifecycleAnchor.runId) {
          throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'workflow short memory cannot bind another run');
        }
        if (proposal.scopeType === 'workflow' && proposal.scopeKey !== lifecycleAnchor.workflowId) {
          throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'workflow short memory cannot bind another workflow');
        }
        if (proposal.scopeType === 'session') {
          throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'workflow short memory cannot bind a conversation session');
        }
      }
      if (retention === 'long' && proposal.scopeType === 'channel') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'channel scope is only valid for run-anchored short memory');
      }
      if (proposal.scopeType === 'channel') {
        if (lifecycleAnchor?.scopeType !== 'run' || context.channelId !== proposal.scopeKey) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'channel binding requires the current run anchor and channel');
        }
        this.assertRunChannelMember(context, lifecycleAnchor.runId, proposal.scopeKey);
      }
      if (proposal.scopeType === 'run' && lifecycleAnchor?.scopeType === 'run' && proposal.scopeKey === lifecycleAnchor.runId) continue;
      if (proposal.scopeType === 'session' && lifecycleAnchor?.scopeType === 'session' && proposal.scopeKey === lifecycleAnchor.sessionId) continue;
      insert(proposal.scopeType, proposal.scopeKey, 'relevance');
    }
    if (retention === 'long' && !bindings.some((binding) => ['agent', 'workflow', 'project'].includes(binding.scopeType))) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'long memory requires an agent, workflow, or project binding');
    }
    return bindings;
  }

  private deriveVisibility(
    retention: PersistedMemoryRetention,
    lifecycleAnchor: MemoryLifecycleAnchor | undefined,
    scopeType: MemoryScopeBindingProposal['scopeType'],
    context: MemoryRequestContext,
  ): MemoryVisibility {
    if (scopeType === 'channel') return 'channel-member';
    if (retention === 'short' && lifecycleAnchor?.scopeType === 'run') return 'workflow-participant';
    if (retention === 'short') return 'private';
    return context.longMemoryVisibility ?? 'workspace';
  }

  private contextAllowsScope(context: MemoryRequestContext, scopeType: MemoryScopeBindingProposal['scopeType'], scopeKey: string): boolean {
    return contextValues(context, scopeType).has(scopeKey);
  }

  private initialStatus(retention: PersistedMemoryRetention, context: MemoryRequestContext): Extract<MemoryProposalResult['status'], 'pending-review' | 'active'> {
    if (retention === 'short') return 'active';
    const governance = context.governanceMode ?? 'review';
    if (governance === 'manual') return 'pending-review';
    if (!context.allowLongAutoApproval || governance !== 'auto') return 'pending-review';
    return 'active';
  }

  private memoryFingerprint(
    retention: PersistedMemoryRetention,
    kind: string,
    lifecycleAnchor: MemoryLifecycleAnchor | undefined,
    bindings: MemoryScopeBinding[],
  ): string {
    const relevance = bindings
      .filter((binding) => binding.role === 'relevance')
      .map((binding) => `${binding.scopeType}:${binding.scopeKey}`)
      .sort();
    return sha256(stableJson({ retention, kind, lifecycleAnchor, relevance }));
  }

  private contextSource(context: MemoryRequestContext): MemorySourceProvenance {
    return {
      sourceAgentId: context.agentId,
      sourceSessionId: context.sessionId,
      sourceRunId: context.runId,
      sourceWorkflowId: context.workflowId,
      sourceStepAttemptId: context.stepAttemptId,
    };
  }

  private indexChars(index: MemoryIndexRecord): number {
    const payload = {
      memoryId: index.memoryId,
      retention: index.retention,
      kind: index.kind,
      lifecycleAnchor: index.lifecycleAnchor,
      summary: index.summary,
      readWhen: index.readWhen,
      handoff: index.handoff,
      detailVersion: index.detailVersion,
      status: index.status,
      confidence: index.confidence,
      fingerprint: index.fingerprint,
      source: index.source,
      ownerUserId: index.ownerUserId,
      workspaceId: index.workspaceId,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
      expiresAt: index.expiresAt,
    };
    let chars = 0;
    for (;;) {
      const next = stableJson({ ...payload, indexChars: chars }).length;
      if (next === chars) return next;
      chars = next;
    }
  }

  private indexCharsFor(
    memoryId: string,
    detailVersion: number,
    normalized: NormalizedMemoryWrite,
    context: MemoryRequestContext,
  ): number {
    const chars = this.indexChars({
      memoryId,
      retention: normalized.retention,
      kind: normalized.kind,
      lifecycleAnchor: normalized.lifecycleAnchor,
      summary: normalized.summary,
      readWhen: normalized.readWhen,
      handoff: normalized.handoff,
      detailVersion,
      status: 'pending-review',
      confidence: normalized.confidence,
      fingerprint: normalized.fingerprint,
      indexChars: 0,
      source: this.contextSource(context),
      ownerUserId: context.ownerUserId,
      workspaceId: context.workspaceId,
      createdAt: INDEX_TIMESTAMP_PLACEHOLDER,
      updatedAt: INDEX_TIMESTAMP_PLACEHOLDER,
      expiresAt: normalized.expiresAt,
    });
    if (chars > this.budgets.maxIndexItemChars) {
      throw new MemoryServiceError('MEMORY_LIMIT_EXCEEDED', 'memory index exceeds the server character budget');
    }
    return chars;
  }

  private manifestItemChars(item: MemoryManifestItem): number {
    return stableJson(item).length;
  }

  private manifestPayloadChars(items: MemoryManifestItem[]): number {
    return stableJson({
      items,
      requiredReadItems: items.filter((item) => item.handoff.mode === 'required-read'),
    }).length;
  }

  private searchPayloadChars(items: MemoryIndexRecord[]): number {
    return stableJson({ items }).length;
  }

  private insertDetail(memoryId: string, detailVersion: number, normalized: NormalizedMemoryWrite, now: string): void {
    const requiredExtract = normalized.handoff.mode === 'required-read'
      ? normalized.details.slice(0, this.budgets.maxRequiredReadExtractChars)
      : undefined;
    this.db.prepare(`
      INSERT INTO memory_details (
        memory_id, detail_version, details, detail_chars, content_hash, format,
        required_read_extract, required_read_extract_chars, required_read_extract_hash,
        is_current, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'text/plain', ?, ?, ?, 1, ?, ?)
    `).run(
      memoryId,
      detailVersion,
      normalized.details,
      normalized.details.length,
      sha256(normalized.details),
      requiredExtract ?? null,
      requiredExtract === undefined ? null : requiredExtract.length,
      requiredExtract === undefined ? null : sha256(requiredExtract),
      now,
      now,
    );
  }

  private insertBindings(memoryId: string, bindings: MemoryScopeBinding[], now: string): void {
    const insert = this.db.prepare(`
      INSERT INTO memory_scope_bindings (
        memory_id, scope_type, scope_key, binding_role, owner_user_id, workspace_id, visibility, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const binding of bindings) {
      insert.run(
        memoryId,
        binding.scopeType,
        binding.scopeKey,
        binding.role,
        binding.ownerUserId,
        binding.workspaceId,
        binding.visibility,
        now,
      );
    }
  }

  private replaceFtsProjection(memoryId: string, normalized: NormalizedMemoryWrite, _now: string): void {
    this.removeFtsProjection(memoryId);
    this.db.prepare(`
      INSERT INTO memory_fts (memory_id, summary, read_when, search_projection)
      VALUES (?, ?, ?, ?)
    `).run(memoryId, normalized.summary, normalized.readWhen.text, normalized.ftsProjection);
  }

  private removeFtsProjection(memoryId: string): void {
    this.db.prepare('DELETE FROM memory_fts WHERE memory_id = ?').run(memoryId);
  }

  private insertAudit(input: {
    memoryId?: string;
    action: MemoryAuditAction;
    actor: string;
    sourceEventId: string;
    idempotencyKey: string;
    decision: unknown;
    reason?: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO memory_audit (
        id, memory_id, action, actor, source_event_id, idempotency_key, decision_json, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_event_id, idempotency_key, action) DO NOTHING
    `).run(
      randomUUID(),
      input.memoryId ?? null,
      input.action,
      input.actor,
      input.sourceEventId,
      input.idempotencyKey,
      stableJson(input.decision),
      input.reason ?? null,
      input.createdAt,
    );
  }

  private auditDecision(proposal: MemoryDecisionProposal, normalized?: NormalizedMemoryWrite): Record<string, unknown> {
    return {
      action: proposal.action,
      retention: proposal.retention,
      lifecycleAnchor: normalized?.lifecycleAnchor ?? proposal.lifecycleAnchor,
      scopeBindings: normalized?.scopeBindings.map(({ scopeType, scopeKey, role }) => ({ scopeType, scopeKey, role })) ?? proposal.scopeBindings ?? [],
      summary: normalized?.summary ?? text(proposal.summary),
      readWhen: normalized?.readWhen ?? proposal.readWhen,
      handoff: normalized?.handoff ?? proposal.handoff,
      kind: normalized?.kind ?? text(proposal.kind),
      confidence: normalized?.confidence ?? proposal.confidence,
      detailChars: normalized?.details.length ?? text(proposal.details).length,
      detailHash: normalized ? sha256(normalized.details) : undefined,
      targetMemoryId: proposal.targetMemoryId,
      expectedDetailVersion: proposal.expectedDetailVersion,
      expectedFingerprint: proposal.expectedFingerprint,
      replacesMemoryId: proposal.replacesMemoryId,
    };
  }

  private getIdempotentResult(
    action: 'create' | 'upsert' | 'resolve',
    proposal: MemoryDecisionProposal,
    context: MemoryRequestContext,
  ): MemoryProposalResult | null {
    const sourceEventId = text(proposal.sourceEventId);
    const idempotencyKey = text(proposal.idempotencyKey);
    if (!sourceEventId || !idempotencyKey) return null;
    const audit = this.db.prepare(`
      SELECT memory_id FROM memory_audit
      WHERE action = ? AND source_event_id = ? AND idempotency_key = ?
    `).get(action, sourceEventId, idempotencyKey) as { memory_id?: string | null } | undefined;
    if (!audit?.memory_id) return null;
    const item = this.getMemoryRow(audit.memory_id);
    if (!item) return null;
    this.assertOwned(item, context);
    return {
      action,
      memoryId: item.id,
      status: item.status as MemoryProposalResult['status'],
      detailVersion: Number(item.detail_version),
      fingerprint: item.fingerprint,
      idempotent: true,
    };
  }

  private findMutationTarget(proposal: MemoryDecisionProposal, context: MemoryRequestContext): MemoryItemRow {
    const targetMemoryId = text(proposal.targetMemoryId);
    const expectedFingerprint = text(proposal.expectedFingerprint);
    if (!targetMemoryId && !expectedFingerprint) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'upsert or resolve requires targetMemoryId or expectedFingerprint');
    }
    if (proposal.expectedDetailVersion === undefined || !Number.isInteger(Number(proposal.expectedDetailVersion)) || Number(proposal.expectedDetailVersion) < 1) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'upsert or resolve requires expectedDetailVersion');
    }
    if (targetMemoryId) {
      const item = this.requireMemoryRow(targetMemoryId);
      this.assertOwned(item, context);
      if (expectedFingerprint && item.fingerprint !== expectedFingerprint) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'expected fingerprint does not match target memory');
      }
      return item;
    }
    const rows = this.db.prepare(`
      SELECT * FROM memory_items
      WHERE owner_user_id = ? AND workspace_id = ? AND fingerprint = ?
        AND status IN ('active', 'pending-review')
      ORDER BY updated_at DESC, id ASC
      LIMIT 2
    `).all(context.ownerUserId, context.workspaceId, expectedFingerprint) as MemoryItemRow[];
    if (rows.length !== 1) {
      throw new MemoryServiceError(rows.length ? 'MEMORY_CONFLICT' : 'MEMORY_NOT_FOUND', 'memory fingerprint does not identify exactly one active memory');
    }
    return rows[0];
  }

  private assertExpectedRevisionAndFingerprint(target: MemoryItemRow, proposal: MemoryDecisionProposal): void {
    if (Number(proposal.expectedDetailVersion) !== Number(target.detail_version)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'memory detail version is stale');
    }
    if (text(proposal.expectedFingerprint) && proposal.expectedFingerprint !== target.fingerprint) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'memory fingerprint is stale');
    }
  }

  private assertReplacementTarget(proposal: MemoryDecisionProposal, context: MemoryRequestContext, normalized: NormalizedMemoryWrite): void {
    const replacementId = requireText(proposal.replacesMemoryId, 'replacesMemoryId');
    const previous = this.requireMemoryRow(replacementId);
    this.assertOwned(previous, context);
    if (!['active', 'pending-review'].includes(previous.status)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'only active or pending-review memory can be superseded');
    }
    if (proposal.expectedDetailVersion === undefined || Number(proposal.expectedDetailVersion) !== Number(previous.detail_version)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'replacement requires the previous detail revision');
    }
    if (text(proposal.expectedFingerprint) && proposal.expectedFingerprint !== previous.fingerprint) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'replacement expected fingerprint is stale');
    }
    if (previous.retention !== normalized.retention) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'replacement retention must match the superseded memory');
    }
  }

  private getMemoryRow(memoryId: string): MemoryItemRow | null {
    const row = this.db.prepare('SELECT * FROM memory_items WHERE id = ?').get(memoryId) as MemoryItemRow | undefined;
    return row ?? null;
  }

  private requireMemoryRow(memoryId: string): MemoryItemRow {
    const row = this.getMemoryRow(memoryId);
    if (!row) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'memory item was not found');
    return row;
  }

  private rowToIndex(row: MemoryItemRow): MemoryIndexRecord {
    const lifecycleAnchor = row.lifecycle_anchor_type === 'session'
      ? { scopeType: 'session' as const, sessionId: String(row.lifecycle_anchor_key) }
      : row.lifecycle_anchor_type === 'run'
        ? { scopeType: 'run' as const, runId: String(row.lifecycle_anchor_key), workflowId: String(row.lifecycle_anchor_workflow_id) }
        : undefined;
    const readWhen = parseJson<MemoryReadWhen>(row.read_when_json, { text: row.read_when, triggers: [] });
    const handoff = parseJson<MemoryHandoff>(row.handoff_target_json, { mode: row.handoff_mode, target: 'none' });
    return {
      memoryId: row.id,
      retention: row.retention,
      kind: row.kind,
      lifecycleAnchor,
      summary: row.summary,
      readWhen,
      handoff,
      detailVersion: Number(row.detail_version),
      status: (PERSISTED_STATUSES.has(row.status) ? row.status : 'rejected') as MemoryIndexRecord['status'],
      confidence: Number(row.confidence),
      fingerprint: row.fingerprint,
      indexChars: Number(row.index_chars),
      source: {
        sourceAgentId: row.source_agent_id ?? undefined,
        sourceSessionId: row.source_session_id ?? undefined,
        sourceRunId: row.source_run_id ?? undefined,
        sourceWorkflowId: row.source_workflow_id ?? undefined,
        sourceStepAttemptId: row.source_step_attempt_id ?? undefined,
      },
      ownerUserId: row.owner_user_id,
      workspaceId: row.workspace_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  private toHandoffIndexSnapshot(index: MemoryIndexRecord): MemoryHandoffIndexSnapshot {
    return {
      memoryId: index.memoryId,
      retention: index.retention,
      kind: index.kind,
      lifecycleAnchor: index.lifecycleAnchor,
      summary: index.summary,
      readWhen: index.readWhen,
      handoff: index.handoff,
      detailVersion: index.detailVersion,
      confidence: index.confidence,
      fingerprint: index.fingerprint,
      indexChars: index.indexChars,
      source: index.source,
      createdAt: index.createdAt,
      updatedAt: index.updatedAt,
    };
  }

  private parseHandoffIndexSnapshot(value: unknown): MemoryHandoffIndexSnapshot | undefined {
    const candidate = parseJson<Partial<MemoryHandoffIndexSnapshot>>(value, {});
    const retention = text(candidate.retention);
    const memoryId = text(candidate.memoryId);
    const kind = text(candidate.kind);
    const summary = text(candidate.summary);
    const fingerprint = text(candidate.fingerprint);
    const createdAt = text(candidate.createdAt);
    const updatedAt = text(candidate.updatedAt);
    const detailVersion = Number(candidate.detailVersion);
    const confidence = Number(candidate.confidence);
    const indexChars = Number(candidate.indexChars);
    if (
      !memoryId
      || !kind
      || !summary
      || !fingerprint
      || !createdAt
      || !updatedAt
      || !(['short', 'long'] as const).includes(retention as PersistedMemoryRetention)
      || !Number.isInteger(detailVersion)
      || detailVersion < 1
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1
      || !Number.isInteger(indexChars)
      || indexChars < 0
    ) {
      return undefined;
    }

    try {
      const lifecycleAnchor = normalizeAnchor(candidate.lifecycleAnchor);
      const readWhen = normalizeReadWhen(candidate.readWhen, this.budgets);
      const handoff = normalizeHandoff(candidate.handoff);
      const sourceCandidate: Partial<MemorySourceProvenance> = candidate.source && typeof candidate.source === 'object'
        ? candidate.source as MemorySourceProvenance
        : {};
      return {
        memoryId,
        retention: retention as PersistedMemoryRetention,
        kind,
        lifecycleAnchor,
        summary,
        readWhen,
        handoff,
        detailVersion,
        confidence,
        fingerprint,
        indexChars,
        source: {
          sourceAgentId: text(sourceCandidate.sourceAgentId) || undefined,
          sourceSessionId: text(sourceCandidate.sourceSessionId) || undefined,
          sourceRunId: text(sourceCandidate.sourceRunId) || undefined,
          sourceWorkflowId: text(sourceCandidate.sourceWorkflowId) || undefined,
          sourceStepAttemptId: text(sourceCandidate.sourceStepAttemptId) || undefined,
        },
        createdAt,
        updatedAt,
      };
    } catch {
      return undefined;
    }
  }

  private indexFromHandoffSnapshot(snapshot: MemoryHandoffIndexSnapshot, row: MemoryItemRow): MemoryIndexRecord {
    return {
      ...snapshot,
      status: (PERSISTED_STATUSES.has(row.status) ? row.status : 'rejected') as MemoryIndexRecord['status'],
      ownerUserId: row.owner_user_id,
      workspaceId: row.workspace_id,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  private selectActiveIndexRows(): MemoryItemRow[] {
    return this.db.prepare(`
      SELECT * FROM memory_items
      WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY updated_at DESC, id ASC
    `).all(this.clock()) as MemoryItemRow[];
  }

  private assertOwned(item: MemoryItemRow, context: MemoryRequestContext): void {
    if (item.owner_user_id !== context.ownerUserId || item.workspace_id !== context.workspaceId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'memory owner or workspace does not match server authorization context');
    }
  }

  private assertReadable(item: MemoryItemRow, context: MemoryRequestContext, throwOnFailure = false): boolean {
    const readable = this.isReadable(item, context);
    if (!readable && throwOnFailure) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'memory is not readable in the current server context');
    return readable;
  }

  private isReadable(item: MemoryItemRow, context: MemoryRequestContext): boolean {
    if (item.owner_user_id !== context.ownerUserId || item.workspace_id !== context.workspaceId) return false;
    if (item.status !== 'active') return false;
    if (item.expires_at && item.expires_at <= this.clock()) return false;
    if (item.retention === 'short') {
      if (item.lifecycle_anchor_type === 'session') {
        if (context.sessionId !== item.lifecycle_anchor_key) return false;
      } else if (item.lifecycle_anchor_type === 'run') {
        if (context.runId !== item.lifecycle_anchor_key || context.workflowId !== item.lifecycle_anchor_workflow_id) return false;
        if (!this.isRunParticipant(context, String(item.lifecycle_anchor_key))) return false;
      } else {
        return false;
      }
    }
    const bindings = this.db.prepare(`
      SELECT scope_type, scope_key, binding_role, owner_user_id, workspace_id, visibility, created_at
      FROM memory_scope_bindings WHERE memory_id = ? AND binding_role = 'relevance'
    `).all(item.id) as Array<SqliteRow>;
    if (!bindings.length) return true;
    const channelBindings = bindings.filter((binding) => binding.scope_type === 'channel');
    if (channelBindings.length && !channelBindings.some((binding) => this.bindingMatches(binding, context, item))) {
      return false;
    }
    const nonChannelBindings = bindings.filter((binding) => binding.scope_type !== 'channel');
    return !nonChannelBindings.length || nonChannelBindings.some((binding) => this.bindingMatches(binding, context, item));
  }

  private bindingMatches(binding: SqliteRow, context: MemoryRequestContext, item: MemoryItemRow): boolean {
    if (binding.owner_user_id !== context.ownerUserId || binding.workspace_id !== context.workspaceId) return false;
    const scopeType = String(binding.scope_type);
    const scopeKey = String(binding.scope_key);
    if (!SCOPE_SET.has(scopeType) || !contextValues(context, scopeType as MemoryScopeBindingProposal['scopeType']).has(scopeKey)) return false;
    const visibility = String(binding.visibility) as MemoryVisibility;
    if (visibility === 'workflow-participant') return !!context.runId && this.isRunParticipant(context, context.runId);
    if (visibility === 'channel-member') {
      return !!context.runId && scopeType === 'channel' && this.isRunChannelMember(context, context.runId, scopeKey);
    }
    if (visibility === 'private') return item.owner_user_id === context.ownerUserId;
    return visibility === 'workspace';
  }

  private readWhenMatches(readWhen: MemoryReadWhen, trigger: string, context: MemoryRequestContext, queryText?: string): boolean {
    if (!readWhen.triggers.includes(trigger as MemoryReadWhen['triggers'][number])) return false;
    if (readWhen.workflowStates?.length && (!context.workflowState || !readWhen.workflowStates.includes(context.workflowState))) return false;
    if (readWhen.stepIds?.length && (!context.stepId || !readWhen.stepIds.includes(context.stepId))) return false;
    if (readWhen.stepTags?.length) {
      const tags = new Set(context.stepTags ?? []);
      if (!readWhen.stepTags.some((tag) => tags.has(tag))) return false;
    }
    if (readWhen.agentIds?.length && (!context.agentId || !readWhen.agentIds.includes(context.agentId))) return false;
    if (readWhen.keywords?.length) {
      if (!queryText) return false;
      const haystack = queryText.toLocaleLowerCase();
      if (!readWhen.keywords.some((keyword) => haystack.includes(keyword.toLocaleLowerCase()))) return false;
    }
    return true;
  }

  private manifestScore(index: MemoryIndexRecord, delivery: MemoryManifestItem['delivery'] | undefined, queryText?: string): number {
    const targetScore = delivery ? 100 : 0;
    const requiredScore = index.handoff.mode === 'required-read' ? 10_000 : 0;
    const queryScore = queryText && `${index.summary}\n${index.readWhen.text}`.toLocaleLowerCase().includes(queryText.toLocaleLowerCase()) ? 50 : 0;
    const recency = Math.min(10, Math.max(0, Date.parse(index.updatedAt) / 1e14));
    return requiredScore + targetScore + queryScore + index.confidence * 10 + recency;
  }

  private listManifestDeliveries(memoryId: string, context: MemoryRequestContext, targetStepAttemptId?: string): ManifestDeliveryMatch[] {
    if (!context.runId || !context.agentId || !targetStepAttemptId) return [];
    if (!this.isRunParticipant(context, context.runId)) return [];
    const rows = this.db.prepare(`
      SELECT
        handoff.id AS handoff_id,
        target.target_step_attempt_id,
        target.target_agent_id,
        receipt.status AS receipt_status,
        handoff.mode AS handoff_mode,
        handoff.detail_version AS handoff_detail_version,
        handoff.index_snapshot_json
      FROM memory_handoffs handoff
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      JOIN memory_handoff_targets target ON target.handoff_id = handoff.id
      LEFT JOIN memory_handoff_receipts receipt
        ON receipt.handoff_id = handoff.id
        AND receipt.target_step_attempt_id = target.target_step_attempt_id
        AND receipt.detail_version = handoff.detail_version
      WHERE handoff.memory_id = ?
        AND batch.run_id = ? AND target.target_step_attempt_id = ? AND target.target_agent_id = ?
        AND handoff.status = 'resolved' AND batch.status = 'emitted'
      ORDER BY handoff.created_at ASC, handoff.id ASC
    `).all(memoryId, context.runId, targetStepAttemptId, context.agentId) as HandoffDeliveryRow[];
    return rows.map((row) => {
      const snapshot = this.parseHandoffIndexSnapshot(row.index_snapshot_json);
      const matchingSnapshot = snapshot
        && snapshot.memoryId === memoryId
        && snapshot.detailVersion === Number(row.handoff_detail_version)
        ? snapshot
        : undefined;
      const handoffMode = matchingSnapshot?.handoff.mode ?? row.handoff_mode;
      return {
        delivery: {
          handoffId: row.handoff_id,
          targetStepAttemptId: row.target_step_attempt_id,
          targetAgentId: row.target_agent_id,
          requiredRead: handoffMode === 'required-read',
          receiptStatus: row.receipt_status ? row.receipt_status as MemoryHandoffReceiptStatus : undefined,
        },
        indexSnapshot: matchingSnapshot,
      };
    });
  }

  private toFtsQuery(input: string): string {
    const terms = input
      .split(/\s+/)
      .map((term) => term.replace(/[^\p{L}\p{N}_-]/gu, ''))
      .filter(Boolean)
      .slice(0, 12);
    if (!terms.length) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'search query has no searchable terms');
    return terms.map((term) => `"${term.replace(/"/g, '')}"`).join(' AND ');
  }

  private normalizeResolvedHandoffDeliveries(
    input: EmitResolvedHandoffDeliveryInput[] | undefined,
  ): NormalizedResolvedHandoffDelivery[] {
    if (!Array.isArray(input) || !input.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff batch requires deliveries');
    }
    const deliveries = input.map((delivery) => {
      if (!delivery || typeof delivery !== 'object') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff delivery is invalid');
      }
      const expectedMode = text(delivery.expectedMode);
      const expectedTarget = text(delivery.expectedTarget);
      if (!HANDOFF_MODE_SET.has(expectedMode) || expectedMode === 'none') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff delivery expectedMode is invalid');
      }
      if (!HANDOFF_TARGET_SET.has(expectedTarget) || expectedTarget === 'none') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff delivery expectedTarget is invalid');
      }
      return {
        memoryId: requireText(delivery.memoryId, 'resolved handoff delivery memoryId'),
        detailVersion: requirePositiveInteger(delivery.detailVersion, 'resolved handoff delivery detailVersion'),
        expectedMode: expectedMode as NormalizedResolvedHandoffDelivery['expectedMode'],
        expectedTarget: expectedTarget as NormalizedResolvedHandoffDelivery['expectedTarget'],
      };
    });
    if (new Set(deliveries.map((delivery) => delivery.memoryId)).size !== deliveries.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff deliveries cannot duplicate a memory ID');
    }
    return deliveries;
  }

  private normalizeServerHandoffTargetPlan(
    nextTargetInput: MemoryHandoffResolvedTarget | undefined,
    candidateTargetsInput: MemoryHandoffResolvedTarget[] | undefined,
  ): NormalizedServerHandoffTargetPlan {
    if (!Array.isArray(candidateTargetsInput)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'server handoff candidateTargets must be an array');
    }
    const candidateTargets = candidateTargetsInput.map((target) => this.normalizeResolvedHandoffTarget(target));
    if (new Set(candidateTargets.map((target) => target.targetStepAttemptId)).size !== candidateTargets.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'server handoff candidate target step attempts must be unique');
    }
    return {
      ...(nextTargetInput === undefined ? {} : { nextTarget: this.normalizeResolvedHandoffTarget(nextTargetInput) }),
      candidateTargets,
    };
  }

  private normalizeResolvedHandoffTarget(input: MemoryHandoffResolvedTarget): NormalizedResolvedHandoffTarget {
    if (!input || typeof input !== 'object') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'resolved handoff target is invalid');
    }
    return {
      targetStepAttemptId: requireText(input.targetStepAttemptId, 'resolved handoff targetStepAttemptId'),
      targetAgentId: requireText(input.targetAgentId, 'resolved handoff targetAgentId'),
      stepId: text(input.stepId) || undefined,
      workflowState: text(input.workflowState) || undefined,
      stepTags: uniqueStrings(input.stepTags, 64, 160),
      channelIds: uniqueStrings(input.channelIds, 64, 160),
    };
  }

  private prepareResolvedHandoffDeliveries(
    deliveries: NormalizedResolvedHandoffDelivery[],
    targetPlan: NormalizedServerHandoffTargetPlan,
    context: MemoryRequestContext,
    runId: string,
  ): PreparedResolvedHandoffDelivery[] {
    return deliveries.map((delivery) => {
      const memory = this.requireMemoryRow(delivery.memoryId);
      this.assertReadable(memory, context, true);
      if (Number(memory.detail_version) !== delivery.detailVersion) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff delivery detail revision is stale');
      }
      const liveIndex = this.rowToIndex(memory);
      const selector = normalizeHandoff(liveIndex.handoff);
      if (selector.mode === 'none' || selector.target === 'none') {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'memory with handoff none cannot be resolved for delivery');
      }
      if (selector.mode !== delivery.expectedMode || selector.target !== delivery.expectedTarget) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff delivery selector changed from its server-observed value');
      }
      const targets = this.resolveServerHandoffTargets(selector, targetPlan);
      this.assertResolvedHandoffTargets(
        selector,
        targets,
        context,
        runId,
        this.listMemoryChannelBindingIds(memory.id),
      );
      const requiredReadExtractHash = this.getFrozenHandoffDetailExtractHash(
        memory.id,
        delivery.detailVersion,
        selector.mode === 'required-read',
      );
      return {
        memory,
        index: { ...liveIndex, handoff: selector },
        selector,
        targets,
        ...(requiredReadExtractHash ? { requiredReadExtractHash } : {}),
      };
    });
  }

  private assertResolvedHandoffBatchReplay(
    handoffs: MemoryHandoffRecord[],
    deliveries: NormalizedResolvedHandoffDelivery[],
    targetPlan: NormalizedServerHandoffTargetPlan,
  ): void {
    if (handoffs.length !== deliveries.length) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'idempotent resolved handoff replay changed its memory deliveries');
    }
    const handoffByMemoryId = new Map(handoffs.map((handoff) => [handoff.memoryId, handoff]));
    if (handoffByMemoryId.size !== handoffs.length) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'resolved handoff batch has duplicate frozen memory deliveries');
    }
    for (const delivery of deliveries) {
      const handoff = handoffByMemoryId.get(delivery.memoryId);
      if (!handoff || handoff.status !== 'resolved') {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'emitted handoff batch is not fully resolved');
      }
      if (handoff.detailVersion !== delivery.detailVersion) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'idempotent resolved handoff replay changed frozen detail revision');
      }
      const selector = normalizeHandoff(handoff.target);
      if (
        handoff.mode !== delivery.expectedMode
        || selector.mode !== delivery.expectedMode
        || selector.target !== delivery.expectedTarget
      ) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'idempotent resolved handoff replay changed frozen selector');
      }
      const requestedTargets = this.resolveServerHandoffTargets(selector, targetPlan)
        .map((target) => `${target.targetStepAttemptId}\n${target.targetAgentId}`)
        .sort();
      const existingTargets = handoff.resolvedTargets
        .map((target) => `${target.targetStepAttemptId}\n${target.targetAgentId}`)
        .sort();
      if (
        requestedTargets.length !== existingTargets.length
        || requestedTargets.some((target, index) => target !== existingTargets[index])
      ) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'idempotent resolved handoff replay changed frozen targets');
      }
    }
  }

  private insertResolvedHandoffDelivery(
    batchId: string,
    delivery: PreparedResolvedHandoffDelivery,
    context: MemoryRequestContext,
    runId: string,
    sourceEventId: string,
    now: string,
  ): string {
    const handoffId = randomUUID();
    this.db.prepare(`
      INSERT INTO memory_handoffs (
        id, batch_id, memory_id, detail_version, mode, target_selector_json,
        index_snapshot_json, resolved_targets_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'resolved', ?, ?)
    `).run(
      handoffId,
      batchId,
      delivery.memory.id,
      delivery.index.detailVersion,
      delivery.selector.mode,
      stableJson(delivery.selector),
      stableJson(this.toHandoffIndexSnapshot(delivery.index)),
      now,
      now,
    );
    const insertTarget = this.db.prepare(`
      INSERT INTO memory_handoff_targets (
        id, handoff_id, target_step_attempt_id, target_agent_id, status, resolved_at
      ) VALUES (?, ?, ?, ?, 'resolved', ?)
    `);
    const insertReceipt = delivery.selector.mode === 'required-read'
      ? this.db.prepare(`
        INSERT INTO memory_handoff_receipts (
          id, handoff_id, target_step_attempt_id, target_agent_id, detail_version,
          extract_hash, status, failure_code, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
      `)
      : undefined;
    for (const target of delivery.targets) {
      insertTarget.run(
        randomUUID(),
        handoffId,
        target.targetStepAttemptId,
        target.targetAgentId,
        now,
      );
      if (insertReceipt) {
        insertReceipt.run(
          randomUUID(),
          handoffId,
          target.targetStepAttemptId,
          target.targetAgentId,
          delivery.index.detailVersion,
          delivery.requiredReadExtractHash!,
          now,
          now,
        );
      }
    }
    const targets = this.listHandoffTargets(handoffId);
    this.db.prepare(`
      UPDATE memory_handoffs
      SET resolved_targets_json = ?, updated_at = ?
      WHERE id = ?
    `).run(stableJson(targets), now, handoffId);
    this.insertAudit({
      memoryId: delivery.memory.id,
      action: 'handoff',
      actor: this.actorLabel(context),
      sourceEventId: `${sourceEventId}:handoff:${handoffId}`,
      idempotencyKey: `resolved-handoff:${handoffId}`,
      decision: {
        handoffId,
        runId,
        memoryId: delivery.memory.id,
        detailVersion: delivery.index.detailVersion,
        selector: delivery.selector,
        targets,
      },
      createdAt: now,
    });
    return handoffId;
  }

  private prepareRetryHandoff(
    handoff: PersistedHandoffRow,
    retryTarget: NormalizedResolvedHandoffTarget,
    context: MemoryRequestContext,
    runId: string,
  ): PreparedRetryHandoff {
    const selector = normalizeHandoff(parseJson<MemoryHandoff>(
      handoff.target_selector_json,
      { mode: 'none', target: 'none' },
    ));
    if (selector.mode !== handoff.mode || selector.mode === 'none' || selector.target === 'none') {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'retry handoff selector does not match its frozen delivery mode');
    }
    this.assertResolvedHandoffTargets(
      selector,
      [retryTarget],
      context,
      runId,
      this.listMemoryChannelBindingIds(handoff.memory_id),
    );
    const existingTarget = this.db.prepare(`
      SELECT target_agent_id FROM memory_handoff_targets
      WHERE handoff_id = ? AND target_step_attempt_id = ?
    `).get(handoff.id, retryTarget.targetStepAttemptId) as { target_agent_id?: string } | undefined;
    if (existingTarget && existingTarget.target_agent_id !== retryTarget.targetAgentId) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'retry target step attempt was already resolved to another agent');
    }
    const existingReceipt = this.db.prepare(`
      SELECT target_agent_id FROM memory_handoff_receipts
      WHERE handoff_id = ? AND target_step_attempt_id = ? AND detail_version = ?
    `).get(
      handoff.id,
      retryTarget.targetStepAttemptId,
      handoff.detail_version,
    ) as { target_agent_id?: string } | undefined;
    if (handoff.mode !== 'required-read') {
      if (existingReceipt) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'non-required handoff cannot have a retry receipt');
      }
      return {
        handoff,
        selector,
        needsTargetInsert: !existingTarget,
      };
    }
    if (Boolean(existingTarget) !== Boolean(existingReceipt)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'required-read retry target and receipt must be persisted together');
    }
    if (existingReceipt && existingReceipt.target_agent_id !== retryTarget.targetAgentId) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'retry receipt step attempt was already resolved to another agent');
    }
    const needsTargetInsert = !existingTarget;
    const requiredReadExtractHash = needsTargetInsert
      ? this.getFrozenHandoffDetailExtractHash(handoff.memory_id, handoff.detail_version, true)
      : undefined;
    return {
      handoff,
      selector,
      needsTargetInsert,
      ...(requiredReadExtractHash ? { requiredReadExtractHash } : {}),
    };
  }

  private resolveServerHandoffTargets(
    selector: MemoryHandoff,
    targetPlan: NormalizedServerHandoffTargetPlan,
  ): NormalizedResolvedHandoffTarget[] {
    let targets: NormalizedResolvedHandoffTarget[];
    switch (selector.target) {
      case 'next-step':
        targets = targetPlan.nextTarget ? [targetPlan.nextTarget] : [];
        break;
      case 'matching-steps':
        targets = targetPlan.candidateTargets.filter((target) => {
          if (selector.stepIds?.length && (!target.stepId || !selector.stepIds.includes(target.stepId))) return false;
          if (selector.workflowStates?.length && (!target.workflowState || !selector.workflowStates.includes(target.workflowState))) return false;
          if (selector.stepTags?.length && !selector.stepTags.some((tag) => target.stepTags.includes(tag))) return false;
          return true;
        });
        break;
      case 'named-agents':
        targets = targetPlan.candidateTargets.filter((target) => !!selector.agentIds?.includes(target.targetAgentId));
        break;
      default:
        targets = [];
        break;
    }
    if (!targets.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'persisted handoff selector has no server-derived target');
    }
    return targets;
  }

  private assertResolvedHandoffTargets(
    selector: MemoryHandoff,
    targets: NormalizedResolvedHandoffTarget[],
    context: MemoryRequestContext,
    runId: string,
    channelBindingIds: string[],
  ): void {
    if (!targets.length || selector.mode === 'none' || selector.target === 'none') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'a resolved handoff requires a concrete target selector');
    }
    if (selector.target === 'next-step' && targets.length !== 1) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'next-step handoff must resolve exactly one target step attempt');
    }
    for (const target of targets) {
      if (selector.target === 'matching-steps') {
        if (selector.stepIds?.length && (!target.stepId || !selector.stepIds.includes(target.stepId))) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required step ID');
        }
        if (selector.workflowStates?.length && (!target.workflowState || !selector.workflowStates.includes(target.workflowState))) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required workflow state');
        }
        if (selector.stepTags?.length && !selector.stepTags.some((tag) => target.stepTags.includes(tag))) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target does not match the required step tags');
        }
      }
      if (selector.target === 'named-agents' && !selector.agentIds?.includes(target.targetAgentId)) {
        throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target is not named by the memory contract');
      }
      this.assertRunParticipant({ ...context, agentId: target.targetAgentId }, runId);
      if (channelBindingIds.length) {
        const candidateChannels = target.channelIds.filter((channelId) => channelBindingIds.includes(channelId));
        if (!candidateChannels.length) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'resolved handoff target is not authorized for the memory channel');
        }
        const targetContext = { ...context, agentId: target.targetAgentId };
        if (!candidateChannels.some((channelId) => this.isRunChannelMember(
          { ...targetContext, channelId },
          runId,
          channelId,
        ))) {
          throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'server channel member snapshot does not authorize the resolved handoff target');
        }
      }
    }
  }

  private listMemoryChannelBindingIds(memoryId: string): string[] {
    return (this.db.prepare(`
      SELECT scope_key FROM memory_scope_bindings
      WHERE memory_id = ? AND binding_role = 'relevance' AND scope_type = 'channel'
      ORDER BY scope_key ASC
    `).all(memoryId) as Array<{ scope_key?: unknown }>)
      .map((row) => text(row.scope_key))
      .filter(Boolean);
  }

  private getFrozenHandoffDetailExtractHash(
    memoryId: string,
    detailVersion: number,
    requiredRead: boolean,
  ): string | undefined {
    const detail = this.db.prepare(`
      SELECT required_read_extract_hash FROM memory_details
      WHERE memory_id = ? AND detail_version = ?
    `).get(memoryId, detailVersion) as { required_read_extract_hash?: string | null } | undefined;
    if (!detail) {
      throw new MemoryServiceError('MEMORY_NOT_FOUND', 'frozen handoff detail revision was not found');
    }
    if (!requiredRead) return undefined;
    const extractHash = text(detail.required_read_extract_hash);
    if (!extractHash) {
      throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read handoff has no versioned extract');
    }
    return extractHash;
  }

  private listBatchHandoffRecords(batchId: string): MemoryHandoffRecord[] {
    return (this.db.prepare(`
      SELECT * FROM memory_handoffs
      WHERE batch_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(batchId) as SqliteRow[]).map((row) => this.rowToHandoff(row));
  }

  private normalizeDeliveries(input: MemoryHandoffDeliveryInput[] | undefined): MemoryHandoffDeliveryInput[] {
    if (!input) return [];
    if (!Array.isArray(input)) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff deliveries must be an array');
    const result = input.map((delivery) => ({ memoryId: requireText(delivery?.memoryId, 'handoff delivery memoryId') }));
    if (new Set(result.map((delivery) => delivery.memoryId)).size !== result.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'handoff deliveries cannot duplicate a memory ID');
    }
    return result;
  }

  private assertBatchDeliveryShape(status: MemoryHandoffBatchStatus, deliveries: MemoryHandoffDeliveryInput[]): void {
    if (status === 'emitted') {
      if (!deliveries.length) throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'emitted handoff batch requires deliveries');
      return;
    }
    if (deliveries.length) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${status} handoff batch cannot contain deliveries`);
    }
  }

  private assertBatchStatusTransition(from: MemoryHandoffBatchStatus, to: MemoryHandoffBatchStatus): void {
    if (!BATCH_STATUS_TRANSITIONS[from].includes(to)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', `handoff batch cannot transition from ${from} to ${to}`);
    }
  }

  private assertBatchHasNoDeliveries(batchId: string): void {
    const row = this.db.prepare('SELECT 1 FROM memory_handoffs WHERE batch_id = ? LIMIT 1').get(batchId);
    if (row) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff batch with persisted deliveries cannot change lifecycle state');
    }
  }

  private assertBatchDeliveryEquals(batchId: string, deliveries: MemoryHandoffDeliveryInput[]): void {
    const existing = (this.db.prepare(`
      SELECT memory_id FROM memory_handoffs WHERE batch_id = ? ORDER BY memory_id ASC
    `).all(batchId) as Array<{ memory_id: string }>).map((row) => row.memory_id);
    const requested = deliveries.map((delivery) => delivery.memoryId).sort();
    if (existing.length !== requested.length || existing.some((memoryId, index) => memoryId !== requested[index])) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'idempotent handoff batch retry changed its memory deliveries');
    }
  }

  private insertHandoffDelivery(batchId: string, delivery: MemoryHandoffDeliveryInput, context: MemoryRequestContext, now: string): void {
    const memory = this.requireMemoryRow(delivery.memoryId);
    this.assertReadable(memory, context, true);
    const index = this.rowToIndex(memory);
    if (index.handoff.mode === 'none') throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'memory with handoff none cannot be delivered');
    this.db.prepare(`
      INSERT INTO memory_handoffs (
        id, batch_id, memory_id, detail_version, mode, target_selector_json,
        index_snapshot_json, resolved_targets_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 'pending', ?, ?)
    `).run(
      randomUUID(),
      batchId,
      memory.id,
      memory.detail_version,
      index.handoff.mode,
      stableJson(index.handoff),
      stableJson(this.toHandoffIndexSnapshot(index)),
      now,
      now,
    );
  }

  private requireHandoffRow(handoffId: string): SqliteRow & { id: string; memory_id: string; detail_version: number; mode: string; status: string; target_selector_json: string } {
    const row = this.db.prepare('SELECT * FROM memory_handoffs WHERE id = ?').get(handoffId) as (SqliteRow & { id: string; memory_id: string; detail_version: number; mode: string; status: string; target_selector_json: string }) | undefined;
    if (!row) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'handoff was not found');
    return row;
  }

  private requireBatchForHandoff(handoffId: string): SqliteRow & { run_id: string; status: MemoryHandoffBatchStatus } {
    const row = this.db.prepare(`
      SELECT batch.* FROM memory_handoff_batches batch
      JOIN memory_handoffs handoff ON handoff.batch_id = batch.id
      WHERE handoff.id = ?
    `).get(handoffId) as (SqliteRow & { run_id: string; status: MemoryHandoffBatchStatus }) | undefined;
    if (!row) throw new MemoryServiceError('MEMORY_NOT_FOUND', 'handoff batch was not found');
    return row;
  }

  private requireHandoffForRead(input: ReadMemoryDetailsInput, item: MemoryItemRow, detail: MemoryDetailRow): { id: string; mode: string } {
    const handoffId = requireText(input.handoffId, 'handoffId');
    const handoff = this.requireHandoffRow(handoffId);
    if (handoff.memory_id !== item.id || Number(handoff.detail_version) !== Number(detail.detail_version)) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff does not authorize this memory detail revision');
    }
    this.assertHandoffTargetContext(input.context, handoffId, input.targetStepAttemptId, input.context.agentId);
    return { id: handoff.id, mode: handoff.mode };
  }

  private assertHandoffTargetContext(
    context: MemoryRequestContext,
    handoffId: string,
    targetStepAttemptId: string | undefined,
    targetAgentId: string | undefined,
  ): void {
    const stepAttemptId = requireText(targetStepAttemptId, 'targetStepAttemptId');
    const agentId = requireText(targetAgentId, 'targetAgentId');
    if (context.stepAttemptId !== stepAttemptId) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'target step attempt does not match server context');
    }
    if (context.agentId !== agentId) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'target agent does not match server context');
    const target = this.db.prepare(`
      SELECT target.* FROM memory_handoff_targets target
      JOIN memory_handoffs handoff ON handoff.id = target.handoff_id
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      WHERE target.handoff_id = ? AND target.target_step_attempt_id = ? AND target.target_agent_id = ?
        AND batch.run_id = ?
        AND batch.status = 'emitted' AND target.status = 'resolved' AND handoff.status = 'resolved'
    `).get(handoffId, stepAttemptId, agentId, context.runId ?? '') as SqliteRow | undefined;
    if (!target) throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'handoff is not resolved to this target step and agent');
    this.assertRunParticipant(context, context.runId ?? '');
  }

  private hasRequiredReadHandoff(memoryId: string, detailVersion: number): boolean {
    const row = this.db.prepare(`
      SELECT 1
      FROM memory_handoffs handoff
      JOIN memory_handoff_batches batch ON batch.id = handoff.batch_id
      WHERE handoff.memory_id = ? AND handoff.detail_version = ?
        AND handoff.mode = 'required-read' AND handoff.status = 'resolved' AND batch.status = 'emitted'
      LIMIT 1
    `).get(memoryId, detailVersion);
    return !!row;
  }

  private markRequiredRead(input: RecordHandoffReceiptInput, now: string): MemoryHandoffReceiptRecord {
    const handoffId = requireText(input.handoffId, 'handoffId');
    const handoff = this.requireHandoffRow(handoffId);
    if (handoff.mode !== 'required-read') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'only required-read handoffs have receipts');
    }
    const status = text(input.status);
    if (!RECEIPT_STATUS_SET.has(status) || status === 'acknowledged') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'receipt status is invalid');
    }
    this.assertHandoffTargetContext(input.context, handoffId, input.targetStepAttemptId, input.targetAgentId);
    if (Number(input.detailVersion) !== Number(handoff.detail_version)) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'receipt detail revision does not match handoff');
    }
    const receipt = this.requireReceipt(handoffId, input.targetStepAttemptId, handoff.detail_version);
    const expectedHash = this.db.prepare(`
      SELECT required_read_extract_hash FROM memory_details WHERE memory_id = ? AND detail_version = ?
    `).get(handoff.memory_id, handoff.detail_version) as { required_read_extract_hash?: string | null } | undefined;
    const extractHash = text(input.extractHash);
    if (handoff.mode === 'required-read' && expectedHash?.required_read_extract_hash && extractHash && extractHash !== expectedHash.required_read_extract_hash) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'receipt extract hash does not match required-read extract');
    }
    const allowed = new Set<string>();
    if (receipt.status === 'pending') ['read', 'failed', 'cancelled', 'retrying'].forEach((value) => allowed.add(value));
    if (receipt.status === 'retrying') ['read', 'failed', 'cancelled'].forEach((value) => allowed.add(value));
    if (receipt.status === 'read') ['failed', 'cancelled'].forEach((value) => allowed.add(value));
    if (receipt.status === status) return this.rowToReceipt(receipt);
    if (!allowed.has(status)) throw new MemoryServiceError('MEMORY_CONFLICT', 'receipt state transition is not allowed');
    this.db.prepare(`
      UPDATE memory_handoff_receipts
      SET status = ?, extract_hash = COALESCE(?, extract_hash), failure_code = ?, updated_at = ?
      WHERE id = ?
    `).run(status, extractHash || null, text(input.failureCode) || null, now, receipt.id);
    this.insertAudit({
      memoryId: handoff.memory_id,
      action: 'receipt',
      actor: this.actorLabel(input.context),
      sourceEventId: `receipt:${handoffId}:${input.targetStepAttemptId}:${now}`,
      idempotencyKey: randomUUID(),
      decision: { handoffId, targetStepAttemptId: input.targetStepAttemptId, status, detailVersion: handoff.detail_version },
      reason: text(input.failureCode) || undefined,
      createdAt: now,
    });
    recordMemoryV2ReceiptStatus(status as 'pending' | 'read' | 'failed' | 'cancelled' | 'retrying');
    return this.rowToReceipt(this.db.prepare('SELECT * FROM memory_handoff_receipts WHERE id = ?').get(receipt.id) as SqliteRow);
  }

  private requireReceipt(handoffId: string, targetStepAttemptId: string, detailVersion: number): SqliteRow & { id: string; status: string } {
    const receipt = this.db.prepare(`
      SELECT * FROM memory_handoff_receipts
      WHERE handoff_id = ? AND target_step_attempt_id = ? AND detail_version = ?
    `).get(requireText(handoffId, 'handoffId'), requireText(targetStepAttemptId, 'targetStepAttemptId'), detailVersion) as (SqliteRow & { id: string; status: string }) | undefined;
    if (!receipt) {
      recordMemoryV2BlockedRequiredRead();
      throw new MemoryServiceError('MEMORY_REQUIRED_READ_BLOCKED', 'required-read receipt was not initialized for this target');
    }
    return receipt;
  }

  private isRunParticipant(context: MemoryRequestContext, runId: string): boolean {
    const agentId = text(context.agentId);
    if (!agentId || !runId) return false;
    const row = this.db.prepare(`
      SELECT 1 FROM run_participants
      WHERE run_id = ? AND agent_id = ? AND owner_user_id = ? AND workspace_id = ? AND revoked_at IS NULL
      ORDER BY membership_version DESC
      LIMIT 1
    `).get(runId, agentId, context.ownerUserId, context.workspaceId);
    return !!row;
  }

  private assertRunParticipant(context: MemoryRequestContext, runId: string): void {
    if (!this.isRunParticipant(context, runId)) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'server participant snapshot does not authorize this agent in the workflow run');
    }
  }

  private isRunChannelMember(context: MemoryRequestContext, runId: string, channelId: string): boolean {
    const agentId = text(context.agentId);
    if (!agentId || !runId || !channelId) return false;
    const row = this.db.prepare(`
      SELECT 1 FROM run_channel_members
      WHERE run_id = ? AND channel_id = ? AND agent_id = ?
        AND owner_user_id = ? AND workspace_id = ? AND revoked_at IS NULL
      ORDER BY membership_version DESC
      LIMIT 1
    `).get(runId, channelId, agentId, context.ownerUserId, context.workspaceId);
    return !!row;
  }

  private assertRunChannelMember(context: MemoryRequestContext, runId: string, channelId: string): void {
    if (!this.isRunChannelMember(context, runId, channelId)) {
      throw new MemoryServiceError('MEMORY_UNAUTHORIZED', 'server channel member snapshot does not authorize this agent');
    }
  }

  private listHandoffTargets(handoffId: string): Array<{ targetStepAttemptId: string; targetAgentId: string }> {
    return (this.db.prepare(`
      SELECT target_step_attempt_id, target_agent_id
      FROM memory_handoff_targets WHERE handoff_id = ?
      ORDER BY target_step_attempt_id ASC, target_agent_id ASC
    `).all(handoffId) as Array<{ target_step_attempt_id: string; target_agent_id: string }>).map((row) => ({
      targetStepAttemptId: row.target_step_attempt_id,
      targetAgentId: row.target_agent_id,
    }));
  }

  private getHandoffRecord(handoffId: string): MemoryHandoffRecord | null {
    const row = this.db.prepare('SELECT * FROM memory_handoffs WHERE id = ?').get(handoffId) as SqliteRow | undefined;
    return row ? this.rowToHandoff(row) : null;
  }

  private rowToBatch(row: SqliteRow): MemoryHandoffBatchRecord {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      sourceStepAttemptId: String(row.source_step_attempt_id),
      sourceEventId: String(row.source_event_id),
      status: String(row.status) as MemoryHandoffBatchRecord['status'],
      parentRunId: text(row.parent_run_id) || undefined,
      parentStepAttemptId: text(row.parent_step_attempt_id) || undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private rowToHandoff(row: SqliteRow): MemoryHandoffRecord {
    const id = String(row.id);
    const snapshot = this.parseHandoffIndexSnapshot(row.index_snapshot_json);
    const indexSnapshot = snapshot
      && snapshot.memoryId === String(row.memory_id)
      && snapshot.detailVersion === Number(row.detail_version)
      ? snapshot
      : undefined;
    return {
      id,
      batchId: String(row.batch_id),
      memoryId: String(row.memory_id),
      detailVersion: Number(row.detail_version),
      mode: String(row.mode) as MemoryHandoffRecord['mode'],
      target: parseJson<MemoryHandoff>(row.target_selector_json, { mode: 'none', target: 'none' }),
      status: String(row.status) as MemoryHandoffStatus,
      ...(indexSnapshot ? { indexSnapshot } : {}),
      resolvedTargets: this.listHandoffTargets(id),
    };
  }

  private rowToReceipt(row: SqliteRow): MemoryHandoffReceiptRecord {
    return {
      id: String(row.id),
      handoffId: String(row.handoff_id),
      targetStepAttemptId: String(row.target_step_attempt_id),
      targetAgentId: String(row.target_agent_id),
      detailVersion: Number(row.detail_version),
      extractHash: text(row.extract_hash) || undefined,
      status: String(row.status) as MemoryHandoffReceiptStatus,
      failureCode: text(row.failure_code) || undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }

  private normalizeArtifactPath(input: string): string {
    const raw = requireText(input, 'artifact relativePath').replace(/\\/g, '/');
    if (isAbsolute(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith('//') || raw.includes('\0')) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'artifact path must be relative to the run outputs directory');
    }
    const segments = raw.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'artifact path escapes or is not relative to the run outputs directory');
    }
    return segments.join('/');
  }

  private rowToArtifactRef(row: SqliteRow): MemoryArtifactRef {
    return {
      id: String(row.id),
      memoryId: String(row.memory_id),
      detailVersion: Number(row.detail_version),
      runId: String(row.run_id),
      artifactKind: String(row.artifact_kind) as MemoryArtifactRef['artifactKind'],
      relativePath: String(row.relative_path),
      contentHash: String(row.content_hash),
      createdAt: String(row.created_at),
    };
  }

  private actorLabel(context: MemoryRequestContext): string {
    return [context.actor, text(context.actorId) || text(context.agentId) || 'server'].join(':');
  }

  private upsertMetadata(key: string, value: string, updatedAt: string): void {
    this.db.prepare(`
      INSERT INTO memory_v2_metadata (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, updatedAt);
  }

  /**
   * The first fresh-start scan establishes a metadata-only archive baseline.
   * Later enablement must prove the exact same archive inventory and hashes;
   * accepting a second hash would hide a legacy-content mutation.
   */
  private assertLegacyArchiveRegistryMatches(archives: readonly LegacyArchiveMetadata[]): void {
    const expected = new Map<string, string>();
    for (const archive of archives) {
      const sourcePath = requireText(archive.sourcePath, 'legacy archive sourcePath');
      const sourceType = requireText(archive.sourceType, 'legacy archive sourceType');
      if (!['sqlite', 'yaml', 'json', 'run-output', 'other'].includes(sourceType)) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'legacy archive sourceType is invalid');
      }
      const contentHash = requireSha256(archive.contentHash, 'legacy archive contentHash');
      const key = `${sourcePath}\n${sourceType}`;
      if (expected.has(key)) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'legacy archive scan contains duplicate source metadata');
      }
      expected.set(key, contentHash);
    }

    const existing = this.db.prepare(`
      SELECT source_path, source_type, content_hash
      FROM legacy_archive_registry
      ORDER BY source_path ASC, source_type ASC, content_hash ASC
    `).all() as Array<{ source_path?: string; source_type?: string; content_hash?: string }>;
    if (!existing.length) return;

    const baseline = new Map<string, string>();
    for (const row of existing) {
      const key = `${String(row.source_path)}\n${String(row.source_type)}`;
      const contentHash = String(row.content_hash);
      const priorHash = baseline.get(key);
      if (priorHash !== undefined && priorHash !== contentHash) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'legacy archive registry has conflicting baseline hashes');
      }
      baseline.set(key, contentHash);
    }

    if (baseline.size !== expected.size) {
      throw new MemoryServiceError('MEMORY_CONFLICT', 'legacy archive inventory changed after the fresh-start baseline');
    }
    for (const [key, contentHash] of expected) {
      if (baseline.get(key) !== contentHash) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'legacy archive hash changed after the fresh-start baseline');
      }
    }
  }

  private registerLegacyArchiveMetadataInternal(input: LegacyArchiveMetadata, now: string): void {
    const sourcePath = requireText(input.sourcePath, 'legacy archive sourcePath');
    const sourceType = requireText(input.sourceType, 'legacy archive sourceType');
    if (!['sqlite', 'yaml', 'json', 'run-output', 'other'].includes(sourceType)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'legacy archive sourceType is invalid');
    }
    const contentHash = requireSha256(input.contentHash, 'legacy archive contentHash');
    const retentionPolicy = requireText(input.retentionPolicy, 'legacy archive retentionPolicy');
    const verificationStatus = requireText(input.verificationStatus, 'legacy archive verificationStatus');
    if (!['verified-no-access', 'pending-verification'].includes(verificationStatus)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'legacy archive verificationStatus is invalid');
    }
    const archivedAt = normalizeIsoDate(input.archivedAt, 'legacy archive archivedAt') ?? now;
    this.db.prepare(`
      INSERT INTO legacy_archive_registry (
        id, source_path, source_type, content_hash, archived_at,
        retention_policy, verification_status, access_prohibited, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(source_path, source_type, content_hash) DO UPDATE SET
        archived_at = excluded.archived_at,
        retention_policy = excluded.retention_policy,
        verification_status = excluded.verification_status
    `).run(randomUUID(), sourcePath, sourceType, contentHash, archivedAt, retentionPolicy, verificationStatus, now);
    this.insertAudit({
      action: 'archive',
      actor: 'system:memory-v2',
      sourceEventId: `archive:${sha256(`${sourcePath}\n${sourceType}\n${contentHash}`)}`,
      idempotencyKey: contentHash,
      decision: { sourcePath, sourceType, contentHash, retentionPolicy, verificationStatus },
      createdAt: now,
    });
  }
}

export function createMemoryService(options: MemoryServiceOptions = {}): MemoryService {
  return new MemoryService(options);
}
