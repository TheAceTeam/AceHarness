import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';
import {
  extractTextFromUnknown,
  getAceToolTitle,
  inferCommandToolName,
  resolveAceToolName,
  stringifyStructured,
} from '@/lib/chat/ace-process-formatters';
import { writeAcpxDebugTrace } from '@/lib/runtime-agent/acpx-debug-trace';
import type { RuntimeToolChange, RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';
import type {
  CostUsage,
  RuntimeEvent,
  RuntimeProfileSnapshot,
  TokenUsage,
} from '@/lib/runtime-agent/contracts';

export type ChatRuntimeEngineType = string;

export interface ChatRuntimeEngineOptions {
  agent: string;
  step: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  workingDirectory: string;
  allowedTools?: string[];
  timeoutMs?: number;
  sessionId?: string;
  forceNewSession?: boolean;
  appendSystemPrompt?: boolean;
  runId?: string;
  mcpServers?: any[];
  agents?: Record<string, any>;
  frontendSessionId?: string;
  userId?: string;
  env?: Record<string, string>;
  diagnosticLogging?: boolean;
  rawPrompt?: boolean;
}

/**
 * Optional provider capability. Engines must implement this explicitly before
 * a caller may advertise server-dispatched native tools to a model. Ordinary
 * Runtime/ACP tool events are observational and do not satisfy this contract.
 */
export interface ChatRuntimeNativeToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ChatRuntimeNativeToolCallbacks {
  nativeTools: readonly ChatRuntimeNativeToolDefinition[];
  dispatchNativeTool: (name: unknown, argumentsValue: unknown) => unknown | Promise<unknown>;
  beforeTaskStart?: () => void | Promise<void>;
}

export interface ChatRuntimeTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface ChatRuntimeResultMetadata {
  usage?: Partial<ChatRuntimeTokenUsage>;
  cost_usd?: number;
  costUsd?: number;
  duration_ms?: number;
  durationMs?: number;
  duration_api_ms?: number;
  durationApiMs?: number;
  num_turns?: number;
  numTurns?: number;
  contextRecovery?: ContextRecoveryMetadata;
  [key: string]: any;
}

export interface ChatRuntimeResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  stopReason?: string;
  metadata?: ChatRuntimeResultMetadata;
}

export type ChatRuntimeStreamEvent =
  | {
      type: 'text' | 'thought' | 'error' | 'log' | 'session';
      content: string;
      metadata?: any;
    }
  | {
      type: 'tool';
      tool: RuntimeToolEvent;
      metadata?: any;
    };

export type RuntimeToolState = {
  toolName: string;
  rawInput?: Record<string, unknown>;
  toolId: string;
};

export interface ChatRuntimeEngine {
  execute(options: ChatRuntimeEngineOptions): Promise<ChatRuntimeResult>;
  /**
   * Intentionally optional: RuntimeBackedChatEngine has no provider callback
   * channel today and therefore must use a structured text fallback.
   */
  executeWithNativeTools?(
    options: ChatRuntimeEngineOptions,
    callbacks: ChatRuntimeNativeToolCallbacks,
  ): Promise<ChatRuntimeResult>;
  compactContext?(options: {
    sessionId: string;
    prompt: string;
    systemPrompt: string;
    model: string;
    workingDirectory: string;
    error?: string;
  }): Promise<{ sessionId?: string; prompt?: string; summary?: string; method?: 'native' | 'manual' } | null>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): void;
  off(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): void;
}

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

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_COMPACT_SOURCE_LIMIT = 120_000;
const DEFAULT_CONTINUATION_PROMPT_LIMIT = 48_000;
const COMPACT_SUMMARY_SYSTEM_PROMPT = 'You are a helpful AI assistant tasked with summarizing conversations and agent work so another agent can continue without losing context.';
const COMPACT_SUMMARY_TASK = `Your task is to create a detailed summary of the conversation or agent work so far, paying close attention to the user's explicit requests and the assistant's previous actions.
This summary should be thorough in capturing technical details, code patterns, architectural decisions, tool calls, files, errors, fixes, and current state that would be essential for continuing work without losing context.

Output exactly:
<analysis>
[your analysis]
</analysis>

<summary>
[structured summary using the sections: Primary Request and Intent, Key Technical Concepts, Files and Code Sections, Errors and fixes, Problem Solving, All user messages, Pending Tasks, Current Work, Optional Next Step]
</summary>`;

const ENGINE_TO_AGENT: Record<string, string> = {
  'claude-code': 'claude',
  'claude-code-acp': 'claude',
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  'opencode-sdk': 'opencode',
  cursor: 'cursor',
  'kiro-cli': 'kiro',
  kiro: 'kiro',
  'trae-cli': 'trae',
  trae: 'trae',
  nga: 'nga',
  'nga-sdk': 'nga',
  codeagent: 'codeagent',
  codegenie: 'codegenie',
  'codegenie-sdk': 'codegenie',
  'magic-cli': 'cangjie-magic',
  'cangjie-magic': 'cangjie-magic',
  'deepseek-harness': 'deepseek-harness',
};

const pooledRuntimeEngines = new Map<string, RuntimeBackedChatEngine>();

export async function createChatRuntimeEngine(type?: ChatRuntimeEngineType): Promise<ChatRuntimeEngine | null> {
  const engineType = await resolveRequestedChatRuntimeEngineType(type);
  return new RuntimeBackedChatEngine(engineType, resolveRuntimeAgentId(engineType));
}

export async function getConfiguredChatRuntimeEngine(): Promise<ChatRuntimeEngineType> {
  const configured = readConfiguredEngine();
  if (!configured) throw new Error('默认引擎未配置，请先完成初始化设置');
  return configured;
}

export async function getOrCreateChatRuntimeEngine(
  type?: ChatRuntimeEngineType,
  sessionKey?: string,
  userId?: string,
): Promise<ChatRuntimeEngine | null> {
  const engineType = await resolveRequestedChatRuntimeEngineType(type);
  const pooledKey = sessionKey ? `${engineType}:${userId || 'anonymous'}:${sessionKey}` : '';
  if (!pooledKey) return new RuntimeBackedChatEngine(engineType, resolveRuntimeAgentId(engineType));

  const cached = pooledRuntimeEngines.get(pooledKey);
  if (cached) return cached;
  const engine = new RuntimeBackedChatEngine(engineType, resolveRuntimeAgentId(engineType));
  pooledRuntimeEngines.set(pooledKey, engine);
  return engine;
}

export async function resolveRequestedChatRuntimeEngineType(requestedEngine?: string | null): Promise<ChatRuntimeEngineType> {
  const requested = String(requestedEngine || '').trim();
  if (requested) return requested;
  return getConfiguredChatRuntimeEngine();
}

export function resolveRequestedChatRuntimeModel(requestedModel?: string | null): string {
  const requested = String(requestedModel || '').trim();
  if (requested) return requested;
  return readConfiguredRuntimeSelection().defaultModel;
}

export function resolveRecoveredRuntimeSessionId(result: ChatRuntimeResult, fallbackSessionId?: string | null): string | null {
  const recovery = result.metadata?.contextRecovery;
  if (recovery?.contextRecovered) {
    return result.sessionId || recovery.replacementSessionId || null;
  }
  return result.sessionId || fallbackSessionId || null;
}

export async function executeChatRuntimeWithContextRecovery(
  engine: ChatRuntimeEngine,
  options: ChatRuntimeEngineOptions,
  recovery: EngineContextRecoveryOptions = {},
): Promise<ChatRuntimeResult> {
  const maxAttempts = Math.max(1, recovery.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const continuationPromptLimit = recovery.continuationPromptLimit ?? DEFAULT_CONTINUATION_PROMPT_LIMIT;
  let currentOptions: ChatRuntimeEngineOptions = { ...options };
  let lastContextError = '';
  let recoveryMetadata: ContextRecoveryMetadata | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await engine.execute(currentOptions);
      const contextError = result.success ? '' : resultContextError(result);
      if (result.success || !isContextWindowExceededError(contextError) || attempt >= maxAttempts) {
        if (recoveryMetadata) {
          recoveryMetadata.replacementSessionId = result.sessionId || recoveryMetadata.replacementSessionId;
          result.metadata = { ...(result.metadata || {}), contextRecovery: recoveryMetadata };
        }
        return result;
      }
      lastContextError = contextError || 'context window exceeded';
    } catch (error) {
      const contextError = error instanceof Error ? error.message : String(error);
      if (!isContextWindowExceededError(contextError) || attempt >= maxAttempts) throw error;
      lastContextError = contextError || 'context window exceeded';
    }

    const previousSessionId = currentOptions.sessionId;
    const summary = await buildManualCompactSummary(engine, options, recovery, lastContextError);
    const nextOptions = {
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
    await recovery.onContextReset?.({
      attempt,
      engineName: engine.getName(),
      previousSessionId,
      nextSessionId: nextOptions.sessionId,
      method: 'manual-compact',
      error: lastContextError,
      summary,
    });
    recoveryMetadata = {
      contextRecovered: true,
      method: 'manual-compact',
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
    result.metadata = { ...(result.metadata || {}), contextRecovery: recoveryMetadata };
  }
  return result;
}

export async function compactChatRuntimeContextManually(
  engine: ChatRuntimeEngine,
  options: ChatRuntimeEngineOptions,
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
  const summary = await buildManualCompactSummary(engine, options, recovery, error);
  return {
    summary,
    method: 'manual-compact',
    previousSessionId,
    nextSessionId: null,
    prompt: buildContinuationPrompt({
      summary,
      currentPrompt: options.prompt,
      error,
      transcriptPath: recovery.transcriptPath,
      continuationPromptLimit,
    }),
  };
}

export function isChatRuntimeTimingDebug(): boolean {
  return process.env.ACE_TIMING_DEBUG === '1' || process.env.ACE_TIMING_DEBUG === 'true';
}

class RuntimeBackedChatEngine extends EventEmitter implements ChatRuntimeEngine {
  private runtimeSessionId?: string;
  private cancelled = false;
  private activeTurnId?: string;
  private activeRequestId?: string;

  constructor(
    private readonly engineType: string,
    private readonly agentId: string,
  ) {
    super();
  }

  async execute(options: ChatRuntimeEngineOptions): Promise<ChatRuntimeResult> {
    this.cancelled = false;
    const startedAt = Date.now();
    const service = getRuntimeSessionsApiService();
    const runtimeSessionId = options.forceNewSession
      ? undefined
      : (options.sessionId || this.runtimeSessionId);
    const modelRouteId = resolveChatModelRouteId(this.agentId, options.model);
    const session = runtimeSessionId
      ? await service.getSession(runtimeSessionId)
      : await service.createSession({
          agentId: this.agentId,
          cwd: options.workingDirectory,
          kind: 'chat',
          modelRouteId,
          mcpServers: options.mcpServers,
          ownerUserId: options.userId,
          title: options.step || 'Chat',
        });
    if (!session) {
      throw new Error(`Runtime session not found: ${runtimeSessionId}`);
    }
    this.runtimeSessionId = session.runtimeSessionId;
    const requestId = `${options.step || 'chat'}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.activeRequestId = requestId;
    const emitFormattedChunk = (event: ChatRuntimeStreamEvent) => {
      writeAcpxDebugTrace({
        stage: 'chat.formatted_chunk',
        context: {
          runtimeSessionId: session.runtimeSessionId,
          turnId: this.activeTurnId,
          requestId,
          agentId: this.agentId,
          runtime: 'chat',
        },
        payload: event,
      });
      this.emit('stream', event);
    };
    emitFormattedChunk({ type: 'session', content: session.runtimeSessionId });

    let output = '';
    let success = true;
    let error: string | undefined;
    let stopReason: string | undefined;
    let usage: TokenUsage | undefined;
    let cost: CostUsage | undefined;
    let completedSessionId = session.runtimeSessionId;
    let completedTurnId: string | undefined;
    const seenToolCalls = new Set<string>();
    const pendingTools = new Map<string, RuntimeToolState>();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => this.cancel(), options.timeoutMs);
    }

    try {
      const turnResult = await service.createTurn({
        runtimeSessionId: session.runtimeSessionId,
        requestId,
        input: buildRuntimeTurnInput(options),
        interruptPolicy: 'cancel-and-send',
        profileSnapshot: createRuntimeProfileSnapshot(this.agentId, options, modelRouteId || session.modelRouteId || `route-${this.agentId}`),
        metadata: {
          chatFacade: true,
          step: options.step,
          runId: options.runId,
          frontendSessionId: options.frontendSessionId,
          requestedEngine: this.engineType,
        },
      });
      this.activeTurnId = turnResult.turn.turnId;
      completedTurnId = turnResult.turn.turnId;
      if (this.cancelled) {
        await service.cancelTurn({
          runtimeSessionId: session.runtimeSessionId,
          turnId: turnResult.turn.turnId,
          requestId: `${requestId}:cancel-late-turn`,
          reason: 'chat runtime cancel',
        }).catch(() => service.cancelSession({
          runtimeSessionId: session.runtimeSessionId,
          requestId: `${requestId}:cancel-late-session`,
          reason: 'chat runtime cancel',
        }));
        success = false;
        error = 'cancelled';
        stopReason = 'cancelled';
      }
      for await (const event of turnResult.events ?? []) {
        if (this.cancelled) {
          await service.cancelTurn({
            runtimeSessionId: session.runtimeSessionId,
            turnId: event.turnId || turnResult.turn.turnId,
            requestId: `${requestId}:cancel-late-turn`,
            reason: 'chat runtime cancel',
          }).catch(() => service.cancelSession({
            runtimeSessionId: session.runtimeSessionId,
            requestId: `${requestId}:cancel-late-session`,
            reason: 'chat runtime cancel',
          }));
          success = false;
          error = 'cancelled';
          stopReason = 'cancelled';
          break;
        }
        const normalized = normalizeRuntimeEvent(event);
        usage = extractRuntimeUsage(normalized) ?? extractUsage(normalized.payload) ?? usage;
        cost = extractRuntimeCost(normalized) ?? extractCost(normalized.payload) ?? cost;
        const sessionId = extractSessionIdFromPayload(normalized.payload);
        if (sessionId) {
          completedSessionId = sessionId;
          emitFormattedChunk({ type: 'session', content: sessionId });
        }
        if (normalized.type === 'message.delta' || normalized.type === 'message.completed') {
          const text = extractText(normalized.payload);
          if (text) {
            output += text;
            emitFormattedChunk({ type: 'text', content: text, metadata: normalized.payload });
          }
        } else if (normalized.type === 'thought.delta') {
          const text = extractText(normalized.payload);
          if (text) emitFormattedChunk({ type: 'thought', content: text, metadata: normalized.payload });
        } else if (normalized.type.startsWith('tool.')) {
          const tool = projectRuntimeToolEvent(normalized.type, normalized.payload, normalized.toolCallId, seenToolCalls, pendingTools);
          if (tool) {
            emitFormattedChunk({
              type: 'tool',
              tool: { ...tool, createdAt: tool.createdAt || normalized.createdAt, updatedAt: normalized.createdAt },
              metadata: normalized.payload,
            });
          }
        } else if (normalized.type === 'turn.failed') {
          success = false;
          error = extractErrorMessage(normalized.payload) || extractMessage(normalized.payload) || 'Runtime turn failed';
          emitFormattedChunk({ type: 'error', content: error, metadata: normalized.payload });
        } else if (normalized.type === 'turn.cancelled') {
          success = false;
          stopReason = 'cancelled';
          error = 'cancelled';
        } else if (normalized.type === 'turn.completed') {
          stopReason = extractStopReason(normalized.payload);
        } else if (normalized.type === 'diagnostic' || normalized.type === 'status.changed') {
          const text = extractMessage(normalized.payload);
          if (text) emitFormattedChunk({ type: 'log', content: text, metadata: normalized.payload });
        }
      }
    } catch (caught) {
      success = false;
      error = caught instanceof Error ? caught.message : String(caught);
      emitFormattedChunk({ type: 'error', content: error });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeTurnId = undefined;
      this.activeRequestId = undefined;
    }

    const result = {
      success,
      output,
      error,
      stopReason,
      sessionId: completedSessionId,
      metadata: {
        usage: toLegacyUsage(usage),
        costUsd: cost?.costUsd ?? cost?.amount,
        cost_usd: cost?.costUsd ?? cost?.amount,
        durationMs: Date.now() - startedAt,
        duration_ms: Date.now() - startedAt,
      },
    };
    writeAcpxDebugTrace({
      stage: 'chat.turn_result',
      context: {
        runtimeSessionId: session.runtimeSessionId,
        turnId: completedTurnId,
        requestId,
        agentId: this.agentId,
        runtime: 'chat',
      },
      payload: result,
    });
    return result;
  }

  cancel(): void {
    this.cancelled = true;
    const runtimeSessionId = this.runtimeSessionId;
    if (!runtimeSessionId) return;
    const requestId = `${this.activeRequestId || `cancel:${Date.now()}`}:cancel`;
    const service = getRuntimeSessionsApiService();
    const cancellation = this.activeTurnId
      ? service.cancelTurn({
        runtimeSessionId,
        turnId: this.activeTurnId,
        requestId,
        reason: 'chat runtime cancel',
      })
      : service.cancelSession({
        runtimeSessionId,
        requestId,
        reason: 'chat runtime cancel',
      });
    void cancellation.catch(() => {});
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getName(): string {
    return `runtime:${this.agentId}`;
  }

  on(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: 'stream', listener: (event: ChatRuntimeStreamEvent) => void): this {
    return super.off(event, listener);
  }
}

function readConfiguredRuntimeSelection(): { engine: string | null; defaultModel: string } {
  try {
    if (!existsSync(getEngineConfigPath())) return { engine: null, defaultModel: '' };
    const raw = JSON.parse(readFileSync(getEngineConfigPath(), 'utf-8'));
    return {
      engine: typeof raw.engine === 'string' && raw.engine.trim() ? raw.engine.trim() : null,
      defaultModel: typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : '',
    };
  } catch {
    return { engine: null, defaultModel: '' };
  }
}

function readConfiguredEngine(): string | null {
  return readConfiguredRuntimeSelection().engine;
}

function resolveChatModelRouteId(agentId: string, model: string): string | undefined {
  const requested = String(model || '').trim();
  if (!requested) return undefined;

  try {
    const route = resolveRuntimeModelRoute({ modelRouteId: requested });
    if (route?.modelRouteId) return route.modelRouteId;
  } catch {
    // Fall through to model id lookup for selectors that store model ids.
  }

  const route = resolveRuntimeModelRoute({ agentId, modelId: requested });
  return route?.modelRouteId || requested;
}

function resolveRuntimeAgentId(engineType: string): string {
  return ENGINE_TO_AGENT[String(engineType || '').trim()] || String(engineType || 'claude').trim() || 'claude';
}

function buildRuntimeTurnInput(options: ChatRuntimeEngineOptions): string {
  const parts = [
    options.systemPrompt ? `<system>\n${options.systemPrompt}\n</system>` : '',
    options.allowedTools?.length ? `<allowed_tools>${options.allowedTools.join(', ')}</allowed_tools>` : '',
    options.rawPrompt ? options.prompt : `<user>\n${options.prompt}\n</user>`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

function createRuntimeProfileSnapshot(agentId: string, options: ChatRuntimeEngineOptions, modelRouteId: string): RuntimeProfileSnapshot {
  return {
    agentId,
    ownerUserId: options.userId,
    modelRouteId,
    cwd: options.workingDirectory,
    systemPromptHash: 'sha256:chat-runtime',
    skillsRevision: 'chat-runtime',
    mcpRevision: 'chat-runtime',
    permissionPolicyId: 'unrestricted',
    interruptPolicy: 'cancel-and-send',
    skills: [],
    mcpServers: options.mcpServers || [],
    env: Object.entries(options.env || {}).map(([key, value]) => ({
      key,
      value,
      source: 'turn-override' as const,
      secret: false,
      readiness: 'ready' as const,
    })),
  };
}

function normalizeRuntimeEvent(event: RuntimeEvent): RuntimeEvent {
  return {
    id: event.id,
    sessionId: event.sessionId,
    turnId: event.turnId,
    traceId: event.traceId,
    seq: event.seq,
    type: event.type,
    payload: event.payload,
    correlationId: event.correlationId,
    parentEventId: event.parentEventId,
    messageId: event.messageId,
    toolCallId: event.toolCallId,
    usage: event.usage,
    cost: event.cost,
    redacted: event.redacted,
    createdAt: event.createdAt,
  };
}

function extractSessionIdFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  return asString(payload.runtimeSessionId);
}

function extractText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!isRecord(payload)) return '';
  for (const key of ['text', 'content', 'delta', 'message', 'output']) {
    const value = payload[key];
    if (typeof value === 'string') return value;
  }
  return '';
}

function extractMessage(payload: unknown): string {
  return extractText(payload);
}

function extractStopReason(payload: unknown): string | undefined {
  return isRecord(payload) ? asString(payload.stopReason ?? payload.reason) : undefined;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const error = payload.error;
  if (isRecord(error)) return asString(error.message);
  return undefined;
}

function extractUsage(payload: unknown): TokenUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  return payload.usage as TokenUsage;
}

function extractRuntimeUsage(event: RuntimeEvent): TokenUsage | undefined {
  return event.usage && !event.usage.missing ? event.usage : undefined;
}

function extractCost(payload: unknown): CostUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.cost)) return undefined;
  return payload.cost as CostUsage;
}

function extractRuntimeCost(event: RuntimeEvent): CostUsage | undefined {
  return event.cost && !event.cost.missing ? event.cost : undefined;
}

function summarizeToolPayload(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const name = asString(payload.name ?? payload.tool ?? payload.command);
  const status = asString(payload.status ?? payload.state);
  return [name, status].filter(Boolean).join(' ');
}

/**
 * Projects ACP tool protocol events without serializing them into assistant
 * prose. Tool output has a separate lifecycle from model message deltas.
 */
export function projectRuntimeToolEvent(
  type: RuntimeEvent['type'],
  payload: unknown,
  eventToolCallId: string | undefined,
  seenToolCalls: Set<string>,
  pendingTools: Map<string, RuntimeToolState>,
): RuntimeToolEvent | null {
  if (!isRecord(payload)) return null;
  const status = String(payload.status ?? payload.state ?? '').toLowerCase();
  const toolId = String(payload.toolCallId ?? payload.id ?? eventToolCallId ?? '').trim();
  const pendingKey = toolId || '';
  let pending = pendingKey ? pendingTools.get(pendingKey) : undefined;
  const rawInput = resolveToolRawInput(payload) || pending?.rawInput;
  const rawOutput = resolveToolRawOutput(payload);
  const resolvedToolName = resolveRuntimeToolName(payload, rawInput);
  const hasDisplayableInput = rawInput ? hasDisplayableToolInput(resolvedToolName, rawInput) : false;
  if (toolId && rawInput && hasDisplayableInput) {
    pending = {
      toolName: preferRuntimeToolName(pending?.toolName, resolvedToolName),
      rawInput,
      toolId,
    };
    pendingTools.set(toolId, pending);
  }
  const toolName = pending?.toolName || resolvedToolName;
  const title = getAceToolTitle(toolName);
  const shouldEmitCall = type === 'tool.started'
    || type === 'tool.updated'
    || (!['completed', 'failed', 'done', 'success'].includes(status) && hasDisplayableInput);
  const callKey = toolId || stableToolCallKey(toolName, rawInput);
  const isTerminal = (
    type === 'tool.output'
    || type === 'tool.completed'
    || type === 'tool.failed'
    || ['completed', 'failed', 'done', 'success', 'error'].includes(status)
  );
  const hasExplicitToolIdentity = Boolean(
    asString(payload.toolName ?? payload.tool_name ?? payload.name ?? payload.tool ?? payload.kind ?? payload.title),
  );

  // A reconnect or ACPX recovery can yield only the terminal update. Prefer
  // its result over manufacturing a running card that can never be closed.
  if (isTerminal && (toolId || rawInput || rawOutput !== undefined || hasExplicitToolIdentity)) {
    const terminalOutput = rawOutput == null || rawOutput === ''
      ? createRuntimeToolTerminalOutput(type, payload, rawInput, status)
      : rawOutput;
    if (toolId) pendingTools.delete(toolId);
    return {
      id: callKey,
      toolName,
      title,
      status: type === 'tool.failed' || ['failed', 'error'].includes(status) ? 'failed' : 'completed',
      input: rawInput ? projectRuntimeToolInput(rawInput, toolName) : undefined,
      result: projectRuntimeToolResult(
        toolName,
        enrichRuntimeToolOutput(terminalOutput, rawInput),
        rawInput,
      ),
    };
  }

  if (shouldEmitCall && rawInput && hasDisplayableInput && !seenToolCalls.has(callKey)) {
    seenToolCalls.add(callKey);
    return {
      id: callKey,
      toolName,
      title,
      status: 'running',
      input: projectRuntimeToolInput(rawInput, toolName),
    };
  }

  return null;
}

function projectRuntimeToolInput(
  rawInput: Record<string, unknown>,
  toolName: string,
): RuntimeToolEvent['input'] {
  const changes = projectRuntimeToolChanges(rawInput.changes);
  const subagentInput = projectSubagentToolInput(rawInput, toolName);
  return {
    ...(stringValue(rawInput.command) ? { command: stringValue(rawInput.command) } : {}),
    ...(stringValue(rawInput.filePath ?? rawInput.file_path) ? { filePath: stringValue(rawInput.filePath ?? rawInput.file_path) } : {}),
    ...(stringValue(rawInput.path) ? { path: stringValue(rawInput.path) } : {}),
    ...(stringValue(rawInput.pattern) ? { pattern: stringValue(rawInput.pattern) } : {}),
    ...(stringValue(rawInput.include) ? { include: stringValue(rawInput.include) } : {}),
    ...(stringValue(rawInput.url) ? { url: stringValue(rawInput.url) } : {}),
    ...(stringValue(rawInput.query) ? { query: stringValue(rawInput.query) } : {}),
    ...(stringValue(rawInput.name ?? rawInput.skill ?? rawInput.id) ? { name: stringValue(rawInput.name ?? rawInput.skill ?? rawInput.id) } : {}),
    ...subagentInput,
    ...(changes.length > 0 ? { changes } : {}),
  };
}

function projectSubagentToolInput(
  rawInput: Record<string, unknown>,
  toolName: string,
): NonNullable<RuntimeToolEvent['input']> {
  if (toolName !== 'subagent-dispatch' && toolName !== 'subagent-wait') return {};

  const childAgentCount = countSubagents(rawInput);
  const model = stringValue(rawInput.model);
  const reasoningEffort = stringValue(rawInput.reasoningEffort ?? rawInput.reasoning_effort);
  if (toolName === 'subagent-wait') {
    return {
      description: childAgentCount
        ? `等待 ${childAgentCount} 个子 Agent 返回`
        : '等待子 Agent 返回',
      ...(childAgentCount ? { childAgentCount } : {}),
    };
  }

  const description = summarizeSubagentPrompt(rawInput.prompt);
  return {
    ...(description ? { description } : {}),
    ...(stringValue(rawInput.agent ?? rawInput.agentName ?? rawInput.subagent_type ?? rawInput.subagentType)
      ? { agent: stringValue(rawInput.agent ?? rawInput.agentName ?? rawInput.subagent_type ?? rawInput.subagentType) }
      : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(childAgentCount ? { childAgentCount } : {}),
  };
}

function countSubagents(rawInput: Record<string, unknown>): number | undefined {
  const receiverIds = rawInput.receiverThreadIds ?? rawInput.receiver_thread_ids;
  if (Array.isArray(receiverIds) && receiverIds.length > 0) return receiverIds.length;
  const agentStates = rawInput.agentsStates ?? rawInput.agents_states;
  if (isRecord(agentStates)) {
    const count = Object.keys(agentStates).length;
    if (count > 0) return count;
  }
  return undefined;
}

function summarizeSubagentPrompt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const line = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('[skill:') && !item.startsWith('<'));
  if (!line) return undefined;
  return line.length > 180 ? `${line.slice(0, 177)}...` : line;
}

function projectRuntimeToolResult(
  toolName: string,
  rawOutput: unknown,
  rawInput?: Record<string, unknown>,
): RuntimeToolEvent['result'] {
  const output = isRecord(rawOutput) ? rawOutput : { output: rawOutput };
  const changes = projectRuntimeToolChanges(output.changes ?? rawInput?.changes);
  const filePath = stringValue(output.filePath ?? output.file_path ?? rawInput?.filePath ?? rawInput?.file_path ?? rawInput?.path);
  const exitCode = numberValue(output.exitCode ?? output.exit_code);
  const error = runtimeToolResultText(output.error ?? output.errorText ?? output.errorMessage);
  const isFileContentTool = ['read', 'write', 'edit', 'multiedit', 'patch'].includes(toolName);
  // ACPX persists command and search output as formatted_output. It is the
  // canonical stdout payload after runtime.js strips top-level output fields.
  const directOutput = output.output
    ?? output.result
    ?? output.formatted_output
    ?? output.formattedOutput
    ?? output.content;
  const stdout = runtimeToolResultText(output.stdout)
    || (!isFileContentTool ? runtimeToolResultText(directOutput) : undefined);
  const stderr = runtimeToolResultText(output.stderr);

  return {
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(filePath ? { filePath } : {}),
    ...(changes.length > 0 ? { changes } : {}),
    ...(stdout ? { stdout } : {}),
    ...(stderr ? { stderr } : {}),
    ...(error ? { error } : {}),
  };
}

const MAX_RUNTIME_TOOL_RESULT_CHARS = 60_000;

/**
 * ACP adapters do not agree on a result shape. Keep command/search output in
 * the structured tool channel even when an engine returns a JSON object or a
 * content block instead of stdout.
 */
function runtimeToolResultText(value: unknown): string | undefined {
  if (value == null) return undefined;
  const text = typeof value === 'string'
    ? value
    : extractTextFromUnknown(value) || stringifyStructured(value);
  if (!text.trim()) return undefined;
  if (text.length <= MAX_RUNTIME_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_RUNTIME_TOOL_RESULT_CHARS)}\n\n[输出已截断，原始长度 ${text.length} 字符]`;
}

function projectRuntimeToolChanges(value: unknown): RuntimeToolChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((rawChange) => {
    if (!isRecord(rawChange)) return [];
    const filePath = stringValue(rawChange.filePath ?? rawChange.file_path ?? rawChange.path);
    const kind = stringValue(rawChange.kind ?? rawChange.type ?? rawChange.status);
    const changedLines = numberValue(rawChange.changedLines ?? rawChange.changed_lines);
    const addedLines = numberValue(rawChange.addedLines ?? rawChange.added_lines);
    const removedLines = numberValue(rawChange.removedLines ?? rawChange.removed_lines);
    if (!filePath && !kind && changedLines === undefined && addedLines === undefined && removedLines === undefined) return [];
    return [{
      ...(filePath ? { filePath } : {}),
      ...(kind ? { kind } : {}),
      ...(changedLines !== undefined ? { changedLines } : {}),
      ...(addedLines !== undefined ? { addedLines } : {}),
      ...(removedLines !== undefined ? { removedLines } : {}),
    }];
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function preferRuntimeToolName(current: string | undefined, next: string): string {
  if (!current) return next;
  if (isGenericRuntimeToolName(current) && !isGenericRuntimeToolName(next)) return next;
  return current;
}

function isGenericRuntimeToolName(name: string | undefined): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  return !normalized || normalized === 'tool' || normalized === 'tool call' || normalized === 'unknown';
}

function hasDisplayableToolInput(toolName: string, rawInput: Record<string, unknown>): boolean {
  const keys = Object.keys(rawInput);
  if (keys.length === 0) return false;
  if (typeof rawInput.command === 'string' && rawInput.command.trim()) return true;
  if (toolName === 'execute' || toolName === 'bash' || toolName === 'cmd' || toolName === 'powershell') return false;

  const structuralKeys = new Set(['cwd', 'workdir', 'workingDirectory', 'timeout', 'timeoutMs', 'description']);
  return keys.some((key) => !structuralKeys.has(key));
}

function enrichRuntimeToolOutput(rawOutput: unknown, rawInput?: Record<string, unknown>): unknown {
  if (!rawInput) return rawOutput;
  const enriched: Record<string, unknown> = isRecord(rawOutput)
    ? { ...rawOutput }
    : { output: rawOutput };
  if (typeof enriched.command !== 'string' && typeof rawInput.command === 'string') {
    enriched.command = rawInput.command;
  }
  if (typeof enriched.filePath !== 'string') {
    const filePath = rawInput.filePath ?? rawInput.file_path ?? rawInput.path;
    if (typeof filePath === 'string') enriched.filePath = filePath;
  }
  if (!Array.isArray(enriched.changes) && Array.isArray(rawInput.changes)) {
    enriched.changes = rawInput.changes;
  }
  return enriched;
}

function createRuntimeToolTerminalOutput(
  type: RuntimeEvent['type'],
  payload: Record<string, any>,
  rawInput: Record<string, unknown> | undefined,
  status: string,
): Record<string, unknown> {
  const failed = type === 'tool.failed' || ['failed', 'error'].includes(status);
  const filePath = rawInput?.filePath ?? rawInput?.file_path ?? rawInput?.path;
  const changes = Array.isArray(rawInput?.changes) ? rawInput.changes : undefined;
  const exitCode = payload.exitCode ?? payload.exit_code;
  if (failed) {
    const error = isRecord(payload.error)
      ? asString(payload.error.message)
      : asString(payload.errorText ?? payload.errorMessage ?? payload.error);
    return {
      error: error || '工具调用失败，ACP 未返回详细结果。',
      ...(typeof filePath === 'string' ? { filePath } : {}),
      ...(changes ? { changes } : {}),
      ...(typeof exitCode === 'number' ? { exitCode } : {}),
    };
  }
  return {
    completed: true,
    resultUnavailable: true,
    ...(typeof filePath === 'string' ? { filePath } : {}),
    ...(changes ? { changes } : {}),
    ...(typeof exitCode === 'number' ? { exitCode } : {}),
  };
}

function resolveToolRawInput(payload: Record<string, any>): Record<string, unknown> | undefined {
  if (isRecord(payload.rawInput)) return payload.rawInput;
  if (isRecord(payload.input)) return payload.input;
  if (typeof payload.command === 'string' && payload.command.trim()) return { command: payload.command };
  const text = asString(payload.text);
  if (text) {
    const command = extractCommandFromToolText(text);
    if (command) return { command };
  }
  const contentCommand = extractCommandFromToolContent(payload.content);
  if (contentCommand) return { command: contentCommand };
  return undefined;
}

function resolveToolRawOutput(payload: Record<string, any>): unknown {
  if (payload.rawOutput !== undefined) return payload.rawOutput;
  if (payload.aggregated_output !== undefined) {
    return {
      output: payload.aggregated_output,
      exitCode: payload.exitCode ?? payload.exit_code,
      command: payload.command,
    };
  }
  if (payload.output !== undefined) return payload.output;
  if (payload.result !== undefined) return payload.result;
  if (payload.formatted_output !== undefined) {
    return { formatted_output: payload.formatted_output, exitCode: payload.exitCode ?? payload.exit_code };
  }
  if (payload.formattedOutput !== undefined) {
    return { formattedOutput: payload.formattedOutput, exitCode: payload.exitCode ?? payload.exit_code };
  }
  if (
    payload.stderr !== undefined
    || payload.stdout !== undefined
    || payload.error !== undefined
    || payload.errorText !== undefined
    || payload.errorMessage !== undefined
    || payload.exitCode !== undefined
    || payload.exit_code !== undefined
  ) {
    return {
      stdout: payload.stdout,
      stderr: payload.stderr,
      error: payload.error ?? payload.errorText ?? payload.errorMessage,
      exitCode: payload.exitCode ?? payload.exit_code,
      command: payload.command,
    };
  }
  if (Array.isArray(payload.content) || typeof payload.content === 'string') return payload.content;
  return undefined;
}

function resolveRuntimeToolName(payload: Record<string, any>, rawInput?: Record<string, unknown>): string {
  const explicit = asString(payload.toolName ?? payload.tool_name ?? payload.name ?? payload.tool ?? payload.kind);
  if (explicit) {
    const normalized = explicit.toLowerCase();
    if (['spawnagent', 'spawn_agent', 'spawn-agent'].includes(normalized)) return 'subagent-dispatch';
    if (['wait', 'waitforagents', 'wait_for_agents', 'wait-for-agents'].includes(normalized)) return 'subagent-wait';
    if (normalized === 'shell' || normalized === 'terminal' || normalized === 'command_execution') {
      const command = typeof rawInput?.command === 'string' ? rawInput.command : '';
      return inferCommandToolName(command);
    }
    return resolveAceToolName(normalized, rawInput);
  }
  const title = asString(payload.title) || '';
  return resolveAceToolName(title, rawInput);
}

function extractCommandFromToolText(text: string): string {
  const value = String(text || '').trim();
  if (!value) return '';
  const inProgress = value.match(/^(.*?)\s+\((?:in_progress|running|queued|pending)\)\s*:\s*(.+)$/i);
  if (inProgress) {
    return String(inProgress[2] || inProgress[1] || '').trim();
  }
  const colon = value.match(/^(?:shell|terminal|command|cmd|powershell|bash)\s*:\s*(.+)$/i);
  if (colon) return String(colon[1] || '').trim();
  if (/^(?:Get-Content|Get-ChildItem|Select-String|rg|git|npm|npx|node|powershell|cmd|bash)\b/i.test(value)) {
    return value;
  }
  return '';
}

function extractCommandFromToolContent(content: unknown): string {
  if (typeof content === 'string') return extractCommandFromToolText(content);
  if (!Array.isArray(content)) return '';
  for (const item of content) {
    if (!isRecord(item)) continue;
    const text = asString(item.text ?? item.content);
    const command = text ? extractCommandFromToolText(text) : '';
    if (command) return command;
  }
  return '';
}

function stableToolCallKey(toolName: string, rawInput?: Record<string, unknown>): string {
  if (!rawInput) return toolName;
  try {
    return `${toolName}:${JSON.stringify(rawInput)}`;
  } catch {
    return toolName;
  }
}

function toLegacyUsage(usage?: TokenUsage): Partial<ChatRuntimeTokenUsage> | undefined {
  if (!usage || usage.missing) return undefined;
  return {
    ...(usage.inputTokens !== undefined ? { input_tokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { output_tokens: usage.outputTokens } : {}),
    ...(usage.cacheCreationInputTokens !== undefined ? { cache_creation_input_tokens: usage.cacheCreationInputTokens } : {}),
    ...(usage.cacheReadInputTokens !== undefined ? { cache_read_input_tokens: usage.cacheReadInputTokens } : {}),
  };
}

function resultContextError(result: ChatRuntimeResult): string {
  return [result.error || '', result.stopReason || '', result.output || ''].filter(Boolean).join('\n');
}

function isContextWindowExceededError(input: unknown): boolean {
  const message = input instanceof Error ? input.message : String(input || '');
  if (!message) return false;
  return /context[_\s-]?length[_\s-]?exceeded/i.test(message)
    || /context\s+window\s+limit/i.test(message)
    || /maximum context length/i.test(message)
    || /prompt is too long/i.test(message)
    || /too many tokens/i.test(message)
    || /exceeds? (the )?(model )?context/i.test(message);
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
  engine: ChatRuntimeEngine,
  options: ChatRuntimeEngineOptions,
  recovery: EngineContextRecoveryOptions,
  error: string,
): Promise<string> {
  const rawSource = recovery.buildCompactSource ? await recovery.buildCompactSource() : options.prompt;
  const source = truncateMiddle(String(rawSource || options.prompt), recovery.compactSourceLimit ?? DEFAULT_COMPACT_SOURCE_LIMIT, '待压缩上下文');
  const compactPrompt = buildCompactRequest(source, error, recovery.compactInstructions);
  try {
    const compactResult = await engine.execute({
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
    const normalized = normalizeCompactSummary(compactResult.output || '');
    if (compactResult.success && normalized) return normalized;
  } catch {
    // Fall back to a deterministic handoff below.
  }
  return buildFallbackSummary(source, error);
}

function buildFallbackSummary(source: string, error: string): string {
  return [
    'Summary:',
    '1. Primary Request and Intent:',
    '   The previous AI call ran out of context while handling the current request. Continue from the preserved task/context below.',
    '',
    '2. Key Technical Concepts:',
    '   Context compaction, session handoff, runtime adapter context recovery.',
    '',
    '3. Files and Code Sections:',
    '   See the preserved context and workspace state. Re-read exact files before editing.',
    '',
    '4. Errors and fixes:',
    `   Context window exceeded: ${error.slice(0, 1000)}`,
    '',
    '5. Problem Solving:',
    '   Continue the same task without relying on hidden prior session state.',
    '',
    '8. Current Work:',
    truncateMiddle(source, 20_000, '当前工作上下文'),
  ].join('\n');
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
