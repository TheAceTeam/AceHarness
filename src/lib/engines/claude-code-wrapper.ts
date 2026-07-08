/**
 * Claude Code Engine Wrapper
 *
 * Unified wrapper implementing the Engine interface for Claude Code.
 * Uses @anthropic-ai/claude-agent-sdk for all execution:
 * - permissionMode 'bypassPermissions'
 */

import { EventEmitter } from 'events';
import { accessSync, constants, existsSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import {
  buildConfiguredProcessEnvSync,
  getConfiguredCliSearchPaths,
  getConfiguredEnvValueSync,
} from '@/lib/core/configured-env';
import { fenced, htmlCodeBlock, formatLargeContent, formatTextContent } from '@/lib/core/markdown-utils';
import {
  appendToolIdToAceBlock,
  extractTextFromUnknown,
  formatAceReasoning,
  formatAceToolCall,
  formatAceToolResult,
  getAceToolTitle,
  resolveAceToolName,
} from '@/lib/chat/ace-process-formatters';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineChunk, normalizeEngineOutput } from './engine-output';
import { repairWindowsMojibake } from '@/lib/core/mojibake-repair';
import { readTextFileBestEffort } from '@/lib/core/text-decoding';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { toClaudeSdkMcpServers } from '@/lib/mcp/registry';
import { getRuntimePlatform, isLinux, isWindows } from '@/lib/core/runtime-platform';

const requireFromHere = createRequire(fileURLToPath(import.meta.url));

// ============================================================================
// Helpers
// ============================================================================

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

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('Aborted'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function metadataFromClaudeResult(result: Record<string, unknown>, resolvedModel?: string): EngineResultMetadata {
  const usage = result.usage && typeof result.usage === 'object' ? result.usage as Record<string, unknown> : {};
  return {
    usage: {
      input_tokens: numberOrZero(usage.input_tokens),
      output_tokens: numberOrZero(usage.output_tokens),
      cache_creation_input_tokens: numberOrZero(usage.cache_creation_input_tokens),
      cache_read_input_tokens: numberOrZero(usage.cache_read_input_tokens),
    },
    cost_usd: numberOrZero(result.cost_usd),
    duration_ms: numberOrZero(result.duration_ms),
    duration_api_ms: numberOrZero(result.duration_api_ms),
    num_turns: numberOrZero(result.num_turns),
    ...(resolvedModel ? { resolvedModel } : {}),
  };
}

function zeroUsageMetadata(resolvedModel?: string): EngineResultMetadata {
  return resolvedModel ? { ...ZERO_USAGE_METADATA, resolvedModel } : ZERO_USAGE_METADATA;
}

function looksLikeFatalClaudeErrorOutput(text: string): boolean {
  return /apierror/i.test(text)
    && (
      /context window limit/i.test(text)
      || /reached (its |the )?context window limit/i.test(text)
      || /maximum context length/i.test(text)
      || /prompt is too long/i.test(text)
    );
}

function parseToolJson(inputJson: string): Record<string, unknown> | null {
  if (!inputJson.trim()) return null;
  try {
    const parsed = JSON.parse(inputJson);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}
function toolPath(rawInput: Record<string, unknown>): string {
  const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.filepath ?? rawInput.file ?? rawInput.path;
  return typeof path === 'string' ? path : '';
}

function formatClaudeToolExecutionResult(toolNameRaw: string, result: unknown): string {
  const toolName = resolveAceToolName(toolNameRaw);
  if (!result || typeof result !== 'object') {
    const text = extractTextFromUnknown(result).trim();
    return text
      ? formatAceToolResult({
          toolName,
          rawOutput: { output: text },
          title: getAceToolTitle(toolName),
        })
      : '';
  }

  return formatAceToolResult({
    toolName,
    rawOutput: result,
    title: getAceToolTitle(toolName),
  });
}
function formatClaudeToolResult(toolNameRaw: string, inputJson: string): string {
  const rawInput = parseToolJson(inputJson) || {};
  const toolName = resolveAceToolName(toolNameRaw, rawInput);
  const p = toolPath(rawInput);
  const normalizedInput = {
    ...rawInput,
    filePath: p || rawInput.filePath || rawInput.path || '',
  } as Record<string, unknown>;
  if (!inputJson.trim() && Object.keys(normalizedInput).length === 0) {
    return formatAceToolCall({ toolName, rawInput: {}, title: getAceToolTitle(toolName) });
  }
  return formatAceToolCall({ toolName, rawInput: normalizedInput, title: getAceToolTitle(toolName) });
}

function formatClaudeToolBlock(toolNameRaw: string, inputJson: string, toolId?: string): string {
  const toolName = resolveAceToolName(toolNameRaw, parseToolJson(inputJson) || {}) || 'tool';
  return appendToolIdToAceBlock(formatClaudeToolResult(toolName, inputJson), toolId) || '\n';
}

function extractAssistantText(msg: unknown): string {
  return extractTextFromUnknown(msg);
}

function extractTextFromStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const e = ev as Record<string, unknown>;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (delta?.type === 'text_delta' && typeof delta.text === 'string') return delta.text;
  return '';
}

function extractThinkingFromStreamEvent(ev: unknown): string {
  if (!ev || typeof ev !== 'object') return '';
  const e = ev as Record<string, unknown>;
  const delta = e.delta as Record<string, unknown> | undefined;
  if (!delta) return '';

  if (typeof delta.thinking === 'string') return delta.thinking;
  if (typeof delta.text === 'string' && typeof delta.type === 'string' && delta.type.includes('thinking')) {
    return delta.text;
  }
  return '';
}

function isIgnorableClaudeSystemMessage(sys: { subtype?: string; message?: string }): boolean {
  const subtype = String(sys.subtype || '').trim().toLowerCase();
  const message = String(sys.message || '').trim().toLowerCase();
  const combined = `${subtype}\n${message}`;
  return subtype === 'task_started'
    || subtype === 'task_progress'
    || subtype === 'task_notification'
    || subtype === 'thinking_tokens'
    || /\bthinking[_\s-]?tokens?\b/.test(combined)
    || /\bthinking\s+token\s+accounting\b/.test(combined);
}

function buildCleanEnv(userId?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = buildConfiguredProcessEnvSync(
    undefined,
    process.env,
    userId ? { userId } : undefined,
  );
  const apiKey = String(env.ANTHROPIC_AUTH_TOKEN || '').trim();
  const baseUrl = String(env.ANTHROPIC_BASE_URL || env.CLAUDE_CODE_BASE_URL || env.CLAUDE_CODE_API_BASE_URL || '').trim().replace(/\/+$/, '');
  if (apiKey) {
    env.ANTHROPIC_AUTH_TOKEN = apiKey;
  }
  if (baseUrl) {
    env.ANTHROPIC_BASE_URL = baseUrl;
    env.CLAUDE_CODE_BASE_URL = baseUrl;
    env.CLAUDE_CODE_API_BASE_URL = baseUrl;
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  env.IS_SANDBOX = '1';
  return env;
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function hasRuntimeGlibc(): boolean {
  const report = process.report?.getReport?.() as unknown as { header?: { glibcVersionRuntime?: string } } | undefined;
  return Boolean(report?.header?.glibcVersionRuntime);
}

function resolveClaudeNativeBinary(): string | undefined {
  const envPath = getConfiguredEnvValueSync('ACE_CLAUDE_CODE_EXECUTABLE')
    || getConfiguredEnvValueSync('CLAUDE_CODE_EXECUTABLE');
  if (envPath && isExecutable(envPath)) return envPath;

  const suffix = isWindows() ? '.exe' : '';
  const packageNames = (() => {
    if (isLinux()) {
      const arch = process.arch;
      const glibc = hasRuntimeGlibc();
      const primary = glibc
        ? [`@anthropic-ai/claude-agent-sdk-linux-${arch}`]
        : [`@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`];
      const fallback = glibc
        ? [`@anthropic-ai/claude-agent-sdk-linux-${arch}-musl`]
        : [`@anthropic-ai/claude-agent-sdk-linux-${arch}`];
      return [...primary, ...fallback];
    }
    return [`@anthropic-ai/claude-agent-sdk-${getRuntimePlatform()}-${process.arch}`];
  })();

  for (const packageName of packageNames) {
    try {
      const candidate = requireFromHere.resolve(`${packageName}/claude${suffix}`);
      if (isExecutable(candidate)) return candidate;
    } catch {
      // Try next platform package.
    }
  }

  return findCommand('claude', getConfiguredCliSearchPaths(getCommonCliSearchPaths())) || undefined;
}
function formatElapsedSec(usageMs?: number, wallMs?: number): { text: string; sec: number } {
  const ms = usageMs ?? wallMs;
  if (ms == null || ms < 0) return { text: '?', sec: 0 };
  const sec = ms / 1000;
  const text = sec < 10 ? sec.toFixed(1) : String(Math.round(sec));
  return { text, sec };
}

function findResolvedModel(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^(claude-|sonnet|opus|haiku|default|best|opusplan)/.test(trimmed)) {
      return trimmed;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findResolvedModel(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['model', 'model_id', 'modelId', 'resolved_model', 'resolvedModel']) {
      const hit = findResolvedModel(record[key], depth + 1);
      if (hit) return hit;
    }
    for (const nested of Object.values(record)) {
      const hit = findResolvedModel(nested, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}
// ============================================================================
// ClaudeCodeEngineWrapper
// ============================================================================

export class ClaudeCodeEngineWrapper extends EventEmitter implements Engine {
  private _abortController: AbortController | null = null;
  private _abortReason: 'user' | 'timeout' | 'retry_limit' | 'unknown' | null = null;

  getName(): string { return 'claude-code'; }

  async isAvailable(): Promise<boolean> {
    try {
      await import('@anthropic-ai/claude-agent-sdk');
      return Boolean(resolveClaudeNativeBinary());
    } catch { return false; }
  }

  private abortWithReason(reason: 'user' | 'timeout' | 'retry_limit' | 'unknown'): void {
    this._abortReason = reason;
    try { this._abortController?.abort(); } catch {}
  }

  private getAbortMessage(timeoutMs: number): string {
    switch (this._abortReason) {
      case 'user':
        return 'Claude Code engine execution cancelled by user';
      case 'timeout':
        return `Claude Code engine execution timed out after ${timeoutMs}ms`;
      case 'retry_limit':
        return 'Claude Code engine execution aborted after SDK API retry limit was reached';
      default:
        return 'Claude Code engine execution aborted';
    }
  }

  cancel(): void {
    this.abortWithReason('user');
  }

  cleanup(): void {
    this.cancel();
    this.removeAllListeners();
  }

  // ---- Execute (unified SDK entry) ----

  async execute(options: EngineOptions): Promise<EngineResult> {
    console.log('[claude-code-sdk] execute start');
    this._abortController = new AbortController();
    this._abortReason = null;
    const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    const timer = setTimeout(() => {
      this.abortWithReason('timeout');
    }, timeoutMs);

    let accumulated = '';
    const emitText = (content: string) => {
      const normalized = normalizeEngineChunk(content, accumulated.length > 0);
      if (!normalized) return;
      accumulated += normalized;
      this.emit('stream', { type: 'text', content: normalized } as EngineStreamEvent);
    };
    const MAX_API_RETRY_ATTEMPTS = positiveIntFromEnv('ACE_CLAUDE_API_RETRY_ATTEMPTS', 12);
    const MIN_API_RETRY_DELAY_MS = positiveIntFromEnv('ACE_CLAUDE_API_RETRY_MIN_DELAY_MS', 10_000);
    const execStartedAt = Date.now();
    let firstDeltaAt = 0;
    let lastDeltaAt = 0;
    let lastProgressLogAt = 0;
    let deltaCount = 0;
    let deltaBytes = 0;
    let assistantTextBytesEmitted = 0;
    let assistantSnapshotCount = 0;
    const streamDebug = process.env.ACE_CHAT_STREAM_DEBUG === '1';
    const seenMsgTypes = new Set<string>();
    const seenSystemSubtypes = new Set<string>();
    const seenDeltaTypes = new Set<string>();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');

      // Build prompt
      const userFacingPrompt = options.systemPrompt?.trim()
        ? `# 系统指令\n${options.systemPrompt}\n\n---\n\n# 任务与上下文\n${options.prompt}`
        : options.prompt;

      // Build env
      const spawnEnv = buildCleanEnv(options.userId);
      Object.assign(spawnEnv, options.env || {});
      if (!spawnEnv.CLAUDE_CODE_MAX_RETRIES) {
        spawnEnv.CLAUDE_CODE_MAX_RETRIES = String(MAX_API_RETRY_ATTEMPTS);
      }

      // SDK query options
      const sdkOptions: Record<string, unknown> = {
        env: spawnEnv,
        cwd: options.workingDirectory,
        model: options.model || undefined,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
        abortController: this._abortController,
        maxTurns: 200,
      };

      const pathToClaudeCodeExecutable = resolveClaudeNativeBinary();
      if (pathToClaudeCodeExecutable) {
        sdkOptions.pathToClaudeCodeExecutable = pathToClaudeCodeExecutable;
      }

      if (options.sessionId) {
        (sdkOptions as any).resume = options.sessionId;
      }
      if (options.mcpServers?.length) {
        (sdkOptions as any).mcpServers = toClaudeSdkMcpServers(options.mcpServers as any);
      }

      const iter = query({ prompt: userFacingPrompt, options: sdkOptions as any });
      const streamToolBlocks = new Map<number, { id: string; name: string; inputJson: string }>();
      const toolCallsById = new Map<string, { name: string; inputJson: string }>();
      let capturedSessionId: string | undefined;
      let resolvedModel: string | undefined;
      let sawStreamEvent = false;
      let lastAssistantSnapshot = '';
      let lastBlockWasTool = false;

      for await (const msg of iter) {
        if (!resolvedModel) {
          resolvedModel = findResolvedModel(msg);
        }
        if (streamDebug) {
          const mt = String((msg as { type?: unknown })?.type || 'unknown');
          if (!seenMsgTypes.has(mt)) {
            seenMsgTypes.add(mt);
          }
        }
        // Capture session_id from any message
        if (!capturedSessionId && (msg as any).session_id) {
          capturedSessionId = (msg as any).session_id;
          this.emit('stream', {
            type: 'session',
            content: capturedSessionId,
          } as EngineStreamEvent);
        }
        if (msg.type === 'assistant') {
          assistantSnapshotCount += 1;
          // Some providers may not emit stream_event consistently.
          // In that case, use assistant snapshot as incremental stream source.
          if (!sawStreamEvent) {
            const snapshotText = extractAssistantText(msg as { message?: { content?: unknown } });
            if (snapshotText) {
              let piece = '';
              if (lastAssistantSnapshot && snapshotText.startsWith(lastAssistantSnapshot)) {
                piece = snapshotText.slice(lastAssistantSnapshot.length);
              } else if (!lastAssistantSnapshot) {
                piece = snapshotText;
              }
              if (piece) {
                const now = Date.now();
                deltaCount += 1;
                deltaBytes += Buffer.byteLength(piece, 'utf8');
                assistantTextBytesEmitted += Buffer.byteLength(piece, 'utf8');
                if (!firstDeltaAt) {
                  firstDeltaAt = now;
                } else if (lastDeltaAt && now - lastProgressLogAt >= 2000) {
                  lastProgressLogAt = now;
                }
                lastDeltaAt = now;
                const nextPiece = lastBlockWasTool && !piece.startsWith('\n') ? `\n\n${piece}` : piece;
                emitText(nextPiece);
                lastBlockWasTool = false;
              }
              lastAssistantSnapshot = snapshotText;
            }
          }
        } else if (msg.type === 'stream_event') {
          sawStreamEvent = true;
          const ev = (msg as { event?: unknown }).event;
          const streamEvent = (ev && typeof ev === 'object') ? (ev as Record<string, unknown>) : null;
          const eventType = String(streamEvent?.type || '');
          const eventIndex = Number(streamEvent?.index);
          if (streamDebug && ev && typeof ev === 'object') {
            const delta = (ev as Record<string, unknown>).delta as Record<string, unknown> | undefined;
            const dt = String(delta?.type || 'unknown');
            if (!seenDeltaTypes.has(dt)) {
              seenDeltaTypes.add(dt);
            }
          }
          if (eventType === 'content_block_start' && Number.isFinite(eventIndex)) {
            const contentBlock = streamEvent?.content_block as Record<string, unknown> | undefined;
            if (contentBlock?.type === 'tool_use') {
              const toolId = String(contentBlock.id || '');
              const toolName = String(contentBlock.name || 'tool');
              streamToolBlocks.set(eventIndex, { id: toolId, name: toolName, inputJson: '' });
            }
          } else if (eventType === 'content_block_delta' && Number.isFinite(eventIndex)) {
            const delta = streamEvent?.delta as Record<string, unknown> | undefined;
            if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              const tool = streamToolBlocks.get(eventIndex);
              if (tool) {
                tool.inputJson += delta.partial_json;
                streamToolBlocks.set(eventIndex, tool);
              }
            }
          } else if (eventType === 'content_block_stop' && Number.isFinite(eventIndex)) {
            const tool = streamToolBlocks.get(eventIndex);
            if (tool) {
              if (tool.id) {
                toolCallsById.set(tool.id, { name: tool.name, inputJson: tool.inputJson });
              }
              const block = formatClaudeToolBlock(tool.name, tool.inputJson, tool.id);
              emitText(block);
              lastBlockWasTool = true;
              streamToolBlocks.delete(eventIndex);
            }
          }
          const thinkingPiece = extractThinkingFromStreamEvent(ev);
            if (thinkingPiece) {
              this.emit('stream', {
                type: 'thought',
                content: formatAceReasoning(thinkingPiece),
              } as EngineStreamEvent);
            }
          const piece = extractTextFromStreamEvent(ev);
          if (piece) {
            const now = Date.now();
            deltaCount += 1;
            deltaBytes += Buffer.byteLength(piece, 'utf8');
            assistantTextBytesEmitted += Buffer.byteLength(piece, 'utf8');
            if (!firstDeltaAt) {
              firstDeltaAt = now;
            } else if (lastDeltaAt && now - lastProgressLogAt >= 2000) {
              lastProgressLogAt = now;
            }
            lastDeltaAt = now;
            const nextPiece = lastBlockWasTool && !piece.startsWith('\n') ? `\n\n${piece}` : piece;
            emitText(nextPiece);
            lastBlockWasTool = false;
          }
        } else if (msg.type === 'tool_progress') {
          continue;
        } else if (msg.type === 'system') {
          const sys = msg as { subtype?: string; message?: string; tool_name?: string };
          if (streamDebug) {
            const st = String(sys.subtype || 'unknown');
            if (!seenSystemSubtypes.has(st)) {
              seenSystemSubtypes.add(st);
            }
          }
          if (isIgnorableClaudeSystemMessage(sys)) {
            continue;
          }
          let info = '';
          if (sys.subtype === 'api_retry') {
            const retry = msg as { attempt?: number; retry_delay_ms?: number; message?: string };
            const attempt = Number(retry.attempt || 0);
            if (attempt >= MAX_API_RETRY_ATTEMPTS) {
              this.abortWithReason('retry_limit');
              throw new Error(`SDK API retry limit reached (${MAX_API_RETRY_ATTEMPTS} attempts), request aborted`);
            }
            const sdkDelayMs = Number(retry.retry_delay_ms || 0);
            const extraDelayMs = Math.max(0, MIN_API_RETRY_DELAY_MS - sdkDelayMs);
            if (extraDelayMs > 0) {
              await delayWithAbort(extraDelayMs, this._abortController?.signal);
            }
            // Hide SDK retry noise from end-user stream output.
            continue;
          } else if (
            sys.subtype === 'init' ||
            sys.subtype === 'session_start' ||
            sys.subtype === 'status' ||
            sys.subtype === 'hook_started' ||
            sys.subtype === 'hook_response'
          ) {
            if (sys.subtype === 'hook_started' || sys.subtype === 'hook_response') {
              console.debug('[ClaudeCode SDK hook]', {
                subtype: sys.subtype,
                message: sys.message,
                toolName: sys.tool_name,
              });
            }
            // Skip SDK lifecycle noise — not useful for end-user output
          } else if (sys.message) {
            info = `[SDK] ${sys.subtype ?? 'system'}: ${sys.message}`;
          } else if (sys.subtype) {
            info = `[SDK] ${sys.subtype}`;
          }
          if (info) {
            emitText(`\n${info}\n`);
          }
        } else if (msg.type === 'user') {
          const userMsg = msg as { parent_tool_use_id?: string | null; tool_use_result?: unknown };
          const toolUseId = typeof userMsg.parent_tool_use_id === 'string' ? userMsg.parent_tool_use_id : '';
          if (toolUseId && userMsg.tool_use_result !== undefined) {
            const tool = toolCallsById.get(toolUseId);
            const rendered = formatClaudeToolExecutionResult(tool?.name || '', userMsg.tool_use_result);
            if (rendered) {
              emitText(rendered);
              lastBlockWasTool = false;
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            const r = msg as { result?: string; session_id?: string } & Record<string, unknown>;
            const resultText = r.result ?? '';
            const streamedHasAssistantText = assistantTextBytesEmitted > 0;
            const finalOutput = streamedHasAssistantText
              ? (accumulated || resultText)
              : (resultText || accumulated);
            if (looksLikeFatalClaudeErrorOutput(finalOutput)) {
              console.error('[claude-code-sdk] execute failed: fatal API error in result payload');
              return {
                success: false,
                output: normalizeEngineOutput(finalOutput),
                error: finalOutput.trim() || 'Claude Code fatal API error',
              };
            }
            console.log(`[claude-code-sdk] execute completed: sessionId=${r.session_id || capturedSessionId || ''}, outputLength=${finalOutput.length}`);
            return {
              success: true,
              output: normalizeEngineOutput(finalOutput),
              sessionId: r.session_id || capturedSessionId,
              metadata: metadataFromClaudeResult(r, resolvedModel),
            };
          }
          const err = msg as { errors?: string[] };
          return {
            success: false,
            output: normalizeEngineOutput(accumulated),
            error: err.errors?.join('; ') || 'SDK execution failed',
          };
        }
      }

      return {
        success: !looksLikeFatalClaudeErrorOutput(accumulated),
        output: normalizeEngineOutput(accumulated),
        sessionId: capturedSessionId,
        metadata: zeroUsageMetadata(resolvedModel),
        ...(looksLikeFatalClaudeErrorOutput(accumulated)
          ? { error: accumulated.trim() || 'Claude Code fatal API error' }
          : {}),
      };
    } catch (e: unknown) {
      const isAborted = this._abortController?.signal.aborted;
      console.error(`[claude-code-sdk] execute failed: ${isAborted ? this.getAbortMessage(timeoutMs) : (e instanceof Error ? e.message : String(e))}`);
      return {
        success: false,
        output: normalizeEngineOutput(accumulated),
        error: isAborted ? this.getAbortMessage(timeoutMs) : (e instanceof Error ? e.message : String(e)),
      };
    } finally {
      clearTimeout(timer);
      this._abortController = null;
      this._abortReason = null;
    }
  }

}
