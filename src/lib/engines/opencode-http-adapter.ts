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

export type OpenCodeHttpClient = {
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
    }) => Promise<{ data?: Array<{ parts?: OpenCodePart[]; info?: { role?: string } }>; error?: unknown }>;
  };
};

export type OpenCodePromptBody = {
  model?: { providerID: string; modelID: string };
  variant?: string;
  parts: Array<{ type: 'text'; text: string }>;
};

export const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

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
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
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
  disableStreaming?: boolean;
}): Promise<string> {
  const promptBody: OpenCodePromptBody = {
    ...options.promptBodyExtras,
    parts: [{ type: 'text', text: options.fullPrompt }],
  };
  const query = options.workingDirectory ? { directory: options.workingDirectory } : undefined;

  if (options.disableStreaming || ((!options.eventBaseUrl && !options.client.event?.subscribe) || !options.client.session.promptAsync)) {
    return await sendPromptBlocking({
      client: options.client,
      sessionId: options.sessionId,
      promptBody,
      query,
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
    return await sendPromptBlocking({
      client: options.client,
      sessionId: options.sessionId,
      promptBody,
      query,
    });
  }
}

async function sendPromptBlocking(options: {
  client: OpenCodeHttpClient;
  sessionId: string;
  promptBody: OpenCodePromptBody;
  query?: { directory?: string };
}): Promise<string> {
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
  return extractOutput(promptResult.data);
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
}): Promise<string> {
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const existingAssistantPartIds = await loadAssistantPartIds(options.client, options.sessionId, options.query);

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

  const timeoutMs = Math.max(1_000, options.timeoutMs || 120_000);
  const timer = setTimeout(() => {
    streamError = new Error(`[${options.engineName}] streaming prompt timed out after ${timeoutMs}ms`);
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
      })
      : consumeSdkSseStream({
        client: options.client,
        directory: options.workingDirectory,
        signal: abortController.signal,
        onPayload: handlePayload,
        onError: (error) => {
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

    const structuredPartPoller = pollSessionMessagesWhileRunning({
      client: options.client,
      sessionId: options.sessionId,
      query: options.query,
      signal: abortController.signal,
      shouldStop: () => idle || streamEnded || Boolean(streamError),
      onPart: handlePartUpdated,
      ignorePartIds: existingAssistantPartIds,
    });

    while (!idle && !streamEnded && !streamError && !abortController.signal.aborted) {
      await sleep(50);
    }

    if (streamEnded && !idle && !streamError) {
      streamError = new Error(`[${options.engineName}] event stream ended before session idle`);
    }
    if (streamError) throw new Error(formatError(streamError));
    if (!idle && options.signal?.aborted) throw new Error(`[${options.engineName}] prompt cancelled`);
    if (!idle && !promptAccepted) throw new Error(`[${options.engineName}] prompt was not accepted`);
    await streamDone.done;
    await structuredPartPoller;
    await syncLatestAssistantParts();
    finalizeUnknownPartTypes();
    const hydratedOutput = await hydrateOutputFromSessionMessages(options.client, options.sessionId, options.query);
    if (hydratedOutput) {
      if (!output) {
        emitTextDelta(hydratedOutput);
      } else if (hydratedOutput.startsWith(output) && hydratedOutput.length > output.length) {
        emitTextDelta(hydratedOutput.slice(output.length));
      }
    }
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
    if (partType === 'text') {
      emitTextDelta(pending);
    } else if (partType === 'reasoning') {
      emitReasoningDelta(pending);
    }
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
      const delta = text.slice(current.length);
      if (part.type === 'text') {
        emitTextDelta(delta);
      } else {
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
    if (partType === 'text') {
      emitTextDelta(delta);
    } else {
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

  function handlePayload(payload: OpenCodeStreamEventPayload | undefined): void {
    if (!isCurrentSession(payload, options.sessionId)) return;

    const type = payload?.type;
    const properties = payload?.properties;
    if (!promptAccepted) {
      if (type === 'session.error') {
        streamError = properties?.error || payload;
        abortController.abort();
      }
      return;
    }
    if (type === 'session.idle') {
      finalizeUnknownPartTypes();
      idle = true;
      abortController.abort();
      return;
    }
    if (type === 'session.status' && properties?.status && (properties.status as any).type === 'idle') {
      finalizeUnknownPartTypes();
      idle = true;
      abortController.abort();
      return;
    }
    if (type === 'session.error') {
      streamError = properties?.error || payload;
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
    const stream = subscription.stream;
    if (!stream) return;
    for await (const payload of stream) {
      options.onPayload(normalizeSsePayload(payload));
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
        resolve();
      });
      response.on('error', (error) => {
        if (isDebugEnabled()) console.log(`[${options.label}] raw SSE response error: ${formatError(error)}`);
        reject(error);
      });
    });

    request.on('error', (error) => {
      if (isDebugEnabled()) console.log(`[${options.label}] raw SSE request error: ${formatError(error)}`);
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
