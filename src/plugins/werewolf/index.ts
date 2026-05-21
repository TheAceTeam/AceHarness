/**
 * AI 狼人杀议场扩展元数据
 *
 * 多嘉宾回合制身份推理测试，包含完整的游戏状态机、
 * 角色行为、投票计算、断点恢复和主题系统。该文件不再注册
 * 首页/sidebar 插件；议场通过扩展动作加载狼人杀模式。
 */
import type {
  CollaborationChatroomParticipant,
  CollaborationChatroomTemporaryAgent,
  CollaborationWerewolfPlayer,
  SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import {
  DEFAULT_WEREWOLF_BOARD_ID,
  TEMP_WEREWOLF_SUPERVISOR,
  getTemporaryWerewolfAgent,
  getWerewolfLabBoard,
  listTemporaryWerewolfAgentNames,
} from './agents';

type WerewolfAgoraExtensionContext = {
  isWerewolfTopic?: boolean;
  hasCollaboration?: boolean;
};

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function pickTemporaryWerewolfAgents(count: number): string[] {
  return shuffleArray(listTemporaryWerewolfAgentNames()).slice(0, count);
}

function createWerewolfGuestRoster(playerNames: string[]): {
  participants: CollaborationChatroomParticipant[];
  temporaryAgents: CollaborationChatroomTemporaryAgent[];
} {
  const createdAt = Date.now();
  const participants = playerNames.map((agentName, index): CollaborationChatroomParticipant => {
    const temporaryAgent = getTemporaryWerewolfAgent(agentName);
    const personaLines = [
      temporaryAgent?.persona,
      temporaryAgent?.speechStyle ? `说话方式：${temporaryAgent.speechStyle}` : '',
      temporaryAgent?.rhythm ? `发言节奏：${temporaryAgent.rhythm}` : '',
      temporaryAgent?.style || temporaryAgent?.bias
        ? `思考偏好：${[temporaryAgent?.style, temporaryAgent?.bias].filter(Boolean).join(' ')}`
        : '',
    ].filter(Boolean);
    return {
      id: `werewolf-guest-${index}-${agentName}`,
      name: agentName,
      sourceType: 'custom',
      personaPrompt: personaLines.join('\n') || `狼人杀嘉宾 ${index + 1}`,
      useDefaultModel: true,
      openingStatus: 'pending',
      createdAt,
    };
  });
  const temporaryAgents = participants.map((participant): CollaborationChatroomTemporaryAgent => ({
    id: participant.id,
    name: participant.name,
    personaPrompt: participant.personaPrompt || participant.name,
    createdAt,
  }));
  return { participants, temporaryAgents };
}

function createWerewolfWorkbenchState(title = 'AI 狼人杀'): SessionWorkbenchState {
  const board = getWerewolfLabBoard(DEFAULT_WEREWOLF_BOARD_ID);
  const playerNames = pickTemporaryWerewolfAgents(board.playerCount);
  const selectedAgents = [TEMP_WEREWOLF_SUPERVISOR.name, ...playerNames];
  const shuffledRoles = shuffleArray(board.roleDeck.slice(0, playerNames.length));
  const guestRoster = createWerewolfGuestRoster(playerNames);
  return {
    collaborationRoom: {
      topic: title,
      selectedAgents,
      mode: 'group-chat',
      messages: [],
      rounds: [],
      agentSessions: {},
      chatroom: {
        ...createInitialChatroomState({
          status: 'running',
          topic: title,
          participants: playerNames,
        }),
        participantRoster: guestRoster.participants,
        temporaryAgents: guestRoster.temporaryAgents,
      },
      werewolfLabConfig: {
        defaultEngine: '',
        defaultModel: '',
        agentOverrides: {},
        rehearsal: {},
      },
      werewolf: {
        enabled: true,
        phase: 'setup',
        dayNumber: 1,
        boardId: board.id,
        boardName: board.name,
        players: playerNames.map((agentName, index) => ({
          agentName,
          role: shuffledRoles[index] || getTemporaryWerewolfAgent(agentName)?.role || 'villager',
          alive: true,
          persona: getTemporaryWerewolfAgent(agentName)?.persona || `临时人格 ${index + 1}`,
        } satisfies CollaborationWerewolfPlayer)),
        eliminated: [],
        votes: [],
        revealedRoles: false,
        lastSummary: `已创建 ${board.name} 狼人杀议题。`,
        currentAction: 'setup',
        speechOrder: playerNames,
        sheriffCandidates: [],
        sheriffElectionDone: false,
        badgeDestroyed: false,
        roleState: {
          witchAntidoteUsed: false,
          witchPoisonUsed: false,
          hunterShotUsed: false,
          idiotRevealed: false,
        },
      },
      werewolfView: {
        mode: 'night',
        viewer: playerNames[0] || '',
        viewerRole: shuffledRoles[0] || getTemporaryWerewolfAgent(playerNames[0] || '')?.role || 'villager',
      },
    },
  };
}

const werewolfAgoraExtension = {
  id: 'werewolf-lab',
  name: 'AI 狼人杀',
  version: '1.0.0',
  enabled: true,
  capabilities: [
    'agent-calling',
    'result-extraction',
    'breakpoint-resume',
    'persistence',
    'streaming-display',
    'theme',
    'animations',
    'modals',
  ],

  theme: {
    id: 'werewolf-wood',
    classes: {
      panel: 'werewolf-wood-panel border-l-stone-700/60',
      header: 'border-stone-700/60 bg-black/5',
      section: 'werewolf-wood-frame',
      card: 'werewolf-parchment',
      badge: 'werewolf-copper-badge',
      button: 'werewolf-gold-button',
      ghostButton: 'werewolf-ghost-button',
    },
    activeWhen: (ctx: WerewolfAgoraExtensionContext) => ctx.isWerewolfTopic,
  },

  stateMachine: {
    initialPhase: 'setup',
    phases: [
      { id: 'setup', label: '配置', transitions: ['night'] },
      { id: 'night', label: '黑夜', transitions: ['day', 'last-words', 'ended'] },
      { id: 'day', label: '白天', transitions: ['voting', 'last-words'] },
      { id: 'voting', label: '投票', transitions: ['night', 'last-words', 'ended'] },
      { id: 'last-words', label: '遗言', transitions: ['night', 'day', 'ended'] },
      { id: 'ended', label: '结束', transitions: ['setup'] },
    ],
  },

  breakpoint: {
    handlers: ['night', 'sheriff-election', 'day-speech', 'last-words', 'vote'],
  },

  topicActions: [
    {
      id: 'create-werewolf',
      label: '创建狼人杀',
      icon: 'playing_cards',
      title: '创建狼人杀议题',
      createTopic: () => {
        const title = 'AI 狼人杀';
        return {
          title,
          sessionWorkbenchState: createWerewolfWorkbenchState(title),
        };
      },
    },
  ],
} as const;

export default werewolfAgoraExtension;
