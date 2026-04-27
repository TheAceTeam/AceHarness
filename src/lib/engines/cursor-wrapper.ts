/**
 * Cursor CLI Engine Wrapper
 *
 * Wraps ACPEngine to implement the Engine interface for Cursor Agent CLI.
 * The actual command is `agent acp` (not `cursor acp`).
 *
 * Cursor ACP quirks vs OpenCode/Kiro:
 * - tool_call events always have empty rawInput {}
 * - Tool JSON results ({"error":"rg:..."}, {"totalFiles":...}) come as agent_message_chunk
 * - We emit a simple tool header on tool_call, and filter JSON noise from agent-message
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import type { EngineStreamEvent } from './engine-interface';
import { fenced } from '../markdown-utils';
import { ACPEngineConfig } from './acp-engine';
import { commandExists } from '../command-exists';

export class CursorEngineWrapper extends ACPWrapperBase {
  /** Track active tool IDs so we can suppress their JSON output */
  private activeToolIds = new Set<string>();
  /** Track last emitted text to deduplicate repeated agent messages */
  private lastEmittedText = '';
  /** Buffer pending tool calls — emit header+result together on completion */
  private pendingTools = new Map<string, {
    title: string;
    kind: string;
    icon: string;
    permissionTitle?: string;
    metadata: any;
  }>();

  getName(): string {
    return 'cursor';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'cursor',
      command: 'agent',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [], // 'acp' is added by buildCommandArgs
      env: {}
    };
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('agent', [
      process.env.HOME ? `${process.env.HOME}/.local/bin` : '',
      '/usr/local/bin',
      '/usr/bin',
    ].filter(Boolean));
  }

  /**
   * Override event setup for Cursor-specific ACP behavior:
   * - tool_call has empty rawInput, so we buffer tool headers
   * - On tool_call_update (completed), emit header + result together
   * - This keeps results directly under their tool header in the stream
   */
  protected setupEngineEvents(): void {
    if (!this.engine) return;
    this.activeToolIds.clear();
    this.pendingTools.clear();
    this.lastEmittedText = '';

    this.engine.on('agent-message', (content) => {
      if (!this.streaming) return;
      const text = this.extractText(content);
      if (!text) return;
      if (!text.trim()) return;
      if (text.trim() === this.lastEmittedText.trim()) return;
      this.lastEmittedText = text;

      let prefix = '';
      if (this.lastBlockWasTool) {
        prefix = '\n\n<!-- chunk-boundary -->\n\n';
        this.lastBlockWasTool = false;
      }
      this.emit('stream', { type: 'text', content: prefix + text } as EngineStreamEvent);
    });

    this.engine.on('agent-thought', (content) => {
      if (!this.streaming) return;
      const text = this.extractText(content);
      if (text) {
        this.emit('stream', { type: 'thought', content: text } as EngineStreamEvent);
      }
    });

    // Buffer tool_call — don't emit yet, wait for completion
    this.engine.on('tool-call', (toolCall) => {
      if (!this.streaming) return;
      const toolId = toolCall.id || '';
      if (!toolId || this.seenToolIds.has(toolId)) return;
      this.seenToolIds.add(toolId);
      this.activeToolIds.add(toolId);

      const title = toolCall.title || toolCall.kind || 'Tool';
      const kind = toolCall.kind || '';
      this.pendingTools.set(toolId, {
        title,
        kind,
        icon: this.toolIcon(title, kind),
        metadata: toolCall,
      });
    });

    this.engine.on('tool-call-update', (toolUpdate) => {
      if (!this.streaming) return;
      const toolId = toolUpdate.id || '';

      // If we haven't seen this tool yet, buffer it
      if (toolId && !this.seenToolIds.has(toolId)) {
        this.seenToolIds.add(toolId);
        this.activeToolIds.add(toolId);
        const title = toolUpdate.title || toolUpdate.kind || 'Tool';
        const kind = toolUpdate.kind || '';
        this.pendingTools.set(toolId, {
          title,
          kind,
          icon: this.toolIcon(title, kind),
          metadata: toolUpdate,
        });
      }

      if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
        this.activeToolIds.delete(toolId);
        // Flush: emit header + result together
        this.flushToolResult(toolId, toolUpdate);
      }
    });

    this.engine.on('log', () => { /* skip */ });

    // Permission requests carry the actual command in title — update buffered entry
    this.engine.on('permission', (params: any) => {
      if (!this.streaming) return;
      const toolCall = params?.toolCall;
      if (!toolCall) return;
      const toolId = toolCall.toolCallId || '';
      const title = toolCall.title || '';
      const kind = toolCall.kind || '';
      if (!title || !toolId) return;

      const pending = this.pendingTools.get(toolId);
      if (pending) {
        // Enrich buffered tool with permission title (has actual command)
        pending.permissionTitle = title;
        pending.icon = this.toolIcon(title, kind);
      } else if (!this.seenToolIds.has(toolId)) {
        // New tool from permission — buffer it
        this.seenToolIds.add(toolId);
        this.activeToolIds.add(toolId);
        this.pendingTools.set(toolId, {
          title,
          kind,
          icon: this.toolIcon(title, kind),
          permissionTitle: title,
          metadata: toolCall,
        });
      }
    });

    // Subtask events from cursor/task
    this.engine.on('subtask', (params: any) => {
      if (!this.streaming) return;
      const name = params?.title || params?.name || params?.description || 'Subagent task';
      this.lastBlockWasTool = true;
      this.emit('stream', {
        type: 'text',
        content: `\n\n**🤖 ${name}**\n`,
      } as EngineStreamEvent);
    });

    this.engine.on('error', (error) => {
      this.emit('stream', {
        type: 'text',
        content: `\n\n❌ 错误: ${error instanceof Error ? error.message : String(error)}\n`
      } as EngineStreamEvent);
    });
  }

  /**
   * Flush a buffered tool: emit header + result as one block
   */
  private flushToolResult(toolId: string, toolUpdate: any): void {
    const pending = this.pendingTools.get(toolId);
    this.pendingTools.delete(toolId);

    // Build header from buffered info (or fallback to toolUpdate)
    const title = pending?.permissionTitle || pending?.title || toolUpdate.title || toolUpdate.kind || 'Tool';
    const icon = pending?.icon || this.toolIcon(title, toolUpdate.kind || '');
    const metadata = pending?.metadata || toolUpdate;

    let output = `\n\n**${icon} ${title}**\n`;

    // Extract command/path detail from rawInput if available
    const rawInput = toolUpdate.rawInput || metadata?.rawInput || {};
    if (rawInput.command) {
      const cmd = rawInput.command;
      const cmdLines = cmd.split('\n');
      if (cmdLines.length <= 1 && cmd.length <= 120) {
        output += `\n💻 执行命令: \`${cmd}\`\n`;
      } else {
        output += `\n💻 执行命令 (${cmdLines.length} 行)\n`;
        output += `\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
      }
    } else if (rawInput.pattern && rawInput.path) {
      output += `\n🔍 搜索: \`${rawInput.pattern}\` in \`${rawInput.path}\`\n`;
    } else if (rawInput.pattern) {
      output += `\n🔍 搜索: \`${rawInput.pattern}\`\n`;
    } else if (rawInput.filePath) {
      output += `\n📖 文件: \`${rawInput.filePath}\`\n`;
    }

    // Append result
    const result = this.formatCursorToolResult(toolUpdate);
    if (result) {
      output += result;
    }

    this.lastBlockWasTool = true;
    this.emit('stream', { type: 'text', content: output, metadata } as EngineStreamEvent);
  }

  private toolIcon(title: string, kind: string): string {
    const t = title.toLowerCase();
    if (t.includes('terminal') || t.includes('bash') || t.includes('shell')) return '💻';
    if (t.includes('write') || t.includes('create')) return '📝';
    if (t.includes('edit') || t.includes('patch')) return '✏️';
    if (t.includes('read')) return '📖';
    if (t.includes('find') || t.includes('glob') || t.includes('list')) return '📁';
    if (t.includes('grep') || t.includes('search') || kind === 'search') return '🔍';
    if (t.includes('task')) return '🤖';
    if (t.includes('fetch')) return '🌐';
    if (t.includes('websearch')) return '🔎';
    return '🔧';
  }

  /**
   * Format cursor tool_call_update result.
   * Cursor provides rawOutput (object) or content (array of diff/text blocks).
   */
  private formatCursorToolResult(toolUpdate: any): string {
    // Handle content array (e.g. diff results from Edit/Write)
    if (Array.isArray(toolUpdate.content) && toolUpdate.content.length > 0) {
      const parts: string[] = [];
      for (const block of toolUpdate.content) {
        if (block.type === 'diff' && block.path) {
          const path = block.path;
          if (block.newText && !block.oldText) {
            const lines = block.newText.split('\n').length;
            parts.push(`\n📝 写入文件: \`${path}\` (${lines} 行)\n`);
          } else if (block.oldText && block.newText) {
            const oldLines = block.oldText.split('\n').length;
            const newLines = block.newText.split('\n').length;
            const added = Math.max(0, newLines - oldLines);
            const removed = Math.max(0, oldLines - newLines);
            let stats = `${Math.min(oldLines, newLines)} 行修改`;
            if (added > 0) stats += `, +${added} 行`;
            if (removed > 0) stats += `, -${removed} 行`;
            parts.push(`\n✏️ 编辑文件: \`${path}\` (${stats})\n`);
          }
        } else if (block.type === 'text' && block.text) {
          const text = block.text.trim();
          if (text) parts.push(`\n${text}\n`);
        } else if (block.type === 'content' && block.content) {
          // Nested content block (e.g. from Read File)
          const inner = block.content;
          if (inner.type === 'text' && inner.text) {
            const text = inner.text.trim();
            const lines = text.split('\n');
            if (text) {
              parts.push(`\n<details><summary>查看内容 (${lines.length} 行)</summary>\n\n${fenced(text)}\n\n</details>\n`);
            }
          }
        }
      }
      if (parts.length > 0) return parts.join('');
    }

    // Handle rawOutput object
    const raw = toolUpdate.rawOutput;
    if (!raw) return '';

    // Use base class helper for structured output
    if (typeof raw === 'object') {
      // Error output
      if (raw.error) {
        const err = String(raw.error).trim();
        if (err.includes('IO error for operation on')) return '';
        if (err.includes('Path does not exist')) return `\n${fenced(`⚠️ ${err}`)}\n`;
        return `\n${fenced(`⚠️ ${err}`)}\n`;
      }

      // Structured command result with output field
      if ('output' in raw && typeof raw.output === 'string') {
        const text = raw.output.trim();
        if (!text) return raw.exit !== undefined && raw.exit !== 0 ? `\n(exit code: ${raw.exit})\n` : '';
        const lines = text.split('\n');
        let result = `\n<details><summary>查看输出 (${lines.length} 行)</summary>\n\n${fenced(text)}\n\n</details>\n`;
        if (raw.exit !== undefined && raw.exit !== 0) result += `(exit code: ${raw.exit})\n`;
        return result;
      }

      // File content (Read File result)
      if (raw.content && typeof raw.content === 'string') {
        const lines = raw.content.split('\n');
        if (lines.length > 15) {
          return `\n<details><summary>查看内容 (${lines.length} 行)</summary>\n\n${fenced(raw.content)}\n\n</details>\n`;
        }
        if (lines.length > 0) {
          return `\n${fenced(raw.content)}\n`;
        }
        return '';
      }

      // Search results summary
      if ('totalMatches' in raw) {
        return `\n找到 ${raw.totalMatches} 个匹配${raw.truncated ? ' (已截断)' : ''}\n`;
      }
      if ('totalFiles' in raw) {
        return `\n找到 ${raw.totalFiles} 个文件${raw.truncated ? ' (已截断)' : ''}\n`;
      }
    }

    return '';
  }
}
