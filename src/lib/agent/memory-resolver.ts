import type {
  MemoryManifestQuery,
  MemoryRequestContext,
} from '@/lib/memory-v2';
import type {
  AiMemoryManifestItemView,
  AiMemoryManifestService,
} from '@/lib/agent/ai-memory-prompt';
import {
  buildAiMemoryPromptManifest,
} from '@/lib/agent/ai-memory-prompt';
import type { AiMemoryContinuityIdentity } from '@/lib/agent/ai-memory-session';
import { applyAiMemoryContinuity } from '@/lib/agent/ai-memory-session';

export type AgentMemoryResolverMode = 'standalone-chat' | 'workflow-chat';

/**
 * Task 4 consumers supply this from authenticated server state. The resolver
 * does not construct authorization context from names, paths, or runtime IDs.
 */
export interface AgentMemoryResolverV2Context {
  memoryService: AiMemoryManifestService;
  requestContext: MemoryRequestContext;
  continuity: AiMemoryContinuityIdentity;
  trigger?: MemoryManifestQuery['trigger'];
  queryText?: string;
  targetStepAttemptId?: string;
  maxManifestChars?: number;
}

export interface AgentMemorySnapshot {
  runtimeEnabled: boolean;
  entries: AiMemoryManifestItemView[];
  mergedContent: string;
  charCount: number;
  maxChars: number;
  overLimit: boolean;
  promptBlock: string;
  requiredReadPreflight: 'ready' | 'unavailable';
}

function clampManifestBudget(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(1, Math.min(50000, Math.floor(parsed)));
}

function emptySnapshot(maxChars: number, runtimeEnabled: boolean): AgentMemorySnapshot {
  return {
    runtimeEnabled,
    entries: [],
    mergedContent: '',
    charCount: 0,
    maxChars,
    overLimit: false,
    promptBlock: '',
    requiredReadPreflight: 'unavailable',
  };
}

function resolveManifest(
  v2: AgentMemoryResolverV2Context,
  fallbackTrigger: MemoryManifestQuery['trigger'],
  fallbackMaxChars: number,
) {
  const context = applyAiMemoryContinuity(v2.requestContext, v2.continuity);
  return buildAiMemoryPromptManifest({
    memoryService: v2.memoryService,
    context,
    trigger: v2.trigger ?? fallbackTrigger,
    ...(v2.queryText ? { queryText: v2.queryText } : {}),
    ...(v2.targetStepAttemptId ? { targetStepAttemptId: v2.targetStepAttemptId } : {}),
    maxManifestChars: v2.maxManifestChars ?? fallbackMaxChars,
  });
}

/**
 * Compatibility entry point for callers being migrated by Task 4. It never
 * reads role, project, workflow, chat, YAML, or process-local legacy memory.
 */
export async function resolveAgentRoleMemory(input: {
  agentName: string;
  maxChars?: number;
  runtimeEnabled?: boolean;
  v2?: AgentMemoryResolverV2Context;
}): Promise<AgentMemorySnapshot> {
  const maxChars = clampManifestBudget(input.maxChars);
  const runtimeEnabled = input.runtimeEnabled ?? Boolean(input.v2);
  if (!runtimeEnabled || !input.v2) return emptySnapshot(maxChars, runtimeEnabled);
  const manifest = resolveManifest(input.v2, 'conversation-turn', maxChars);
  const entries = [...manifest.requiredReadItems, ...manifest.items];
  return {
    runtimeEnabled: true,
    entries,
    // This historical field now carries an index-only prompt block. It never
    // contains a memory detail body.
    mergedContent: manifest.promptBlock,
    charCount: manifest.promptSerializedChars,
    maxChars,
    overLimit: manifest.omittedCount > 0,
    promptBlock: manifest.promptBlock,
    requiredReadPreflight: manifest.requiredReadPreflight,
  };
}

export async function resolveAgentMemoryContext(input: {
  agentName: string;
  mode: AgentMemoryResolverMode;
  workflowContext?: Record<string, unknown> | null;
  workingDirectory?: string;
  /** Deprecated engine-session input. It is deliberately never used for V2. */
  sessionId?: string;
  maxRoleMemoryChars?: number;
  v2?: AgentMemoryResolverV2Context;
}): Promise<string> {
  const maxChars = clampManifestBudget(input.maxRoleMemoryChars);
  if (!input.v2) return '';
  const manifest = resolveManifest(
    input.v2,
    input.mode === 'workflow-chat' ? 'step-start' : 'conversation-turn',
    maxChars,
  );
  return manifest.promptBlock;
}
