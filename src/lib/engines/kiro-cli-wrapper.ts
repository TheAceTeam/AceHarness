/**
 * Kiro CLI Engine Wrapper
 *
 * Wraps ACPEngine via ACPWrapperBase to implement the Engine interface for Kiro CLI.
 * Kiro CLI uses standard ACP protocol, so the base class handles most of the work.
 * Unlike Cursor, Kiro provides proper rawInput in tool_call events.
 */

import { ACPWrapperBase } from './acp-wrapper-base';
import type { EngineOptions } from './engine-interface';
import { ACPEngineConfig } from './acp-engine';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import {
  formatAceFileChangesResult,
  formatAceToolResult,
  getAceToolTitle,
} from '@/lib/chat/ace-process-formatters';

export class KiroCliEngineWrapper extends ACPWrapperBase {
  getName(): string {
    return 'kiro-cli';
  }

  protected getACPConfig(options: EngineOptions): ACPEngineConfig {
    return {
      engineType: 'kiro-cli',
      command: 'kiro-cli',
      workingDirectory: options.workingDirectory,
      agentName: options.agent,
      model: options.model,
      args: ['--trust-all-tools'],
      env: {},
    };
  }

  protected formatToolResult(output: string, metadata: any): string {
    const raw = this.parseRawOutput(metadata?.rawOutput);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
      return super.formatToolResult(output, metadata);
    }

    const toolName = this.resolveToolName(metadata || {});
    const title = this.getToolTitle(toolName);
    const blocks: string[] = [];
    const textParts: string[] = [];

    for (const item of raw.items) {
      if (typeof item === 'string') {
        textParts.push(item);
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      if (typeof item.Text === 'string') {
        textParts.push(item.Text);
        continue;
      }
      if (typeof item.text === 'string') {
        textParts.push(item.text);
        continue;
      }
      if (item.Json) {
        const block = this.formatJsonItem(item.Json, metadata, toolName);
        if (block) {
          blocks.push(block);
        }
        continue;
      }
    }

    const text = textParts.map((part) => String(part || '').trim()).filter(Boolean).join('\n');
    if (text) {
      blocks.push(formatAceToolResult({ toolName, rawOutput: { output: text }, title }));
    }

    if (blocks.length > 0) return blocks.join('').trimEnd();
    return super.formatToolResult(output, metadata);
  }

  private parseRawOutput(raw: any): any {
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return raw; }
    }
    return raw;
  }

  private formatJsonItem(json: any, metadata: any, fallbackToolName: string): string {
    if (!json || typeof json !== 'object') return '';

    if (Array.isArray(json.tasks)) {
      return formatAceToolResult({
        toolName: 'todo',
        rawOutput: {
          todos: json.tasks.map((task: any) => ({
            content: String(task?.task_description || task?.description || task?.text || task?.id || ''),
            status: task?.completed ? 'completed' : 'pending',
          })),
        },
        title: getAceToolTitle('todo'),
      });
    }

    if ('exit_status' in json || 'stdout' in json || 'stderr' in json) {
      return formatAceToolResult({
        toolName: fallbackToolName,
        rawOutput: json,
        title: this.getToolTitle(fallbackToolName),
      });
    }

    if (typeof json.content === 'string') {
      return formatAceToolResult({
        toolName: 'read',
        rawOutput: { content: json.content, filePath: json.path || '' },
        title: getAceToolTitle('read'),
      });
    }

    if ('numMatches' in json && Array.isArray(json.results)) {
      return formatAceToolResult({
        toolName: 'grep',
        rawOutput: {
          totalMatches: json.numMatches,
          totalFiles: json.numFiles,
          results: json.results,
          truncated: json.truncated,
        },
        title: getAceToolTitle('grep'),
      });
    }

    if (Array.isArray(json.modified_files) && json.modified_files.length > 0) {
      return formatAceFileChangesResult({
        changes: json.modified_files.map((filePath: string) => ({ filePath, kind: 'update' })),
        fallbackToolName: 'edit',
        fallbackTitle: getAceToolTitle('edit'),
      });
    }

    return formatAceToolResult({
      toolName: fallbackToolName,
      rawOutput: json,
      title: this.getToolTitle(fallbackToolName),
    });
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('kiro-cli', getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
  }
}
