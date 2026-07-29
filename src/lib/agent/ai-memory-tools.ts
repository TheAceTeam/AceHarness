import type {
  AcknowledgeRequiredReadInput,
  MemoryDetailPage,
  MemoryHandoffReceiptRecord,
  MemoryDecisionProposal,
  MemoryProposalResult,
  MemoryRequestContext,
  MemorySearchResult,
  MemoryService,
  MemoryServiceError,
} from '@/lib/memory-v2';
import {
  AiMemoryToolContractError,
  type AiMemoryIndexView,
  type AiMemoryNativeToolName,
  type AiMemoryParsedToolInvocation,
  parseAiMemoryNativeToolInvocation,
  toAiMemoryIndexView,
} from '@/lib/agent/ai-memory-contracts';
import {
  memoryLifecycleAnchorForContinuity,
  type AiMemoryContinuityIdentity,
} from '@/lib/agent/ai-memory-session';

export type AiMemoryToolService = Pick<
  MemoryService,
  'propose' | 'resolve' | 'readDetails' | 'search' | 'acknowledgeRequiredRead' | 'recordHandoffReceipt' | 'getRequiredReadStatus'
>;

/**
 * This context is constructed by the authenticated server/engine adapter. It
 * is intentionally separate from model-provided tool arguments.
 */
export interface AiMemoryToolExecutionContext {
  memoryService: AiMemoryToolService;
  requestContext: MemoryRequestContext;
  sourceEventId: string;
  /** Server-derived durable session/run identity; never supplied by the model. */
  continuity: AiMemoryContinuityIdentity;
}

export interface AiMemorySearchToolResult {
  items: AiMemoryIndexView[];
  serializedChars: number;
  omittedCount: number;
}

export type AiMemoryToolResult =
  | MemoryProposalResult
  | MemoryDetailPage
  | MemoryHandoffReceiptRecord
  | AiMemorySearchToolResult;

export interface AiMemoryToolSuccess {
  ok: true;
  name: AiMemoryNativeToolName;
  result: AiMemoryToolResult;
}

export interface AiMemoryToolFailure {
  ok: false;
  name: AiMemoryNativeToolName | 'unknown';
  error: {
    code: string;
    message: string;
    handoffBlocked?: boolean;
    receiptFailureRecorded?: boolean;
  };
}

export type AiMemoryToolExecutionResult = AiMemoryToolSuccess | AiMemoryToolFailure;

export interface AiMemoryRequiredReadGate {
  receipts: MemoryHandoffReceiptRecord[];
  blocked: boolean;
}

export class AiMemoryRequiredReadBlockedError extends Error {
  readonly code = 'MEMORY_REQUIRED_READ_BLOCKED';

  constructor() {
    super('required-read handoffs are not acknowledged; execution is handoff-blocked');
    this.name = 'AiMemoryRequiredReadBlockedError';
  }
}

function requireServerText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AiMemoryToolContractError(`${label} must be supplied by the server`);
  }
  return value.trim();
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as MemoryServiceError).code === 'string') {
    return (error as MemoryServiceError).code;
  }
  if (error instanceof AiMemoryToolContractError) return 'MEMORY_INVALID_INPUT';
  return 'MEMORY_TOOL_FAILED';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'AI memory tool request failed';
}

function requiredReadFailureCode(error: unknown): string {
  const code = errorCode(error);
  return code.length <= 120 ? code : 'MEMORY_REQUIRED_READ_FAILED';
}

export class AiMemoryToolExecutor {
  constructor(private readonly execution: AiMemoryToolExecutionContext) {}

  execute(name: unknown, argumentsValue: unknown): AiMemoryToolExecutionResult {
    let parsed: AiMemoryParsedToolInvocation | undefined;
    try {
      this.assertServerContext();
      parsed = parseAiMemoryNativeToolInvocation(name, argumentsValue);
      return { ok: true, name: parsed.name, result: this.executeParsed(parsed) };
    } catch (error) {
      const parsedName = typeof name === 'string' && name.startsWith('memory.')
        ? name as AiMemoryNativeToolName
        : 'unknown';
      const readInvocation = parsed?.name === 'memory.read' ? parsed : undefined;
      const requiredReadFailure = this.recordReadFailure(readInvocation, error);
      return {
        ok: false,
        name: parsedName,
        error: {
          code: errorCode(error),
          message: errorMessage(error),
          ...(readInvocation?.input.handoffId ? { handoffBlocked: true } : {}),
          ...(requiredReadFailure ? { receiptFailureRecorded: true } : {}),
        },
      };
    }
  }

  getRequiredReadGate(): AiMemoryRequiredReadGate {
    this.assertServerContext();
    const targetStepAttemptId = this.execution.requestContext.stepAttemptId;
    if (!targetStepAttemptId || !this.execution.requestContext.runId) {
      return { receipts: [], blocked: false };
    }
    const result = this.execution.memoryService.getRequiredReadStatus({
      context: this.execution.requestContext,
      targetStepAttemptId,
    });
    return { receipts: result.receipts, blocked: result.blocked };
  }

  assertRequiredReadsAcknowledged(): void {
    const gate = this.getRequiredReadGate();
    if (gate.blocked) {
      throw new AiMemoryRequiredReadBlockedError();
    }
  }

  private assertServerContext(): void {
    if (this.execution.requestContext.actor !== 'ai') {
      throw new AiMemoryToolContractError('AI memory tools require an AI server request context');
    }
    requireServerText(this.execution.requestContext.ownerUserId, 'ownerUserId');
    requireServerText(this.execution.requestContext.workspaceId, 'workspaceId');
    requireServerText(this.execution.sourceEventId, 'sourceEventId');
  }

  private assertProposalSourceEvent(sourceEventId: string): void {
    if (sourceEventId !== this.execution.sourceEventId) {
      throw new AiMemoryToolContractError('sourceEventId does not match the server-issued source event');
    }
  }

  private executeParsed(parsed: AiMemoryParsedToolInvocation): AiMemoryToolResult {
    switch (parsed.name) {
      case 'memory.propose':
        this.assertProposalSourceEvent(parsed.input.sourceEventId);
        return this.execution.memoryService.propose(
          this.withServerDerivedLifecycleAnchor(parsed.input),
          this.execution.requestContext,
        );
      case 'memory.resolve':
        this.assertProposalSourceEvent(parsed.input.sourceEventId);
        return this.execution.memoryService.resolve(
          this.withServerDerivedLifecycleAnchor(parsed.input),
          this.execution.requestContext,
        );
      case 'memory.search': {
        const result: MemorySearchResult = this.execution.memoryService.search({
          context: this.execution.requestContext,
          query: parsed.input.query,
          ...(parsed.input.maxIndexChars ? { maxIndexChars: parsed.input.maxIndexChars } : {}),
          ...(parsed.input.limit ? { limit: parsed.input.limit } : {}),
        });
        return {
          items: result.items.map(toAiMemoryIndexView),
          serializedChars: result.serializedChars,
          omittedCount: result.omittedCount,
        };
      }
      case 'memory.read':
        return this.execution.memoryService.readDetails({
          context: this.execution.requestContext,
          memoryId: parsed.input.memoryId,
          detailVersion: parsed.input.detailVersion,
          ...(parsed.input.cursor ? { cursor: parsed.input.cursor } : {}),
          ...(parsed.input.maxChars ? { maxChars: parsed.input.maxChars } : {}),
          ...(parsed.input.handoffId ? { handoffId: parsed.input.handoffId } : {}),
          ...(parsed.input.handoffId && this.execution.requestContext.stepAttemptId
            ? { targetStepAttemptId: this.execution.requestContext.stepAttemptId }
            : {}),
        });
      case 'memory.acknowledgeRequiredRead': {
        const targetStepAttemptId = requireServerText(this.execution.requestContext.stepAttemptId, 'targetStepAttemptId');
        const targetAgentId = requireServerText(this.execution.requestContext.agentId, 'targetAgentId');
        const input: AcknowledgeRequiredReadInput = {
          context: this.execution.requestContext,
          handoffId: parsed.input.handoffId,
          targetStepAttemptId,
          targetAgentId,
          detailVersion: parsed.input.detailVersion,
          extractHash: parsed.input.extractHash,
        };
        return this.execution.memoryService.acknowledgeRequiredRead(input);
      }
    }
  }

  private withServerDerivedLifecycleAnchor(proposal: MemoryDecisionProposal): MemoryDecisionProposal {
    if (proposal.action === 'discard') return proposal;
    if (proposal.retention === 'short') {
      return {
        ...proposal,
        lifecycleAnchor: memoryLifecycleAnchorForContinuity(this.execution.continuity),
      };
    }
    const { lifecycleAnchor: _ignored, ...longProposal } = proposal;
    return longProposal;
  }

  private recordReadFailure(parsed: Extract<AiMemoryParsedToolInvocation, { name: 'memory.read' }> | undefined, originalError: unknown): boolean {
    if (!parsed?.input.handoffId) return false;
    const targetStepAttemptId = this.execution.requestContext.stepAttemptId;
    const targetAgentId = this.execution.requestContext.agentId;
    if (!targetStepAttemptId || !targetAgentId) return false;
    try {
      this.execution.memoryService.recordHandoffReceipt({
        context: this.execution.requestContext,
        handoffId: parsed.input.handoffId,
        targetStepAttemptId,
        targetAgentId,
        detailVersion: parsed.input.detailVersion,
        status: 'failed',
        failureCode: requiredReadFailureCode(originalError),
      });
      return true;
    } catch {
      // A stale/denied handoff can prevent the core from recording a receipt.
      // The caller still receives handoffBlocked and must not continue work.
      return false;
    }
  }
}

export function createAiMemoryToolExecutor(context: AiMemoryToolExecutionContext): AiMemoryToolExecutor {
  return new AiMemoryToolExecutor(context);
}
