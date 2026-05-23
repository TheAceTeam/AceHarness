import { wrapAceProcessBlock } from '@/lib/chat/ai-process-blocks';
import { repairWindowsMojibake } from '@/lib/core/mojibake-repair';

type UnknownRecord = Record<string, unknown>;

export type AceNormalizedFileChange = {
  toolName: 'write' | 'edit';
  title: string;
  filePath: string;
  content?: string;
  oldString?: string;
  newString?: string;
  kind?: string;
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
  'webfetch',
  'websearch',
  'ls',
  'skill',
  'multiedit',
  'patch',
]);

function normalizeToolText(value: string): string {
  return repairWindowsMojibake(value);
}

export function getAceToolTitle(toolName: string): string {
  const titleMap: Record<string, string> = {
    bash: '💻 执行命令',
    cmd: '💻 执行命令',
    powershell: '💻 执行命令',
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
    skill: '技能文档',
  };
  return titleMap[toolName] || `🔧 ${toolName}`;
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

export function formatAceReasoning(text: string): string {
  return wrapAceProcessBlock('reasoning', {}, text || '');
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
  return block.replace(
    /<ace-process>([\s\S]*?)<\/ace-process>/,
    (raw, payloadJson) => {
      try {
        const payload = JSON.parse(payloadJson);
        return `<ace-process>${JSON.stringify({ ...payload, toolId })}</ace-process>`;
      } catch {
        return raw;
      }
    },
  );
}

export function resolveAceToolName(titleOrName: string, rawInput?: UnknownRecord): string {
  const title = String(titleOrName || '').trim().toLowerCase();
  const input = rawInput || {};
  if (KNOWN_TOOLS.has(title)) return title;

  const command = typeof input.command === 'string' ? input.command : '';
  if (command) return inferCommandToolName(command);
  if ('content' in input && ('filePath' in input || 'path' in input) && !('oldString' in input) && !('old_string' in input)) return 'write';
  if ('oldString' in input || 'newString' in input || 'old_string' in input || 'new_string' in input) return 'edit';
  if ('todos' in input || 'items' in input) return 'todowrite';
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

export function inferCommandToolName(command: string): 'bash' | 'cmd' | 'powershell' | 'read' | 'grep' | 'ls' {
  const normalized = String(command || '').trim().toLowerCase();
  if (!normalized) return 'bash';

  const powerShellMarkers = [
    'get-childitem',
    'select-string',
    'get-content',
    'gc ',
    'gc -',
    'gci ',
    'gci -',
    'sls ',
    'sls -',
    'set-content',
    'add-content',
    'remove-item',
    'move-item',
    'copy-item',
    '$env:',
    'start-process',
  ];
  if (powerShellMarkers.some((marker) => normalized.includes(marker))) {
    if (normalized.includes('get-content') || /^gc\b/.test(normalized)) return 'read';
    if (normalized.includes('select-string') || /^sls\b/.test(normalized)) return 'grep';
    if (normalized.includes('get-childitem') || /^gci\b/.test(normalized)) return 'ls';
    return 'powershell';
  }

  if (/^(dir|type|more|findstr|copy|move|del|erase|ren|rename|where)\b/.test(normalized) || normalized.includes('cmd /c')) {
    if (/^(type)\b/.test(normalized)) return 'read';
    if (/^(more)\b/.test(normalized)) return 'read';
    if (/^(findstr)\b/.test(normalized)) return 'grep';
    if (/^(dir|where)\b/.test(normalized)) return 'ls';
    return 'cmd';
  }

  if (/(\brg\b|\bgrep\b|\bag\b|\back\b|\bfd\b|findstr )/.test(normalized)) return 'grep';
  if (/(\bls\b|\bfind\b|\bdir\b|\bstat\b|\bpwd\b|\btree\b|\beza\b|\bexa\b)/.test(normalized)) return 'ls';
  if (/(\bcat\b|\bsed\b|\bhead\b|\btail\b|\bless\b|\bmore\b|\bbat\b)/.test(normalized)) return 'read';
  return 'bash';
}

function normalizeFilePath(rawInput: UnknownRecord): string {
  const filePath = rawInput.filePath ?? rawInput.file_path ?? rawInput.filepath ?? rawInput.file ?? rawInput.path;
  return typeof filePath === 'string' ? filePath : '';
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

  if (newText && !oldText) {
    return {
      toolName: 'write',
      title: getAceToolTitle('write'),
      filePath,
      content: newText,
      kind,
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
    };
  }

  if (content) {
    return {
      toolName: 'write',
      title: getAceToolTitle('write'),
      filePath,
      content,
      kind,
    };
  }

  if (kind === 'add') {
    return {
      toolName: 'write',
      title: '📝 文件变更',
      filePath,
      content: '',
      kind,
    };
  }

  return {
    toolName: 'edit',
    title: '📝 文件变更',
    filePath,
    kind,
  };
}

export function formatAceFileChangesResult(params: {
  changes: unknown[];
  fallbackToolName?: string;
  fallbackTitle?: string;
  output?: string;
}): string {
  const normalized = params.changes
    .map((change) => normalizeAceFileChange(change))
    .filter((change): change is AceNormalizedFileChange => Boolean(change));
  if (normalized.length === 0 && !params.output) return '';

  const primary = normalized[0];
  return wrapAceProcessBlock('tool-result', {
    toolName: primary?.toolName || params.fallbackToolName || 'edit',
    title: primary?.title || params.fallbackTitle || getAceToolTitle(params.fallbackToolName || 'edit'),
    changes: normalized,
    output: params.output || '',
    ...(normalized.length === 1 ? primary : {}),
  }, '');
}

export function formatAceToolCall(params: {
  toolName: string;
  rawInput?: Record<string, unknown>;
  title?: string;
  toolId?: string;
}): string {
  const toolName = params.toolName || 'tool';
  const rawInput = params.rawInput || {};
  const title = params.title || getAceToolTitle(toolName);

  let block = '';
  switch (toolName) {
    case 'task':
      block = formatAceSubtaskStart({
        title: String(rawInput.description || title || ''),
        description: String(rawInput.description || title || ''),
        agent: String(rawInput.subagent_type || rawInput.subagentType || rawInput.agent || ''),
        prompt: String(rawInput.prompt || ''),
        toolId: params.toolId,
        sessionId: String(rawInput.sessionId || ''),
      });
      break;
    case 'bash':
    case 'cmd':
    case 'powershell':
      block = wrapAceProcessBlock('tool-call', { toolName, title, command: String(rawInput.command || '') }, '');
      break;
    case 'write':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        filePath: normalizeFilePath(rawInput),
        content: String(rawInput.content || rawInput.text || rawInput.new_string || rawInput.newString || ''),
      }, '');
      break;
    case 'edit':
    case 'multiedit':
    case 'patch':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        filePath: normalizeFilePath(rawInput),
        oldString: String(rawInput.old_string || rawInput.oldString || ''),
        newString: String(rawInput.new_string || rawInput.newString || ''),
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
        pattern: String(rawInput.pattern || ''),
        path: String(rawInput.path || rawInput.filePath || rawInput.file_path || ''),
        include: String(rawInput.include || ''),
        command: typeof rawInput.command === 'string' ? rawInput.command : undefined,
      }, '');
      break;
    case 'ls':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        path: String(rawInput.path || '.'),
        command: typeof rawInput.command === 'string' ? rawInput.command : undefined,
      }, '');
      break;
    case 'todo':
    case 'todowrite':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        todos: Array.isArray(rawInput.todos || rawInput.items) ? (rawInput.todos || rawInput.items) as any[] : [],
      }, '');
      break;
    case 'webfetch':
      block = wrapAceProcessBlock('tool-call', { toolName, title, url: String(rawInput.url || '') }, '');
      break;
    case 'websearch':
      block = wrapAceProcessBlock('tool-call', { toolName, title, query: String(rawInput.query || '') }, '');
      break;
    case 'skill':
      block = wrapAceProcessBlock('tool-call', {
        toolName,
        title,
        name: String(rawInput.name || rawInput.skill || rawInput.id || ''),
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
  const toolName = params.toolName || 'tool';
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
      const resultText = extractTextFromUnknown(
        obj.resultText
          ?? obj.result_text
          ?? obj.result
          ?? obj.output
          ?? obj.message
          ?? obj.text
          ?? '',
      ).trim();
      if (sessionId || resultText) {
        return formatAceSubtaskResult({ sessionId, resultText, toolId: params.toolId });
      }
    }
    const text = extractTextFromUnknown(raw).trim();
    if (!text) return '';
    return formatAceSubtaskResult({ resultText: text, toolId: params.toolId });
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
        output: extractTextFromUnknown(obj.output),
      });
    }
    if (typeof obj.content === 'string' && toolName === 'read') {
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', {
        toolName,
        title,
        filePath: normalizeFilePath(obj),
        content: normalizeToolText(obj.content),
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
      });
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
      typeof obj.output === 'string'
      || typeof obj.stdout === 'string'
      || typeof obj.stderr === 'string'
    ) {
      const stdout = typeof obj.stdout === 'string' ? obj.stdout : '';
      const stderr = typeof obj.stderr === 'string' ? obj.stderr : '';
      const output = normalizeToolText(typeof obj.output === 'string' ? obj.output : [stdout, stderr].filter(Boolean).join(stdout && stderr ? '\n' : ''));
      const exitCode = extractExitCode(obj);
      return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', { toolName, title, output, exitCode }, ''), params.toolId);
    }
  }

  const text = extractTextFromUnknown(raw).trim();
  if (!text) return '';
  return appendToolIdToAceBlock(wrapAceProcessBlock('tool-result', { toolName, title, output: text }, ''), params.toolId);
}
