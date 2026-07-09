/**
 * Cursor CLI Engine Wrapper
 *
 * Wraps ACPEngine to implement the Engine interface for Cursor Agent CLI.
 * The actual command is `cursor-agent acp` or preRuntime `agent acp` (not `cursor acp`).
 *
 * Cursor ACP quirks vs OpenCode/Kiro:
 * - tool_call events always have empty rawInput {}
 * - Tool JSON results ({"error":"rg:..."}, {"totalFiles":...}) come as agent_message_chunk
 * - We emit a simple tool header on tool_call, and filter JSON noise from agent-message
 */

import { ACPExecutionContext, ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import {
  formatAceFileChangesResult,
  formatAceReasoning,
  formatAceToolCall,
  formatAceToolResult,
  getAceToolFallbackTitle,
  getAceToolTitle,
  resolveAceToolName,
} from '@/lib/chat/ace-process-formatters';

export function resolveCursorAgentCommand(): string {
  const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
  if (commandExists('cursor-agent', searchPaths)) return 'cursor-agent';
  return 'agent';
}

export function isCursorAgentCommandAvailable(): boolean {
  const searchPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths());
  return commandExists('cursor-agent', searchPaths) || commandExists('agent', searchPaths);
}

export class CursorEngineWrapper extends ACPWrapperBase {
  /** Track active tool IDs so we can suppress their JSON output */
  private activeToolIds = new Set<string>();
  /** Track last emitted text to deduplicate repeated agent messages */
  private lastEmittedText = '';
  /** Buffer pending tool calls — emit header+result together on completion */
  private pendingTools = new Map<string, {
    title: string;
    kind: string;
    permissionTitle?: string;
    metadata: any;
  }>();

  getName(): string {
    return 'cursor';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'cursor',
      command: resolveCursorAgentCommand(),
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: [], // 'acp' is added by buildCommandArgs
      env: {}
    };
  }

  async isAvailable(): Promise<boolean> {
    return isCursorAgentCommandAvailable();
  }

  beforeExecute(_context: ACPExecutionContext, _options: EngineOptions): void {
    this.activeToolIds.clear();
    this.pendingTools.clear();
    this.lastEmittedText = '';
  }

  handleAgentMessage(context: ACPExecutionContext, content: any): void {
    const text = this.extractText(content);
    if (!text || !text.trim()) return;
    if (text.trim() === this.lastEmittedText.trim()) return;
    this.lastEmittedText = text;

    let prefix = '';
    if (context.lastBlockWasTool) {
      prefix = '\n\n<!-- chunk-boundary -->\n\n';
      context.lastBlockWasTool = false;
    }
    this.emitText(context, prefix + text);
  }

  handleAgentThought(context: ACPExecutionContext, content: any): void {
    const text = this.extractText(content);
    if (!text) return;
    context.emitStream({
      type: 'thought',
      content: formatAceReasoning(text),
    });
  }

  handleToolCall(context: ACPExecutionContext, toolCall: any): void {
    const toolId = toolCall.id || '';
    if (!toolId || context.seenToolIds.has(toolId)) return;
    context.seenToolIds.add(toolId);
    this.activeToolIds.add(toolId);

    const title = toolCall.title || toolCall.kind || 'Tool';
    const kind = toolCall.kind || '';
    this.pendingTools.set(toolId, {
      title,
      kind,
      metadata: toolCall,
    });
  }

  handleToolCallUpdate(context: ACPExecutionContext, toolUpdate: any): void {
    const toolId = toolUpdate.id || '';

    if (toolId && !context.seenToolIds.has(toolId)) {
      context.seenToolIds.add(toolId);
      this.activeToolIds.add(toolId);
      const title = toolUpdate.title || toolUpdate.kind || 'Tool';
      const kind = toolUpdate.kind || '';
      this.pendingTools.set(toolId, {
        title,
        kind,
        metadata: toolUpdate,
      });
    }

    if (toolUpdate.status === 'completed' || toolUpdate.status === 'failed') {
      this.activeToolIds.delete(toolId);
      this.flushToolResult(context, toolId, toolUpdate);
    }
  }

  handleEngineLog(_context: ACPExecutionContext, _payload: any): void {}

  handlePermissionRequest(context: ACPExecutionContext, params: any): void {
    const toolCall = params?.toolCall;
    if (!toolCall) return;
    const toolId = toolCall.toolCallId || '';
    const title = toolCall.title || '';
    const kind = toolCall.kind || '';
    if (!title || !toolId) return;

    const pending = this.pendingTools.get(toolId);
    if (pending) {
      pending.permissionTitle = title;
    } else if (!context.seenToolIds.has(toolId)) {
      context.seenToolIds.add(toolId);
      this.activeToolIds.add(toolId);
      this.pendingTools.set(toolId, {
        title,
        kind,
        permissionTitle: title,
        metadata: toolCall,
      });
    }
  }

  /**
   * Flush a buffered tool: emit header + result as one block
   */
  private flushToolResult(context: ACPExecutionContext, toolId: string, toolUpdate: any): void {
    const pending = this.pendingTools.get(toolId);
    this.pendingTools.delete(toolId);

    // Build header from buffered info (or fallback to toolUpdate)
    const title = pending?.permissionTitle || pending?.title || toolUpdate.title || toolUpdate.kind || 'Tool';
    const kind = pending?.kind || toolUpdate.kind || '';
    const metadata = pending?.metadata || toolUpdate;
    const rawInput = toolUpdate.rawInput || metadata?.rawInput || {};
    const resolvedToolName = resolveAceToolName(title, rawInput);

    const requestBlock = this.buildCursorToolCallBlock(resolvedToolName, title, kind, rawInput);
    const result = this.formatCursorToolResult(toolUpdate, resolvedToolName);

    context.lastBlockWasTool = true;
    if (requestBlock) this.emitText(context, requestBlock, metadata);
    if (result) this.emitText(context, result, metadata);
  }

  private buildCursorToolCallBlock(toolName: string, title: string, kind: string, rawInput: any): string {
    const resolvedTitle = toolName === 'tool'
      ? getAceToolFallbackTitle(title, kind)
      : this.getToolTitle(toolName);
    return formatAceToolCall({ toolName, rawInput: rawInput || {}, title: resolvedTitle, toolId: String(rawInput?.id || '') || undefined });
  }

  /**
   * Format cursor tool_call_update result.
   * Cursor provides rawOutput (object) or content (array of diff/text blocks).
   */
  private formatCursorToolResult(toolUpdate: any, resolvedToolName: string): string {
    // Handle content array (e.g. diff results from Edit/Write)
    if (Array.isArray(toolUpdate.content) && toolUpdate.content.length > 0) {
      const changes: Array<Record<string, unknown>> = [];
      const outputs: string[] = [];
      for (const block of toolUpdate.content) {
        if (block.type === 'diff' && block.path) {
          const path = block.path;
          if (block.newText && !block.oldText) {
            changes.push({
              toolName: 'write',
              title: getAceToolTitle('write'),
              filePath: path,
              content: block.newText,
            });
          } else if (block.oldText && block.newText) {
            changes.push({
              toolName: 'edit',
              title: getAceToolTitle('edit'),
              filePath: path,
              oldString: block.oldText,
              newString: block.newText,
            });
          }
        } else if (block.type === 'text' && block.text) {
          const text = block.text.trim();
          if (text) outputs.push(text);
        } else if (block.type === 'content' && block.content) {
          // Nested content block (e.g. from Read File)
          const inner = block.content;
          if (inner.type === 'text' && inner.text) {
            const text = inner.text.trim();
            if (text) {
              outputs.push(text);
            }
          }
        }
      }
      if (changes.length > 0 || outputs.length > 0) {
        return formatAceFileChangesResult({
          changes,
          fallbackToolName: resolvedToolName,
          fallbackTitle: this.getToolTitle(resolvedToolName),
          output: outputs.join('\n\n'),
        });
      }
    }

    // Handle rawOutput object
    const raw = toolUpdate.rawOutput;
    if (!raw) return '';

    // Use base class helper for structured output
    if (typeof raw === 'object') {
      if (
        'output' in raw &&
        typeof raw.output === 'string' &&
        (String(toolUpdate?.title || '').toLowerCase().includes('task')
          || String(toolUpdate?.kind || '').toLowerCase().includes('task'))
      ) {
        return formatAceToolResult({ toolName: 'task', rawOutput: raw, title: getAceToolTitle('task'), toolId: String(toolUpdate?.id || '') });
      }

      // Error output
      if (raw.error) {
        const err = String(raw.error).trim();
        if (err.includes('IO error for operation on')) return '';
        return formatAceToolResult({ toolName: resolvedToolName, rawOutput: { error: err }, title: this.getToolTitle(resolvedToolName), toolId: String(toolUpdate?.id || '') });
      }

      // Structured command result with output field
      if ('output' in raw && typeof raw.output === 'string') {
        if (!String(raw.output || '').trim() && (raw.exit === undefined || raw.exit === 0)) return '';
        return formatAceToolResult({ toolName: resolvedToolName, rawOutput: raw, title: this.getToolTitle(resolvedToolName), toolId: String(toolUpdate?.id || '') });
      }

      // File content (Read File result)
      if (raw.content && typeof raw.content === 'string') {
        const lines = raw.content.split('\n');
        if (lines.length > 0) {
          return formatAceToolResult({ toolName: resolvedToolName, rawOutput: raw, title: this.getToolTitle(resolvedToolName), toolId: String(toolUpdate?.id || '') });
        }
        return '';
      }

      // Search results summary
      if ('totalMatches' in raw) {
        return formatAceToolResult({ toolName: resolvedToolName, rawOutput: raw, title: this.getToolTitle(resolvedToolName), toolId: String(toolUpdate?.id || '') });
      }
      if ('totalFiles' in raw) {
        return formatAceToolResult({ toolName: resolvedToolName, rawOutput: raw, title: this.getToolTitle(resolvedToolName), toolId: String(toolUpdate?.id || '') });
      }
    }

    return '';
  }
}
