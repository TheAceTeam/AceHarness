import { useCallback, useMemo } from 'react';
import { createInitialChatroomState, ensureChatroomRoomState } from '@/lib/agora/chatroom-state';
import type {
  CollaborationChatroomMode,
  CollaborationChatroomParticipant,
  CollaborationRoomState,
  SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';

type WorkbenchStateSetter = (
  state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)
) => void;

export type CollaborationRoomCore = {
  room: CollaborationRoomState | null;
  normalizedRoom: CollaborationRoomState | null;
  chatroom: NonNullable<CollaborationRoomState['chatroom']> | null;
  participants: CollaborationChatroomParticipant[];
  participantNames: string[];
  mentionItems: string[];
  responseMode: CollaborationChatroomMode;
  hasRoom: boolean;
  hasChatroom: boolean;
  ensureRoom: (options?: { topic?: string; responseMode?: CollaborationChatroomMode }) => void;
  setResponseMode: (mode: CollaborationChatroomMode) => void;
};

function uniqueNames(names: Array<string | null | undefined>): string[] {
  return Array.from(new Set(
    names
      .map((name) => String(name || '').trim())
      .filter(Boolean)
  ));
}

export function createPlainConversationRoomState(input?: {
  topic?: string;
  responseMode?: CollaborationChatroomMode;
}): CollaborationRoomState {
  const topic = String(input?.topic || '群聊').trim() || '群聊';
  return {
    topic,
    selectedAgents: [],
    mode: 'group-chat',
    messages: [],
    rounds: [],
    agentSessions: {},
    chatroom: createInitialChatroomState({
      status: 'running',
      topic,
      participants: [],
      settings: {
        responseMode: input?.responseMode || 'mention-driven',
        maxTurnsPerRound: 2,
        maxRepliesPerAgent: 1,
        autoSummarize: true,
      },
    }),
  };
}

export function deriveCollaborationParticipants(room?: CollaborationRoomState | null): CollaborationChatroomParticipant[] {
  const normalized = room ? ensureChatroomRoomState(room) : null;
  const chatroom = normalized?.chatroom;
  if (!chatroom) return [];
  if (chatroom.participantRoster?.length) return chatroom.participantRoster;
  return (chatroom.participants || []).map((name, index) => ({
    id: `participant-${index}-${name}`,
    name,
    sourceType: 'agent' as const,
    sourceAgent: name,
    createdAt: Date.now(),
    useDefaultModel: true,
  }));
}

export function deriveCollaborationMentionItems(room?: CollaborationRoomState | null): string[] {
  const normalized = room ? ensureChatroomRoomState(room) : null;
  if (!normalized?.chatroom) return [];
  const participants = deriveCollaborationParticipants(normalized);
  const names = uniqueNames([
    ...participants.map((participant) => participant.name),
    ...(normalized.chatroom.participants || []),
    ...(normalized.selectedAgents || []),
  ]);
  return names.length ? ['全员', ...names] : [];
}

export function extractAgentMentions(input: string, availableAgents: string[]): string[] {
  if (!input.trim()) return [];
  const agents = uniqueNames(availableAgents);
  const mentions: string[] = [];
  const pushMention = (agent: string) => {
    if (!mentions.includes(agent)) mentions.push(agent);
  };
  const escapedAgents = agents
    .sort((a, b) => b.length - a.length)
    .map((agent) => agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionPattern = escapedAgents.length
    ? new RegExp(`@全员|@(${escapedAgents.join('|')})`, 'gu')
    : /@全员/gu;
  for (const match of input.matchAll(mentionPattern)) {
    const token = match[0];
    if (token === '@全员') {
      agents.forEach(pushMention);
    } else {
      const agentName = token.slice(1);
      if (agents.includes(agentName)) pushMention(agentName);
    }
  }
  return mentions;
}

export function extractNextRoundMentions(input: string, availableAgents: string[], speaker?: string): string[] {
  return extractAgentMentions(input, availableAgents).filter((agent) => agent !== speaker);
}

export function useCollaborationRoom(input: {
  sessionWorkbenchState?: SessionWorkbenchState;
  setSessionWorkbenchState?: WorkbenchStateSetter;
  fallbackTopic?: string | null;
}): CollaborationRoomCore {
  const room = input.sessionWorkbenchState?.collaborationRoom || null;
  const normalizedRoom = useMemo(() => (room ? ensureChatroomRoomState(room) : null), [room]);
  const chatroom = normalizedRoom?.chatroom || null;
  const participants = useMemo(() => deriveCollaborationParticipants(normalizedRoom), [normalizedRoom]);
  const participantNames = useMemo(() => uniqueNames(participants.map((participant) => participant.name)), [participants]);
  const mentionItems = useMemo(() => deriveCollaborationMentionItems(normalizedRoom), [normalizedRoom]);
  const responseMode = chatroom?.settings?.responseMode || 'mention-driven';

  const ensureRoom = useCallback((options?: { topic?: string; responseMode?: CollaborationChatroomMode }) => {
    input.setSessionWorkbenchState?.((prev) => {
      const existing = ensureChatroomRoomState(prev?.collaborationRoom);
      const hasExistingRoom = Boolean(prev?.collaborationRoom);
      const topic = String(options?.topic || existing.topic || input.fallbackTopic || '群聊').trim() || '群聊';
      const nextRoom = hasExistingRoom
        ? {
          ...existing,
          topic,
          chatroom: {
            ...existing.chatroom!,
            status: existing.chatroom?.status === 'setup' ? 'running' : existing.chatroom?.status || 'running',
            topic,
            settings: {
              ...existing.chatroom!.settings,
              responseMode: options?.responseMode || existing.chatroom!.settings.responseMode || 'mention-driven',
            },
          },
        }
        : createPlainConversationRoomState({ topic, responseMode: options?.responseMode });
      return {
        ...(prev || {}),
        conversationMode: 'agent-chat',
        collaborationRoom: nextRoom,
      };
    });
  }, [input]);

  const setResponseMode = useCallback((mode: CollaborationChatroomMode) => {
    input.setSessionWorkbenchState?.((prev) => {
      const base = ensureChatroomRoomState(prev?.collaborationRoom);
      return {
        ...(prev || {}),
        conversationMode: 'agent-chat',
        collaborationRoom: {
          ...base,
          chatroom: {
            ...base.chatroom!,
            settings: {
              ...base.chatroom!.settings,
              responseMode: mode,
            },
          },
        },
      };
    });
  }, [input]);

  return {
    room,
    normalizedRoom,
    chatroom,
    participants,
    participantNames,
    mentionItems,
    responseMode,
    hasRoom: Boolean(room),
    hasChatroom: Boolean(chatroom),
    ensureRoom,
    setResponseMode,
  };
}
