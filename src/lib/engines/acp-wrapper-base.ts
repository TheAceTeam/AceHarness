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
import { htmlCodeBlock, formatLargeContent, formatTextContent } from '@/lib/core/markdown-utils';

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

  abstract getName(): string;
  protected abstract getACPConfig(options: EngineOptions): ACPEngineConfig;
  abstract isAvailable(): Promise<boolean>;

  async execute(options: EngineOptions): Promise<EngineResult> {
    const timingLabel = this.getName();
    const tExecute = Date.now();
    try {
      this.seenToolIds.clear();
      this.lastBlockWasTool = false;
      this.collectedOutput = '';

      // Reuse existing engine if resuming a session, otherwise create new
      const canReuse = options.sessionId && this.engine && this.currentSessionId === options.sessionId;
      if (!canReuse) {
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
          this.emit('stream', {
            type: 'session',
            content: this.currentSessionId,
          } as EngineStreamEvent);
        }
      }

      const engine = this.engine;
      if (!engine) {
        throw new Error(`[${this.getName()}] engine not initialized`);
      }

      if (options.model && this.currentModelId !== options.model) {
        const tModel = Date.now();
        try {
          await engine.setModel(options.model);
          this.currentModelId = options.model;
          logAcpTiming(timingLabel, 'wrap.W3_setModel', tModel);
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
      const tPrompt = Date.now();
      const promptResult = await engine.sendPrompt(fullPrompt);
      logAcpTiming(timingLabel, 'wrap.W4_sendPrompt_includes_agent', tPrompt);
      logAcpTiming(timingLabel, 'wrap.W_execute_total', tExecute, `canReuse=${canReuse}`);
      const stopReason = promptResult.stopReason;
      console.log(`[${this.getName()}] sendPrompt returned: stopReason=${stopReason}`);
      this.streaming = false;

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
        return {
          success: true,
          output: normalizedOutput,
          sessionId: this.currentSessionId ?? undefined,
          stopReason: 'end_turn',
          metadata: ZERO_USAGE_METADATA,
        };
      }

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
    const config = this.getACPConfig(options);
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

  protected getToolTitle(toolName: string): string {
    const titleMap: Record<string, string> = {
      bash: '💻 执行命令',
      write: '📝 写入文件',
      edit: '✏️ 编辑文件',
      multiedit: '✏️ 编辑文件',
      patch: '✏️ 编辑文件',
      read: '📖 读取文件',
      glob: '🔍 搜索文件',
      grep: '🔍 搜索内容',
      ls: '📂 列出目录',
      task: '🤖 子任务',
      todo: '📋 任务列表',
      todowrite: '📋 任务列表',
      webfetch: '🌐 获取网页',
      websearch: '🔎 搜索网页',
    };
    return titleMap[toolName] || `🔧 ${toolName}`;
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
          this.emitText(formatted, toolUpdate);
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
    let header = `\n\n**${this.getToolTitle(toolName)}**\n`;

    switch (toolName) {
      case 'bash': {
        const cmd = rawInput.command || '';
        if (cmd) {
          const cmdLines = cmd.split('\n');
          if (cmdLines.length <= 1 && cmd.length <= 120) {
            header += `\n💻 执行命令: \`${cmd}\`\n`;
          } else {
            header += `\n💻 执行命令 (${cmdLines.length} 行)\n`;
            header += `\n<details><summary>查看命令</summary>\n\n${htmlCodeBlock(cmd, 'bash')}\n\n</details>\n`;
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
    return formatTextContent(output, { summaryLabel: '查看输出' });
  }

  private parseToolXmlOutput(output: string): string | null {
    const taskMatch = output.match(/<task_result>([\s\S]*?)<\/task_result>/);
    if (taskMatch) {
      const inner = taskMatch[1].trim();
      return formatTextContent(inner, { summaryLabel: '🤖 子任务结果' });
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
