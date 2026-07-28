import type {
  MemoryManifest,
  MemoryManifestItem,
  MemoryManifestQuery,
  MemoryHandoffReceiptStatus,
  MemoryRequestContext,
  MemoryService,
} from '@/lib/memory-v2';
import {
  toAiMemoryIndexView,
  type AiMemoryIndexView,
} from '@/lib/agent/ai-memory-contracts';
import { buildAiMemoryFallbackInstruction } from '@/lib/agent/ai-memory-fallback';

export type AiMemoryManifestService = Pick<MemoryService, 'buildManifest'>;

export interface AiMemoryManifestItemView extends AiMemoryIndexView {
  delivery?: {
    handoffId: string;
    targetStepAttemptId: string;
    requiredRead: boolean;
    receiptStatus?: MemoryHandoffReceiptStatus;
  };
}

export interface AiMemoryPromptManifest {
  items: AiMemoryManifestItemView[];
  requiredReadItems: AiMemoryManifestItemView[];
  serializedChars: number;
  promptSerializedChars: number;
  omittedCount: number;
  requiredReadPreflight: 'ready';
  promptBlock: string;
}

export interface BuildAiMemoryPromptManifestInput {
  memoryService: AiMemoryManifestService;
  context: MemoryRequestContext;
  trigger: MemoryManifestQuery['trigger'];
  queryText?: string;
  targetStepAttemptId?: string;
  maxManifestChars?: number;
}

function toManifestItemView(item: MemoryManifestItem): AiMemoryManifestItemView {
  const index = toAiMemoryIndexView(item);
  if (!item.delivery) return index;
  return {
    ...index,
    delivery: {
      handoffId: item.delivery.handoffId,
      targetStepAttemptId: item.delivery.targetStepAttemptId,
      requiredRead: item.delivery.requiredRead,
      ...(item.delivery.receiptStatus ? { receiptStatus: item.delivery.receiptStatus } : {}),
    },
  };
}

function isRequiredReadItem(item: MemoryManifestItem): boolean {
  return item.delivery?.requiredRead === true || item.handoff.mode === 'required-read';
}

function promptPayload(
  items: AiMemoryManifestItemView[],
  requiredReadItems: AiMemoryManifestItemView[],
): Record<string, unknown> {
  return {
    items,
    requiredReadItems,
  };
}

function formatPromptBlock(payload: Record<string, unknown>): string {
  return [
    '<memory-v2-manifest>',
    JSON.stringify(payload),
    '</memory-v2-manifest>',
  ].join('\n');
}

/**
 * Builds a prompt payload from V2's first-level manifest only. It maps the
 * service's richer index records to the narrow prompt contract and never calls
 * readDetails.
 */
export function buildAiMemoryPromptManifest(input: BuildAiMemoryPromptManifestInput): AiMemoryPromptManifest {
  const manifest: MemoryManifest = input.memoryService.buildManifest({
    context: input.context,
    trigger: input.trigger,
    ...(input.queryText ? { queryText: input.queryText } : {}),
    ...(input.targetStepAttemptId ? { targetStepAttemptId: input.targetStepAttemptId } : {}),
    ...(input.maxManifestChars ? { maxManifestChars: input.maxManifestChars } : {}),
  });
  if (manifest.requiredReadPreflight !== 'ready') {
    // The core currently throws before returning a blocked result. Keep this
    // guard so future implementations cannot turn it into a silent prompt.
    throw new Error('Memory V2 required-read manifest preflight is blocked');
  }
  const requiredReadItems = manifest.requiredReadItems.map(toManifestItemView);
  const candidateItems = manifest.items
    .filter((item) => !isRequiredReadItem(item))
    .map(toManifestItemView);
  const payload = promptPayload(candidateItems, requiredReadItems);
  const serialized = JSON.stringify(payload);
  if (serialized.length > manifest.serializedChars) {
    throw new Error('Memory V2 prompt adapter exceeded the server manifest serialization budget');
  }
  return {
    items: candidateItems,
    requiredReadItems,
    serializedChars: manifest.serializedChars,
    promptSerializedChars: serialized.length,
    omittedCount: manifest.omittedCount,
    requiredReadPreflight: 'ready',
    promptBlock: formatPromptBlock(payload),
  };
}

export function buildAiMemoryDecisionRubric(): string {
  return [
    'Memory decision rubric:',
    '- Discard reasoning drafts, transient status, and facts with no future reuse or handoff value.',
    '- Use short memory for the current frontend conversation session or one complete workflow run. Workflow short memory is shared with authorized run participants, not private to its source agent.',
    '- Use long memory only for verified, durable cross-task knowledge. Retention does not imply delivery.',
    '- Choose handoff independently: manifest for index delivery, on-demand for explicit search only, and required-read only when a concrete target must read the versioned extract before work.',
    '- The manifest has summaries and IDs only. Read details only with memory.read when needed; acknowledge a required-read extract after it is read.',
    '- For a write, copy the server-issued sourceEventId from the write context exactly; do not invent one.',
    '- Never supply a lifecycle anchor, owner, workspace, participant, visibility, target-agent, or session/run authority. The server derives those values.',
  ].join('\n');
}

export function buildAiMemoryProtocolInstruction(input: { allowStructuredFallback?: boolean } = {}): string {
  const sections = [buildAiMemoryDecisionRubric()];
  if (input.allowStructuredFallback !== false) {
    sections.push(buildAiMemoryFallbackInstruction());
  }
  return sections.join('\n\n');
}
