import {
  generateMessageId,
  normalizeToUIMessage,
  type MessagePart,
  type ModelMessage,
  type StreamChunk,
  type ToolCall,
  type UIMessage,
} from '@tanstack/ai';
import { agentMessagesCollection, upsertAgentMessage, type AgentMessageRow } from '../db/collections';
import { parseSseJsonEventData } from '@/lib/core/sse-event-data';
import { mergeRuntimeToolEvents, type RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';

export type AceAiMessage = UIMessage<{
  runId?: string;
  stepKey?: string;
  eventSeq?: number;
  diagnostics?: AceDiagnosticMetadata;
}>;

export type AceDiagnosticMetadata = {
  provider?: string;
  model?: string;
  sessionId?: string;
  latencyMs?: number;
  tokenUsage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  raw?: Record<string, unknown>;
};

export function createAceAiMessage(message: ModelMessage | UIMessage): AceAiMessage {
  return normalizeToUIMessage(message, () => generateMessageId()) as AceAiMessage;
}

export type AceToolCallState = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  arguments?: string;
  output?: unknown;
  error?: string;
};

export type AceStreamChunk = {
  id: string;
  role: 'assistant';
  content: string;
  status: AgentMessageRow['status'];
  chunk: string;
  toolCalls: Array<AceToolCallState>;
  toolEvents: Array<RuntimeToolEvent>;
  diagnostics?: AceDiagnosticMetadata;
};

type PreviousAceStreamChunk = Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> & {
  toolEvents?: Array<RuntimeToolEvent>;
};

export function normalizeAceStreamChunk(
  chunk: StreamChunk | Record<string, unknown>,
  previous?: PreviousAceStreamChunk,
): AceStreamChunk {
  const record = asRecord(chunk);
  const id = stringValue(record.id) || stringValue(record.messageId) || previous?.id || generateMessageId();
  const text = readChunkText(record);
  const status = readChunkStatus(record);
  const toolCalls = normalizeToolCalls([
    ...((previous?.toolCalls || []) as Array<AceToolCallState>),
    ...readToolCalls(record),
  ]);
  const toolEvents = mergeToolEventList(previous?.toolEvents || [], readRuntimeToolEvents(record));

  return {
    id,
    role: 'assistant',
    content: `${previous?.content || ''}${text}`,
    status,
    chunk: text,
    toolCalls,
    toolEvents,
    diagnostics: normalizeDiagnosticMetadata(record.metadata || record.diagnostics || record),
  };
}

export function normalizeToolCall(toolCall: ToolCall | MessagePart | AceToolCallState | Record<string, unknown>): AceToolCallState | null {
  const record = asRecord(toolCall);
  const fn = asRecord(record.function);
  const id = stringValue(record.id) || stringValue(record.toolCallId);
  const name = stringValue(record.name) || stringValue(fn.name);
  if (!id || !name) return null;

  return {
    id,
    name,
    status: normalizeToolStatus(stringValue(record.status) || stringValue(record.state)),
    arguments: stringValue(record.arguments) || stringValue(fn.arguments),
    output: record.output,
    error: stringValue(record.error),
  };
}

export function normalizeDiagnosticMetadata(input: unknown): AceDiagnosticMetadata | undefined {
  const record = asRecord(input);
  const usage = asRecord(record.usage || record.tokenUsage || record.tokens);
  const diagnostics: AceDiagnosticMetadata = {
    provider: stringValue(record.provider),
    model: stringValue(record.model),
    sessionId: stringValue(record.sessionId) || stringValue(record.session),
    latencyMs: numberValue(record.latencyMs) ?? numberValue(record.durationMs),
    tokenUsage: {
      input: numberValue(usage.input) ?? numberValue(usage.inputTokens) ?? numberValue(usage.promptTokens),
      output: numberValue(usage.output) ?? numberValue(usage.outputTokens) ?? numberValue(usage.completionTokens),
      total: numberValue(usage.total) ?? numberValue(usage.totalTokens),
    },
    raw: Object.keys(record).length > 0 ? record : undefined,
  };
  if (!diagnostics.tokenUsage?.input && !diagnostics.tokenUsage?.output && !diagnostics.tokenUsage?.total) {
    diagnostics.tokenUsage = undefined;
  }
  return Object.values(diagnostics).some((value) => value !== undefined) ? diagnostics : undefined;
}

export function agentMessageRowFromAiMessage(
  message: AceAiMessage,
  options: {
    runId?: string;
    stepKey?: string;
    status?: AgentMessageRow['status'];
    diagnostics?: AceDiagnosticMetadata;
  } = {},
): AgentMessageRow {
  const textParts = message.parts.filter((part): part is Extract<MessagePart, { type: 'text' }> => part.type === 'text');
  const toolCalls = message.parts
    .map((part) => normalizeToolCall(part))
    .filter((part): part is AceToolCallState => Boolean(part));
  const now = new Date().toISOString();
  return {
    id: message.id,
    runId: options.runId,
    stepKey: options.stepKey,
    role: message.role,
    status: options.status || 'done',
    content: textParts.map((part) => part.content).join(''),
    chunks: textParts.map((part) => part.content).filter(Boolean),
    toolCalls,
    toolEvents: [],
    diagnostics: options.diagnostics,
    createdAt: message.createdAt?.toISOString?.() || now,
    updatedAt: now,
  };
}

export function agentMessageRowFromStreamChunk(
  chunk: AceStreamChunk,
  options: { runId?: string; stepKey?: string } = {},
): AgentMessageRow {
  const now = new Date().toISOString();
  return {
    id: chunk.id,
    runId: options.runId,
    stepKey: options.stepKey,
    role: chunk.role,
    status: chunk.status,
    content: chunk.content,
    chunks: chunk.chunk ? [chunk.chunk] : [],
    toolCalls: chunk.toolCalls,
    toolEvents: chunk.toolEvents,
    diagnostics: chunk.diagnostics,
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeAceSseMessageEvent(
  eventName: string,
  data: string | Record<string, unknown>,
  previous?: PreviousAceStreamChunk,
): AceStreamChunk {
  const parsed = typeof data === 'string' ? parseSseJson(data) : data;
  const record = asRecord(parsed);
  const payload = asRecord(record.data || record.payload);
  const content = stringValue(record.content)
    || stringValue(record.text)
    || stringValue(record.delta)
    || stringValue(record.message)
    || stringValue(payload.content)
    || stringValue(payload.text)
    || stringValue(payload.delta)
    || '';
  const id = stringValue(record.id)
    || stringValue(record.messageId)
    || stringValue(record.chatId)
    || previous?.id
    || generateMessageId();

  return normalizeAceStreamChunk({
    ...payload,
    ...record,
    id,
    content,
    type: eventName,
    status: eventStatus(eventName, record),
    toolCalls: readSseToolCalls(record, payload),
    toolEvents: [...readRuntimeToolEvents(record), ...readRuntimeToolEvents(payload)],
    diagnostics: normalizeDiagnosticMetadata(record.diagnostics || record.metadata || payload.diagnostics || payload.metadata || record),
  }, previous);
}

export function storeAceAgentMessage(row: AgentMessageRow) {
  const existing = agentMessagesCollection.get(row.id);
  const next = existing ? {
    ...existing,
    ...row,
    toolCalls: normalizeToolCalls([...(existing.toolCalls || []), ...(row.toolCalls || [])]),
    toolEvents: mergeToolEventList(existing.toolEvents || [], row.toolEvents || []),
  } : row;
  upsertAgentMessage(next);
  return next;
}

export function storeWorkflowSseEventAsAgentMessage(
  event: Record<string, unknown>,
  previous?: PreviousAceStreamChunk,
) {
  const type = stringValue(event.type) || 'workflow-event';
  const data = asRecord(event.data);
  const payload = asRecord(data.payload || data.statusSnapshot || data);
  const runId = stringValue(data.runId)
    || stringValue(payload.runId)
    || stringValue(asRecord(data.statusSnapshot).runId)
    || stringValue(event.runId);
  const stepKey = stringValue(data.stepKey)
    || stringValue(data.step)
    || stringValue(payload.stepKey)
    || stringValue(payload.currentStep)
    || stringValue(payload.step)
    || stringValue(event.stepKey);
  const seq = numberValue(data.seq) ?? numberValue(event.seq);
  const chunk = normalizeAceSseMessageEvent(type, {
    ...payload,
    ...data,
    id: stringValue(data.messageId) || stringValue(data.id) || (runId || stepKey || seq !== undefined ? `workflow:${runId || 'unknown'}:${stepKey || 'event'}:${seq ?? type}` : undefined),
    content: readWorkflowEventContent(type, data, payload),
    diagnostics: normalizeDiagnosticMetadata(data.diagnostics || data.metadata || payload.diagnostics || payload.metadata || data),
  }, previous);
  return storeAceAgentMessage(agentMessageRowFromStreamChunk(chunk, { runId, stepKey }));
}

export function storeChatStreamSseEventAsAgentMessage(
  eventName: string,
  data: string | Record<string, unknown>,
  options: {
    chatId?: string;
    runId?: string;
    stepKey?: string;
    provider?: string;
    model?: string;
    sessionId?: string;
    frontendSessionId?: string;
    streamScope?: string;
  } = {},
  previous?: PreviousAceStreamChunk,
) {
  const record = typeof data === 'string' ? parseSseJson(data) : asRecord(data);
  const rawContent = stringValue(record.content)
    || stringValue(record.text)
    || stringValue(record.delta)
    || stringValue(record.result)
    || stringValue(record.output)
    || stringValue(record.error)
    || '';
  const nextContent = eventName === 'done' && previous?.content && rawContent.startsWith(previous.content)
    ? rawContent.slice(previous.content.length)
    : rawContent;
  const status = record.isError === true || eventName === 'error' ? 'error' : eventName === 'done' ? 'done' : 'streaming';
  const chunk = normalizeAceSseMessageEvent(eventName, {
    ...record,
    id: stringValue(record.id) || stringValue(record.messageId) || options.chatId || previous?.id,
    chatId: options.chatId || stringValue(record.chatId),
    content: nextContent,
    status,
    frontendSessionId: options.frontendSessionId || stringValue(record.frontendSessionId),
    streamScope: options.streamScope || stringValue(record.streamScope),
    diagnostics: normalizeDiagnosticMetadata({
      ...asRecord(record.diagnostics || record.metadata),
      provider: options.provider || stringValue(record.provider),
      model: options.model || stringValue(record.model),
      sessionId: options.sessionId || stringValue(record.sessionId),
      frontendSessionId: options.frontendSessionId || stringValue(record.frontendSessionId),
      streamScope: options.streamScope || stringValue(record.streamScope),
    }),
  }, previous);
  return storeAceAgentMessage(agentMessageRowFromStreamChunk(chunk, {
    runId: options.runId,
    stepKey: options.stepKey || options.streamScope,
  }));
}

export function parseAceSseEventData(data: string | null | undefined): Record<string, any> {
  return parseSseJson(data || '') as Record<string, any>;
}

function parseSseJson(data: string): Record<string, unknown> {
  return asRecord(parseSseJsonEventData(data));
}

function eventStatus(eventName: string, record: Record<string, unknown>) {
  const explicit = stringValue(record.status) || stringValue(record.state);
  if (explicit) return explicit;
  if (eventName === 'done') return 'done';
  if (eventName === 'failed' || eventName === 'engine_error' || eventName === 'error') return 'error';
  return 'streaming';
}

function readSseToolCalls(record: Record<string, unknown>, payload: Record<string, unknown>) {
  return [
    ...readToolCalls(record),
    ...readToolCalls(payload),
  ];
}

function mergeToolEventList(
  current: readonly RuntimeToolEvent[],
  incoming: readonly RuntimeToolEvent[],
): RuntimeToolEvent[] {
  let merged = [...current];
  for (const tool of incoming) merged = mergeRuntimeToolEvents(merged, tool);
  return merged;
}

function readRuntimeToolEvents(record: Record<string, unknown>): RuntimeToolEvent[] {
  const candidates = [
    record.tool,
    ...(Array.isArray(record.toolEvents) ? record.toolEvents : []),
  ];
  return candidates.flatMap((candidate) => {
    const tool = asRecord(candidate);
    const id = stringValue(tool.id);
    const toolName = stringValue(tool.toolName);
    const title = stringValue(tool.title);
    const status = stringValue(tool.status);
    if (!id || !toolName || !title || !['running', 'completed', 'failed'].includes(status || '')) return [];
    return [{
      ...(tool as RuntimeToolEvent),
      id,
      toolName,
      title,
      status: status as RuntimeToolEvent['status'],
    }];
  });
}

function readChunkText(record: Record<string, unknown>) {
  return stringValue(record.text)
    || stringValue(record.content)
    || stringValue(record.delta)
    || stringValue(record.value)
    || '';
}

function readWorkflowEventContent(
  type: string,
  data: Record<string, unknown>,
  payload: Record<string, unknown>,
) {
  return stringValue(data.content)
    || stringValue(data.text)
    || stringValue(data.delta)
    || stringValue(data.message)
    || stringValue(payload.content)
    || stringValue(payload.output)
    || stringValue(payload.message)
    || stringValue(payload.summary)
    || '';
}

function readChunkStatus(record: Record<string, unknown>): AgentMessageRow['status'] {
  const status = stringValue(record.status) || stringValue(record.state) || stringValue(record.type);
  if (status === 'error' || status === 'failed') return 'error';
  if (status === 'done' || status === 'complete' || status === 'finished') return 'done';
  return 'streaming';
}

function readToolCalls(record: Record<string, unknown>) {
  const calls = Array.isArray(record.toolCalls)
    ? record.toolCalls
    : Array.isArray(record.tool_calls)
      ? record.tool_calls
      : record.toolCall
        ? [record.toolCall]
        : [];
  return calls
    .map((call) => normalizeToolCall(call as Record<string, unknown>))
    .filter((call): call is AceToolCallState => Boolean(call));
}

function normalizeToolCalls(calls: Array<AceToolCallState>) {
  const byId = new Map<string, AceToolCallState>();
  calls.forEach((call) => byId.set(call.id, { ...byId.get(call.id), ...call }));
  return Array.from(byId.values());
}

function normalizeToolStatus(status?: string): AceToolCallState['status'] {
  if (status === 'complete' || status === 'success' || status === 'output-available') return 'success';
  if (status === 'error' || status === 'output-error') return 'error';
  if (status === 'input-streaming' || status === 'running') return 'running';
  return 'pending';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
