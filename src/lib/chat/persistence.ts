/**
 * 聊天会话持久化层
 * 新会话存储到 SQLite：data/chat-sessions.sqlite
 * 旧 JSON 文件保留只读兼容：data/chat-sessions/{sessionId}.json
 */

import { EventEmitter } from 'events';
import { mkdir, readFile, readdir, unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { createRequire } from 'module';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { extractLastChatPreview } from '@/lib/chat/message-preview';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import { normalizeSessionWorkbenchConversationMode, type HomeConversationMode } from '@/lib/chat/conversation-mode';

const CHAT_DIR = getWorkspaceDataFile('chat-sessions');
const CHAT_DB_PATH = getWorkspaceDataFile('chat-sessions.sqlite');
const nodeRequire = createRequire(import.meta.url);
const globalForChatSessionEvents = globalThis as unknown as {
  __chatSessionEvents?: EventEmitter;
  __chatSessionDb?: any;
};

export type ChatSessionEvent =
  | {
      type: 'updated';
      sessionId: string;
      updatedAt: number;
    }
  | {
      type: 'removed';
      sessionId: string;
      updatedAt: number;
    };

export const chatSessionEvents = globalForChatSessionEvents.__chatSessionEvents ??= new EventEmitter();
chatSessionEvents.setMaxListeners(200);

export interface PersistedAction {
  id: string;
  action: { type: string; params: Record<string, any>; description?: string };
  status: string;
  result?: any;
  snapshot?: any;
  error?: string;
  timestamp: number;
}

export interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  source?: {
    type: 'wechat';
    label?: string;
    direction?: 'inbound' | 'outbound';
  };
  actions?: PersistedAction[];
  cards?: any[];
  engine?: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  timestamp: number;
}

export interface WorkflowRunBinding {
  configFile: string;
  runId: string;
  supervisorAgent?: string;
  supervisorSessionId?: string | null;
  attachedAgentSessions?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowCreationBinding {
  creationSessionId: string;
  filename: string;
  workflowName: string;
  status: 'draft' | 'confirmed' | 'config-generated' | 'run-bound' | 'archived';
  specCodingId: string;
  updatedAt: number;
  createdAt: number;
}

export interface AgentChatBinding {
  agentName: string;
  team?: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  createdAt: number;
  updatedAt: number;
}

export interface PersistedChatSession {
  id: string;
  title: string;
  conversationMode?: HomeConversationMode;
  model: string;
  engine?: string;
  runtimeSessionId?: string;
  backendSessionId?: string;
  workflowBinding?: WorkflowRunBinding;
  creationSession?: WorkflowCreationBinding;
  agentBinding?: AgentChatBinding;
  sessionWorkbenchState?: SessionWorkbenchState;
  createdAt: number;
  updatedAt: number;
  messages: PersistedMessage[];
  createdBy?: string;
  visibility?: 'public' | 'private';
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  conversationMode?: HomeConversationMode;
  model: string;
  engine?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
  creationSession?: WorkflowCreationBinding;
  workflowBinding?: WorkflowRunBinding;
  agentBinding?: AgentChatBinding;
  sessionWorkbenchState?: SessionWorkbenchState;
  createdBy?: string;
  visibility?: 'public' | 'private';
}

function compareChatSessionSummary(a: ChatSessionSummary, b: ChatSessionSummary): number {
  const aPinned = Boolean(a.sessionWorkbenchState?.wechatBinding);
  const bPinned = Boolean(b.sessionWorkbenchState?.wechatBinding);
  if (aPinned !== bPinned) return aPinned ? -1 : 1;
  return b.updatedAt - a.updatedAt;
}

async function ensureDir() {
  if (!existsSync(CHAT_DIR)) {
    await mkdir(CHAT_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(CHAT_DIR, `${safeId}.json`);
}

function stableJson(input: any): string {
  return JSON.stringify(input ?? null);
}

function parseJson<T>(input: string | null | undefined): T | undefined {
  if (!input) return undefined;
  try {
    return JSON.parse(input) as T;
  } catch {
    return undefined;
  }
}

function getChatDb(): any {
  if (globalForChatSessionEvents.__chatSessionDb) return globalForChatSessionEvents.__chatSessionDb;
  const BetterSqlite = nodeRequire('better-sqlite3') as any;
  mkdirSync(dirname(CHAT_DB_PATH), { recursive: true });
  const db = new BetterSqlite(CHAT_DB_PATH, { timeout: 5000 });
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      conversation_mode TEXT,
      model TEXT NOT NULL,
      engine TEXT,
      runtime_session_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL DEFAULT 0,
      last_message TEXT,
      created_by TEXT,
      visibility TEXT,
      workflow_run_id TEXT,
      workflow_binding_json TEXT,
      creation_session_json TEXT,
      agent_binding_json TEXT,
      session_workbench_state_json TEXT,
      session_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_by ON chat_sessions(created_by);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_workflow_run_id ON chat_sessions(workflow_run_id);
  `);
  globalForChatSessionEvents.__chatSessionDb = db;
  return db;
}

function rowToSession(row: any): PersistedChatSession | null {
  const parsed = parseJson<PersistedChatSession>(row?.session_json);
  return parsed ? normalizeSessionWorkbenchConversationMode(parsed) : null;
}

function rowToSummary(row: any): ChatSessionSummary | null {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    conversationMode: row.conversation_mode || undefined,
    model: row.model,
    engine: row.engine || undefined,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    messageCount: Number(row.message_count || 0),
    lastMessage: row.last_message || undefined,
    creationSession: parseJson<WorkflowCreationBinding>(row.creation_session_json),
    workflowBinding: parseJson<WorkflowRunBinding>(row.workflow_binding_json),
    agentBinding: parseJson<AgentChatBinding>(row.agent_binding_json),
    sessionWorkbenchState: parseJson<SessionWorkbenchState>(row.session_workbench_state_json),
    createdBy: row.created_by || undefined,
    visibility: row.visibility || undefined,
  };
}

function sessionToSummary(session: PersistedChatSession): ChatSessionSummary {
  const normalized = normalizeSessionWorkbenchConversationMode(session);
  return {
    id: normalized.id,
    title: normalized.title,
    conversationMode: normalized.conversationMode,
    model: normalized.model,
    engine: normalized.engine,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    messageCount: normalized.messages?.length || 0,
    lastMessage: extractLastChatPreview(normalized.messages || []),
    creationSession: normalized.creationSession,
    workflowBinding: normalized.workflowBinding,
    agentBinding: normalized.agentBinding,
    sessionWorkbenchState: normalized.sessionWorkbenchState || undefined,
    createdBy: normalized.createdBy,
    visibility: normalized.visibility,
  };
}

function saveChatSessionToSqlite(session: PersistedChatSession): void {
  const normalized = normalizeSessionWorkbenchConversationMode(session);
  const data: PersistedChatSession = {
    ...normalized,
    messages: truncateResults(normalized.messages || []),
  };
  const summary = sessionToSummary(data);
  getChatDb().prepare(`
    INSERT INTO chat_sessions (
      id, title, conversation_mode, model, engine, runtime_session_id,
      created_at, updated_at, message_count, last_message, created_by, visibility,
      workflow_run_id, workflow_binding_json, creation_session_json, agent_binding_json,
      session_workbench_state_json, session_json
    ) VALUES (
      @id, @title, @conversationMode, @model, @engine, @runtimeSessionId,
      @createdAt, @updatedAt, @messageCount, @lastMessage, @createdBy, @visibility,
      @workflowRunId, @workflowBindingJson, @creationSessionJson, @agentBindingJson,
      @sessionWorkbenchStateJson, @sessionJson
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      conversation_mode = excluded.conversation_mode,
      model = excluded.model,
      engine = excluded.engine,
      runtime_session_id = excluded.runtime_session_id,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      message_count = excluded.message_count,
      last_message = excluded.last_message,
      created_by = excluded.created_by,
      visibility = excluded.visibility,
      workflow_run_id = excluded.workflow_run_id,
      workflow_binding_json = excluded.workflow_binding_json,
      creation_session_json = excluded.creation_session_json,
      agent_binding_json = excluded.agent_binding_json,
      session_workbench_state_json = excluded.session_workbench_state_json,
      session_json = excluded.session_json
  `).run({
    id: data.id,
    title: data.title,
    conversationMode: summary.conversationMode || null,
    model: data.model || '',
    engine: data.engine || null,
    runtimeSessionId: data.runtimeSessionId || data.backendSessionId || null,
    createdAt: Number(data.createdAt || Date.now()),
    updatedAt: Number(data.updatedAt || Date.now()),
    messageCount: summary.messageCount,
    lastMessage: summary.lastMessage || null,
    createdBy: data.createdBy || null,
    visibility: data.visibility || null,
    workflowRunId: data.workflowBinding?.runId || null,
    workflowBindingJson: data.workflowBinding ? stableJson(data.workflowBinding) : null,
    creationSessionJson: data.creationSession ? stableJson(data.creationSession) : null,
    agentBindingJson: data.agentBinding ? stableJson(data.agentBinding) : null,
    sessionWorkbenchStateJson: data.sessionWorkbenchState ? stableJson(data.sessionWorkbenchState) : null,
    sessionJson: stableJson(data),
  });
}

function loadChatSessionFromSqlite(id: string): PersistedChatSession | null {
  const row = getChatDb().prepare('SELECT session_json FROM chat_sessions WHERE id = ?').get(id);
  return rowToSession(row);
}

function listChatSessionsFromSqlite(): ChatSessionSummary[] {
  const rows = getChatDb().prepare(`
    SELECT id, title, conversation_mode, model, engine, created_at, updated_at,
      message_count, last_message, created_by, visibility,
      workflow_binding_json, creation_session_json, agent_binding_json, session_workbench_state_json
    FROM chat_sessions
    ORDER BY updated_at DESC
  `).all();
  return rows.map(rowToSummary).filter((summary: ChatSessionSummary | null): summary is ChatSessionSummary => Boolean(summary));
}

function deleteChatSessionFromSqlite(id: string): boolean {
  const result = getChatDb().prepare('DELETE FROM chat_sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

async function loadLegacyJsonChatSession(id: string): Promise<PersistedChatSession | null> {
  try {
    const content = await readFile(sessionPath(id), 'utf-8');
    const parsed = JSON.parse(content) as PersistedChatSession;
    return normalizeSessionWorkbenchConversationMode(parsed);
  } catch {
    return null;
  }
}

async function listLegacyJsonChatSessions(skipIds: Set<string>): Promise<ChatSessionSummary[]> {
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const summaries: ChatSessionSummary[] = [];
  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const content = await readFile(resolve(CHAT_DIR, file), 'utf-8');
      const session = normalizeSessionWorkbenchConversationMode(JSON.parse(content) as PersistedChatSession);
      if (skipIds.has(session.id)) continue;
      summaries.push(sessionToSummary(session));
    } catch { /* skip corrupted legacy JSON */ }
  }
  return summaries;
}

/** 截断过长的 action result，避免文件过大 */
function truncateResults(messages: PersistedMessage[]): PersistedMessage[] {
  const MAX_RESULT_LEN = 5000;
  return messages.map(m => ({
    ...m,
    actions: m.actions?.map(a => {
      let result = a.result;
      if (result && typeof result === 'object') {
        if (Array.isArray(result.skills)) {
          result = { ...result, skills: result.skills.map((s: any) => ({ ...s, detailedDescription: undefined })) };
        }
        if (Array.isArray(result.agents)) {
          result = { ...result, agents: result.agents.map((ag: any) => ({ ...ag, systemPrompt: ag.systemPrompt?.slice(0, 200) })) };
        }
      }
      return {
        ...a,
        result: result && JSON.stringify(result).length > MAX_RESULT_LEN
          ? { _truncated: true, summary: JSON.stringify(result).slice(0, 500) }
          : result,
        snapshot: undefined,
      };
    }),
  }));
}

export async function saveChatSession(session: PersistedChatSession): Promise<void> {
  saveChatSessionToSqlite(session);
  chatSessionEvents.emit('change', {
    type: 'updated',
    sessionId: session.id,
    updatedAt: typeof session.updatedAt === 'number' && Number.isFinite(session.updatedAt)
      ? session.updatedAt
      : Date.now(),
  } satisfies ChatSessionEvent);
}

export async function loadChatSession(id: string): Promise<PersistedChatSession | null> {
  const sqliteSession = loadChatSessionFromSqlite(id);
  if (sqliteSession) return sqliteSession;
  return loadLegacyJsonChatSession(id);
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const sqliteSummaries = listChatSessionsFromSqlite();
  const summaries = [
    ...sqliteSummaries,
    ...await listLegacyJsonChatSessions(new Set(sqliteSummaries.map((session) => session.id))),
  ];

  summaries.sort(compareChatSessionSummary);
  return summaries;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const deletedFromSqlite = deleteChatSessionFromSqlite(id);
  const path = sessionPath(id);
  let deletedFromJson = false;
  if (existsSync(path)) {
    await unlink(path);
    deletedFromJson = true;
  }
  if (!deletedFromSqlite && !deletedFromJson) return false;
  chatSessionEvents.emit('change', {
    type: 'removed',
    sessionId: id,
    updatedAt: Date.now(),
  } satisfies ChatSessionEvent);
  return true;
}

export async function deleteChatSessionsByWorkflowRun(runId: string): Promise<{ deletedCount: number; sessionIds: string[] }> {
  const targetRunId = String(runId || '').trim();
  if (!targetRunId) return { deletedCount: 0, sessionIds: [] };

  const sqliteRows = getChatDb()
    .prepare('SELECT id FROM chat_sessions WHERE workflow_run_id = ?')
    .all(targetRunId) as Array<{ id: string }>;
  const sessionIds = new Set<string>(sqliteRows.map((row) => row.id));
  const legacySummaries = await listLegacyJsonChatSessions(sessionIds);
  for (const session of legacySummaries) {
    if (session.workflowBinding?.runId === targetRunId) sessionIds.add(session.id);
  }

  let deletedCount = 0;
  for (const sessionId of sessionIds.values()) {
    if (await deleteChatSession(sessionId)) deletedCount += 1;
  }

  return { deletedCount, sessionIds: Array.from(sessionIds) };
}

export async function deleteAllChatSessions(): Promise<number> {
  const row = getChatDb().prepare('SELECT COUNT(*) AS count FROM chat_sessions').get() as { count?: number };
  getChatDb().prepare('DELETE FROM chat_sessions').run();
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  for (const file of jsonFiles) {
    await unlink(resolve(CHAT_DIR, file));
  }
  return Number(row?.count || 0) + jsonFiles.length;
}

export async function updateChatSessionWorkflowBinding(
  sessionId: string,
  patch: Omit<WorkflowRunBinding, 'createdAt' | 'updatedAt'> & { updatedAt?: number }
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  const now = patch.updatedAt ?? Date.now();
  const existing = session.workflowBinding;
  session.workflowBinding = {
    ...existing,
    ...patch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  session.updatedAt = now;
  await saveChatSession(session);
}

export async function appendChatSessionMessage(
  sessionId: string,
  message: Omit<PersistedMessage, 'id' | 'timestamp'> & Partial<Pick<PersistedMessage, 'id' | 'timestamp'>>,
  options?: { runtimeSessionId?: string | null; backendSessionId?: string | null; dedupeKey?: string }
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  const content = (message.content || '').trim();
  if (!content) return;

  if (options?.dedupeKey) {
    const exists = session.messages.some((item) => item.id === options.dedupeKey);
    if (exists) return;
  } else {
    const exists = session.messages.some((item) => item.role === message.role && item.content.trim() === content);
    if (exists) return;
  }

  const now = message.timestamp || Date.now();
  session.messages.push({
    ...message,
    id: options?.dedupeKey || message.id || `${now}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
  });
  if (options?.runtimeSessionId) {
    session.runtimeSessionId = options.runtimeSessionId;
  } else if (options?.backendSessionId) {
    session.backendSessionId = options.backendSessionId;
  }
  session.updatedAt = now;
  await saveChatSession(session);
}

export async function updateChatSessionCreationBinding(
  sessionId: string,
  patch: Partial<Omit<WorkflowCreationBinding, 'createdAt' | 'updatedAt'>> & { updatedAt?: number }
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  const now = patch.updatedAt ?? Date.now();
  const existing = session.creationSession;
  if (!existing && (!patch.creationSessionId || !patch.filename || !patch.workflowName || !patch.status || !patch.specCodingId)) {
    return;
  }
  session.creationSession = {
    ...existing,
    ...patch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } as WorkflowCreationBinding;
  session.updatedAt = now;
  await saveChatSession(session);
}

export async function updateChatSessionAgentBinding(
  sessionId: string,
  patch: Partial<Omit<AgentChatBinding, 'createdAt' | 'updatedAt'>> & { updatedAt?: number } | null
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  if (!patch) {
    delete session.agentBinding;
    session.updatedAt = Date.now();
    await saveChatSession(session);
    return;
  }

  const now = patch.updatedAt ?? Date.now();
  const existing = session.agentBinding;
  if (!existing && !patch.agentName) {
    return;
  }

  session.agentBinding = {
    ...existing,
    ...patch,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  } as AgentChatBinding;
  session.updatedAt = now;
  await saveChatSession(session);
}

export async function updateChatSessionWorkbenchState(
  sessionId: string,
  patch: SessionWorkbenchState
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  session.sessionWorkbenchState = {
    ...(session.sessionWorkbenchState || {}),
    ...patch,
  };
  session.updatedAt = Date.now();
  await saveChatSession(session);
}
