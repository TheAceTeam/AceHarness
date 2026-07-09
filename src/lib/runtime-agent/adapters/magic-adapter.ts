import type {
  AdapterCancelInput,
  AdapterCapabilitiesInput,
  AdapterRuntimeEvent,
  AdapterSessionInput,
  AdapterTurnInput,
  RuntimeAdapter,
  RuntimeBinding,
  RuntimeCapabilities,
  RuntimeEventType,
} from '../contracts';
import { missingCostUsage, missingTokenUsage, stripNativeIds } from './acpx-adapter';

export interface MagicRuntimeClient {
  createOrLoadSession?(input: AdapterSessionInput): Promise<Partial<Pick<RuntimeBinding, 'externalIds' | 'raw'>> | undefined>;
  runTurn?(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<unknown>;
  cancel?(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void>;
  close?(binding: RuntimeBinding): Promise<void>;
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
    await this.client?.cancel?.(binding, input);
  }

  async close(binding: RuntimeBinding): Promise<void> {
    await this.client?.close?.(binding);
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

  async getStatus() {
    return {
      runtime: 'magic' as const,
      status: this.client ? ('unknown' as const) : ('failed' as const),
      error: this.client
        ? undefined
        : {
            code: 'ADAPTER_UNAVAILABLE' as const,
            message: 'magic runtime client is not configured.',
            retryable: true,
            redacted: true,
          },
    };
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
    redacted: true,
    raw: nativeEvent,
    createdAt: asString(event.createdAt),
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
