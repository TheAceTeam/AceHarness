import { getWorkspaceRoot } from '@/lib/core/app-paths';
import {
  buildAiMemoryPromptManifest,
  type AiMemoryPromptManifest,
} from '@/lib/agent/ai-memory-prompt';
import {
  createMemoryService,
  type MemoryDetailPage,
  type MemoryReadTrigger,
  type MemoryRequestContext,
} from '@/lib/memory-v2';
import { ensureMemoryV2FreshStart, type MemoryV2CutoverStatus } from './feature-flag';
import { applyMemoryV2RuntimePolicy } from './runtime-policy';
import { recordMemoryV2CutoverEvent } from './telemetry';

export interface MemoryV2ConsumerIdentity {
  ownerUserId: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  workflowId?: string;
  agentId?: string;
  channelId?: string;
  stepAttemptId?: string;
  workflowState?: string;
  stepId?: string;
  stepTags?: string[];
  projectId?: string;
}

export interface BuildMemoryV2ConsumerManifestInput extends MemoryV2ConsumerIdentity {
  trigger: Exclude<MemoryReadTrigger, 'explicit-search'>;
  queryText?: string;
}

export interface MemoryV2ConsumerManifestResult {
  status: MemoryV2CutoverStatus;
  manifest: AiMemoryPromptManifest | null;
  promptBlock: string;
  skippedReason?: string;
}

export interface ReadMemoryV2ConsumerDetailInput extends MemoryV2ConsumerIdentity {
  memoryId: string;
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
  handoffId?: string;
  targetStepAttemptId?: string;
}

export class MemoryV2ConsumerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MemoryV2ConsumerUnavailableError';
  }
}

function clean(value: string | undefined): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

function cleanList(values: string[] | undefined): string[] | undefined {
  const normalized = Array.from(new Set((values || [])
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value))));
  return normalized.length ? normalized : undefined;
}

export function buildMemoryV2RequestContext(input: MemoryV2ConsumerIdentity): MemoryRequestContext {
  const sessionId = clean(input.sessionId);
  const runId = clean(input.runId);
  const workflowId = clean(input.workflowId);
  const agentId = clean(input.agentId);
  const channelId = clean(input.channelId);
  const projectId = clean(input.projectId);
  const workspaceId = clean(input.workspaceId) || getWorkspaceRoot();
  const ownerUserId = clean(input.ownerUserId);
  if (!ownerUserId) throw new MemoryV2ConsumerUnavailableError('Memory V2 consumer is missing an authenticated owner');

  return applyMemoryV2RuntimePolicy({
    ownerUserId,
    workspaceId,
    actor: 'system',
    actorId: 'memory-v2-consumer',
    agentId,
    sessionId,
    runId,
    workflowId,
    channelId,
    stepAttemptId: clean(input.stepAttemptId),
    workflowState: clean(input.workflowState),
    stepId: clean(input.stepId),
    stepTags: cleanList(input.stepTags),
    projectIds: projectId ? [projectId] : undefined,
    authorizedAgentIds: agentId ? [agentId] : undefined,
    authorizedWorkflowIds: workflowId ? [workflowId] : undefined,
    authorizedProjectIds: projectId ? [projectId] : undefined,
    authorizedSessionIds: sessionId ? [sessionId] : undefined,
    authorizedRunIds: runId ? [runId] : undefined,
    authorizedChannelIds: channelId ? [channelId] : undefined,
  });
}

function hasStableScope(context: MemoryRequestContext): boolean {
  return Boolean(context.sessionId || (context.runId && context.workflowId));
}

export async function buildMemoryV2ConsumerManifest(
  input: BuildMemoryV2ConsumerManifestInput,
): Promise<MemoryV2ConsumerManifestResult> {
  const status = await ensureMemoryV2FreshStart();
  if (!status.ready) return { status, manifest: null, promptBlock: '', skippedReason: status.reason };

  const context = buildMemoryV2RequestContext(input);
  if (!hasStableScope(context)) {
    return {
      status,
      manifest: null,
      promptBlock: '',
      skippedReason: 'Memory V2 requires a stable frontend session or run/workflow identity',
    };
  }

  const service = createMemoryService();
  try {
    const manifest = buildAiMemoryPromptManifest({
      memoryService: service,
      context,
      trigger: input.trigger,
      queryText: clean(input.queryText),
      targetStepAttemptId: clean(input.stepAttemptId),
    });
    recordMemoryV2CutoverEvent('manifestReads');
    return { status, manifest, promptBlock: manifest.promptBlock };
  } finally {
    service.close();
  }
}

export async function readMemoryV2ConsumerDetail(
  input: ReadMemoryV2ConsumerDetailInput,
): Promise<MemoryDetailPage> {
  const status = await ensureMemoryV2FreshStart();
  if (!status.ready) {
    throw new MemoryV2ConsumerUnavailableError(status.reason || 'Memory V2 is unavailable');
  }
  const context = buildMemoryV2RequestContext(input);
  const service = createMemoryService();
  try {
    const page = service.readDetails({
      context,
      memoryId: input.memoryId,
      detailVersion: input.detailVersion,
      cursor: input.cursor,
      maxChars: input.maxChars,
      handoffId: input.handoffId,
      targetStepAttemptId: input.targetStepAttemptId,
    });
    recordMemoryV2CutoverEvent('detailReads');
    return page;
  } finally {
    service.close();
  }
}
