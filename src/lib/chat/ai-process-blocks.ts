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

const ACE_PROCESS_OPEN_TAG = '<ace-process>';
const ACE_PROCESS_CLOSE_TAG = '</ace-process>';
export const ACE_CHUNK_BOUNDARY = '\n\n<!-- chunk-boundary -->\n\n';

function neutralizeNestedAceProcessDelimiters(text: string): string {
  return String(text || '')
    .replace(/<ace-process>/g, '[ace-process]')
    .replace(/<\/ace-process>/g, '[/ace-process]');
}

function neutralizePayloadStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return neutralizeNestedAceProcessDelimiters(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => neutralizePayloadStrings(item)) as T;
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      normalized[key] = neutralizePayloadStrings(item);
    }
    return normalized as T;
  }
  return value;
}

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

function normalizePayload(rawInput: unknown): AceProcessPayload | null {
  const raw = neutralizePayloadStrings(rawInput);
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
  const serializedPayload = JSON.stringify(neutralizePayloadStrings({ ...payload, kind, body }));
  return `\n<ace-process>${serializedPayload}</ace-process>\n`;
}

type AceProcessRawSpan = {
  raw: string;
  payloadJson: string;
  start: number;
  end: number;
};

function findAceProcessRawSpans(content: string): AceProcessRawSpan[] {
  const source = String(content || '');
  const spans: AceProcessRawSpan[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const start = source.indexOf(ACE_PROCESS_OPEN_TAG, cursor);
    if (start < 0) break;

    let payloadStart = start + ACE_PROCESS_OPEN_TAG.length;
    while (payloadStart < source.length && /\s/.test(source[payloadStart] || '')) {
      payloadStart += 1;
    }

    if (source[payloadStart] !== '{') {
      cursor = start + ACE_PROCESS_OPEN_TAG.length;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    let payloadEnd = -1;

    for (let index = payloadStart; index < source.length; index += 1) {
      const char = source[index];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (char === '{') {
        depth += 1;
        continue;
      }
      if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          payloadEnd = index + 1;
          break;
        }
      }
    }

    if (payloadEnd < 0) {
      cursor = start + ACE_PROCESS_OPEN_TAG.length;
      continue;
    }

    let closeStart = payloadEnd;
    while (closeStart < source.length && /\s/.test(source[closeStart] || '')) {
      closeStart += 1;
    }

    if (!source.startsWith(ACE_PROCESS_CLOSE_TAG, closeStart)) {
      cursor = start + ACE_PROCESS_OPEN_TAG.length;
      continue;
    }

    const end = closeStart + ACE_PROCESS_CLOSE_TAG.length;
    spans.push({
      raw: source.slice(start, end),
      payloadJson: source.slice(payloadStart, payloadEnd),
      start,
      end,
    });
    cursor = end;
  }

  return spans;
}

function findNextAceProcessCandidateStart(source: string, fromIndex: number): number {
  let cursor = Math.max(0, fromIndex);
  while (cursor < source.length) {
    const start = source.indexOf(ACE_PROCESS_OPEN_TAG, cursor);
    if (start < 0) return -1;

    let payloadStart = start + ACE_PROCESS_OPEN_TAG.length;
    while (payloadStart < source.length && /\s/.test(source[payloadStart] || '')) {
      payloadStart += 1;
    }

    if (source[payloadStart] === '{') return start;
    cursor = start + ACE_PROCESS_OPEN_TAG.length;
  }
  return -1;
}

export function getAceProcessRanges(content: string): Array<[number, number]> {
  return findAceProcessRawSpans(content).map((span) => [span.start, span.end]);
}

export function stripAceProcessBlocks(content: string, replacement = ''): string {
  const source = String(content || '');
  const spans = findAceProcessRawSpans(source);
  if (!spans.length) return source;

  let cursor = 0;
  let result = '';
  for (const span of spans) {
    result += source.slice(cursor, span.start);
    result += replacement;
    cursor = span.end;
  }
  result += source.slice(cursor);
  return result;
}

export function getStreamingAceProcessReadyContent(content: string): string {
  const source = String(content || '');
  const spans = findAceProcessRawSpans(source);
  const searchFrom = spans.length > 0 ? spans[spans.length - 1].end : 0;
  const nextOpen = findNextAceProcessCandidateStart(source, searchFrom);
  return nextOpen >= 0 ? source.slice(0, nextOpen) : source;
}

function hasPendingAceProcessBlock(content: string): boolean {
  const source = String(content || '');
  if (!source) return false;
  return getStreamingAceProcessReadyContent(source).length < source.length;
}

export function mergeAceProcessChunkItems<T extends { content: string }>(
  items: T[],
  _joiner = ACE_CHUNK_BOUNDARY,
): T[] {
  const merged: T[] = [];
  let pending: T | null = null;

  for (const item of items) {
    const content = String(item.content || '');

    if (!pending) {
      if (hasPendingAceProcessBlock(content)) {
        pending = { ...item, content } as T;
      } else {
        merged.push(item);
      }
      continue;
    }

    const nextContent = `${pending.content}${content}`;
    pending = { ...pending, content: nextContent } as T;

    if (!hasPendingAceProcessBlock(nextContent)) {
      merged.push(pending);
      pending = null;
    }
  }

  if (pending) {
    const readyContent = getStreamingAceProcessReadyContent(pending.content);
    if (readyContent.trim()) {
      merged.push({ ...pending, content: readyContent } as T);
    }
  }

  return merged;
}

export function rewriteFirstAceProcessBlockPayload(
  content: string,
  rewrite: (payload: Record<string, unknown>) => Record<string, unknown>,
): string {
  const source = String(content || '');
  const span = findAceProcessRawSpans(source)[0];
  if (!span) return source;

  try {
    const payload = JSON.parse(span.payloadJson);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return source;
    const nextPayload = rewrite(payload as Record<string, unknown>);
    if (!nextPayload || typeof nextPayload !== 'object' || Array.isArray(nextPayload)) return source;
    return `${source.slice(0, span.start)}${ACE_PROCESS_OPEN_TAG}${JSON.stringify(nextPayload)}${ACE_PROCESS_CLOSE_TAG}${source.slice(span.end)}`;
  } catch {
    return source;
  }
}

export function extractAceProcessBlocks(content: string): {
  cleanText: string;
  blocks: AceProcessBlock[];
} {
  const source = String(content || '');
  const blocks: AceProcessBlock[] = [];

  const spans = findAceProcessRawSpans(source);
  for (const span of spans) {
    let payload: AceProcessPayload | null = null;
    try {
      payload = normalizePayload(JSON.parse(span.payloadJson));
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
        raw: span.raw,
        start: span.start,
        end: span.end,
      });
    }
  }

  return {
    cleanText: stripAceProcessBlocks(source, '\n').replace(/\n{3,}/g, '\n\n').trim(),
    blocks,
  };
}

function getOpenSubtaskCountAfterChunk(chunk: string, initialOpenCount: number): number {
  let openCount = Math.max(0, initialOpenCount);
  const { blocks } = extractAceProcessBlocks(chunk);
  for (const block of blocks) {
    if (block.kind === 'subtask-start') {
      openCount++;
    } else if (block.kind === 'subtask-result' && openCount > 0) {
      openCount--;
    }
  }
  return openCount;
}

export function mergeAceSubtaskChunkItems<T extends { content: string }>(
  items: T[],
  joiner = ACE_CHUNK_BOUNDARY,
): T[] {
  const merged: T[] = [];
  let pending: T | null = null;
  let openSubtasks = 0;

  for (const item of items) {
    const content = String(item.content || '');

    if (!pending) {
      const nextOpenSubtasks = getOpenSubtaskCountAfterChunk(content, 0);
      if (nextOpenSubtasks > 0) {
        pending = { ...item, content } as T;
        openSubtasks = nextOpenSubtasks;
      } else {
        merged.push(item);
      }
      continue;
    }

    pending = {
      ...pending,
      content: `${pending.content}${joiner}${content}`,
    };
    openSubtasks = getOpenSubtaskCountAfterChunk(content, openSubtasks);
    if (openSubtasks === 0) {
      merged.push(pending);
      pending = null;
    }
  }

  if (pending) {
    merged.push(pending);
  }

  return merged;
}

export function mergeAceSubtaskChunks(chunks: string[], joiner = ACE_CHUNK_BOUNDARY): string[] {
  return mergeAceSubtaskChunkItems(chunks.map((content) => ({ content: String(content || '') })), joiner)
    .map((item) => item.content);
}

export function mergeFinalRawStreamContent(streamedContent: string, rawOutput: string): string {
  const streamed = String(streamedContent || '').trim();
  const finalOutput = String(rawOutput || '').trim();

  if (!streamed) return finalOutput;
  if (!finalOutput) return streamed;
  if (finalOutput.includes(streamed)) return finalOutput;
  if (streamed.includes(finalOutput)) return streamed;

  const streamedBlocks = extractAceProcessBlocks(streamed).blocks;
  const finalBlocks = extractAceProcessBlocks(finalOutput).blocks;
  const existingBlocks = new Set(finalBlocks.map((block) => block.raw));
  const missingBlocks = streamedBlocks.filter((block) => !existingBlocks.has(block.raw));
  if (!missingBlocks.length) return finalOutput;

  const prefix = missingBlocks.map((block) => block.raw.trim()).filter(Boolean).join('\n\n').trim();
  if (!prefix) return finalOutput;
  return `${prefix}\n\n${finalOutput}`.trim();
}
