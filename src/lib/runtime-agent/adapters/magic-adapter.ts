import type {
  AdapterCancelInput,
  AdapterCapabilitiesInput,
  AdapterRuntimeEvent,
  AdapterSessionInput,
  AdapterTurnInput,
  RuntimeAdapter,
  RuntimeBinding,
  RuntimeCapabilities,
  AdapterRuntimeStatus,
  RuntimeEventType,
} from '../contracts';
import { createAdapterUnavailableError, missingCostUsage, missingTokenUsage, stripNativeIds } from './acpx-adapter';

export interface MagicRuntimeClient {
  createOrLoadSession?(input: AdapterSessionInput): Promise<Partial<Pick<RuntimeBinding, 'externalIds' | 'raw'>> | undefined>;
  runTurn?(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<unknown>;
  cancel?(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void>;
  close?(binding: RuntimeBinding): Promise<void>;
  getStatus?(binding: RuntimeBinding): Promise<unknown>;
}

const MAGIC_EVENT_TYPES: Record<string, RuntimeEventType> = {
  assistant_delta: 'message.delta',
  assistant_message: 'message.completed',
  command_started: 'tool.started',
  command_output: 'tool.output',
  command_finished: 'tool.completed',
  command_failed: 'tool.failed',
  permission: 'permission.requested',
  status: 'status.changed',
  done: 'turn.completed',
  error: 'turn.failed',
  turn_started: 'turn.started',
  turn_completed: 'turn.completed',
  turn_failed: 'turn.failed',
  turn_cancelled: 'turn.cancelled',
  turn_canceled: 'turn.cancelled',
};

export class MagicAdapter implements RuntimeAdapter {
  readonly runtime = 'magic' as const;

  constructor(private readonly client?: MagicRuntimeClient) {}

  async createOrLoadSession(input: AdapterSessionInput): Promise<RuntimeBinding> {
    const now = new Date().toISOString();
    const nativeBinding = await this.client?.createOrLoadSession?.(input);

    return {
      id: input.existingBinding?.id ?? `${input.runtimeSessionId}:magic:1`,
      runtimeSessionId: input.runtimeSessionId,
      runtime: 'magic',
      role: input.existingBinding?.role ?? 'primary',
      generation: input.existingBinding?.generation ?? 1,
      externalIds: nativeBinding?.externalIds ?? input.existingBinding?.externalIds ?? {},
      raw: nativeBinding?.raw ?? input.existingBinding?.raw ?? { agentId: input.agentId, runtime: 'cangjie-magic' },
      createdAt: input.existingBinding?.createdAt ?? now,
      updatedAt: now,
    };
  }

  async *runTurn(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AdapterRuntimeEvent> {
    yield {
      type: 'turn.started',
      payload: { turnId: input.turnId },
      usage: missingTokenUsage(),
      cost: missingCostUsage(),
      redacted: true,
    };

    if (!this.client?.runTurn) {
      yield {
        type: 'turn.failed',
        payload: {
          turnId: input.turnId,
          runtime: 'magic',
          reason: 'runtime-client-missing',
        },
        usage: missingTokenUsage(),
        cost: missingCostUsage(),
        error: {
          code: 'ADAPTER_UNAVAILABLE',
          message: 'magic runtime client is not configured.',
          retryable: true,
          redacted: true,
        },
        redacted: true,
      };
      return;
    }

    for await (const event of this.client.runTurn(binding, input)) {
      yield normalizeMagicRuntimeEvent(event);
    }
  }

  async cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void> {
    if (!this.client?.cancel) {
      throw createAdapterUnavailableError('magic', 'cancel');
    }
    await this.client.cancel(binding, input);
  }

  async close(binding: RuntimeBinding): Promise<void> {
    if (!this.client?.close) {
      throw createAdapterUnavailableError('magic', 'close');
    }
    await this.client.close(binding);
  }

  async getCapabilities(input: AdapterCapabilitiesInput): Promise<RuntimeCapabilities> {
    return {
      streaming: true,
      cancel: true,
      commands: false,
      compact: false,
      fork: false,
      handoff: false,
      permissions: true,
      toolCalls: true,
      usage: 'missing',
      models: input.modelRoute ? [input.modelRoute.providerModel] : undefined,
      metadata: {
        adapter: 'magic',
        nativeRuntime: 'cangjie-magic',
      },
    };
  }

  async getStatus(binding: RuntimeBinding): Promise<AdapterRuntimeStatus> {
    if (!this.client?.getStatus) {
      return {
        runtime: 'magic' as const,
        status: this.client ? ('unknown' as const) : ('failed' as const),
        error: createAdapterUnavailableError('magic', 'status'),
      };
    }

    return normalizeMagicStatus(await this.client.getStatus(binding));
  }
}

export function normalizeMagicRuntimeEvent(nativeEvent: unknown): AdapterRuntimeEvent {
  const event = asRecord(nativeEvent);
  const rawType = asString(event.type ?? event.event);
  const type = rawType ? MAGIC_EVENT_TYPES[rawType] ?? normalizeCanonicalType(rawType) : 'diagnostic';

  return {
    type,
    payload: stripNativeIds(event.payload ?? event.data ?? fallbackPayload(type, event)),
    correlationId: asString(event.correlationId),
    parentEventId: asString(event.parentEventId),
    messageId: asString(event.messageId),
    toolCallId: asString(event.toolCallId),
    usage: missingTokenUsage(),
    cost: missingCostUsage(),
    error: normalizeMagicError(event.error ?? (type === 'turn.failed' ? event : undefined)),
    redacted: true,
    raw: nativeEvent,
    createdAt: asString(event.createdAt),
  };
}

function normalizeMagicStatus(value: unknown): AdapterRuntimeStatus {
  const status = asRecord(value);
  const rawStatus = asString(status.status);
  const normalizedStatus: AdapterRuntimeStatus['status'] =
    rawStatus === 'idle' ||
    rawStatus === 'running' ||
    rawStatus === 'canceling' ||
    rawStatus === 'closed' ||
    rawStatus === 'failed'
      ? rawStatus
      : 'unknown';

  return {
    runtime: 'magic',
    status: normalizedStatus,
    activeTurnId: asString(status.activeTurnId),
    lastEventAt: asString(status.lastEventAt),
    error: normalizeMagicError(status.error),
    metadata: isRecord(status.metadata) ? stripNativeIds(status.metadata) as Record<string, unknown> : undefined,
  };
}

function normalizeMagicError(value: unknown): AdapterRuntimeEvent['error'] {
  const error = asRecord(value);
  if (!Object.keys(error).length) {
    return undefined;
  }

  return {
    code: 'ADAPTER_FAILED',
    message: asString(error.message) ?? 'Magic runtime reported an error.',
    retryable: Boolean(error.retryable),
    redacted: true,
    cause: asString(error.code)
      ? {
          code: asString(error.code),
          message: asString(error.message) ?? 'Magic runtime error',
        }
      : undefined,
  };
}

function normalizeCanonicalType(type: string): RuntimeEventType {
  return type.includes('.') ? (type as RuntimeEventType) : 'diagnostic';
}

function fallbackPayload(type: RuntimeEventType, event: Record<string, unknown>): unknown {
  if (type === 'message.delta' && typeof event.text === 'string') {
    return { text: event.text };
  }
  if (typeof event.message === 'string') {
    return { message: event.message };
  }
  return {};
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
