/**
 * Workflow/spec runtime facade.
 *
 * This file is the temporary migration boundary for workflow, AI draft, and
 * spec merge callers. It deliberately does not import old engine wrappers or
 * adapter-level APIs; execution goes through RuntimeOrchestrator and persists
 * runtime session/turn/event/trace rows.
 */
import { EventEmitter } from 'events';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import {
  executeChatRuntimeWithContextRecovery,
  compactChatRuntimeContextManually,
  projectRuntimeToolEvent,
  getConfiguredChatRuntimeEngine,
  resolveRequestedChatRuntimeEngineType,
  resolveRecoveredRuntimeSessionId,
  type ChatRuntimeEngineOptions,
  type ChatRuntimeResult,
  type ChatRuntimeResultMetadata,
  type ChatRuntimeStreamEvent,
  type ChatRuntimeTokenUsage,
  type EngineContextRecoveryOptions,
  type RuntimeToolState,
} from '@/lib/chat/chat-engine-runtime';
import { createRuntimeOrchestrator } from '@/lib/runtime-agent/orchestrator';
import { createRuntimeAdapterRegistry } from '@/lib/runtime-agent/adapters/adapter-registry';
import { createAcpxRuntimeClient } from '@/lib/runtime-agent/adapters/acpx-runtime-client';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';
import { ACE_CHUNK_BOUNDARY } from '@/lib/chat/ai-process-blocks';
import type {
  RuntimeEvent,
  RuntimeOrchestrator,
  RuntimeProfileSnapshot,
} from '@/lib/runtime-agent/contracts';

export type WorkflowRuntimeType = string;
export type WorkflowRuntimeStreamEvent = ChatRuntimeStreamEvent;
export type WorkflowRuntimeTokenUsage = ChatRuntimeTokenUsage;
export type WorkflowRuntimeResultMetadata = ChatRuntimeResultMetadata;
export type WorkflowRuntimeResult = ChatRuntimeResult;
export type WorkflowRuntimeOptions = ChatRuntimeEngineOptions;

export interface WorkflowRuntimeProjectionState {
  hasMessageText: boolean;
  toolObservedAfterMessage: boolean;
  seenToolCalls?: Set<string>;
  pendingTools?: Map<string, RuntimeToolState>;
}

export interface WorkflowRuntimeJsonResult {
  result: string;
  /** Complete agent transcript, including process blocks when available. */
  rawOutput?: string;
  runtimeSessionId: string;
  stop_reason?: string;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  usage: WorkflowRuntimeTokenUsage;
}

export class WorkflowRuntimeConfigurationError extends Error {
  readonly code = 'MODEL_ROUTE_NOT_FOUND';
  readonly fatal = true;
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'WorkflowRuntimeConfigurationError';
    if (cause !== undefined) this.cause = cause;
  }
}

export function isFatalWorkflowRuntimeError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { fatal?: unknown }).fatal === true
    && (error as { code?: unknown }).code === 'MODEL_ROUTE_NOT_FOUND'
  );
}

export interface WorkflowRuntime {
  execute(options: WorkflowRuntimeOptions): Promise<WorkflowRuntimeResult>;
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
  on(event: 'stream', listener: (event: WorkflowRuntimeStreamEvent) => void): void;
  off(event: 'stream', listener: (event: WorkflowRuntimeStreamEvent) => void): void;
}

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
};

let sharedOrchestrator: RuntimeOrchestrator | null = null;

export async function createWorkflowRuntime(type?: WorkflowRuntimeType): Promise<WorkflowRuntime | null> {
  const runtimeType = await resolveRequestedWorkflowRuntimeType(type);
  return new OrchestratedWorkflowRuntime(runtimeType, getLogicalEngineId(runtimeType));
}

export async function getConfiguredWorkflowRuntime(): Promise<WorkflowRuntimeType> {
  return getConfiguredChatRuntimeEngine();
}

export async function resolveRequestedWorkflowRuntimeType(requestedRuntime?: string | null): Promise<WorkflowRuntimeType> {
  return resolveRequestedChatRuntimeEngineType(requestedRuntime);
}

export function resolveRecoveredWorkflowRuntimeSessionId(
  result: WorkflowRuntimeResult,
  fallbackRuntimeSessionId?: string | null,
): string | null {
  return resolveRecoveredRuntimeSessionId(result, fallbackRuntimeSessionId);
}

export async function executeWorkflowRuntimeWithContextRecovery(
  runtime: WorkflowRuntime,
  options: WorkflowRuntimeOptions,
  recovery: EngineContextRecoveryOptions = {},
): Promise<WorkflowRuntimeResult> {
  return executeChatRuntimeWithContextRecovery(runtime, options, recovery);
}

export async function prewarmWorkflowRuntimeSession(input: {
  runtimeType?: WorkflowRuntimeType | null;
  agent: string;
  step?: string;
  model: string;
  workingDirectory: string;
  userId?: string;
}): Promise<string> {
  const runtimeType = await resolveRequestedWorkflowRuntimeType(input.runtimeType);
  const agentId = getLogicalEngineId(runtimeType);
  const modelRouteId = resolveWorkflowModelRouteId(agentId, input.model);
  const session = await getWorkflowRuntimeOrchestrator().openSession({
    agentId,
    modelRouteId,
    cwd: input.workingDirectory,
    kind: 'workflow-agent',
    // Prewarming reserves the workflow session identity and model route. The
    // backend ACPX session is created by its first real turn so it cannot be
    // mistaken for a resumable rollout before any work has happened.
    deferAdapterSessionInitialization: true,
    ownerUserId: input.userId,
    title: [input.agent, input.step || 'prewarm'].filter(Boolean).join(' / '),
  });
  return session.runtimeSessionId;
}

export async function compactWorkflowRuntimeContextManually(
  runtime: WorkflowRuntime,
  options: WorkflowRuntimeOptions,
  recovery: EngineContextRecoveryOptions = {},
): ReturnType<typeof compactChatRuntimeContextManually> {
  return compactChatRuntimeContextManually(runtime, options, recovery);
}

export function getWorkflowRuntimeSkillsSubdir(_runtimeType?: WorkflowRuntimeType): string {
  return '.agents/skills';
}

export function getLogicalEngineId(runtimeType?: string | null): string {
  const normalized = String(runtimeType || '').trim();
  if (normalized === 'claude-code-acp') return 'claude';
  if (normalized === 'opencode-sdk') return 'opencode';
  if (normalized === 'nga-sdk') return 'nga';
  if (normalized === 'magic-cli') return 'cangjie-magic';
  return ENGINE_TO_AGENT[normalized] || normalized;
}

class OrchestratedWorkflowRuntime extends EventEmitter implements WorkflowRuntime {
  private runtimeSessionId?: string;
  private cancelled = false;
  private cancellationError?: string;
  private activeTurnId?: string;
  private activeRequestId?: string;

  constructor(
    private readonly runtimeType: string,
    private readonly agentId: string,
  ) {
    super();
  }

  async execute(options: WorkflowRuntimeOptions): Promise<WorkflowRuntimeResult> {
    this.cancelled = false;
    this.cancellationError = undefined;
    const startedAt = Date.now();
    const orchestrator = getWorkflowRuntimeOrchestrator();
    let modelRouteId: string;
    let runtimeSessionId: string;
    try {
      modelRouteId = resolveWorkflowModelRouteId(this.agentId, options.model);
      runtimeSessionId = await this.ensureRuntimeSession(orchestrator, options, modelRouteId);
    } catch (error) {
      throw normalizeWorkflowRuntimeConfigurationError(error, this.agentId, options.model);
    }
    this.emit('stream', { type: 'session', content: runtimeSessionId });

    const requestId = `${options.runId || 'workflow'}:${options.agent}:${options.step}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    this.activeRequestId = requestId;
    let output = '';
    let success = true;
    let error: string | undefined;
    let stopReason: string | undefined;
    let usage: WorkflowRuntimeTokenUsage | undefined;
    let costUsd: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelRequested = false;
    const projectionState: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
      seenToolCalls: new Set<string>(),
      pendingTools: new Map<string, RuntimeToolState>(),
    };

    const timeoutMs = options.timeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      timeout = setTimeout(() => {
        this.cancellationError = `步骤执行超时：已超过配置上限 ${formatRuntimeTimeout(timeoutMs)}。`;
        this.cancel();
      }, timeoutMs);
    }

    try {
      for await (const event of orchestrator.runTurn({
        runtimeSessionId,
        requestId,
        input: buildRuntimeTurnInput(options),
        interruptPolicy: 'cancel-and-send',
        profileSnapshot: createRuntimeProfileSnapshot(this.agentId, options, modelRouteId),
        metadata: {
          workflowRuntimeFacade: true,
          runtimeType: this.runtimeType,
          agent: options.agent,
          step: options.step,
          runId: options.runId,
          frontendSessionId: options.frontendSessionId,
        },
        })) {
          if (event.turnId) this.activeTurnId = event.turnId;
          if (this.cancelled && !cancelRequested) {
            cancelRequested = true;
            const activeTurnId = event.turnId || this.activeTurnId;
            const cancel = activeTurnId
              ? orchestrator.cancelTurn({
                  runtimeSessionId,
                  turnId: activeTurnId,
                  requestId: `${requestId}:cancel-late-turn`,
                  reason: 'workflow runtime cancellation',
                })
              : orchestrator.cancelSession({
              runtimeSessionId,
              requestId: `${requestId}:cancel-late-session`,
              reason: 'workflow runtime cancellation',
              });
            await cancel.catch(() => orchestrator.cancelSession({
              runtimeSessionId,
              requestId: `${requestId}:cancel-late-session`,
              reason: 'workflow runtime cancellation',
            }));
            success = false;
            error = this.cancellationError || '运行时执行已取消';
            stopReason = 'cancelled';
        }
        const projection = projectWorkflowRuntimeEvent(event, projectionState);
        if (projection) this.emit('stream', projection);
        if (projection?.type === 'text') output += projection.content;
        if (event.type === 'turn.failed') {
          success = false;
          error = extractMessage(event.payload) || 'Runtime turn failed';
        } else if (event.type === 'turn.cancelled') {
          success = false;
          error = this.cancellationError || '运行时执行已取消';
          stopReason = 'cancelled';
        } else if (event.type === 'turn.completed') {
          stopReason = extractStopReason(event.payload);
        }
        const runtimeUsage = extractRuntimeUsage(event) || extractUsage(event.payload);
        if (runtimeUsage) usage = runtimeUsage;
        const runtimeCost = extractRuntimeCostUsd(event) ?? extractCostUsd(event.payload);
        if (runtimeCost !== undefined) costUsd = runtimeCost;
      }
    } catch (caught) {
      success = false;
      error = caught instanceof Error ? caught.message : String(caught);
      this.emit('stream', { type: 'error', content: error });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.activeTurnId = undefined;
      this.activeRequestId = undefined;
    }

    return {
      success,
      output,
      error,
      stopReason,
      sessionId: runtimeSessionId,
      metadata: {
        usage,
        costUsd,
        cost_usd: costUsd,
        durationMs: Date.now() - startedAt,
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  cancel(): void {
    this.cancelled = true;
    const runtimeSessionId = this.runtimeSessionId;
    if (!runtimeSessionId) return;
    const requestId = `${this.activeRequestId || `cancel:${Date.now()}`}:cancel`;
    const orchestrator = getWorkflowRuntimeOrchestrator();
    const cancellation = this.activeTurnId
      ? orchestrator.cancelTurn({
        runtimeSessionId,
        turnId: this.activeTurnId,
        requestId,
        reason: 'workflow runtime cancellation',
      })
      : orchestrator.cancelSession({
        runtimeSessionId,
        requestId,
        reason: 'workflow runtime cancellation',
      });
    void cancellation.catch(() => {});
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getName(): string {
    return `runtime:${this.agentId}`;
  }

  on(event: 'stream', listener: (event: WorkflowRuntimeStreamEvent) => void): this {
    return super.on(event, listener);
  }

  off(event: 'stream', listener: (event: WorkflowRuntimeStreamEvent) => void): this {
    return super.off(event, listener);
  }

  private async ensureRuntimeSession(
    orchestrator: RuntimeOrchestrator,
    options: WorkflowRuntimeOptions,
    modelRouteId: string,
  ): Promise<string> {
    const requestedSessionId = !options.forceNewSession
      ? String(options.sessionId || '').trim()
      : '';
    if (requestedSessionId) {
      try {
        await orchestrator.getSessionStatus({ runtimeSessionId: requestedSessionId });
        this.runtimeSessionId = requestedSessionId;
        return requestedSessionId;
      } catch {
        this.runtimeSessionId = undefined;
      }
    }
    const session = await orchestrator.openSession({
      agentId: this.agentId,
      modelRouteId,
      cwd: options.workingDirectory,
      kind: 'workflow-agent',
      // The first ACPX turn needs a fresh backend session. Creating a native
      // binding here would immediately reconnect that unstarted session and
      // make Codex attempt a resume before it has a rollout to restore.
      deferAdapterSessionInitialization: true,
      ownerUserId: options.userId,
      title: [options.agent, options.step].filter(Boolean).join(' / ') || undefined,
    });
    this.runtimeSessionId = session.runtimeSessionId;
    return session.runtimeSessionId;
  }
}

function getWorkflowRuntimeOrchestrator(): RuntimeOrchestrator {
  if (sharedOrchestrator) return sharedOrchestrator;
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  const store = new RuntimeSqliteStore(db);
  sharedOrchestrator = createRuntimeOrchestrator({
    db,
    store,
    adapterRegistry: createRuntimeAdapterRegistry({
      acpxClient: createAcpxRuntimeClient(),
    }),
  });
  return sharedOrchestrator;
}

function runtimeAgentLabel(agentId: string): string {
  const labels: Record<string, string> = {
    opencode: 'OpenCode',
    codex: 'Codex',
    claude: 'Claude Code',
    codeagent: 'CodeAgent',
    gemini: 'Gemini',
  };
  return labels[agentId] || agentId;
}

export function resolveWorkflowModelRouteId(agentId: string, model: string): string {
  const requestedModel = String(model || '').trim();
  const displayAgent = runtimeAgentLabel(agentId);
  if (!requestedModel) {
    throw new WorkflowRuntimeConfigurationError(
      `未找到可用的模型配置。\n引擎：${displayAgent}\n请在模型管理中添加模型，或修改工作流的模型设置。`,
    );
  }

  try {
    const explicitRoute = resolveRuntimeModelRoute({ modelRouteId: requestedModel });
    if (explicitRoute?.agentId === agentId && explicitRoute.modelRouteId) {
      return explicitRoute.modelRouteId;
    }
  } catch {
    // Selectors may store a model ID instead of a route ID.
  }

  const modelRoute = resolveRuntimeModelRoute({ agentId, modelId: requestedModel });
  if (modelRoute?.modelRouteId) return modelRoute.modelRouteId;

  throw new WorkflowRuntimeConfigurationError(
    `未找到可用的模型配置。\n引擎：${displayAgent}\n模型：${requestedModel}\n请在模型管理中添加该模型，或修改工作流的模型设置。`,
  );
}

function normalizeWorkflowRuntimeConfigurationError(error: unknown, agentId: string, model: string): Error {
  if (isFatalWorkflowRuntimeError(error)) return error as Error;
  if (isSqliteForeignKeyConstraintError(error)) {
    return new WorkflowRuntimeConfigurationError(
      `模型配置不存在或已失效。\n引擎：${runtimeAgentLabel(agentId)}\n模型：${model}\n请重新选择模型后启动工作流。`,
      error,
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function isSqliteForeignKeyConstraintError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY'
  );
}

function createRuntimeProfileSnapshot(agentId: string, options: WorkflowRuntimeOptions, modelRouteId: string): RuntimeProfileSnapshot {
  return {
    agentId,
    ownerUserId: options.userId,
    modelRouteId,
    cwd: options.workingDirectory,
    systemPromptHash: 'sha256:workflow-runtime-facade',
    skillsRevision: 'workflow-runtime-facade',
    mcpRevision: 'workflow-runtime-facade',
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

function buildRuntimeTurnInput(options: WorkflowRuntimeOptions): string {
  return [
    options.systemPrompt ? `<system>\n${options.systemPrompt}\n</system>` : '',
    options.allowedTools?.length ? `<allowed_tools>${options.allowedTools.join(', ')}</allowed_tools>` : '',
    options.rawPrompt ? options.prompt : `<user>\n${options.prompt}\n</user>`,
  ].filter(Boolean).join('\n\n');
}

export function projectWorkflowRuntimeEvent(
  event: RuntimeEvent,
  state: WorkflowRuntimeProjectionState,
): WorkflowRuntimeStreamEvent | null {
  if (event.type === 'message.delta' || event.type === 'message.completed') {
    const content = extractText(event.payload);
    if (!content) return null;
    const isFirstMessage = !state.hasMessageText;
    const prefix = isFirstMessage
      ? `<!-- timestamp: ${event.createdAt} -->\n`
      : state.toolObservedAfterMessage
        ? `${ACE_CHUNK_BOUNDARY}<!-- timestamp: ${event.createdAt} -->\n`
        : '';
    state.hasMessageText = true;
    state.toolObservedAfterMessage = false;
    return { type: 'text', content: prefix + content, metadata: event.payload };
  }
  if (event.type === 'thought.delta') {
    const content = extractText(event.payload);
    return content ? { type: 'thought', content, metadata: event.payload } : null;
  }
  if (event.type.startsWith('tool.')) {
    const tool = projectRuntimeToolEvent(
      event.type,
      event.payload,
      event.toolCallId,
      state.seenToolCalls || (state.seenToolCalls = new Set<string>()),
      state.pendingTools || (state.pendingTools = new Map<string, RuntimeToolState>()),
    );
    if (!tool) return null;
    // The next model text starts a new transcript segment after this tool,
    // including when the tool is the first visible runtime event.
    state.toolObservedAfterMessage = true;
    return {
      type: 'tool',
      tool: { ...tool, createdAt: tool.createdAt || event.createdAt, updatedAt: event.createdAt },
      metadata: event.payload,
    };
  }
  if (event.type === 'turn.failed') {
    return { type: 'error', content: extractMessage(event.payload) || 'Runtime turn failed', metadata: event.payload };
  }
  if (event.type === 'diagnostic' || event.type === 'status.changed') {
    const content = extractMessage(event.payload);
    return content ? { type: 'log', content, metadata: event.payload } : null;
  }
  return null;
}

function extractUsage(payload: unknown): WorkflowRuntimeTokenUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined;
  return {
    input_tokens: numberOrZero(payload.usage.inputTokens ?? payload.usage.input_tokens),
    output_tokens: numberOrZero(payload.usage.outputTokens ?? payload.usage.output_tokens),
    cache_creation_input_tokens: numberOrZero(payload.usage.cacheCreationInputTokens ?? payload.usage.cache_creation_input_tokens),
    cache_read_input_tokens: numberOrZero(payload.usage.cacheReadInputTokens ?? payload.usage.cache_read_input_tokens),
  };
}

function extractRuntimeUsage(event: RuntimeEvent): WorkflowRuntimeTokenUsage | undefined {
  if (!event.usage || event.usage.missing) return undefined;
  return {
    input_tokens: numberOrZero(event.usage.inputTokens),
    output_tokens: numberOrZero(event.usage.outputTokens),
    cache_creation_input_tokens: numberOrZero(event.usage.cacheCreationInputTokens),
    cache_read_input_tokens: numberOrZero(event.usage.cacheReadInputTokens),
  };
}

function extractCostUsd(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined;
  const cost = isRecord(payload.cost) ? payload.cost : payload;
  const value = cost.costUsd ?? cost.cost_usd ?? cost.amount;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractRuntimeCostUsd(event: RuntimeEvent): number | undefined {
  if (!event.cost || event.cost.missing) return undefined;
  const value = event.cost.costUsd ?? event.cost.amount;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
  return isRecord(payload) && typeof payload.stopReason === 'string'
    ? payload.stopReason
    : isRecord(payload) && typeof payload.reason === 'string'
      ? payload.reason
      : undefined;
}

function formatRuntimeTimeout(timeoutMs: number): string {
  const minutes = timeoutMs / 60_000;
  return Number.isInteger(minutes) ? `${minutes} 分钟` : `${Math.ceil(timeoutMs / 1_000)} 秒`;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
