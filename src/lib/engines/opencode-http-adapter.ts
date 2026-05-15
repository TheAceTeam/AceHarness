import http from 'http';
import https from 'https';

import type { EngineOptions, EngineResultMetadata, EngineStreamEvent } from './engine-interface';

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
}): Promise<string> {
  const promptBody: OpenCodePromptBody = {
    ...options.promptBodyExtras,
    parts: [{ type: 'text', text: options.fullPrompt }],
  };
  const query = options.workingDirectory ? { directory: options.workingDirectory } : undefined;

  if ((!options.eventBaseUrl && !options.client.event?.subscribe) || !options.client.session.promptAsync) {
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

  let output = '';
  let idle = false;
  let promptAccepted = false;
  let streamEnded = false;
  let streamError: unknown = null;
  const partTypes = new Map<string, string>();
  const partBuffers = new Map<string, string>();
  const ignoredTextParts = new Set<string>();

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

    while (!idle && !streamEnded && !streamError && !abortController.signal.aborted) {
      await sleep(50);
    }

    if (streamEnded && !idle && !streamError) {
      streamError = new Error(`[${options.engineName}] event stream ended before session.idle`);
    }
    if (streamError) throw new Error(formatError(streamError));
    if (!idle && options.signal?.aborted) throw new Error(`[${options.engineName}] prompt cancelled`);
    if (!idle && !promptAccepted) throw new Error(`[${options.engineName}] prompt was not accepted`);
    await streamDone.done;
    return output;
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

  function handlePartUpdated(part: OpenCodePart): void {
    if (!part?.id || !part.type) return;
    partTypes.set(part.id, part.type);
    if (part.type !== 'text') return;

    const text = typeof part.text === 'string' ? part.text : '';
    if (!text) return;
    if (text === options.fullPrompt) {
      ignoredTextParts.add(part.id);
      return;
    }
    if (ignoredTextParts.has(part.id)) return;

    const current = partBuffers.get(part.id) || '';
    if (text.length <= current.length || !text.startsWith(current)) return;
    const delta = text.slice(current.length);
    partBuffers.set(part.id, text);
    output += delta;
    options.emit({ type: 'text', content: delta });
  }

  function handlePartDelta(properties: OpenCodeStreamEventPayload['properties']): void {
    const partID = properties?.partID;
    const delta = properties?.delta;
    if (!partID || typeof delta !== 'string' || properties?.field !== 'text') return;
    if (ignoredTextParts.has(partID)) return;
    if (partTypes.get(partID) !== 'text') return;

    const current = partBuffers.get(partID) || '';
    partBuffers.set(partID, current + delta);
    output += delta;
    options.emit({ type: 'text', content: delta });
  }

  function handlePayload(payload: OpenCodeStreamEventPayload | undefined): void {
    if (!isCurrentSession(payload, options.sessionId)) return;

    const type = payload?.type;
    const properties = payload?.properties;
    if (type === 'session.idle') {
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
    }
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
      options.onPayload(payload as OpenCodeStreamEventPayload);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
