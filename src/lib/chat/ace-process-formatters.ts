import { rewriteFirstAceProcessBlockPayload, wrapAceProcessBlock } from '@/lib/chat/ai-process-blocks';
import { getAceToolTitle } from '@/lib/chat/ace-tool-titles';
import { repairWindowsMojibake } from '@/lib/core/mojibake-repair';
import type { RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';

export { getAceToolTitle } from '@/lib/chat/ace-tool-titles';
export { formatAceReasoning } from '@/lib/chat/ace-reasoning';

type UnknownRecord = Record<string, unknown>;

export type AceNormalizedFileChange = {
  toolName: 'write' | 'edit';
  title: string;
  filePath: string;
  content?: string;
  oldString?: string;
  newString?: string;
  kind?: string;
  changedLines?: number;
  addedLines?: number;
  removedLines?: number;
};

const KNOWN_TOOLS = new Set([
  'bash',
  'cmd',
  'powershell',
  'write',
  'edit',
  'read',
  'glob',
  'grep',
  'task',
  'todowrite',
  'todo',
  'plan',
  'webfetch',
  'websearch',
  'ls',
  'skill',
  'context-compression',
  'subagent-dispatch',
  'subagent-wait',
  'multiedit',
  'patch',
]);
const MAX_INLINE_TOOL_RESULT_CHARS = 60_000;
const OVERSIZED_TOOL_RESULT_MESSAGE = '结果过大，已省略。工具已完成，详细内容未写入对话。';

function normalizeToolText(value: string): string {
  return repairWindowsMojibake(value);
}

function isOversizedToolResult(text: string): boolean {
  return String(text || '').length > MAX_INLINE_TOOL_RESULT_CHARS;
}

function oversizedToolResultOutput(text: string): string {
  const chars = String(text || '').length;
  return `${OVERSIZED_TOOL_RESULT_MESSAGE}${chars ? ` 原始长度 ${chars} 字符。` : ''}`;
}

function safeToolResultText(text: string): string {
  const normalized = normalizeToolText(text);
  return isOversizedToolResult(normalized) ? oversizedToolResultOutput(normalized) : normalized;
}

export function getAceToolFallbackTitle(titleOrName: string, kind?: string): string {
  const title = String(titleOrName || '').trim();
  const loweredTitle = title.toLowerCase();
  const loweredKind = String(kind || '').trim().toLowerCase();

  if (
    loweredTitle.includes('terminal')
    || loweredTitle.includes('bash')
    || loweredTitle.includes('shell')
    || loweredKind.includes('shell')
  ) return '💻 ' + (title || 'Tool');
  if (loweredTitle.includes('write') || loweredTitle.includes('create')) return '📝 ' + (title || 'Tool');
  if (loweredTitle.includes('edit') || loweredTitle.includes('patch')) return '✏️ ' + (title || 'Tool');
  if (loweredTitle.includes('read')) return '📖 ' + (title || 'Tool');
  if (loweredTitle.includes('find') || loweredTitle.includes('glob') || loweredTitle.includes('list')) return '📁 ' + (title || 'Tool');
  if (loweredTitle.includes('grep') || loweredTitle.includes('search') || loweredKind === 'search') return '🔍 ' + (title || 'Tool');
  if (loweredTitle.includes('task')) return '🤖 ' + (title || 'Tool');
  if (loweredTitle.includes('fetch')) return '🌐 ' + (title || 'Tool');
  if (loweredTitle.includes('websearch')) return '🔎 ' + (title || 'Tool');
  return `🔧 ${title || 'Tool'}`;
}

export function extractTextFromUnknown(value: unknown): string {
  if (typeof value === 'string') return normalizeToolText(value);
  if (value == null) return '';

  if (Array.isArray(value)) {
    const pieces = value
      .map((item) => extractTextFromUnknown(item))
      .filter(Boolean);
    return pieces.join('\n').trim();
  }

  if (typeof value === 'object') {
    const obj = value as UnknownRecord;
    if (typeof obj.text === 'string') return normalizeToolText(obj.text);
    if (obj.text && typeof obj.text === 'object' && typeof (obj.text as UnknownRecord).value === 'string') {
      return normalizeToolText(String((obj.text as UnknownRecord).value));
    }
    if (typeof obj.content === 'string') return normalizeToolText(obj.content);
    if (obj.content != null) {
      const nestedContent = extractTextFromUnknown(obj.content);
      if (nestedContent) return nestedContent;
    }
    if (obj.message != null) {
      const nestedMessage = extractTextFromUnknown(obj.message);
      if (nestedMessage) return nestedMessage;
    }
    if (typeof obj.output === 'string') return normalizeToolText(obj.output);
    if (typeof obj.result === 'string') return normalizeToolText(obj.result);
  }

  return '';
}

export function stringifyStructured(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return normalizeToolText(value);
  try {
    return normalizeToolText(JSON.stringify(value, null, 2));
  } catch {
    return normalizeToolText(String(value));
  }
}

function inputText(value: unknown, fallback = ''): string {
  if (value == null || value === '') return fallback;
  const extracted = extractTextFromUnknown(value).trim();
  if (extracted) return safeToolResultText(extracted);
  if (typeof value === 'object') return safeToolResultText(stringifyStructured(value));
  return safeToolResultText(String(value));
}

/** Serialize one runtime tool lifecycle event into the shared transcript format. */
export function formatAceRuntimeToolEvent(tool: RuntimeToolEvent): string {
  if (!tool || typeof tool !== 'object') return '';

  const toolName = String(tool.toolName || 'tool').trim() || 'tool';
  const title = String(tool.title || '').trim() || undefined;
  const toolId = String(tool.id || '').trim() || undefined;
  if (tool.status === 'running') {
    return formatAceToolCall({
      toolName,
      title,
      toolId,
      rawInput: tool.input && typeof tool.input === 'object' ? { ...tool.input } : undefined,
    });
  }

  if (tool.status === 'completed' || tool.status === 'failed') {
    const rawOutput = tool.result && typeof tool.result === 'object'
      ? tool.result
      : tool.status === 'failed'
        ? { error: '工具调用失败，运行时未返回详细结果。' }
        : { completed: true, resultUnavailable: true };
    return formatAceToolResult({ toolName, title, toolId, rawOutput });
  }

  return '';
}

export function formatAceSubtaskStart(params: {
  title?: string;
  description?: string;
  agent?: string;
  prompt?: string;
  toolId?: string;
  sessionId?: string;
}): string {
  return wrapAceProcessBlock('subtask-start', {
    title: String(params.title || params.description || params.agent || '').trim(),
    description: String(params.description || params.title || '').trim(),
    agent: String(params.agent || '').trim(),
    prompt: String(params.prompt || '').trim(),
    toolId: String(params.toolId || '').trim(),
    sessionId: String(params.sessionId || '').trim(),
  }, '');
}

export function formatAceSubtaskResult(params: {
  resultText?: string;
  sessionId?: string;
  toolId?: string;
}): string {
  const resultText = String(params.resultText || '').trim();
  if (!resultText && !params.sessionId && !params.toolId) return '';
  return wrapAceProcessBlock('subtask-result', {
    sessionId: String(params.sessionId || '').trim(),
    resultText,
    toolId: String(params.toolId || '').trim(),
  }, '');
}

export function appendToolIdToAceBlock(block: string, toolId?: string): string {
  if (!toolId) return block;
  return rewriteFirstAceProcessBlockPayload(block, (payload) => ({ ...payload, toolId }));
}

export function resolveAceToolName(titleOrName: string, rawInput?: UnknownRecord): string {
  const title = String(titleOrName || '').trim().toLowerCase();
  const input = rawInput || {};
  if (KNOWN_TOOLS.has(title)) return title;

  if (isContextCompressionToolInput(input)) return 'context-compression';

  const command = typeof input.command === 'string' ? input.command : '';
  if (command) return inferCommandToolName(command);
  if ('content' in input && ('filePath' in input || 'path' in input) && !('oldString' in input) && !('old_string' in input)) return 'write';
  if ('oldString' in input || 'newString' in input || 'old_string' in input || 'new_string' in input) return 'edit';
  if ('todos' in input || 'items' in input) return 'todowrite';
  if ('entries' in input || 'plan' in input) return 'plan';
  if ('pattern' in input && 'include' in input) return 'grep';
  if ('pattern' in input && ('path' in input || 'filePath' in input)) return 'grep';
  if ('pattern' in input) return 'glob';
  if (('description' in input && 'prompt' in input) || 'subagent_type' in input || 'subagentType' in input) return 'task';
  if ('url' in input) return 'webfetch';
  if ('query' in input) return 'websearch';
  if ('filePath' in input || 'file_path' in input) return 'read';
  if ('path' in input) return 'ls';
  return title || 'tool';
}

function isContextCompressionToolInput(input: UnknownRecord): boolean {
  if (typeof input.topic !== 'string') return false;
  if (!Array.isArray(input.content)) return false;
  return input.content.some((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const record = item as UnknownRecord;
    return typeof record.startId === 'string'
      && typeof record.endId === 'string'
      && typeof record.summary === 'string';
  });
}

function stripPlanJsonFence(text: string): string {
  const trimmed = String(text || '').trim();
  const fence = trimmed.match(/^```(?:text|json)?[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/i);
  return (fence ? fence[1] : trimmed).trim();
}

function parseJsonText(text: string): any | null {
  const body = stripPlanJsonFence(text);
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function normalizePlanEntries(value: unknown): Array<{ content: string; status?: string; description?: string; priority?: string }> {
  const root = typeof value === 'string' ? parseJsonText(value) : value;
  if (!root || typeof root !== 'object') return [];
  const entries: unknown[] = Array.isArray(root)
    ? root
    : (() => {
        const obj = root as UnknownRecord;
        return Array.isArray(obj.entries)
          ? obj.entries
          : obj.plan && typeof obj.plan === 'object' && Array.isArray((obj.plan as UnknownRecord).entries)
            ? ((obj.plan as UnknownRecord).entries as unknown[])
            : Array.isArray(obj.todos)
              ? obj.todos
              : [];
      })();
  return entries
    .map((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as UnknownRecord;
      const content = String(row.content || row.title || row.task || row.description || '').trim();
      if (!content) return null;
      const status = String(row.status || '').trim();
      const description = String(row.description || row.details || '').trim();
      const priority = String(row.priority || '').trim();
      return {
        content,
        ...(status ? { status } : {}),
        ...(description && description !== content ? { description } : {}),
        ...(priority ? { priority } : {}),
      };
    })
    .filter((entry): entry is { content: string; status?: string; description?: string; priority?: string } => Boolean(entry));
}

function extractPlanEntriesFromRawOutput(raw: unknown): Array<{ content: string; status?: string; description?: string; priority?: string }> {
  const direct = normalizePlanEntries(raw);
  if (direct.length > 0) return direct;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as UnknownRecord;
    const candidates = [obj.output, obj.content, obj.text, obj.result, obj.message];
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue;
      const entries = normalizePlanEntries(candidate);
      if (entries.length > 0) return entries;
    }
  }
  return [];
}

export function inferCommandToolName(command: string): 'bash' | 'cmd' | 'powershell' | 'read' | 'grep' | 'ls' {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return 'bash';

  const powershell = classifyPowerShellCommand(command);
  if (powershell) return powershell;

  const cmd = classifyCmdCommand(command);
  if (cmd) return cmd;

  if (isCompositeShellCommand(command)) return 'bash';

  if (/(\brg\b|\bgrep\b|\bag\b|\back\b|\bfd\b|findstr )/.test(normalized)) return 'grep';
  if (/(\bls\b|\bfind\b|\bdir\b|\bstat\b|\bpwd\b|\btree\b|\beza\b|\bexa\b)/.test(normalized)) return 'ls';
  if (/(\bcat\b|\bsed\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bbat\b)/.test(normalized)) return 'read';
  return 'bash';
}

function classifyPowerShellCommand(command: string): 'powershell' | 'read' | 'grep' | 'ls' | null {
  const statements = splitShellStatements(command);
  const firstCommand = firstShellCommand(statements[0] || '');
  const hasPowerShellShape = statements.some((statement) => {
    const name = firstShellCommand(statement);
    return isPowerShellCommandName(name) || statement.includes('$');
  });
  if (!hasPowerShellShape) return null;
  if (statements.length !== 1) return 'powershell';

  const pipeline = splitPipeline(statements[0]);
  const commands = pipeline.map(firstShellCommand).filter(Boolean);
  if (commands.length === 0) return 'powershell';
  if (!commands.every(isReadOnlyPowerShellPipelineCommand)) return 'powershell';

  if (isPowerShellReadCommand(firstCommand)) return 'read';
  if (isPowerShellSearchCommand(firstCommand)) return 'grep';
  if (isPowerShellListCommand(firstCommand)) return 'ls';
  return 'powershell';
}

function classifyCmdCommand(command: string): 'cmd' | 'read' | 'grep' | 'ls' | null {
  const normalized = String(command || '').trim().toLowerCase();
  const statements = splitShellStatements(command);
  const commands = statements.map(firstShellCommand).filter(Boolean);
  const hasCmdShape = normalized.includes('cmd /c') || commands.some((name) => [
    'dir',
    'type',
    'more',
    'findstr',
    'copy',
    'move',
    'del',
    'erase',
    'ren',
    'rename',
    'where',
  ].includes(name));
  if (!hasCmdShape) return null;
  if (statements.length !== 1 || isCompositeShellCommand(command)) return 'cmd';
  const first = commands[0] || '';
  if (first === 'type' || first === 'more') return 'read';
  if (first === 'findstr') return 'grep';
  if (first === 'dir' || first === 'where') return 'ls';
  return 'cmd';
}

function splitShellStatements(command: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';' || char === '\n' || char === '\r' || (char === '&' && next === '&') || (char === '|' && next === '|')) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      if ((char === '&' && next === '&') || (char === '|' && next === '|')) index += 1;
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitPipeline(statement: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | '`' | null = null;
  for (const char of statement) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      current += char;
      continue;
    }
    if (char === '|') {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function firstShellCommand(statement: string): string {
  const trimmed = statement.trim();
  if (!trimmed) return '';
  const withoutCall = trimmed.startsWith('& ') ? trimmed.slice(2).trim() : trimmed;
  const match = withoutCall.match(/^([A-Za-z0-9_.:-]+)/);
  return String(match?.[1] || '').toLowerCase();
}

function isCompositeShellCommand(command: string): boolean {
  if (splitShellStatements(command).length > 1) return true;
  let quote: '"' | "'" | '`' | null = null;
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    const next = command[index + 1];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '>' || char === '<' || (char === '&' && next === '&') || (char === '|' && next === '|')) return true;
  }
  return false;
}

function isPowerShellCommandName(name: string): boolean {
  return name.includes('-') || ['gc', 'gci', 'sls', 'select'].includes(name);
}

function isPowerShellReadCommand(name: string): boolean {
  return name === 'get-content' || name === 'gc';
}

function isPowerShellSearchCommand(name: string): boolean {
  return name === 'select-string' || name === 'sls';
}

function isPowerShellListCommand(name: string): boolean {
  return name === 'get-childitem' || name === 'gci';
}

function isReadOnlyPowerShellPipelineCommand(name: string): boolean {
  if (isPowerShellReadCommand(name) || isPowerShellSearchCommand(name) || isPowerShellListCommand(name)) return true;
  return [
    'select-object',
    'sort-object',
    'where-object',
    'format-table',
    'format-list',
    'measure-object',
    'convertto-json',
    'out-string',
  ].includes(name);
}

function normalizeFilePath(rawInput: UnknownRecord): string {
  const filePath = rawInput.filePath ?? rawInput.file_path ?? rawInput.filepath ?? rawInput.file ?? rawInput.path;
  return typeof filePath === 'string' ? filePath : '';
}

function extractTaggedToolValue(text: string, tag: string): string {
  if (!text) return '';
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return String(match?.[1] || '').trim();
}

function extractToolPath(raw: unknown): string {
  if (typeof raw === 'string') return extractTaggedToolValue(raw, 'path') || extractSkillMdPathFromCommand(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const obj = raw as UnknownRecord;
  return normalizeFilePath(obj)
    || (typeof obj.command === 'string' ? extractSkillMdPathFromCommand(obj.command) : '')
    || extractTaggedToolValue(typeof obj.output === 'string' ? obj.output : '', 'path')
    || extractTaggedToolValue(typeof obj.content === 'string' ? obj.content : '', 'path')
    || extractTaggedToolValue(typeof obj.text === 'string' ? obj.text : '', 'path')
    || extractTaggedToolValue(typeof obj.result === 'string' ? obj.result : '', 'path');
}

function getSkillReadInfo(toolName: string, raw: unknown): null | { filePath: string; name: string } {
  if (!['read', 'bash', 'cmd', 'powershell'].includes(toolName)) return null;
  const filePath = extractToolPath(raw).trim();
  if (!/(^|[/\\])SKILL\.md$/i.test(filePath)) return null;
  const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const name = parts.length >= 2 ? parts[parts.length - 2] : '';
  return { filePath, name };
}

function extractSkillMdPathFromCommand(command: string): string {
  const text = String(command || '');
  if (!/SKILL\.md/i.test(text)) return '';
  const match = text.match(/"([^"]*[/\\]SKILL\.md)"|'([^']*[/\\]SKILL\.md)'|`([^`]*[/\\]SKILL\.md)`|([^\s"'`;&|<>]+[/\\]SKILL\.md)/i);
  const raw = String(match?.[1] || match?.[2] || match?.[3] || match?.[4] || '').trim();
  return raw.replace(/[),\]]+$/g, '');
}

function extractExitCode(raw: UnknownRecord): number | undefined {
  if (typeof raw.exitCode === 'number') return raw.exitCode;
  if (typeof raw.exit_code === 'number') return raw.exit_code;
  if (typeof raw.exit === 'number') return raw.exit;
  if (typeof raw.exit_status === 'string') {
    const match = raw.exit_status.match(/(-?\d+)/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function isFileMutationTool(toolName: string): boolean {
  return ['write', 'edit', 'multiedit', 'patch'].includes(toolName);
}

function lineCount(value: string): number {
  return value ? value.split(/\r?\n/).length : 0;
}

function finiteLineCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function extractFileChangeLineStats(
  source: UnknownRecord,
  oldText: string,
  newText: string,
  content: string,
): Pick<AceNormalizedFileChange, 'changedLines' | 'addedLines' | 'removedLines'> {
  const changedLines = finiteLineCount(source.changedLines ?? source.changed_lines);
  const addedLines = finiteLineCount(source.addedLines ?? source.added_lines);
  const removedLines = finiteLineCount(source.removedLines ?? source.removed_lines);
  if (changedLines !== undefined || addedLines !== undefined || removedLines !== undefined) {
    return {
      ...(changedLines !== undefined ? { changedLines } : {}),
      ...(addedLines !== undefined ? { addedLines } : {}),
      ...(removedLines !== undefined ? { removedLines } : {}),
    };
  }

  if (!oldText && !newText && !content) return {};
  const before = lineCount(oldText);
  const after = lineCount(newText || content);
  return {
    ...(Math.min(before, after) > 0 ? { changedLines: Math.min(before, after) } : {}),
    ...(Math.max(0, after - before) > 0 ? { addedLines: after - before } : {}),
    ...(Math.max(0, before - after) > 0 ? { removedLines: before - after } : {}),
  };
}

function compactFileChange(change: AceNormalizedFileChange): AceNormalizedFileChange {
  return {
    toolName: change.toolName,
    title: change.title,
    filePath: change.filePath,
    kind: change.kind,
    ...(change.changedLines !== undefined ? { changedLines: change.changedLines } : {}),
    ...(change.addedLines !== undefined ? { addedLines: change.addedLines } : {}),
    ...(change.removedLines !== undefined ? { removedLines: change.removedLines } : {}),
  };
}

export function normalizeAceFileChange(change: unknown): AceNormalizedFileChange | null {
  if (!change || typeof change !== 'object') return null;
  const source = change as UnknownRecord;
  const filePath = normalizeFilePath(source) || '(未知路径)';
  const kind = typeof source.kind === 'string'
    ? source.kind
    : (typeof source.type === 'string' ? source.type : (typeof source.action === 'string' ? source.action : 'update'));
  const oldText = typeof source.oldText === 'string'
    ? source.oldText
    : (typeof source.old_text === 'string' ? source.old_text : (typeof source.oldString === 'string' ? source.oldString : (typeof source.old_string === 'string' ? source.old_string : (typeof source.before === 'string' ? source.before : ''))));
  const newText = typeof source.newText === 'string'
    ? source.newText
    : (typeof source.new_text === 'string' ? source.new_text : (typeof source.newString === 'string' ? source.newString : (typeof source.new_string === 'string' ? source.new_string : (typeof source.after === 'string' ? source.after : ''))));
  const content = typeof source.content === 'string' ? source.content : '';
  const lineStats = extractFileChangeLineStats(source, oldText, newText, content);

  if (newText && !oldText) {
    return {
      toolName: 'write',
      title: getAceToolTitle('write'),
      filePath,
      content: newText,
      kind,
      ...lineStats,
    };
  }

  if (oldText || newText) {
    return {
      toolName: 'edit',
      title: getAceToolTitle('edit'),
      filePath,
      oldString: oldText,
      newString: newText,
      kind,
      ...lineStats,
    };
  }

  if (content) {
    return {
      toolName: 'write',
      title: getAceToolTitle('write'),
      filePath,
      content,
      kind,
      ...lineStats,
    };
  }

  if (kind === 'add') {
    return {
      toolName: 'write',
      title: '📝 文件变更',
      filePath,
      content: '',
      kind,
      ...lineStats,
    };
  }

  return {
    toolName: 'edit',
    title: '📝 文件变更',
    filePath,
    kind,
    ...lineStats,
  };
}

export function formatAceFileChangesResult(params: {
  changes: unknown[];
  fallbackToolName?: string;
  fallbackTitle?: string;
  output?: string;
  toolId?: string;
}): string {
  const normalized = params.changes
    .map((change) => normalizeAceFileChange(change))
    .filter((change): change is AceNormalizedFileChange => Boolean(change));
  if (normalized.length === 0 && !params.output) return '';

  const mutationTool = isFileMutationTool(params.fallbackToolName || normalized[0]?.toolName || '');
  const displayChanges = mutationTool ? normalized.map(compactFileChange) : normalized;
  const primary = displayChanges[0];
  const block = wrapAceProcessBlock('tool-result', {
    toolName: primary?.toolName || params.fallbackToolName || 'edit',
    title: primary?.title || params.fallbackTitle || getAceToolTitle(params.fallbackToolName || 'edit'),
    changes: displayChanges,
    output: !mutationTool && params.output ? safeToolResultText(params.output) : '',
    ...(displayChanges.length === 1 ? primary : {}),
  }, '');
  return appendToolIdToAceBlock(block, params.toolId);
}

function compactFileChanges(value: unknown): AceNormalizedFileChange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((change) => normalizeAceFileChange(change))
    .filter((change): change is AceNormalizedFileChange => Boolean(change))
    .map(compactFileChange);
}

export function formatAceToolCall(params: {
  toolName: string;
  rawInput?: Record<string, unknown>;
  title?: string;
  toolId?: string;
}): string {
  const rawInput = params.rawInput || {};
  const skillReadInfo = getSkillReadInfo(params.toolName || 'tool', rawInput);
  const toolName = skillReadInfo ? 'skill' : (params.toolName || 'tool');
  const title = params.title || getAceToolTitle(toolName);
  const changes = compactFileChanges(rawInput.changes);

  let block = '';
  switch (toolName) {
    case 'task':
      block = formatAceSubtaskStart({
        title: inputText(rawInput.description, title),
        description: inputText(rawInput.description, title),
        agent: inputText(rawInput.subagent_type ?? rawInput.subagentType ?? rawInput.agent),
        prompt: inputText(rawInput.prompt),
        toolId: params.toolId,
        sessionId: inputText(rawInput.sessionId),
      });
      break;
    case 'bash':
    case 'cmd':
    case 'powershell':
      block = wrapAceProcessBlock('tool-call', { toolName, title, command: inputText(rawInput.command) }, '');
      break;
    case 'write':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        filePath: normalizeFilePath(rawInput),
        ...(changes.length > 0 ? { changes } : {}),
      }, '');
      break;
    case 'edit':
    case 'multiedit':
    case 'patch':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        filePath: normalizeFilePath(rawInput),
        ...(changes.length > 0 ? { changes } : {}),
      }, '');
      break;
    case 'read':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        filePath: normalizeFilePath(rawInput),
        command: typeof rawInput.command === 'string' ? rawInput.command : undefined,
      }, '');
      break;
    case 'glob':
    case 'grep':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        pattern: inputText(rawInput.pattern),
        path: inputText(rawInput.path ?? rawInput.filePath ?? rawInput.file_path),
        include: inputText(rawInput.include),
        command: typeof rawInput.command === 'string' ? rawInput.command : undefined,
      }, '');
      break;
    case 'ls':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        path: inputText(rawInput.path, '.'),
        command: typeof rawInput.command === 'string' ? rawInput.command : undefined,
      }, '');
      break;
    case 'todo':
    case 'todowrite':
    case 'plan':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        todos: Array.isArray(rawInput.todos || rawInput.items || rawInput.entries)
          ? (rawInput.todos || rawInput.items || rawInput.entries) as any[]
          : [],
      }, '');
      break;
    case 'webfetch':
      block = wrapAceProcessBlock('tool-call', { toolName, title, url: inputText(rawInput.url) }, '');
      break;
    case 'websearch':
      block = wrapAceProcessBlock('tool-call', { toolName, title, query: inputText(rawInput.query) }, '');
      break;
    case 'skill':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        name: skillReadInfo?.name || inputText(rawInput.name ?? rawInput.skill ?? rawInput.id),
        filePath: skillReadInfo?.filePath || undefined,
        input: rawInput,
      }, '');
      break;
    default:
      block = wrapAceProcessBlock('tool-call', { toolName, title, input: rawInput }, '');
      break;
  }

  return appendToolIdToAceBlock(block, params.toolId);
}

export function formatAceToolResult(params: {
  toolName: string;
  rawOutput: unknown;
  title?: string;
  toolId?: string;
}): string {
  const skillReadInfo = getSkillReadInfo(params.toolName || 'tool', params.rawOutput);
  const toolName = skillReadInfo ? 'skill' : (params.toolName || 'tool');
  const title = params.title || getAceToolTitle(toolName);
  const raw = params.rawOutput;

  if (toolName === 'task') {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const obj = raw as UnknownRecord;
      const sessionId = String(
        obj.sessionId
          ?? obj.session_id
          ?? obj.taskId
          ?? obj.task_id
          ?? '',
      ).trim();
      const resultText = safeToolResultText(extractTextFromUnknown(
        obj.resultText
          ?? obj.result_text
          ?? obj.result
          ?? obj.output
          ?? obj.message
          ?? obj.text
          ?? '',
      ).trim());
      if (sessionId || resultText) {
        return formatAceSubtaskResult({ sessionId, resultText, toolId: params.toolId });
      }
    }
    const text = safeToolResultText(extractTextFromUnknown(raw).trim());
    if (!text) return '';
    return formatAceSubtaskResult({ resultText: text, toolId: params.toolId });
  }

  if (toolName === 'plan' || toolName === 'todo' || toolName === 'todowrite') {
    const todos = extractPlanEntriesFromRawOutput(raw);
    if (todos.length > 0) {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        todos,
      }, ''), params.toolId);
    }
  }

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as UnknownRecord;
    if (obj.error) {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        error: true,
        errorText: String(obj.error),
      }, ''), params.toolId);
    }
    if (Array.isArray(obj.changes)) {
      return formatAceFileChangesResult({
        changes: obj.changes,
        fallbackToolName: toolName,
        fallbackTitle: title,
        output: isFileMutationTool(toolName) ? '' : extractTextFromUnknown(obj.output),
        toolId: params.toolId,
      });
    }
    if (isFileMutationTool(toolName)) {
      const filePath = normalizeFilePath(obj);
      const exitCode = extractExitCode(obj);
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        ...(filePath ? { filePath } : {}),
        ...(exitCode != null ? { exitCode } : {}),
      }, ''), params.toolId);
    }
    if (toolName === 'read') {
      const filePath = normalizeFilePath(obj);
      const exitCode = extractExitCode(obj);
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        ...(filePath ? { filePath } : {}),
        ...(exitCode != null ? { exitCode } : {}),
      }, ''), params.toolId);
    }
    if (typeof obj.content === 'string' && toolName === 'skill') {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        name: skillReadInfo?.name || '',
        filePath: skillReadInfo?.filePath || normalizeFilePath(obj),
        content: safeToolResultText(obj.content),
      }, ''), params.toolId);
    }
    if (typeof obj.content === 'string' && toolName === 'read') {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        filePath: normalizeFilePath(obj),
      }, ''), params.toolId);
    }
    if (Array.isArray(obj.todos)) {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        todos: obj.todos as any[],
      }, ''), params.toolId);
    }
    if (Array.isArray(obj.modified_files)) {
      return formatAceFileChangesResult({
        changes: obj.modified_files.map((filePath) => ({ filePath, kind: 'update' })),
        fallbackToolName: toolName,
        fallbackTitle: title,
        toolId: params.toolId,
      });
    }
    if (toolName === 'skill') {
      const rawText = extractTextFromUnknown(obj.output ?? obj.result ?? obj.text ?? obj.message ?? '').trim();
      const content = safeToolResultText(extractTaggedToolValue(rawText, 'content') || rawText);
      if (content) {
        return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
          toolName,
          title,
          name: skillReadInfo?.name || '',
          filePath: skillReadInfo?.filePath || normalizeFilePath(obj),
          content,
        }, ''), params.toolId);
      }
    }
    if ('totalMatches' in obj || 'numMatches' in obj) {
      const totalMatches = String(obj.totalMatches ?? obj.numMatches);
      const totalFiles = obj.totalFiles ?? obj.numFiles;
      const results = Array.isArray(obj.results)
        ? obj.results
            .slice(0, 15)
            .map((item) => {
              if (!item || typeof item !== 'object') return String(item);
              const row = item as UnknownRecord;
              const file = typeof row.file === 'string' ? row.file : '';
              const count = row.count != null ? String(row.count) : '';
              return count ? `${file} (${count})` : file;
            })
            .filter(Boolean)
        : [];
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        output: [
          `找到 ${totalMatches} 个匹配${totalFiles != null ? `，${String(totalFiles)} 个文件` : ''}${obj.truncated ? ' (已截断)' : ''}`,
          ...results,
        ].filter(Boolean).join('\n'),
      }, ''), params.toolId);
    }
    if ('totalFiles' in obj) {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        output: `找到 ${String(obj.totalFiles)} 个文件${obj.truncated ? ' (已截断)' : ''}`,
      }, ''), params.toolId);
    }
    if (
      typeof obj.formatted_output === 'string'
      || typeof obj.formattedOutput === 'string'
      || typeof obj.output === 'string'
      || typeof obj.stdout === 'string'
      || typeof obj.stderr === 'string'
    ) {
      const stdout = typeof obj.stdout === 'string' ? obj.stdout : '';
      const stderr = typeof obj.stderr === 'string' ? obj.stderr : '';
      const formattedOutput = typeof obj.formatted_output === 'string'
        ? obj.formatted_output
        : (typeof obj.formattedOutput === 'string' ? obj.formattedOutput : '');
      const output = safeToolResultText(
        formattedOutput
        || (typeof obj.output === 'string' ? obj.output : [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : '')),
      );
      const exitCode = extractExitCode(obj);
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', { toolName, title, output, exitCode }, ''), params.toolId);
    }
    if (obj.completed === true || obj.status === 'completed' || obj.resultUnavailable === true) {
      const filePath = normalizeFilePath(obj);
      const exitCode = extractExitCode(obj);
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        ...(filePath ? { filePath } : {}),
        ...(exitCode != null ? { exitCode } : {}),
      }, ''), params.toolId);
    }
  }

  const text = safeToolResultText(extractTextFromUnknown(raw).trim());
  if (!text) return '';
  if (toolName === 'read') {
    return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', { toolName, title }, ''), params.toolId);
  }
  if (toolName === 'skill') {
    return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
      toolName,
      title,
      name: skillReadInfo?.name || '',
      filePath: skillReadInfo?.filePath || '',
      content: extractTaggedToolValue(text, 'content') || text,
    }, ''), params.toolId);
  }
  return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', { toolName, title, output: text }, ''), params.toolId);
}
