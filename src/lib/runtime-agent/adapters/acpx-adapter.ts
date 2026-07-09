import { getBuiltinAgentDefinition } from '../agent-registry';
import type {
  AcpRuntime,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeStatus,
} from 'acpx/runtime';
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
  RuntimeTraceSource,
  TokenUsage,
  CostUsage,
} from '../contracts';

const RUNTIME_EVENT_TYPES = new Set<RuntimeEventType>([
  'turn.started',
  'turn.queued',
  'turn.canceling',
  'turn.cancelled',
  'turn.completed',
  'turn.failed',
  'message.delta',
  'message.completed',
  'thought.delta',
  'tool.started',
  'tool.updated',
  'tool.output',
  'tool.completed',
  'tool.failed',
  'usage.updated',
  'permission.requested',
  'permission.resolved',
  'command.available',
  'command.invoked',
  'status.changed',
  'diagnostic',
]);

const EVENT_TYPE_ALIASES: Record<string, RuntimeEventType> = {
  message_delta: 'message.delta',
  message_completed: 'message.completed',
  thought_delta: 'thought.delta',
  tool_started: 'tool.started',
  tool_updated: 'tool.updated',
  tool_output: 'tool.output',
  tool_completed: 'tool.completed',
  tool_failed: 'tool.failed',
  usage: 'usage.updated',
  usage_updated: 'usage.updated',
  permission_requested: 'permission.requested',
  permission_resolved: 'permission.resolved',
  command_available: 'command.available',
  command_invoked: 'command.invoked',
  status_changed: 'status.changed',
  turn_started: 'turn.started',
  turn_completed: 'turn.completed',
  turn_failed: 'turn.failed',
};

const NATIVE_ID_KEYS = new Set([
  'acpxRecordId',
  'acpxSessionId',
  'backendSessionId',
  'externalRecordId',
  'externalSessionId',
  'nativeId',
  'providerConversationId',
  'providerMessageId',
  'providerSessionId',
  'recordId',
]);

export interface AcpxCommandResolution {
  command: string;
  args: string[];
  fallbackCommands: string[];
}

export type AcpxRuntimeSessionBinding = Partial<Pick<RuntimeBinding, 'externalIds' | 'raw'>> & {
  handle?: AcpRuntimeHandle;
};

export interface AcpxRuntimeClient {
  /**
   * Project-local injection seam for acpx/runtime's ensureSession(...).
   * The adapter still owns ACEHarness RuntimeBinding creation; an injected
   * client may return the native AcpRuntimeHandle in raw or handle for later
   * turn/cancel/status calls.
   */
  createOrLoadSession?(input: {
    session: AdapterSessionInput;
    command: AcpxCommandResolution;
  }): Promise<AcpxRuntimeSessionBinding | undefined>;
  /**
   * Mirrors AcpRuntime.runTurn(AcpRuntimeTurnInput) without instantiating the
   * real acpx runtime in this adapter yet. Implementations should translate
   * ACEHarness binding/turn input to AcpRuntimeTurnInput internally.
   */
  runTurn?(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AcpRuntimeEvent | unknown>;
  startTurn?: AcpRuntime['startTurn'];
  ensureSession?: AcpRuntime['ensureSession'];
  cancel?(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void>;
  close?(binding: RuntimeBinding): Promise<void>;
  getStatus?(binding: RuntimeBinding): Promise<AcpRuntimeStatus | unknown>;
}

export interface AcpxNativeEvent {
  type?: string;
  event?: string;
  payload?: unknown;
  data?: unknown;
  text?: string;
  message?: string;
  usage?: unknown;
  cost?: unknown;
  error?: unknown;
  correlationId?: string;
  parentEventId?: string;
  messageId?: string;
  toolCallId?: string;
  createdAt?: string;
}

export function resolveAcpxCommand(agentId: string): AcpxCommandResolution {
  const definition = getBuiltinAgentDefinition(agentId);

  if (definition?.runtime === 'acpx') {
    return {
      command: definition.command ?? agentId,
      args: definition.args ?? ['acp'],
      fallbackCommands: definition.fallbackCommands ?? [],
    };
  }

  return {
    command: agentId,
    args: ['acp'],
    fallbackCommands: [],
  };
}

export function missingTokenUsage(): TokenUsage {
  return {
    missing: true,
    sourceStatus: 'missing',
  };
}

export function missingCostUsage(): CostUsage {
  return {
    estimated: false,
    missing: true,
    sourceStatus: 'missing',
  };
}

export function normalizeAcpxRuntimeEvent(nativeEvent: unknown): AdapterRuntimeEvent {
  const event = asRecord(nativeEvent);
  const type = normalizeEventType(event.type ?? event.event);
  const payloadSource = event.payload ?? event.data ?? fallbackPayload(type, event);
  const usage = normalizeTokenUsage(event.usage);
  const cost = normalizeCostUsage(event.cost);

  return {
    type,
    payload: stripNativeIds(payloadSource),
    correlationId: asString(event.correlationId),
    parentEventId: asString(event.parentEventId),
    messageId: asString(event.messageId),
    toolCallId: asString(event.toolCallId),
    usage,
    cost,
    error: normalizeError(event.error),
    redacted: true,
    raw: nativeEvent,
    createdAt: asString(event.createdAt),
  };
}

export function stripNativeIds(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNativeIds);
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, childValue] of Object.entries(value)) {
    if (NATIVE_ID_KEYS.has(key)) {
      continue;
    }
    sanitized[key] = stripNativeIds(childValue);
  }
  return sanitized;
}

export class AcpxAdapter implements RuntimeAdapter {
  readonly runtime = 'acpx' as const;

  constructor(private readonly client?: AcpxRuntimeClient) {}

  async createOrLoadSession(input: AdapterSessionInput): Promise<RuntimeBinding> {
    const now = new Date().toISOString();
    const command = resolveAcpxCommand(input.agentId);
    const nativeBinding = await this.client?.createOrLoadSession?.({
      session: input,
      command,
    });

    return {
      id: input.existingBinding?.id ?? `${input.runtimeSessionId}:acpx:${input.agentId}:1`,
      runtimeSessionId: input.runtimeSessionId,
      runtime: 'acpx',
      role: input.existingBinding?.role ?? 'primary',
      generation: input.existingBinding?.generation ?? 1,
      externalIds: nativeBinding?.externalIds ?? input.existingBinding?.externalIds ?? {},
      raw: nativeBinding?.raw ?? input.existingBinding?.raw ?? { agentId: input.agentId, command },
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
      yield createAdapterUnavailableEvent('acpx', input.turnId);
      return;
    }

    for await (const event of this.client.runTurn(binding, input)) {
      yield normalizeAcpxRuntimeEvent(event);
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
      commands: true,
      compact: false,
      fork: false,
      handoff: false,
      permissions: true,
      toolCalls: true,
      usage: 'missing',
      models: input.modelRoute ? [input.modelRoute.providerModel] : undefined,
      metadata: {
        adapter: 'acpx',
        command: resolveAcpxCommand(input.agentId),
      },
    };
  }

  async getStatus() {
    return {
      runtime: 'acpx' as const,
      status: this.client ? ('unknown' as const) : ('failed' as const),
      error: this.client
        ? undefined
        : {
            code: 'ADAPTER_UNAVAILABLE' as const,
            message: 'acpx runtime package is not installed; adapter skeleton is not executable yet.',
            retryable: true,
            redacted: true,
          },
    };
  }
}

function createAdapterUnavailableEvent(runtime: 'acpx' | 'magic', turnId: string): AdapterRuntimeEvent {
  return {
    type: 'turn.failed',
    payload: {
      turnId,
      runtime,
      reason: 'runtime-client-missing',
    },
    usage: missingTokenUsage(),
    cost: missingCostUsage(),
    error: {
      code: 'ADAPTER_UNAVAILABLE',
      message: `${runtime} runtime client is not configured.`,
      retryable: true,
      redacted: true,
    },
    redacted: true,
  };
}

function normalizeEventType(value: unknown): RuntimeEventType {
  const rawType = asString(value);
  if (rawType && RUNTIME_EVENT_TYPES.has(rawType as RuntimeEventType)) {
    return rawType as RuntimeEventType;
  }
  return rawType ? EVENT_TYPE_ALIASES[rawType] ?? 'diagnostic' : 'diagnostic';
}

function fallbackPayload(type: RuntimeEventType, event: Record<string, unknown>): unknown {
  if (type === 'message.delta' && typeof event.text === 'string') {
    return { text: event.text };
  }
  if (type === 'diagnostic' && typeof event.message === 'string') {
    return { message: event.message, source: 'adapter' satisfies RuntimeTraceSource };
  }
  return {};
}

function normalizeTokenUsage(value: unknown): TokenUsage {
  if (!isPlainRecord(value)) {
    return missingTokenUsage();
  }

  return {
    inputTokens: asNumber(value.inputTokens ?? value.input_tokens),
    outputTokens: asNumber(value.outputTokens ?? value.output_tokens),
    cacheCreationInputTokens: asNumber(value.cacheCreationInputTokens ?? value.cache_creation_input_tokens),
    cacheReadInputTokens: asNumber(value.cacheReadInputTokens ?? value.cache_read_input_tokens),
    thoughtTokens: asNumber(value.thoughtTokens ?? value.thought_tokens),
    totalTokens: asNumber(value.totalTokens ?? value.total_tokens),
    missing: false,
    sourceStatus: 'reported',
  };
}

function normalizeCostUsage(value: unknown): CostUsage {
  if (!isPlainRecord(value)) {
    return missingCostUsage();
  }

  return {
    amount: asNumber(value.amount),
    currency: asString(value.currency),
    costUsd: asNumber(value.costUsd ?? value.cost_usd),
    estimated: Boolean(value.estimated),
    missing: false,
    sourceStatus: value.estimated ? 'estimated' : 'reported',
  };
}

function normalizeError(value: unknown): AdapterRuntimeEvent['error'] {
  if (!isPlainRecord(value)) {
    return undefined;
  }

  return {
    code: 'ADAPTER_FAILED',
    message: asString(value.message) ?? 'Adapter event reported an error.',
    retryable: Boolean(value.retryable),
    redacted: true,
    cause: asString(value.code)
      ? {
          code: asString(value.code),
          message: asString(value.message) ?? 'Native adapter error',
        }
      : undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainRecord(value) ? value : {};
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
