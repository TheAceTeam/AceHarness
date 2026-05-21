import type { Engine, EngineOptions, EngineResult } from './engine-interface';

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_COMPACT_SOURCE_LIMIT = 120_000;
const DEFAULT_CONTINUATION_PROMPT_LIMIT = 48_000;

const COMPACT_SUMMARY_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations and agent work so another agent can continue without losing context.';

const COMPACT_SUMMARY_TASK = `Your task is to create a detailed summary of the conversation or agent work so far, paying close attention to the user's explicit requests and the assistant's previous actions.
This summary should be thorough in capturing technical details, code patterns, architectural decisions, tool calls, files, errors, fixes, and current state that would be essential for continuing work without losing context.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts and ensure you've covered all necessary points. In your analysis process:

1. Chronologically analyze each message, tool result, and work section. For each section thoroughly identify:
   - The user's explicit requests and intents
   - The assistant's approach to addressing the user's requests
   - Key decisions, technical concepts, code patterns, and architectural constraints
   - Specific details like file names, function signatures, file edits, tool calls, command outputs, and important snippets
   - Errors encountered and how they were fixed
   - User feedback, especially if the user told the assistant to do something differently
2. Double-check for technical accuracy and completeness.

Your summary should include the following sections:

1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections
4. Errors and fixes
5. Problem Solving
6. All user messages
7. Pending Tasks
8. Current Work
9. Optional Next Step

Output exactly:
<analysis>
[your analysis]
</analysis>

<summary>
[structured summary using the sections above]
</summary>`;

export interface ContextRecoveryEvent {
  attempt: number;
  engineName: string;
  previousSessionId?: string;
  nextSessionId?: string;
  method: 'native-compact' | 'manual-compact' | 'manual-handoff';
  error: string;
  summary?: string;
}

export interface EngineContextRecoveryOptions {
  maxAttempts?: number;
  compactSourceLimit?: number;
  continuationPromptLimit?: number;
  transcriptPath?: string;
  compactInstructions?: string;
  buildCompactSource?: () => string | Promise<string>;
  onContextReset?: (event: ContextRecoveryEvent) => void | Promise<void>;
}

export interface ContextRecoveryMetadata {
  contextRecovered: boolean;
  method: ContextRecoveryEvent['method'];
  replacedSessionId?: string;
  replacementSessionId?: string;
  error: string;
  summary?: string;
}

export function getContextRecoveryMetadata(result?: EngineResult | null): ContextRecoveryMetadata | null {
  const value = result?.metadata?.contextRecovery;
  return value && typeof value === 'object' ? value as ContextRecoveryMetadata : null;
}

export function resolveRecoveredSessionId(result: EngineResult, fallbackSessionId?: string | null): string | null {
  const recovery = getContextRecoveryMetadata(result);
  if (recovery?.contextRecovered) {
    return result.sessionId || recovery.replacementSessionId || null;
  }
  return result.sessionId || fallbackSessionId || null;
}

export function isContextWindowExceededError(input: unknown): boolean {
  const message = input instanceof Error ? input.message : String(input || '');
  if (!message) return false;
  return /context[_\s-]?length[_\s-]?exceeded/i.test(message)
    || /context\s+window\s+limit/i.test(message)
    || /reached (its |the )?context window limit/i.test(message)
    || /maximum context length/i.test(message)
    || /prompt is too long/i.test(message)
    || /too many tokens/i.test(message)
    || /exceeds? (the )?(model )?context/i.test(message)
    || /context[^.]{0,80}exceeds?/i.test(message)
    || /input[^.]{0,80}tokens[^.]{0,80}exceeds?/i.test(message)
    || /tokens[^.]{0,80}exceeds?[^.]{0,80}context/i.test(message);
}

function describeEngine(engine: Engine): string {
  try {
    return engine.getName();
  } catch {
    return 'unknown-engine';
  }
}

function truncateMiddle(text: string, limit: number, label = '内容'): string {
  if (text.length <= limit) return text;
  const head = Math.floor(limit * 0.42);
  const tail = limit - head;
  return [
    text.slice(0, head).trimEnd(),
    '',
    `...[系统已省略 ${text.length - limit} 个字符的${label}，以便在新上下文中继续执行。优先保留开头约束和最新上下文。]...`,
    '',
    text.slice(-tail).trimStart(),
  ].join('\n');
}

function normalizeCompactSummary(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return '';
  return text
    .replace(/<analysis>\s*/gi, 'Analysis:\n')
    .replace(/\s*<\/analysis>/gi, '')
    .replace(/<summary>\s*/gi, 'Summary:\n')
    .replace(/\s*<\/summary>/gi, '')
    .trim();
}

function buildCompactRequest(source: string, error: string, compactInstructions?: string): string {
  return [
    COMPACT_SUMMARY_TASK,
    compactInstructions ? `\nAdditional compact instructions:\n${compactInstructions}` : '',
    '',
    'Context window failure that triggered this compact:',
    error.slice(0, 1200),
    '',
    'Conversation, task, tool, or work transcript to compact:',
    source,
  ].join('\n\n');
}

export function buildContextContinuationPrompt(input: {
  summary: string;
  currentPrompt: string;
  error?: string;
  transcriptPath?: string;
  continuationPromptLimit?: number;
}): string {
  return buildContinuationPrompt({
    summary: input.summary,
    currentPrompt: input.currentPrompt,
    error: input.error || 'manual context compaction',
    transcriptPath: input.transcriptPath,
    continuationPromptLimit: input.continuationPromptLimit ?? DEFAULT_CONTINUATION_PROMPT_LIMIT,
  });
}

async function runWithStreamListenersSuppressed<T>(engine: Engine, action: () => Promise<T>): Promise<T> {
  const eventedEngine = engine as unknown as {
    listeners?: (event: string) => Function[];
  };
  const listeners = typeof eventedEngine.listeners === 'function'
    ? eventedEngine.listeners('stream')
    : [];
  if (listeners.length === 0) return action();

  for (const listener of listeners) {
    try { engine.off('stream', listener as (event: any) => void); } catch {}
  }
  try {
    return await action();
  } finally {
    for (const listener of listeners) {
      try { engine.on('stream', listener as (event: any) => void); } catch {}
    }
  }
}

function buildFallbackSummary(source: string, error: string): string {
  return [
    'Summary:',
    '1. Primary Request and Intent:',
    '   The previous AI call ran out of context while handling the current request. Continue from the preserved task/context below.',
    '',
    '2. Key Technical Concepts:',
    '   Context compaction, session handoff, engine context window recovery.',
    '',
    '3. Files and Code Sections:',
    '   See the preserved context and workspace state. Re-read exact files before editing.',
    '',
    '4. Errors and fixes:',
    `   Context window exceeded: ${error.slice(0, 1000)}`,
    '   The system cleared the old session and created a compact handoff into a new session.',
    '',
    '5. Problem Solving:',
    '   Continue the same task without relying on hidden prior session state.',
    '',
    '6. All user messages:',
    '   See preserved context below.',
    '',
    '7. Pending Tasks:',
    '   Continue the interrupted task.',
    '',
    '8. Current Work:',
    truncateMiddle(source, 20_000, '当前工作上下文'),
    '',
    '9. Optional Next Step:',
    '   Re-read relevant files or state, then continue the interrupted task.',
  ].join('\n');
}

function buildContinuationPrompt(input: {
  summary: string;
  currentPrompt: string;
  error: string;
  transcriptPath?: string;
  continuationPromptLimit: number;
}): string {
  const suffix = input.transcriptPath
    ? `If you need specific details from before compaction, read the full transcript or persisted run data at: ${input.transcriptPath}`
    : 'If you need specific details from before compaction, inspect the available persisted chat/run logs and re-read relevant workspace files.';
  return [
    'This session is being continued from a previous conversation or agent run that ran out of context. The summary below covers the earlier portion of the conversation/work.',
    '',
    input.summary,
    '',
    suffix,
    '',
    'Context failure that caused the handoff:',
    input.error.slice(0, 1200),
    '',
    'Current request/task to continue:',
    truncateMiddle(input.currentPrompt, input.continuationPromptLimit, '当前请求'),
  ].join('\n\n');
}

async function buildManualCompactSummary(
  engine: Engine,
  options: EngineOptions,
  recovery: EngineContextRecoveryOptions,
  error: string,
): Promise<string> {
  const rawSource = recovery.buildCompactSource ? await recovery.buildCompactSource() : options.prompt;
  const source = truncateMiddle(String(rawSource || options.prompt), recovery.compactSourceLimit ?? DEFAULT_COMPACT_SOURCE_LIMIT, '待压缩上下文');
  const compactPrompt = buildCompactRequest(source, error, recovery.compactInstructions);
  try {
    const compactResult = await runWithStreamListenersSuppressed(engine, () => {
      return engine.execute({
        ...options,
        step: `${options.step}-compact`,
        prompt: compactPrompt,
        systemPrompt: COMPACT_SUMMARY_SYSTEM_PROMPT,
        sessionId: undefined,
        forceNewSession: true,
        appendSystemPrompt: false,
        allowedTools: [],
        timeoutMs: options.timeoutMs,
      });
    });
    const normalized = normalizeCompactSummary(compactResult.output || '');
    if (compactResult.success && normalized) return normalized;
  } catch {
    // Fall back to a deterministic handoff below.
  }
  return buildFallbackSummary(source, error);
}

export async function compactEngineContextManually(
  engine: Engine,
  options: EngineOptions,
  recovery: EngineContextRecoveryOptions = {},
): Promise<{
  summary: string;
  method: ContextRecoveryEvent['method'];
  previousSessionId?: string;
  nextSessionId?: string | null;
  prompt: string;
}> {
  const previousSessionId = options.sessionId;
  const error = 'manual context compaction requested by user';
  const continuationPromptLimit = recovery.continuationPromptLimit ?? DEFAULT_CONTINUATION_PROMPT_LIMIT;

  if (previousSessionId && typeof engine.compactContext === 'function') {
    try {
      const compacted = await engine.compactContext({
        sessionId: previousSessionId,
        prompt: options.prompt,
        systemPrompt: options.systemPrompt,
        model: options.model,
        workingDirectory: options.workingDirectory,
        error,
      });
      if (compacted) {
        const summary = normalizeCompactSummary(compacted.summary || compacted.prompt || '');
        const prompt = compacted.prompt || buildContinuationPrompt({
          summary: summary || buildFallbackSummary(options.prompt, error),
          currentPrompt: options.prompt,
          error,
          transcriptPath: recovery.transcriptPath,
          continuationPromptLimit,
        });
        return {
          summary,
          method: 'native-compact',
          previousSessionId,
          nextSessionId: compacted.sessionId || previousSessionId,
          prompt,
        };
      }
    } catch {
      // Fall back to manual compaction below.
    }
  }

  const summary = await buildManualCompactSummary(engine, options, recovery, error);
  const prompt = buildContinuationPrompt({
    summary,
    currentPrompt: options.prompt,
    error,
    transcriptPath: recovery.transcriptPath,
    continuationPromptLimit,
  });
  return {
    summary,
    method: 'manual-compact',
    previousSessionId,
    nextSessionId: null,
    prompt,
  };
}

function resultContextError(result: EngineResult): string {
  return [
    result.error || '',
    result.stopReason || '',
    result.output || '',
  ].filter(Boolean).join('\n');
}

export async function executeEngineWithContextRecovery(
  engine: Engine,
  options: EngineOptions,
  recovery: EngineContextRecoveryOptions = {},
): Promise<EngineResult> {
  const maxAttempts = Math.max(1, recovery.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const continuationPromptLimit = recovery.continuationPromptLimit ?? DEFAULT_CONTINUATION_PROMPT_LIMIT;
  let currentOptions: EngineOptions = { ...options };
  let lastContextError = '';
  let recoveryMetadata: ContextRecoveryMetadata | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await engine.execute(currentOptions);
      const contextError = result.success ? '' : resultContextError(result);
      if (result.success || !isContextWindowExceededError(contextError) || attempt >= maxAttempts) {
        if (recoveryMetadata) {
          recoveryMetadata.replacementSessionId = result.sessionId || recoveryMetadata.replacementSessionId;
          result.metadata = {
            ...(result.metadata || {}),
            contextRecovery: recoveryMetadata,
          };
        }
        return result;
      }
      lastContextError = contextError || 'context window exceeded';
    } catch (error) {
      const contextError = error instanceof Error ? error.message : String(error);
      if (!isContextWindowExceededError(contextError) || attempt >= maxAttempts) {
        throw error;
      }
      lastContextError = contextError || 'context window exceeded';
    }

    const previousSessionId = currentOptions.sessionId;
    let nextOptions: EngineOptions | null = null;
    let method: ContextRecoveryEvent['method'] = 'manual-handoff';
    let summary = '';

    if (previousSessionId && typeof engine.compactContext === 'function') {
      try {
        const compacted = await engine.compactContext({
          sessionId: previousSessionId,
          prompt: options.prompt,
          systemPrompt: options.systemPrompt,
          model: options.model,
          workingDirectory: options.workingDirectory,
          error: lastContextError,
        });
        if (compacted) {
          method = 'native-compact';
          summary = normalizeCompactSummary(compacted.summary || compacted.prompt || '');
          nextOptions = {
            ...options,
            sessionId: compacted.sessionId || previousSessionId,
            prompt: compacted.prompt || buildContinuationPrompt({
              summary: summary || buildFallbackSummary(options.prompt, lastContextError),
              currentPrompt: options.prompt,
              error: lastContextError,
              transcriptPath: recovery.transcriptPath,
              continuationPromptLimit,
            }),
            appendSystemPrompt: true,
          };
        }
      } catch {
        nextOptions = null;
      }
    }

    if (!nextOptions) {
      method = 'manual-compact';
      summary = await buildManualCompactSummary(engine, options, recovery, lastContextError);
      nextOptions = {
        ...options,
        sessionId: undefined,
        forceNewSession: true,
        appendSystemPrompt: false,
        prompt: buildContinuationPrompt({
          summary,
          currentPrompt: options.prompt,
          error: lastContextError,
          transcriptPath: recovery.transcriptPath,
          continuationPromptLimit,
        }),
      };
    }

    await recovery.onContextReset?.({
      attempt,
      engineName: describeEngine(engine),
      previousSessionId,
      nextSessionId: nextOptions.sessionId,
      method,
      error: lastContextError,
      summary,
    });
    recoveryMetadata = {
      contextRecovered: true,
      method,
      replacedSessionId: previousSessionId,
      replacementSessionId: nextOptions.sessionId,
      error: lastContextError,
      summary,
    };
    currentOptions = nextOptions;
  }

  const result = await engine.execute(currentOptions);
  if (recoveryMetadata) {
    recoveryMetadata.replacementSessionId = result.sessionId || recoveryMetadata.replacementSessionId;
    result.metadata = {
      ...(result.metadata || {}),
      contextRecovery: recoveryMetadata,
    };
  }
  return result;
}
