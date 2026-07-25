import type {
  MemoryManifestQuery,
  MemoryProposalResult,
  MemoryRequestContext,
  MemoryService,
} from '@/lib/memory-v2';
import {
  AI_MEMORY_NATIVE_TOOL_DEFINITIONS,
  type AiMemoryNativeToolDefinition,
  type AiMemoryNativeToolName,
} from '@/lib/agent/ai-memory-contracts';
import {
  executeAiMemoryStructuredFallback,
  parseAiMemoryStructuredFallback,
  type AiMemoryFallbackExecutionResult,
  type AiMemoryFallbackParseResult,
} from '@/lib/agent/ai-memory-fallback';
import {
  buildAiMemoryPromptManifest,
  buildAiMemoryProtocolInstruction,
  type AiMemoryManifestService,
  type AiMemoryPromptManifest,
} from '@/lib/agent/ai-memory-prompt';
import {
  applyAiMemoryContinuity,
  type AiMemoryContinuityIdentity,
} from '@/lib/agent/ai-memory-session';
import {
  createAiMemoryToolExecutor,
  type AiMemoryToolExecutionResult,
  type AiMemoryRequiredReadGate,
  type AiMemoryToolService,
} from '@/lib/agent/ai-memory-tools';

export type AiMemoryEngineService = AiMemoryManifestService & AiMemoryToolService & Pick<MemoryService, 'buildManifest'>;

export interface PrepareAiMemoryEngineTurnInput {
  memoryService: AiMemoryEngineService;
  requestContext: MemoryRequestContext;
  continuity: AiMemoryContinuityIdentity;
  sourceEventId: string;
  trigger: MemoryManifestQuery['trigger'];
  queryText?: string;
  targetStepAttemptId?: string;
  maxManifestChars?: number;
}

/**
 * A transport-neutral adapter for engines with native tool support. It binds
 * every call to the same authenticated context that produced the index-only
 * prompt, while leaving provider-specific registration to the engine adapter.
 */
export interface AiMemoryEngineTurn {
  context: MemoryRequestContext;
  continuity: AiMemoryContinuityIdentity;
  sourceEventId: string;
  nativeTools: readonly AiMemoryNativeToolDefinition[];
  manifest: AiMemoryPromptManifest;
  promptBlock: string;
  buildPromptBlock: (input?: { allowStructuredFallback?: boolean }) => string;
  executeNativeTool: (name: unknown, argumentsValue: unknown) => AiMemoryToolExecutionResult;
  getRequiredReadGate: () => AiMemoryRequiredReadGate;
  assertRequiredReadsAcknowledged: () => void;
  parseFallback: (rawOutput: string) => AiMemoryFallbackParseResult;
  executeFallback: (rawOutput: string) => AiMemoryFallbackExecutionResult;
  collectHandoffEligibleProposalReferences: (
    toolResults: readonly AiMemoryToolExecutionResult[],
  ) => AiMemoryHandoffEligibleProposalReference[];
}

/**
 * Server-observed persistence evidence for workflow handoff. A caller must
 * capture these from the same server-issued source event that executed tools;
 * parsed model output alone is never sufficient evidence. The workflow adapter
 * must still validate each referenced record's persisted handoff mode/target.
 */
export interface AiMemoryHandoffEligibleProposalReference {
  memoryId: string;
  detailVersion: number;
  action: 'create' | 'upsert';
  status: 'active';
  sourceEventId: string;
}

function isProposalResult(value: unknown): value is MemoryProposalResult {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as MemoryProposalResult).action === 'string'
    && typeof (value as MemoryProposalResult).status === 'string';
}

export function collectAiMemoryHandoffEligibleProposalReferences(
  sourceEventId: string,
  toolResults: readonly AiMemoryToolExecutionResult[],
): AiMemoryHandoffEligibleProposalReference[] {
  const references: AiMemoryHandoffEligibleProposalReference[] = [];
  const seen = new Set<string>();
  for (const toolResult of toolResults) {
    if (!toolResult.ok || toolResult.name !== 'memory.propose' || !isProposalResult(toolResult.result)) continue;
    const result = toolResult.result;
    if ((result.action !== 'create' && result.action !== 'upsert')
      || result.status !== 'active'
      || !result.memoryId
      || typeof result.detailVersion !== 'number'
      || !Number.isInteger(result.detailVersion)
      || result.detailVersion < 1) {
      continue;
    }
    const key = `${result.memoryId}:${result.detailVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      memoryId: result.memoryId,
      detailVersion: result.detailVersion,
      action: result.action,
      status: result.status,
      sourceEventId,
    });
  }
  return references;
}

export function prepareAiMemoryEngineTurn(input: PrepareAiMemoryEngineTurnInput): AiMemoryEngineTurn {
  const sourceEventId = typeof input.sourceEventId === 'string' ? input.sourceEventId.trim() : '';
  if (!sourceEventId) throw new Error('AI memory engine turns require a server-issued sourceEventId');
  const context = applyAiMemoryContinuity(input.requestContext, input.continuity);
  const manifest = buildAiMemoryPromptManifest({
    memoryService: input.memoryService,
    context,
    trigger: input.trigger,
    ...(input.queryText ? { queryText: input.queryText } : {}),
    ...(input.targetStepAttemptId ? { targetStepAttemptId: input.targetStepAttemptId } : {}),
    ...(input.maxManifestChars ? { maxManifestChars: input.maxManifestChars } : {}),
  });
  const executor = createAiMemoryToolExecutor({
    memoryService: input.memoryService,
    requestContext: context,
    sourceEventId,
    continuity: input.continuity,
  });
  const buildPromptBlock = (options: { allowStructuredFallback?: boolean } = {}) => [
    buildAiMemoryProtocolInstruction(options),
    '<memory-v2-write-context>',
    JSON.stringify({ sourceEventId }),
    '</memory-v2-write-context>',
    manifest.promptBlock,
  ].join('\n\n');
  return {
    context,
    continuity: input.continuity,
    sourceEventId,
    nativeTools: AI_MEMORY_NATIVE_TOOL_DEFINITIONS,
    manifest,
    promptBlock: buildPromptBlock(),
    buildPromptBlock,
    executeNativeTool: (name: unknown, argumentsValue: unknown) => executor.execute(name, argumentsValue),
    getRequiredReadGate: () => executor.getRequiredReadGate(),
    assertRequiredReadsAcknowledged: () => executor.assertRequiredReadsAcknowledged(),
    parseFallback: (rawOutput: string) => parseAiMemoryStructuredFallback(rawOutput),
    executeFallback: (rawOutput: string) => executeAiMemoryStructuredFallback(rawOutput, executor),
    collectHandoffEligibleProposalReferences: (toolResults) => (
      collectAiMemoryHandoffEligibleProposalReferences(sourceEventId, toolResults)
    ),
  };
}

export function isAiMemoryToolAvailable(
  toolName: string,
  supportedTools: readonly string[] | undefined,
): toolName is AiMemoryNativeToolName {
  return Boolean(supportedTools?.includes(toolName))
    && (AI_MEMORY_NATIVE_TOOL_DEFINITIONS as readonly AiMemoryNativeToolDefinition[])
      .some((definition) => definition.name === toolName);
}
