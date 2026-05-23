import type {
  CollaborationChatroomMode,
  CollaborationChatroomState,
  CollaborationRoomState,
} from '@/lib/core/home-sidebar-state';

export const DEFAULT_CHATROOM_MODE: CollaborationChatroomMode = 'mention-driven';

export function createInitialChatroomState(overrides?: Partial<CollaborationChatroomState>): CollaborationChatroomState {
  const hasExplicitDefaultRuntime = Boolean(
    overrides?.settings?.defaultEngine || overrides?.settings?.defaultModel
  );
  const settings = {
    responseMode: overrides?.settings?.responseMode || DEFAULT_CHATROOM_MODE,
    maxTurnsPerRound: overrides?.settings?.maxTurnsPerRound ?? 2,
    maxRepliesPerAgent: overrides?.settings?.maxRepliesPerAgent ?? 1,
    autoSummarize: overrides?.settings?.autoSummarize ?? true,
    defaultEngine: overrides?.settings?.defaultEngine || '',
    defaultModel: overrides?.settings?.defaultModel || '',
    defaultRuntimeMode: overrides?.settings?.defaultRuntimeMode || (hasExplicitDefaultRuntime ? 'explicit' : 'inherit'),
    agentOverrides: overrides?.settings?.agentOverrides || {},
    workspacePath: overrides?.settings?.workspacePath || '',
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
    mode: room?.mode === 'free' ? 'free' : 'group-chat',
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
