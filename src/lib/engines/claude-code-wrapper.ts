/**
 * Claude Code Engine Wrapper
 *
 * Unified wrapper implementing the Engine interface for Claude Code.
 * Uses @anthropic-ai/claude-agent-sdk for all execution:
 * - permissionMode 'bypassPermissions'
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import { loadEnvVars, buildEnvObject } from '../env-manager';
import { fenced, formatLargeContent } from '../markdown-utils';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';

// ============================================================================
// Helpers
// ============================================================================

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
function resolveToolName(raw: string): string {
  return String(raw || '').trim().toLowerCase();
}
function toolPath(rawInput: Record<string, unknown>): string {
  const path = rawInput.file_path ?? rawInput.filePath ?? rawInput.filepath ?? rawInput.file ?? rawInput.path;
  return typeof path === 'string' ? path : '';
}
function toolLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop() || '';
  if (!ext || ext === filePath) return '';
  if (ext === 'cj') return 'cangjie';
  return ext;
}
function toolText(rawInput: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = rawInput[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}
function readToolFileContent(filePath: string): string {
  if (!filePath || !existsSync(filePath)) return '';
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}
function formatCommandOutput(output: string, exitCode?: number | null): string {
  const trimmed = output.trim();
  if (!trimmed) {
    return exitCode != null && exitCode !== 0 ? `\n(exit code: ${exitCode})\n` : '';
  }
  let rendered = formatLargeContent(trimmed, { summaryLabel: '查看输出' });
  if (exitCode != null && exitCode !== 0) rendered += `(exit code: ${exitCode})\n`;
  return rendered;
}
function formatClaudeToolExecutionResult(toolNameRaw: string, result: unknown): string {
  const toolName = resolveToolName(toolNameRaw);
  if (!result || typeof result !== 'object') {
    const text = extractTextFromUnknown(result).trim();
    return text ? `\n${fenced(text)}\n` : '';
  }

  const raw = result as Record<string, unknown>;

  if (toolName === 'bash') {
    const stdout = typeof raw.stdout === 'string' ? raw.stdout : '';
    const stderr = typeof raw.stderr === 'string' ? raw.stderr : '';
    const output = typeof raw.output === 'string'
      ? raw.output
      : [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '');
    const exitCode = typeof raw.exit_code === 'number'
      ? raw.exit_code
      : (typeof raw.exitCode === 'number' ? raw.exitCode : null);
    return formatCommandOutput(output, exitCode);
  }

  if (toolName === 'read') {
    const text = extractTextFromUnknown(raw.content ?? raw.result ?? raw.text).trim();
    if (!text) return '';
    return formatLargeContent(text, { summaryLabel: '查看内容' });
  }

  const text = extractTextFromUnknown(raw.output ?? raw.content ?? raw.result ?? raw.message ?? result).trim();
  if (!text) return '';
  return formatLargeContent(text, { summaryLabel: '查看输出' });
}
function formatClaudeToolResult(toolNameRaw: string, inputJson: string): string {
  const toolName = resolveToolName(toolNameRaw);
  const isTaskTool = toolName === 'task' || toolName.endsWith('/task') || toolName.includes('task');
  const rawInput = parseToolJson(inputJson) || {};
  const p = toolPath(rawInput);
  const lang = toolLanguageFromPath(p);

  if (toolName === 'write') {
    const content = toolText(rawInput, ['content', 'text', 'new_string', 'newString']);
    const lines = content ? content.split('\n').length : 0;
    let out = `\n📝 写入文件: \`${p || '(未知路径)'}\`${lines ? ` (${lines} 行)` : ''}\n`;
    if (content) out += formatLargeContent(content, { filePath: p, lang, summaryLabel: '查看内容' });
    return out;
  }
  if (toolName === 'bash') {
    const cmd = typeof rawInput.command === 'string' ? rawInput.command : '';
    if (!cmd) return '\n💻 执行命令\n';
    const cmdLines = cmd.split('\n');
    if (cmdLines.length <= 1 && cmd.length <= 120) return `\n💻 执行命令: \`${cmd}\`\n`;
    return `\n💻 执行命令 (${cmdLines.length} 行)\n\n<details><summary>查看命令</summary>\n\n${fenced(cmd, 'bash')}\n\n</details>\n`;
  }
  if (toolName === 'read') {
    const content = toolText(rawInput, ['content', 'result', 'text']) || readToolFileContent(p);
    const lines = content ? content.split('\n').length : 0;
    let out = `\n📖 读取文件: \`${p || '(未知路径)'}\`\n`;
    if (content) out += formatLargeContent(content, { filePath: p, lang, summaryLabel: '查看内容' });
    return out;
  }
  if (toolName === 'edit' || toolName === 'multiedit' || toolName === 'patch') {
    const oldStr = typeof rawInput.old_string === 'string' ? rawInput.old_string : (typeof rawInput.oldString === 'string' ? rawInput.oldString : '');
    const newStr = typeof rawInput.new_string === 'string' ? rawInput.new_string : (typeof rawInput.newString === 'string' ? rawInput.newString : '');
    const oldLines = oldStr ? oldStr.split('\n').length : 0;
    const newLines = newStr ? newStr.split('\n').length : 0;
    const added = Math.max(0, newLines - oldLines);
    const removed = Math.max(0, oldLines - newLines);
    let stats = `${Math.min(oldLines, newLines)} 行修改`;
    if (added > 0) stats += `, +${added} 行`;
    if (removed > 0) stats += `, -${removed} 行`;
    let out = `\n✏️ 编辑文件: \`${p || '(未知路径)'}\` (${stats})\n`;
    if (oldStr || newStr) {
      const diff = (oldStr ? oldStr.split('\n').map((l) => `- ${l}`).join('\n') + '\n' : '')
        + (newStr ? newStr.split('\n').map((l) => `+ ${l}`).join('\n') + '\n' : '');
      out += formatLargeContent(diff.trimEnd(), { filePath: p, lang: 'diff', summaryLabel: `查看变更 (${stats})` });
    }
    return out;
  }
  if (toolName === 'glob') {
    const pattern = typeof rawInput.pattern === 'string' ? rawInput.pattern : '';
    return `\n🔍 搜索文件: \`${pattern || '(空模式)'}\`\n`;
  }
  if (toolName === 'grep') {
    const pattern = typeof rawInput.pattern === 'string' ? rawInput.pattern : '';
    return `\n🔍 搜索内容: \`${pattern || '(空模式)'}\`\n`;
  }
  if (toolName === 'ls') {
    return `\n📂 列出目录: \`${p || '.'}\`\n`;
  }
  if (isTaskTool) {
    const desc = typeof rawInput.description === 'string' ? rawInput.description : '';
    const prompt = typeof rawInput.prompt === 'string' ? rawInput.prompt : '';
    const subagentType = typeof rawInput.subagent_type === 'string'
      ? rawInput.subagent_type
      : (typeof rawInput.subagentType === 'string' ? rawInput.subagentType : '');
    let out = `\n🤖 启动子任务: ${desc || '(无描述)'}\n`;
    if (subagentType) out += `\n类型: \`${subagentType}\`\n`;
    if (prompt) {
      const lines = prompt.split('\n').length;
      out += `\n<details><summary>查看提示词 (${lines} 行)</summary>\n\n${fenced(prompt)}\n\n</details>\n`;
    }
    return out;
  }
  if (toolName === 'todowrite' || toolName === 'todo') {
    const todosRaw = (rawInput.todos ?? rawInput.items) as unknown;
    if (!Array.isArray(todosRaw) || todosRaw.length === 0) return '\n📋 任务列表更新中...\n';
    const done = todosRaw.filter((t: any) => t?.status === 'completed' || t?.status === 'done').length;
    const inProg = todosRaw.filter((t: any) => t?.status === 'in_progress' || t?.status === 'in-progress').length;
    let content = `\n<!-- todo-list-marker -->\n<div class="ace-todo-list">\n`;
    content += `<div class="ace-todo-header">📋 任务列表 (${done}/${todosRaw.length} 完成${inProg ? `, ${inProg} 进行中` : ''})</div>\n`;
    content += `<div class="ace-todo-progress"><div class="ace-todo-progress-bar" style="width:${Math.round((done / todosRaw.length) * 100)}%"></div></div>\n`;
    for (const t of todosRaw) {
      const status = t?.status;
      const icon = status === 'completed' || status === 'done'
        ? '✅'
        : status === 'in_progress' || status === 'in-progress'
          ? '⏳'
          : '⬜';
      const cls = status === 'completed' || status === 'done'
        ? 'ace-todo-done'
        : status === 'in_progress' || status === 'in-progress'
          ? 'ace-todo-doing'
          : 'ace-todo-pending';
      const text = typeof t?.content === 'string'
        ? t.content
        : typeof t?.text === 'string'
          ? t.text
          : typeof t?.task === 'string'
            ? t.task
            : typeof t?.title === 'string'
              ? t.title
              : '(无内容)';
      content += `<div class="ace-todo-item ${cls}">${icon} ${text}</div>\n`;
    }
    content += `</div>\n`;
    return content;
  }
  if (toolName === 'webfetch') {
    const url = typeof rawInput.url === 'string' ? rawInput.url : '';
    return `\n🌐 获取网页: \`${url || '(未知URL)'}\`\n`;
  }
  if (toolName === 'websearch') {
    const q = typeof rawInput.query === 'string' ? rawInput.query : '';
    return `\n🔎 搜索: \`${q || '(空查询)'}\`\n`;
  }
  if (inputJson.trim()) {
    const lines = inputJson.split('\n').length;
    return `\n<details><summary>查看输入 (${lines} 行)</summary>\n\n${fenced(inputJson, 'json')}\n\n</details>\n`;
  }
  return '';
}

function formatClaudeToolBlock(toolNameRaw: string, inputJson: string, toolId?: string): string {
  const toolName = resolveToolName(toolNameRaw) || 'tool';
  const isTaskTool = toolName === 'task' || toolName.endsWith('/task') || toolName.includes('task');
  const titleMap: Record<string, string> = {
    read: '📖 Read',
    write: '📝 Write',
    bash: '💻 Bash',
    edit: '✏️ Edit',
    multiedit: '✏️ MultiEdit',
    patch: '✏️ Patch',
    grep: '🔍 Grep',
    glob: '🔍 Glob',
    ls: '📂 Ls',
    task: '🤖 Task',
    todo: '📋 Todo',
    todowrite: '📋 TodoWrite',
    webfetch: '🌐 WebFetch',
    websearch: '🔎 WebSearch',
  };
  const title = isTaskTool ? '🤖 子任务' : (titleMap[toolName] || `🔧 ${toolName}`);
  const detail = formatClaudeToolResult(toolName, inputJson);
  return `\n\n**${title}**\n${detail || '\n'}`;
}

function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';

  if (Array.isArray(value)) {
    const pieces = value
      .map((item) => extractTextFromUnknown(item))
      .filter((item) => item.length > 0);
    if (pieces.length <= 1) return pieces[0] || '';
    return pieces.reduce((acc, piece) => {
      if (!acc) return piece;
      const prevEndsWithWhitespace = /\s$/.test(acc);
      const nextStartsWithWhitespace = /^\s/.test(piece);
      return prevEndsWithWhitespace || nextStartsWithWhitespace
        ? `${acc}${piece}`
        : `${acc}\n${piece}`;
    }, '');
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;

    // Common shapes from different providers/SDK adapters:
    // - { type: "text", text: "..." }
    // - { text: { value: "..." } }
    // - { content: ... } / { message: { content: ... } }
    // - OpenAI-ish: { type: "output_text", text: "..." }
    const directText = obj.text;
    if (typeof directText === 'string') return directText;
    if (directText && typeof directText === 'object') {
      const nestedValue = (directText as Record<string, unknown>).value;
      if (typeof nestedValue === 'string') return nestedValue;
    }

    if (typeof obj.content === 'string') return obj.content;
    if (obj.content != null) {
      const nested = extractTextFromUnknown(obj.content);
      if (nested) return nested;
    }

    if (obj.message != null) {
      const nested = extractTextFromUnknown(obj.message);
      if (nested) return nested;
    }
  }

  return '';
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

function buildCleanEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.CLAUDE_CODE_SESSION;
  delete env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC;
  env.IS_SANDBOX = '1';
  return env;
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
      return true;
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
    this._abortController = new AbortController();
    this._abortReason = null;
    const timeoutMs = options.timeoutMs ?? 60 * 60 * 1000;
    const timer = setTimeout(() => {
      this.abortWithReason('timeout');
    }, timeoutMs);

    let accumulated = '';
    const MAX_API_RETRY_ATTEMPTS = 5;
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
      const spawnEnv = buildCleanEnv();
      try {
        const userEnvVars = await loadEnvVars();
        const userEnv = buildEnvObject(userEnvVars);
        Object.assign(spawnEnv, userEnv);
      } catch {}

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

      if (options.sessionId) {
        (sdkOptions as any).resume = options.sessionId;
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
                accumulated += nextPiece;
                this.emit('stream', { type: 'text', content: nextPiece } as EngineStreamEvent);
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
              accumulated += block;
              this.emit('stream', { type: 'text', content: block } as EngineStreamEvent);
              lastBlockWasTool = true;
              streamToolBlocks.delete(eventIndex);
            }
          }
          const thinkingPiece = extractThinkingFromStreamEvent(ev);
          if (thinkingPiece) {
            this.emit('stream', { type: 'thought', content: thinkingPiece } as EngineStreamEvent);
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
            accumulated += nextPiece;
            this.emit('stream', { type: 'text', content: nextPiece } as EngineStreamEvent);
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
          if (sys.subtype === 'task_started') {
            continue;
          }
          if (sys.subtype === 'task_progress') {
            continue;
          }
          if (sys.subtype === 'task_notification') {
            continue;
          }
          let info = '';
          if (sys.subtype === 'api_retry') {
            const retry = msg as { attempt?: number; retry_delay_ms?: number; message?: string };
            const attempt = Number(retry.attempt || 0);
            if (attempt >= MAX_API_RETRY_ATTEMPTS) {
              this.abortWithReason('retry_limit');
              throw new Error(`SDK API 重试已达上限（${MAX_API_RETRY_ATTEMPTS} 次），已终止请求`);
            }
            // Hide SDK retry noise from end-user stream output.
            continue;
          } else if (
            sys.subtype === 'init' ||
            sys.subtype === 'session_start' ||
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
            accumulated += `\n${info}\n`;
            this.emit('stream', { type: 'text', content: `\n${info}\n` } as EngineStreamEvent);
          }
        } else if (msg.type === 'user') {
          const userMsg = msg as { parent_tool_use_id?: string | null; tool_use_result?: unknown };
          const toolUseId = typeof userMsg.parent_tool_use_id === 'string' ? userMsg.parent_tool_use_id : '';
          if (toolUseId && userMsg.tool_use_result !== undefined) {
            const tool = toolCallsById.get(toolUseId);
            const rendered = formatClaudeToolExecutionResult(tool?.name || '', userMsg.tool_use_result);
            if (rendered) {
              accumulated += rendered;
              this.emit('stream', { type: 'text', content: rendered } as EngineStreamEvent);
              lastBlockWasTool = false;
            }
          }
        } else if (msg.type === 'result') {
          if (msg.subtype === 'success') {
            const r = msg as { result?: string; session_id?: string };
            const resultText = r.result ?? '';
            const streamedHasAssistantText = assistantTextBytesEmitted > 0;
            const finalOutput = streamedHasAssistantText
              ? (accumulated || resultText)
              : (resultText || accumulated);
            return {
              success: true,
              output: finalOutput,
              sessionId: r.session_id || capturedSessionId,
              metadata: resolvedModel ? { resolvedModel } : undefined,
            };
          }
          const err = msg as { errors?: string[] };
          return {
            success: false,
            output: accumulated,
            error: err.errors?.join('; ') || 'SDK execution failed',
          };
        }
      }

      return {
        success: true,
        output: accumulated,
        sessionId: capturedSessionId,
        metadata: resolvedModel ? { resolvedModel } : undefined,
      };
    } catch (e: unknown) {
      const isAborted = this._abortController?.signal.aborted;
      return {
        success: false,
        output: accumulated,
        error: isAborted ? this.getAbortMessage(timeoutMs) : (e instanceof Error ? e.message : String(e)),
      };
    } finally {
      clearTimeout(timer);
      this._abortController = null;
      this._abortReason = null;
    }
  }

}
