/**
 * 聊天会话持久化层
 * 将聊天记录存储为 JSON 文件：data/chat-sessions/{sessionId}.json
 */

import { mkdir, writeFile, readFile, readdir, unlink } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getWorkspaceDataFile } from '@/lib/app-paths';
import type { SessionWorkbenchState } from '@/lib/home-sidebar-state';

const CHAT_DIR = getWorkspaceDataFile('chat-sessions');

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
  actions?: PersistedAction[];
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
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
  openSpecId: string;
  updatedAt: number;
  createdAt: number;
}

export interface AgentChatBinding {
  agentName: string;
  team?: 'blue' | 'red' | 'judge' | 'black-gold' | 'yellow';
  roleType?: 'normal' | 'supervisor';
  createdAt: number;
  updatedAt: number;
}

export interface PersistedChatSession {
  id: string;
  title: string;
  model: string;
  engine?: string;
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

async function ensureDir() {
  if (!existsSync(CHAT_DIR)) {
    await mkdir(CHAT_DIR, { recursive: true });
  }
}

function sessionPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(CHAT_DIR, `${safeId}.json`);
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
  await ensureDir();
  const data = {
    ...session,
    messages: truncateResults(session.messages),
  };
  await writeFile(sessionPath(session.id), JSON.stringify(data, null, 2), 'utf-8');
}

export async function loadChatSession(id: string): Promise<PersistedChatSession | null> {
  try {
    const content = await readFile(sessionPath(id), 'utf-8');
    return JSON.parse(content) as PersistedChatSession;
  } catch {
    return null;
  }
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  const summaries: ChatSessionSummary[] = [];
  for (const file of jsonFiles) {
    try {
      const content = await readFile(resolve(CHAT_DIR, file), 'utf-8');
      const session = JSON.parse(content) as PersistedChatSession;
      const lastMsg = session.messages?.filter(m => m.role !== 'error').slice(-1)[0];
      summaries.push({
        id: session.id,
        title: session.title,
        model: session.model,
        engine: session.engine,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages?.length || 0,
        lastMessage: lastMsg?.content?.slice(0, 100),
        creationSession: session.creationSession,
        workflowBinding: session.workflowBinding,
        agentBinding: session.agentBinding,
        sessionWorkbenchState: session.sessionWorkbenchState,
        createdBy: session.createdBy,
        visibility: session.visibility,
      });
    } catch { /* skip corrupted */ }
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  return summaries;
}

export async function deleteChatSession(id: string): Promise<boolean> {
  const path = sessionPath(id);
  if (existsSync(path)) {
    await unlink(path);
    return true;
  }
  return false;
}

export async function deleteAllChatSessions(): Promise<number> {
  await ensureDir();
  const files = await readdir(CHAT_DIR);
  const jsonFiles = files.filter(f => f.endsWith('.json'));
  for (const file of jsonFiles) {
    await unlink(resolve(CHAT_DIR, file));
  }
  return jsonFiles.length;
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

export async function updateChatSessionCreationBinding(
  sessionId: string,
  patch: Partial<Omit<WorkflowCreationBinding, 'createdAt' | 'updatedAt'>> & { updatedAt?: number }
): Promise<void> {
  const session = await loadChatSession(sessionId);
  if (!session) return;

  const now = patch.updatedAt ?? Date.now();
  const existing = session.creationSession;
  if (!existing && (!patch.creationSessionId || !patch.filename || !patch.workflowName || !patch.status || !patch.openSpecId)) {
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
