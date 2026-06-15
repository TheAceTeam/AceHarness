import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import { loadChatSession, saveChatSession, type PersistedChatSession } from '@/lib/chat/persistence';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import {
  attachCollaborationRoomSession,
  getCollaborationRoom,
  type CollaborationRoomRecord,
} from '@/lib/collaboration/rooms';

function createSessionId(roomId: string): string {
  return `collab-${roomId}`;
}

function getRoomTitle(room: CollaborationRoomRecord): string {
  if (room.topic.trim()) return room.topic.trim();
  const names = room.participantAgentNames
    .map((agentName) => room.agentSnapshots[agentName]?.displayName || agentName)
    .filter(Boolean);
  if (room.roomType === 'direct' && names[0]) return `${names[0]} · 私聊`;
  if (names.length) return `${names.slice(0, 3).join('、')} · 协作`;
  return room.spaceType === 'office' ? '办公室协作' : '会议室协作';
}

function createParticipantRoster(room: CollaborationRoomRecord) {
  return room.participantAgentNames.map((agentName, index) => ({
    id: `${room.id}-participant-${index}-${agentName}`,
    name: agentName,
    sourceType: 'agent' as const,
    sourceAgent: agentName,
    runtimeAgentName: agentName,
    useDefaultModel: true,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  }));
}

export function createCollaborationRoomWorkbenchState(room: CollaborationRoomRecord): SessionWorkbenchState {
  const participants = [...room.participantAgentNames];
  const topic = room.topic || '';
  return {
    collaborationRoom: {
      roomId: room.id,
      spaceType: room.spaceType,
      roomType: room.roomType,
      topic,
      selectedAgents: participants,
      mode: 'group-chat',
      messages: [],
      rounds: [],
      agentSessions: {},
      chatroom: createInitialChatroomState({
        status: 'running',
        topic,
        participants,
        participantRoster: createParticipantRoster(room),
      }),
    },
  };
}

export async function ensureCollaborationRoomChatSession(input: {
  roomId: string;
  createdBy?: string;
  visibility?: 'public' | 'private';
}): Promise<{
  room: CollaborationRoomRecord;
  session: PersistedChatSession;
  created: boolean;
}> {
  const room = await getCollaborationRoom(input.roomId);
  if (!room) throw new Error('房间不存在');

  if (room.sessionId) {
    const existing = await loadChatSession(room.sessionId).catch(() => null);
    if (existing) return { room, session: existing, created: false };
  }

  const now = Date.now();
  const sessionId = room.sessionId || createSessionId(room.id);
  const session: PersistedChatSession = {
    id: sessionId,
    title: getRoomTitle(room),
    model: 'claude-sonnet-4-6',
    sessionWorkbenchState: createCollaborationRoomWorkbenchState(room),
    createdAt: now,
    updatedAt: now,
    messages: [],
    createdBy: input.createdBy,
    visibility: input.visibility || 'public',
  };
  await saveChatSession(session);
  const nextRoom = room.sessionId === sessionId
    ? room
    : await attachCollaborationRoomSession({ roomId: room.id, sessionId });
  return { room: nextRoom, session, created: true };
}

export async function syncCollaborationRoomChatSession(room: CollaborationRoomRecord): Promise<PersistedChatSession | null> {
  if (!room.sessionId) return null;
  const session = await loadChatSession(room.sessionId).catch(() => null);
  if (!session) return null;

  const currentRoom = session.sessionWorkbenchState?.collaborationRoom;
  const currentMessages = currentRoom?.messages || [];
  const currentRounds = currentRoom?.rounds || [];
  const currentAgentSessions = currentRoom?.agentSessions || {};
  const nextWorkbenchState = createCollaborationRoomWorkbenchState(room);
  session.title = getRoomTitle(room);
  session.sessionWorkbenchState = {
    ...(session.sessionWorkbenchState || {}),
    collaborationRoom: {
      ...nextWorkbenchState.collaborationRoom!,
      messages: currentMessages,
      rounds: currentRounds,
      agentSessions: currentAgentSessions,
      chatroom: {
        ...nextWorkbenchState.collaborationRoom!.chatroom!,
        rounds: currentRoom?.chatroom?.rounds || [],
        activeRoundId: currentRoom?.chatroom?.activeRoundId,
        activeVote: currentRoom?.chatroom?.activeVote || null,
        voteHistory: currentRoom?.chatroom?.voteHistory || [],
        summaries: currentRoom?.chatroom?.summaries || [],
        settings: {
          ...nextWorkbenchState.collaborationRoom!.chatroom!.settings,
          ...(currentRoom?.chatroom?.settings || {}),
        },
        temporaryAgents: currentRoom?.chatroom?.temporaryAgents || [],
      },
    },
  };
  session.updatedAt = Date.now();
  await saveChatSession(session);
  return session;
}
