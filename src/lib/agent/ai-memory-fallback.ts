import type { MemoryDecisionProposal } from '@/lib/memory-v2';
import {
  AiMemoryToolContractError,
  isAiMemoryNativeToolName,
  parseAiMemoryNativeToolInvocation,
  type AiMemoryNativeToolName,
} from '@/lib/agent/ai-memory-contracts';
import {
  type AiMemoryToolExecutionResult,
  type AiMemoryToolExecutor,
} from '@/lib/agent/ai-memory-tools';

export const AI_MEMORY_FALLBACK_TOOLS_TAG = 'memory-v2-tools';
export const AI_MEMORY_FALLBACK_DECISIONS_TAG = 'memory-v2-decisions';

export interface AiMemoryFallbackToolCall {
  name: AiMemoryNativeToolName;
  arguments: unknown;
}

export interface AiMemoryFallbackParseError {
  code: 'invalid-envelope' | 'invalid-call' | 'duplicate-block' | 'oversized-block' | 'unterminated-block';
  message: string;
}

export interface AiMemoryFallbackParseResult {
  visibleText: string;
  calls: AiMemoryFallbackToolCall[];
  errors: AiMemoryFallbackParseError[];
  hadFallbackBlock: boolean;
}

export interface AiMemoryFallbackExecutionResult extends AiMemoryFallbackParseResult {
  toolResults: AiMemoryToolExecutionResult[];
}

const MAX_FALLBACK_OUTPUT_CHARS = 160_000;
const MAX_FALLBACK_BLOCK_CHARS = 80_000;
const MAX_FALLBACK_CALLS = 16;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function trimCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(trimCodeFence(value));
  if (!isRecord(parsed)) throw new AiMemoryToolContractError('fallback envelope must be a JSON object');
  return parsed;
}

function stripAndCollectTag(
  source: string,
  tag: string,
  errors: AiMemoryFallbackParseError[],
): { visibleText: string; bodies: string[]; hadBlock: boolean } {
  const opening = `<${tag}>`;
  const closing = `</${tag}>`;
  const lowerSource = source.toLocaleLowerCase();
  const lowerOpening = opening.toLocaleLowerCase();
  const lowerClosing = closing.toLocaleLowerCase();
  let cursor = 0;
  let visibleText = '';
  const bodies: string[] = [];
  let hadBlock = false;

  for (;;) {
    const start = lowerSource.indexOf(lowerOpening, cursor);
    if (start < 0) {
      visibleText += source.slice(cursor);
      break;
    }
    hadBlock = true;
    visibleText += source.slice(cursor, start);
    const contentStart = start + opening.length;
    const end = lowerSource.indexOf(lowerClosing, contentStart);
    if (end < 0) {
      errors.push({
        code: 'unterminated-block',
        message: `<${tag}> must have a closing tag`,
      });
      break;
    }
    const body = source.slice(contentStart, end).trim();
    if (body.length > MAX_FALLBACK_BLOCK_CHARS) {
      errors.push({ code: 'oversized-block', message: `<${tag}> exceeds the structured fallback limit` });
    } else {
      bodies.push(body);
    }
    cursor = end + closing.length;
  }
  return { visibleText, bodies, hadBlock };
}

function parseToolEnvelope(body: string): AiMemoryFallbackToolCall[] {
  const envelope = parseJsonObject(body);
  const allowed = new Set(['version', 'calls']);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) throw new AiMemoryToolContractError(`fallback tools envelope.${key} is not allowed`);
  }
  if (envelope.version !== 1) throw new AiMemoryToolContractError('fallback tools envelope version must be 1');
  if (!Array.isArray(envelope.calls)) throw new AiMemoryToolContractError('fallback tools envelope calls must be an array');
  if (envelope.calls.length > MAX_FALLBACK_CALLS) throw new AiMemoryToolContractError('fallback tools envelope has too many calls');
  return envelope.calls.map((call, index) => {
    if (!isRecord(call)) throw new AiMemoryToolContractError(`fallback call ${index} must be an object`);
    const keys = Object.keys(call);
    if (keys.some((key) => key !== 'name' && key !== 'arguments')) {
      throw new AiMemoryToolContractError(`fallback call ${index} has unsupported fields`);
    }
    if (!isAiMemoryNativeToolName(call.name)) throw new AiMemoryToolContractError(`fallback call ${index} has an unknown tool name`);
    if (!Object.prototype.hasOwnProperty.call(call, 'arguments')) {
      throw new AiMemoryToolContractError(`fallback call ${index} is missing arguments`);
    }
    parseAiMemoryNativeToolInvocation(call.name, call.arguments);
    return { name: call.name, arguments: call.arguments };
  });
}

function parseDecisionEnvelope(body: string): AiMemoryFallbackToolCall[] {
  const envelope = parseJsonObject(body);
  const allowed = new Set(['version', 'decisions']);
  for (const key of Object.keys(envelope)) {
    if (!allowed.has(key)) throw new AiMemoryToolContractError(`fallback decisions envelope.${key} is not allowed`);
  }
  if (envelope.version !== 1) throw new AiMemoryToolContractError('fallback decisions envelope version must be 1');
  if (!Array.isArray(envelope.decisions)) throw new AiMemoryToolContractError('fallback decisions envelope decisions must be an array');
  if (envelope.decisions.length > MAX_FALLBACK_CALLS) throw new AiMemoryToolContractError('fallback decisions envelope has too many decisions');
  return envelope.decisions.map((decision, index) => {
    const parsed = parseAiMemoryNativeToolInvocation('memory.propose', decision);
    if (parsed.name !== 'memory.propose') throw new AiMemoryToolContractError(`fallback decision ${index} is invalid`);
    return { name: 'memory.propose', arguments: decision as MemoryDecisionProposal };
  });
}

function toParseError(error: unknown, code: AiMemoryFallbackParseError['code']): AiMemoryFallbackParseError {
  return {
    code,
    message: error instanceof Error && error.message ? error.message : 'invalid structured fallback block',
  };
}

/**
 * Pulls private fallback envelopes out of an engine result. Callers must render
 * only visibleText; the envelope is server-side control data, never chat text.
 */
export function parseAiMemoryStructuredFallback(rawOutput: string): AiMemoryFallbackParseResult {
  const output = String(rawOutput || '');
  const boundedOutput = output.length > MAX_FALLBACK_OUTPUT_CHARS
    ? output.slice(0, MAX_FALLBACK_OUTPUT_CHARS)
    : output;
  const errors: AiMemoryFallbackParseError[] = output.length > MAX_FALLBACK_OUTPUT_CHARS
    ? [{ code: 'oversized-block', message: 'engine output exceeds the structured fallback limit' }]
    : [];
  const tools = stripAndCollectTag(boundedOutput, AI_MEMORY_FALLBACK_TOOLS_TAG, errors);
  const decisions = stripAndCollectTag(tools.visibleText, AI_MEMORY_FALLBACK_DECISIONS_TAG, errors);
  const calls: AiMemoryFallbackToolCall[] = [];
  if (tools.bodies.length + decisions.bodies.length > 1) {
    errors.push({ code: 'duplicate-block', message: 'only one fallback tools or decisions block is allowed per engine result' });
  }
  if (tools.bodies.length + decisions.bodies.length <= 1) {
    for (const body of tools.bodies) {
      try {
        calls.push(...parseToolEnvelope(body));
      } catch (error) {
        errors.push(toParseError(error, 'invalid-envelope'));
      }
    }
    for (const body of decisions.bodies) {
      try {
        calls.push(...parseDecisionEnvelope(body));
      } catch (error) {
        errors.push(toParseError(error, 'invalid-envelope'));
      }
    }
  }
  if (errors.length) {
    return {
      visibleText: decisions.visibleText.trim(),
      calls: [],
      errors,
      hadFallbackBlock: tools.hadBlock || decisions.hadBlock,
    };
  }
  if (calls.length > MAX_FALLBACK_CALLS) {
    return {
      visibleText: decisions.visibleText.trim(),
      calls: [],
      errors: [...errors, { code: 'invalid-call', message: 'combined fallback calls exceed the limit' }],
      hadFallbackBlock: tools.hadBlock || decisions.hadBlock,
    };
  }
  return {
    visibleText: decisions.visibleText.trim(),
    calls,
    errors,
    hadFallbackBlock: tools.hadBlock || decisions.hadBlock,
  };
}

export function executeAiMemoryStructuredFallback(
  rawOutput: string,
  executor: AiMemoryToolExecutor,
): AiMemoryFallbackExecutionResult {
  const parsed = parseAiMemoryStructuredFallback(rawOutput);
  return {
    ...parsed,
    toolResults: parsed.calls.map((call) => executor.execute(call.name, call.arguments)),
  };
}

export function buildAiMemoryFallbackInstruction(): string {
  return [
    'Memory V2 protocol:',
    '- Native memory tools are preferred. Do not place tool arguments in user-visible text.',
    '- If native tools are unavailable, append exactly one private fallback block after the visible response.',
    `<${AI_MEMORY_FALLBACK_TOOLS_TAG}>{"version":1,"calls":[{"name":"memory.propose","arguments":{...}}]}</${AI_MEMORY_FALLBACK_TOOLS_TAG}>`,
    `- For decision-only output, use <${AI_MEMORY_FALLBACK_DECISIONS_TAG}>{"version":1,"decisions":[...]}</${AI_MEMORY_FALLBACK_DECISIONS_TAG}> instead.`,
    '- The server removes these blocks before any user sees the response.',
  ].join('\n');
}
