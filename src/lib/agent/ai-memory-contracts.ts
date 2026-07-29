import type {
  MemoryDecisionProposal,
  MemoryHandoff,
  MemoryIndexRecord,
  MemoryReadWhen,
  MemoryScopeBindingProposal,
} from '@/lib/memory-v2';

export const AI_MEMORY_NATIVE_TOOL_NAMES = [
  'memory.propose',
  'memory.read',
  'memory.search',
  'memory.resolve',
  'memory.acknowledgeRequiredRead',
] as const;

export type AiMemoryNativeToolName = (typeof AI_MEMORY_NATIVE_TOOL_NAMES)[number];

export interface AiMemoryNativeToolDefinition {
  name: AiMemoryNativeToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AiMemoryReadToolInput {
  memoryId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
  handoffId?: string;
}

export interface AiMemorySearchToolInput {
  query: string;
  maxIndexChars?: number;
  limit?: number;
}

export interface AiMemoryAcknowledgeRequiredReadToolInput {
  handoffId: string;
  detailVersion: number;
  extractHash: string;
}

export type AiMemoryParsedToolInvocation =
  | { name: 'memory.propose'; input: MemoryDecisionProposal }
  | { name: 'memory.resolve'; input: MemoryDecisionProposal }
  | { name: 'memory.read'; input: AiMemoryReadToolInput }
  | { name: 'memory.search'; input: AiMemorySearchToolInput }
  | { name: 'memory.acknowledgeRequiredRead'; input: AiMemoryAcknowledgeRequiredReadToolInput };

/**
 * The prompt-facing index deliberately excludes detail bodies, owner/workspace
 * identifiers, fingerprints, and lifecycle anchors. The service remains the
 * authority for all of those fields.
 */
export interface AiMemoryIndexView {
  memoryId: string;
  retention: MemoryIndexRecord['retention'];
  kind: string;
  summary: string;
  readWhen: MemoryReadWhen;
  handoff: MemoryHandoff;
  detailVersion: number;
  status: MemoryIndexRecord['status'];
  confidence: number;
  indexChars: number;
  source: {
    sourceAgentId?: string;
    sourceRunId?: string;
    sourceWorkflowId?: string;
    sourceStepAttemptId?: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export function toAiMemoryIndexView(index: MemoryIndexRecord): AiMemoryIndexView {
  return {
    memoryId: index.memoryId,
    retention: index.retention,
    kind: index.kind,
    summary: index.summary,
    readWhen: {
      text: index.readWhen.text,
      triggers: [...index.readWhen.triggers],
      ...(index.readWhen.workflowStates?.length ? { workflowStates: [...index.readWhen.workflowStates] } : {}),
      ...(index.readWhen.stepIds?.length ? { stepIds: [...index.readWhen.stepIds] } : {}),
      ...(index.readWhen.stepTags?.length ? { stepTags: [...index.readWhen.stepTags] } : {}),
      ...(index.readWhen.agentIds?.length ? { agentIds: [...index.readWhen.agentIds] } : {}),
      ...(index.readWhen.keywords?.length ? { keywords: [...index.readWhen.keywords] } : {}),
    },
    handoff: {
      mode: index.handoff.mode,
      target: index.handoff.target,
      ...(index.handoff.stepIds?.length ? { stepIds: [...index.handoff.stepIds] } : {}),
      ...(index.handoff.stepTags?.length ? { stepTags: [...index.handoff.stepTags] } : {}),
      ...(index.handoff.workflowStates?.length ? { workflowStates: [...index.handoff.workflowStates] } : {}),
      ...(index.handoff.agentIds?.length ? { agentIds: [...index.handoff.agentIds] } : {}),
    },
    detailVersion: index.detailVersion,
    status: index.status,
    confidence: index.confidence,
    indexChars: index.indexChars,
    source: {
      ...(index.source.sourceAgentId ? { sourceAgentId: index.source.sourceAgentId } : {}),
      ...(index.source.sourceRunId ? { sourceRunId: index.source.sourceRunId } : {}),
      ...(index.source.sourceWorkflowId ? { sourceWorkflowId: index.source.sourceWorkflowId } : {}),
      ...(index.source.sourceStepAttemptId ? { sourceStepAttemptId: index.source.sourceStepAttemptId } : {}),
    },
    createdAt: index.createdAt,
    updatedAt: index.updatedAt,
    ...(index.expiresAt ? { expiresAt: index.expiresAt } : {}),
  };
}

const readWhenSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'triggers'],
  properties: {
    text: { type: 'string', minLength: 1 },
    triggers: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        enum: ['conversation-turn', 'task-start', 'step-start', 'workflow-resume', 'explicit-search'],
      },
    },
    workflowStates: { type: 'array', items: { type: 'string', minLength: 1 } },
    stepIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    stepTags: { type: 'array', items: { type: 'string', minLength: 1 } },
    agentIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    keywords: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

const handoffSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'target'],
  properties: {
    mode: { type: 'string', enum: ['none', 'manifest', 'on-demand', 'required-read'] },
    target: { type: 'string', enum: ['none', 'next-step', 'matching-steps', 'named-agents'] },
    stepIds: { type: 'array', items: { type: 'string', minLength: 1 } },
    stepTags: { type: 'array', items: { type: 'string', minLength: 1 } },
    workflowStates: { type: 'array', items: { type: 'string', minLength: 1 } },
    agentIds: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
} as const;

const scopeBindingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scopeType', 'scopeKey'],
  properties: {
    scopeType: { type: 'string', enum: ['agent', 'workflow', 'project', 'session', 'run', 'channel'] },
    scopeKey: { type: 'string', minLength: 1 },
  },
} as const;

const proposalProperties = {
  action: { type: 'string', enum: ['discard', 'create', 'upsert', 'resolve'] },
  retention: { type: 'string', enum: ['none', 'short', 'long'] },
  scopeBindings: { type: 'array', items: scopeBindingSchema },
  summary: { type: 'string', minLength: 1 },
  readWhen: readWhenSchema,
  handoff: handoffSchema,
  details: { type: 'string', minLength: 1 },
  kind: { type: 'string', minLength: 1 },
  confidence: { type: 'number', minimum: 0, maximum: 1 },
  sourceEventId: { type: 'string', minLength: 1 },
  idempotencyKey: { type: 'string', minLength: 1 },
  targetMemoryId: { type: 'string', minLength: 1 },
  expectedDetailVersion: { type: 'integer', minimum: 1 },
  expectedFingerprint: { type: 'string', minLength: 1 },
  expiresAt: { type: 'string', format: 'date-time' },
  replacesMemoryId: { type: 'string', minLength: 1 },
} as const;

const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['action', 'retention', 'sourceEventId', 'idempotencyKey'],
  properties: proposalProperties,
  allOf: [
    {
      if: { properties: { action: { const: 'discard' } } },
      then: { properties: { retention: { const: 'none' } } },
      else: {
        required: ['scopeBindings', 'summary', 'readWhen', 'handoff', 'details', 'kind', 'confidence'],
      },
    },
    {
      if: { properties: { action: { enum: ['upsert', 'resolve'] } } },
      then: { required: ['expectedDetailVersion'] },
    },
  ],
} as const;

const resolveSchema = {
  ...proposalSchema,
  properties: {
    ...proposalProperties,
    action: { type: 'string', enum: ['resolve'] },
  },
  required: [
    'retention',
    'scopeBindings',
    'summary',
    'readWhen',
    'handoff',
    'details',
    'kind',
    'confidence',
    'sourceEventId',
    'idempotencyKey',
    'expectedDetailVersion',
  ],
} as const;

export const AI_MEMORY_NATIVE_TOOL_DEFINITIONS: readonly AiMemoryNativeToolDefinition[] = [
  {
    name: 'memory.propose',
    description: 'Submit one validated memory decision. This never accepts a lifecycle anchor, owner, workspace, visibility, or membership fields.',
    inputSchema: proposalSchema,
  },
  {
    name: 'memory.read',
    description: 'Read an authorized, versioned memory detail page only after an explicit model decision.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['memoryId', 'detailVersion'],
      properties: {
        memoryId: { type: 'string', minLength: 1 },
        detailVersion: { type: 'integer', minimum: 1 },
        cursor: { type: 'string', minLength: 1 },
        maxChars: { type: 'integer', minimum: 1 },
        handoffId: { type: 'string', minLength: 1 },
      },
    },
  },
  {
    name: 'memory.search',
    description: 'Search authorized memory indexes. Search results never contain details.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        maxIndexChars: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1 },
      },
    },
  },
  {
    name: 'memory.resolve',
    description: 'Resolve an existing memory at an expected detail revision. Target ownership remains server-derived.',
    inputSchema: resolveSchema,
  },
  {
    name: 'memory.acknowledgeRequiredRead',
    description: 'Acknowledge a required-read extract already read by this server-authorized step target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['handoffId', 'detailVersion', 'extractHash'],
      properties: {
        handoffId: { type: 'string', minLength: 1 },
        detailVersion: { type: 'integer', minimum: 1 },
        extractHash: { type: 'string', minLength: 1 },
      },
    },
  },
];

const PROPOSAL_ACTIONS = new Set<MemoryDecisionProposal['action']>(['discard', 'create', 'upsert', 'resolve']);
const RETENTIONS = new Set(['none', 'short', 'long']);
const SCOPE_TYPES = new Set<MemoryScopeBindingProposal['scopeType']>(['agent', 'workflow', 'project', 'session', 'run', 'channel']);
const TRIGGERS = new Set<MemoryReadWhen['triggers'][number]>([
  'conversation-turn',
  'task-start',
  'step-start',
  'workflow-resume',
  'explicit-search',
]);
const HANDOFF_MODES = new Set<MemoryHandoff['mode']>(['none', 'manifest', 'on-demand', 'required-read']);
const HANDOFF_TARGETS = new Set<MemoryHandoff['target']>(['none', 'next-step', 'matching-steps', 'named-agents']);

const FORBIDDEN_MODEL_CONTROL_KEYS = new Set([
  'context',
  'ownerUserId',
  'workspaceId',
  'owner_user_id',
  'workspace_id',
  'visibility',
  'authorizedAgentIds',
  'authorizedWorkflowIds',
  'authorizedProjectIds',
  'authorizedSessionIds',
  'authorizedRunIds',
  'authorizedChannelIds',
  'participants',
  'participantIds',
  'channelMembers',
  'targetAgentId',
  'targetStepAttemptId',
  'lifecycleAnchor',
]);

export class AiMemoryToolContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiMemoryToolContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new AiMemoryToolContractError(`${label} must be an object`);
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AiMemoryToolContractError(`${label} is required`);
  return value.trim();
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requireText(value, label);
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER) {
    throw new AiMemoryToolContractError(`${label} must be a positive integer`);
  }
  return Number(value);
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return requirePositiveInteger(value, label);
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedKeys.has(key)) throw new AiMemoryToolContractError(`${label}.${key} is not allowed`);
  }
}

function assertNoModelControlFields(value: unknown, label = 'arguments'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoModelControlFields(entry, `${label}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_MODEL_CONTROL_KEYS.has(key)) {
      throw new AiMemoryToolContractError(`${label}.${key} is server-derived and cannot be supplied by a model`);
    }
    assertNoModelControlFields(entry, `${label}.${key}`);
  }
}

function parseStringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new AiMemoryToolContractError(`${label} must be an array`);
  if (value.length > 64) throw new AiMemoryToolContractError(`${label} has too many values`);
  const result = Array.from(new Set(value.map((entry, index) => requireText(entry, `${label}[${index}]`))));
  return result.length ? result : undefined;
}

function parseScopeBindings(value: unknown): MemoryScopeBindingProposal[] {
  if (!Array.isArray(value)) throw new AiMemoryToolContractError('scopeBindings must be an array');
  if (value.length > 20) throw new AiMemoryToolContractError('scopeBindings has too many entries');
  const seen = new Set<string>();
  const bindings: MemoryScopeBindingProposal[] = [];
  for (const [index, entry] of value.entries()) {
    const record = requireRecord(entry, `scopeBindings[${index}]`);
    assertOnlyKeys(record, ['scopeType', 'scopeKey'], `scopeBindings[${index}]`);
    const scopeType = requireText(record.scopeType, `scopeBindings[${index}].scopeType`);
    if (!SCOPE_TYPES.has(scopeType as MemoryScopeBindingProposal['scopeType'])) {
      throw new AiMemoryToolContractError(`scopeBindings[${index}].scopeType is invalid`);
    }
    const scopeKey = requireText(record.scopeKey, `scopeBindings[${index}].scopeKey`);
    const key = `${scopeType}\n${scopeKey}`;
    if (!seen.has(key)) {
      seen.add(key);
      bindings.push({ scopeType: scopeType as MemoryScopeBindingProposal['scopeType'], scopeKey });
    }
  }
  return bindings;
}

function parseReadWhen(value: unknown): MemoryReadWhen {
  const record = requireRecord(value, 'readWhen');
  assertOnlyKeys(record, ['text', 'triggers', 'workflowStates', 'stepIds', 'stepTags', 'agentIds', 'keywords'], 'readWhen');
  if (!Array.isArray(record.triggers) || !record.triggers.length) {
    throw new AiMemoryToolContractError('readWhen.triggers must be a non-empty array');
  }
  const triggers = Array.from(new Set(record.triggers.map((entry, index) => {
    const trigger = requireText(entry, `readWhen.triggers[${index}]`) as MemoryReadWhen['triggers'][number];
    if (!TRIGGERS.has(trigger)) throw new AiMemoryToolContractError(`readWhen.triggers[${index}] is invalid`);
    return trigger;
  })));
  const workflowStates = parseStringList(record.workflowStates, 'readWhen.workflowStates');
  const stepIds = parseStringList(record.stepIds, 'readWhen.stepIds');
  const stepTags = parseStringList(record.stepTags, 'readWhen.stepTags');
  const agentIds = parseStringList(record.agentIds, 'readWhen.agentIds');
  const keywords = parseStringList(record.keywords, 'readWhen.keywords');
  return {
    text: requireText(record.text, 'readWhen.text'),
    triggers,
    ...(workflowStates?.length ? { workflowStates } : {}),
    ...(stepIds?.length ? { stepIds } : {}),
    ...(stepTags?.length ? { stepTags } : {}),
    ...(agentIds?.length ? { agentIds } : {}),
    ...(keywords?.length ? { keywords } : {}),
  };
}

function parseHandoff(value: unknown): MemoryHandoff {
  const record = requireRecord(value, 'handoff');
  assertOnlyKeys(record, ['mode', 'target', 'stepIds', 'stepTags', 'workflowStates', 'agentIds'], 'handoff');
  const mode = requireText(record.mode, 'handoff.mode') as MemoryHandoff['mode'];
  const target = requireText(record.target, 'handoff.target') as MemoryHandoff['target'];
  if (!HANDOFF_MODES.has(mode) || !HANDOFF_TARGETS.has(target)) {
    throw new AiMemoryToolContractError('handoff mode or target is invalid');
  }
  if ((mode === 'none') !== (target === 'none')) {
    throw new AiMemoryToolContractError('handoff none mode and target must be paired');
  }
  const stepIds = parseStringList(record.stepIds, 'handoff.stepIds');
  const stepTags = parseStringList(record.stepTags, 'handoff.stepTags');
  const workflowStates = parseStringList(record.workflowStates, 'handoff.workflowStates');
  const agentIds = parseStringList(record.agentIds, 'handoff.agentIds');
  if (target === 'matching-steps' && !stepIds?.length && !stepTags?.length && !workflowStates?.length) {
    throw new AiMemoryToolContractError('matching-steps requires a step selector');
  }
  if (target === 'named-agents' && !agentIds?.length) {
    throw new AiMemoryToolContractError('named-agents requires agentIds');
  }
  return {
    mode,
    target,
    ...(stepIds?.length ? { stepIds } : {}),
    ...(stepTags?.length ? { stepTags } : {}),
    ...(workflowStates?.length ? { workflowStates } : {}),
    ...(agentIds?.length ? { agentIds } : {}),
  };
}

function parseDecisionProposal(value: unknown, forcedAction?: 'resolve'): MemoryDecisionProposal {
  const record = requireRecord(value, 'memory proposal');
  assertNoModelControlFields(record, 'memory proposal');
  assertOnlyKeys(record, [
    'action',
    'retention',
    'scopeBindings',
    'summary',
    'readWhen',
    'handoff',
    'details',
    'kind',
    'confidence',
    'sourceEventId',
    'idempotencyKey',
    'targetMemoryId',
    'expectedDetailVersion',
    'expectedFingerprint',
    'expiresAt',
    'replacesMemoryId',
  ], 'memory proposal');
  const suppliedAction = optionalText(record.action, 'action');
  const action = forcedAction ?? suppliedAction;
  if (!action || !PROPOSAL_ACTIONS.has(action as MemoryDecisionProposal['action'])) {
    throw new AiMemoryToolContractError('memory proposal action is invalid');
  }
  if (forcedAction && suppliedAction && suppliedAction !== forcedAction) {
    throw new AiMemoryToolContractError('memory.resolve cannot submit another action');
  }
  const retention = requireText(record.retention, 'retention');
  if (!RETENTIONS.has(retention)) throw new AiMemoryToolContractError('retention is invalid');
  const sourceEventId = requireText(record.sourceEventId, 'sourceEventId');
  const idempotencyKey = requireText(record.idempotencyKey, 'idempotencyKey');

  if (action === 'discard') {
    if (retention !== 'none') throw new AiMemoryToolContractError('discard requires retention none');
    if (record.scopeBindings !== undefined && (!Array.isArray(record.scopeBindings) || record.scopeBindings.length > 0)) {
      throw new AiMemoryToolContractError('discard can only include an empty scopeBindings array');
    }
    if (record.handoff !== undefined) {
      const handoff = parseHandoff(record.handoff);
      if (handoff.mode !== 'none' || handoff.target !== 'none') {
        throw new AiMemoryToolContractError('discard cannot create a handoff');
      }
    }
    if (typeof record.details === 'string' && record.details.trim()) {
      throw new AiMemoryToolContractError('discard cannot persist details');
    }
    const prohibited = ['summary', 'readWhen', 'kind', 'confidence', 'expiresAt', 'targetMemoryId', 'expectedDetailVersion', 'expectedFingerprint', 'replacesMemoryId'];
    if (prohibited.some((key) => record[key] !== undefined && record[key] !== '')) {
      throw new AiMemoryToolContractError('discard cannot include writable memory fields');
    }
    return { action, retention, sourceEventId, idempotencyKey };
  }

  if (retention === 'none') throw new AiMemoryToolContractError('write proposals require short or long retention');
  const confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AiMemoryToolContractError('confidence must be a number between zero and one');
  }
  const targetMemoryId = optionalText(record.targetMemoryId, 'targetMemoryId');
  const expectedFingerprint = optionalText(record.expectedFingerprint, 'expectedFingerprint');
  const expectedDetailVersion = optionalPositiveInteger(record.expectedDetailVersion, 'expectedDetailVersion');
  const expiresAt = optionalText(record.expiresAt, 'expiresAt');
  const replacesMemoryId = optionalText(record.replacesMemoryId, 'replacesMemoryId');
  if ((action === 'upsert' || action === 'resolve') && (!targetMemoryId && !expectedFingerprint || !expectedDetailVersion)) {
    throw new AiMemoryToolContractError('upsert and resolve require a targetMemoryId or expectedFingerprint plus expectedDetailVersion');
  }
  if (action === 'create' && targetMemoryId) {
    throw new AiMemoryToolContractError('create cannot use targetMemoryId');
  }
  return {
    action: action as MemoryDecisionProposal['action'],
    retention: retention as MemoryDecisionProposal['retention'],
    scopeBindings: parseScopeBindings(record.scopeBindings),
    summary: requireText(record.summary, 'summary'),
    readWhen: parseReadWhen(record.readWhen),
    handoff: parseHandoff(record.handoff),
    details: requireText(record.details, 'details'),
    kind: requireText(record.kind, 'kind'),
    confidence,
    sourceEventId,
    idempotencyKey,
    ...(targetMemoryId ? { targetMemoryId } : {}),
    ...(expectedDetailVersion ? { expectedDetailVersion } : {}),
    ...(expectedFingerprint ? { expectedFingerprint } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(replacesMemoryId ? { replacesMemoryId } : {}),
  };
}

function parseReadInput(value: unknown): AiMemoryReadToolInput {
  const record = requireRecord(value, 'memory.read arguments');
  assertNoModelControlFields(record, 'memory.read arguments');
  assertOnlyKeys(record, ['memoryId', 'detailVersion', 'cursor', 'maxChars', 'handoffId'], 'memory.read arguments');
  const cursor = optionalText(record.cursor, 'cursor');
  const maxChars = optionalPositiveInteger(record.maxChars, 'maxChars');
  const handoffId = optionalText(record.handoffId, 'handoffId');
  return {
    memoryId: requireText(record.memoryId, 'memoryId'),
    detailVersion: requirePositiveInteger(record.detailVersion, 'detailVersion'),
    ...(cursor ? { cursor } : {}),
    ...(maxChars ? { maxChars } : {}),
    ...(handoffId ? { handoffId } : {}),
  };
}

function parseSearchInput(value: unknown): AiMemorySearchToolInput {
  const record = requireRecord(value, 'memory.search arguments');
  assertNoModelControlFields(record, 'memory.search arguments');
  assertOnlyKeys(record, ['query', 'maxIndexChars', 'limit'], 'memory.search arguments');
  const maxIndexChars = optionalPositiveInteger(record.maxIndexChars, 'maxIndexChars');
  const limit = optionalPositiveInteger(record.limit, 'limit');
  return {
    query: requireText(record.query, 'query'),
    ...(maxIndexChars ? { maxIndexChars } : {}),
    ...(limit ? { limit } : {}),
  };
}

function parseAcknowledgeInput(value: unknown): AiMemoryAcknowledgeRequiredReadToolInput {
  const record = requireRecord(value, 'memory.acknowledgeRequiredRead arguments');
  assertNoModelControlFields(record, 'memory.acknowledgeRequiredRead arguments');
  assertOnlyKeys(record, ['handoffId', 'detailVersion', 'extractHash'], 'memory.acknowledgeRequiredRead arguments');
  return {
    handoffId: requireText(record.handoffId, 'handoffId'),
    detailVersion: requirePositiveInteger(record.detailVersion, 'detailVersion'),
    extractHash: requireText(record.extractHash, 'extractHash'),
  };
}

export function isAiMemoryNativeToolName(value: unknown): value is AiMemoryNativeToolName {
  return typeof value === 'string' && (AI_MEMORY_NATIVE_TOOL_NAMES as readonly string[]).includes(value);
}

export function parseAiMemoryNativeToolInvocation(
  name: unknown,
  argumentsValue: unknown,
): AiMemoryParsedToolInvocation {
  if (!isAiMemoryNativeToolName(name)) throw new AiMemoryToolContractError('unknown AI memory tool');
  switch (name) {
    case 'memory.propose':
      return { name, input: parseDecisionProposal(argumentsValue) };
    case 'memory.resolve':
      return { name, input: parseDecisionProposal(argumentsValue, 'resolve') };
    case 'memory.read':
      return { name, input: parseReadInput(argumentsValue) };
    case 'memory.search':
      return { name, input: parseSearchInput(argumentsValue) };
    case 'memory.acknowledgeRequiredRead':
      return { name, input: parseAcknowledgeInput(argumentsValue) };
  }
}
