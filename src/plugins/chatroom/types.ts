import type {
  CollaborationChatroomMode,
  CollaborationChatroomState,
  CollaborationRoomState,
} from '@/lib/core/home-sidebar-state';

export const DEFAULT_CHATROOM_MODE: CollaborationChatroomMode = 'facilitated';

export function createInitialChatroomState(overrides?: Partial<CollaborationChatroomState>): CollaborationChatroomState {
  const settings = {
    responseMode: overrides?.settings?.responseMode || DEFAULT_CHATROOM_MODE,
    maxTurnsPerRound: overrides?.settings?.maxTurnsPerRound ?? 6,
    maxRepliesPerAgent: overrides?.settings?.maxRepliesPerAgent ?? 2,
    autoSummarize: overrides?.settings?.autoSummarize ?? true,
    defaultEngine: overrides?.settings?.defaultEngine || '',
    defaultModel: overrides?.settings?.defaultModel || '',
    agentOverrides: overrides?.settings?.agentOverrides || {},
  };
  return {
    status: 'setup',
    topic: '',
    participants: [],
    rounds: [],
    voteHistory: [],
    summaries: [],
    activeVote: null,
    participantRoster: [],
    temporaryAgents: [],
    ...overrides,
    settings,
  };
}

export function ensureChatroomRoomState(room?: CollaborationRoomState | null): CollaborationRoomState {
  return {
    topic: room?.topic || '',
    selectedAgents: room?.selectedAgents || [],
    mode: room?.mode || 'roundtable',
    messages: room?.messages || [],
    rounds: room?.rounds || [],
    agentSessions: room?.agentSessions || {},
    chatroom: room?.chatroom || createInitialChatroomState({
      topic: room?.topic || '',
      participants: room?.selectedAgents || [],
    }),
    werewolfLabConfig: room?.werewolfLabConfig,
    werewolf: room?.werewolf ?? null,
    werewolfView: room?.werewolfView,
  };
}
