/**
 * Codex Engine Wrapper
 *
 * Uses @openai/codex-sdk to run Codex CLI as an engine.
 * Streams JSONL events (agent_message, command_execution, etc.)
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, join } from 'path';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { commandExists } from '../command-exists';
import { fenced, formatLargeContent } from '../markdown-utils';

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
      await import('@openai/codex-sdk');
    } catch { return false; }
    return commandExists('codex', this.getCodexSearchPaths());
  }

  private getCodexSearchPaths(): string[] {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const candidates = process.platform === 'win32'
      ? [
          home ? join(home, 'AppData', 'Roaming', 'npm') : '',
          home ? join(home, '.local', 'bin') : '',
        ]
      : [
          home ? join(home, '.local', 'bin') : '',
          '/usr/local/bin',
          '/usr/bin',
        ];
    return candidates.filter(Boolean);
  }

  /** Locate the codex CLI binary — cross-platform PATH + common install locations. */
  private findCodexPath(): string | null {
    const pathValue = process.env.PATH || '';
    const pathDirs = pathValue
      .split(process.platform === 'win32' ? ';' : ':')
      .filter(Boolean);
    const pathext = process.platform === 'win32'
      ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map((ext) => ext.trim())
        .filter(Boolean)
      : [''];
    const names = process.platform === 'win32'
      ? ['codex', ...pathext.map((ext) => `codex${ext}`)]
      : ['codex'];

    for (const dir of [...this.getCodexSearchPaths(), ...pathDirs]) {
      for (const name of names) {
        const fullPath = join(dir, name);
        if (existsSync(fullPath)) return fullPath;
      }
    }
    return null;
  }

  private emitText(content: string, appendToOutput = true): void {
    if (!content) return;
    if (appendToOutput) this.collectedOutput += content;
    this.emit('stream', {
      type: 'text',
      content,
    } as EngineStreamEvent);
  }

  private collectedOutput = '';

  private formatCommandExecution(command: string): string {
    const cmd = command || '';
    const cmdLines = cmd.split('\n');
    const summary = cmdLines.length <= 1
      ? '💻 执行命令'
      : `💻 执行命令 (${cmdLines.length} 行)`;
    return `\n\n**🔧 bash**\n\n<details><summary>${summary}</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
  }

  private formatCommandResult(output: string, exitCode?: number): string {
    let resultText = (output || '').trim();
    if (exitCode !== 0 && exitCode != null) {
      resultText += resultText ? `\n(exit code: ${exitCode})` : `(exit code: ${exitCode})`;
    }
    if (!resultText) return '';
    return formatLargeContent(resultText, { summaryLabel: '查看输出' });
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
      const content = readFileSync(path, 'utf-8');
      if (content.includes('\u0000')) {
        return '\n<details><summary>查看文件内容</summary>\n\n疑似二进制文件，已跳过内联预览。\n\n</details>\n';
      }
      return formatLargeContent(content, { filePath: path, lang: this.inferFenceLanguage(path), summaryLabel: '查看文件内容' });
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

  async execute(options: EngineOptions): Promise<EngineResult> {
    this._abortController = new AbortController();
    this.collectedOutput = '';
    this.lastBlockWasTool = false;
    try {
      const { Codex } = await import('@openai/codex-sdk');

      if (!this.codexInstance) {
        const codexPath = this.findCodexPath();
        this.codexInstance = new Codex(codexPath ? { codexPathOverride: codexPath } : {});
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
          case 'item.completed': {
            const item = event.item;
            if (item.type === 'agent_message') {
              const text = item.text || '';
              const prefix = this.lastBlockWasTool && !text.startsWith('\n')
                ? '\n\n<!-- chunk-boundary -->\n\n'
                : '';
              this.emitText(prefix + text);
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
              output: this.collectedOutput,
              error: errMsg,
              metadata: ZERO_USAGE_METADATA,
            };
          }
        }
      }

      return {
        success: true,
        output: this.collectedOutput,
        sessionId: this.currentThread?.id,
        metadata: completionMetadata,
      };
    } catch (error: any) {
      // Abort is expected when cancel() is called
      if (error?.name === 'AbortError' || this._abortController?.signal.aborted) {
        return {
          success: true,
          output: this.collectedOutput || '',
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
