import http from 'http';
import https from 'https';

import type { EngineOptions, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import {
  formatAceReasoning,
  formatAceSubtaskResult,
  formatAceToolCall,
  formatAceToolResult,
  formatAceSubtaskStart,
  getAceToolTitle,
  stringifyStructured,
} from '@/lib/chat/ace-process-formatters';

const IGNORABLE_OPENCODE_SDK_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /child exited early code=1 signal=null; stderr tail:\s*<empty>/i,
];

function isIgnorableOpenCodeSdkTailError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message.trim()) return false;
  return IGNORABLE_OPENCODE_SDK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export type OpenCodeTextPart = {
  id?: string;
  type: 'text';
  text: string;
};

export type OpenCodePart = OpenCodeTextPart | {
  id?: string;
  type: string;
  text?: string;
  [key: string]: unknown;
};

export type OpenCodeSessionCreateResponse = {
  id?: string;
};

export type OpenCodeSessionPromptResponse = {
  info?: { parts?: OpenCodePart[]; error?: unknown };
  parts?: OpenCodePart[];
  [key: string]: unknown;
};

type OpenCodeStreamEventPayload = {
  type?: string;
  properties?: {
    sessionID?: string;
    sessionId?: string;
    session?: { id?: string };
    partID?: string;
    field?: string;
    delta?: string;
    part?: OpenCodePart;
    error?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type OpenCodeSseResult = {
  stream?: AsyncIterable<unknown>;
};

type OpenCodePermissionResponse = 'once' | 'always' | 'reject';

export type OpenCodeHttpClient = {
  postSessionIdPermissionsPermissionId?: (options: {
    path: { id: string; permissionID: string };
    body?: { response: OpenCodePermissionResponse };
    query?: { directory?: string };
  }) => Promise<{ data?: unknown; error?: unknown }>;
  config?: {
    get(options?: Record<string, never>): Promise<{ data?: unknown; error?: unknown }>;
  };
  event?: {
    subscribe(options?: {
      signal?: AbortSignal;
      cache?: RequestCache;
      headers?: HeadersInit;
      query?: { directory?: string };
      onSseEvent?: (event: { data?: OpenCodeStreamEventPayload }) => void;
      onSseError?: (error: unknown) => void;
    }): Promise<OpenCodeSseResult>;
  };
  session: {
    create(options: {
      body: Record<string, never>;
      query?: { directory?: string };
    }): Promise<{ data?: OpenCodeSessionCreateResponse; error?: unknown }>;
    prompt(options: {
      path: { id: string };
      body: OpenCodePromptBody;
      query?: { directory?: string };
    }): Promise<{ data?: OpenCodeSessionPromptResponse; error?: unknown }>;
    promptAsync?: (options: {
      path: { id: string };
      body: OpenCodePromptBody;
      query?: { directory?: string };
    }) => Promise<{ data?: unknown; error?: unknown }>;
    messages?: (options: {
      path: { id: string };
      query?: { directory?: string; limit?: number };
    }) => Promise<{ data?: OpenCodeSessionMessage[]; error?: unknown }>;
  };
};

export type OpenCodePromptBody = {
  model?: { providerID: string; modelID: string };
  variant?: string;
  parts: Array<{ type: 'text'; text: string }>;
};

type OpenCodeSessionMessage = {
  parts?: OpenCodePart[];
  info?: { role?: string };
};

export const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

type OpenCodeAdapterLogLevel = 'info' | 'warning' | 'error';

type OpenCodeAdapterLogFn = (entry: {
  level?: OpenCodeAdapterLogLevel;
  message: string;
  detail?: string;
  metadata?: unknown;
  verbose?: boolean;
}) => void;

const STABLE_ASSISTANT_COMPLETION_WINDOW_MS = 2_500;

function isDebugEnabled(): boolean {
  return process.env.ACE_TIMING_DEBUG === '1' || process.env.ACE_TIMING_DEBUG === 'true';
}

class PromptAlreadyStartedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PromptAlreadyStartedError';
  }
}

export function buildFullPrompt(options: Pick<EngineOptions, 'prompt' | 'systemPrompt'>): string {
  if (!options.systemPrompt) return options.prompt;
  return `<system>\n${options.systemPrompt}\n</system>\n\n${options.prompt}`;
}

export function getSessionId(session: OpenCodeSessionCreateResponse | undefined): string | null {
  if (!session || typeof session !== 'object') return null;
  return typeof session.id === 'string' ? session.id : null;
}

export function extractOutput(data: OpenCodeSessionPromptResponse | undefined): string {
  if (!data) return '';
  const direct = collectTextFromParts(data.info?.parts) || collectTextFromParts(data.parts);
  if (direct) return direct;
  return collectTextDeep(data);
}

export function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    const code = typeof (error as any)?.code === 'string' ? ` code=${(error as any).code}` : '';
    return `${error.name || 'Error'}: ${error.message}${code}`.trim();
  }
  if (error && typeof error === 'object' && typeof (error as any)?.message === 'string') {
    const code = typeof (error as any)?.code === 'string' ? ` code=${(error as any).code}` : '';
    return `${String((error as any).message)}${code}`.trim();
  }
  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // fall through
  }
  return String(error);
}

function isAbortLikeError(error: unknown): boolean {
  if (!error) return false;
  if ((error as any)?.name === 'AbortError') return true;
  const message = typeof (error as any)?.message === 'string'
    ? (error as any).message
    : typeof error === 'string'
      ? error
      : '';
  return /abort(ed)?/i.test(message);
}

function normalizeSsePayload(payload: unknown): OpenCodeStreamEventPayload | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const event = payload as Record<string, unknown>;
  const data = event.data && typeof event.data === 'object' ? event.data as Record<string, unknown> : null;
  if (data?.payload && typeof data.payload === 'object') {
    return data.payload as OpenCodeStreamEventPayload;
  }
  if (data && typeof data.type === 'string') {
    return data as unknown as OpenCodeStreamEventPayload;
  }
  if (typeof event.type === 'string') {
    return event as OpenCodeStreamEventPayload;
  }
  return undefined;
}

function formatToolCall(part: OpenCodePart): string {
  const toolName = String((part as any).tool || 'tool');
  const state = (part as any).state || {};
  const input = (state.input && typeof state.input === 'object') ? state.input as Record<string, unknown> : {};
  return formatAceToolCall({
    toolName,
    rawInput: input,
    title: getAceToolTitle(toolName),
    toolId: String((part as any).id || state.id || ''),
  });
}

function formatStructuredTaskResult(output: unknown, toolId?: string): string {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return '';
  const obj = output as Record<string, unknown>;
  const sessionId = String(
    obj.sessionId
      ?? obj.session_id
      ?? obj.taskId
      ?? obj.task_id
      ?? '',
  ).trim();
  const resultText = String(
    obj.resultText
      ?? obj.result_text
      ?? obj.result
      ?? obj.output
      ?? obj.message
      ?? obj.text
      ?? '',
  ).trim();
  return sessionId || resultText
    ? formatAceSubtaskResult({ sessionId, resultText, toolId })
    : '';
}

function formatToolResult(part: OpenCodePart): string {
  const state = (part as any).state || {};
  const toolId = String((part as any).id || state.id || '');
  if (state.status === 'completed') {
    if (String((part as any).tool || '') === 'task') {
      const taskOutput = state.output;
      const structuredTask = formatStructuredTaskResult(taskOutput, toolId);
      if (structuredTask) return structuredTask;
      const fallbackTaskOutput = taskOutput ?? stringifyStructured(taskOutput);
      if (fallbackTaskOutput == null || fallbackTaskOutput === '') return '';
      return formatAceToolResult({
        toolName: 'task',
        rawOutput: fallbackTaskOutput,
        title: getAceToolTitle('task'),
        toolId,
      });
    }
    const output = stringifyStructured(state.output || '');
    if (!output) return '';
    return formatAceToolResult({
      toolName: String((part as any).tool || 'tool'),
      rawOutput: state.output || output,
      title: getAceToolTitle(String((part as any).tool || 'tool')),
      toolId,
    });
  }
  if (state.status === 'error') {
    const error = stringifyStructured(state.error || 'tool failed');
    return error
      ? formatAceToolResult({
          toolName: String((part as any).tool || 'tool'),
          rawOutput: { error },
          title: getAceToolTitle(String((part as any).tool || 'tool')),
          toolId,
        })
      : '';
  }
  return '';
}

function formatAgentOrSubtask(part: OpenCodePart): string {
  if (part.type === 'agent') {
    const name = String((part as any).name || '').trim();
    return name
      ? formatAceSubtaskStart({
          title: name,
          description: name,
          agent: name,
        })
      : '';
  }
  if (part.type === 'subtask') {
    const agent = String((part as any).agent || '').trim();
    const description = String((part as any).description || '').trim();
    const prompt = String((part as any).prompt || '').trim();
    const body = description || prompt || agent;
    return body
      ? formatAceSubtaskStart({
          title: description || agent,
          description,
          agent,
          prompt,
        })
      : '';
  }
  return '';
}

export async function sendPromptWithOpenCodeHttp(options: {
  engineName: string;
  client: OpenCodeHttpClient;
  sessionId: string;
  fullPrompt: string;
  eventBaseUrl?: string;
  promptBodyExtras?: Omit<OpenCodePromptBody, 'parts'>;
  workingDirectory?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  emit: (event: EngineStreamEvent) => void;
  log?: OpenCodeAdapterLogFn;
  disableStreaming?: boolean;
  permissionResponse?: OpenCodePermissionResponse;
}): Promise<string> {
  const promptBody: OpenCodePromptBody = {
    ...options.promptBodyExtras,
    parts: [{ type: 'text', text: options.fullPrompt }],
  };
  const query = options.workingDirectory ? { directory: options.workingDirectory } : undefined;

  if (options.disableStreaming || ((!options.eventBaseUrl && !options.client.event?.subscribe) || !options.client.session.promptAsync)) {
    options.log?.({
      message: 'Using blocking prompt path',
      detail: options.disableStreaming ? 'streaming disabled by caller' : 'event stream API unavailable',
      verbose: true,
    });
    return await sendPromptBlocking({
      client: options.client,
      sessionId: options.sessionId,
      promptBody,
      query,
      log: options.log,
    });
  }

  try {
    return await sendPromptStreaming({
      ...options,
      promptBody,
      query,
    });
  } catch (error) {
    if (error instanceof PromptAlreadyStartedError) throw error;
    if (options.signal?.aborted) throw error;
    console.warn(`[${options.engineName}] streaming prompt failed, falling back to blocking prompt: ${formatError(error)}`);
    options.log?.({
      level: 'warning',
      message: 'Streaming prompt failed; falling back to blocking prompt',
      detail: formatError(error),
    });
    return await sendPromptBlocking({
      client: options.client,
      sessionId: options.sessionId,
      promptBody,
      query,
      log: options.log,
    });
  }
}

async function sendPromptBlocking(options: {
  client: OpenCodeHttpClient;
  sessionId: string;
  promptBody: OpenCodePromptBody;
  query?: { directory?: string };
  log?: OpenCodeAdapterLogFn;
}): Promise<string> {
  options.log?.({
    message: 'Blocking prompt start',
    detail: `sessionId=${options.sessionId}`,
    verbose: true,
  });
  const promptResult = await options.client.session.prompt({
    path: { id: options.sessionId },
    body: options.promptBody,
    query: options.query,
  });

  if (promptResult.error) {
    throw new Error(formatError(promptResult.error));
  }
  if (promptResult.data?.info?.error) {
    throw new Error(formatError(promptResult.data.info.error));
  }
  const output = extractOutput(promptResult.data);
  options.log?.({
    message: 'Blocking prompt done',
    detail: `outputLength=${output.length}`,
    verbose: true,
  });
  return output;
}

async function sendPromptStreaming(options: {
  engineName: string;
  client: OpenCodeHttpClient;
  sessionId: string;
  fullPrompt: string;
  eventBaseUrl?: string;
  promptBody: OpenCodePromptBody;
  query?: { directory?: string };
  workingDirectory?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  emit: (event: EngineStreamEvent) => void;
  log?: OpenCodeAdapterLogFn;
  permissionResponse?: OpenCodePermissionResponse;
}): Promise<string> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const existingAssistantPartIds = await loadAssistantPartIds(options.client, options.sessionId, options.query);
  const startedAt = Date.now();

  let output = '';
  let idle = false;
  let promptAccepted = false;
  let streamEnded = false;
  let streamError: unknown = null;
  const partTypes = new Map<string, string>();
  const partBuffers = new Map<string, string>();
  const ignoredTextParts = new Set<string>();
  let sawSessionNextText = false;
  const sessionNextTextBuffer = { text: '' };
  let sawSessionNextReasoning = false;
  const sessionNextReasoningBuffers = new Map<string, string>();
  const emittedStructuredPartStarts = new Set<string>();
  const emittedStructuredPartFinishes = new Set<string>();
  const pendingUnknownPartBuffers = new Map<string, string>();
  let latestAssistantTextSnapshot = '';
  let latestAssistantPartsSignature = '';
  let latestAssistantPartsTouchedAtMs = 0;
  let latestAssistantHasPendingStructuredParts = false;
  const repliedPermissionIds = new Set<string>();

  const timeoutMs = Math.max(1_000, options.timeoutMs || 120_000);
  options.log?.({
    message: 'Streaming prompt start',
    detail: `sessionId=${options.sessionId}, timeout=${timeoutMs}ms`,
    metadata: {
      workingDirectory: options.workingDirectory,
      hasRawSse: Boolean(options.eventBaseUrl),
    },
    verbose: true,
  });
  const timer = setTimeout(() => {
    streamError = new Error(`[${options.engineName}] streaming prompt timed out after ${timeoutMs}ms`);
    options.log?.({
      level: 'error',
      message: 'Streaming prompt timeout',
      detail: `${timeoutMs}ms`,
    });
    abortController.abort();
  }, timeoutMs);

  try {
    const streamDone = options.eventBaseUrl
      ? consumeRawSseStream({
        label: options.engineName,
        baseUrl: options.eventBaseUrl,
        directory: options.workingDirectory,
        signal: abortController.signal,
        onPayload: handlePayload,
        onConnected: (detail) => {
          options.log?.({
            message: 'Raw SSE connected',
            detail,
            verbose: true,
          });
        },
        onEnded: () => {
          options.log?.({
            message: 'Raw SSE ended',
            verbose: true,
          });
        },
        onError: (error) => {
          if (promptAccepted && isIgnorableOpenCodeSdkTailError(error)) {
            return;
          }
          options.log?.({
            level: 'error',
            message: 'Raw SSE error',
            detail: formatError(error),
          });
        },
      })
      : consumeSdkSseStream({
        client: options.client,
        directory: options.workingDirectory,
        signal: abortController.signal,
        onPayload: handlePayload,
        onConnected: () => {
          options.log?.({
            message: 'SDK SSE connected',
            detail: options.workingDirectory || '',
            verbose: true,
          });
        },
        onEnded: () => {
          options.log?.({
            message: 'SDK SSE ended',
            verbose: true,
          });
        },
        onError: (error) => {
          options.log?.({
            level: 'error',
            message: 'SDK SSE error',
            detail: formatError(error),
          });
          if (!abortController.signal.aborted) {
            streamError = error;
            abortController.abort();
          }
        },
      });

    streamDone.done
      .catch((error) => {
        if (!abortController.signal.aborted) streamError = error;
      })
      .finally(() => {
        streamEnded = true;
      });

    await streamDone.connected;
    options.log?.({
      message: 'Event stream connection ready',
      detail: options.eventBaseUrl || 'sdk.subscribe',
      verbose: true,
    });

    await sleep(25);
    if (streamEnded && !streamError) {
      throw new Error(`[${options.engineName}] event stream closed before prompt start`);
    }

    const promptResult = await options.client.session.promptAsync!({
      path: { id: options.sessionId },
      body: options.promptBody,
      query: options.query,
    });
    if (promptResult.error) {
      throw new Error(formatError(promptResult.error));
    }
    promptAccepted = true;
    options.log?.({
      message: 'promptAsync accepted',
      detail: `sessionId=${options.sessionId}`,
      verbose: true,
    });

    const structuredPartPoller = pollSessionMessagesWhileRunning({
      client: options.client,
      sessionId: options.sessionId,
      query: options.query,
      signal: abortController.signal,
      shouldStop: () => idle || streamEnded || Boolean(streamError),
      onPart: handlePartUpdated,
      onMessages: updateLatestAssistantTextSnapshot,
      ignorePartIds: existingAssistantPartIds,
    });

    while (!idle && !streamEnded && !streamError && !abortController.signal.aborted) {
      await sleep(50);
      if (promptAccepted && shouldCompleteFromStableAssistantSnapshot()) {
        idle = true;
        abortController.abort();
        break;
      }
    }

    if (!idle && options.signal?.aborted) throw new Error(`[${options.engineName}] prompt cancelled`);
    if (!idle && !promptAccepted) throw new Error(`[${options.engineName}] prompt was not accepted`);
    await streamDone.done;
    await structuredPartPoller;
    await syncLatestAssistantParts();
    finalizeUnknownPartTypes();
    const hydratedOutput = (await hydrateOutputFromSessionMessages(options.client, options.sessionId, options.query))
      || latestAssistantTextSnapshot;
    if (streamEnded && !idle && !(hydratedOutput || output)) {
      throw new Error(`[${options.engineName}] event stream ended before session idle`);
    }
    if (hydratedOutput) {
      if (!output) {
        emitTextDelta(hydratedOutput);
      } else if (hydratedOutput.startsWith(output) && hydratedOutput.length > output.length) {
        emitTextDelta(hydratedOutput.slice(output.length));
      }
    }
    if (streamError && !hydratedOutput) {
      throw new Error(formatError(streamError));
    }
    options.log?.({
      message: 'Streaming prompt done',
      detail: `outputLength=${(hydratedOutput || output).length}`,
      verbose: true,
    });
    return hydratedOutput || output;
  } catch (error) {
    if (promptAccepted) {
      throw new PromptAlreadyStartedError(formatError(error));
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    abortController.abort();
  }

  function emitTextDelta(delta: string): void {
    if (!delta) return;
    output += delta;
    options.emit({ type: 'text', content: delta });
  }

  function emitReasoningDelta(delta: string): void {
    if (!delta) return;
    options.emit({ type: 'thought', content: formatAceReasoning(delta) });
  }

  function shouldSuppressPartReplay(partType: string): boolean {
    return (partType === 'text' && sawSessionNextText)
      || (partType === 'reasoning' && sawSessionNextReasoning);
  }

  function flushPendingUnknownPartBuffer(partID: string, partType: string): void {
    const pending = pendingUnknownPartBuffers.get(partID) || '';
    if (!pending) return;
    pendingUnknownPartBuffers.delete(partID);
    const current = partBuffers.get(partID) || '';
    partBuffers.set(partID, current + pending);
    if (shouldSuppressPartReplay(partType)) return;
    if (partType === 'reasoning') {
      emitReasoningDelta(pending);
    }
  }

  function updateLatestAssistantTextSnapshot(messages: OpenCodeSessionMessage[] | undefined): void {
    if (!Array.isArray(messages)) return;
    const assistantMessages = messages.filter((message) => message?.info?.role === 'assistant');
    const latestAssistant = assistantMessages[assistantMessages.length - 1];
    const parts = Array.isArray(latestAssistant?.parts) ? latestAssistant.parts : [];
    const snapshot = collectTextFromParts(parts).trim();
    const signature = parts.map((part) => stableSerialize(part)).join('\n');
    const hasPendingStructuredParts = parts.some((part) => isPendingStructuredPart(part));
    if (
      signature !== latestAssistantPartsSignature
      || snapshot !== latestAssistantTextSnapshot
      || hasPendingStructuredParts !== latestAssistantHasPendingStructuredParts
    ) {
      latestAssistantPartsTouchedAtMs = Date.now() - startedAt;
      latestAssistantPartsSignature = signature;
      latestAssistantTextSnapshot = snapshot;
      latestAssistantHasPendingStructuredParts = hasPendingStructuredParts;
    }
  }

  function shouldCompleteFromStableAssistantSnapshot(): boolean {
    if (!latestAssistantTextSnapshot) return false;
    if (latestAssistantHasPendingStructuredParts) return false;
    if (!latestAssistantPartsTouchedAtMs) return false;
    return (Date.now() - startedAt - latestAssistantPartsTouchedAtMs) >= STABLE_ASSISTANT_COMPLETION_WINDOW_MS;
  }

  function emitSessionNextEndedDelta(current: string, finalText: string, kind: 'text' | 'reasoning'): void {
    if (!finalText) return;
    if (finalText === current) return;
    if (current && !finalText.startsWith(current)) return;
    const delta = current ? finalText.slice(current.length) : finalText;
    if (!delta) return;
    if (kind === 'text') {
      emitTextDelta(delta);
    } else {
      emitReasoningDelta(delta);
    }
  }

  async function syncLatestAssistantParts(): Promise<void> {
    if (typeof options.client.session.messages !== 'function') return;
    try {
      const result = await options.client.session.messages({
        path: { id: options.sessionId },
        query: { ...(options.query || {}), limit: 10 },
      });
      if (result.error || !Array.isArray(result.data)) return;
      updateLatestAssistantTextSnapshot(result.data);
      const assistantMessages = result.data.filter((message) => message?.info?.role === 'assistant');
      for (const message of assistantMessages) {
        const parts = Array.isArray(message?.parts) ? message.parts : [];
        for (const part of parts) {
          handlePartUpdated(part);
        }
      }
    } catch {
      // ignore final hydration failures; done.result remains the last fallback
    }
  }

  function handlePartUpdated(part: OpenCodePart): void {
    if (!part?.id || !part.type) return;
    if (existingAssistantPartIds.has(part.id)) return;
    partTypes.set(part.id, part.type);
    if (part.type === 'text' || part.type === 'reasoning') {
      const text = typeof part.text === 'string' ? part.text : '';
      if (!text) return;
      if (part.type === 'text' && text === options.fullPrompt) {
        ignoredTextParts.add(part.id);
        return;
      }
      if (ignoredTextParts.has(part.id)) return;

      flushPendingUnknownPartBuffer(part.id, part.type);
      const current = partBuffers.get(part.id) || '';
      partBuffers.set(part.id, text);
      if (text.length <= current.length) return;
      if (shouldSuppressPartReplay(part.type)) return;
      if (!text.startsWith(current)) return;
      if (part.type !== 'text') {
        const delta = text.slice(current.length);
        emitReasoningDelta(delta);
      }
      return;
    }

    if (part.type === 'tool') {
      const state = (part as any).state || {};
      const status = String(state.status || '');
      if ((status === 'pending' || status === 'running') && !emittedStructuredPartStarts.has(part.id)) {
        emittedStructuredPartStarts.add(part.id);
        options.emit({ type: 'text', content: formatToolCall(part) });
      }
      if ((status === 'completed' || status === 'error') && !emittedStructuredPartFinishes.has(part.id)) {
        if (!emittedStructuredPartStarts.has(part.id)) {
          emittedStructuredPartStarts.add(part.id);
          options.emit({ type: 'text', content: formatToolCall(part) });
        }
        emittedStructuredPartFinishes.add(part.id);
        const result = formatToolResult(part);
        if (result) options.emit({ type: 'text', content: result });
      }
      return;
    }

    if ((part.type === 'agent' || part.type === 'subtask') && !emittedStructuredPartStarts.has(part.id)) {
      emittedStructuredPartStarts.add(part.id);
      const formatted = formatAgentOrSubtask(part);
      if (formatted) options.emit({ type: 'text', content: formatted });
    }
  }

  function handlePartDelta(properties: OpenCodeStreamEventPayload['properties']): void {
    const partID = properties?.partID;
    const delta = properties?.delta;
    if (!partID || typeof delta !== 'string' || properties?.field !== 'text') return;
    if (existingAssistantPartIds.has(partID)) return;
    if (ignoredTextParts.has(partID)) return;
    const partType = partTypes.get(partID);
    if (partType !== 'text' && partType !== 'reasoning') {
      const current = pendingUnknownPartBuffers.get(partID) || '';
      pendingUnknownPartBuffers.set(partID, current + delta);
      return;
    }

    const current = partBuffers.get(partID) || '';
    partBuffers.set(partID, current + delta);
    if (partType !== 'text') {
      emitReasoningDelta(delta);
    }
  }

  function handleSessionNextTextDelta(properties: OpenCodeStreamEventPayload['properties']): void {
    const delta = properties?.delta;
    if (typeof delta !== 'string' || !delta) return;
    sawSessionNextText = true;
    sessionNextTextBuffer.text += delta;
    emitTextDelta(delta);
  }

  function handleSessionNextTextEnded(properties: OpenCodeStreamEventPayload['properties']): void {
    const text = typeof properties?.text === 'string' ? properties.text : '';
    if (!text) return;
    sawSessionNextText = true;
    emitSessionNextEndedDelta(sessionNextTextBuffer.text, text, 'text');
    sessionNextTextBuffer.text = text;
  }

  function handleSessionNextReasoningDelta(properties: OpenCodeStreamEventPayload['properties']): void {
    const reasoningID = typeof properties?.reasoningID === 'string' ? properties.reasoningID : '';
    const delta = properties?.delta;
    if (!reasoningID || typeof delta !== 'string' || !delta) return;
    sawSessionNextReasoning = true;
    const current = sessionNextReasoningBuffers.get(reasoningID) || '';
    sessionNextReasoningBuffers.set(reasoningID, current + delta);
    emitReasoningDelta(delta);
  }

  function handleSessionNextReasoningEnded(properties: OpenCodeStreamEventPayload['properties']): void {
    const reasoningID = typeof properties?.reasoningID === 'string' ? properties.reasoningID : '';
    const text = typeof properties?.text === 'string' ? properties.text : '';
    if (!reasoningID || !text) return;
    sawSessionNextReasoning = true;
    const current = sessionNextReasoningBuffers.get(reasoningID) || '';
    emitSessionNextEndedDelta(current, text, 'reasoning');
    sessionNextReasoningBuffers.set(reasoningID, text);
  }

  async function respondToPermissionRequest(properties: OpenCodeStreamEventPayload['properties']): Promise<void> {
    const response = options.permissionResponse;
    if (!response) return;
    const permissionID = typeof properties?.id === 'string' ? properties.id : '';
    const sessionID = properties?.sessionID || properties?.sessionId || options.sessionId;
    if (!permissionID || !sessionID) {
      options.log?.({
        level: 'warning',
        message: 'OpenCode permission request missing id',
        metadata: properties,
      });
      return;
    }

    const replyKey = `${sessionID}:${permissionID}`;
    if (repliedPermissionIds.has(replyKey)) return;
    repliedPermissionIds.add(replyKey);

    if (typeof options.client.postSessionIdPermissionsPermissionId !== 'function') {
      const error = new Error('OpenCode permission response API unavailable');
      streamError = error;
      options.log?.({
        level: 'error',
        message: 'OpenCode permission auto-approval unavailable',
        detail: formatError(error),
        metadata: properties,
      });
      abortController.abort();
      return;
    }

    try {
      const result = await options.client.postSessionIdPermissionsPermissionId({
        path: { id: sessionID, permissionID },
        body: { response },
        query: options.query,
      });
      if (result?.error) {
        throw new Error(formatError(result.error));
      }
    } catch (error) {
      streamError = error;
      options.log?.({
        level: 'error',
        message: 'OpenCode permission auto-approval failed',
        detail: formatError(error),
        metadata: properties,
      });
      abortController.abort();
    }
  }

  function handlePayload(payload: OpenCodeStreamEventPayload | undefined): void {
    if (!isCurrentSession(payload, options.sessionId)) return;

    const type = payload?.type;
    const properties = payload?.properties;
    options.log?.({
      message: `OpenCode SSE event: ${type || 'unknown'}`,
      detail: typeof properties?.field === 'string'
        ? `field=${properties.field}`
        : typeof properties?.status === 'string'
          ? `status=${properties.status}`
          : undefined,
      metadata: payload,
      verbose: true,
    });
    if (type === 'permission.asked') {
      void respondToPermissionRequest(properties);
      return;
    }
    if (!promptAccepted) {
      if (type === 'session.error') {
        streamError = properties?.error || payload;
        options.log?.({
          level: 'error',
          message: 'OpenCode SSE session.error before prompt accepted',
          detail: formatError(properties?.error || payload),
        });
        abortController.abort();
      }
      return;
    }
    if (type === 'session.idle') {
      finalizeUnknownPartTypes();
      options.log?.({
        message: 'OpenCode session idle',
        detail: options.sessionId,
        verbose: true,
      });
      idle = true;
      abortController.abort();
      return;
    }
    if (type === 'session.status' && properties?.status && (properties.status as any).type === 'idle') {
      finalizeUnknownPartTypes();
      options.log?.({
        message: 'OpenCode session status idle',
        detail: options.sessionId,
        verbose: true,
      });
      idle = true;
      abortController.abort();
      return;
    }
    if (type === 'session.error') {
      streamError = properties?.error || payload;
      options.log?.({
        level: 'error',
        message: 'OpenCode session.error',
        detail: formatError(properties?.error || payload),
      });
      abortController.abort();
      return;
    }
    if (type === 'message.part.updated' && properties?.part) {
      handlePartUpdated(properties.part);
      return;
    }
    if (type === 'message.part.delta') {
      handlePartDelta(properties);
      return;
    }
    if (type === 'session.next.text.started') {
      return;
    }
    if (type === 'session.next.text.delta') {
      handleSessionNextTextDelta(properties);
      return;
    }
    if (type === 'session.next.text.ended') {
      handleSessionNextTextEnded(properties);
      return;
    }
    if (type === 'session.next.reasoning.started') {
      if (typeof properties?.reasoningID === 'string' && !sessionNextReasoningBuffers.has(properties.reasoningID)) {
        sessionNextReasoningBuffers.set(properties.reasoningID, '');
      }
      return;
    }
    if (type === 'session.next.reasoning.delta') {
      handleSessionNextReasoningDelta(properties);
      return;
    }
    if (type === 'session.next.reasoning.ended') {
      handleSessionNextReasoningEnded(properties);
    }
  }

  function finalizeUnknownPartTypes(): void {
    pendingUnknownPartBuffers.clear();
  }
}

function isCurrentSession(payload: OpenCodeStreamEventPayload | undefined, sessionId: string): boolean {
  const properties = payload?.properties;
  const eventSessionId = properties?.sessionID || properties?.sessionId || properties?.session?.id;
  return !eventSessionId || eventSessionId === sessionId;
}

function consumeSdkSseStream(options: {
  client: OpenCodeHttpClient;
  directory?: string;
  signal: AbortSignal;
  onPayload: (payload: OpenCodeStreamEventPayload | undefined) => void;
  onConnected?: () => void;
  onEnded?: () => void;
  onError: (error: unknown) => void;
}): { connected: Promise<void>; done: Promise<void> } {
  const connected = options.client.event!.subscribe({
    signal: options.signal,
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
    query: options.directory ? { directory: options.directory } : undefined,
    onSseError: options.onError,
  });

  const done = connected.then(async (subscription) => {
    options.onConnected?.();
    const stream = subscription.stream;
    if (!stream) return;
    try {
      for await (const payload of stream) {
        options.onPayload(normalizeSsePayload(payload));
      }
      options.onEnded?.();
    } catch (error) {
      if (options.signal.aborted || isAbortLikeError(error)) return;
      throw error;
    }
  });

  return { connected: connected.then(() => undefined), done };
}

function consumeRawSseStream(options: {
  label: string;
  baseUrl: string;
  directory?: string;
  signal: AbortSignal;
  onPayload: (payload: OpenCodeStreamEventPayload | undefined) => void;
  onConnected?: (detail: string) => void;
  onEnded?: () => void;
  onError?: (error: unknown) => void;
}): { connected: Promise<void>; done: Promise<void> } {
  let resolveConnected!: () => void;
  let rejectConnected!: (error: unknown) => void;
  const connected = new Promise<void>((resolve, reject) => {
    resolveConnected = resolve;
    rejectConnected = reject;
  });

  const done = new Promise<void>((resolve, reject) => {
    let settledConnection = false;
    let buffer = '';
    const url = new URL('/event', options.baseUrl);
    if (options.directory) url.searchParams.set('directory', options.directory);
    const transport = url.protocol === 'https:' ? https : http;
    const request = transport.request(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    }, (response) => {
      settledConnection = true;
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        const error = new Error(`SSE failed: HTTP ${response.statusCode}`);
        rejectConnected(error);
        reject(error);
        response.resume();
        return;
      }
      if (isDebugEnabled()) {
        console.log(`[${options.label}] raw SSE connected: ${url.href}`);
      }
      options.onConnected?.(url.href);
      resolveConnected();
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        buffer += chunk;
        const chunks = buffer.split(/\r?\n\r?\n/);
        buffer = chunks.pop() || '';
        for (const eventChunk of chunks) {
          const payload = parseSseChunk(eventChunk);
          if (payload !== undefined) options.onPayload(payload);
        }
      });
      response.on('end', () => {
        if (isDebugEnabled()) console.log(`[${options.label}] raw SSE ended`);
        options.onEnded?.();
        resolve();
      });
      response.on('error', (error) => {
        if (isDebugEnabled()) console.log(`[${options.label}] raw SSE response error: ${formatError(error)}`);
        options.onError?.(error);
        reject(error);
      });
    });

    request.on('error', (error) => {
      if (isDebugEnabled()) console.log(`[${options.label}] raw SSE request error: ${formatError(error)}`);
      options.onError?.(error);
      if (!settledConnection) rejectConnected(error);
      reject(error);
    });
    options.signal.addEventListener('abort', () => {
      request.destroy();
      resolveConnected();
      resolve();
    }, { once: true });
    request.end();
  });

  return { connected, done };
}

function parseSseChunk(chunk: string): OpenCodeStreamEventPayload | undefined {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.replace(/^data:\s*/, ''))
    .join('\n');
  if (!data) return undefined;
  try {
    const parsed = JSON.parse(data);
    if (parsed?.payload && typeof parsed.payload === 'object') {
      return parsed.payload as OpenCodeStreamEventPayload;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

function collectTextFromParts(parts: OpenCodePart[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is OpenCodeTextPart => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function collectTextDeep(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    return value.map(collectTextDeep).filter(Boolean).join('');
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  for (const key of ['parts', 'content', 'message', 'info', 'data']) {
    const text = collectTextDeep(record[key]);
    if (text) return text;
  }
  return '';
}

function stableSerialize(value: unknown): string {
  try {
    return JSON.stringify(value) || '';
  } catch {
    return String(value);
  }
}

function isPendingStructuredPart(part: OpenCodePart | undefined): boolean {
  if (!part || typeof part !== 'object') return false;
  if (part.type === 'text' || part.type === 'reasoning') return false;
  const state = (part as any).state || {};
  const status = String(state.status || (part as any).status || '').toLowerCase();
  return status === 'pending' || status === 'running' || status === 'in_progress';
}

async function hydrateOutputFromSessionMessages(
  client: OpenCodeHttpClient,
  sessionId: string,
  query?: { directory?: string },
): Promise<string> {
  if (typeof client.session.messages !== 'function') return '';
  const result = await client.session.messages({
    path: { id: sessionId },
    query: { ...(query || {}), limit: 20 },
  });
  if (result.error || !Array.isArray(result.data)) return '';
  const assistantMessages = result.data.filter((message) => message?.info?.role === 'assistant');
  const latestAssistant = assistantMessages[assistantMessages.length - 1];
  return collectTextFromParts(latestAssistant?.parts).trim();
}

async function pollSessionMessagesWhileRunning(options: {
  client: OpenCodeHttpClient;
  sessionId: string;
  query?: { directory?: string };
  signal: AbortSignal;
  shouldStop: () => boolean;
  onMessages?: (messages: OpenCodeSessionMessage[]) => void;
  onPart: (part: OpenCodePart) => void;
  ignorePartIds?: Set<string>;
}): Promise<void> {
  if (typeof options.client.session.messages !== 'function') return;
  const seenSnapshots = new Map<string, string>();

  while (!options.signal.aborted && !options.shouldStop()) {
    try {
      const result = await options.client.session.messages({
        path: { id: options.sessionId },
        query: { ...(options.query || {}), limit: 10 },
      });
      if (!result.error && Array.isArray(result.data)) {
        options.onMessages?.(result.data);
        const assistantMessages = result.data.filter((message) => message?.info?.role === 'assistant');
        for (const message of assistantMessages) {
          const parts = Array.isArray(message?.parts) ? message.parts : [];
          for (const part of parts) {
            if (!part?.id) continue;
            if (options.ignorePartIds?.has(part.id)) continue;
            const snapshot = JSON.stringify(part);
            if (seenSnapshots.get(part.id) === snapshot) continue;
            seenSnapshots.set(part.id, snapshot);
            options.onPart(part);
          }
        }
      }
    } catch {
      // ignore transient poll failures; SSE path remains primary
    }

    if (options.signal.aborted || options.shouldStop()) return;
    await sleep(400);
  }
}

async function loadAssistantPartIds(
  client: OpenCodeHttpClient,
  sessionId: string,
  query?: { directory?: string },
): Promise<Set<string>> {
  if (typeof client.session.messages !== 'function') return new Set<string>();
  try {
    const result = await client.session.messages({
      path: { id: sessionId },
      query: { ...(query || {}), limit: 20 },
    });
    if (result.error || !Array.isArray(result.data)) return new Set<string>();
    return new Set(
      result.data
        .filter((message) => message?.info?.role === 'assistant')
        .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
        .map((part) => String(part?.id || ''))
        .filter(Boolean),
    );
  } catch {
    return new Set<string>();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
