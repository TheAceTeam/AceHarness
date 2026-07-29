import type {
  ChatRuntimeEngine,
  ChatRuntimeEngineOptions,
  ChatRuntimeResult,
  ChatRuntimeStreamEvent,
} from '@/lib/chat/chat-engine-runtime';
import type { MemoryV2ConsumerManifestResult } from '@/lib/memory-v2-cutover/consumer-context';
import {
  createMemoryService,
  type MemoryRequestContext,
  type MemoryService,
} from '@/lib/memory-v2';
import {
  prepareAiMemoryEngineTurn,
  type AiMemoryEngineTurn,
  type AiMemoryHandoffEligibleProposalReference,
} from '@/lib/agent/ai-memory-protocol';
import type { AiMemoryContinuityIdentity } from '@/lib/agent/ai-memory-session';
import type { AiMemoryToolExecutionResult } from '@/lib/agent/ai-memory-tools';

/**
 * Server-only execution plan. Its request context and source event ID are
 * built by an authenticated route and never supplied by the model.
 */
export interface AiMemoryV2EnginePlan {
  requestContext: MemoryRequestContext;
  continuity: AiMemoryContinuityIdentity;
  sourceEventId: string;
  queryText: string;
}

interface AiMemoryV2EngineExecution {
  service: MemoryService;
  turn: AiMemoryEngineTurn;
}

type ChatRuntimeCompactOptions = Parameters<NonNullable<ChatRuntimeEngine['compactContext']>>[0];
type ChatRuntimeCompactResult = Awaited<ReturnType<NonNullable<ChatRuntimeEngine['compactContext']>>>;

// One initial model execution may be followed by at most two model
// continuations. This permits the normal search -> read -> terminal-answer
// sequence while keeping a text-fallback turn bounded.
const MAX_AI_MEMORY_FALLBACK_CONTINUATIONS = 2;
const FALLBACK_CONTINUATION_LIMIT_ERROR = 'Memory V2 fallback exhausted its continuation budget before a terminal answer';

function buildMemoryV2ToolContinuationPrompt(
  results: readonly AiMemoryToolExecutionResult[],
  allowAdditionalMemoryReads: boolean,
): string {
  return [
    'The server executed the following authorized Memory V2 tool calls for this turn.',
    'Use these results only to finish the user-facing answer. Do not expose this control block or raw tool protocol.',
    '<memory-v2-tool-results>',
    JSON.stringify(results),
    '</memory-v2-tool-results>',
    allowAdditionalMemoryReads
      ? 'Now provide the complete visible answer. You may append one private Memory V2 fallback block only when another memory action is needed.'
      : 'This is the final Memory V2 continuation. Provide the complete visible answer now; do not request memory.search or memory.read again. A decision-only private fallback block is allowed only when a memory write is needed.',
  ].join('\n');
}

function hasFallbackReadCall(calls: readonly { name: string }[]): boolean {
  return calls.some((call) => call.name === 'memory.read' || call.name === 'memory.search');
}

/**
 * Wraps one server-authenticated chat turn with the Memory V2 tool protocol.
 * RuntimeBackedChatEngine currently has no native callback channel, so the
 * structured fallback intentionally withholds incremental model text until
 * the server has stripped and executed its private control block.
 */
export class AiMemoryV2EngineAdapter implements ChatRuntimeEngine {
  private execution?: AiMemoryV2EngineExecution;
  private releaseRequested = false;
  private released = false;
  private executing = 0;
  private suppressMemoryV2TextStream = false;
  private readonly streamListeners = new Map<(event: ChatRuntimeStreamEvent) => void, (event: ChatRuntimeStreamEvent) => void>();
  private readonly handoffReferences = new Map<string, AiMemoryHandoffEligibleProposalReference>();

  constructor(
    private readonly inner: ChatRuntimeEngine,
    private readonly matchesExecution: (options: ChatRuntimeEngineOptions) => boolean,
    private readonly plan: AiMemoryV2EnginePlan | undefined,
    private readonly memoryV2: MemoryV2ConsumerManifestResult,
  ) {}

  async execute(options: ChatRuntimeEngineOptions): Promise<ChatRuntimeResult> {
    if (!this.plan || !this.matchesExecution(options)) {
      return this.inner.execute(options);
    }
    if (this.releaseRequested || this.released) throw new Error('Memory V2 chat turn was already released');

    this.executing += 1;
    try {
      const execution = this.ensureExecution();
      this.suppressMemoryV2TextStream = true;
      execution.turn.assertRequiredReadsAcknowledged();
      const nativeExecute = this.inner.executeWithNativeTools;
      if (typeof nativeExecute === 'function') {
        return this.executeWithMemoryNativeTools(execution, options, nativeExecute.bind(this.inner));
      }
      return this.executeWithStructuredFallback(execution, options);
    } finally {
      this.executing -= 1;
      this.releaseIfIdle();
    }
  }

  cancel(): void {
    this.inner.cancel();
    this.releaseMemoryV2();
  }

  isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  getName(): string {
    return this.inner.getName();
  }

  async compactContext(options: ChatRuntimeCompactOptions): Promise<ChatRuntimeCompactResult> {
    const compactContext = this.inner.compactContext;
    return compactContext ? compactContext.call(this.inner, options) : null;
  }

  on(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): void {
    const wrapped = (streamEvent: ChatRuntimeStreamEvent) => {
      // A control block can span chunks and a native-capable model can still
      // violate its contract. The cleaned final output is the only model text
      // delivered for an active V2 turn.
      if (this.suppressMemoryV2TextStream && ['text', 'tool', 'thought'].includes(streamEvent.type)) return;
      listener(streamEvent);
    };
    this.streamListeners.set(listener, wrapped);
    this.inner.on(event, wrapped);
  }

  off(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): void {
    const wrapped = this.streamListeners.get(listener) || listener;
    this.inner.off(event, wrapped);
    this.streamListeners.delete(listener);
    this.releaseAfterStreamCompletion();
  }

  releaseMemoryV2(): void {
    if (this.releaseRequested || this.released) return;
    this.releaseRequested = true;
    this.releaseIfIdle();
  }

  getLatestMemoryV2PromptBlock(): string {
    return this.memoryV2.manifest?.promptBlock || this.memoryV2.promptBlock;
  }

  private releaseIfIdle(): void {
    if (!this.releaseRequested || this.released || this.executing > 0) return;
    this.released = true;
    const execution = this.execution;
    this.execution = undefined;
    if (execution) {
      try {
        execution.service.close();
      } catch {
        // Closing an already-closed SQLite handle must not hide the chat result.
      }
    }
  }

  getHandoffEligibleProposals(): readonly AiMemoryHandoffEligibleProposalReference[] {
    return Array.from(this.handoffReferences.values());
  }

  private ensureExecution(): AiMemoryV2EngineExecution {
    if (this.execution) return this.execution;
    if (!this.plan) throw new Error('Memory V2 chat plan is unavailable');
    const service = createMemoryService();
    try {
      const turn = prepareAiMemoryEngineTurn({
        memoryService: service,
        requestContext: this.plan.requestContext,
        continuity: this.plan.continuity,
        sourceEventId: this.plan.sourceEventId,
        trigger: 'conversation-turn',
        queryText: this.plan.queryText,
        ...(this.plan.requestContext.stepAttemptId
          ? { targetStepAttemptId: this.plan.requestContext.stepAttemptId }
          : {}),
      });
      this.memoryV2.manifest = turn.manifest;
      // Recovery receives the durable, index-only manifest, not the write
      // context or any detail body.
      this.memoryV2.promptBlock = turn.manifest.promptBlock;
      this.execution = { service, turn };
      return this.execution;
    } catch (error) {
      try { service.close(); } catch {}
      throw error;
    }
  }

  private async executeWithMemoryNativeTools(
    execution: AiMemoryV2EngineExecution,
    options: ChatRuntimeEngineOptions,
    executeWithNativeTools: NonNullable<ChatRuntimeEngine['executeWithNativeTools']>,
  ): Promise<ChatRuntimeResult> {
    const toolResults: AiMemoryToolExecutionResult[] = [];
    const result = await executeWithNativeTools({
      ...options,
      prompt: [
        execution.turn.buildPromptBlock({ allowStructuredFallback: false }),
        options.prompt,
      ].filter(Boolean).join('\n\n'),
    }, {
      nativeTools: execution.turn.nativeTools,
      dispatchNativeTool: (name, argumentsValue) => {
        const toolResult = execution.turn.executeNativeTool(name, argumentsValue);
        toolResults.push(toolResult);
        return toolResult;
      },
      beforeTaskStart: () => execution.turn.assertRequiredReadsAcknowledged(),
    });
    this.recordHandoffEligibleProposals(execution, toolResults);
    // A native-tool engine is never allowed to turn a text fallback block into
    // a second write channel, but the block is still removed if it appears.
    return {
      ...result,
      output: execution.turn.parseFallback(result.output || '').visibleText,
    };
  }

  private async executeWithStructuredFallback(
    execution: AiMemoryV2EngineExecution,
    options: ChatRuntimeEngineOptions,
  ): Promise<ChatRuntimeResult> {
    let currentResult = await this.inner.execute({
      ...options,
      prompt: [execution.turn.buildPromptBlock(), options.prompt].filter(Boolean).join('\n\n'),
    });
    let visibleOutput = '';
    let continuationCount = 0;

    for (;;) {
      const rawOutput = currentResult.output || '';
      const parsedFallback = execution.turn.parseFallback(rawOutput);
      const requiresContinuation = hasFallbackReadCall(parsedFallback.calls);
      if (this.releaseRequested) {
        return {
          ...currentResult,
          success: false,
          output: '',
          error: 'Memory V2 chat turn was cancelled',
          stopReason: 'cancelled',
        };
      }
      // A search/read result is private control data. If the final permitted
      // model output still asks for one, there is no safe terminal answer to
      // expose because the model never received that result.
      if (requiresContinuation && (!currentResult.success
        || continuationCount >= MAX_AI_MEMORY_FALLBACK_CONTINUATIONS)) {
        return {
          ...currentResult,
          success: false,
          output: '',
          error: FALLBACK_CONTINUATION_LIMIT_ERROR,
          stopReason: 'memory-v2-fallback-limit',
        };
      }

      const fallback = execution.turn.executeFallback(rawOutput);
      this.recordHandoffEligibleProposals(execution, fallback.toolResults);
      if (fallback.visibleText) visibleOutput = fallback.visibleText;

      if (!requiresContinuation) {
        return { ...currentResult, output: visibleOutput };
      }

      continuationCount += 1;
      currentResult = await this.inner.execute({
        ...options,
        prompt: buildMemoryV2ToolContinuationPrompt(
          fallback.toolResults,
          continuationCount < MAX_AI_MEMORY_FALLBACK_CONTINUATIONS,
        ),
        sessionId: currentResult.sessionId || options.sessionId,
        forceNewSession: false,
        appendSystemPrompt: true,
      });
    }
  }

  private recordHandoffEligibleProposals(
    execution: AiMemoryV2EngineExecution,
    toolResults: readonly AiMemoryToolExecutionResult[],
  ): void {
    for (const reference of execution.turn.collectHandoffEligibleProposalReferences(toolResults)) {
      this.handoffReferences.set(`${reference.memoryId}:${reference.detailVersion}`, reference);
    }
  }

  private releaseAfterStreamCompletion(): void {
    if (this.execution && this.executing === 0 && this.streamListeners.size === 0) {
      this.releaseMemoryV2();
    }
  }
}
