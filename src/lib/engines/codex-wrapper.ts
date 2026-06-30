/**
 * Codex Engine Wrapper
 *
 * Uses @openai/codex-sdk to run Codex CLI as an engine.
 * Streams JSONL events (agent_message, command_execution, etc.)
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { createHash } from 'crypto';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineChunk, normalizeEngineOutput } from './engine-output';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import {
  formatAceFileChangesResult,
  formatAceReasoning,
  formatAceToolCall,
  formatAceToolResult,
  getAceToolTitle,
  inferCommandToolName,
} from '@/lib/chat/ace-process-formatters';
import { repairWindowsMojibake } from '@/lib/core/mojibake-repair';
import { readTextFileBestEffort } from '@/lib/core/text-decoding';
import { buildConfiguredProcessEnvSync, getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { isWindows } from '@/lib/core/runtime-platform';
import { toCodexMcpServers } from '@/lib/mcp/registry';

const requireFromHere = createRequire(__filename);

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

async function runtimeImport<T = any>(moduleName: string): Promise<T> {
  try {
    return await Function('moduleName', 'return import(moduleName)')(moduleName) as T;
  } catch (error: any) {
    if (String(error?.message || error).includes('dynamic import callback')) {
      return await import(/* @vite-ignore */ moduleName) as T;
    }
    throw error;
  }
}

function canResolveCodexSdk(): boolean {
  try {
    requireFromHere.resolve('@openai/codex-sdk');
    return true;
  } catch {
    try {
      requireFromHere.resolve('@openai/codex-sdk/dist/index.js');
      return true;
    } catch {
      try {
        requireFromHere.resolve('@openai/codex/package.json');
        return true;
      } catch {
        return false;
      }
    }
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function metadataFromCodexEvent(event: Record<string, unknown> | null): EngineResultMetadata {
  const usage = event?.usage && typeof event.usage === 'object' ? event.usage as Record<string, unknown> : {};
  return {
    usage: {
      input_tokens: numberOrZero(usage.input_tokens),
      output_tokens: numberOrZero(usage.output_tokens),
      cache_creation_input_tokens: numberOrZero(usage.cache_creation_input_tokens),
      cache_read_input_tokens: numberOrZero(usage.cache_read_input_tokens),
    },
    cost_usd: numberOrZero(event?.cost_usd),
    duration_ms: numberOrZero(event?.duration_ms),
    duration_api_ms: numberOrZero(event?.duration_api_ms),
    num_turns: numberOrZero(event?.num_turns),
  };
}

function isSpawnableCodexOverride(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  if (!isWindows()) return true;
  const lower = candidate.toLowerCase();
  return lower.endsWith('.exe') || lower.endsWith('.com');
}

function isRecoverableMissingFileError(error: unknown): boolean {
  const message = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : String((error as any)?.message || error || '');
  if (!message) return false;
  return /\bENOENT\b/i.test(message)
    && /no such file or directory/i.test(message)
    && /\bopen\b/i.test(message);
}

export class CodexEngineWrapper extends EventEmitter implements Engine {
  private currentThread: any = null;
  private codexInstance: any = null;
  private _abortController: AbortController | null = null;
  private lastBlockWasTool = false;
  private lastClientSignature = '';
  private clientSignatureChangedForRun = false;
  private pendingCommandExecutions: string[] = [];

  private getThreadOptions(options: EngineOptions) {
    return {
      model: options.model || undefined,
      workingDirectory: options.workingDirectory,
      skipGitRepoCheck: true,
      approvalPolicy: 'never' as const,
      sandboxMode: 'danger-full-access' as const,
    };
  }

  getName(): string {
    return 'codex';
  }

  async isAvailable(): Promise<boolean> {
    try {
      await runtimeImport('@openai/codex-sdk');
      return true;
    } catch {
      return canResolveCodexSdk() || Boolean(this.findCodexFallbackPath());
    }
  }

  private findCodexFallbackPath(): string | null {
    const resolved = findCommand('codex', getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
    if (isSpawnableCodexOverride(resolved)) return resolved;
    return null;
  }

  private emitText(content: string, appendToOutput = true): void {
    if (!content) return;
    const normalized = normalizeEngineChunk(content, this.collectedOutput.length > 0);
    if (!normalized) return;
    if (appendToOutput) this.collectedOutput += normalized;
    this.emit('stream', {
      type: 'text',
      content: normalized,
    } as EngineStreamEvent);
  }

  private collectedOutput = '';
  private lastAgentMessageSnapshot = '';

  private resetRunState(clearOutput = true): void {
    if (clearOutput) this.collectedOutput = '';
    this.lastBlockWasTool = false;
    this.lastAgentMessageSnapshot = '';
    this.pendingCommandExecutions = [];
  }

  private formatCommandExecution(command: string): string {
    const cmd = command || '';
    this.pendingCommandExecutions.push(cmd);
    const toolName = inferCommandToolName(cmd);
    return formatAceToolCall({
      toolName,
      rawInput: { command: cmd },
      title: getAceToolTitle(toolName),
    });
  }

  private formatCommandResult(output: string, exitCode?: number, command?: string): string {
    const resultText = repairWindowsMojibake((output || '').trim());
    if (!resultText && exitCode == null) return '';
    const cmd = command || this.pendingCommandExecutions.shift() || '';
    if (command) {
      const matchingIndex = this.pendingCommandExecutions.indexOf(command);
      if (matchingIndex >= 0) this.pendingCommandExecutions.splice(matchingIndex, 1);
    }
    const toolName = inferCommandToolName(cmd);
    return formatAceToolResult({
      toolName,
      rawOutput: { output: resultText, exitCode: exitCode ?? 0, command: cmd },
      title: getAceToolTitle(toolName),
    });
  }

  private getStringField(source: any, keys: string[]): string {
    for (const key of keys) {
      if (typeof source?.[key] === 'string' && source[key].length > 0) {
        return source[key];
      }
    }
    return '';
  }

  private formatFileChanges(changes: any[]): string {
    if (!Array.isArray(changes) || changes.length === 0) return '';
    const hydrated = changes.map((change) => {
      const path = this.getStringField(change, ['path', 'filePath', 'file_path']);
      const kind = this.getStringField(change, ['kind', 'type', 'action']);
      const oldText = this.getStringField(change, ['oldText', 'old_text', 'oldString', 'old_string', 'before']);
      const newText = this.getStringField(change, ['newText', 'new_text', 'newString', 'new_string', 'after']);
      if (kind === 'add' && path && !newText && !oldText) {
        return { ...change, content: readTextFileBestEffort(path) };
      }
      return change;
    });
    return formatAceFileChangesResult({
      changes: hydrated,
      fallbackToolName: 'edit',
      fallbackTitle: getAceToolTitle('edit'),
    });
  }

  private async createCodexClient(Codex: any, options: EngineOptions, codexPathOverride?: string | null): Promise<any> {
    const clientEnv = buildConfiguredProcessEnvSync(
      undefined,
      process.env,
      options.userId ? { userId: options.userId } : undefined,
    );
    Object.assign(clientEnv, options.env || {});
    const mcpServers = options.mcpServers?.length
      ? toCodexMcpServers(options.mcpServers as any)
      : undefined;
    const apiKey = String(clientEnv.OPENAI_API_KEY || '').trim();
    const baseUrl = String(clientEnv.OPENAI_BASE_URL || '').trim().replace(/\/+$/, '');
    const config = {
      ...(baseUrl ? {
        model_provider: 'aceharness_openai_env',
        model_providers: {
          aceharness_openai_env: {
            name: 'ACEHarness OpenAI',
            base_url: baseUrl,
            wire_api: 'responses',
            requires_openai_auth: true,
          },
        },
      } : {}),
      ...(mcpServers && Object.keys(mcpServers).length > 0 ? { mcp_servers: mcpServers } : {}),
    };
    const codexOptions = {
      ...(codexPathOverride ? { codexPathOverride } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(baseUrl ? { baseUrl } : {}),
      ...(Object.keys(config).length > 0 ? { config } : {}),
      env: clientEnv,
    };

    return new Codex(codexOptions);
  }

  private getClientSignature(options: EngineOptions, codexPathOverride?: string | null): string {
    const env = buildConfiguredProcessEnvSync(
      undefined,
      process.env,
      options.userId ? { userId: options.userId } : undefined,
    );
    const credentialSignature = createHash('sha256')
      .update([
        env.OPENAI_API_KEY || '',
        env.OPENAI_BASE_URL || '',
      ].join('\0'))
      .digest('hex');
    return JSON.stringify({
      userId: options.userId || '',
      codexPathOverride: codexPathOverride || '',
      mcpServers: options.mcpServers || [],
      credentialSignature,
    });
  }

  private async runWithClient(Codex: any, options: EngineOptions, codexPathOverride?: string | null): Promise<EngineResult> {
    const clientSignature = this.getClientSignature(options, codexPathOverride);
    if (!this.codexInstance || codexPathOverride || this.lastClientSignature !== clientSignature) {
      this.clientSignatureChangedForRun = Boolean(this.codexInstance);
      this.codexInstance = await this.createCodexClient(Codex, options, codexPathOverride);
      this.currentThread = null;
      this.lastClientSignature = clientSignature;
    } else {
      this.clientSignatureChangedForRun = false;
    }

    // Create or reuse thread
    if (options.forceNewSession && !options.sessionId) {
      this.currentThread = null;
    }
    if (options.sessionId && !this.clientSignatureChangedForRun) {
      this.currentThread = this.codexInstance.resumeThread(
        options.sessionId,
        this.getThreadOptions(options),
      );
    } else if (!this.currentThread) {
      this.currentThread = this.codexInstance.startThread(this.getThreadOptions(options));
    }
    if (this.currentThread?.id) {
      this.emit('stream', {
        type: 'session',
        content: this.currentThread.id,
      } as EngineStreamEvent);
    }

    // Build prompt
    let fullPrompt = '';
    if (options.systemPrompt) {
      fullPrompt += `# System Instructions\n\n${options.systemPrompt}\n\n`;
    }
    fullPrompt += `# Task\n\n${options.prompt}`;

    // Stream events
    const { events } = await this.currentThread.runStreamed(fullPrompt, {
      signal: this._abortController!.signal,
    });

    let completionMetadata: EngineResultMetadata = ZERO_USAGE_METADATA;
    for await (const event of events) {
      switch (event.type) {
        case 'item.started': {
          const item = event.item;
          if (item.type === 'command_execution') {
            this.emitText(this.formatCommandExecution(item.command || ''));
            this.lastBlockWasTool = true;
          } else if (item.type === 'file_change') {
            const formatted = this.formatFileChanges((item as any).changes || []);
            if (formatted) {
              this.emitText(formatted);
              this.lastBlockWasTool = true;
            }
          }
          break;
        }
        case 'item.updated': {
          const item = event.item;
          if (item.type === 'agent_message') {
            const text = item.text || '';
            if (!text) break;
            let piece = text;
            if (this.lastAgentMessageSnapshot && text.startsWith(this.lastAgentMessageSnapshot)) {
              piece = text.slice(this.lastAgentMessageSnapshot.length);
            } else if (this.lastAgentMessageSnapshot === text) {
              piece = '';
            }
            if (piece) {
              const prefix = this.lastBlockWasTool && !piece.startsWith('\n')
                ? '\n\n<!-- chunk-boundary -->\n\n'
                : '';
              this.emitText(prefix + piece);
            }
            this.lastAgentMessageSnapshot = text;
            this.lastBlockWasTool = false;
          } else if (item.type === 'reasoning') {
            this.emit('stream', {
              type: 'thought',
              content: formatAceReasoning((item as any).text || ''),
            } as EngineStreamEvent);
          }
          break;
        }
        case 'item.completed': {
          const item = event.item;
          if (item.type === 'agent_message') {
            const text = item.text || '';
            let piece = text;
            if (this.lastAgentMessageSnapshot && text.startsWith(this.lastAgentMessageSnapshot)) {
              piece = text.slice(this.lastAgentMessageSnapshot.length);
            } else if (this.lastAgentMessageSnapshot === text) {
              piece = '';
            }
            if (piece) {
              const prefix = this.lastBlockWasTool && !piece.startsWith('\n')
                ? '\n\n<!-- chunk-boundary -->\n\n'
                : '';
              this.emitText(prefix + piece);
            }
            this.lastAgentMessageSnapshot = text;
            this.lastBlockWasTool = false;
          } else if (item.type === 'reasoning') {
            this.emit('stream', {
              type: 'thought',
              content: formatAceReasoning((item as any).text || ''),
            } as EngineStreamEvent);
          } else if (item.type === 'command_execution') {
            const formatted = this.formatCommandResult((item as any).aggregated_output || '', (item as any).exit_code, (item as any).command || '');
            if (formatted) this.emitText(formatted);
          } else if (item.type === 'file_change') {
            const formatted = this.formatFileChanges((item as any).changes || []);
            if (formatted) this.emitText(formatted);
          } else if (item.type === 'todo_list') {
            const items = (item as any).items || [];
            this.emitText(formatAceToolCall({
              toolName: 'todo',
              rawInput: {
                todos: Array.isArray(items)
                  ? items.map((t: any) => ({ content: t.text || '', status: t.completed ? 'completed' : 'pending' }))
                  : [],
              },
              title: getAceToolTitle('todo'),
            }));
          }
          break;
        }
        case 'error': {
          this.emit('stream', {
            type: 'error',
            content: event.message,
          } as EngineStreamEvent);
          break;
        }
        case 'turn.completed': {
          completionMetadata = metadataFromCodexEvent(event as Record<string, unknown>);
          break;
        }
        case 'turn.failed': {
          const errMsg = (event as any).error?.message || 'Unknown error';
          if (!isRecoverableMissingFileError(errMsg)) {
            this.emit('stream', {
              type: 'error',
              content: errMsg,
            } as EngineStreamEvent);
          }
          return {
            success: false,
            output: normalizeEngineOutput(this.collectedOutput),
            error: errMsg,
            metadata: ZERO_USAGE_METADATA,
          };
        }
      }
    }

    return {
      success: true,
      output: normalizeEngineOutput(this.collectedOutput),
      sessionId: this.currentThread?.id,
      metadata: completionMetadata,
    };
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    this._abortController = new AbortController();
    this.resetRunState();
    try {
      const { Codex } = await runtimeImport<typeof import('@openai/codex-sdk')>('@openai/codex-sdk');
      try {
        const firstResult = await this.runWithClient(Codex, options);
        if (!firstResult.success && isRecoverableMissingFileError(firstResult.error)) {
          this.emit('stream', {
            type: 'text',
            content: '\n\n检测到 Codex 读取的文件已不存在，已自动重试一次。\n\n',
          } as EngineStreamEvent);
          this.currentThread = null;
          this.resetRunState();
          const retryResult = await this.runWithClient(Codex, { ...options, forceNewSession: true });
          if (!retryResult.success && isRecoverableMissingFileError(retryResult.error)) {
            const output = normalizeEngineOutput(retryResult.output || this.collectedOutput || '');
            return {
              success: true,
              output,
              sessionId: this.currentThread?.id,
              metadata: retryResult.metadata || ZERO_USAGE_METADATA,
            };
          }
          return retryResult;
        }
        return firstResult;
      } catch (primaryError: any) {
        if (primaryError?.name === 'AbortError' || this._abortController?.signal.aborted) {
          throw primaryError;
        }
        const fallbackPath = this.findCodexFallbackPath();
        if (!fallbackPath) throw primaryError;
        this.codexInstance = null;
        this.currentThread = null;
        this.resetRunState();
        return await this.runWithClient(Codex, options, fallbackPath);
      }
    } catch (error: any) {
      // Abort is expected when cancel() is called
      if (error?.name === 'AbortError' || this._abortController?.signal.aborted) {
        return {
          success: true,
          output: normalizeEngineOutput(this.collectedOutput || ''),
          stopReason: 'cancelled',
          metadata: ZERO_USAGE_METADATA,
        };
      }
      const errMsg = error.message || String(error);
      if (isRecoverableMissingFileError(errMsg)) {
        return {
          success: true,
          output: normalizeEngineOutput(this.collectedOutput || ''),
          sessionId: this.currentThread?.id,
          metadata: ZERO_USAGE_METADATA,
        };
      }
      this.emit('stream', {
        type: 'text',
        content: `\n\n❌ Codex 错误: ${errMsg}\n`,
      } as EngineStreamEvent);
      return {
        success: false,
        output: '',
        error: errMsg,
        metadata: ZERO_USAGE_METADATA,
      };
    }
  }

  cancel(): void {
    try { this._abortController?.abort(); } catch {}
    this.currentThread = null;
  }

  cleanup(): void {
    this.cancel();
    this.codexInstance = null;
    this.removeAllListeners();
  }
}
