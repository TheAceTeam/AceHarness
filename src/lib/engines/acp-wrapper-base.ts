/**
 * Base ACP Wrapper
 *
 * Common wrapper implementation for all ACP-compatible engines.
 * Each engine (opencode, kiro-cli, cursor) will extend this base class.
 * Event handling mirrors OpenCodeEngineWrapper for consistent UI rendering.
 */

import { EventEmitter } from 'events';
import { ACPEngine, logAcpTiming } from './acp-engine';
import type { ACPEngineConfig } from './acp-engine';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineChunk, normalizeEngineOutput } from './engine-output';
import { htmlCodeBlock, formatTextContent } from '@/lib/core/markdown-utils';
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

export abstract class ACPWrapperBase extends EventEmitter implements Engine {
  protected engine: ACPEngine | null = null;
  protected currentSessionId: string | null = null;
  protected lastBlockWasTool = false;
  protected seenToolIds = new Set<string>();
  protected streaming = false;
  protected collectedOutput = '';
  protected currentModelId: string | null = null;
  protected diagnosticLoggingEnabled = false;

  abstract getName(): string;
  protected abstract getACPConfig(options: EngineOptions): ACPEngineConfig;
  abstract isAvailable(): Promise<boolean>;

  async execute(options: EngineOptions): Promise<EngineResult> {
    const timingLabel = this.getName();
    const tExecute = Date.now();
    try {
      this.diagnosticLoggingEnabled = Boolean(options.diagnosticLogging);
      this.seenToolIds.clear();
      this.lastBlockWasTool = false;
      this.collectedOutput = '';
      this.emitDiagnosticLog({
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

      // Reuse existing engine if resuming a session, otherwise create new
      const canReuse = options.sessionId && this.engine && this.currentSessionId === options.sessionId;
      if (!canReuse) {
        this.emitDiagnosticLog({
          message: 'ACP wrapper preparing fresh engine/session',
          detail: options.sessionId ? `resume ${options.sessionId}` : 'create new session',
          verbose: true,
        });
        const tStop = Date.now();
        // Stop previous engine if any
        if (this.engine) {
          try { await this.engine.stop(); } catch {}
        }
        this.currentModelId = null;
        logAcpTiming(timingLabel, 'wrap.W0_stop_previous_engine', tStop);

        const tStart = Date.now();
        await this.startNewEngine(options);
        logAcpTiming(timingLabel, 'wrap.W1_startNewEngine_acp.start', tStart);
        const startedEngine = this.engine;
        if (!startedEngine) {
          throw new Error(`[${this.getName()}] engine not initialized`);
        }

        const tSess = Date.now();
        if (options.sessionId) {
          this.currentSessionId = await startedEngine.resumeSession(options.sessionId);
          logAcpTiming(timingLabel, 'wrap.W2_resumeSession', tSess);
        } else {
          this.currentSessionId = await startedEngine.createSession();
          logAcpTiming(timingLabel, 'wrap.W2_createSession', tSess);
        }
        this.currentModelId = null;
        if (this.currentSessionId) {
          this.emitDiagnosticLog({
            message: 'ACP session ready',
            detail: this.currentSessionId,
            verbose: true,
          });
          this.emit('stream', {
            type: 'session',
            content: this.currentSessionId,
          } as EngineStreamEvent);
        }
      } else {
        this.emitDiagnosticLog({
          message: 'ACP wrapper reusing in-memory session',
          detail: options.sessionId || this.currentSessionId || '',
          verbose: true,
        });
      }

      const engine = this.engine;
      if (!engine) {
        throw new Error(`[${this.getName()}] engine not initialized`);
      }

      if (options.model && this.currentModelId !== options.model) {
        const tModel = Date.now();
        try {
          this.emitDiagnosticLog({
            message: 'ACP set model',
            detail: options.model,
            verbose: true,
          });
          // magic-cli doesn't support runtime model switching via ACP, so skip this step for it.
          await engine.setModel(options.model);
          this.currentModelId = options.model;
          logAcpTiming(timingLabel, 'wrap.W3_setModel', tModel);
        } catch (modelErr: any) {
          this.emitDiagnosticLog({
            level: 'error',
            message: 'ACP set model failed',
            detail: modelErr.message,
            metadata: {
              model: options.model,
            },
          });
          // Emit the error to the stream so the user sees available models in the UI
          this.emit('stream', {
            type: 'text',
            content: `\n\n❌ 模型不可用: ${modelErr.message}\n`,
          } as EngineStreamEvent);
          return {
            success: false,
            output: '',
            error: modelErr.message,
            metadata: ZERO_USAGE_METADATA,
          };
        }
      }

      this.streaming = true;
      // ACP agents (opencode) do not honor _meta.systemPrompt.
      // Prepend systemPrompt to the user message on first turn or when appendSystemPrompt is set.
      let fullPrompt = options.prompt;
      if (options.systemPrompt) {
        const isNewSession = !canReuse;
        const shouldPrepend = isNewSession || options.appendSystemPrompt;
        if (shouldPrepend) {
          fullPrompt = `<system>\n${options.systemPrompt}\n</system>\n\n${options.prompt}`;
        }
      }
      console.log(`[${this.getName()}] calling sendPrompt...`);
      this.emitDiagnosticLog({
        message: 'ACP wrapper sendPrompt start',
        detail: `promptLength=${fullPrompt.length}`,
        verbose: true,
      });
      const tPrompt = Date.now();
      const promptResult = await engine.sendPrompt(fullPrompt);
      logAcpTiming(timingLabel, 'wrap.W4_sendPrompt_includes_agent', tPrompt);
      logAcpTiming(timingLabel, 'wrap.W_execute_total', tExecute, `canReuse=${canReuse}`);
      const stopReason = promptResult.stopReason;
      console.log(`[${this.getName()}] sendPrompt returned: stopReason=${stopReason}`);
      this.streaming = false;
      this.emitDiagnosticLog({
        message: 'ACP wrapper sendPrompt done',
        detail: `stopReason=${stopReason || 'n/a'}`,
        metadata: {
          sessionId: this.currentSessionId,
          stopReason,
          usage: promptResult.usage,
          outputLength: this.collectedOutput.length,
        },
        verbose: true,
      });

      // Treat end_turn and undefined/null (normal completion) as success
      const isSuccess = !stopReason || stopReason === 'end_turn';

      return {
        success: isSuccess,
        output: normalizeEngineOutput(this.collectedOutput),
        sessionId: this.currentSessionId ?? undefined,
        stopReason,
        metadata: promptResult.usage ? metadataFromAcpUsage(promptResult.usage) : ZERO_USAGE_METADATA
      };
    } catch (error) {
      this.streaming = false;
      logAcpTiming(timingLabel, 'wrap.W_execute_total_failed', tExecute);
      const errorMessage = error instanceof Error ? error.message : String(error);
      const normalizedOutput = normalizeEngineOutput(this.collectedOutput);
      const hasUsableOutput = normalizedOutput.length > 0;
      const isConnectionClosed = /connection\s+closed/i.test(errorMessage);

      // Some ACP engines may close the connection right after streaming final output.
      // In this case, treat the run as successful if we already captured non-empty content.
      if (isConnectionClosed && hasUsableOutput) {
        this.emitDiagnosticLog({
          level: 'warning',
          message: 'ACP connection closed after streaming output',
          detail: `outputLength=${normalizedOutput.length}`,
          verbose: true,
        });
        return {
          success: true,
          output: normalizedOutput,
          sessionId: this.currentSessionId ?? undefined,
          stopReason: 'end_turn',
          metadata: ZERO_USAGE_METADATA,
        };
      }

      this.emitDiagnosticLog({
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
        metadata: ZERO_USAGE_METADATA
      };
    }
  }

  cancel(): void {
    if (this.engine) {
      this.engine.cancelSession();
      this.engine.stop();
      this.engine = null;
      this.currentModelId = null;
    }
  }

  protected async startNewEngine(options: EngineOptions): Promise<void> {
    const config = {
      ...this.getACPConfig(options),
      diagnosticLogging: this.diagnosticLoggingEnabled,
    };
    this.engine = new ACPEngine(config);
    this.setupEngineEvents();
    await this.engine.start();
  }

  /**
   * Ensure the engine process is running. Reuses the existing process if it's
   * still alive (just creates a new session on it). Only spawns a new process
   * if there's no engine or the previous one has exited.
   */
  protected async ensureEngine(options: EngineOptions): Promise<void> {
    // Check if existing engine process is still alive
    if (this.engine && this.isEngineAlive()) {
      return; // Reuse existing process — just create/resume session on it
    }
    // Engine is dead or doesn't exist — spawn a new one
    if (this.engine) {
      try { this.engine.stop(); } catch {}
    }
    await this.startNewEngine(options);
  }

  /** Check if the underlying engine process is still running */
  private isEngineAlive(): boolean {
    if (!this.engine) return false;
    // ACPEngine sets this.process = null in cleanup() when process exits
    return (this.engine as any).process != null;
  }

  protected emitText(content: string, metadata?: unknown): void {
    const normalized = normalizeEngineChunk(content, this.collectedOutput.length > 0);
    if (!normalized) return;
    this.collectedOutput += normalized;
    this.emit('stream', { type: 'text', content: normalized, metadata } as EngineStreamEvent);
  }

  protected emitDiagnosticLog(input: {
    message: string;
    detail?: string;
    level?: 'info' | 'warning' | 'error';
    metadata?: unknown;
    verbose?: boolean;
  }): void {
    if (!this.diagnosticLoggingEnabled) return;
    const { message, detail, level, metadata, verbose } = input;
    this.emit('stream', {
      type: 'log',
      content: message,
      metadata: {
        ...(detail ? { detail } : {}),
        ...(level ? { level } : {}),
        ...(metadata !== undefined ? { payload: metadata } : {}),
        ...(verbose !== undefined ? { verbose } : {}),
      },
    } as EngineStreamEvent);
  }

  protected getToolTitle(toolName: string): string {
    return getAceToolTitle(toolName);
  }

  // ---------------------------------------------------------------------------
  // Event forwarding — subclasses can override setupEngineEvents for custom behavior
  // ---------------------------------------------------------------------------

  protected setupEngineEvents(): void {
    if (!this.engine) return;

    this.engine.on('agent-message', (content) => {
      if (!this.streaming) return;
      const text = this.extractText(content);
      if (!text) return;

      let prefix = '';
      if (this.lastBlockWasTool) {
        prefix = '\n\n<!-- chunk-boundary -->\n\n';
        this.lastBlockWasTool = false;
      }
      this.emitText(prefix + text);
    });

    this.engine.on('agent-thought', (content) => {
      if (!this.streaming) return;
      const text = this.extractText(content);
      if (text) {
        this.emit('stream', {
          type: 'thought',
          content: formatAceReasoning(text),
        } as EngineStreamEvent);
      }
    });

    this.engine.on('tool-call', (toolCall) => {
      if (!this.streaming) return;
      const toolId = toolCall.id || '';
      const hasInput = toolCall.rawInput && Object.keys(toolCall.rawInput).length > 0;
      if (toolId && !this.seenToolIds.has(toolId) && hasInput) {
        this.seenToolIds.add(toolId);
        const formatted = this.formatToolCall(toolCall);
        this.lastBlockWasTool = true;
        this.emitText(formatted, toolCall);
      }
    });

    this.engine.on('tool-call-update', (toolUpdate) => {
      if (!this.streaming) return;
      const toolId = toolUpdate.id || '';

      if (toolId && !this.seenToolIds.has(toolId)) {
        const hasInput = toolUpdate.rawInput && Object.keys(toolUpdate.rawInput).length > 0;
        if (hasInput && toolUpdate.status !== 'completed' && toolUpdate.status !== 'failed') {
          this.seenToolIds.add(toolId);
          const formatted = this.formatToolCall(toolUpdate);
          this.lastBlockWasTool = true;
          this.emitText(formatted, toolUpdate);
        }
      }

      if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
        let resultPayload: unknown = undefined;
        if (toolUpdate.rawOutput) {
          resultPayload = toolUpdate.rawOutput;
        } else if (Array.isArray(toolUpdate.content)) {
          const textParts = toolUpdate.content
            .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
            .map((c: any) => c.text);
          resultPayload = textParts.length > 0 ? textParts.join('\n') : toolUpdate.content;
        } else if (typeof toolUpdate.content === 'string') {
          resultPayload = toolUpdate.content;
        }
        const formatted = this.formatToolResult(resultPayload, toolUpdate);
        if (formatted) {
          this.emitText(formatted, toolUpdate);
        }
      }
    });

    this.engine.on('subtask', (params: any) => {
      if (!this.streaming) return;
      const name = params?.title || params?.name || params?.description || 'Subagent task';
      this.lastBlockWasTool = true;
      this.emitText(
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
    });

    this.engine.on('log', (payload) => {
      if (!this.streaming) return;
      if (typeof payload === 'string') {
        this.emitDiagnosticLog({
          message: 'ACP engine log',
          detail: payload.trim(),
          verbose: true,
        });
        return;
      }
      if (payload && typeof payload === 'object' && 'message' in payload) {
        const entry = payload as Record<string, unknown>;
        this.emitDiagnosticLog({
          message: String(entry.message || 'ACP engine log'),
          detail: typeof entry.detail === 'string' ? entry.detail : undefined,
          level: entry.level === 'info' || entry.level === 'warning' || entry.level === 'error'
            ? entry.level
            : undefined,
          metadata: entry,
          verbose: entry.verbose === undefined ? true : Boolean(entry.verbose),
        });
      }
    });

    this.engine.on('exit', (info) => {
      if (!this.streaming) return;
      this.emitDiagnosticLog({
        level: info?.code === 0 && !info?.signal ? 'info' : 'error',
        message: 'ACP engine exit event',
        detail: `code=${info?.code ?? 'null'}, signal=${info?.signal ?? 'null'}`,
        metadata: info,
        verbose: true,
      });
    });

    this.engine.on('error', (error) => {
      this.emitDiagnosticLog({
        level: 'error',
        message: 'ACP engine error event',
        detail: error instanceof Error ? error.message : String(error),
        verbose: true,
      });
      this.emit('stream', {
        type: 'text',
        content: `\n\n❌ 错误: ${error instanceof Error ? error.message : String(error)}\n`
      } as EngineStreamEvent);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers (protected so subclasses can reuse)
  // ---------------------------------------------------------------------------

  protected extractText(content: any): string {
    if (typeof content === 'string') return content;
    if (content && typeof content === 'object') {
      if (content.type === 'text' && content.text) return content.text;
      if (content.text) return content.text;
      if (content.content) return content.content;
    }
    return '';
  }

  protected extractToolOutput(raw: any): unknown {
    return raw;
  }

  protected resolveToolName(toolCall: any): string {
    return resolveAceToolName(toolCall.title || '', toolCall.rawInput || {});
  }
/* PLACEHOLDER_FORMAT */

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
}
