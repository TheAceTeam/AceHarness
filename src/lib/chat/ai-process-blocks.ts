export type AceProcessKind =
  | 'reasoning'
  | 'tool-call'
  | 'tool-result'
  | 'subtask-start'
  | 'subtask-result';

type AceProcessBase<K extends AceProcessKind> = {
  kind: K;
  body?: string;
};

export type AceTodoItem = {
  content: string;
  status?: string;
};

export type AceFileChange = {
  toolName?: string;
  title?: string;
  filePath?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  kind?: string;
};

export type AceReasoningPayload = AceProcessBase<'reasoning'> & {
};

export type AceToolCallPayload = AceProcessBase<'tool-call'> & {
  toolName: string;
  title: string;
  toolId?: string;
  command?: string;
  filePath?: string;
  content?: string;
  oldString?: string;
  newString?: string;
  pattern?: string;
  path?: string;
  include?: string;
  url?: string;
  query?: string;
  todos?: AceTodoItem[];
  input?: unknown;
};

export type AceToolResultPayload = AceProcessBase<'tool-result'> & {
  toolName: string;
  title: string;
  toolId?: string;
  output?: string;
  exitCode?: number;
  filePath?: string;
  content?: string;
  todos?: AceTodoItem[];
  changes?: AceFileChange[];
  error?: boolean;
  errorText?: string;
  errorMessage?: string;
  message?: string;
};

export type AceSubtaskStartPayload = AceProcessBase<'subtask-start'> & {
  title: string;
  description?: string;
  agent?: string;
  prompt?: string;
  toolId?: string;
  sessionId?: string;
};

export type AceSubtaskResultPayload = AceProcessBase<'subtask-result'> & {
  sessionId?: string;
  resultText?: string;
  toolId?: string;
};

export type AceProcessPayload =
  | AceReasoningPayload
  | AceToolCallPayload
  | AceToolResultPayload
  | AceSubtaskStartPayload
  | AceSubtaskResultPayload;

export interface AceProcessBlock<T extends AceProcessPayload = AceProcessPayload> {
  kind: T['kind'];
  body: string;
  meta: T;
  raw: string;
  start: number;
  end: number;
}

const ACE_PROCESS_BLOCK_RE = /<ace-process>\s*([\s\S]*?)\s*<\/ace-process>/g;
function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asTodoItems(value: unknown): AceTodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    if (!isObjectRecord(item)) return { content: String(item || '') };
    return {
      content: typeof item.content === 'string' ? item.content : String(item.content || item.text || item.title || ''),
      status: asString(item.status),
    };
  });
}

function asFileChanges(value: unknown): AceFileChange[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const raw = isObjectRecord(item) ? item : {};
    return {
      toolName: asString(raw.toolName),
      title: asString(raw.title),
      filePath: asString(raw.filePath),
      content: asString(raw.content),
      oldString: asString(raw.oldString),
      newString: asString(raw.newString),
      kind: asString(raw.kind),
    };
  });
}

function normalizePayload(raw: unknown): AceProcessPayload | null {
  if (!isObjectRecord(raw)) return null;
  const kind = asString(raw.kind);
  const body = asString(raw.body) || '';

  switch (kind) {
    case 'reasoning':
      return {
        kind,
        body,
      };
    case 'tool-call':
      if (!asString(raw.toolName) || !asString(raw.title)) return null;
      return {
        kind,
        body,
        toolName: asString(raw.toolName)!,
        title: asString(raw.title)!,
        toolId: asString(raw.toolId),
        command: asString(raw.command),
        filePath: asString(raw.filePath),
        content: asString(raw.content),
        oldString: asString(raw.oldString),
        newString: asString(raw.newString),
        pattern: asString(raw.pattern),
        path: asString(raw.path),
        include: asString(raw.include),
        url: asString(raw.url),
        query: asString(raw.query),
        todos: asTodoItems(raw.todos),
        input: raw.input,
      };
    case 'tool-result':
      if (!asString(raw.toolName) || !asString(raw.title)) return null;
      return {
        kind,
        body,
        toolName: asString(raw.toolName)!,
        title: asString(raw.title)!,
        toolId: asString(raw.toolId),
        output: asString(raw.output),
        exitCode: asNumber(raw.exitCode),
        filePath: asString(raw.filePath),
        content: asString(raw.content),
        todos: asTodoItems(raw.todos),
        changes: asFileChanges(raw.changes),
        error: asBoolean(raw.error),
        errorText: asString(raw.errorText),
        errorMessage: asString(raw.errorMessage),
        message: asString(raw.message),
      };
    case 'subtask-start':
      if (!asString(raw.title)) return null;
      return {
        kind,
        body,
        title: asString(raw.title)!,
        description: asString(raw.description),
        agent: asString(raw.agent),
        prompt: asString(raw.prompt),
        toolId: asString(raw.toolId),
        sessionId: asString(raw.sessionId),
      };
    case 'subtask-result':
      return {
        kind,
        body,
        sessionId: asString(raw.sessionId),
        resultText: asString(raw.resultText),
        toolId: asString(raw.toolId),
      };
    default:
      return null;
  }
}

export function wrapAceProcessBlock<T extends AceProcessPayload>(kind: T['kind'], payload: Omit<T, 'kind' | 'body'>, body = ''): string {
  return `\n<ace-process>${JSON.stringify({ kind, ...payload, body })}</ace-process>\n`;
}

export function extractAceProcessBlocks(content: string): {
  cleanText: string;
  blocks: AceProcessBlock[];
} {
  const source = String(content || '');
  const blocks: AceProcessBlock[] = [];

  const withoutAceBlocks = source.replace(ACE_PROCESS_BLOCK_RE, (raw, payloadJson, offset) => {
    let payload: AceProcessPayload | null = null;
    try {
      payload = normalizePayload(JSON.parse(payloadJson));
    } catch {
      payload = null;
    }

    if (payload) {
      blocks.push({
        kind: payload.kind,
        body: payload.kind === 'reasoning'
          ? String(payload.body || '')
          : String(payload.body || '').trim(),
        meta: payload,
        raw: String(raw),
        start: Number(offset) || 0,
        end: (Number(offset) || 0) + String(raw).length,
      });
    }

    return '\n';
  });

  return {
    cleanText: withoutAceBlocks.replace(/\n{3,}/g, '\n\n').trim(),
    blocks,
  };
}
