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
import { commandExists } from '../command-exists';

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

  /**
   * Kiro-cli returns tool results in { items: [{ Text: "..." }, { Json: {...} }, ...] } format.
   */
  protected extractToolOutput(raw: any): string {
    // rawOutput may be a JSON string — parse it first
    let data = raw;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { return raw; }
    }
    if (data && typeof data === 'object' && Array.isArray(data.items)) {
      const parts = data.items
        .map((item: any) => {
          if (typeof item === 'string') return item;
          if (item.Text) return item.Text;
          if (item.text) return item.text;
          if (item.Json) return this.formatJsonItem(item.Json);
          return '';
        })
        .filter(Boolean);
      if (parts.length > 0) return parts.join('\n');
    }
    return super.extractToolOutput(data);
  }

  /**
   * Format a Json item from kiro tool output into readable text.
   */
  private formatJsonItem(json: any): string {
    if (!json || typeof json !== 'object') return JSON.stringify(json);

    // Task list: { tasks: [...], description: "..." }
    if (Array.isArray(json.tasks)) {
      const header = json.description ? `📋 ${json.description}` : '📋 任务列表';
      const items = json.tasks.map((t: any) => {
        const check = t.completed ? '✅' : '⬜';
        return `${check} ${t.id || '-'}. ${t.task_description || t.description || ''}`;
      }).join('\n');
      return `${header}\n${items}`;
    }

    // Command result: { exit_status, stdout, stderr }
    if ('exit_status' in json || 'stdout' in json || 'stderr' in json) {
      const parts: string[] = [];
      if (json.stdout) parts.push(json.stdout.trim());
      if (json.stderr) parts.push(`⚠️ ${json.stderr.trim()}`);
      if (json.exit_status && json.exit_status !== 'exit status: 0') {
        parts.push(`(${json.exit_status})`);
      }
      return parts.join('\n') || '(无输出)';
    }

    // File content: { content, path }
    if ('content' in json && typeof json.content === 'string') {
      const label = json.path ? `📄 ${json.path}` : '';
      return label ? `${label}\n${json.content}` : json.content;
    }

    // Search results: { numMatches, numFiles, results: [{file, count}] }
    if ('numMatches' in json && Array.isArray(json.results)) {
      const header = `🔍 找到 ${json.numMatches} 个匹配，${json.numFiles} 个文件${json.truncated ? ' (已截断)' : ''}`;
      const top = json.results.slice(0, 15).map((r: any) => {
        const shortPath = r.file?.replace(/^.*\/src\//, 'src/') || r.file;
        return `  ${shortPath} (${r.count})`;
      }).join('\n');
      const more = json.results.length > 15 ? `\n  ... 及其他 ${json.results.length - 15} 个文件` : '';
      return `${header}\n${top}${more}`;
    }

    // Modified files list
    if (Array.isArray(json.modified_files) && json.modified_files.length > 0) {
      return `📝 修改的文件:\n${json.modified_files.map((f: string) => `  - ${f}`).join('\n')}`;
    }

    // Fallback: compact JSON
    return JSON.stringify(json, null, 2);
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('kiro-cli', [
      process.env.HOME ? `${process.env.HOME}/.local/bin` : '',
      '/usr/local/bin',
      '/usr/bin',
    ].filter(Boolean));
  }
}
