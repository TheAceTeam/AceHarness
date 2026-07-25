import { createHash } from 'crypto';
import {
  createMemoryService,
  type MemoryArtifactKind,
  type MemoryHandoffResolvedTarget,
  type MemoryHandoffRunState,
  type MemoryRequestContext,
  type MemoryService,
} from '@/lib/memory-v2';
import {
  prepareAiMemoryEngineTurn,
  type AiMemoryEngineTurn,
  type AiMemoryHandoffEligibleProposalReference,
} from '@/lib/agent/ai-memory-protocol';
import { createAiMemoryContinuityIdentity } from '@/lib/agent/ai-memory-session';
import type { AiMemoryManifestItemView } from '@/lib/agent/ai-memory-prompt';
import type { AiMemoryToolExecutionResult } from '@/lib/agent/ai-memory-tools';
import { applyMemoryV2RuntimePolicy } from '@/lib/memory-v2-cutover/runtime-policy';

const HANDOFF_TAG_PATTERN = /<memory-handoff>\s*([\s\S]*?)\s*<\/memory-handoff>/gi;
const HANDOFF_ARTIFACT_KINDS = new Set<MemoryArtifactKind>(['run-output', 'log', 'diff', 'generated-file']);
const HANDOFF_MODES = new Set(['manifest', 'on-demand', 'required-read']);
const HANDOFF_TARGETS = new Set(['next-step', 'matching-steps', 'named-agents']);
const TERMINAL_FALLBACK_READ_NAMES = new Set(['memory.read', 'memory.search']);
const TERMINAL_FALLBACK_MUTATION_NAMES = new Set([
  'memory.propose',
  'memory.resolve',
  'memory.acknowledgeRequiredRead',
]);

export interface WorkflowMemoryV2RunInput {
  runId: string;
  workflowId: string;
  ownerUserId?: string;
  workspaceKey: string;
  projectKey?: string;
  participantIds: string[];
  channelMembers?: Array<{
    channelId: string;
    agentIds: string[];
  }>;
}

export interface WorkflowMemoryV2Step {
  attemptId: string;
  agentId: string;
  stepId: string;
  workflowState?: string;
  stepTags?: string[];
  channelIds?: string[];
  isRetry?: boolean;
  /** The prior physical attempt that this retry supersedes, if any. */
  retryOfAttemptId?: string;
}

export interface WorkflowMemoryV2Target {
  attemptId: string;
  agentId: string;
  stepId: string;
  workflowState?: string;
  stepTags?: string[];
  channelIds?: string[];
}

export interface WorkflowMemoryV2Artifact {
  artifactKind: MemoryArtifactKind;
  relativePath: string;
  contentHash: string;
}

export interface WorkflowMemoryV2PreparedContext {
  prompt: string;
  /** The same index-only views carried in the paired Task 2 protocol manifest. */
  manifestItems: AiMemoryManifestItemView[];
  requiredReadCount: number;
  omittedCount: number;
  aiExecution: WorkflowMemoryV2AiExecution;
}

export interface WorkflowMemoryV2HandoffMetadata {
  summary: string;
  nextAction: string;
  verification: string;
  deliveryHints: Array<{
    memoryId: string;
    detailVersion: number;
    mode: 'manifest' | 'on-demand' | 'required-read';
    target: 'next-step' | 'matching-steps' | 'named-agents';
  }>;
  artifactKinds: MemoryArtifactKind[];
}

/**
 * A workflow handoff references an immutable Memory V2 detail revision. The
 * model can select a server-observed reference but cannot create one by
 * writing an arbitrary ID into a control block.
 */
export interface WorkflowMemoryV2MemoryReference {
  memoryId: string;
  detailVersion: number;
}

export interface WorkflowMemoryV2HandoffResult {
  status: 'no-op' | 'emitted';
  memoryReferences: WorkflowMemoryV2MemoryReference[];
  metadata: WorkflowMemoryV2HandoffMetadata;
}

export type WorkflowMemoryV2HandoffParseResult =
  | { ok: true; value: WorkflowMemoryV2HandoffResult }
  | { ok: false; reason: string };

export interface WorkflowMemoryV2CompleteStepInput {
  step: WorkflowMemoryV2Step;
  output: string;
  /**
   * Captured only from successful, server-executed `memory.propose` calls in
   * this exact workflow attempt. Parsed model text is never evidence.
   */
  eligibleProposalReferences: readonly AiMemoryHandoffEligibleProposalReference[];
  nextTarget?: WorkflowMemoryV2Target;
  candidateTargets?: WorkflowMemoryV2Target[];
  artifacts?: WorkflowMemoryV2Artifact[];
}

export class WorkflowMemoryV2HandoffBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowMemoryV2HandoffBlockedError';
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values: unknown, maxItems = 80): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (!normalized || normalized.length > 320 || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= maxItems) break;
  }
  return result;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}:${createHash('sha256').update(value).digest('hex')}`;
}

function sourceEventId(runId: string, attemptId: string): string {
  return `workflow-memory-v2:${runId}:${attemptId}`;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return error instanceof Error ? error.name || 'HANDOFF_FAILED' : 'HANDOFF_FAILED';
}

function safeString(value: unknown, field: string): { value?: string; reason?: string } {
  const normalized = text(value);
  if (!normalized) return { reason: `${field} is required` };
  if (normalized.length > 1_200) return { reason: `${field} exceeds the handoff result budget` };
  return { value: normalized };
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Keeps the Task 2 turn, its server-issued source event, and the subset of
 * proposal results that are eligible for a workflow handoff together. This is
 * deliberately created once per workflow step attempt and retained through
 * repair/feedback runtime calls for that same attempt.
 */
export class WorkflowMemoryV2AiExecution {
  private readonly eligibleReferences = new Map<string, AiMemoryHandoffEligibleProposalReference>();

  constructor(
    readonly sourceEventId: string,
    readonly turn: AiMemoryEngineTurn,
  ) {}

  executeStructuredFallback(rawOutput: string) {
    const result = this.turn.executeFallback(rawOutput);
    this.recordToolResults(result.toolResults);
    return result;
  }

  /**
   * The final execution has no budget for another model turn. Persist only
   * mutations whose result does not need to be shown back to the model. Read
   * and search are rejected before any call runs so their result is never
   * silently discarded and a mixed control block cannot partially mutate.
   */
  executeTerminalStructuredFallback(rawOutput: string): { visibleText: string; toolResults: AiMemoryToolExecutionResult[] } {
    const parsed = this.turn.parseFallback(rawOutput);
    if (parsed.errors.length) {
      throw new WorkflowMemoryV2HandoffBlockedError('terminal Memory V2 fallback control block is invalid');
    }
    const readRequest = parsed.calls.find((call) => TERMINAL_FALLBACK_READ_NAMES.has(call.name));
    if (readRequest) {
      throw new WorkflowMemoryV2HandoffBlockedError(
        `terminal Memory V2 fallback cannot execute ${readRequest.name} without a continuation`,
      );
    }
    const unsupportedCall = parsed.calls.find((call) => !TERMINAL_FALLBACK_MUTATION_NAMES.has(call.name));
    if (unsupportedCall) {
      throw new WorkflowMemoryV2HandoffBlockedError(
        `terminal Memory V2 fallback call ${unsupportedCall.name} is not allowed`,
      );
    }

    const toolResults = parsed.calls.map((call) => this.turn.executeNativeTool(call.name, call.arguments));
    this.recordToolResults(toolResults);
    const failed = toolResults.find((result) => !result.ok);
    if (failed && !failed.ok) {
      throw new WorkflowMemoryV2HandoffBlockedError(
        `terminal Memory V2 fallback mutation failed: ${failed.error.code}`,
      );
    }
    return { visibleText: parsed.visibleText, toolResults };
  }

  stripStructuredFallback(rawOutput: string): string {
    return this.turn.parseFallback(rawOutput).visibleText;
  }

  recordToolResults(toolResults: readonly AiMemoryToolExecutionResult[]): void {
    for (const reference of this.turn.collectHandoffEligibleProposalReferences(toolResults)) {
      if (reference.sourceEventId !== this.sourceEventId) continue;
      this.eligibleReferences.set(`${reference.memoryId}:${reference.detailVersion}`, reference);
    }
  }

  getEligibleProposalReferences(): readonly AiMemoryHandoffEligibleProposalReference[] {
    return Array.from(this.eligibleReferences.values());
  }
}

/**
 * Initial engine execution plus two continuation executions. The final
 * execution is reserved for consuming the most recent read/search result and
 * may persist only terminal mutations that do not need model consumption.
 */
export const WORKFLOW_MEMORY_V2_MAX_FALLBACK_ROUNDS = 3;

export function hasWorkflowMemoryV2FallbackContinuationBudget(round: number): boolean {
  return round + 1 < WORKFLOW_MEMORY_V2_MAX_FALLBACK_ROUNDS;
}

export function hasSuccessfulWorkflowMemoryV2FallbackRead(
  toolResults: readonly AiMemoryToolExecutionResult[],
): boolean {
  return toolResults.some((result) => result.ok && (result.name === 'memory.read' || result.name === 'memory.search'));
}

export function buildWorkflowMemoryV2FallbackContinuationPrompt(
  toolResults: readonly AiMemoryToolExecutionResult[],
  options: { terminal?: boolean } = {},
): string {
  const terminalInstruction = options.terminal
    ? 'This is the final Memory V2 continuation. Do not request memory.read or memory.search. You may submit only a final memory.propose, memory.resolve, or memory.acknowledgeRequiredRead control call if needed.'
    : 'Append one private Memory V2 fallback block only when another authorized memory action is necessary.';
  return [
    'The server executed the following authorized Memory V2 fallback calls for this workflow step attempt.',
    'Use these results only to finish the workflow step. Never expose this control data or any fallback protocol block.',
    '<memory-v2-tool-results>',
    JSON.stringify(toolResults),
    '</memory-v2-tool-results>',
    `Return the complete visible step result. ${terminalInstruction}`,
  ].join('\n');
}

/**
 * Parse only references produced by the workflow result contract. Memory
 * decisions remain owned by the V2 proposal/tool layer and are never rebuilt here.
 */
export function parseWorkflowMemoryV2Handoff(output: string): WorkflowMemoryV2HandoffParseResult {
  const matches = Array.from(String(output || '').matchAll(HANDOFF_TAG_PATTERN));
  if (!matches.length) return { ok: false, reason: 'missing <memory-handoff> result' };

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(matches[matches.length - 1][1]);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'handoff result must be a JSON object' };
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'handoff result contains invalid JSON' };
  }

  if ('details' in payload || 'rawOutput' in payload || 'output' in payload) {
    return { ok: false, reason: 'handoff result must not carry raw details or output' };
  }

  const status = text(payload.status);
  if (status !== 'no-op' && status !== 'emitted') {
    return { ok: false, reason: 'handoff result status must be no-op or emitted' };
  }

  const summary = safeString(payload.summary, 'handoff summary');
  if (summary.reason) return { ok: false, reason: summary.reason };
  const nextAction = safeString(payload.nextAction, 'handoff nextAction');
  if (nextAction.reason) return { ok: false, reason: nextAction.reason };
  const verification = safeString(payload.verification, 'handoff verification');
  if (verification.reason) return { ok: false, reason: verification.reason };

  if (!Array.isArray(payload.memoryReferences)) {
    return { ok: false, reason: 'handoff memoryReferences must be an array' };
  }
  const memoryReferences: WorkflowMemoryV2MemoryReference[] = [];
  const seenReferenceIds = new Set<string>();
  for (const candidate of payload.memoryReferences) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return { ok: false, reason: 'handoff memory reference is invalid' };
    }
    const item = candidate as Record<string, unknown>;
    const memoryId = text(item.memoryId);
    const detailVersion = positiveInteger(item.detailVersion);
    if (!memoryId || memoryId.length > 320 || !detailVersion || seenReferenceIds.has(memoryId)) {
      return { ok: false, reason: 'handoff memory references require unique memoryId and positive detailVersion' };
    }
    seenReferenceIds.add(memoryId);
    memoryReferences.push({ memoryId, detailVersion });
    if (memoryReferences.length > 64) {
      return { ok: false, reason: 'handoff memoryReferences exceed the result limit' };
    }
  }

  const deliveryHints: WorkflowMemoryV2HandoffMetadata['deliveryHints'] = [];
  if (payload.deliveries !== undefined && !Array.isArray(payload.deliveries)) {
    return { ok: false, reason: 'handoff deliveries must be an array' };
  }
  for (const candidate of Array.isArray(payload.deliveries) ? payload.deliveries : []) {
    if (!candidate || typeof candidate !== 'object') return { ok: false, reason: 'handoff delivery is invalid' };
    const item = candidate as Record<string, unknown>;
    const memoryId = text(item.memoryId);
    const detailVersion = positiveInteger(item.detailVersion);
    const mode = text(item.mode);
    const target = text(item.target);
    if (!memoryId || !detailVersion || !HANDOFF_MODES.has(mode) || !HANDOFF_TARGETS.has(target)) {
      return { ok: false, reason: 'handoff delivery must contain a memoryId, detailVersion, mode, and target' };
    }
    if (!memoryReferences.some((reference) => reference.memoryId === memoryId && reference.detailVersion === detailVersion)
      || deliveryHints.some((hint) => hint.memoryId === memoryId)) {
      return { ok: false, reason: 'handoff deliveries must map one-to-one to memoryReferences' };
    }
    deliveryHints.push({
      memoryId,
      detailVersion,
      mode: mode as WorkflowMemoryV2HandoffMetadata['deliveryHints'][number]['mode'],
      target: target as WorkflowMemoryV2HandoffMetadata['deliveryHints'][number]['target'],
    });
  }

  if (status === 'no-op' && (memoryReferences.length || deliveryHints.length)) {
    return { ok: false, reason: 'no-op handoff cannot include memory deliveries' };
  }
  if (status === 'emitted' && (!memoryReferences.length || deliveryHints.length !== memoryReferences.length)) {
    return { ok: false, reason: 'emitted handoff requires one delivery hint for each memory reference' };
  }

  const artifactKinds: MemoryArtifactKind[] = [];
  if (payload.artifacts !== undefined && !Array.isArray(payload.artifacts)) {
    return { ok: false, reason: 'handoff artifacts must be an array' };
  }
  for (const artifact of Array.isArray(payload.artifacts) ? payload.artifacts : []) {
    const kind = text((artifact as Record<string, unknown> | null)?.kind);
    if (!HANDOFF_ARTIFACT_KINDS.has(kind as MemoryArtifactKind)) {
      return { ok: false, reason: 'handoff artifact kind is invalid' };
    }
    if (!artifactKinds.includes(kind as MemoryArtifactKind)) artifactKinds.push(kind as MemoryArtifactKind);
  }

  return {
    ok: true,
    value: {
      status,
      memoryReferences,
      metadata: {
        summary: summary.value!,
        nextAction: nextAction.value!,
        verification: verification.value!,
        deliveryHints,
        artifactKinds,
      },
    },
  };
}

export function buildWorkflowMemoryV2HandoffInstruction(): string {
  return [
    '# Memory V2 handoff result',
    'End this step with exactly one <memory-handoff> JSON block. It is a control-plane result, not a place for raw output, details, transcripts, or file contents.',
    'Use only memoryId/detailVersion pairs returned by validated Memory V2 proposal tools in this attempt. The service owns the authoritative delivery mode and target; the delivery hints below must match that validated decision.',
    'Use no-op when there is nothing to save or hand off:',
    '<memory-handoff>',
    '{"status":"no-op","summary":"bounded result summary","nextAction":"next action or none","verification":"verified/unverified and why","memoryReferences":[],"deliveries":[],"artifacts":[]}',
    '</memory-handoff>',
    'Use emitted only for already validated V2 memory IDs:',
    '<memory-handoff>',
    '{"status":"emitted","summary":"bounded result summary","nextAction":"next action","verification":"verification state","memoryReferences":[{"memoryId":"memory-id","detailVersion":1}],"deliveries":[{"memoryId":"memory-id","detailVersion":1,"mode":"manifest|on-demand|required-read","target":"next-step|matching-steps|named-agents"}],"artifacts":[{"kind":"run-output"}]}',
    '</memory-handoff>',
  ].join('\n');
}

export function buildWorkflowMemoryV2HandoffRepairPrompt(): string {
  return [
    '# Required Memory V2 handoff repair',
    'Your previous response did not contain a valid <memory-handoff> control result. Do not redo the task and do not repeat the prior output.',
    'Return only one valid <memory-handoff> JSON block using the required schema. Use no-op when no validated Memory V2 IDs are available.',
    buildWorkflowMemoryV2HandoffInstruction(),
  ].join('\n\n');
}

export function createWorkflowMemoryV2StepAttemptId(input: {
  runId: string;
  workflowId: string;
  logicalStepId: string;
  attempt: number;
}): string {
  const attempt = Math.max(1, Math.floor(input.attempt || 1));
  return `${stableId('workflow-step', `${input.runId}\n${input.workflowId}\n${input.logicalStepId}`)}:${attempt}`;
}

export class WorkflowMemoryV2Adapter {
  private readonly service: MemoryService;
  private readonly runId: string;
  private readonly workflowId: string;
  private readonly ownerUserId: string;
  private readonly workspaceId: string;
  private readonly projectId: string;
  private readonly participantIds: string[];

  constructor(input: WorkflowMemoryV2RunInput) {
    this.runId = text(input.runId);
    this.workflowId = text(input.workflowId);
    if (!this.runId || !this.workflowId) throw new Error('Memory V2 workflow run and workflow IDs are required');
    this.ownerUserId = text(input.ownerUserId) || 'system';
    this.workspaceId = text(input.workspaceKey) || 'default';
    this.projectId = text(input.projectKey) || this.workflowId;
    this.participantIds = uniqueStrings(input.participantIds, 128);
    if (!this.participantIds.length) throw new Error('Memory V2 workflow participant snapshot cannot be empty');

    this.service = createMemoryService();
    this.service.persistRunParticipantSnapshot({
      runId: this.runId,
      ownerUserId: this.ownerUserId,
      workspaceId: this.workspaceId,
      membershipVersion: 1,
      participants: this.participantIds.map((agentId) => ({ agentId })),
    });
    for (const channel of input.channelMembers ?? []) {
      const channelId = text(channel.channelId);
      const members = uniqueStrings(channel.agentIds, 128);
      if (!channelId || !members.length) continue;
      this.service.persistRunChannelMemberSnapshot({
        runId: this.runId,
        channelId,
        ownerUserId: this.ownerUserId,
        workspaceId: this.workspaceId,
        membershipVersion: 1,
        members: members.map((agentId) => ({ agentId })),
      });
    }
  }

  close(): void {
    this.service.close();
  }

  restoreRunState(step: Pick<WorkflowMemoryV2Step, 'agentId'>): MemoryHandoffRunState {
    return this.service.listHandoffRunState(this.contextFor({
      attemptId: `resume:${this.runId}`,
      agentId: step.agentId,
      stepId: 'workflow-resume',
    }), this.runId);
  }

  beginRetry(step: WorkflowMemoryV2Step): void {
    if (!step.isRetry) return;
    if (step.retryOfAttemptId) {
      this.service.reissueResolvedHandoffTargetsForRetry({
        context: this.contextFor(step),
        runId: this.runId,
        previousTargetStepAttemptId: step.retryOfAttemptId,
        retryTarget: this.toResolvedTarget(step),
      });
    }
    this.service.completeHandoffBatch({
      context: this.contextFor(step),
      runId: this.runId,
      sourceStepAttemptId: step.attemptId,
      sourceEventId: sourceEventId(this.runId, step.attemptId),
      status: 'retrying',
    });
  }

  prepareStep(step: WorkflowMemoryV2Step): WorkflowMemoryV2PreparedContext {
    const manifestContext = this.contextForStepManifest(step);
    let aiExecution: WorkflowMemoryV2AiExecution;

    try {
      // The combined context is still server-authorized: every channel-bound
      // item is checked against its persisted run membership snapshot. Building
      // once gives default and channel indexes one shared service hard cap.
      aiExecution = this.createAiExecution(step, manifestContext);
      this.assertWorkflowManifestBudget(aiExecution.turn);
    } catch (error) {
      this.markKnownRequiredReadFailures(step, errorCode(error));
      throw this.asBlockedError(error);
    }

    const manifestItems = [
      ...aiExecution.turn.manifest.requiredReadItems,
      ...aiExecution.turn.manifest.items,
    ];
    const requiredDetails: Array<{ item: AiMemoryManifestItemView; details: string }> = [];
    try {
      for (const item of aiExecution.turn.manifest.requiredReadItems) {
        if (!item.delivery?.requiredRead) continue;
        const handoffId = item.delivery.handoffId;
        const detail = this.service.readDetails({
          context: manifestContext,
          memoryId: item.memoryId,
          detailVersion: item.detailVersion,
          handoffId,
          targetStepAttemptId: step.attemptId,
        });
        if (!detail.complete || !detail.requiredReadExtract) {
          throw new WorkflowMemoryV2HandoffBlockedError(`required-read detail is incomplete for ${item.memoryId}`);
        }
        this.service.acknowledgeRequiredRead({
          context: manifestContext,
          handoffId,
          targetStepAttemptId: step.attemptId,
          targetAgentId: step.agentId,
          detailVersion: item.detailVersion,
          extractHash: detail.requiredReadExtract.extractHash,
        });
        requiredDetails.push({ item, details: detail.requiredReadExtract.extract });
      }
      const status = this.service.getRequiredReadStatus({
        context: manifestContext,
        targetStepAttemptId: step.attemptId,
      });
      if (status.blocked) {
        throw new WorkflowMemoryV2HandoffBlockedError('required-read receipt remains blocked');
      }
    } catch (error) {
      this.markKnownRequiredReadFailures(step, errorCode(error));
      throw this.asBlockedError(error);
    }

    try {
      // Required reads were resolved through the server-authorized workflow
      // preflight above. Check the same gate Task 2 exposes immediately before
      // any runtime work is allowed to start.
      aiExecution.turn.assertRequiredReadsAcknowledged();
    } catch (error) {
      this.markKnownRequiredReadFailures(step, errorCode(error));
      throw this.asBlockedError(error);
    }
    return {
      // The protocol block owns the only prompt copy of every index. This
      // workflow block carries only server-authorized required-read extracts.
      prompt: [this.renderPrompt(requiredDetails), aiExecution.turn.buildPromptBlock()].filter(Boolean).join('\n\n'),
      manifestItems,
      requiredReadCount: requiredDetails.length,
      omittedCount: aiExecution.turn.manifest.omittedCount,
      aiExecution,
    };
  }

  completeStep(input: WorkflowMemoryV2CompleteStepInput): WorkflowMemoryV2HandoffResult {
    const parsed = parseWorkflowMemoryV2Handoff(input.output);
    if (!parsed.ok) throw new WorkflowMemoryV2HandoffBlockedError(parsed.reason);
    const context = this.contextFor(input.step);
    const eventId = sourceEventId(this.runId, input.step.attemptId);

    if (parsed.value.status === 'no-op') {
      this.service.completeHandoffBatch({
        context,
        runId: this.runId,
        sourceStepAttemptId: input.step.attemptId,
        sourceEventId: eventId,
        status: 'no-op',
      });
      return parsed.value;
    }

    this.assertEligibleReferences(parsed.value.memoryReferences, input.eligibleProposalReferences, eventId);

    const deliveries = parsed.value.memoryReferences.map((reference) => {
      const hint = parsed.value.metadata.deliveryHints.find((item) => item.memoryId === reference.memoryId);
      if (!hint || hint.detailVersion !== reference.detailVersion) {
        throw new WorkflowMemoryV2HandoffBlockedError(
          `handoff reference ${reference.memoryId}:${reference.detailVersion} is missing its immutable delivery hint`,
        );
      }
      return {
        memoryId: reference.memoryId,
        detailVersion: reference.detailVersion,
        expectedMode: hint.mode,
        expectedTarget: hint.target,
      };
    });
    const emitted = this.service.emitResolvedHandoffBatch({
      context,
      runId: this.runId,
      sourceStepAttemptId: input.step.attemptId,
      sourceEventId: eventId,
      deliveries,
      ...(input.nextTarget ? { nextTarget: this.toResolvedTarget(input.nextTarget) } : {}),
      candidateTargets: (input.candidateTargets ?? []).map((target) => this.toResolvedTarget(target)),
    });
    const handoffs = emitted.handoffs;
    if (emitted.batch.status !== 'emitted' || handoffs.length !== deliveries.length) {
      throw new WorkflowMemoryV2HandoffBlockedError('emitted handoff batch did not return every frozen memory delivery');
    }

    const handoffByMemoryId = new Map(handoffs.map((handoff) => [handoff.memoryId, handoff]));
    if (handoffByMemoryId.size !== handoffs.length) {
      throw new WorkflowMemoryV2HandoffBlockedError('emitted handoff batch contains duplicate frozen memory deliveries');
    }
    for (const delivery of deliveries) {
      const handoff = handoffByMemoryId.get(delivery.memoryId);
      if (!handoff
        || handoff.detailVersion !== delivery.detailVersion
        || handoff.mode !== delivery.expectedMode
        || handoff.target.mode !== delivery.expectedMode
        || handoff.target.target !== delivery.expectedTarget) {
        throw new WorkflowMemoryV2HandoffBlockedError(
          `handoff ${delivery.memoryId}:${delivery.detailVersion} does not match its immutable server-observed delivery`,
        );
      }
    }

    const allowedKinds = new Set(parsed.value.metadata.artifactKinds);
    for (const handoff of handoffs) {
      for (const artifact of input.artifacts ?? []) {
        if (allowedKinds.size && !allowedKinds.has(artifact.artifactKind)) continue;
        this.service.recordArtifactRef({
          context,
          memoryId: handoff.memoryId,
          detailVersion: handoff.detailVersion,
          runId: this.runId,
          artifactKind: artifact.artifactKind,
          relativePath: artifact.relativePath,
          contentHash: artifact.contentHash,
        });
      }
    }

    return parsed.value;
  }

  recordFailure(step: WorkflowMemoryV2Step): void {
    this.recordTerminalStatus(step, 'failed');
  }

  recordCancellation(step: WorkflowMemoryV2Step): void {
    this.recordTerminalStatus(step, 'cancelled');
  }

  private recordTerminalStatus(step: WorkflowMemoryV2Step, status: 'failed' | 'cancelled'): void {
    this.service.completeHandoffBatch({
      context: this.contextFor(step),
      runId: this.runId,
      sourceStepAttemptId: step.attemptId,
      sourceEventId: sourceEventId(this.runId, step.attemptId),
      status,
    });
  }

  private assertEligibleReferences(
    references: readonly WorkflowMemoryV2MemoryReference[],
    eligibleReferences: readonly AiMemoryHandoffEligibleProposalReference[],
    eventId: string,
  ): void {
    const eligible = new Map<string, AiMemoryHandoffEligibleProposalReference>();
    for (const candidate of eligibleReferences) {
      if (candidate.sourceEventId !== eventId
        || candidate.status !== 'active'
        || (candidate.action !== 'create' && candidate.action !== 'upsert')) {
        continue;
      }
      eligible.set(`${candidate.memoryId}:${candidate.detailVersion}`, candidate);
    }
    for (const reference of references) {
      if (!eligible.has(`${reference.memoryId}:${reference.detailVersion}`)) {
        throw new WorkflowMemoryV2HandoffBlockedError(
          `handoff reference ${reference.memoryId}:${reference.detailVersion} was not persisted by this server-issued Memory V2 event`,
        );
      }
    }
  }

  private contextFor(
    step: Pick<WorkflowMemoryV2Step, 'attemptId' | 'agentId' | 'stepId' | 'workflowState' | 'stepTags'>,
    channelId?: string,
    authorizedChannelIds?: readonly string[],
  ): MemoryRequestContext {
    const channelIds = uniqueStrings([channelId, ...(authorizedChannelIds ?? [])], 32);
    return applyMemoryV2RuntimePolicy({
      ownerUserId: this.ownerUserId,
      workspaceId: this.workspaceId,
      actor: 'system',
      actorId: 'workflow-memory-v2',
      agentId: step.agentId,
      runId: this.runId,
      workflowId: this.workflowId,
      channelId,
      stepAttemptId: step.attemptId,
      workflowState: step.workflowState,
      stepId: step.stepId,
      stepTags: uniqueStrings(step.stepTags, 32),
      projectIds: [this.projectId],
      authorizedAgentIds: this.participantIds,
      authorizedWorkflowIds: [this.workflowId],
      authorizedProjectIds: [this.projectId],
      authorizedRunIds: [this.runId],
      authorizedChannelIds: channelIds.length ? channelIds : undefined,
    });
  }

  private contextForStepManifest(step: WorkflowMemoryV2Step): MemoryRequestContext {
    return this.contextFor(step, undefined, uniqueStrings(step.channelIds, 32));
  }

  private createAiExecution(
    step: WorkflowMemoryV2Step,
    manifestContext: MemoryRequestContext = this.contextForStepManifest(step),
  ): WorkflowMemoryV2AiExecution {
    const eventId = sourceEventId(this.runId, step.attemptId);
    const requestContext: MemoryRequestContext = {
      ...manifestContext,
      actor: 'ai',
      actorId: `workflow-memory-v2:${this.runId}:${step.agentId}`,
    };
    const continuity = createAiMemoryContinuityIdentity({
      runId: this.runId,
      workflowId: this.workflowId,
    });
    const turn = prepareAiMemoryEngineTurn({
      memoryService: this.service,
      requestContext,
      continuity,
      sourceEventId: eventId,
      trigger: 'step-start',
      targetStepAttemptId: step.attemptId,
      maxManifestChars: this.service.budgets.maxManifestChars,
    });
    return new WorkflowMemoryV2AiExecution(eventId, turn);
  }

  private assertWorkflowManifestBudget(turn: AiMemoryEngineTurn): void {
    const maxManifestChars = this.service.budgets.maxManifestChars;
    if (turn.manifest.serializedChars > maxManifestChars
      || turn.manifest.promptSerializedChars > maxManifestChars) {
      throw new WorkflowMemoryV2HandoffBlockedError('Memory V2 workflow manifest exceeded the server hard character cap');
    }
  }

  private toResolvedTarget(target: WorkflowMemoryV2Target | WorkflowMemoryV2Step): MemoryHandoffResolvedTarget {
    const channelIds = uniqueStrings(target.channelIds, 32);
    return {
      targetStepAttemptId: target.attemptId,
      targetAgentId: target.agentId,
      ...(target.stepId ? { stepId: target.stepId } : {}),
      ...(target.workflowState ? { workflowState: target.workflowState } : {}),
      ...(target.stepTags?.length ? { stepTags: uniqueStrings(target.stepTags, 32) } : {}),
      channelIds,
    };
  }

  private markKnownRequiredReadFailures(step: WorkflowMemoryV2Step, failureCode: string): void {
    try {
      const defaultContext = this.contextFor(step);
      const contexts = [
        defaultContext,
        ...uniqueStrings(step.channelIds, 32).map((channelId) => this.contextFor(step, channelId)),
      ];
      const state = this.service.listHandoffRunState(defaultContext, this.runId);
      for (const handoff of state.handoffs) {
        if (handoff.mode !== 'required-read') continue;
        if (!handoff.resolvedTargets.some((target) => target.targetStepAttemptId === step.attemptId && target.targetAgentId === step.agentId)) {
          continue;
        }
        for (const context of contexts) {
          try {
            this.service.recordHandoffReceipt({
              context,
              handoffId: handoff.id,
              targetStepAttemptId: step.attemptId,
              targetAgentId: step.agentId,
              detailVersion: handoff.detailVersion,
              status: 'failed',
              failureCode: failureCode.slice(0, 160),
            });
            break;
          } catch {
            // Try a bound channel context before retaining the original failure.
          }
        }
      }
    } catch {
      // A failed preflight must not be replaced by an observability lookup failure.
    }
  }

  private renderPrompt(requiredDetails: Array<{ item: AiMemoryManifestItemView; details: string }>): string {
    const lines = ['# Memory V2 workflow context'];
    if (requiredDetails.length) {
      lines.push('## Required-read extracts');
      for (const detail of requiredDetails) {
        lines.push(`### memoryId=${detail.item.memoryId} detailVersion=${detail.item.detailVersion}`);
        lines.push(detail.details);
      }
    }
    lines.push(buildWorkflowMemoryV2HandoffInstruction());
    return `${lines.join('\n')}\n`;
  }

  private asBlockedError(error: unknown): WorkflowMemoryV2HandoffBlockedError {
    if (error instanceof WorkflowMemoryV2HandoffBlockedError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new WorkflowMemoryV2HandoffBlockedError(`handoff-blocked: ${message}`);
  }
}

export function createWorkflowMemoryV2Adapter(input: WorkflowMemoryV2RunInput): WorkflowMemoryV2Adapter {
  return new WorkflowMemoryV2Adapter(input);
}
