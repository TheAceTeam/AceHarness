import { randomUUID } from 'crypto';
import {
  loadChatSession,
  saveChatSession,
  type PersistedChatSession,
} from '@/lib/chat/persistence';
import { createInitialChatroomState, ensureChatroomRoomState } from '@/lib/agora/chatroom-state';
import type { CollaborationRoomState } from '@/lib/core/home-sidebar-state';
import type { PersistedLightweightRunMetadata } from '@/lib/run/state-persistence';
import { isActiveWorkflowRunStatus } from '@/lib/workflow/run-status';

type WorkflowConversationMode = 'workflow-running' | 'workflow-completed';

export interface EnsureWorkflowRuntimeConversationInput {
  frontendSessionId?: string | null;
  runId: string;
  configFile: string;
  workflowName?: string | null;
  userId: string;
}

export interface WorkflowRuntimeConversation {
  sessionId: string;
  sessionWorkbenchState: NonNullable<PersistedChatSession['sessionWorkbenchState']>;
}

function workflowConversationMode(status?: string | null): WorkflowConversationMode {
  return isActiveWorkflowRunStatus(status) ? 'workflow-running' : 'workflow-completed';
}

function buildWorkflowWorkbenchState(input: {
  session?: PersistedChatSession | null;
  runId: string;
  configFile: string;
  status?: string | null;
}): NonNullable<PersistedChatSession['sessionWorkbenchState']> {
  const current = input.session?.sessionWorkbenchState || {};
  const embeddedWorkflow = current.embeddedWorkflow || {};
  return {
    ...current,
    conversationMode: workflowConversationMode(input.status),
    embeddedWorkflow: {
      ...embeddedWorkflow,
      runId: input.runId,
      configFile: input.configFile,
      activePanel: embeddedWorkflow.activePanel || 'status',
    },
  };
}

function hasDifferentWorkflowRun(session: PersistedChatSession, runId: string): boolean {
  const boundRunId = String(session.workflowBinding?.runId || '').trim();
  const embeddedRunId = String(session.sessionWorkbenchState?.embeddedWorkflow?.runId || '').trim();
  return (boundRunId.length > 0 && boundRunId !== runId)
    || (embeddedRunId.length > 0 && embeddedRunId !== runId);
}

function workflowReviewRoomId(runId: string): string {
  return `workflow-review:${runId}`;
}

function isWorkflowReviewRoom(room: CollaborationRoomState | null | undefined, runId: string): boolean {
  return room?.roomId === workflowReviewRoomId(runId);
}

function isReusableOrdinaryConversation(session: PersistedChatSession, userId: string, runId: string): boolean {
  if (session.createdBy && session.createdBy !== userId) return false;
  if (hasDifferentWorkflowRun(session, runId)) return false;
  if (session.agentBinding) return false;
  if (session.conversationMode === 'agent-chat' || session.sessionWorkbenchState?.conversationMode === 'agent-chat') return false;
  const room = session.sessionWorkbenchState?.collaborationRoom;
  return !room || isWorkflowReviewRoom(room, runId);
}

function getWorkflowConversationTitle(input: EnsureWorkflowRuntimeConversationInput): string {
  const workflowName = String(input.workflowName || input.configFile || 'Workflow').trim();
  return `${workflowName || 'Workflow'} - Workflow`;
}

export async function ensureWorkflowRuntimeConversation(
  input: EnsureWorkflowRuntimeConversationInput,
): Promise<WorkflowRuntimeConversation> {
  const requestedSessionId = String(input.frontendSessionId || '').trim();
  const existing = requestedSessionId
    ? await loadChatSession(requestedSessionId).catch(() => null)
    : null;

  if (existing && isReusableOrdinaryConversation(existing, input.userId, input.runId)) {
    const sessionWorkbenchState = buildWorkflowWorkbenchState({
      session: existing,
      runId: input.runId,
      configFile: input.configFile,
      status: 'preparing',
    });
    await saveChatSession({
      ...existing,
      conversationMode: 'workflow-running',
      sessionWorkbenchState,
      updatedAt: Date.now(),
    });
    return { sessionId: existing.id, sessionWorkbenchState };
  }

  const now = Date.now();
  const sessionId = `workflow-${now}-${randomUUID().slice(0, 8)}`;
  const sessionWorkbenchState = buildWorkflowWorkbenchState({
    runId: input.runId,
    configFile: input.configFile,
    status: 'preparing',
  });
  await saveChatSession({
    id: sessionId,
    title: getWorkflowConversationTitle(input),
    conversationMode: 'workflow-running',
    model: 'claude-sonnet-4-6',
    sessionWorkbenchState,
    messages: [],
    createdAt: now,
    updatedAt: now,
    createdBy: input.userId,
    visibility: 'public',
  });
  return { sessionId, sessionWorkbenchState };
}

export async function bindWorkflowRunToConversation(input: {
  sessionId?: string | null;
  runId: string;
  configFile: string;
  status?: string | null;
  supervisorAgent?: string | null;
  supervisorSessionId?: string | null;
  attachedAgentSessions?: Record<string, string>;
  lightweight?: PersistedLightweightRunMetadata | null;
  requireLightweightMetadata?: boolean;
}): Promise<boolean> {
  const sessionId = String(input.sessionId || '').trim();
  if (!sessionId || !input.runId || !input.configFile) return false;
  if (input.requireLightweightMetadata && input.lightweight?.profile !== 'lightweight') return false;

  const session = await loadChatSession(sessionId).catch(() => null);
  if (!session || hasDifferentWorkflowRun(session, input.runId)) return false;
  if (session.agentBinding || session.conversationMode === 'agent-chat') return false;
  if (session.sessionWorkbenchState?.conversationMode === 'agent-chat') return false;
  const room = session.sessionWorkbenchState?.collaborationRoom;
  if (room && !isWorkflowReviewRoom(room, input.runId)) return false;

  const now = Date.now();
  const existingBinding = session.workflowBinding;
  const sessionWorkbenchState = buildWorkflowWorkbenchState({
    session,
    runId: input.runId,
    configFile: input.configFile,
    status: input.status,
  });
  await saveChatSession({
    ...session,
    conversationMode: workflowConversationMode(input.status),
    workflowBinding: {
      ...existingBinding,
      configFile: input.configFile,
      runId: input.runId,
      supervisorAgent: input.supervisorAgent || undefined,
      supervisorSessionId: input.supervisorSessionId || null,
      attachedAgentSessions: input.attachedAgentSessions || {},
      createdAt: existingBinding?.createdAt ?? now,
      updatedAt: now,
    },
    sessionWorkbenchState,
    updatedAt: now,
  });
  return true;
}

/**
 * Persists a Supervisor review to the workflow's collaboration room. Reviews
 * deliberately stay out of the ordinary chat transcript and runtime stream.
 */
export async function appendWorkflowSupervisorReviewToAgora(input: {
  sessionId?: string | null;
  runId?: string | null;
  configFile: string;
  stateName: string;
  reviewType: 'state-review' | 'checkpoint-advice';
  content: string;
  supervisorAgent?: string | null;
  supervisorSessionId?: string | null;
  timestamp?: string;
  dedupeKey?: string;
}): Promise<boolean> {
  const sessionId = String(input.sessionId || '').trim();
  const runId = String(input.runId || '').trim();
  const content = String(input.content || '').trim();
  if (!sessionId || !runId || !content) return false;

  const session = await loadChatSession(sessionId).catch(() => null);
  if (!session || hasDifferentWorkflowRun(session, runId)) return false;
  const sessionRunId = String(session.workflowBinding?.runId || session.sessionWorkbenchState?.embeddedWorkflow?.runId || '').trim();
  if (sessionRunId !== runId) return false;

  const now = Number.isFinite(Date.parse(input.timestamp || ''))
    ? Date.parse(input.timestamp!)
    : Date.now();
  const speakerName = String(input.supervisorAgent || session.workflowBinding?.supervisorAgent || 'Supervisor').trim() || 'Supervisor';
  const existingRoom = session.sessionWorkbenchState?.collaborationRoom;
  if (existingRoom && !isWorkflowReviewRoom(existingRoom, runId)) return false;

  const room = existingRoom
    ? ensureChatroomRoomState(existingRoom)
    : {
      roomId: workflowReviewRoomId(runId),
      topic: `${input.configFile} · Supervisor 审阅`,
      selectedAgents: [speakerName],
      mode: 'group-chat' as const,
      messages: [],
      rounds: [],
      agentSessions: input.supervisorSessionId ? { [speakerName]: input.supervisorSessionId } : {},
      chatroom: createInitialChatroomState({
        status: 'running',
        topic: `${input.configFile} · Supervisor 审阅`,
        participants: [speakerName],
        participantRoster: [{
          id: `${workflowReviewRoomId(runId)}:${speakerName}`,
          name: speakerName,
          sourceType: 'agent',
          sourceAgent: speakerName,
          runtimeAgentName: speakerName,
          useDefaultModel: true,
          createdAt: now,
        }],
      }),
    } satisfies CollaborationRoomState;
  const messageId = input.dedupeKey || `workflow-review-${runId}-${now}-${randomUUID().slice(0, 8)}`;
  if (room.messages.some((message) => message.id === messageId)) return true;

  const selectedAgents = Array.from(new Set([...(room.selectedAgents || []), speakerName]));
  const chatroom = room.chatroom || createInitialChatroomState({ topic: room.topic, participants: selectedAgents });
  const participantRoster = chatroom.participantRoster?.length
    ? chatroom.participantRoster
    : selectedAgents.map((name, index) => ({
      id: `${workflowReviewRoomId(runId)}:participant:${index}:${name}`,
      name,
      sourceType: 'agent' as const,
      sourceAgent: name,
      runtimeAgentName: name,
      useDefaultModel: true,
      createdAt: now,
    }));
  const nextRoom: CollaborationRoomState = {
    ...room,
    roomId: workflowReviewRoomId(runId),
    topic: room.topic || `${input.configFile} · Supervisor 审阅`,
    selectedAgents,
    agentSessions: input.supervisorSessionId
      ? { ...(room.agentSessions || {}), [speakerName]: input.supervisorSessionId }
      : room.agentSessions,
    messages: [
      ...room.messages,
      {
        id: messageId,
        speakerType: 'supervisor',
        speakerName,
        content,
        rawContent: content,
        createdAt: now,
        status: 'done',
        chatroom: {
          kind: 'summary',
          mode: chatroom.settings.responseMode,
        },
      },
    ].slice(-80),
    chatroom: {
      ...chatroom,
      status: chatroom.status === 'setup' ? 'running' : chatroom.status,
      topic: room.topic || `${input.configFile} · Supervisor 审阅`,
      participants: selectedAgents,
      participantRoster,
    },
  };
  await saveChatSession({
    ...session,
    sessionWorkbenchState: {
      ...(session.sessionWorkbenchState || {}),
      collaborationRoom: nextRoom,
    },
    updatedAt: now,
  });
  return true;
}
