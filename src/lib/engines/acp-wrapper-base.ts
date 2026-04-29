/**
 * Base ACP Wrapper
 *
 * Common wrapper implementation for all ACP-compatible engines.
 * Each engine (opencode, kiro-cli, cursor) will extend this base class.
 * Event handling mirrors OpenCodeEngineWrapper for consistent UI rendering.
 */

import { EventEmitter } from 'events';
import { ACPEngine, ACPEngineConfig } from './acp-engine';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { fenced, formatLargeContent } from '../markdown-utils';

export abstract class ACPWrapperBase extends EventEmitter implements Engine {
  protected engine: ACPEngine | null = null;
  protected currentSessionId: string | null = null;
  protected lastBlockWasTool = false;
  protected seenToolIds = new Set<string>();
  protected streaming = false;
  protected collectedOutput = '';

  abstract getName(): string;
  protected abstract getACPConfig(options: EngineOptions): ACPEngineConfig;
  abstract isAvailable(): Promise<boolean>;

  async execute(options: EngineOptions): Promise<EngineResult> {
    try {
      this.seenToolIds.clear();
      this.lastBlockWasTool = false;
      this.collectedOutput = '';

      // Reuse existing engine if resuming a session, otherwise create new
      const canReuse = options.sessionId && this.engine && this.currentSessionId === options.sessionId;
      if (!canReuse) {
        // Stop previous engine if any
        if (this.engine) {
          try { await this.engine.stop(); } catch {}
        }
        const config = this.getACPConfig(options);
        this.engine = new ACPEngine(config);
        this.setupEngineEvents();
        await this.engine.start();

        if (options.sessionId) {
          this.currentSessionId = await this.engine.resumeSession(options.sessionId);
        } else {
          this.currentSessionId = await this.engine.createSession();
        }
      }

      const engine = this.engine;
      if (!engine) {
        throw new Error(`[${this.getName()}] engine not initialized`);
      }

      if (options.model) {
        try {
          await engine.setModel(options.model);
        } catch (modelErr: any) {
          // Emit the error to the stream so the user sees available models in the UI
          this.emit('stream', {
            type: 'text',
            content: `\n\n❌ 模型不可用: ${modelErr.message}\n`,
          } as EngineStreamEvent);
          return {
            success: false,
            output: '',
            error: modelErr.message,
          };
        }
      }

      this.streaming = true;
      console.log(`[${this.getName()}] calling sendPrompt...`);
      const stopReason = await engine.sendPrompt(options.prompt);
      console.log(`[${this.getName()}] sendPrompt returned: stopReason=${stopReason}`);
      this.streaming = false;

      // Treat end_turn and undefined/null (normal completion) as success
      const isSuccess = !stopReason || stopReason === 'end_turn';

      return {
        success: isSuccess,
        output: this.collectedOutput.trim(),
        sessionId: this.currentSessionId ?? undefined,
        stopReason
      };
    } catch (error) {
      this.streaming = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      const hasUsableOutput = this.collectedOutput.trim().length > 0;
      const isConnectionClosed = /connection\s+closed/i.test(errorMessage);

      // Some ACP engines may close the connection right after streaming final output.
      // In this case, treat the run as successful if we already captured non-empty content.
      if (isConnectionClosed && hasUsableOutput) {
        return {
          success: true,
          output: this.collectedOutput.trim(),
          sessionId: this.currentSessionId ?? undefined,
          stopReason: 'end_turn',
        };
      }

      return {
        success: false,
        output: '',
        error: errorMessage
      };
    }
  }

  cancel(): void {
    if (this.engine) {
      this.engine.cancelSession();
      this.engine.stop();
      this.engine = null;
    }
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
      this.collectedOutput += prefix + text;
      this.emit('stream', { type: 'text', content: prefix + text } as EngineStreamEvent);
    });

    this.engine.on('agent-thought', (content) => {
      if (!this.streaming) return;
      const text = this.extractText(content);
      if (text) {
        this.emit('stream', { type: 'thought', content: text } as EngineStreamEvent);
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
        this.collectedOutput += formatted;
        this.emit('stream', { type: 'text', content: formatted, metadata: toolCall } as EngineStreamEvent);
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
          this.collectedOutput += formatted;
          this.emit('stream', { type: 'text', content: formatted, metadata: toolUpdate } as EngineStreamEvent);
        }
      }

      if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
        let resultText = '';
        if (toolUpdate.rawOutput) {
          resultText = this.extractToolOutput(toolUpdate.rawOutput);
        } else if (Array.isArray(toolUpdate.content)) {
          const raw = toolUpdate.content
            .filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
          resultText = this.extractToolOutput(raw);
        } else if (typeof toolUpdate.content === 'string') {
          resultText = this.extractToolOutput(toolUpdate.content);
        }
        const formatted = this.formatToolResult(resultText, toolUpdate);
        if (formatted) {
          this.collectedOutput += formatted;
          this.emit('stream', { type: 'text', content: formatted, metadata: toolUpdate } as EngineStreamEvent);
        }
      }
    });

    this.engine.on('log', () => { /* skip */ });

    this.engine.on('error', (error) => {
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

  /**
   * Extract human-readable text from rawOutput.
   * Handles structured objects like { output, exit, error, description, truncated }
   * instead of dumping raw JSON.
   */
  protected extractToolOutput(raw: any): string {
    if (typeof raw === 'string') return raw;
    if (!raw || typeof raw !== 'object') return '';
    // Structured command result: { output, exit, error, description, ... }
    if ('output' in raw && typeof raw.output === 'string') {
      let text = raw.output;
      if (raw.exit !== undefined && raw.exit !== 0) {
        text += text ? `\n(exit code: ${raw.exit})` : `exit code: ${raw.exit}`;
      }
      return text;
    }
    if ('error' in raw && raw.error) return String(raw.error);
    if ('content' in raw && typeof raw.content === 'string') return raw.content;
    // Search results
    if ('totalMatches' in raw) return `找到 ${raw.totalMatches} 个匹配${raw.truncated ? ' (已截断)' : ''}`;
    if ('totalFiles' in raw) return `找到 ${raw.totalFiles} 个文件${raw.truncated ? ' (已截断)' : ''}`;
    // Fallback: compact JSON
    return JSON.stringify(raw);
  }

  protected resolveToolName(toolCall: any): string {
    const title = (toolCall.title || '').toLowerCase();
    const rawInput = toolCall.rawInput || {};
    const knownTools = ['bash', 'write', 'edit', 'read', 'glob', 'grep', 'task',
      'todowrite', 'todo', 'webfetch', 'websearch', 'ls', 'multiedit', 'patch'];
    if (knownTools.includes(title)) return title;
    if ('command' in rawInput) return 'bash';
    if ('content' in rawInput && 'filePath' in rawInput && !('oldString' in rawInput)) return 'write';
    if ('oldString' in rawInput || 'newString' in rawInput) return 'edit';
    if ('todos' in rawInput) return 'todowrite';
    if ('pattern' in rawInput && 'include' in rawInput) return 'grep';
    if ('pattern' in rawInput) return 'glob';
    if ('description' in rawInput && 'prompt' in rawInput) return 'task';
    if ('url' in rawInput) return 'webfetch';
    if ('query' in rawInput) return 'websearch';
    if ('filePath' in rawInput) return 'read';
    return title || 'tool';
  }
/* PLACEHOLDER_FORMAT */

  protected formatToolCall(toolCall: any): string {
    const toolName = this.resolveToolName(toolCall);
    const rawInput = toolCall.rawInput || {};
    let header = `\n\n**🔧 ${toolCall.title || toolName}**\n`;

    switch (toolName) {
      case 'bash': {
        const cmd = rawInput.command || '';
        if (cmd) {
          const cmdLines = cmd.split('\n');
          if (cmdLines.length <= 1 && cmd.length <= 120) {
            header += `\n💻 执行命令: \`${cmd}\`\n`;
          } else {
            header += `\n💻 执行命令 (${cmdLines.length} 行)\n`;
            header += `\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
          }
        }
        break;
      }
      case 'write': {
        const wPath = rawInput.filePath || '';
        const wContent = rawInput.content || '';
        const wLines = wContent ? wContent.split('\n').length : 0;
        header += `\n📝 写入文件: \`${wPath}\` (${wLines} 行)\n`;
        if (wContent) {
          const ext = wPath.split('.').pop() || '';
          header += formatLargeContent(wContent, { filePath: wPath, lang: ext, summaryLabel: '查看内容' });
        }
        break;
      }
      case 'edit':
      case 'multiedit':
      case 'patch': {
        const filePath = rawInput.filePath || '';
        const oldStr = rawInput.oldString || '';
        const newStr = rawInput.newString || '';
        const oldLines = oldStr ? oldStr.split('\n').length : 0;
        const newLines = newStr ? newStr.split('\n').length : 0;
        const added = Math.max(0, newLines - oldLines);
        const removed = Math.max(0, oldLines - newLines);
        let stats = `${Math.min(oldLines, newLines)} 行修改`;
        if (added > 0) stats += `, +${added} 行`;
        if (removed > 0) stats += `, -${removed} 行`;
        header += `\n✏️ 编辑文件: \`${filePath}\` (${stats})\n`;
        if (oldStr || newStr) {
          const diff = (oldStr ? oldStr.split('\n').map((l: string) => '- ' + l).join('\n') + '\n' : '')
            + (newStr ? newStr.split('\n').map((l: string) => '+ ' + l).join('\n') + '\n' : '');
          header += formatLargeContent(diff.trimEnd(), { filePath, lang: 'diff', summaryLabel: `查看变更 (${stats})` });
        }
        break;
      }
      case 'read':
        header += `\n📖 读取文件: \`${rawInput.filePath || ''}\`\n`;
        break;
      case 'glob':
        header += `\n🔍 搜索文件: \`${rawInput.pattern || ''}\`\n`;
        break;
      case 'grep':
        header += `\n🔍 搜索内容: \`${rawInput.pattern || ''}\`\n`;
        break;
      case 'ls':
        header += `\n📂 列出目录: \`${rawInput.path || '.'}\`\n`;
        break;
      case 'task':
        header += `\n🤖 启动子任务: ${rawInput.description || ''}\n`;
        break;
      case 'todowrite':
      case 'todo': {
        const todos = rawInput.todos || rawInput.items || [];
        if (Array.isArray(todos) && todos.length > 0) {
          const done = todos.filter((t: any) => t.status === 'completed' || t.status === 'done').length;
          const inProg = todos.filter((t: any) => t.status === 'in_progress' || t.status === 'in-progress').length;
          const todoHeader = `📋 任务列表 (${done}/${todos.length} 完成${inProg ? `, ${inProg} 进行中` : ''})`;
          header = `\n<!-- todo-list-marker -->\n<div class="ace-todo-list">\n<div class="ace-todo-header">${todoHeader}</div>\n`;
          header += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${Math.round(((done + inProg * 0.5) / todos.length) * 100)}%"></div></div>\n`;
          for (const t of todos) {
            const st = t.status || 'pending';
            const icon = st === 'completed' || st === 'done' ? '✅' : st === 'in_progress' || st === 'in-progress' ? '🔄' : '⬜';
            const cls = st === 'completed' || st === 'done' ? 'ace-todo-done' : st === 'in_progress' || st === 'in-progress' ? 'ace-todo-active' : 'ace-todo-pending';
            header += `<div class="ace-todo-item ${cls}">${icon} ${t.content || ''}</div>\n`;
          }
          header += `</div>\n`;
        } else {
          header = `\n<!-- todo-list-marker -->\n📋 任务列表更新中...\n`;
        }
        break;
      }
      case 'webfetch':
        header += `\n🌐 获取网页: \`${rawInput.url || ''}\`\n`;
        break;
      case 'websearch':
        header += `\n🔎 搜索: \`${rawInput.query || ''}\`\n`;
        break;
    }
    return header;
  }

  protected formatToolResult(output: string, _metadata: any): string {
    if (!output) return '';
    const parsed = this.parseToolXmlOutput(output);
    if (parsed) return parsed;
    return formatLargeContent(output, { summaryLabel: '查看输出' });
  }

  private parseToolXmlOutput(output: string): string | null {
    const taskMatch = output.match(/<task_result>([\s\S]*?)<\/task_result>/);
    if (taskMatch) {
      const inner = taskMatch[1].trim();
      return formatLargeContent(inner, { summaryLabel: '🤖 子任务结果' });
    }
    const pathRegex = /<path>(.*?)<\/path>\s*(?:<type>.*?<\/type>\s*)?<content>([\s\S]*?)<\/content>/g;
    let match;
    const blocks: string[] = [];
    while ((match = pathRegex.exec(output)) !== null) {
      const fp = match[1].trim();
      const ct = match[2].trim();
      const ext = fp.split('.').pop() || '';
      blocks.push(formatLargeContent(ct, { filePath: fp, lang: ext, summaryLabel: `📄 ${fp}` }));
    }
    if (blocks.length > 0) return blocks.join('');
    return null;
  }
}
