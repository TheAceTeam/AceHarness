import type {
  CollaborationRoomMessage,
  CollaborationWerewolfMemoryEntry,
  CollaborationWerewolfPhase,
  CollaborationWerewolfPlayer,
  CollaborationWerewolfState,
  CollaborationWerewolfVote,
} from '@/lib/core/home-sidebar-state';
import { extractStructuredResult } from '@/lib/ai/result-channel';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import {
  DEFAULT_WEREWOLF_BOARD_ID,
  getTemporaryWerewolfAgent,
  getWerewolfLabBoard,
  isTemporaryWerewolfAgent,
  listTemporaryWerewolfAgentNames,
  type WerewolfLabBoard,
} from '@/plugins/werewolf/agents';

export type WerewolfHistoryEntry = {
  id: string;
  boardId: string;
  boardName: string;
  result: string;
  summary: string;
  lessons: string[];
  highlights: string[];
  generatedAt: string;
};

export type WerewolfGuardResult = {
  action: 'guard-action';
  target: string | null;
  reason?: string;
  display?: string;
};

export type WerewolfWitchResult = {
  action: 'witch-action';
  save: boolean;
  poisonTarget: string | null;
  reason?: string;
  display?: string;
};

export type WerewolfSeerResult = {
  action: 'seer-check';
  target: string | null;
  reason?: string;
  display?: string;
};

export type WerewolfHunterResult = {
  action: 'hunter-shot';
  target: string | null;
  reason?: string;
  display?: string;
};

export type WerewolfVoteResult = {
  action: 'wolf-vote' | 'day-vote' | 'sheriff-vote';
  target: string | null;
  reason?: string;
  display?: string;
};

const WEREWOLF_SPEAKER_VISUALS = [
  { avatar: 'bg-rose-500/15 text-rose-700 border-rose-500/30', name: 'text-rose-700 dark:text-rose-300', card: 'border-rose-500/30 bg-rose-500/5' },
  { avatar: 'bg-sky-500/15 text-sky-700 border-sky-500/30', name: 'text-sky-700 dark:text-sky-300', card: 'border-sky-500/30 bg-sky-500/5' },
  { avatar: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30', name: 'text-emerald-700 dark:text-emerald-300', card: 'border-emerald-500/30 bg-emerald-500/5' },
  { avatar: 'bg-violet-500/15 text-violet-700 border-violet-500/30', name: 'text-violet-700 dark:text-violet-300', card: 'border-violet-500/30 bg-violet-500/5' },
  { avatar: 'bg-amber-500/15 text-amber-700 border-amber-500/30', name: 'text-amber-700 dark:text-amber-300', card: 'border-amber-500/30 bg-amber-500/5' },
  { avatar: 'bg-cyan-500/15 text-cyan-700 border-cyan-500/30', name: 'text-cyan-700 dark:text-cyan-300', card: 'border-cyan-500/30 bg-cyan-500/5' },
  { avatar: 'bg-lime-500/15 text-lime-700 border-lime-500/30', name: 'text-lime-700 dark:text-lime-300', card: 'border-lime-500/30 bg-lime-500/5' },
  { avatar: 'bg-fuchsia-500/15 text-fuchsia-700 border-fuchsia-500/30', name: 'text-fuchsia-700 dark:text-fuchsia-300', card: 'border-fuchsia-500/30 bg-fuchsia-500/5' },
  { avatar: 'bg-teal-500/15 text-teal-700 border-teal-500/30', name: 'text-teal-700 dark:text-teal-300', card: 'border-teal-500/30 bg-teal-500/5' },
  { avatar: 'bg-orange-500/15 text-orange-700 border-orange-500/30', name: 'text-orange-700 dark:text-orange-300', card: 'border-orange-500/30 bg-orange-500/5' },
  { avatar: 'bg-indigo-500/15 text-indigo-700 border-indigo-500/30', name: 'text-indigo-700 dark:text-indigo-300', card: 'border-indigo-500/30 bg-indigo-500/5' },
  { avatar: 'bg-pink-500/15 text-pink-700 border-pink-500/30', name: 'text-pink-700 dark:text-pink-300', card: 'border-pink-500/30 bg-pink-500/5' },
] as const;

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function createCollaborationMessage(
  input: Omit<CollaborationRoomMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): CollaborationRoomMessage {
  return {
    id: input.id || `collab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt || Date.now(),
    ...input,
  };
}

export async function fetchWerewolfHistory(limit = 8): Promise<WerewolfHistoryEntry[]> {
  const response = await fetch(`/api/werewolf/history?limit=${limit}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('获取历史对局记忆失败');
  const data = await response.json();
  return Array.isArray(data?.entries) ? data.entries : [];
}

export async function saveWerewolfHistory(entry: WerewolfHistoryEntry): Promise<void> {
  const response = await fetch('/api/werewolf/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error('写入历史对局记忆失败');
}

export function createWerewolfMemoryEntry(
  input: Omit<CollaborationWerewolfMemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }
): CollaborationWerewolfMemoryEntry {
  return {
    id: input.id || `ww-memory-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt || Date.now(),
    ...input,
  };
}

export function createWerewolfState(agentNames: string[], supervisorName: string, boardId = DEFAULT_WEREWOLF_BOARD_ID): CollaborationWerewolfState {
  const board = getWerewolfLabBoard(boardId);
  const players = agentNames
    .filter((name) => name && name !== supervisorName)
    .slice(0, board.playerCount);
  const fallbackPlayers = players.length >= board.playerCount
    ? players
    : listTemporaryWerewolfAgentNames().slice(0, board.playerCount);
  const seatOrder = shuffleArray(fallbackPlayers);
  const roleDeck: CollaborationWerewolfPlayer['role'][] = board.roleDeck.length >= fallbackPlayers.length
    ? board.roleDeck
    : fallbackPlayers.length >= 5
      ? ['werewolf', 'werewolf', 'seer', 'witch', ...Array(Math.max(0, fallbackPlayers.length - 4)).fill('villager')]
      : ['werewolf', 'seer', ...Array(Math.max(0, fallbackPlayers.length - 2)).fill('villager')];
  const shuffledRoles = shuffleArray(roleDeck.slice(0, seatOrder.length));

  return {
    enabled: true,
    phase: 'setup',
    dayNumber: 1,
    boardId: board.id,
    boardName: board.name,
    players: seatOrder.map((agentName, index) => ({
      agentName,
      role: shuffledRoles[index] || getTemporaryWerewolfAgent(agentName)?.role || 'villager',
      alive: true,
      persona: getTemporaryWerewolfAgent(agentName)?.persona || `临时人格 ${index + 1}`,
    })),
    eliminated: [],
    votes: [],
    revealedRoles: false,
    currentAction: 'setup',
    speechOrder: seatOrder,
    sheriffCandidates: [],
    sheriffElectionDone: false,
    badgeDestroyed: false,
    roleState: {
      witchAntidoteUsed: false,
      witchPoisonUsed: false,
      hunterShotUsed: false,
      idiotRevealed: false,
    },
  };
}

export function formatWerewolfRole(role: CollaborationWerewolfPlayer['role']): string {
  switch (role) {
    case 'werewolf':
      return '狼人';
    case 'seer':
      return '预言家';
    case 'witch':
      return '女巫';
    case 'hunter':
      return '猎人';
    case 'idiot':
      return '白痴';
    case 'guard':
      return '守卫';
    case 'villager':
    default:
      return '村民';
  }
}

export function formatWerewolfRoster(state?: CollaborationWerewolfState | null, reveal = false): string {
  if (!state?.players?.length) return '暂无玩家';
  return state.players
    .map((player) => {
      const status = player.alive ? '存活' : '出局';
      const role = reveal || state.revealedRoles ? ` / ${formatWerewolfRole(player.role)}` : '';
      return `- ${player.agentName}: ${status}${role}，人格：${player.persona}`;
    })
    .join('\n');
}

export function getAliveWerewolfPlayers(state?: CollaborationWerewolfState | null): CollaborationWerewolfPlayer[] {
  return (state?.players || []).filter((player) => player.alive);
}

export function getWerewolfPlayer(state: CollaborationWerewolfState, agentName?: string): CollaborationWerewolfPlayer | undefined {
  return state.players.find((player) => player.agentName === agentName);
}

export function getWerewolfRoleState(state: CollaborationWerewolfState): NonNullable<CollaborationWerewolfState['roleState']> {
  return {
    witchAntidoteUsed: false,
    witchPoisonUsed: false,
    hunterShotUsed: false,
    idiotRevealed: false,
    ...state.roleState,
  };
}

export function getWerewolfSpeechOrder(state: CollaborationWerewolfState): string[] {
  const aliveNames = getAliveWerewolfPlayers(state).map((player) => player.agentName);
  const base = state.speechOrder?.length ? state.speechOrder : state.players.map((player) => player.agentName);
  const ordered = base.filter((name) => aliveNames.includes(name));
  const missing = aliveNames.filter((name) => !ordered.includes(name));
  if (!state.sheriff || !ordered.includes(state.sheriff)) return [...ordered, ...missing];
  const sheriffIndex = ordered.indexOf(state.sheriff);
  return [...ordered.slice(sheriffIndex + 1), ...missing, ...ordered.slice(0, sheriffIndex + 1)];
}

export function pickWerewolfTarget(
  players: CollaborationWerewolfPlayer[],
  excludedNames: string[] = [],
  preferredRole?: CollaborationWerewolfPlayer['role']
): CollaborationWerewolfPlayer | undefined {
  const pool = players.filter((player) => !excludedNames.includes(player.agentName));
  if (preferredRole) {
    const preferred = pool.filter((player) => player.role === preferredRole);
    if (preferred.length) return preferred[Math.floor(Math.random() * preferred.length)];
  }
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

export function applyWerewolfDeaths(state: CollaborationWerewolfState, deaths: string[]): CollaborationWerewolfState {
  const uniqueDeaths = Array.from(new Set(deaths.filter(Boolean)));
  if (!uniqueDeaths.length) return state;
  const eliminated = [...state.eliminated];
  uniqueDeaths.forEach((name) => {
    if (!eliminated.includes(name)) eliminated.push(name);
  });
  return {
    ...state,
    players: state.players.map((player) => (
      uniqueDeaths.includes(player.agentName) ? { ...player, alive: false } : player
    )),
    eliminated,
  };
}

export function resolveWerewolfBadgeAfterDeaths(state: CollaborationWerewolfState, deaths: string[]): {
  state: CollaborationWerewolfState;
  message?: string;
  action?: 'badge-transfer' | 'badge-destroy';
} {
  if (!state.sheriff || state.badgeDestroyed || !deaths.includes(state.sheriff)) return { state };
  const nextHolder = state.players.find((player) => player.alive && player.agentName !== state.sheriff);
  if (!nextHolder) {
    return {
      state: { ...state, sheriff: undefined, badgeDestroyed: true, players: state.players.map((player) => ({ ...player, sheriff: false })) },
      message: `${state.sheriff} 出局后无人可传警徽，警徽被撕毁。`,
      action: 'badge-destroy',
    };
  }
  return {
    state: {
      ...state,
      sheriff: nextHolder.agentName,
      players: state.players.map((player) => ({ ...player, sheriff: player.agentName === nextHolder.agentName })),
    },
    message: `${state.sheriff} 出局后将警徽传给 ${nextHolder.agentName}。`,
    action: 'badge-transfer',
  };
}

export function resolveWerewolfHunterShot(state: CollaborationWerewolfState, hunterName?: string, forcedTarget?: string): {
  state: CollaborationWerewolfState;
  target?: string;
  content?: string;
} {
  if (!hunterName || state.roleState?.hunterShotUsed) return { state };
  const hunter = getWerewolfPlayer(state, hunterName);
  if (!hunter || hunter.role !== 'hunter') return { state };
  const target = forcedTarget
    ? getAliveWerewolfPlayers(state).find((player) => player.agentName === forcedTarget && player.agentName !== hunterName)
    : undefined;
  const roleState = { ...getWerewolfRoleState(state), hunterShotUsed: true };
  if (!target) {
    return {
      state: { ...state, roleState, pendingHunterShot: undefined },
      content: `${hunterName} 作为猎人可以发动技能，但场上没有可带走的目标，选择不开枪。`,
    };
  }
  const afterShot = applyWerewolfDeaths({ ...state, roleState, pendingHunterShot: undefined }, [target.agentName]);
  return {
    state: afterShot,
    target: target.agentName,
    content: `${hunterName} 作为猎人发动技能，带走 ${target.agentName}。`,
  };
}

export function resolveWerewolfExplosion(state: CollaborationWerewolfState, hostMessage: string): {
  state: CollaborationWerewolfState;
  exploded?: string;
  content?: string;
} {
  if (!hostMessage.includes('自爆')) return { state };
  const aliveWolf = getAliveWerewolfPlayers(state).find((player) => (
    player.role === 'werewolf' && (hostMessage.includes(`@${player.agentName}`) || hostMessage.includes(player.agentName))
  )) || getAliveWerewolfPlayers(state).find((player) => player.role === 'werewolf');
  if (!aliveWolf) return { state };
  const explodedState = applyWerewolfDeaths(state, [aliveWolf.agentName]);
  const nextState = {
    ...explodedState,
    phase: 'night' as const,
    dayNumber: state.phase === 'day' || state.phase === 'voting' ? state.dayNumber + 1 : state.dayNumber,
    currentAction: 'wolf-meeting' as const,
    currentActor: aliveWolf.agentName,
    pendingLastWords: [],
    lastSummary: `${aliveWolf.agentName} 选择自爆，白天流程立即中止，直接进入下一夜。`,
  };
  return {
    state: nextState,
    exploded: aliveWolf.agentName,
    content: nextState.lastSummary,
  };
}

export function extractWerewolfStructuredResult<T>(text: string, predicate: (parsed: any) => parsed is T): T | null {
  return extractStructuredResult(text, predicate);
}

export function isWerewolfGuardResult(value: any): value is WerewolfGuardResult {
  return value?.action === 'guard-action' && (typeof value.target === 'string' || value.target === null);
}

export function isWerewolfWitchResult(value: any): value is WerewolfWitchResult {
  return value?.action === 'witch-action'
    && typeof value.save === 'boolean'
    && (typeof value.poisonTarget === 'string' || value.poisonTarget === null);
}

export function isWerewolfSeerResult(value: any): value is WerewolfSeerResult {
  return value?.action === 'seer-check' && (typeof value.target === 'string' || value.target === null);
}

export function isWerewolfHunterResult(value: any): value is WerewolfHunterResult {
  return value?.action === 'hunter-shot' && (typeof value.target === 'string' || value.target === null);
}

export function isWerewolfVoteResult(value: any): value is WerewolfVoteResult {
  return ['wolf-vote', 'day-vote', 'sheriff-vote'].includes(value?.action) && (typeof value.target === 'string' || value.target === null);
}

export function stripWerewolfResultBlocks(text: string): string {
  return String(text || '').replace(/<result>[\s\S]*?(?:<\/result>|$)/gi, '').trim();
}

export function parseWerewolfSheriffWithdrawal(output: string): boolean {
  return /退水|退警|不上警了|不竞选警长了|withdraw/i.test(output);
}

export function buildWerewolfVoteLines(votes: CollaborationWerewolfVote[], sheriff?: string, badgeDestroyed?: boolean): string[] {
  return votes.map((vote) => `${vote.voter} -> ${vote.target}${sheriff === vote.voter && !badgeDestroyed ? '（警长票）' : ''}${vote.reason ? `：${vote.reason}` : ''}`);
}

export function buildWerewolfTallySummary(votes: CollaborationWerewolfVote[], sheriff?: string, badgeDestroyed?: boolean): string {
  const tally = new Map<string, number>();
  votes.forEach((vote) => {
    const weight = sheriff === vote.voter && !badgeDestroyed ? 1.5 : 1;
    tally.set(vote.target, (tally.get(vote.target) || 0) + weight);
  });
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([target, score]) => `${target}=${Number.isInteger(score) ? score : score.toFixed(1)}`)
    .join(' / ');
}

function buildVoteAvatarSrc(name: string): string | undefined {
  if (isTemporaryWerewolfAgent(name)) return undefined;
  return resolveAgentAvatarSrc(undefined, name);
}

function buildVoteChartItems(input: {
  votes: { voter: string; target: string }[];
  sheriff?: string;
  badgeDestroyed?: boolean;
}) {
  const tally = new Map<string, number>();
  const votersByTarget = new Map<string, { name: string; avatarSrc?: string; weightLabel?: string }[]>();
  input.votes.forEach((vote) => {
    const weight = input.sheriff === vote.voter && !input.badgeDestroyed ? 1.5 : 1;
    tally.set(vote.target, (tally.get(vote.target) || 0) + weight);
    const bucket = votersByTarget.get(vote.target) || [];
    bucket.push({
      name: vote.voter,
      avatarSrc: buildVoteAvatarSrc(vote.voter),
      weightLabel: weight > 1 ? `${weight}` : undefined,
    });
    votersByTarget.set(vote.target, bucket);
  });
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([target, score]) => ({
      target,
      value: score,
      voters: votersByTarget.get(target) || [],
    }));
}

export function buildWerewolfTallyChartCard(input: {
  title: string;
  subtitle?: string;
  votes: CollaborationWerewolfVote[];
  sheriff?: string;
  badgeDestroyed?: boolean;
  visibility?: 'public' | 'god' | 'private' | 'werewolves';
  audience?: string[];
}): any[] {
  if (!input.votes.length) return [];
  return [{
    type: 'werewolf_tally_chart',
    visibility: input.visibility || 'public',
    audience: input.audience,
    header: {
      icon: 'bar_chart',
      title: input.title,
      subtitle: input.subtitle || buildWerewolfTallySummary(input.votes, input.sheriff, input.badgeDestroyed),
      gradient: 'from-amber-700 via-stone-700 to-slate-700',
    },
    chart: {
      kind: 'vote-tally',
      items: buildVoteChartItems({
        votes: input.votes.map((vote) => ({ voter: vote.voter, target: vote.target })),
        sheriff: input.sheriff,
        badgeDestroyed: input.badgeDestroyed,
      }),
    },
  }];
}

export function buildWerewolfBreakpoint(input: {
  handler: 'night' | 'sheriff-election' | 'day-speech' | 'last-words' | 'vote';
  roundId: string;
  stepLabel: string;
  resumeFrom: string;
  failedActor: string;
  error: string;
}) {
  return {
    handler: input.handler,
    roundId: input.roundId,
    stepLabel: input.stepLabel,
    resumeFrom: input.resumeFrom,
    failedActor: input.failedActor,
    failedAt: Date.now(),
    error: input.error,
  } as NonNullable<CollaborationWerewolfState['breakpoint']>;
}

export function getWerewolfWinner(state: CollaborationWerewolfState): string | null {
  const alive = getAliveWerewolfPlayers(state);
  const wolves = alive.filter((player) => player.role === 'werewolf').length;
  const gods = alive.filter((player) => ['seer', 'witch', 'hunter', 'idiot', 'guard'].includes(player.role)).length;
  const villagers = alive.filter((player) => player.role === 'villager').length;
  if (wolves === 0) return '好人阵营获胜';
  if (gods === 0 || villagers === 0) return '狼人阵营获胜';
  return null;
}

export function pickRandomTemporaryWerewolfAgents(count: number): string[] {
  const names = listTemporaryWerewolfAgentNames();
  const pool = [...names];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

export function getWerewolfSpeakerVisual(agentName: string, players?: CollaborationWerewolfPlayer[] | null) {
  const rosterIndex = players?.findIndex((player) => player.agentName === agentName) ?? -1;
  const fallbackIndex = listTemporaryWerewolfAgentNames().findIndex((name) => name === agentName);
  const index = rosterIndex >= 0 ? rosterIndex : fallbackIndex;
  if (index < 0) return null;
  return WEREWOLF_SPEAKER_VISUALS[index % WEREWOLF_SPEAKER_VISUALS.length];
}

export function getCollaborationSeatStyle(index: number) {
  return WEREWOLF_SPEAKER_VISUALS[index % WEREWOLF_SPEAKER_VISUALS.length];
}

export function createWerewolfChatCard(message: CollaborationRoomMessage, players?: CollaborationWerewolfPlayer[] | null) {
  const rosterIndex = players?.findIndex((player) => player.agentName === message.speakerName) ?? -1;
  const player = players?.find((item) => item.agentName === message.speakerName);
  const fallbackIndex = listTemporaryWerewolfAgentNames().findIndex((name) => name === message.speakerName);
  return {
    type: 'werewolf_speech',
    speakerName: message.speakerName,
    speakerType: message.speakerType,
    role: player?.role,
    roleLabel: player ? formatWerewolfRole(player.role) : undefined,
    actionLabel: formatWerewolfActionLabel(message.werewolf?.action || message.werewolf?.phase),
    visibility: message.werewolf?.visibility || 'public',
    audience: message.werewolf?.audience,
    actor: message.werewolf?.actor,
    colorIndex: rosterIndex >= 0 ? rosterIndex : Math.max(0, fallbackIndex),
  };
}

export function formatWerewolfActionLabel(
  action?: NonNullable<CollaborationRoomMessage['werewolf']>['action'] | CollaborationWerewolfState['currentAction'] | CollaborationWerewolfPhase
): string {
  switch (action) {
    case 'setup':
      return '配置';
    case 'night':
      return '黑夜';
    case 'day':
      return '白天';
    case 'voting':
      return '投票';
    case 'last-words':
      return '遗言';
    case 'ended':
      return '结算';
    case 'day-speech':
      return '白天发言';
    case 'sheriff-election':
      return '上警举手';
    case 'sheriff-speech':
      return '警长竞选发言';
    case 'sheriff-vote':
      return '警长投票';
    case 'badge-transfer':
      return '警徽传递';
    case 'badge-destroy':
      return '撕警徽';
    case 'wolf-meeting':
      return '狼人内部会议';
    case 'guard-action':
      return '守卫行动';
    case 'seer-check':
      return '预言家查验';
    case 'wolf-kill':
      return '狼人行动';
    case 'witch-action':
      return '女巫行动';
    case 'hunter-shot':
      return '猎人开枪';
    case 'idiot-reveal':
      return '白痴翻牌';
    case 'vote':
      return '投票';
    case 'settlement':
      return '结算';
    case 'idle':
    default:
      return '待推进';
  }
}

export type WerewolfLabBoardLike = WerewolfLabBoard;
