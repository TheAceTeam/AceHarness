import { getBuiltinAgentDefinition } from '../agent-registry';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths, getConfiguredEnvValueSync } from '@/lib/core/configured-env';
import { existsSync } from 'fs';
import { join } from 'path';
import { isWindows } from '@/lib/core/runtime-platform';
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
  AdapterRuntimeStatus,
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
import { writeAcpxDebugTrace } from '../acpx-debug-trace';

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
  agent_message_chunk: 'message.delta',
  agent_thought_chunk: 'thought.delta',
  message_delta: 'message.delta',
  message_completed: 'message.completed',
  thought_delta: 'thought.delta',
  status: 'status.changed',
  tool_call: 'tool.updated',
  tool_call_update: 'tool.updated',
  tool_started: 'tool.started',
  tool_updated: 'tool.updated',
  tool_output: 'tool.output',
  tool_completed: 'tool.completed',
  tool_failed: 'tool.failed',
  usage: 'usage.updated',
  usage_update: 'usage.updated',
  usage_updated: 'usage.updated',
  permission_requested: 'permission.requested',
  permission_resolved: 'permission.resolved',
  command_available: 'command.available',
  command_invoked: 'command.invoked',
  status_changed: 'status.changed',
  done: 'turn.completed',
  error: 'turn.failed',
  turn_started: 'turn.started',
  turn_completed: 'turn.completed',
  turn_failed: 'turn.failed',
  turn_cancelled: 'turn.cancelled',
  turn_canceled: 'turn.cancelled',
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

export interface AcpxRuntimeCommandAttempt {
  command: string;
  source: string;
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
  ensureSession?(input: {
    session: AdapterSessionInput;
    command: AcpxCommandResolution;
    existingHandle?: AcpRuntimeHandle;
  }): Promise<AcpRuntimeHandle | undefined>;
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

export function formatAcpxCommandForRuntime(command: AcpxCommandResolution, options: { cwd?: string; agentId?: string } = {}): string {
  return resolveAcpxRuntimeAgent(command, options);
}

export function resolveAcpxRuntimeAgent(command: AcpxCommandResolution, options: { cwd?: string; agentId?: string } = {}): string {
  if (shouldUseAcpxRegistryAgent(command, options.agentId)) {
    return options.agentId || command.command;
  }
  return getAcpxCommandAttemptsForRuntime(command, options)[0]?.command || '';
}

export function getAcpxAgentRegistryOverrides(): Record<string, string> {
  return {
    nga: 'ngagent --disable-update acp',
    codeagent: 'ngagent acp',
    codegenie: 'codegenie acp',
  };
}

const OPENCODE_SAFE_CHECK_SKIP_AGENT_IDS = new Set([
  'opencode',
  'nga',
  'codegenie',
]);

export function applyAcpxAgentSessionEnv(
  agentId: string | undefined,
  env?: Record<string, string>,
): Record<string, string> | undefined {
  const next = { ...(env || {}) };
  const normalizedAgentId = String(agentId || '').trim().toLowerCase();
  if (OPENCODE_SAFE_CHECK_SKIP_AGENT_IDS.has(normalizedAgentId)) {
    next.OPENCODE_SKIP_SAFE_CHECK = '1';
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function getAcpxCommandAttemptsForRuntime(
  command: AcpxCommandResolution,
  options: { cwd?: string; agentId?: string } = {},
): AcpxRuntimeCommandAttempt[] {
  const attempts = buildAcpxCommandAttemptParts(command, options).map((attempt) => ({
    source: attempt.source,
    command: formatCommandParts(attempt.parts),
  })).filter((attempt) => attempt.command);

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    if (seen.has(attempt.command)) return false;
    seen.add(attempt.command);
    return true;
  });
}

function buildAcpxCommandAttemptParts(
  command: AcpxCommandResolution,
  options: { cwd?: string; agentId?: string },
): Array<{ source: string; parts: string[] }> {
  if (options.agentId === 'codeagent') {
    const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
    const ngagent = resolveWindowsCmdShim('ngagent', searchPaths) || (!isWindows() ? findCommand('ngagent', searchPaths) : null);
    const args = ['acp'];
    if (options.cwd) args.push('--cwd', options.cwd);
    return [{ source: 'codeagent', parts: wrapWindowsCmdShellParts(ngagent || 'ngagent', args) }];
  }
  if (options.agentId === 'nga' || (!options.agentId && (command.command === 'ngagent' || command.command === 'nga'))) {
    const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
    const ngagent = resolveWindowsCmdShim('ngagent', searchPaths) || (!isWindows() ? findCommand('ngagent', searchPaths) : null);
    const args = ['--disable-update', 'acp'];
    if (options.cwd) args.push('--cwd', options.cwd);
    return [{ source: 'ngagent', parts: wrapWindowsCmdShellParts(ngagent || 'ngagent', args) }];
  }
  if (options.agentId === 'codegenie' || command.command === 'codegenie') {
    const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
    const explicit = getConfiguredEnvValueSync('ACEH_CODEGENIE_COMMAND')?.trim();
    const resolvedCommand = explicit
      || resolveWindowsCmdShim('codegenie', searchPaths)
      || (!isWindows() ? findCommand('codegenie', searchPaths) : null)
      || command.command;
    const args = ['acp'];
    if (options.cwd) args.push('--cwd', options.cwd);
    return [{ source: 'codegenie', parts: wrapWindowsCmdShellParts(resolvedCommand, args) }];
  }
  return [{ source: options.agentId || command.command, parts: [command.command, ...(command.args || [])] }];
}

function shouldUseAcpxRegistryAgent(command: AcpxCommandResolution, agentId?: string): boolean {
  const id = String(agentId || '').trim();
  if (!id) return false;
  const definition = getBuiltinAgentDefinition(id);
  if (!definition || definition.runtime !== 'acpx') return false;
  return true;
}

function resolveWindowsCmdShim(command: string, searchPaths: string[]): string | null {
  if (!isWindows()) return null;
  for (const dir of searchPaths) {
    if (!dir) continue;
    const candidate = join(dir, `${command}.cmd`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function wrapWindowsCmdShellParts(command: string, args: string[]): string[] {
  if (!isWindows()) return [command, ...args];
  const line = [command, ...args].map(quoteWindowsCmdToken).join(' ');
  return ['cmd.exe', '/d', '/s', '/c', line];
}

function quoteWindowsCmdToken(token: string): string {
  if (token === '') return '""';
  if (!/[\s"]/u.test(token)) return token;
  return `"${token.replace(/"/g, '""')}"`;
}

function formatCommandParts(parts: string[]): string {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .map(quoteCommandPart)
    .join(' ');
}

function quoteCommandPart(part: string): string {
  if (!/[\s"'`]/.test(part)) return part;
  return `"${part.replace(/(["\\])/g, '\\$1')}"`;
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
  const type = normalizeEventType(event.type ?? event.event, event);
  const fallback = fallbackPayload(type, event);
  const explicitPayload = event.payload ?? event.data;
  const payloadSource = type.startsWith('tool.')
    ? mergeToolPayload(fallback, explicitPayload)
    : (explicitPayload ?? fallback);
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
    error: normalizeError(event.error ?? (type === 'turn.failed' ? event : undefined)),
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
    const nativeBinding =
      (await this.client?.createOrLoadSession?.({
        session: input,
        command,
      })) ?? (await this.ensureNativeSession(input, command));

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

    const nativeEvents = await this.startNativeTurn(binding, input);
    if (!nativeEvents) {
      yield createAdapterUnavailableEvent('acpx', input.turnId);
      return;
    }

    for await (const event of nativeEvents) {
      writeAcpxDebugTrace({
        stage: 'acpx.raw_event',
        context: {
          runtimeSessionId: binding.runtimeSessionId,
          turnId: input.turnId,
          requestId: input.requestId,
          traceId: input.traceId,
          runtime: binding.runtime,
        },
        payload: event,
      });
      const normalized = normalizeAcpxRuntimeEvent(event);
      writeAcpxDebugTrace({
        stage: 'adapter.normalized_event',
        context: {
          runtimeSessionId: binding.runtimeSessionId,
          turnId: input.turnId,
          requestId: input.requestId,
          traceId: input.traceId,
          runtime: binding.runtime,
        },
        payload: normalized,
      });
      yield normalized;
    }
  }

  async cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void> {
    if (!this.client?.cancel) {
      throw createAdapterUnavailableError('acpx', 'cancel');
    }
    await this.client.cancel(binding, input);
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

  async getStatus(binding: RuntimeBinding) {
    if (!this.client) {
      return {
        runtime: 'acpx' as const,
        status: 'failed' as const,
        error: createAdapterUnavailableError('acpx', 'status'),
      };
    }

    if (!this.client.getStatus) {
      return {
        runtime: 'acpx' as const,
        status: 'unknown' as const,
        metadata: {
          reason: 'status-method-missing',
        },
      };
    }

    const status = await this.client.getStatus(binding);
    return normalizeAcpxStatus(status);
  }

  private async ensureNativeSession(
    input: AdapterSessionInput,
    command: AcpxCommandResolution,
  ): Promise<AcpxRuntimeSessionBinding | undefined> {
    if (!this.client?.ensureSession) {
      return undefined;
    }

    const handle = await this.client.ensureSession({
      session: input,
      command,
      existingHandle: extractAcpRuntimeHandle(input.existingBinding),
    });

    return {
      handle,
      externalIds: extractExternalIds(handle),
      raw: {
        agentId: input.agentId,
        command,
        handle,
      },
    };
  }

  private async startNativeTurn(
    binding: RuntimeBinding,
    input: AdapterTurnInput,
  ): Promise<AsyncIterable<AcpRuntimeEvent | unknown> | undefined> {
    if (this.client?.runTurn) {
      return this.client.runTurn(binding, input);
    }

    return undefined;
  }
}

function mergeToolPayload(fallback: unknown, explicitPayload: unknown): unknown {
  if (!isPlainRecord(fallback)) {
    return explicitPayload ?? fallback;
  }
  if (!isPlainRecord(explicitPayload)) {
    return fallback;
  }
  return {
    ...fallback,
    ...explicitPayload,
  };
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
    error: createAdapterUnavailableError(runtime, 'turn'),
    redacted: true,
  };
}

export function createAdapterUnavailableError(runtime: 'acpx' | 'magic', operation: string) {
  return {
    code: 'ADAPTER_UNAVAILABLE' as const,
    message: `${runtime} runtime client cannot execute ${operation}.`,
    retryable: true,
    redacted: true,
  };
}

function normalizeAcpxStatus(value: unknown): AdapterRuntimeStatus {
  const status = asRecord(value);
  const nativeStatus = asString(status.status);
  const normalizedStatus: AdapterRuntimeStatus['status'] =
    nativeStatus === 'idle' ||
    nativeStatus === 'running' ||
    nativeStatus === 'canceling' ||
    nativeStatus === 'closed' ||
    nativeStatus === 'failed'
      ? nativeStatus
      : 'unknown';

  return {
    runtime: 'acpx' as const,
    status: normalizedStatus,
    activeTurnId: asString(status.activeTurnId),
    lastEventAt: asString(status.lastEventAt),
    error: normalizeError(status.error),
    metadata: isPlainRecord(status.metadata) ? status.metadata : undefined,
  };
}

function extractAcpRuntimeHandle(binding?: RuntimeBinding): AcpRuntimeHandle | undefined {
  if (!binding) {
    return undefined;
  }

  if (isPlainRecord(binding.raw) && isPlainRecord(binding.raw.handle)) {
    return binding.raw.handle as unknown as AcpRuntimeHandle;
  }

  return undefined;
}

function extractExternalIds(handle: unknown): RuntimeBinding['externalIds'] {
  if (!isPlainRecord(handle)) {
    return {};
  }

  return {
    externalRecordId: asString(handle.acpxRecordId ?? handle.recordId ?? handle.externalRecordId),
    externalSessionId: asString(handle.backendSessionId ?? handle.sessionId ?? handle.externalSessionId),
    providerSessionId: asString(handle.agentSessionId ?? handle.providerSessionId),
  };
}

function normalizeEventType(value: unknown, event?: Record<string, unknown>): RuntimeEventType {
  const rawType = asString(value);
  if (rawType === 'text_delta') {
    return event?.stream === 'thought' ? 'thought.delta' : 'message.delta';
  }
  if (rawType && RUNTIME_EVENT_TYPES.has(rawType as RuntimeEventType)) {
    return rawType as RuntimeEventType;
  }
  return rawType ? EVENT_TYPE_ALIASES[rawType] ?? 'diagnostic' : 'diagnostic';
}

function fallbackPayload(type: RuntimeEventType, event: Record<string, unknown>): unknown {
  if ((type === 'message.delta' || type === 'thought.delta') && typeof event.text === 'string') {
    return { text: event.text };
  }
  if (type === 'message.delta' || type === 'thought.delta') {
    const content = isPlainRecord(event.content) ? event.content : undefined;
    if ((content?.type === undefined || content.type === 'text') && typeof content?.text === 'string') {
      return { text: content.text };
    }
  }
  if (type === 'diagnostic' && typeof event.message === 'string') {
    return { message: event.message, source: 'adapter' satisfies RuntimeTraceSource };
  }
  if (type.startsWith('tool.')) {
    const payload = pickDefined(event, [
      'id',
      'name',
      'tool',
      'toolName',
      'tool_name',
      'text',
      'title',
      'status',
      'toolCallId',
      'kind',
      'command',
      'rawInput',
      'rawOutput',
      'content',
      'output',
      'stdout',
      'stderr',
      'exitCode',
      'exit_code',
      'aggregated_output',
    ]);
    return Object.keys(payload).length > 0 ? payload : {};
  }
  if (type === 'status.changed') {
    const payload = pickDefined(event, ['tag', 'used', 'size', 'cost', 'breakdown']);
    const usage = normalizeUsageBreakdown(event.breakdown);
    if (usage) {
      payload.usage = usage;
    }
    if (typeof event.text === 'string') {
      payload.message = event.text;
    }
    return Object.keys(payload).length > 0 ? payload : {};
  }
  if (type === 'turn.completed' && typeof event.stopReason === 'string') {
    return { stopReason: event.stopReason };
  }
  if (type === 'turn.failed' && typeof event.message === 'string') {
    return { message: event.message, source: 'adapter' satisfies RuntimeTraceSource };
  }
  return {};
}

function pickDefined(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) {
      picked[key] = record[key];
    }
  }
  return picked;
}

function normalizeTokenUsage(value: unknown): TokenUsage {
  if (!isPlainRecord(value)) {
    return missingTokenUsage();
  }

  return {
    inputTokens: asNumber(value.inputTokens ?? value.input_tokens),
    outputTokens: asNumber(value.outputTokens ?? value.output_tokens),
    cacheCreationInputTokens: asNumber(value.cacheCreationInputTokens ?? value.cache_creation_input_tokens ?? value.cachedWriteTokens),
    cacheReadInputTokens: asNumber(value.cacheReadInputTokens ?? value.cache_read_input_tokens ?? value.cachedReadTokens),
    thoughtTokens: asNumber(value.thoughtTokens ?? value.thought_tokens),
    totalTokens: asNumber(value.totalTokens ?? value.total_tokens),
    missing: false,
    sourceStatus: 'reported',
  };
}

function normalizeUsageBreakdown(value: unknown): TokenUsage | undefined {
  if (!isPlainRecord(value)) {
    return undefined;
  }
  const usage = normalizeTokenUsage(value);
  const hasAnyValue = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheCreationInputTokens,
    usage.cacheReadInputTokens,
    usage.thoughtTokens,
    usage.totalTokens,
  ].some((item) => item !== undefined);
  return hasAnyValue ? usage : undefined;
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
