/**
 * Base ACP Wrapper
 *
 * ACP wrappers are request-scoped, while the underlying ACP process is shared
 * per compatible launch configuration. This keeps stream listeners isolated
 * per request while still allowing cross-session process reuse.
 */

import { EventEmitter } from 'events';
import { ACPEngine, buildAcpProcessReuseKey, logAcpTiming } from './acp-engine';
import type { ACPEngineConfig } from './acp-engine';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineChunk, normalizeEngineOutput } from './engine-output';
import {
  formatAceReasoning,
  formatAceToolCall,
  formatAceToolResult,
  getAceToolTitle,
  resolveAceToolName,
} from '@/lib/chat/ace-process-formatters';

function numberOrZero(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function metadataFromAcpUsage(usage: any): EngineResultMetadata {
  return {
    ...ZERO_USAGE_METADATA,
    usage: {
      input_tokens: numberOrZero(usage?.inputTokens ?? usage?.input_tokens),
      output_tokens: numberOrZero(usage?.outputTokens ?? usage?.output_tokens),
      cache_creation_input_tokens: numberOrZero(usage?.cachedWriteTokens ?? usage?.cache_creation_input_tokens),
      cache_read_input_tokens: numberOrZero(usage?.cachedReadTokens ?? usage?.cache_read_input_tokens),
    },
  };
}

const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

const SHARED_RUNNER_TTL_MS = 10 * 60 * 1000;
const SHARED_RUNNER_CLEANUP_INTERVAL_MS = 60_000;

type SessionAction = 'created' | 'resumed' | 'reused';

interface DiagnosticLogInput {
  message: string;
  detail?: string;
  level?: 'info' | 'warning' | 'error';
  metadata?: unknown;
  verbose?: boolean;
}

export interface ACPExecutionContext {
  wrapper: ACPWrapperBase;
  sessionId: string | null;
  collectedOutput: string;
  assistantText: string;
  assistantOutputStart: number | null;
  assistantMessageId: string | null;
  lastBlockWasTool: boolean;
  seenToolIds: Set<string>;
  streaming: boolean;
  diagnosticLoggingEnabled: boolean;
  emitStream: (event: EngineStreamEvent) => void;
}

interface SharedRunnerExecuteInput {
  wrapper: ACPWrapperBase;
  options: EngineOptions;
  diagnosticLoggingEnabled: boolean;
  initialRunnerKey: string;
  resolveRunnerKey: () => string;
  registerRunnerKey: (key: string) => void;
}

interface SharedRunnerCancelState {
  cancelled: boolean;
  started: boolean;
  settled: boolean;
}

class ACPSharedRunner {
  private engine: ACPEngine | null = null;
  private currentSessionId: string | null = null;
  private currentModelId: string | null = null;
  private readonly sessionModelIds = new Map<string, string>();
  private activeExecution: ACPExecutionContext | null = null;
  private queueTail: Promise<void> = Promise.resolve();
  private readonly registeredKeys = new Set<string>();
  private lastUsed = Date.now();

  constructor(
    private readonly timingLabel: string,
    private readonly createStartedEngine: (options: EngineOptions, diagnosticLoggingEnabled: boolean) => Promise<ACPEngine>,
  ) {}

  registerKey(key: string): void {
    if (!key) return;
    this.registeredKeys.add(key);
    this.lastUsed = Date.now();
  }

  getKeys(): Iterable<string> {
    return this.registeredKeys;
  }

  isIdle(): boolean {
    return this.activeExecution === null;
  }

  hasExpired(now: number): boolean {
    return this.isIdle() && now - this.lastUsed > SHARED_RUNNER_TTL_MS;
  }

  dispose(): void {
    const engine = this.engine;
    this.engine = null;
    this.currentSessionId = null;
    this.currentModelId = null;
    this.activeExecution = null;
    if (engine) {
      try {
        engine.stop();
      } catch {
        // ignore disposal failures
      }
    }
  }

  execute(input: SharedRunnerExecuteInput): { promise: Promise<EngineResult>; cancel: () => void } {
    const cancelState: SharedRunnerCancelState = {
      cancelled: false,
      started: false,
      settled: false,
    };

    const previous = this.queueTail.catch(() => {});
    const promise = previous
      .then(async () => {
        if (cancelState.cancelled) {
          return this.cancelledResult();
        }
        cancelState.started = true;
        return this.runExclusive(input, cancelState);
      })
      .finally(() => {
        cancelState.settled = true;
        this.lastUsed = Date.now();
      });

    this.queueTail = promise.then(() => {}, () => {});

    return {
      promise,
      cancel: () => {
        if (cancelState.settled) return;
        cancelState.cancelled = true;
        if (!cancelState.started) return;
        const engine = this.engine;
        if (!engine) return;
        try {
          engine.cancelSession();
        } catch {
          // ignore cancel failures
        }
        try {
          engine.stop();
        } catch {
          // ignore stop failures
        }
        if (this.engine === engine) {
          this.engine = null;
          this.currentSessionId = null;
          this.currentModelId = null;
        }
      },
    };
  }

  private cancelledResult(): EngineResult {
    return {
      success: false,
      output: '',
      error: 'Execution cancelled',
      metadata: ZERO_USAGE_METADATA,
    };
  }

  private async runExclusive(input: SharedRunnerExecuteInput, cancelState: SharedRunnerCancelState): Promise<EngineResult> {
    const { wrapper, options, diagnosticLoggingEnabled } = input;
    const executionContext: ACPExecutionContext = {
      wrapper,
      sessionId: null,
      collectedOutput: '',
      assistantText: '',
      assistantOutputStart: null,
      assistantMessageId: null,
      lastBlockWasTool: false,
      seenToolIds: new Set<string>(),
      streaming: false,
      diagnosticLoggingEnabled,
      emitStream: (event) => {
        wrapper.emit('stream', event);
      },
    };

    const tExecute = Date.now();
    this.activeExecution = executionContext;

    try {
      wrapper.beforeExecute(executionContext, options);
      wrapper.emitDiagnosticLog(executionContext, {
        message: 'ACP wrapper execute start',
        detail: `sessionId=${options.sessionId || '<new>'}, model=${options.model || '<default>'}`,
        metadata: {
          step: options.step,
          agent: options.agent,
          workingDirectory: options.workingDirectory,
          timeoutMs: options.timeoutMs,
        },
        verbose: true,
      });

      const tStart = Date.now();
      await this.ensureEngine(input);
      logAcpTiming(this.timingLabel, 'wrap.W1_ensure_shared_engine', tStart);

      if (cancelState.cancelled) {
        return this.cancelledResult();
      }

      const tSession = Date.now();
      const sessionAction = await this.ensureSession(options);
      executionContext.sessionId = this.currentSessionId;
      logAcpTiming(this.timingLabel, `wrap.W2_${sessionAction}_session`, tSession);

      if (executionContext.sessionId && sessionAction !== 'reused') {
        wrapper.emitDiagnosticLog(executionContext, {
          message: 'ACP session ready',
          detail: executionContext.sessionId,
          verbose: true,
        });
        executionContext.emitStream({
          type: 'session',
          content: executionContext.sessionId,
        });
      } else if (sessionAction === 'reused') {
        wrapper.emitDiagnosticLog(executionContext, {
          message: 'ACP wrapper reusing in-memory session',
          detail: executionContext.sessionId || '',
          verbose: true,
        });
      }

      const engine = this.engine;
      if (!engine) {
        throw new Error(`[${wrapper.getName()}] engine not initialized`);
      }

      if (options.model && this.currentModelId !== options.model) {
        const tModel = Date.now();
        try {
          wrapper.emitDiagnosticLog(executionContext, {
            message: 'ACP set model',
            detail: options.model,
            verbose: true,
          });
          await engine.setModel(options.model);
          this.currentModelId = options.model;
          if (this.currentSessionId) {
            this.sessionModelIds.set(this.currentSessionId, options.model);
          }
          logAcpTiming(this.timingLabel, 'wrap.W3_setModel', tModel);
        } catch (error: any) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          wrapper.emitDiagnosticLog(executionContext, {
            level: 'error',
            message: 'ACP set model failed',
            detail: errorMessage,
            metadata: { model: options.model },
          });
          executionContext.emitStream({
            type: 'text',
            content: `\n\n模型不可用: ${errorMessage}\n`,
          });
          return {
            success: false,
            output: '',
            error: errorMessage,
            metadata: ZERO_USAGE_METADATA,
          };
        }
      }

      executionContext.streaming = true;
      const fullPrompt = wrapper.buildPrompt(options, sessionAction);
      wrapper.emitDiagnosticLog(executionContext, {
        message: 'ACP wrapper sendPrompt start',
        detail: `promptLength=${fullPrompt.length}`,
        verbose: true,
      });

      const tPrompt = Date.now();
      const promptResult = await engine.sendPrompt(fullPrompt);
      await wrapper.reconcileLatestAssistantMessage(engine, executionContext, options);
      logAcpTiming(this.timingLabel, 'wrap.W4_sendPrompt_includes_agent', tPrompt);
      logAcpTiming(this.timingLabel, 'wrap.W_execute_total', tExecute, `sessionAction=${sessionAction}`);

      executionContext.streaming = false;
      wrapper.emitDiagnosticLog(executionContext, {
        message: 'ACP wrapper sendPrompt done',
        detail: `stopReason=${promptResult.stopReason || 'n/a'}`,
        metadata: {
          sessionId: executionContext.sessionId,
          stopReason: promptResult.stopReason,
          usage: promptResult.usage,
          outputLength: executionContext.collectedOutput.length,
        },
        verbose: true,
      });

      const isSuccess = !promptResult.stopReason || promptResult.stopReason === 'end_turn';
      return {
        success: isSuccess,
        output: normalizeEngineOutput(executionContext.collectedOutput),
        sessionId: executionContext.sessionId ?? undefined,
        stopReason: promptResult.stopReason,
        metadata: promptResult.usage ? metadataFromAcpUsage(promptResult.usage) : ZERO_USAGE_METADATA,
      };
    } catch (error) {
      executionContext.streaming = false;
      logAcpTiming(this.timingLabel, 'wrap.W_execute_total_failed', tExecute);
      const errorMessage = cancelState.cancelled
        ? 'Execution cancelled'
        : error instanceof Error
          ? error.message
          : String(error);
      const normalizedOutput = normalizeEngineOutput(executionContext.collectedOutput);
      const hasUsableOutput = normalizedOutput.length > 0;
      const isConnectionClosed = /connection\s+closed/i.test(errorMessage);

      if (isConnectionClosed && hasUsableOutput) {
        wrapper.emitDiagnosticLog(executionContext, {
          level: 'warning',
          message: 'ACP connection closed after streaming output',
          detail: `outputLength=${normalizedOutput.length}`,
          verbose: true,
        });
        return {
          success: true,
          output: normalizedOutput,
          sessionId: executionContext.sessionId ?? undefined,
          stopReason: 'end_turn',
          metadata: ZERO_USAGE_METADATA,
        };
      }

      wrapper.emitDiagnosticLog(executionContext, {
        level: 'error',
        message: 'ACP wrapper execute failed',
        detail: errorMessage,
        metadata: {
          outputLength: normalizedOutput.length,
          hasUsableOutput,
          isConnectionClosed,
        },
      });
      return {
        success: false,
        output: '',
        error: errorMessage,
        metadata: ZERO_USAGE_METADATA,
      };
    } finally {
      this.activeExecution = null;
    }
  }

  private async ensureEngine(input: SharedRunnerExecuteInput): Promise<void> {
    const { options, diagnosticLoggingEnabled, resolveRunnerKey, registerRunnerKey } = input;
    if (this.engine && this.isEngineAlive(this.engine)) {
      registerRunnerKey(resolveRunnerKey());
      return;
    }

    if (this.engine) {
      try {
        this.engine.stop();
      } catch {
        // ignore stop failures during restart
      }
    }

    this.currentSessionId = null;
    this.currentModelId = null;

    const engine = await this.createStartedEngine(options, diagnosticLoggingEnabled);
    this.engine = engine;
    this.attachEngineEvents(engine);
    registerRunnerKey(resolveRunnerKey());
  }

  private async ensureSession(options: EngineOptions): Promise<SessionAction> {
    const engine = this.engine;
    if (!engine) {
      throw new Error('ACP engine not initialized');
    }

    if (options.sessionId) {
      if (this.currentSessionId === options.sessionId) {
        return 'reused';
      }
      this.currentSessionId = await engine.resumeSession(options.sessionId);
      this.currentModelId = this.sessionModelIds.get(this.currentSessionId) ?? null;
      return 'resumed';
    }

    this.currentSessionId = await engine.createSession();
    this.currentModelId = null;
    return 'created';
  }

  private isEngineAlive(engine: ACPEngine): boolean {
    return (engine as any).process != null;
  }

  private attachEngineEvents(engine: ACPEngine): void {
    engine.on('agent-message', (content) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleAgentMessage(context, content);
    });

    engine.on('agent-thought', (content) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleAgentThought(context, content);
    });

    engine.on('tool-call', (toolCall) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleToolCall(context, toolCall);
    });

    engine.on('tool-call-update', (toolUpdate) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleToolCallUpdate(context, toolUpdate);
    });

    engine.on('permission', (params: any) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handlePermissionRequest(context, params);
    });

    engine.on('subtask', (params: any) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleSubtask(context, params);
    });

    engine.on('log', (payload) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleEngineLog(context, payload);
    });

    engine.on('exit', (info) => {
      const context = this.activeExecution;
      if (!context?.streaming) return;
      context.wrapper.handleEngineExit(context, info);
    });

    engine.on('error', (error) => {
      const context = this.activeExecution;
      if (!context) return;
      context.wrapper.handleEngineError(context, error);
    });
  }
}

export abstract class ACPWrapperBase extends EventEmitter implements Engine {
  private static readonly sharedRunners = new Map<string, ACPSharedRunner>();
  private static cleanupTimer: NodeJS.Timeout | null = null;

  private cancelCurrentExecution: (() => void) | null = null;

  abstract getName(): string;
  protected abstract getACPConfig(options: EngineOptions): ACPEngineConfig;
  abstract isAvailable(): Promise<boolean>;

  async execute(options: EngineOptions): Promise<EngineResult> {
    const diagnosticLoggingEnabled = Boolean(options.diagnosticLogging);
    const runner = this.getOrCreateSharedRunner(options, diagnosticLoggingEnabled);
    const { promise, cancel } = runner.execute({
      wrapper: this,
      options,
      diagnosticLoggingEnabled,
      initialRunnerKey: this.getSharedRunnerKey(options, diagnosticLoggingEnabled),
      resolveRunnerKey: () => this.getSharedRunnerKey(options, diagnosticLoggingEnabled),
      registerRunnerKey: (key) => ACPWrapperBase.registerSharedRunnerKey(runner, key),
    });

    this.cancelCurrentExecution = cancel;
    try {
      return await promise;
    } finally {
      if (this.cancelCurrentExecution === cancel) {
        this.cancelCurrentExecution = null;
      }
    }
  }

  cancel(): void {
    this.cancelCurrentExecution?.();
  }

  cleanup(): void {
    this.cancel();
  }

  static shutdownSharedRunners(): void {
    const runners = new Set(this.sharedRunners.values());
    this.sharedRunners.clear();
    for (const runner of runners) {
      runner.dispose();
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  protected beforeExecute(_context: ACPExecutionContext, _options: EngineOptions): void {}

  protected shouldRecoverLatestAssistantMessage(_options: EngineOptions): boolean {
    return false;
  }

  protected buildPrompt(options: EngineOptions, sessionAction: SessionAction): string {
    let fullPrompt = options.prompt;
    if (options.systemPrompt) {
      const shouldPrepend = sessionAction === 'created' || options.appendSystemPrompt;
      if (shouldPrepend) {
        fullPrompt = `<system>\n${options.systemPrompt}\n</system>\n\n${options.prompt}`;
      }
    }
    return fullPrompt;
  }

  protected getSharedRunnerKey(options: EngineOptions, diagnosticLoggingEnabled: boolean): string {
    const config = this.getEngineConfig(options, diagnosticLoggingEnabled);
    return buildAcpProcessReuseKey(config);
  }

  protected getEngineConfig(options: EngineOptions, diagnosticLoggingEnabled: boolean): ACPEngineConfig {
    return {
      ...this.getACPConfig(options),
      diagnosticLogging: diagnosticLoggingEnabled,
    };
  }

  protected async createStartedEngine(options: EngineOptions, diagnosticLoggingEnabled: boolean): Promise<ACPEngine> {
    const config = this.getEngineConfig(options, diagnosticLoggingEnabled);
    const engine = new ACPEngine(config);
    try {
      await engine.start();
      return engine;
    } catch (error) {
      try {
        engine.stop();
      } catch {
        // ignore cleanup failures after failed startup
      }
      throw error;
    }
  }

  protected emitText(context: ACPExecutionContext, content: string, metadata?: unknown): void {
    const normalized = normalizeEngineChunk(content, context.collectedOutput.length > 0);
    if (!normalized) return;
    context.collectedOutput += normalized;
    context.emitStream({ type: 'text', content: normalized, metadata });
  }

  protected emitDiagnosticLog(context: ACPExecutionContext, input: DiagnosticLogInput): void {
    if (!context.diagnosticLoggingEnabled) return;
    const { message, detail, level, metadata, verbose } = input;
    context.emitStream({
      type: 'log',
      content: message,
      metadata: {
        ...(detail ? { detail } : {}),
        ...(level ? { level } : {}),
        ...(metadata !== undefined ? { payload: metadata } : {}),
        ...(verbose !== undefined ? { verbose } : {}),
      },
    });
  }

  protected getToolTitle(toolName: string): string {
    return getAceToolTitle(toolName);
  }

  protected handleAgentMessage(context: ACPExecutionContext, content: any): void {
    const text = this.extractText(content);
    if (!text) return;
    const messageId = this.extractMessageId(content);

    let prefix = '';
    if (context.lastBlockWasTool) {
      prefix = '\n\n<!-- chunk-boundary -->\n\n';
      context.lastBlockWasTool = false;
    }
    if (context.assistantOutputStart == null) {
      context.assistantOutputStart = context.collectedOutput.length + prefix.length;
    } else if (
      messageId
      && context.assistantMessageId
      && messageId !== context.assistantMessageId
      && context.assistantOutputStart <= context.collectedOutput.length
    ) {
      context.collectedOutput = context.collectedOutput.slice(0, context.assistantOutputStart);
      context.assistantText = '';
    }
    if (messageId) context.assistantMessageId = messageId;
    this.emitText(context, prefix + text);
    context.assistantText += text;
  }

  protected handleAgentThought(context: ACPExecutionContext, content: any): void {
    const text = this.extractText(content);
    if (!text) return;
    context.emitStream({
      type: 'thought',
      content: formatAceReasoning(text),
    });
  }

  protected handleToolCall(context: ACPExecutionContext, toolCall: any): void {
    const toolId = toolCall.id || '';
    const hasInput = toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0;
    if (!toolId || context.seenToolIds.has(toolId) || !hasInput) return;

    context.seenToolIds.add(toolId);
    const formatted = this.formatToolCall(toolCall);
    context.lastBlockWasTool = true;
    this.emitText(context, formatted, toolCall);
  }

  protected handleToolCallUpdate(context: ACPExecutionContext, toolUpdate: any): void {
    const toolId = toolUpdate.id || '';
    if (toolId && !context.seenToolIds.has(toolId)) {
      const hasInput = toolUpdate.rawInput && Object.keys(toolUpdate.rawInput).length > 0;
      if (hasInput && toolUpdate.status !== 'completed' && toolUpdate.status !== 'failed') {
        context.seenToolIds.add(toolId);
        const formatted = this.formatToolCall(toolUpdate);
        context.lastBlockWasTool = true;
        this.emitText(context, formatted, toolUpdate);
      }
    }

    if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
      let resultPayload: unknown = undefined;
      if (toolUpdate.rawOutput) {
        resultPayload = toolUpdate.rawOutput;
      } else if (Array.isArray(toolUpdate.content)) {
        const textParts = toolUpdate.content
          .filter((block: any) => block.type === 'text' && typeof block.text === 'string')
          .map((block: any) => block.text);
        resultPayload = textParts.length > 0 ? textParts.join('\n') : toolUpdate.content;
      } else if (typeof toolUpdate.content === 'string') {
        resultPayload = toolUpdate.content;
      }
      const formatted = this.formatToolResult(resultPayload, toolUpdate);
      if (formatted) {
        this.emitText(context, formatted, toolUpdate);
      }
    }
  }

  protected handlePermissionRequest(_context: ACPExecutionContext, _params: any): void {}

  protected handleSubtask(context: ACPExecutionContext, params: any): void {
    const name = params?.title || params?.name || params?.description || 'Subagent task';
    context.lastBlockWasTool = true;
    this.emitText(
      context,
      formatAceToolCall({
        toolName: 'task',
        rawInput: {
          description: params?.description || name,
          agent: params?.agent || params?.subagent || '',
          prompt: params?.prompt || '',
          sessionId: params?.sessionId || params?.session_id || params?.id || params?.taskId || params?.task_id || '',
        },
        title: name,
        toolId: String(params?.id || params?.taskId || params?.task_id || ''),
      }),
      params,
    );
  }

  protected handleEngineLog(context: ACPExecutionContext, payload: any): void {
    if (typeof payload === 'string') {
      this.emitDiagnosticLog(context, {
        message: 'ACP engine log',
        detail: payload.trim(),
        verbose: true,
      });
      return;
    }

    if (payload && typeof payload === 'object' && 'message' in payload) {
      const entry = payload as Record<string, unknown>;
      this.emitDiagnosticLog(context, {
        message: String(entry.message || 'ACP engine log'),
        detail: typeof entry.detail === 'string' ? entry.detail : undefined,
        level: entry.level === 'info' || entry.level === 'warning' || entry.level === 'error'
          ? entry.level
          : undefined,
        metadata: entry,
        verbose: entry.verbose === undefined ? true : Boolean(entry.verbose),
      });
    }
  }

  protected handleEngineExit(context: ACPExecutionContext, info: any): void {
    this.emitDiagnosticLog(context, {
      level: info?.code === 0 && !info?.signal ? 'info' : 'error',
      message: 'ACP engine exit event',
      detail: `code=${info?.code ?? 'null'}, signal=${info?.signal ?? 'null'}`,
      metadata: info,
      verbose: true,
    });
  }

  protected handleEngineError(context: ACPExecutionContext, error: unknown): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.emitDiagnosticLog(context, {
      level: 'error',
      message: 'ACP engine error event',
      detail: errorMessage,
      verbose: true,
    });
    context.emitStream({
      type: 'text',
      content: `\n\n错误: ${errorMessage}\n`,
    });
  }

  protected extractText(content: any): string {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
      if (content.content) {
        if (typeof content.content === 'string') return content.content;
        if (content.content.type === 'text' && typeof content.content.text === 'string') return content.content.text;
        if (typeof content.content.text === 'string') return content.content.text;
      }
      if (content.type === 'text' && typeof content.text === 'string') return content.text;
      if (typeof content.text === 'string') return content.text;
    }
    return '';
  }

  protected extractMessageId(content: any): string {
    if (!content || typeof content !== 'object') return '';
    return typeof content.messageId === 'string' ? content.messageId : '';
  }

  protected extractToolOutput(raw: any): unknown {
    return raw;
  }

  protected resolveToolName(toolCall: any): string {
    return resolveAceToolName(toolCall.title || '', toolCall.rawInput || {});
  }

  protected formatToolCall(toolCall: any): string {
    const toolName = this.resolveToolName(toolCall);
    const rawInput = toolCall.rawInput || {};
    return formatAceToolCall({
      toolName,
      rawInput,
      title: getAceToolTitle(toolName),
      toolId: toolCall.id,
    });
  }

  protected formatToolResult(rawOutput: unknown, metadata: any): string {
    if (rawOutput == null || rawOutput === '') return '';
    const toolName = this.resolveToolName(metadata || {});
    return formatAceToolResult({
      toolName,
      rawOutput,
      title: getAceToolTitle(toolName),
      toolId: String(metadata?.id || ''),
    }).trimEnd();
  }

  protected async reconcileLatestAssistantMessage(
    engine: ACPEngine,
    context: ACPExecutionContext,
    options: EngineOptions,
  ): Promise<void> {
    if (!this.shouldRecoverLatestAssistantMessage(options) || !context.sessionId) {
      return;
    }

    const recoveredText = await engine.recoverLatestAssistantMessage(context.sessionId);
    if (!recoveredText) return;

    const streamedText = context.assistantText;
    const assistantOutputStart = context.assistantOutputStart;
    if (assistantOutputStart == null) {
      let prefix = '';
      if (context.lastBlockWasTool) {
        prefix = '\n\n<!-- chunk-boundary -->\n\n';
        context.lastBlockWasTool = false;
      }
      context.assistantOutputStart = context.collectedOutput.length + prefix.length;
      this.emitText(context, prefix + recoveredText);
      context.assistantText = recoveredText;
      this.emitDiagnosticLog(context, {
        message: 'ACP assistant message recovered from session history',
        detail: `streamed=0, recovered=${recoveredText.length}`,
        metadata: {
          recoveredLength: recoveredText.length,
          streamedLength: 0,
        },
        verbose: true,
      });
      return;
    }

    if (streamedText === recoveredText) return;

    context.collectedOutput = `${context.collectedOutput.slice(0, assistantOutputStart)}${recoveredText}`;
    if (recoveredText.startsWith(streamedText)) {
      const delta = recoveredText.slice(streamedText.length);
      if (delta) {
        context.emitStream({ type: 'text', content: delta });
      }
    }
    context.assistantText = recoveredText;
    this.emitDiagnosticLog(context, {
      message: 'ACP assistant message reconciled from session history',
      detail: `streamed=${streamedText.length}, recovered=${recoveredText.length}`,
      metadata: {
        recoveredLength: recoveredText.length,
        streamedLength: streamedText.length,
      },
      verbose: true,
    });
  }

  private getOrCreateSharedRunner(options: EngineOptions, diagnosticLoggingEnabled: boolean): ACPSharedRunner {
    ACPWrapperBase.ensureCleanupTimer();
    const key = this.getSharedRunnerKey(options, diagnosticLoggingEnabled);
    const existing = ACPWrapperBase.sharedRunners.get(key);
    if (existing) {
      existing.registerKey(key);
      return existing;
    }

    const runner = new ACPSharedRunner(
      this.getName(),
      (runnerOptions, runnerDiagnosticLoggingEnabled) =>
        this.createStartedEngine(runnerOptions, runnerDiagnosticLoggingEnabled),
    );
    ACPWrapperBase.registerSharedRunnerKey(runner, key);
    return runner;
  }

  private static ensureCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const uniqueRunners = new Set(this.sharedRunners.values());
      for (const runner of uniqueRunners) {
        if (!runner.hasExpired(now)) continue;
        runner.dispose();
        for (const key of runner.getKeys()) {
          if (this.sharedRunners.get(key) === runner) {
            this.sharedRunners.delete(key);
          }
        }
      }
      if (this.sharedRunners.size === 0 && this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    }, SHARED_RUNNER_CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  private static registerSharedRunnerKey(runner: ACPSharedRunner, key: string): void {
    runner.registerKey(key);
    this.sharedRunners.set(key, runner);
  }
}
