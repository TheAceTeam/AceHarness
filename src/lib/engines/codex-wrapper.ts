/**
 * Codex Engine Wrapper
 *
 * Uses @openai/codex-sdk to run Codex CLI as an engine.
 * Streams JSONL events (agent_message, command_execution, etc.)
 */

import { EventEmitter } from 'events';
import { existsSync, statSync } from 'fs';
import { createRequire } from 'module';
import { extname } from 'path';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineChunk, normalizeEngineOutput } from './engine-output';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { htmlCodeBlock, formatLargeContent, formatTextContent } from '@/lib/core/markdown-utils';
import { repairWindowsMojibake } from '@/lib/core/mojibake-repair';
import { readTextFileBestEffort } from '@/lib/core/text-decoding';
import { loadEnvVars, buildEnvObject } from '@/lib/core/env-manager';
import { isWindows } from '@/lib/core/runtime-platform';

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

export class CodexEngineWrapper extends EventEmitter implements Engine {
  private static readonly MAX_INLINE_FILE_BYTES = 64 * 1024;
  private static readonly MAX_INLINE_FILE_LINES = 400;
  private currentThread: any = null;
  private codexInstance: any = null;
  private _abortController: AbortController | null = null;
  private lastBlockWasTool = false;

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
    const resolved = findCommand('codex', getCommonCliSearchPaths());
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

  private formatCommandExecution(command: string): string {
    const cmd = command || '';
    const cmdLines = cmd.split('\n');
    const summary = cmdLines.length <= 1
      ? '查看命令'
      : `查看命令 (${cmdLines.length} 行)`;
    return `\n\n**💻 执行命令**\n\n<details><summary>${summary}</summary>\n\n${htmlCodeBlock(cmd, 'bash')}\n\n</details>\n`;
  }

  private formatCommandResult(output: string, exitCode?: number): string {
    let resultText = repairWindowsMojibake((output || '').trim());
    if (exitCode !== 0 && exitCode != null) {
      resultText += resultText ? `\n(exit code: ${exitCode})` : `(exit code: ${exitCode})`;
    }
    if (!resultText) return '';
    return formatTextContent(resultText, { summaryLabel: '查看输出' });
  }

  private getStringField(source: any, keys: string[]): string {
    for (const key of keys) {
      if (typeof source?.[key] === 'string' && source[key].length > 0) {
        return source[key];
      }
    }
    return '';
  }

  private buildUnifiedDiff(oldText: string, newText: string): string {
    const removed = oldText
      ? oldText.split('\n').map((line) => `- ${line}`).join('\n') + '\n'
      : '';
    const added = newText
      ? newText.split('\n').map((line) => `+ ${line}`).join('\n') + '\n'
      : '';
    return `${removed}${added}`.trimEnd();
  }

  private inferFenceLanguage(path: string): string {
    const ext = extname(path).toLowerCase();
    const map: Record<string, string> = {
      '.ts': 'ts',
      '.tsx': 'tsx',
      '.js': 'js',
      '.jsx': 'jsx',
      '.json': 'json',
      '.md': 'md',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.css': 'css',
      '.html': 'html',
      '.sh': 'bash',
      '.bash': 'bash',
      '.zsh': 'bash',
      '.cj': 'text',
      '.c': 'c',
      '.cc': 'cpp',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.py': 'python',
      '.toml': 'toml',
      '.xml': 'xml',
    };
    return map[ext] || 'text';
  }

  private readAddedFilePreview(path: string): string {
    try {
      if (!existsSync(path)) return '';
      const stats = statSync(path);
      if (!stats.isFile()) return '';
      if (stats.size > CodexEngineWrapper.MAX_INLINE_FILE_BYTES) {
        return `\n📎 文件较大，点击打开查看: [${path}](${path})\n`;
      }
      const content = readTextFileBestEffort(path);
      if (content.includes('\u0000')) {
        return '\n<details><summary>查看文件内容</summary>\n\n疑似二进制文件，已跳过内联预览。\n\n</details>\n';
      }
      return formatTextContent(content, { filePath: path, lang: this.inferFenceLanguage(path), summaryLabel: '查看文件内容' });
    } catch {
      return '';
    }
  }

  private formatSingleFileChange(change: any): string {
    const path = this.getStringField(change, ['path', 'filePath', 'file_path']) || '(未知路径)';
    const kind = this.getStringField(change, ['kind', 'type', 'action']) || 'update';
    const oldText = this.getStringField(change, ['oldText', 'old_text', 'oldString', 'old_string', 'before']);
    const newText = this.getStringField(change, ['newText', 'new_text', 'newString', 'new_string', 'after']);

    if (newText && !oldText) {
      const lines = newText.split('\n').length;
      let out = `\n📝 写入文件: \`${path}\` (${lines} 行)\n`;
      out += formatLargeContent(this.buildUnifiedDiff('', newText), { filePath: path, lang: 'diff', summaryLabel: '查看变更' });
      return out;
    }

    if (oldText || newText) {
      const oldLines = oldText ? oldText.split('\n').length : 0;
      const newLines = newText ? newText.split('\n').length : 0;
      const added = Math.max(0, newLines - oldLines);
      const removed = Math.max(0, oldLines - newLines);
      let stats = `${Math.min(oldLines, newLines)} 行修改`;
      if (added > 0) stats += `, +${added} 行`;
      if (removed > 0) stats += `, -${removed} 行`;
      let out = `\n✏️ 编辑文件: \`${path}\` (${stats})\n`;
      out += formatLargeContent(this.buildUnifiedDiff(oldText, newText), { filePath: path, lang: 'diff', summaryLabel: `查看变更 (${stats})` });
      return out;
    }

    if (kind === 'add') {
      let out = `\n📝 文件变更: \`${path}\` (${kind})\n`;
      out += this.readAddedFilePreview(path);
      return out;
    }

    return `\n📝 文件变更: \`${path}\` (${kind})\n`;
  }

  private formatFileChanges(changes: any[]): string {
    if (!Array.isArray(changes) || changes.length === 0) return '';
    const parts = changes
      .map((change) => this.formatSingleFileChange(change))
      .filter(Boolean);
    if (parts.length === 0) return '';
    return `\n\n**📝 文件变更**\n${parts.join('')}`;
  }

  private async createCodexClient(Codex: any, codexPathOverride?: string | null): Promise<any> {
    // Load user-configured environment variables
    const clientEnv = { ...process.env };
    try {
      const userEnvVars = await loadEnvVars();
      const userEnv = buildEnvObject(userEnvVars);
      Object.assign(clientEnv, userEnv);
    } catch {
      // Ignore env loading errors
    }

    return codexPathOverride
      ? new Codex({ codexPathOverride, env: clientEnv })
      : new Codex({ env: clientEnv });
  }

  private async runWithClient(Codex: any, options: EngineOptions, codexPathOverride?: string | null): Promise<EngineResult> {
    if (!this.codexInstance || codexPathOverride) {
      this.codexInstance = await this.createCodexClient(Codex, codexPathOverride);
      this.currentThread = null;
    }

    // Create or reuse thread
    if (options.sessionId) {
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
              content: (item as any).text || '',
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
              content: (item as any).text || '',
            } as EngineStreamEvent);
          } else if (item.type === 'command_execution') {
            const formatted = this.formatCommandResult((item as any).aggregated_output || '', (item as any).exit_code);
            if (formatted) this.emitText(formatted);
          } else if (item.type === 'file_change') {
            const formatted = this.formatFileChanges((item as any).changes || []);
            if (formatted) this.emitText(formatted);
          } else if (item.type === 'todo_list') {
            const items = (item as any).items || [];
            if (items.length > 0) {
              const done = items.filter((t: any) => t.completed).length;
              const todoHeader = `📋 任务列表 (${done}/${items.length} 完成)`;
              let content = `\n<!-- todo-list-marker -->\n<div class="ace-todo-list">\n<div class="ace-todo-header">${todoHeader}</div>\n`;
              content += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${Math.round((done / items.length) * 100)}%"></div></div>\n`;
              for (const t of items) {
                const icon = t.completed ? '✅' : '⬜';
                const cls = t.completed ? 'ace-todo-done' : 'ace-todo-pending';
                content += `<div class="ace-todo-item ${cls}">${icon} ${t.text}</div>\n`;
              }
              content += `</div>\n`;
              this.emitText(content);
            }
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
          this.emit('stream', {
            type: 'error',
            content: errMsg,
          } as EngineStreamEvent);
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
    this.collectedOutput = '';
    this.lastBlockWasTool = false;
    this.lastAgentMessageSnapshot = '';
    try {
      const { Codex } = await runtimeImport<typeof import('@openai/codex-sdk')>('@openai/codex-sdk');
      try {
        return await this.runWithClient(Codex, options);
      } catch (primaryError: any) {
        if (primaryError?.name === 'AbortError' || this._abortController?.signal.aborted) {
          throw primaryError;
        }
        const fallbackPath = this.findCodexFallbackPath();
        if (!fallbackPath) throw primaryError;
        this.codexInstance = null;
        this.currentThread = null;
        this.collectedOutput = '';
        this.lastBlockWasTool = false;
        this.lastAgentMessageSnapshot = '';
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
