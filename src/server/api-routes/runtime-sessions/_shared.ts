import type {
  RuntimeErrorCode,
  RuntimeErrorDto,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeTurnRef,
  RuntimeInterruptPolicy,
  RuntimeSessionKind,
} from '@/lib/runtime-agent/contracts';
import type { AuthenticatedUser } from '@/lib/auth/middleware';
import type { RuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { writeAcpxDebugTrace } from '@/lib/runtime-agent/acpx-debug-trace';
import { REDACTED_VALUE, redactText } from '@/lib/runtime-agent/security/redaction';

export const runtimeSessionKinds = new Set<RuntimeSessionKind>([
  'chat',
  'agent',
  'workflow-agent',
  'workflow-supervisor',
  'agora',
  'probe',
  'diagnostic',
]);

export const runtimeInterruptPolicies = new Set<RuntimeInterruptPolicy>([
  'queue',
  'cancel-and-send',
  'reject',
]);

export const runtimeStreamModes = new Set(['sse', 'ndjson', 'none']);
export const defaultRuntimeStreamHeartbeatMs = 15_000;
let runtimeStreamHeartbeatMs = defaultRuntimeStreamHeartbeatMs;

export function setRuntimeStreamHeartbeatMsForTesting(value: number): void {
  runtimeStreamHeartbeatMs = value;
}

export function resetRuntimeStreamHeartbeatMsForTesting(): void {
  runtimeStreamHeartbeatMs = defaultRuntimeStreamHeartbeatMs;
}

export const terminalRuntimeEventTypes = new Set<RuntimeEventType>([
  'turn.cancelled',
  'turn.completed',
  'turn.failed',
]);

const blockedPayloadKeys = new Set([
  'acpxRecordId',
  'acpxSessionId',
  'auth',
  'authorization',
  'backendSessionId',
  'binding',
  'bindings',
  'externalIds',
  'externalRecordId',
  'externalSessionId',
  'nativeId',
  'providerNativeId',
  'providerSessionId',
  'raw',
  'runtimeBinding',
  'runtimeBindings',
  'runtime_bindings',
  'secret',
  'secretValue',
  'token',
  'value',
]);

const sensitivePayloadKeyPattern = /(?:api[_-]?key|auth|authorization|bearer|credential|lease[_-]?token|password|passwd|private[_-]?key|secret|session[_-]?id|token)/i;
const rawToolIoKeyPattern = /^(?:stderr|stdin|stdout|toolInput|toolOutput|tool_input|tool_output|rawInput|rawOutput|raw_input|raw_output|diff|patch|command)$/i;
const privateKeyPattern = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const apiKeyPattern = /\b(?:sk|pk|rk|ace|ghp|github_pat|npm)_[A-Za-z0-9][A-Za-z0-9._-]{8,}\b/g;
const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/g;

export function runtimeError(
  code: RuntimeErrorCode,
  message: string,
  status: number,
  options: { retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
): Response {
  const dto: RuntimeErrorDto = {
    code,
    message,
    retryable: options.retryable ?? false,
    details: options.details,
    cause: normalizeCause(options.cause),
    redacted: true,
  };
  return Response.json({ error: dto }, { status });
}

export function runtimeErrorFromUnknown(error: unknown): Response {
  const anyError = error as { code?: RuntimeErrorCode; retryable?: boolean; message?: string };
  const code = anyError?.code ?? 'UNKNOWN';
  const status = code === 'NOT_FOUND'
    ? 404
    : code === 'FORBIDDEN'
      ? 403
      : code === 'CONFLICT'
        ? 409
        : code === 'VALIDATION_FAILED'
          ? 422
          : code === 'LIMIT_EXCEEDED'
            ? 422
            : code === 'ADAPTER_UNAVAILABLE'
              ? 503
              : 500;
  return runtimeError(code, anyError?.message || 'Runtime API request failed', status, {
    retryable: anyError?.retryable ?? status >= 500,
    cause: error,
  });
}

export async function authorizeRuntimeSessionAccess(
  service: RuntimeSessionsApiService,
  runtimeSessionId: string,
  auth: AuthenticatedUser,
): Promise<Response | null> {
  const access = await service.getSessionAccess(runtimeSessionId);
  if (!access) return runtimeError('NOT_FOUND', 'Runtime session not found', 404);
  if (auth.role === 'admin' || access.ownerUserId === auth.id) return null;
  return runtimeError('FORBIDDEN', 'Runtime session access denied', 403);
}

export function parseRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function parseRuntimeLimit(value: string | null): number | Response {
  const limit = value == null || value === '' ? 200 : Number(value);
  if (!Number.isInteger(limit) || limit < 1) {
    return runtimeError('VALIDATION_FAILED', 'limit must be a positive integer', 422);
  }
  if (limit > 1000) {
    return runtimeError('LIMIT_EXCEEDED', 'limit must be <= 1000', 422, { retryable: false });
  }
  return limit;
}

export function parseRuntimeCursor(input: string | null, runtimeSessionId: string): number | Response | null {
  if (!input) return null;
  try {
    const parsed = JSON.parse(Buffer.from(input, 'base64url').toString('utf8')) as {
      sessionId?: unknown;
      seq?: unknown;
    };
    if (parsed.sessionId !== runtimeSessionId) {
      return runtimeError('VALIDATION_FAILED', 'cursor does not belong to this runtime session', 422);
    }
    const seq = Number(parsed.seq);
    if (!Number.isInteger(seq) || seq < 0) {
      return runtimeError('VALIDATION_FAILED', 'cursor seq is invalid', 422);
    }
    return seq;
  } catch (error) {
    return runtimeError('VALIDATION_FAILED', 'cursor is invalid', 422, { cause: error });
  }
}

export function encodeRuntimeCursor(runtimeSessionId: string, seq: number): string {
  return Buffer.from(JSON.stringify({ sessionId: runtimeSessionId, seq }), 'utf8').toString('base64url');
}

export function runtimeEventToRow(event: RuntimeEvent) {
  const runtimeSessionId = event.sessionId;
  return {
    id: `${runtimeSessionId}:${event.seq}`,
    runtimeSessionId,
    turnId: event.turnId,
    traceId: event.traceId,
    seq: event.seq,
    type: event.type,
    correlationId: event.correlationId,
    parentEventId: event.parentEventId,
    messageId: event.messageId,
    toolCallId: event.toolCallId,
    payload: sanitizeRuntimePayload(event.payload),
    redacted: event.redacted,
    createdAt: event.createdAt,
  };
}

export function runtimeEventsResponse(runtimeSessionId: string, events: RuntimeEvent[], fallbackSeq: number) {
  const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : fallbackSeq;
  return {
    events: events.map(runtimeEventToRow),
    nextSeq: lastSeq,
    cursor: encodeRuntimeCursor(runtimeSessionId, lastSeq),
  };
}

export function eventStreamResponse(
  events: AsyncIterable<RuntimeEvent>,
  mode: 'sse' | 'ndjson',
  options: { turn?: RuntimeTurnRef; heartbeatMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const iterator = events[Symbol.asyncIterator]();
      let pending = iterator.next();
      let lastEvent: RuntimeEvent | null = null;
      let terminalSeen = false;
      try {
        while (true) {
          const result = await Promise.race([
            pending.then((value) => ({ kind: 'event' as const, value })),
            wait(options.heartbeatMs ?? runtimeStreamHeartbeatMs).then(() => ({ kind: 'heartbeat' as const })),
          ]);

          if (result.kind === 'heartbeat') {
            controller.enqueue(encoder.encode(formatRuntimeStreamHeartbeat(mode)));
            continue;
          }

          const next = result.value;
          if (next.done) break;
          const event = next.value;
          lastEvent = event;
          const row = runtimeEventToRow(event);
          const formatted = formatRuntimeStreamEvent(row, mode);
          writeAcpxDebugTrace({
            stage: 'runtime.formatted_chunk',
            context: {
              runtimeSessionId: event.sessionId,
              turnId: event.turnId,
              traceId: event.traceId,
            },
            payload: {
              mode,
              chunk: formatted,
              row,
            },
          });
          controller.enqueue(encoder.encode(formatted));
          if (terminalRuntimeEventTypes.has(event.type)) {
            terminalSeen = true;
            break;
          }
          pending = iterator.next();
        }
        controller.close();
      } catch (error) {
        const errorEvent = runtimeStreamErrorEvent(error, lastEvent, options.turn);
        controller.enqueue(encoder.encode(formatRuntimeStreamEvent(runtimeEventToRow(errorEvent), mode)));
        controller.close();
      } finally {
        if (!terminalSeen && typeof iterator.return === 'function') {
          await iterator.return();
        }
      }
    },
  }), {
    headers: {
      'cache-control': 'no-cache, no-transform',
      'content-type': mode === 'sse' ? 'text/event-stream; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'x-accel-buffering': 'no',
    },
  });
}

function formatRuntimeStreamEvent(row: ReturnType<typeof runtimeEventToRow>, mode: 'sse' | 'ndjson'): string {
  if (mode === 'sse') {
    return `id: ${row.seq}\nevent: ${row.type}\ndata: ${JSON.stringify(row)}\n\n`;
  }
  return `${JSON.stringify(row)}\n`;
}

function formatRuntimeStreamHeartbeat(mode: 'sse' | 'ndjson'): string {
  const payload = JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() });
  return mode === 'sse' ? `: ${payload}\n\n` : `${payload}\n`;
}

function runtimeStreamErrorEvent(
  error: unknown,
  lastEvent: RuntimeEvent | null,
  turn?: RuntimeTurnRef,
): RuntimeEvent<{ error: RuntimeErrorDto; status: number }> {
  const anyError = error as { code?: RuntimeErrorCode; retryable?: boolean; message?: string };
  const errorDto: RuntimeErrorDto = {
    code: anyError?.code ?? 'UNKNOWN',
    message: sanitizeRuntimeText(anyError?.message || 'Runtime stream failed'),
    retryable: anyError?.retryable ?? true,
    cause: normalizeCause(error),
    redacted: true,
  };
  return {
    id: `${turn?.turnId ?? lastEvent?.turnId ?? 'runtime-stream'}:error`,
    sessionId: turn?.runtimeSessionId ?? lastEvent?.sessionId ?? 'unknown',
    turnId: turn?.turnId ?? lastEvent?.turnId,
    traceId: turn?.traceId ?? lastEvent?.traceId ?? 'unknown',
    seq: (lastEvent?.seq ?? 0) + 1,
    type: 'turn.failed',
    payload: {
      error: errorDto,
      status: runtimeStatusFromErrorCode(errorDto.code),
    },
    redacted: true,
    createdAt: new Date().toISOString(),
  };
}

function runtimeStatusFromErrorCode(code: RuntimeErrorCode): number {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'CONFLICT') return 409;
  if (code === 'VALIDATION_FAILED' || code === 'LIMIT_EXCEEDED') return 422;
  if (code === 'ADAPTER_UNAVAILABLE') return 503;
  return 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sanitizeRuntimePayload(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === 'string') return sanitizeRuntimeText(input);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (Array.isArray(input)) return input.map((item) => sanitizeRuntimePayload(item));
  if (typeof input !== 'object') return String(input);

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (blockedPayloadKeys.has(key)) continue;
    if (sensitivePayloadKeyPattern.test(key)) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    if (rawToolIoKeyPattern.test(key) && value !== null && value !== undefined) {
      output[key] = REDACTED_VALUE;
      continue;
    }
    output[key] = sanitizeRuntimePayload(value);
  }
  return output;
}

export function sanitizeRuntimeText(input: string): string {
  return redactText(input).value
    .replace(privateKeyPattern, REDACTED_VALUE)
    .replace(apiKeyPattern, REDACTED_VALUE)
    .replace(bearerTokenPattern, `Bearer ${REDACTED_VALUE}`);
}

function normalizeCause(cause: unknown): RuntimeErrorDto['cause'] | undefined {
  if (!cause) return undefined;
  if (cause instanceof Error) return { message: sanitizeRuntimeText(cause.message) };
  if (typeof cause === 'object') {
    const record = cause as Record<string, unknown>;
    const message = typeof record.message === 'string' ? sanitizeRuntimeText(record.message) : undefined;
    const code = typeof record.code === 'string' ? record.code : undefined;
    if (message) return { code, message };
  }
  return { message: sanitizeRuntimeText(String(cause)) };
}
