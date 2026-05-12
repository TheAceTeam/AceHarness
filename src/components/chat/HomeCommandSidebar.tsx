'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agentApi, configApi, workflowApi } from '@/lib/api';
import type {
  CollaborationRoomMessage,
  CollaborationRoomState,
  CollaborationWerewolfAction,
  CollaborationWerewolfMemoryEntry,
  CollaborationWerewolfPhase,
  CollaborationWerewolfPlayer,
  CollaborationWerewolfState,
  CollaborationWerewolfVote,
  HomeSidebarHint,
  SessionWorkbenchState,
} from '@/lib/home-sidebar-state';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run-state-persistence';
import HumanQuestionInbox from '@/components/workflow/HumanQuestionInbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  buildWorkflowConversationDirectory,
  getCreationSessionStatusLabel,
  type WorkflowCreationBindingLike,
  type WorkflowRunBindingLike,
} from '@/lib/agent-conversations';
import {
  buildAgentDraftPreview,
  buildAgentSystemPrompt,
  createInitialAgentDraft,
  extractAgentDraftCapabilities,
  mergeAgentDraft,
  type AgentDraftState,
} from '@/lib/agent-draft';
import NewConfigModal from '@/components/NewConfigModal';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SingleCombobox } from '@/components/ui/combobox';
import { EngineSelect } from '@/components/EngineSelect';
import { ModelSelect } from '@/components/ModelSelect';
import {
  DEFAULT_WEREWOLF_BOARD_ID,
  TEMP_WEREWOLF_AGENTS,
  TEMP_WEREWOLF_SUPERVISOR,
  WEREWOLF_LAB_BOARDS,
  WEREWOLF_ROLE_PROMPTS,
  getTemporaryWerewolfAgent,
  getWerewolfLabBoard,
  isTemporaryWerewolfAgent,
  isWerewolfLabTopic,
  listTemporaryWerewolfAgentNames,
} from '@/lib/werewolf-lab-agents';
import { WEREWOLF_ROLE_ASSETS, WEREWOLF_ROLEBOOK_ENTRIES, getWerewolfRoleSpriteStyle } from '@/lib/werewolf-role-assets';
import { resolveAgentAvatarSrc } from '@/lib/agent-personas';
import { cn } from '@/lib/utils';
import { extractStructuredResult } from '@/lib/result-channel';
type WerewolfHistoryEntry = {
  id: string;
  boardId: string;
  boardName: string;
  result: string;
  summary: string;
  lessons: string[];
  highlights: string[];
  generatedAt: string;
};

type SidebarTab = 'commander' | 'workflow' | 'agent';

type WorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
};

type AgentSummary = {
  name: string;
  team: 'blue' | 'red' | 'judge' | string;
  description?: string;
  tags?: string[];
};

type ProgressReport = {
  id: string;
  timestamp: string;
  title: string;
  content: string;
  tone: 'info' | 'success' | 'warning';
};

type PreflightCheck = {
  id: string;
  category: 'lint' | 'compile' | 'test' | 'custom';
  status: 'passed' | 'failed' | 'warning';
  origin?: 'workflow' | 'inferred';
  summary: string;
  commands: Array<{
    command: string;
    exitCode: number | null;
    status: 'passed' | 'failed' | 'warning';
    stdout?: string;
    stderr?: string;
    errorText?: string | null;
  }>;
};

const MAX_COLLAB_MESSAGES = 40;

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

const WEREWOLF_ROLEBOOK_CAMPS = ['好人阵营', '狼人阵营', '第三方', '特殊'] as const;

type RoundtableSeat = {
  id: string;
  name: string;
  seatNumber?: number;
  subtitle?: string;
  meta?: string;
  statusLabel?: string;
  detail?: string;
  accentClass?: string;
  nameClass?: string;
  avatarClass?: string;
  ringClass?: string;
  active?: boolean;
  speaking?: boolean;
  dimmed?: boolean;
  eliminated?: boolean;
};

type WerewolfGuardResult = {
  action: 'guard-action';
  target: string | null;
  reason?: string;
};

type WerewolfWitchResult = {
  action: 'witch-action';
  save: boolean;
  poisonTarget: string | null;
  reason?: string;
};

type WerewolfSeerResult = {
  action: 'seer-check';
  target: string | null;
  reason?: string;
};

type WerewolfHunterResult = {
  action: 'hunter-shot';
  target: string | null;
  reason?: string;
};

type WerewolfVoteResult = {
  action: 'wolf-vote' | 'day-vote' | 'sheriff-vote';
  target: string | null;
  reason?: string;
};

function buildPreflightWarningDescription(checks: PreflightCheck[]): string {
  const warnings = checks.filter((check) => check.status === 'warning').slice(0, 3);
  if (warnings.length === 0) return '启动前检查存在警告，确认后将继续启动。';
  return warnings
    .map((check) => `${check.summary}${check.commands[0]?.command ? `\n${check.commands[0].command}` : ''}`)
    .join('\n\n');
}

function createCollaborationMessage(input: Omit<CollaborationRoomMessage, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): CollaborationRoomMessage {
  return {
    id: input.id || `collab-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt || Date.now(),
    ...input,
  };
}

function getRoundtableSeatStyle(index: number) {
  return WEREWOLF_SPEAKER_VISUALS[index % WEREWOLF_SPEAKER_VISUALS.length];
}

async function fetchWerewolfHistory(limit = 8): Promise<WerewolfHistoryEntry[]> {
  const response = await fetch(`/api/werewolf/history?limit=${limit}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('获取历史对局记忆失败');
  const data = await response.json();
  return Array.isArray(data?.entries) ? data.entries : [];
}

async function saveWerewolfHistory(entry: WerewolfHistoryEntry): Promise<void> {
  const response = await fetch('/api/werewolf/history', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error('写入历史对局记忆失败');
}

function createWerewolfMemoryEntry(input: Omit<CollaborationWerewolfMemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: number }): CollaborationWerewolfMemoryEntry {
  return {
    id: input.id || `ww-memory-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: input.createdAt || Date.now(),
    ...input,
  };
}

function mergeCollaborationRoom(
  prev: CollaborationRoomState | null | undefined,
  patch: Partial<CollaborationRoomState>
): CollaborationRoomState {
  return {
    topic: patch.topic ?? prev?.topic ?? '',
    selectedAgents: patch.selectedAgents ?? prev?.selectedAgents ?? [],
    mode: patch.mode ?? prev?.mode ?? 'roundtable',
    messages: patch.messages ?? prev?.messages ?? [],
    rounds: patch.rounds ?? prev?.rounds ?? [],
    agentSessions: patch.agentSessions ?? prev?.agentSessions ?? {},
    werewolfLabConfig: patch.werewolfLabConfig ?? prev?.werewolfLabConfig,
    werewolf: patch.werewolf ?? prev?.werewolf ?? null,
    werewolfView: patch.werewolfView ?? prev?.werewolfView,
  };
}

function areStringSetsEqual(set: Set<string>, values: string[]): boolean {
  if (set.size !== values.length) return false;
  return values.every((value) => set.has(value));
}

function extractAgentMentions(input: string, availableAgents: string[]): string[] {
  if (!input.trim()) return [];
  const mentions: string[] = [];
  const pushMention = (agent: string) => {
    if (!mentions.includes(agent)) mentions.push(agent);
  };
  const escapedAgents = availableAgents
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((agent) => agent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const mentionPattern = escapedAgents.length
    ? new RegExp(`@全员|@(${escapedAgents.join('|')})`, 'gu')
    : /@全员/gu;
  for (const match of input.matchAll(mentionPattern)) {
    const token = match[0];
    if (token === '@全员') {
      availableAgents.forEach(pushMention);
    } else {
      const agentName = token.slice(1);
      if (availableAgents.includes(agentName)) pushMention(agentName);
    }
  }
  return mentions;
}

function extractNextRoundMentions(input: string, availableAgents: string[], speaker?: string): string[] {
  return extractAgentMentions(input, availableAgents).filter((agent) => agent !== speaker);
}

function shuffleArray<T>(items: T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function createWerewolfState(agentNames: string[], supervisorName: string, boardId = DEFAULT_WEREWOLF_BOARD_ID): CollaborationWerewolfState {
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

function formatWerewolfRole(role: CollaborationWerewolfPlayer['role']): string {
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

function formatWerewolfRoster(state?: CollaborationWerewolfState | null, reveal = false): string {
  if (!state?.players?.length) return '暂无玩家';
  return state.players
    .map((player) => {
      const status = player.alive ? '存活' : '出局';
      const role = reveal || state.revealedRoles ? ` / ${formatWerewolfRole(player.role)}` : '';
      return `- ${player.agentName}: ${status}${role}，人格：${player.persona}`;
    })
    .join('\n');
}

function formatWerewolfPersonaRoster(state?: CollaborationWerewolfState | null): string {
  if (!state?.players?.length) return '暂无玩家';
  return state.players
    .map((player) => {
      const temporaryAgent = getTemporaryWerewolfAgent(player.agentName);
      const speakingHint = temporaryAgent ? `；说话感觉：${temporaryAgent.speechStyle}` : '';
      return `- ${player.agentName}：${player.persona}${speakingHint}`;
    })
    .join('\n');
}

function getAliveWerewolfPlayers(state?: CollaborationWerewolfState | null): CollaborationWerewolfPlayer[] {
  return (state?.players || []).filter((player) => player.alive);
}

function getWerewolfPlayer(state: CollaborationWerewolfState, agentName?: string): CollaborationWerewolfPlayer | undefined {
  return state.players.find((player) => player.agentName === agentName);
}

function hasWerewolfRole(state: CollaborationWerewolfState, role: CollaborationWerewolfPlayer['role']): boolean {
  return state.players.some((player) => player.role === role);
}

function getWerewolfRoleState(state: CollaborationWerewolfState): NonNullable<CollaborationWerewolfState['roleState']> {
  return {
    witchAntidoteUsed: false,
    witchPoisonUsed: false,
    hunterShotUsed: false,
    idiotRevealed: false,
    ...state.roleState,
  };
}

function getWerewolfSpeechOrder(state: CollaborationWerewolfState): string[] {
  const aliveNames = getAliveWerewolfPlayers(state).map((player) => player.agentName);
  const base = state.speechOrder?.length ? state.speechOrder : state.players.map((player) => player.agentName);
  const ordered = base.filter((name) => aliveNames.includes(name));
  const missing = aliveNames.filter((name) => !ordered.includes(name));
  if (!state.sheriff || !ordered.includes(state.sheriff)) return [...ordered, ...missing];
  const sheriffIndex = ordered.indexOf(state.sheriff);
  return [...ordered.slice(sheriffIndex + 1), ...missing, ...ordered.slice(0, sheriffIndex + 1)];
}

function pickWerewolfTarget(players: CollaborationWerewolfPlayer[], excludedNames: string[] = [], preferredRole?: CollaborationWerewolfPlayer['role']): CollaborationWerewolfPlayer | undefined {
  const pool = players.filter((player) => !excludedNames.includes(player.agentName));
  if (preferredRole) {
    const preferred = pool.filter((player) => player.role === preferredRole);
    if (preferred.length) return preferred[Math.floor(Math.random() * preferred.length)];
  }
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : undefined;
}

function applyWerewolfDeaths(state: CollaborationWerewolfState, deaths: string[]): CollaborationWerewolfState {
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

function resolveWerewolfBadgeAfterDeaths(state: CollaborationWerewolfState, deaths: string[]): {
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

function resolveWerewolfHunterShot(state: CollaborationWerewolfState, hunterName?: string, forcedTarget?: string): {
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

function resolveWerewolfExplosion(state: CollaborationWerewolfState, hostMessage: string): {
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

function parseVoteTarget(output: string, candidates: string[]): { target: string; reason: string } | null {
  const voteLine = output.match(/VOTE\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const reason = output.match(/REASON\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const normalizedVote = voteLine.replace(/^@/, '').trim();
  const direct = candidates.find((candidate) => normalizedVote === candidate || normalizedVote.includes(candidate));
  if (direct) return { target: direct, reason };
  const mentioned = candidates.find((candidate) => output.includes(`@${candidate}`) || output.includes(candidate));
  return mentioned ? { target: mentioned, reason } : null;
}

function parseNamedWerewolfAction(
  output: string,
  labels: string[],
  candidates: string[]
): { target?: string; none: boolean; reason: string } | null {
  const lines = labels.map((label) => output.match(new RegExp(`${label}\\s*[:：]\\s*([^\\n\\r]+)`, 'i'))?.[1]?.trim() || '');
  const raw = lines.find(Boolean) || '';
  const reason = output.match(/REASON\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  if (!raw) return null;
  const normalized = raw.replace(/^@/, '').trim();
  if (['NONE', 'NO', 'SKIP', '不发动', '不使用', '无人', '无'].includes(normalized.toUpperCase()) || ['不发动', '不使用', '无人', '无'].includes(normalized)) {
    return { none: true, reason };
  }
  const direct = candidates.find((candidate) => normalized === candidate || normalized.includes(candidate));
  if (direct) return { target: direct, none: false, reason };
  const mentioned = candidates.find((candidate) => output.includes(`@${candidate}`) || output.includes(candidate));
  return mentioned ? { target: mentioned, none: false, reason } : null;
}

function parseWitchAction(output: string, candidates: string[]): { save: boolean; poisonTarget?: string; reason: string } | null {
  const saveRaw = output.match(/SAVE\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const poisonRaw = output.match(/POISON\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  const reason = output.match(/REASON\s*[:：]\s*([^\n\r]+)/i)?.[1]?.trim() || '';
  if (!saveRaw && !poisonRaw) return null;
  const normalizedSave = saveRaw.toUpperCase();
  const save = ['YES', 'Y', '救', '使用解药', '要救'].some((token) => normalizedSave.includes(token) || saveRaw.includes(token));
  const normalizedPoison = poisonRaw.replace(/^@/, '').trim();
  const poisonTarget = candidates.find((candidate) => normalizedPoison === candidate || normalizedPoison.includes(candidate))
    || candidates.find((candidate) => output.includes(`@${candidate}`) || output.includes(candidate));
  return {
    save,
    poisonTarget: ['NONE', 'NO', 'SKIP', '不毒', '不使用', '无'].includes(normalizedPoison.toUpperCase()) || ['不毒', '不使用', '无'].includes(normalizedPoison)
      ? undefined
      : poisonTarget,
    reason,
  };
}

function extractWerewolfStructuredResult<T>(text: string, predicate: (parsed: any) => parsed is T): T | null {
  return extractStructuredResult(text, predicate);
}

function isWerewolfGuardResult(value: any): value is WerewolfGuardResult {
  return value?.action === 'guard-action' && (typeof value.target === 'string' || value.target === null);
}

function isWerewolfWitchResult(value: any): value is WerewolfWitchResult {
  return value?.action === 'witch-action'
    && typeof value.save === 'boolean'
    && (typeof value.poisonTarget === 'string' || value.poisonTarget === null);
}

function isWerewolfSeerResult(value: any): value is WerewolfSeerResult {
  return value?.action === 'seer-check' && (typeof value.target === 'string' || value.target === null);
}

function isWerewolfHunterResult(value: any): value is WerewolfHunterResult {
  return value?.action === 'hunter-shot' && (typeof value.target === 'string' || value.target === null);
}

function isWerewolfVoteResult(value: any): value is WerewolfVoteResult {
  return ['wolf-vote', 'day-vote', 'sheriff-vote'].includes(value?.action) && (typeof value.target === 'string' || value.target === null);
}

function stripWerewolfResultBlocks(text: string): string {
  return String(text || '').replace(/<result>[\s\S]*?(?:<\/result>|$)/gi, '').trim();
}

function extractAnyWerewolfResult(text: string):
  | WerewolfGuardResult
  | WerewolfWitchResult
  | WerewolfSeerResult
  | WerewolfHunterResult
  | WerewolfVoteResult
  | null {
  return extractWerewolfStructuredResult(text, (value: any): value is
    | WerewolfGuardResult
    | WerewolfWitchResult
    | WerewolfSeerResult
    | WerewolfHunterResult
    | WerewolfVoteResult => (
      isWerewolfGuardResult(value)
      || isWerewolfWitchResult(value)
      || isWerewolfSeerResult(value)
      || isWerewolfHunterResult(value)
      || isWerewolfVoteResult(value)
    ));
}

function formatWerewolfDecisionResult(result: ReturnType<typeof extractAnyWerewolfResult>): string {
  if (!result) return '';
  const reason = typeof result.reason === 'string' && result.reason.trim()
    ? `\n理由：${result.reason.trim()}`
    : '';
  switch (result.action) {
    case 'wolf-vote':
      return `决策结果：狼人刀口 -> ${result.target || '不投票'}${reason}`;
    case 'day-vote':
      return `决策结果：放逐投票 -> ${result.target || '弃票'}${reason}`;
    case 'sheriff-vote':
      return `决策结果：警长投票 -> ${result.target || '弃票'}${reason}`;
    case 'guard-action':
      return `决策结果：守卫守护 -> ${result.target || '空守'}${reason}`;
    case 'witch-action':
      return [
        `决策结果：女巫${result.save ? '使用解药' : '不使用解药'}`,
        `毒药目标：${result.poisonTarget || '不使用毒药'}`,
        reason ? reason.slice(1) : '',
      ].filter(Boolean).join('\n');
    case 'seer-check':
      return `决策结果：预言家查验 -> ${result.target || '不查验'}${reason}`;
    case 'hunter-shot':
      return `决策结果：猎人开枪 -> ${result.target || '不开枪'}${reason}`;
    default:
      return '';
  }
}

function buildWerewolfDecisionCard(result: ReturnType<typeof extractAnyWerewolfResult>, visibility?: 'public' | 'god' | 'private' | 'werewolves', audience?: string[]): any | null {
  if (!result) return null;
  const rows: { label: string; value: string; icon?: string }[] = [];
  let title = '决策结果';
  let subtitle = '来自 <result> 机器通道';
  let icon = 'rule';

  switch (result.action) {
    case 'wolf-vote':
      title = '狼人刀口决策';
      subtitle = result.target ? `刀口：${result.target}` : '未投出刀口';
      icon = 'local_fire_department';
      rows.push({ label: '目标', value: result.target || '不投票', icon: 'target' });
      break;
    case 'day-vote':
      title = '放逐投票决策';
      subtitle = result.target ? `投给：${result.target}` : '弃票';
      icon = 'how_to_vote';
      rows.push({ label: '目标', value: result.target || '弃票', icon: 'person_remove' });
      break;
    case 'sheriff-vote':
      title = '警长投票决策';
      subtitle = result.target ? `投给：${result.target}` : '弃票';
      icon = 'workspace_premium';
      rows.push({ label: '目标', value: result.target || '弃票', icon: 'military_tech' });
      break;
    case 'guard-action':
      title = '守卫行动';
      subtitle = result.target ? `守护：${result.target}` : '空守';
      icon = 'shield';
      rows.push({ label: '目标', value: result.target || '空守', icon: 'shield' });
      break;
    case 'witch-action':
      title = '女巫行动';
      subtitle = `${result.save ? '使用解药' : '不使用解药'} / ${result.poisonTarget ? `毒 ${result.poisonTarget}` : '不使用毒药'}`;
      icon = 'science';
      rows.push({ label: '解药', value: result.save ? '使用' : '不使用', icon: 'healing' });
      rows.push({ label: '毒药', value: result.poisonTarget || '不使用', icon: 'skull' });
      break;
    case 'seer-check':
      title = '预言家查验';
      subtitle = result.target ? `查验：${result.target}` : '未查验';
      icon = 'visibility';
      rows.push({ label: '目标', value: result.target || '不查验', icon: 'visibility' });
      break;
    case 'hunter-shot':
      title = '猎人开枪';
      subtitle = result.target ? `带走：${result.target}` : '不开枪';
      icon = 'my_location';
      rows.push({ label: '目标', value: result.target || '不开枪', icon: 'my_location' });
      break;
  }

  return {
    type: 'werewolf_decision',
    visibility: visibility || 'public',
    audience,
    header: {
      icon,
      title,
      subtitle,
      gradient: 'from-amber-700 via-stone-700 to-slate-700',
    },
    blocks: [
      { type: 'info', rows },
      ...(result.reason ? [{ type: 'text', content: `理由：${result.reason}`, maxLines: 3 }] : []),
    ],
  };
}

function formatWerewolfMessageForDisplay(content: string): { content: string; result: ReturnType<typeof extractAnyWerewolfResult> } {
  const result = extractAnyWerewolfResult(content);
  const visibleContent = stripWerewolfResultBlocks(content);
  const decisionText = formatWerewolfDecisionResult(result);
  return {
    content: [visibleContent, decisionText].filter(Boolean).join('\n\n'),
    result,
  };
}

function prepareWerewolfMessageForChat(message: CollaborationRoomMessage): CollaborationRoomMessage {
  if (!message.werewolf) return message;
  const rawContent = message.rawContent || message.content;
  const formatted = formatWerewolfMessageForDisplay(rawContent);
  const decisionCard = buildWerewolfDecisionCard(formatted.result, message.werewolf.visibility, message.werewolf.audience);
  return {
    ...message,
    content: formatted.content || stripWerewolfResultBlocks(message.content) || message.content,
    rawContent,
    cards: decisionCard
      ? [decisionCard, ...((message.cards || []).filter((card) => card?.type !== 'werewolf_decision'))]
      : message.cards,
  };
}

function parseWerewolfSheriffWithdrawal(output: string): boolean {
  const normalized = output.replace(/\s+/g, '');
  return [
    '退水',
    '退警',
    '不上警',
    '不拿警徽',
    '放弃警长',
    '我退',
    '我不竞选警长',
  ].some((keyword) => normalized.includes(keyword));
}

function buildWerewolfVoteLines(votes: CollaborationWerewolfVote[], sheriff?: string, badgeDestroyed?: boolean): string[] {
  return votes.map((vote) => `${vote.voter} -> ${vote.target}${sheriff === vote.voter && !badgeDestroyed ? '（警长票）' : ''}${vote.reason ? `：${vote.reason}` : ''}`);
}

function buildWerewolfTallySummary(votes: CollaborationWerewolfVote[], sheriff?: string, badgeDestroyed?: boolean): string {
  const tally = new Map<string, number>();
  votes.forEach((vote) => {
    const weight = sheriff === vote.voter && !badgeDestroyed ? 1.5 : 1;
    tally.set(vote.target, (tally.get(vote.target) || 0) + weight);
  });
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '暂无有效票型。';
  return sorted.map(([target, weight]) => `${target} ${Number.isInteger(weight) ? weight.toFixed(0) : weight.toFixed(1)} 票`).join('；');
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
      ...(weight !== 1 ? { weightLabel: `${weight} 票` } : {}),
    });
    votersByTarget.set(vote.target, bucket);
  });
  const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const colors = ['rose', 'sky', 'emerald', 'amber', 'violet', 'cyan', 'lime', 'orange'];
  return {
    max: sorted[0]?.[1],
    items: sorted.map(([target, value], index) => ({
      label: target,
      value,
      displayValue: `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} 票`,
      color: colors[index % colors.length],
      voters: votersByTarget.get(target) || [],
    })),
  };
}

function buildRoundVoteChartCard(input: {
  title: string;
  subtitle?: string;
  votes: { voter: string; target: string }[];
  sheriff?: string;
  badgeDestroyed?: boolean;
}) {
  if (!input.votes.length) return [];
  const chart = buildVoteChartItems({
    votes: input.votes,
    sheriff: input.sheriff,
    badgeDestroyed: input.badgeDestroyed,
  });
  if (!chart.items.length) return [];
  return [{
    type: 'round_vote_chart',
    header: {
      icon: 'bar_chart',
      title: input.title,
      subtitle: input.subtitle,
      gradient: 'from-slate-700 via-slate-600 to-slate-500',
    },
    blocks: [{
      type: 'bar-chart',
      max: chart.max,
      items: chart.items,
    }],
  }];
}

function extractRoundVotes(messages: CollaborationRoomMessage[], candidates?: string[]) {
  const votes: { voter: string; target: string }[] = [];
  const allowed = candidates?.length ? candidates : undefined;
  messages.forEach((message) => {
    if (message.speakerType !== 'agent' && message.speakerType !== 'supervisor') return;
    const parsed = parseVoteTarget(message.content, allowed || []);
    if (!parsed) return;
    if (allowed && !allowed.includes(parsed.target)) return;
    votes.push({
      voter: message.speakerName,
      target: parsed.target,
    });
  });
  return votes;
}

function buildWerewolfTallyChartCard(input: {
  title: string;
  subtitle?: string;
  votes: CollaborationWerewolfVote[];
  sheriff?: string;
  badgeDestroyed?: boolean;
  visibility?: 'public' | 'god' | 'private' | 'werewolves';
  audience?: string[];
}): any[] {
  if (!input.votes.length) return [];
  const chart = buildVoteChartItems({
    votes: input.votes.map((vote) => ({ voter: vote.voter, target: vote.target })),
    sheriff: input.sheriff,
    badgeDestroyed: input.badgeDestroyed,
  });
  if (!chart.items.length) return [];
  return [{
    type: 'werewolf_tally_chart',
    visibility: input.visibility || 'public',
    audience: input.audience,
    header: {
      icon: 'bar_chart',
      title: input.title,
      subtitle: input.subtitle,
      gradient: 'from-slate-700 via-slate-600 to-slate-500',
    },
    blocks: [{
      type: 'bar-chart',
      max: chart.max,
      items: chart.items,
    }],
  }];
}

function buildWerewolfBreakpoint(input: {
  handler: 'night' | 'sheriff-election' | 'day-speech' | 'last-words' | 'vote';
  roundId: string;
  stepLabel: string;
  resumeFrom?: string;
  failedActor?: string;
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

function getWerewolfWinner(state: CollaborationWerewolfState): string | null {
  const alive = getAliveWerewolfPlayers(state);
  const wolves = alive.filter((player) => player.role === 'werewolf').length;
  const gods = alive.filter((player) => ['seer', 'witch', 'hunter', 'idiot', 'guard'].includes(player.role)).length;
  const villagers = alive.filter((player) => player.role === 'villager').length;
  if (wolves === 0) return '好人阵营获胜';
  if (gods === 0 || villagers === 0) return '狼人阵营获胜';
  return null;
}

function pickRandomTemporaryWerewolfAgents(count: number): string[] {
  const names = listTemporaryWerewolfAgentNames();
  const pool = [...names];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }
  return pool.slice(0, Math.min(count, pool.length));
}

function getWerewolfSpeakerVisual(agentName: string, players?: CollaborationWerewolfPlayer[] | null) {
  const rosterIndex = players?.findIndex((player) => player.agentName === agentName) ?? -1;
  const fallbackIndex = listTemporaryWerewolfAgentNames().findIndex((name) => name === agentName);
  const index = rosterIndex >= 0 ? rosterIndex : fallbackIndex;
  if (index < 0) return null;
  return WEREWOLF_SPEAKER_VISUALS[index % WEREWOLF_SPEAKER_VISUALS.length];
}

function getWerewolfSpeakerInitial(agentName: string): string {
  return agentName.replace(/\s+/g, '').slice(0, 1) || '?';
}

function createWerewolfChatCard(message: CollaborationRoomMessage, players?: CollaborationWerewolfPlayer[] | null) {
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

function buildTemporaryWerewolfRoleConfig(input: {
  agentName: string;
  supervisorName: string;
  state?: CollaborationWerewolfState | null;
  engine?: string;
  model?: string;
}) {
  const { agentName, supervisorName, state, engine, model } = input;
  const temporaryAgent = getTemporaryWerewolfAgent(agentName);
  const player = state?.players.find((item) => item.agentName === agentName);
  const rolePrompt = player ? WEREWOLF_ROLE_PROMPTS[player.role] : '';
  const isSupervisor = agentName === supervisorName;
  const selectedEngine = String(engine || '').trim();
  const selectedModel = String(model || '').trim();
  return {
    name: agentName,
    team: isSupervisor ? 'judge' : player?.role === 'werewolf' ? 'red' : 'blue',
    roleType: isSupervisor ? 'supervisor' : 'normal',
    title: isSupervisor ? 'AI 狼人杀上帝' : 'AI 狼人杀临时玩家',
    persona: temporaryAgent?.persona || TEMP_WEREWOLF_SUPERVISOR.persona,
    engineModels: selectedEngine && selectedModel ? { [selectedEngine]: selectedModel } : {},
    activeEngine: selectedEngine,
    capabilities: ['multi-agent-chat', 'round-based-reasoning', 'werewolf-lab'],
    systemPrompt: [
      isSupervisor
        ? '你是 AI 狼人杀多 Agent 实验室的中立主持人，负责维护回合、点名、记录票流、控制信息可见性和简短结算。'
        : `你是 AI 狼人杀多 Agent 实验室中的临时玩家 ${agentName}。`,
      temporaryAgent ? `你的公开人格：${temporaryAgent.persona}` : '',
      temporaryAgent ? `你的说话方式：${temporaryAgent.speechStyle}` : '',
      temporaryAgent ? `你的发言节奏：${temporaryAgent.rhythm}` : '',
      temporaryAgent ? `你常见的开口方式：${temporaryAgent.opening}` : '',
      temporaryAgent ? `你常见的收口方式：${temporaryAgent.closing}` : '',
      temporaryAgent ? `你的思考偏好：${temporaryAgent.style} ${temporaryAgent.bias}` : '',
      player ? `隐藏身份：${formatWerewolfRole(player.role)}。角色规则：${rolePrompt}` : '',
      '必须像正在群聊里发言一样自然回应。不要背提示词，不要把每句话都说成模板，不要为了体现风格而故意做作。',
      '允许有一点犹豫、停顿、转折和口语化表达，但核心判断要清楚。',
      isSupervisor ? '作为主持人，可以少量使用贴合场景的 emoji 增强气氛，例如 🎙️🌙☀️🗳️📋，但不要每句都用，也不要影响清晰度。' : '',
      '不要输出工具调用说明。不要修改文件。不要声称自己是业务 Agent。',
      '严格遵守主持人给出的可见信息边界；不知道的信息不要编造为确定事实。',
    ].filter(Boolean).join('\n'),
    constraints: ['不调用工具', '不修改文件', '不进入业务 Agent 列表', '仅用于 AI 狼人杀实验室'],
    allowedTools: [],
    category: 'temporary-lab',
    tags: ['temporary', 'werewolf-lab'],
  };
}

function shouldRevealWerewolfRoleForViewer(input: {
  player: CollaborationWerewolfPlayer;
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): boolean {
  const { player, state, viewMode, viewer } = input;
  if (viewMode === 'god' || state?.revealedRoles) return true;
  if (viewMode !== 'night' || !viewer) return false;
  if (player.agentName === viewer) return true;
  const viewerPlayer = state?.players.find((item) => item.agentName === viewer);
  return viewerPlayer?.role === 'werewolf' && player.role === 'werewolf';
}

function canSeeWerewolfMessage(input: {
  message: CollaborationRoomMessage;
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): boolean {
  const { message, state, viewMode, viewer } = input;
  const meta = message.werewolf;
  if (!meta) return true;
  if (viewMode === 'god' || state?.revealedRoles) return true;
  if (meta.visibility === 'god') return false;
  if (meta.visibility === 'private') return Boolean(viewer && meta.audience?.includes(viewer));
  if (meta.visibility === 'werewolves') {
    const viewerPlayer = state?.players.find((player) => player.agentName === viewer);
    return viewerPlayer?.role === 'werewolf';
  }
  return true;
}

function canSeeWerewolfActionMeta(input: {
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): boolean {
  const { state, viewMode, viewer } = input;
  const action = state?.currentAction;
  if (!state || !action || viewMode === 'god' || state.revealedRoles) return true;
  if (action === 'guard-action' || action === 'witch-action' || action === 'seer-check') {
    return Boolean(viewer && state.currentActor === viewer);
  }
  if (action === 'wolf-meeting' || action === 'wolf-kill') {
    const viewerPlayer = state.players.find((player) => player.agentName === viewer);
    return viewerPlayer?.role === 'werewolf';
  }
  return true;
}

function canSeeWerewolfMemory(input: {
  entry: CollaborationWerewolfMemoryEntry;
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): boolean {
  const { entry, state, viewMode, viewer } = input;
  if (viewMode === 'god' || state?.revealedRoles) return true;
  if (entry.visibility === 'god') return false;
  if (entry.visibility === 'private') return Boolean(viewer && entry.audience?.includes(viewer));
  if (entry.visibility === 'werewolves') {
    const viewerPlayer = state?.players.find((player) => player.agentName === viewer);
    return viewerPlayer?.role === 'werewolf';
  }
  return true;
}

type WerewolfPromptContextBuckets = {
  publicLines: string[];
  teamLines: string[];
  privateLines: string[];
};

function classifyWerewolfPromptVisibility(input: {
  visibility?: 'public' | 'god' | 'private' | 'werewolves';
  audience?: string[];
  state?: CollaborationWerewolfState | null;
  viewer?: string;
  allowGodView?: boolean;
}): 'public' | 'team' | 'private' | 'hidden' {
  const { visibility, audience, state, viewer, allowGodView } = input;
  if (allowGodView || state?.revealedRoles) {
    if (visibility === 'public' || !visibility) return 'public';
    if (visibility === 'werewolves') return 'team';
    return 'private';
  }
  if (visibility === 'god') return 'hidden';
  if (visibility === 'public' || !visibility) return 'public';
  if (visibility === 'private') {
    return viewer && audience?.includes(viewer) ? 'private' : 'hidden';
  }
  if (visibility === 'werewolves') {
    const viewerPlayer = state?.players.find((player) => player.agentName === viewer);
    return viewerPlayer?.role === 'werewolf' ? 'team' : 'hidden';
  }
  return 'hidden';
}

function splitWerewolfTranscriptForPrompt(input: {
  messages: CollaborationRoomMessage[];
  state: CollaborationWerewolfState;
  viewer: string;
  allowGodView?: boolean;
  limit?: number;
}): WerewolfPromptContextBuckets {
  const buckets: WerewolfPromptContextBuckets = {
    publicLines: [],
    teamLines: [],
    privateLines: [],
  };
  input.messages.forEach((message) => {
    const scope = classifyWerewolfPromptVisibility({
      visibility: message.werewolf?.visibility,
      audience: message.werewolf?.audience,
      state: input.state,
      viewer: input.viewer,
      allowGodView: input.allowGodView,
    });
    if (scope === 'hidden') return;
    const actionLabel = message.werewolf?.action ? ` / ${formatWerewolfActionLabel(message.werewolf.action)}` : '';
    const line = `- ${message.speakerName}${actionLabel}: ${message.content.slice(0, 800)}`;
    if (scope === 'public') buckets.publicLines.push(line);
    if (scope === 'team') buckets.teamLines.push(line);
    if (scope === 'private') buckets.privateLines.push(line);
  });
  const limit = Math.max(1, input.limit || 12);
  return {
    publicLines: buckets.publicLines.slice(-limit),
    teamLines: buckets.teamLines.slice(-Math.max(4, Math.floor(limit / 2))),
    privateLines: buckets.privateLines.slice(-Math.max(4, Math.floor(limit / 2))),
  };
}

function splitWerewolfMemoriesForPrompt(input: {
  memories: CollaborationWerewolfMemoryEntry[];
  state: CollaborationWerewolfState;
  viewer: string;
  allowGodView?: boolean;
  limit?: number;
}): WerewolfPromptContextBuckets {
  const buckets: WerewolfPromptContextBuckets = {
    publicLines: [],
    teamLines: [],
    privateLines: [],
  };
  input.memories.forEach((entry) => {
    const scope = classifyWerewolfPromptVisibility({
      visibility: entry.visibility,
      audience: entry.audience,
      state: input.state,
      viewer: input.viewer,
      allowGodView: input.allowGodView,
    });
    if (scope === 'hidden') return;
    const line = formatWerewolfMemoryLine(entry);
    if (scope === 'public') buckets.publicLines.push(line);
    if (scope === 'team') buckets.teamLines.push(line);
    if (scope === 'private') buckets.privateLines.push(line);
  });
  const limit = Math.max(1, input.limit || 10);
  return {
    publicLines: buckets.publicLines.slice(-limit),
    teamLines: buckets.teamLines.slice(-Math.max(4, Math.floor(limit / 2))),
    privateLines: buckets.privateLines.slice(-Math.max(4, Math.floor(limit / 2))),
  };
}

function formatPromptBlock(lines: string[], emptyText: string): string {
  return lines.length ? lines.join('\n') : emptyText;
}

function buildWerewolfHostAnnouncement(input: {
  action?: CollaborationWerewolfAction;
  dayNumber?: number;
  players?: CollaborationWerewolfPlayer[];
  currentViewer?: string;
}): string {
  const players = input.players || [];
  const aliveNames = players.filter((player) => player.alive).map((player) => player.agentName);
  switch (input.action) {
    case 'sheriff-election':
      return `AI 上帝发言 🎙️：现在开始警长竞选。请先上警举手，再依次发言，之后统计退水并进入警长投票。`;
    case 'day-speech':
      return `AI 上帝发言 ☀️：现在进入第 ${input.dayNumber || 1} 天白天发言。请按顺序依次发言，最后一位负责归票。`;
    case 'wolf-meeting':
      return `AI 上帝发言 🌙：天黑请闭眼。狼队请睁眼，你们今晚要刀的人是？先讨论悍跳、冲锋、倒钩和刀口安排。`;
    case 'guard-action':
      return `AI 上帝发言 🛡️：守卫请睁眼，请选择今晚守护的目标。`;
    case 'witch-action':
      return `AI 上帝发言 🧪：女巫请睁眼，今晚中刀的玩家已经确定，请决定是否使用解药或毒药。`;
    case 'seer-check':
      return `AI 上帝发言 🔮：预言家请睁眼，请选择你今晚要查验的玩家。`;
    case 'vote':
      return `AI 上帝发言 🗳️：现在开始放逐投票。请所有存活玩家依次投票，警长票按 1.5 票结算。`;
    case 'settlement':
      return `AI 上帝发言 📋：现在开始结算，请大家关注票型、出局结果与后续发言顺序。`;
    default:
      return aliveNames.length
        ? `AI 上帝发言 🎙️：当前场上存活玩家有 ${aliveNames.join('、')}，请按流程继续。`
        : 'AI 上帝发言 🎙️：请按当前流程继续。';
  }
}

function buildWorkflowPromptContext(input: {
  agentName: string;
  transcript: CollaborationRoomMessage[];
  rounds: CollaborationRoomState['rounds'];
  hostMessage?: string;
  topic: string;
  participants?: string[];
}): {
  publicTranscriptBlock: string;
  privateTranscriptBlock: string;
  historyBlock: string;
  hostDirectiveBlock: string;
} {
  const publicLines = input.transcript
    .filter((message) => message.speakerType !== 'system' || message.status === 'error')
    .slice(-12)
    .map((message) => `- ${message.speakerName}: ${message.content.slice(0, 1000)}`);
  const privateLines = input.transcript
    .filter((message) => message.speakerName === input.agentName)
    .slice(-6)
    .map((message) => `- ${message.speakerName}: ${message.content.slice(0, 1000)}`);
  const historyLines = (input.rounds || [])
    .filter((round) => round.summary)
    .slice(-4)
    .map((round) => `- [${round.topic}] ${round.summary}`);
  return {
    publicTranscriptBlock: formatPromptBlock(publicLines, '暂无公开协作记录。'),
    privateTranscriptBlock: formatPromptBlock(privateLines, '暂无你的个人历史发言。'),
    historyBlock: formatPromptBlock(historyLines, '暂无历史轮次总结。'),
    hostDirectiveBlock: input.hostMessage?.trim() || '本轮没有额外主持指令。',
  };
}

function formatWerewolfMemoryLine(entry: CollaborationWerewolfMemoryEntry): string {
  return `- [D${entry.round}/${formatWerewolfActionLabel(entry.action || entry.phase)}] ${entry.title}: ${entry.summary}`;
}

function getWerewolfCurrentActionLabel(input: {
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): string {
  const { state, viewMode, viewer } = input;
  if (!state) return '未开始';
  if (canSeeWerewolfActionMeta({ state, viewMode, viewer })) {
    return formatWerewolfActionLabel(state.currentAction || state.phase);
  }
  return state.phase === 'night' ? '黑夜处理中' : formatWerewolfActionLabel(state.phase);
}

function getWerewolfCurrentActorLabel(input: {
  state?: CollaborationWerewolfState | null;
  viewMode: 'god' | 'night';
  viewer?: string;
}): string {
  const { state, viewMode, viewer } = input;
  if (!state?.currentActor) return TEMP_WEREWOLF_SUPERVISOR.name;
  if (canSeeWerewolfActionMeta({ state, viewMode, viewer })) {
    return state.currentActor;
  }
  return state.phase === 'night' ? '隐藏行动' : TEMP_WEREWOLF_SUPERVISOR.name;
}

function formatWerewolfActionLabel(action?: NonNullable<CollaborationRoomMessage['werewolf']>['action'] | CollaborationWerewolfState['currentAction'] | CollaborationWerewolfPhase): string {
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
    case 'last-words':
      return '死后遗言';
    case 'vote':
      return '投票';
    case 'settlement':
      return '结算';
    case 'idle':
    default:
      return '待推进';
  }
}

function getWerewolfSurvivalSummary(state?: CollaborationWerewolfState | null, revealRoles = false): string {
  if (!state?.players?.length) return '未开局';
  const alive = state.players.filter((player) => player.alive);
  const eliminated = state.players.filter((player) => !player.alive);
  const aliveText = alive.map((player) => revealRoles ? `${player.agentName}(${formatWerewolfRole(player.role)})` : player.agentName).join('、');
  const eliminatedText = eliminated.length
    ? eliminated.map((player) => revealRoles ? `${player.agentName}(${formatWerewolfRole(player.role)})` : player.agentName).join('、')
    : '暂无';
  return `存活 ${alive.length}/${state.players.length}：${aliveText || '暂无'}；出局：${eliminatedText}`;
}

function getMentionQuery(input: string): string | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex < 0) return null;
  const tail = input.slice(atIndex + 1);
  if (/[\s\n\r，。,.!！?？:：；;]/u.test(tail)) return null;
  return tail;
}

function insertMention(input: string, mention: string): string {
  const atIndex = input.lastIndexOf('@');
  const replacement = `@${mention} `;
  if (atIndex < 0) return `${input}${replacement}`;
  const before = input.slice(0, atIndex);
  const after = input.slice(atIndex + 1).replace(/^[^\s\n\r，。,.!！?？:：；;]*/u, '');
  return `${before}${replacement}${after}`;
}

type WorkflowDraftState = {
  name: string;
  requirements: string;
  description: string;
  referenceWorkflow: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
};

type AgentDraftResult = {
  name: string;
  team: string;
  engineModels: Record<string, string>;
  activeEngine: string;
  capabilities: string[];
  systemPrompt: string;
  description?: string;
  keywords?: string[];
  tags?: string[];
  category?: string;
};

function formatSupervisorReviewType(type?: string | null): string {
  if (type === 'checkpoint-advice') return '检查点建议';
  if (type === 'chat-revision') return '对话修订';
  if (type === 'state-review') return '阶段审阅';
  return type || '未知';
}

function formatSidebarStage(stage?: string | null): string {
  switch (stage) {
    case 'clarifying':
      return '需求澄清';
    case 'spec-draft':
      return 'Spec 计划';
    case 'spec-review':
      return 'Spec 计划评审';
    case 'workflow-draft':
      return '工作流草案';
    case 'agent-draft':
      return 'Agent 草案';
    case 'preflight':
      return '启动前检查';
    case 'running':
      return '运行中';
    case 'review':
      return '复盘';
    default:
      return stage || '待命';
  }
}

type ActiveChatSession = {
  id: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    rawContent?: string;
    timestamp: number;
  }>;
  creationSession?: WorkflowCreationBindingLike;
  workflowBinding?: WorkflowRunBindingLike;
} | null;

type CreationSessionBinding = NonNullable<Exclude<ActiveChatSession, null>['creationSession']>;

interface HomeCommandSidebarProps {
  engine: string;
  model: string;
  onQuickPrompt: (prompt: string) => void;
  activeSessionId: string | null;
  ensureSessionId: () => string;
  activeSession: ActiveChatSession;
  sessionWorkbenchState?: SessionWorkbenchState;
  setSessionWorkbenchState: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
  appendSessionMessage?: (
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'error';
      content: string;
      rawContent?: string;
      cards?: any[];
      engine?: string;
      model?: string;
      timestamp?: number;
      id?: string;
    }
  ) => Promise<void>;
  updateSessionMessage?: (
    sessionId: string,
    messageId: string,
    patch: {
      role?: 'user' | 'assistant' | 'error';
      content?: string;
      rawContent?: string;
      cards?: any[];
      engine?: string;
      model?: string;
      timestamp?: number;
    }
  ) => Promise<void>;
  sidebarHint: HomeSidebarHint | null;
  activeTab: SidebarTab;
  availableTabs: SidebarTab[];
  onTabChange: (tab: SidebarTab) => void;
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  werewolfMode?: boolean;
}

const TAB_LABELS: Record<SidebarTab, string> = {
  commander: '指挥官',
  workflow: '工作流',
  agent: '创建Agent',
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now()}`;
}

export default function HomeCommandSidebar({
  engine,
  model,
  onQuickPrompt,
  activeSessionId,
  ensureSessionId,
  activeSession,
  sessionWorkbenchState,
  setSessionWorkbenchState,
  appendSessionMessage,
  updateSessionMessage,
  sidebarHint,
  activeTab,
  availableTabs,
  onTabChange,
  expanded,
  onCollapse,
  onExpand,
  werewolfMode = false,
}: HomeCommandSidebarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraftState>({
    name: '',
    requirements: '',
    description: '',
    referenceWorkflow: '',
    workingDirectory: '',
    workspaceMode: 'in-place',
  });
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [inspectedWorkflow, setInspectedWorkflow] = useState<WorkflowSummary | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<any>(null);
  const [unansweredHumanQuestions, setUnansweredHumanQuestions] = useState<HumanQuestion[]>([]);
  const [submittingHumanQuestionId, setSubmittingHumanQuestionId] = useState<string | null>(null);
  const [currentCreationSession, setCurrentCreationSession] = useState<CreationSessionBinding | null>(activeSession?.creationSession || null);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingWorkflow, setStartingWorkflow] = useState(false);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [draftingAgent, setDraftingAgent] = useState(false);
  const [agentDraftResult, setAgentDraftResult] = useState<AgentDraftResult | null>(null);
  const [agentDraftRaw, setAgentDraftRaw] = useState('');
  const [collaborationTopic, setCollaborationTopic] = useState('');

  const werewolfSectionClass = werewolfMode ? 'werewolf-wood-frame' : '';
  const werewolfCardClass = werewolfMode ? 'werewolf-parchment' : '';
  const werewolfBadgeClass = werewolfMode ? 'werewolf-copper-badge' : '';
  const werewolfGhostButtonClass = werewolfMode ? 'werewolf-ghost-button' : '';
  const werewolfGoldButtonClass = werewolfMode ? 'werewolf-gold-button' : '';
  const [collaborationDraft, setCollaborationDraft] = useState('');
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [selectedCollaborationAgents, setSelectedCollaborationAgents] = useState<Set<string>>(new Set());
  const [collaborationSpeaker, setCollaborationSpeaker] = useState('');
  const [collaborationBusy, setCollaborationBusy] = useState(false);
  const [werewolfBoardId, setWerewolfBoardId] = useState(DEFAULT_WEREWOLF_BOARD_ID);
  const [werewolfViewMode, setWerewolfViewMode] = useState<'god' | 'night'>('night');
  const [werewolfNightViewer, setWerewolfNightViewer] = useState('');
  const [werewolfContextExpanded, setWerewolfContextExpanded] = useState(false);
  const [werewolfRolebookOpen, setWerewolfRolebookOpen] = useState(false);
  const [werewolfAdvancedSettingsOpen, setWerewolfAdvancedSettingsOpen] = useState(false);
  const [werewolfAutoRunning, setWerewolfAutoRunning] = useState(false);
  const [werewolfRehearsing, setWerewolfRehearsing] = useState(false);
  const [werewolfStepDelay, setWerewolfStepDelay] = useState(1200);
  const [selectedSeatId, setSelectedSeatId] = useState('');
  const [werewolfHistoryEntries, setWerewolfHistoryEntries] = useState<WerewolfHistoryEntry[]>([]);
  const [recentlyEliminatedSeatIds, setRecentlyEliminatedSeatIds] = useState<string[]>([]);
  const [phaseTransitionBanner, setPhaseTransitionBanner] = useState<{ key: string; label: string } | null>(null);
  const collaborationPendingMessageIdRef = useRef<string | null>(null);
  const collaborationStreamingMessageIdRef = useRef<string | null>(null);
  const previousAliveSeatIdsRef = useRef<string[]>([]);
  const previousPhaseRef = useRef<string>('');
  const lastStatusSignatureRef = useRef('');
  const lastAppliedSidebarHintRef = useRef<string>('');
  const collaborationAgentSessionsRef = useRef<Record<string, string>>({});
  const werewolfAutoStopRef = useRef(false);
  const werewolfAutoTurnsRef = useRef(0);
  const collaborationTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());

  const binding = activeSession?.workflowBinding;
  const creationBinding = activeSession?.creationSession;
  const boundWorkflow = binding?.configFile || '';
  const boundCommander = binding?.supervisorAgent || 'default-supervisor';
  const effectiveWorkflowTarget = selectedWorkflow || boundWorkflow || '';
  const boundHumanQuestions = useMemo(() => {
    if (!binding) return [];
    return unansweredHumanQuestions.filter((question) => (
      question.configFile === binding.configFile
      && (!binding.runId || question.runId === binding.runId)
    ));
  }, [binding, unansweredHumanQuestions]);
  const otherHumanQuestions = useMemo(() => {
    const boundIds = new Set(boundHumanQuestions.map((question) => question.id));
    return unansweredHumanQuestions.filter((question) => !boundIds.has(question.id));
  }, [boundHumanQuestions, unansweredHumanQuestions]);
  const runCreationSessionId = currentCreationSession?.filename === effectiveWorkflowTarget
    ? currentCreationSession.creationSessionId
    : creationBinding?.filename === effectiveWorkflowTarget
      ? creationBinding.creationSessionId
      : undefined;
  const effectiveCreationSession = currentCreationSession || creationBinding || null;
  const isWorkflowCreationCompleted = Boolean(
    effectiveCreationSession
    && ['config-generated', 'run-bound', 'archived'].includes(effectiveCreationSession.status)
  );
  const resumableCreationSession = effectiveCreationSession && !isWorkflowCreationCompleted
    ? effectiveCreationSession
    : null;
  const workflowDirectory = useMemo(
    () => buildWorkflowConversationDirectory(binding),
    [binding]
  );
  const persistedPreflight = sessionWorkbenchState?.latestPreflight;
  const recentConversation = useMemo(() => {
    return (activeSession?.messages || [])
      .filter((message) => message.role !== 'error')
      .slice(-6)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: (message.rawContent || message.content || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((message) => Boolean(message.content));
  }, [activeSession?.messages]);
  const workflowFocusFacts = useMemo(() => {
    const facts = [
      workflowDraft.name ? `工作流：${workflowDraft.name}` : '',
      workflowDraft.workingDirectory ? `目录：${workflowDraft.workingDirectory}` : '',
      workflowDraft.referenceWorkflow ? `参考：${workflowDraft.referenceWorkflow}` : '',
      workflowDraft.workspaceMode ? `模式：${workflowDraft.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [workflowDraft]);
  const agentFocusFacts = useMemo(() => {
    const facts = [
      agentDraft.displayName ? `角色：${agentDraft.displayName}` : '',
      agentDraft.team ? `队伍：${agentDraft.team}` : '',
      agentDraft.mission ? `职责：${agentDraft.mission}` : '',
      agentDraft.referenceWorkflow ? `参考：${agentDraft.referenceWorkflow}` : '',
      sidebarHint?.agentDraft?.workingDirectory ? `目录：${sidebarHint.agentDraft.workingDirectory}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [agentDraft, sidebarHint?.agentDraft?.workingDirectory]);
  const commanderFocusFacts = useMemo(() => {
    const facts = [
      effectiveWorkflowTarget ? `目标：${effectiveWorkflowTarget}` : '',
      workflowStatus?.currentPhase ? `阶段：${workflowStatus.currentPhase}` : '',
      workflowStatus?.currentStep ? `步骤：${workflowStatus.currentStep}` : '',
      workflowStatus?.status ? `状态：${workflowStatus.status}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [effectiveWorkflowTarget, workflowStatus?.currentPhase, workflowStatus?.currentStep, workflowStatus?.status]);
  const agentDraftPreview = useMemo(() => (
    buildAgentDraftPreview({
      engine,
      model,
      draft: agentDraft,
      existingDraft: agentDraftResult,
    }) as AgentDraftResult | null
  ), [agentDraft, agentDraftResult, engine, model]);
  const collaborationRoom = sessionWorkbenchState?.collaborationRoom || null;
  const collaborationMessages = collaborationRoom?.messages || [];
  const collaborationRounds = collaborationRoom?.rounds || [];
  const werewolfState = collaborationRoom?.werewolf || null;
  const werewolfLabConfig = collaborationRoom?.werewolfLabConfig;
  const isWerewolfLab = Boolean(collaborationRoom?.werewolf?.enabled) || isWerewolfLabTopic(collaborationRoom?.topic);
  const effectiveCollaborationSupervisor = isWerewolfLab ? TEMP_WEREWOLF_SUPERVISOR.name : (boundCommander || 'default-supervisor');
  const selectedWerewolfBoard = getWerewolfLabBoard(werewolfState?.boardId || werewolfBoardId);
  const autoWerewolfPlayers = useMemo(() => {
    const selected = (collaborationRoom?.selectedAgents || [])
      .filter((agent) => agent !== effectiveCollaborationSupervisor && isTemporaryWerewolfAgent(agent));
    return selected.length >= selectedWerewolfBoard.playerCount
      ? selected.slice(0, selectedWerewolfBoard.playerCount)
      : listTemporaryWerewolfAgentNames().slice(0, selectedWerewolfBoard.playerCount);
  }, [
    collaborationRoom?.selectedAgents,
    effectiveCollaborationSupervisor,
    selectedWerewolfBoard.playerCount,
  ]);
  const isWerewolfConfigured = Boolean(werewolfState?.players?.length);
  const werewolfViewCandidateNames = useMemo(() => (
    isWerewolfConfigured
      ? (werewolfState?.players || []).map((player) => player.agentName)
      : autoWerewolfPlayers
  ), [autoWerewolfPlayers, isWerewolfConfigured, werewolfState?.players]);
  const effectiveWerewolfNightViewer = werewolfNightViewer && werewolfViewCandidateNames.includes(werewolfNightViewer)
    ? werewolfNightViewer
    : '';
  const effectiveWerewolfNightViewerRole = werewolfState?.players.find((player) => player.agentName === effectiveWerewolfNightViewer)?.role;
  const plannedWerewolfAgents = useMemo(() => {
    const plannedPlayers = isWerewolfConfigured
      ? (werewolfState?.players || []).map((player) => player.agentName)
      : autoWerewolfPlayers.slice(0, selectedWerewolfBoard.playerCount);
    return Array.from(new Set([effectiveCollaborationSupervisor, ...plannedPlayers]));
  }, [
    autoWerewolfPlayers,
    effectiveCollaborationSupervisor,
    isWerewolfConfigured,
    selectedWerewolfBoard.playerCount,
    werewolfState?.players,
  ]);
  const werewolfDefaultEngine = String(werewolfLabConfig?.defaultEngine || engine || '').trim();
  const werewolfDefaultModel = String(werewolfLabConfig?.defaultModel || model || '').trim();
  const werewolfRehearsalStatus = werewolfLabConfig?.rehearsal || {};
  const latestCollaborationSpeaker = collaborationMessages.length
    ? [...collaborationMessages].reverse().find((message) => message.speakerType !== 'human' && message.speakerType !== 'system')?.speakerName || ''
    : '';
  const visibleWerewolfHighlightedSeatId = useMemo(() => {
    if (!isWerewolfLab) return '';
    if (!werewolfState) return latestCollaborationSpeaker || '';
    if (canSeeWerewolfActionMeta({
      state: werewolfState,
      viewMode: werewolfViewMode,
      viewer: effectiveWerewolfNightViewer,
    })) {
      return werewolfState.currentActor || latestCollaborationSpeaker || '';
    }
    return '';
  }, [
    effectiveWerewolfNightViewer,
    isWerewolfLab,
    latestCollaborationSpeaker,
    werewolfState,
    werewolfViewMode,
  ]);
  const highlightedSeatId = isWerewolfLab
    ? visibleWerewolfHighlightedSeatId
    : (latestCollaborationSpeaker || effectiveCollaborationSupervisor);
  const werewolfHistoryPromptBlock = useMemo(() => {
    if (!werewolfHistoryEntries.length) return '暂无历史对局记忆。';
    return werewolfHistoryEntries
      .slice(0, 6)
      .map((entry) => `- [${entry.boardName} / ${entry.result}] ${entry.summary}${entry.lessons?.length ? `；经验：${entry.lessons.join(' / ')}` : ''}`)
      .join('\n');
  }, [werewolfHistoryEntries]);
  const shouldShowHomeContext = !isWerewolfLab;
  const shouldShowWorkflowRuntimePanels = !isWerewolfLab;
  const werewolfNextActionLabel = !isWerewolfConfigured
    ? '确认角色并开局'
    : werewolfState?.phase === 'setup'
      ? werewolfState?.lastError ? `重试第 ${werewolfState?.dayNumber || 1} 夜` : `Supervisor 推进第 ${werewolfState?.dayNumber || 1} 夜`
    : werewolfState?.phase === 'night'
      ? werewolfState?.lastError ? `重试第 ${werewolfState?.dayNumber || 1} 夜` : `Supervisor 结算第 ${werewolfState?.dayNumber || 1} 夜`
    : werewolfState?.phase === 'last-words'
      ? werewolfState?.pendingHunterShot ? 'Supervisor 处理猎人技能' : 'Supervisor 处理死后遗言'
    : werewolfState?.phase === 'day'
      ? !werewolfState?.sheriffElectionDone ? 'Supervisor 组织警长竞选' : `Supervisor 推进第 ${werewolfState?.dayNumber || 1} 天发言`
    : werewolfState?.phase === 'voting'
      ? 'Supervisor 结算投票'
      : '已结束';
  const werewolfHumanInterventionLabel = !isWerewolfConfigured
    ? '开局确认'
    : werewolfState?.phase === 'setup' || werewolfState?.phase === 'night'
      ? '夜间行动前'
    : werewolfState?.phase === 'last-words'
      ? werewolfState?.pendingHunterShot ? '猎人技能前' : '遗言前'
    : werewolfState?.phase === 'day'
      ? '白天发言前'
    : werewolfState?.phase === 'voting'
      ? '投票结算前'
    : '已结局';
  const availableCollaborationAgents = useMemo(() => {
    if (isWerewolfLab) {
      return [TEMP_WEREWOLF_SUPERVISOR.name, ...listTemporaryWerewolfAgentNames()];
    }
    const supervisor = boundCommander || 'default-supervisor';
    const names = new Set<string>();
    names.add(supervisor);
    workflowDirectory.forEach((entry) => {
      if (entry.label) names.add(entry.label);
    });
    agents.forEach((agent) => {
      if (agent.name) names.add(agent.name);
    });
    return Array.from(names).sort((a, b) => {
      if (a === supervisor) return -1;
      if (b === supervisor) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
  }, [agents, boundCommander, isWerewolfLab, workflowDirectory]);
  const workflowRoundtableAgents = useMemo(() => {
    if (isWerewolfLab) return availableCollaborationAgents;
    const supervisor = boundCommander || 'default-supervisor';
    const names = new Set<string>([supervisor]);
    workflowDirectory.forEach((entry) => {
      if (entry.label) names.add(entry.label);
    });
    return Array.from(names);
  }, [availableCollaborationAgents, boundCommander, isWerewolfLab, workflowDirectory]);
  const selectedCollaborationAgentList = useMemo(() => (
    Array.from(selectedCollaborationAgents).filter((agent) => availableCollaborationAgents.includes(agent))
  ), [availableCollaborationAgents, selectedCollaborationAgents]);
  const mentionCandidateAgents = useMemo(() => {
    if (isWerewolfLab && werewolfState?.players?.length) {
      return werewolfState.players
        .filter((player) => player.alive)
        .map((player) => player.agentName);
    }
    return workflowRoundtableAgents;
  }, [isWerewolfLab, werewolfState?.players, workflowRoundtableAgents]);
  const mentionQuery = getMentionQuery(collaborationDraft);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim().toLowerCase();
    const candidates = ['全员', ...mentionCandidateAgents];
    return candidates
      .filter((name, index) => candidates.indexOf(name) === index)
      .filter((name) => !query || name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [mentionCandidateAgents, mentionQuery]);
  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);
  const collaborationMentionedAgents = useMemo(
    () => extractAgentMentions(collaborationDraft, availableCollaborationAgents),
    [availableCollaborationAgents, collaborationDraft]
  );
  const workflowRoundtableSeats = useMemo<RoundtableSeat[]>(() => (
    workflowRoundtableAgents.map((agentName, index) => {
      const visual = getRoundtableSeatStyle(index);
      const speaking = highlightedSeatId === agentName;
      const active = selectedSeatId ? selectedSeatId === agentName : speaking;
      const isSupervisor = agentName === effectiveCollaborationSupervisor;
      return {
        id: agentName,
        name: agentName,
        seatNumber: index + 1,
        subtitle: isSupervisor ? 'Supervisor' : '工作流 Agent',
        meta: speaking ? '当前发言' : isSupervisor ? '主持' : '待命',
        statusLabel: speaking ? '发言中' : '在线',
        detail: isSupervisor ? '负责主持、归纳和推动下一轮发言。' : '围绕当前议题参与群聊讨论，可被 @ 点名顺序发言。',
        accentClass: visual.card,
        nameClass: visual.name,
        avatarClass: visual.avatar,
        ringClass: speaking ? 'ring-2 ring-primary/60 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]' : '',
        active,
        speaking,
      };
    })
  ), [effectiveCollaborationSupervisor, highlightedSeatId, selectedSeatId, workflowRoundtableAgents]);
  const werewolfRoundtableSeats = useMemo<RoundtableSeat[]>(() => (
    (werewolfState?.players || []).map((player, index) => {
      const visual = getWerewolfSpeakerVisual(player.agentName, werewolfState?.players) || getRoundtableSeatStyle(index);
      const revealRole = shouldRevealWerewolfRoleForViewer({
        player,
        state: werewolfState,
        viewMode: werewolfViewMode,
        viewer: effectiveWerewolfNightViewer,
      });
      const speaking = highlightedSeatId === player.agentName;
      const active = selectedSeatId ? selectedSeatId === player.agentName : speaking;
      return {
        id: player.agentName,
        name: player.agentName,
        seatNumber: index + 1,
        subtitle: player.alive ? '存活' : '出局',
        meta: speaking ? '当前发言' : player.sheriff ? '警长' : player.sheriffCandidate ? '上警' : player.alive ? '待命' : '离场',
        statusLabel: player.alive ? '存活' : '出局',
        detail: player.persona,
        accentClass: player.alive ? visual.card : 'border-border bg-muted/40',
        nameClass: visual.name,
        avatarClass: visual.avatar,
        ringClass: speaking ? 'ring-2 ring-primary/60 shadow-[0_0_0_6px_rgba(59,130,246,0.12)]' : '',
        active,
        speaking,
        dimmed: !player.alive,
        eliminated: !player.alive,
      };
    })
  ), [effectiveWerewolfNightViewer, highlightedSeatId, selectedSeatId, werewolfState, werewolfViewMode]);
  const activeRoundtableSeat = isWerewolfLab
    ? werewolfRoundtableSeats.find((seat) => seat.id === (selectedSeatId || highlightedSeatId)) || werewolfRoundtableSeats[0]
    : workflowRoundtableSeats.find((seat) => seat.id === (selectedSeatId || highlightedSeatId)) || workflowRoundtableSeats[0];

  useEffect(() => {
    if (!isWerewolfLab || !werewolfState?.players?.length) {
      previousAliveSeatIdsRef.current = [];
      return;
    }
    const currentAliveIds = werewolfState.players.filter((player) => player.alive).map((player) => player.agentName);
    const eliminated = previousAliveSeatIdsRef.current.filter((id) => !currentAliveIds.includes(id));
    previousAliveSeatIdsRef.current = currentAliveIds;
    if (!eliminated.length) return;
    setRecentlyEliminatedSeatIds(eliminated);
    const timer = window.setTimeout(() => setRecentlyEliminatedSeatIds([]), 1600);
    return () => window.clearTimeout(timer);
  }, [isWerewolfLab, werewolfState?.players]);

  useEffect(() => {
    if (!isWerewolfLab || !werewolfState?.phase) {
      previousPhaseRef.current = '';
      return;
    }
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = werewolfState.phase;
    if (!previous || previous === werewolfState.phase) return;
    if (!['night', 'day'].includes(previous) && !['night', 'day'].includes(werewolfState.phase)) return;
    const label = werewolfState.phase === 'night' ? '天黑请闭眼' : '天亮了';
    const key = `${werewolfState.phase}-${werewolfState.dayNumber}-${Date.now()}`;
    setPhaseTransitionBanner({ key, label });
    const timer = window.setTimeout(() => {
      setPhaseTransitionBanner((current) => (current?.key === key ? null : current));
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [isWerewolfLab, werewolfState?.dayNumber, werewolfState?.phase]);

  const appendCollaborationMessageToChat = useCallback((message: CollaborationRoomMessage, state?: CollaborationWerewolfState | null) => {
    const sessionId = activeSessionId || ensureSessionId();
    if (!sessionId || !appendSessionMessage) return;
    const chatMessage = isWerewolfLab ? prepareWerewolfMessageForChat(message) : message;
    const role = message.speakerType === 'human' ? 'user' : message.status === 'error' ? 'error' : 'assistant';
    void appendSessionMessage(sessionId, {
      id: `chat-${chatMessage.id}`,
      role,
      content: chatMessage.content,
      rawContent: chatMessage.rawContent || chatMessage.content,
      timestamp: chatMessage.createdAt,
      engine: chatMessage.engine,
      model: chatMessage.model,
      cards: isWerewolfLab
        ? [createWerewolfChatCard(chatMessage, state?.players || werewolfState?.players), ...((chatMessage.cards || []).filter(Boolean))]
        : chatMessage.cards,
    });
  }, [
    activeSessionId,
    appendSessionMessage,
    ensureSessionId,
    isWerewolfLab,
    werewolfState,
  ]);

  const appendCollaborationMessagesToChat = useCallback((messagesToAppend: CollaborationRoomMessage[], state?: CollaborationWerewolfState | null) => {
    messagesToAppend.forEach((message) => appendCollaborationMessageToChat(message, state));
  }, [appendCollaborationMessageToChat]);

  const appendCollaborationPendingMessage = useCallback((content: string, actionLabel?: string) => {
    const sessionId = activeSessionId || ensureSessionId();
    if (!sessionId || !appendSessionMessage) return;
    const pendingId = `collab-pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    collaborationPendingMessageIdRef.current = pendingId;
    void appendSessionMessage(sessionId, {
      id: pendingId,
      role: 'assistant',
      content,
      rawContent: content,
      timestamp: Date.now(),
      cards: isWerewolfLab ? [{
        type: 'werewolf_speech',
        speakerName: effectiveCollaborationSupervisor,
        speakerType: 'supervisor',
        actionLabel: actionLabel || '处理中',
        visibility: 'public',
        colorIndex: 0,
      }] : undefined,
    });
  }, [
    activeSessionId,
    appendSessionMessage,
    effectiveCollaborationSupervisor,
    ensureSessionId,
    isWerewolfLab,
  ]);

  const appendStreamingCollaborationMessage = useCallback((message: CollaborationRoomMessage, state?: CollaborationWerewolfState | null) => {
    const sessionId = activeSessionId || ensureSessionId();
    if (!sessionId || !appendSessionMessage) return;
    collaborationStreamingMessageIdRef.current = `chat-${message.id}`;
    const chatMessage = isWerewolfLab ? prepareWerewolfMessageForChat(message) : message;
    const role = message.speakerType === 'human' ? 'user' : message.status === 'error' ? 'error' : 'assistant';
    void appendSessionMessage(sessionId, {
      id: `chat-${chatMessage.id}`,
      role,
      content: chatMessage.content,
      rawContent: chatMessage.rawContent || chatMessage.content,
      timestamp: chatMessage.createdAt,
      engine: chatMessage.engine,
      model: chatMessage.model,
      cards: isWerewolfLab
        ? [createWerewolfChatCard(chatMessage, state?.players || werewolfState?.players), ...((chatMessage.cards || []).filter(Boolean))]
        : chatMessage.cards,
    });
  }, [
    activeSessionId,
    appendSessionMessage,
    ensureSessionId,
    isWerewolfLab,
    werewolfState?.players,
  ]);

  const updateStreamingCollaborationMessage = useCallback((message: CollaborationRoomMessage, state?: CollaborationWerewolfState | null) => {
    const sessionId = activeSessionId || ensureSessionId();
    const messageId = `chat-${message.id}`;
    if (!sessionId || !updateSessionMessage) return;
    const chatMessage = isWerewolfLab ? prepareWerewolfMessageForChat(message) : message;
    void updateSessionMessage(sessionId, messageId, {
      role: message.status === 'error' ? 'error' : 'assistant',
      content: chatMessage.content,
      rawContent: chatMessage.rawContent || chatMessage.content,
      engine: chatMessage.engine,
      model: chatMessage.model,
      timestamp: chatMessage.createdAt,
      cards: isWerewolfLab
        ? [createWerewolfChatCard(chatMessage, state?.players || werewolfState?.players), ...((chatMessage.cards || []).filter(Boolean))]
        : chatMessage.cards,
    });
  }, [
    activeSessionId,
    ensureSessionId,
    isWerewolfLab,
    updateSessionMessage,
    werewolfState?.players,
  ]);

  useEffect(() => {
    setCurrentCreationSession(creationBinding || null);
  }, [creationBinding]);

  useEffect(() => {
    const selectedAgents = collaborationRoom?.selectedAgents || [];
    setCollaborationTopic((prev) => (prev === (collaborationRoom?.topic || '') ? prev : (collaborationRoom?.topic || '')));
    setCollaborationDraft('');
    setSelectedCollaborationAgents((prev) => (
      areStringSetsEqual(prev, selectedAgents) ? prev : new Set(selectedAgents)
    ));
    setWerewolfBoardId((prev) => {
      const next = collaborationRoom?.werewolf?.boardId || DEFAULT_WEREWOLF_BOARD_ID;
      return prev === next ? prev : next;
    });
    collaborationAgentSessionsRef.current = collaborationRoom?.agentSessions || {};
  }, [activeSessionId]);

  useEffect(() => {
    if (!isWerewolfLab) return;
    const persistedMode = collaborationRoom?.werewolfView?.mode || 'night';
    const persistedViewer = collaborationRoom?.werewolfView?.viewer || '';
    setWerewolfViewMode((prev) => (prev === persistedMode ? prev : persistedMode));
    setWerewolfNightViewer((prev) => (prev === persistedViewer ? prev : persistedViewer));
  }, [
    collaborationRoom?.werewolfView?.mode,
    collaborationRoom?.werewolfView?.viewer,
    isWerewolfLab,
  ]);

  useEffect(() => {
    collaborationAgentSessionsRef.current = collaborationRoom?.agentSessions || {};
  }, [collaborationRoom?.agentSessions]);

  useEffect(() => {
    if (collaborationSpeaker && availableCollaborationAgents.includes(collaborationSpeaker)) return;
    setCollaborationSpeaker(availableCollaborationAgents[0] || '');
  }, [availableCollaborationAgents, collaborationSpeaker]);

  useEffect(() => {
    if (werewolfNightViewer && werewolfViewCandidateNames.includes(werewolfNightViewer)) return;
    if (werewolfNightViewer) setWerewolfNightViewer('');
  }, [werewolfNightViewer, werewolfViewCandidateNames]);

  useEffect(() => {
    if (!sidebarHint) return;
    const signature = JSON.stringify(sidebarHint);
    if (signature === lastAppliedSidebarHintRef.current) return;
    lastAppliedSidebarHintRef.current = signature;

    if (sidebarHint.workflowDraft) {
      setWorkflowDraft((prev) => ({
        name: sidebarHint.workflowDraft?.name ?? prev.name,
        requirements: sidebarHint.workflowDraft?.requirements ?? prev.requirements,
        description: sidebarHint.workflowDraft?.description ?? prev.description,
        referenceWorkflow: sidebarHint.workflowDraft?.referenceWorkflow ?? prev.referenceWorkflow,
        workingDirectory: sidebarHint.workflowDraft?.workingDirectory ?? prev.workingDirectory,
        workspaceMode: sidebarHint.workflowDraft?.workspaceMode ?? prev.workspaceMode,
      }));
    }

    if (sidebarHint.agentDraft) {
      setAgentDraft((prev) => mergeAgentDraft(prev, {
        displayName: sidebarHint.agentDraft?.displayName ?? prev.displayName,
        team: (sidebarHint.agentDraft?.team as AgentDraftState['team'] | undefined) ?? prev.team,
        mission: sidebarHint.agentDraft?.mission ?? prev.mission,
        style: sidebarHint.agentDraft?.style ?? prev.style,
        specialties: sidebarHint.agentDraft?.specialties ?? prev.specialties,
        workingDirectory: sidebarHint.agentDraft?.workingDirectory ?? prev.workingDirectory,
        referenceWorkflow: prev.referenceWorkflow,
      }));
    }
  }, [sidebarHint]);

  const clearModalOpenHint = useCallback(() => {
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: prev?.homeSidebar
        ? { ...prev.homeSidebar, shouldOpenModal: false }
        : prev?.homeSidebar,
    }));
  }, [setSessionWorkbenchState]);

  const closeWorkflowModal = useCallback(() => {
    setWorkflowModalOpen(false);
    clearModalOpenHint();
  }, [clearModalOpenHint]);

  const closeAgentModal = useCallback(() => {
    setAgentModalOpen(false);
    clearModalOpenHint();
  }, [clearModalOpenHint]);

  const modalOpenHandledRef = useRef(false);

  useEffect(() => {
    if (!sidebarHint?.shouldOpenModal) {
      modalOpenHandledRef.current = false;
      return;
    }
    if (modalOpenHandledRef.current) return;
    modalOpenHandledRef.current = true;

    if (activeTab === 'workflow') {
      setWorkflowModalOpen(true);
    } else if (activeTab === 'agent') {
      setAgentModalOpen(true);
    }
    clearModalOpenHint();
  }, [activeTab, sidebarHint?.shouldOpenModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSidebarData = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, agentData] = await Promise.all([
        configApi.listAllConfigs(),
        agentApi.listAgents(),
      ]);

      setWorkflows((configData.configs || []) as WorkflowSummary[]);
      setAgents((agentData.agents || []) as AgentSummary[]);
    } catch (error: any) {
      toast('error', error?.message || '加载指挥官边栏数据失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSidebarData();
  }, [loadSidebarData]);

  useEffect(() => {
    setAgentDraftResult(null);
    setAgentDraftRaw('');
  }, [agentDraft.displayName, agentDraft.team, agentDraft.mission, agentDraft.style, agentDraft.specialties]);

  useEffect(() => {
    if (preflightChecks.length > 0) return;
    if (!persistedPreflight?.checks?.length) return;
    setPreflightChecks(
      persistedPreflight.checks.map((check) => ({
        id: check.id,
        category: check.category,
        status: check.status,
        origin: check.origin,
        summary: check.summary,
        commands: check.command ? [{
          command: check.command,
          exitCode: null,
          status: check.status,
        }] : [],
      }))
    );
  }, [persistedPreflight, preflightChecks.length]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await workflowApi.listHumanQuestions({ status: 'unanswered', limit: 20 });
        if (!cancelled) setUnansweredHumanQuestions(result.questions || []);
      } catch {
        // Inbox is best-effort.
      }
    };

    poll();
    const timer = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const navigateToHumanQuestion = useCallback((question: HumanQuestion) => {
    if (question.workflowFrontendSessionId) {
      router.push(`/?sessionId=${encodeURIComponent(question.workflowFrontendSessionId)}&sidebarTab=commander`);
      return;
    }
    router.push(`/workbench/${encodeURIComponent(question.configFile)}?mode=run&focus=human-question&questionId=${encodeURIComponent(question.id)}&runId=${encodeURIComponent(question.runId)}`);
  }, [router]);

  const answerHumanQuestion = useCallback(async (question: HumanQuestion, answer: HumanQuestionAnswer) => {
    setSubmittingHumanQuestionId(question.id);
    try {
      await workflowApi.answerHumanQuestion({
        questionId: question.id,
        runId: question.runId,
        configFile: question.configFile,
        answer,
      });
      setUnansweredHumanQuestions((items) => items.filter((item) => item.id !== question.id));
      toast('success', '已提交 Supervisor 回复');
    } catch (error: any) {
      toast('error', error?.message || '提交回复失败');
    } finally {
      setSubmittingHumanQuestionId(null);
    }
  }, [toast]);

  useEffect(() => {
    if (!boundWorkflow) {
      setWorkflowStatus(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await workflowApi.getStatus(boundWorkflow);
        if (cancelled) return;
        setWorkflowStatus(status);

        const signature = [
          status?.status || '',
          status?.currentPhase || '',
          status?.currentStep || '',
          status?.currentConfigFile || '',
        ].join('|');

        if (signature && signature !== lastStatusSignatureRef.current) {
          lastStatusSignatureRef.current = signature;

          const matched = status?.currentConfigFile === boundWorkflow;
          const title = matched
            ? `指挥官汇报：${status?.currentPhase || '待命'}`
            : '指挥官待命';
          const content = matched
            ? `当前状态：${status?.status || '未知'}；阶段：${status?.currentPhase || '未进入'}；步骤：${status?.currentStep || '等待中'}。`
            : `已绑定工作流 ${boundWorkflow}，当前尚未启动或正在等待调度。`;
          const tone: ProgressReport['tone'] =
            status?.status === 'failed' ? 'warning' :
              status?.status === 'completed' ? 'success' : 'info';

          setReports((prev) => [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              timestamp: new Date().toISOString(),
              title,
              content,
              tone,
            },
            ...prev,
          ].slice(0, 8));
        }
      } catch {
        // Ignore polling errors here; sidebar is best-effort.
      }
    };

    poll();
    const timer = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [boundWorkflow]);

  const handleStartWorkflow = useCallback(async () => {
    const targetWorkflow = selectedWorkflow || boundWorkflow;
    if (!targetWorkflow) {
      toast('warning', '请先创建或选择一个工作流');
      return;
    }
    try {
      setStartingWorkflow(true);
      const sessionId = activeSessionId || ensureSessionId();
      const preflight = await workflowApi.preflight(targetWorkflow);
      setPreflightChecks(preflight.checks || []);
      setSessionWorkbenchState((prev) => ({
        ...(prev || {}),
        latestPreflight: {
          configFile: targetWorkflow,
          checkedAt: Date.now(),
          ok: preflight.ok,
          failedCount: preflight.failedCount,
          warningCount: preflight.warningCount,
          policy: preflight.policy,
          checks: (preflight.checks || []).slice(0, 8).map((check) => ({
            id: check.id,
            category: check.category,
            status: check.status,
            origin: check.origin,
            summary: check.summary,
            command: check.commands?.[0]?.command || '',
            exitCode: check.commands?.[0]?.exitCode ?? null,
            stdout: check.commands?.[0]?.stdout || '',
            stderr: check.commands?.[0]?.stderr || '',
            errorText: check.commands?.[0]?.errorText || '',
          })),
        },
      }));
      if (!preflight.ok) {
        toast('error', `启动前检查未通过：${preflight.failedCount} 项失败`);
        return;
      }
      if (preflight.warningCount > 0) {
        const confirmed = await confirm({
          title: '启动前检查存在警告',
          description: buildPreflightWarningDescription(preflight.checks || []),
          confirmLabel: '继续启动',
          cancelLabel: '取消',
          variant: 'default',
        });
        if (!confirmed) {
          toast('warning', '已取消启动，可先处理 preflight 警告');
          return;
        }
      }
      await workflowApi.start(targetWorkflow, sessionId || undefined, {
        creationSessionId: runCreationSessionId,
        skipPreflight: true,
        preflightChecks: preflight.checks || [],
      });
      toast('success', `已启动工作流：${targetWorkflow}`);
      router.push(`/workbench/${encodeURIComponent(targetWorkflow)}?mode=run`);
    } catch (error: any) {
      toast('error', error?.message || '启动工作流失败');
    } finally {
      setStartingWorkflow(false);
    }
  }, [activeSessionId, boundWorkflow, ensureSessionId, router, selectedWorkflow, runCreationSessionId, setSessionWorkbenchState, toast]);

  const handleCreateAgent = useCallback(async () => {
    const displayName = agentDraft.displayName.trim();
    const mission = agentDraft.mission.trim();
    if (!displayName || !mission) {
      toast('warning', '请至少填写 Agent 名称和职责');
      return;
    }

    const agent = agentDraftResult || {
      name: slugify(displayName),
      team: agentDraft.team,
      engineModels: engine && model ? { [engine]: model } : {},
      activeEngine: engine || '',
      capabilities: (() => {
        const items = extractAgentDraftCapabilities(agentDraft.specialties);
        return items.length > 0 ? items : [mission];
      })(),
      systemPrompt: buildAgentSystemPrompt(agentDraft),
      category: '首页创建',
      tags: ['AI创建', agentDraft.style].filter(Boolean),
      keywords: agentDraft.specialties
        ? extractAgentDraftCapabilities(agentDraft.specialties)
        : [],
      description: mission,
    };

    try {
      setCreatingAgent(true);
      await agentApi.saveAgent(agent.name, agent);
      toast('success', `已创建 Agent：${agent.name}`);
      setAgentDraft(createInitialAgentDraft());
      setAgentDraftResult(null);
      setAgentDraftRaw('');
      await loadSidebarData();
    } catch (error: any) {
      toast('error', error?.message || '创建 Agent 失败');
    } finally {
      setCreatingAgent(false);
    }
  }, [agentDraft, agentDraftResult, engine, model, loadSidebarData, toast]);

  const handleGenerateAgentDraft = useCallback(async () => {
    const displayName = agentDraft.displayName.trim();
    const mission = agentDraft.mission.trim();
    if (!displayName || !mission) {
      toast('warning', '请至少填写 Agent 名称和职责');
      return;
    }

    try {
      setDraftingAgent(true);
      const result = await agentApi.draftAgent({
        displayName,
        team: agentDraft.team,
        mission,
        style: agentDraft.style,
        specialties: agentDraft.specialties,
        workingDirectory: sidebarHint?.agentDraft?.workingDirectory,
        referenceWorkflow: agentDraft.referenceWorkflow,
        engine,
        model,
      });
      setAgentDraftResult(result.draft as AgentDraftResult);
      setAgentDraftRaw(result.raw || '');
      toast('success', '已生成 Agent 草案');
    } catch (error: any) {
      toast('error', error?.message || '生成 Agent 草案失败');
    } finally {
      setDraftingAgent(false);
    }
  }, [agentDraft, engine, model, toast]);

  const updateCollaborationRoom = useCallback((updater: (room: CollaborationRoomState) => CollaborationRoomState) => {
    setSessionWorkbenchState((prev) => {
      const base = mergeCollaborationRoom(prev?.collaborationRoom, {});
      const nextRoom = updater(base);
      if (nextRoom === base) return prev || { collaborationRoom: base };
      return {
        ...(prev || {}),
        collaborationRoom: {
          ...nextRoom,
          messages: (nextRoom.messages || []).slice(-MAX_COLLAB_MESSAGES),
          rounds: (nextRoom.rounds || []).slice(-12),
        },
      };
    });
  }, [setSessionWorkbenchState]);

  const updateWerewolfLabConfig = useCallback((updater: (current: NonNullable<CollaborationRoomState['werewolfLabConfig']>) => NonNullable<CollaborationRoomState['werewolfLabConfig']>) => {
    updateCollaborationRoom((room) => ({
      ...room,
      werewolfLabConfig: updater({
        defaultEngine: room.werewolfLabConfig?.defaultEngine || engine || '',
        defaultModel: room.werewolfLabConfig?.defaultModel || model || '',
        agentOverrides: room.werewolfLabConfig?.agentOverrides || {},
        rehearsal: room.werewolfLabConfig?.rehearsal || {},
      }),
    }));
  }, [engine, model, updateCollaborationRoom]);

  const persistWerewolfView = useCallback((
    nextMode: 'god' | 'night',
    nextViewer: string
  ) => {
    const normalizedViewer = nextViewer || '';
    const nextViewerRole = werewolfState?.players.find((player) => player.agentName === normalizedViewer)?.role;

    setWerewolfViewMode((prev) => (prev === nextMode ? prev : nextMode));
    setWerewolfNightViewer((prev) => (prev === normalizedViewer ? prev : normalizedViewer));

    if (!isWerewolfLab) return;
    updateCollaborationRoom((room) => {
      const nextView = {
        mode: nextMode,
        viewer: normalizedViewer || undefined,
        viewerRole: nextViewerRole,
      };
      if (
        room.werewolfView?.mode === nextView.mode
        && room.werewolfView?.viewer === nextView.viewer
        && room.werewolfView?.viewerRole === nextView.viewerRole
      ) {
        return room;
      }
      return {
        ...room,
        werewolfView: nextView,
      };
    });
  }, [isWerewolfLab, updateCollaborationRoom, werewolfState?.players]);

  const resolveWerewolfAgentRuntimeConfig = useCallback((agentName: string) => {
    const override = werewolfLabConfig?.agentOverrides?.[agentName];
    const enabled = override?.enabled === true;
    const effectiveEngine = String(enabled ? (override?.engine || werewolfDefaultEngine) : werewolfDefaultEngine).trim();
    const effectiveModel = String(enabled ? (override?.model || werewolfDefaultModel) : werewolfDefaultModel).trim();
    return {
      effectiveEngine,
      effectiveModel,
      overrideEnabled: enabled,
    };
  }, [werewolfDefaultEngine, werewolfDefaultModel, werewolfLabConfig?.agentOverrides]);

  useEffect(() => {
    if (!isWerewolfLab) return;
    const needsInit = !werewolfLabConfig?.defaultEngine || !werewolfLabConfig?.defaultModel;
    if (!needsInit && !plannedWerewolfAgents.some((agentName) => {
      const entry = werewolfRehearsalStatus[agentName];
      return entry && !(agentName in (collaborationRoom?.agentSessions || {}));
    })) {
      return;
    }
    updateWerewolfLabConfig((current) => {
      const nextRehearsal = { ...(current.rehearsal || {}) };
      const roomSessions = collaborationRoom?.agentSessions || {};
      plannedWerewolfAgents.forEach((agentName) => {
        const entry = nextRehearsal[agentName];
        if (entry?.sessionId && !roomSessions[agentName]) {
          roomSessions[agentName] = entry.sessionId;
        }
      });
      return {
        ...current,
        defaultEngine: current.defaultEngine || engine || '',
        defaultModel: current.defaultModel || model || '',
        rehearsal: nextRehearsal,
      };
    });
    if (plannedWerewolfAgents.some((agentName) => {
      const entry = werewolfRehearsalStatus[agentName];
      return entry?.sessionId && !(collaborationRoom?.agentSessions || {})[agentName];
    })) {
      updateCollaborationRoom((room) => ({
        ...room,
        agentSessions: {
          ...(room.agentSessions || {}),
          ...Object.fromEntries(plannedWerewolfAgents
            .map((agentName) => [agentName, werewolfRehearsalStatus[agentName]?.sessionId])
            .filter((entry): entry is [string, string] => Boolean(entry[1]))),
        },
      }));
    }
  }, [
    collaborationRoom?.agentSessions,
    engine,
    isWerewolfLab,
    model,
    plannedWerewolfAgents,
    updateCollaborationRoom,
    updateWerewolfLabConfig,
    werewolfLabConfig?.defaultEngine,
    werewolfLabConfig?.defaultModel,
    werewolfRehearsalStatus,
  ]);

  useEffect(() => {
    if (!isWerewolfLab) return;
    if (selectedCollaborationAgents.size > 0) return;
    const supervisor = TEMP_WEREWOLF_SUPERVISOR.name;
    const defaultPlayers = pickRandomTemporaryWerewolfAgents(selectedWerewolfBoard.playerCount);
    const selectedAgents = [supervisor, ...defaultPlayers];
    setSelectedCollaborationAgents((prev) => (
      areStringSetsEqual(prev, selectedAgents) ? prev : new Set(selectedAgents)
    ));
    updateCollaborationRoom((room) => ({
      ...room,
      selectedAgents,
      werewolf: room.werewolf?.players?.length
        ? room.werewolf
        : {
          enabled: true,
          phase: 'setup',
          dayNumber: 1,
          boardId: selectedWerewolfBoard.id,
          boardName: selectedWerewolfBoard.name,
          players: [],
        eliminated: [],
        votes: [],
        revealedRoles: false,
        lastSummary: '请先选择板子，系统会随机选择参与人格并分配身份。',
        currentAction: 'setup',
      },
    }));
  }, [
    isWerewolfLab,
    selectedCollaborationAgents.size,
    selectedWerewolfBoard.id,
    selectedWerewolfBoard.name,
    selectedWerewolfBoard.playerCount,
    updateCollaborationRoom,
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!isWerewolfLab) return;
    fetchWerewolfHistory(8)
      .then((entries) => {
        if (!cancelled) setWerewolfHistoryEntries(entries);
      })
      .catch(() => {
        if (!cancelled) setWerewolfHistoryEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isWerewolfLab, werewolfState?.phase]);

  const buildCollaborationWorkflowContext = useCallback((agentName: string) => ({
    configFile: boundWorkflow || effectiveWorkflowTarget || '',
    runId: binding?.runId || '',
    workflowName: workflowStatus?.workflowName || boundWorkflow || effectiveWorkflowTarget || '',
    status: workflowStatus?.status || '',
    currentPhase: workflowStatus?.currentPhase || '',
    currentStep: workflowStatus?.currentStep || '',
    supervisorAgent: boundCommander || 'default-supervisor',
    supervisorSessionId: binding?.supervisorSessionId || null,
    selectedStepName: workflowStatus?.currentStep || '',
    latestSupervisorReview: workflowStatus?.latestSupervisorReview || null,
    specCodingSummary: workflowStatus?.specCodingSummary || null,
    specCodingDetails: workflowStatus?.specCodingDetails || null,
    collaborationTopic: collaborationTopic.trim() || collaborationRoom?.topic || '',
    collaborationSpeaker: agentName,
  }), [
    binding?.runId,
    binding?.supervisorSessionId,
    boundCommander,
    boundWorkflow,
    collaborationRoom?.topic,
    collaborationTopic,
    effectiveWorkflowTarget,
    workflowStatus,
  ]);

  const callWerewolfLabAgent = useCallback(async (
    agentName: string,
    message: string,
    roundId?: string,
    messagePatch?: Pick<CollaborationRoomMessage, 'werewolf'>
  ) => {
    const { effectiveEngine, effectiveModel } = resolveWerewolfAgentRuntimeConfig(agentName);
    if (!effectiveEngine || !effectiveModel) {
      throw new Error(`角色 ${agentName} 缺少可用的 engine/model 配置，请先在高级设置或默认配置中补全。`);
    }
    const isHost = agentName === TEMP_WEREWOLF_SUPERVISOR.name;
    const rehearsalEntry = werewolfRehearsalStatus[agentName];
    const existingSession = rehearsalEntry?.status === 'ready'
      && rehearsalEntry.engine === effectiveEngine
      && rehearsalEntry.model === effectiveModel
      ? collaborationAgentSessionsRef.current[agentName]
      : undefined;
    const speakerType: CollaborationRoomMessage['speakerType'] = isHost ? 'supervisor' : 'agent';
    const baseMessage = createCollaborationMessage({
      roundId,
      speakerType,
      speakerName: agentName,
      content: '',
      status: 'pending',
      werewolf: messagePatch?.werewolf,
    });
    updateCollaborationRoom((room) => ({
      ...room,
      messages: [
        ...(room.messages || []),
        baseMessage,
      ],
    }));
    appendStreamingCollaborationMessage(baseMessage, werewolfState);
    const stream = await agentApi.streamChat(agentName, {
      message,
      mode: 'standalone-chat',
      sessionId: existingSession || undefined,
      frontendSessionId: activeSessionId || undefined,
      workingDirectory: workflowDraft.workingDirectory || undefined,
      workflowContext: {
        temporaryLab: 'werewolf',
        frontendSessionId: activeSessionId || undefined,
        collaborationTopic: collaborationTopic.trim() || collaborationRoom?.topic || 'AI 狼人杀能力测试',
        collaborationSpeaker: agentName,
        roundId,
        phase: werewolfState?.phase,
        dayNumber: werewolfState?.dayNumber,
      },
      temporaryRoleConfig: buildTemporaryWerewolfRoleConfig({
        agentName,
        supervisorName: effectiveCollaborationSupervisor,
        state: werewolfState,
        engine: effectiveEngine,
        model: effectiveModel,
      }),
    });
    return await new Promise<string>((resolve, reject) => {
      let content = '';
      stream.events.addEventListener('delta', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        content += String(data?.content || '');
        const displayContent = stripWerewolfResultBlocks(content);
        const nextMessage = {
          ...baseMessage,
          content: displayContent,
          rawContent: content,
          status: 'pending' as const,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          werewolf: room.werewolf ? {
            ...room.werewolf,
            currentActor: agentName,
          } : room.werewolf,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? nextMessage : message),
        }));
        updateStreamingCollaborationMessage(nextMessage, werewolfState ? { ...werewolfState, currentActor: agentName } : werewolfState);
      }) as EventListener);
      stream.events.addEventListener('done', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        if (data?.sessionId) {
          collaborationAgentSessionsRef.current = {
            ...collaborationAgentSessionsRef.current,
            [agentName]: data.sessionId,
          };
        }
        const finalContent = data?.specCodingRevision?.applied
          ? `${data.output || content || data.error || '无输出'}\n\n---\n已刷新 Spec：${data.specCodingRevision.summary}`
          : (data?.output || content || data?.error || '无输出');
        const displayContent = formatWerewolfMessageForDisplay(finalContent).content || stripWerewolfResultBlocks(finalContent) || '无输出';
        const finalMessage = {
          ...baseMessage,
          content: displayContent,
          rawContent: finalContent,
          status: data?.isError ? 'error' as const : 'done' as const,
          error: data?.error || null,
          engine: data?.engine,
          model: data?.model,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          agentSessions: {
            ...(room.agentSessions || {}),
            ...(data?.sessionId ? { [agentName]: data.sessionId } : {}),
          },
          werewolf: room.werewolf ? {
            ...room.werewolf,
            currentActor: agentName,
          } : room.werewolf,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState ? { ...werewolfState, currentActor: agentName } : werewolfState);
        stream.events.close();
        resolve(finalContent);
      }) as EventListener);
      stream.events.addEventListener('failed', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        const errorText = data?.message || 'Agent 对话失败';
        const finalMessage = {
          ...baseMessage,
          content: stripWerewolfResultBlocks(content) || errorText,
          rawContent: content || errorText,
          status: 'error' as const,
          error: errorText,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState);
        stream.events.close();
        reject(new Error(errorText));
      }) as EventListener);
      stream.events.onerror = () => {
        const errorText = 'Agent 流式连接中断';
        const finalMessage = {
          ...baseMessage,
          content: stripWerewolfResultBlocks(content) || errorText,
          rawContent: content || errorText,
          status: 'error' as const,
          error: errorText,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState);
        stream.events.close();
        reject(new Error(errorText));
      };
    });
  }, [
    appendStreamingCollaborationMessage,
    collaborationRoom?.topic,
    collaborationTopic,
    effectiveCollaborationSupervisor,
    resolveWerewolfAgentRuntimeConfig,
    updateCollaborationRoom,
    updateStreamingCollaborationMessage,
    werewolfRehearsalStatus,
    werewolfState,
    workflowDraft.workingDirectory,
  ]);

  const callCollaborationAgent = useCallback(async (
    agentName: string,
    message: string,
    roundId?: string,
    messagePatch?: Pick<CollaborationRoomMessage, 'werewolf'>
  ) => {
    if (isWerewolfLab || isTemporaryWerewolfAgent(agentName) || agentName === TEMP_WEREWOLF_SUPERVISOR.name) {
      return callWerewolfLabAgent(agentName, message, roundId, messagePatch);
    }
    const existingSession = collaborationAgentSessionsRef.current[agentName]
      || (agentName === boundCommander ? binding?.supervisorSessionId || undefined : binding?.attachedAgentSessions?.[agentName]);
    const speakerType: CollaborationRoomMessage['speakerType'] = agentName === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent';
    const baseMessage = createCollaborationMessage({
      roundId,
      speakerType,
      speakerName: agentName,
      content: '',
      status: 'pending',
      werewolf: messagePatch?.werewolf,
    });
    updateCollaborationRoom((room) => ({
      ...room,
      messages: [
        ...(room.messages || []),
        baseMessage,
      ],
    }));
    appendStreamingCollaborationMessage(baseMessage, werewolfState);
    const stream = await agentApi.streamChat(agentName, {
      message,
      mode: 'workflow-chat',
      sessionId: existingSession || undefined,
      frontendSessionId: activeSessionId || undefined,
      workingDirectory: workflowDraft.workingDirectory || undefined,
      workflowContext: buildCollaborationWorkflowContext(agentName),
    });
    return await new Promise<string>((resolve, reject) => {
      let content = '';
      stream.events.addEventListener('delta', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        content += String(data?.content || '');
        const nextMessage = {
          ...baseMessage,
          content,
          status: 'pending' as const,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? nextMessage : message),
        }));
        updateStreamingCollaborationMessage(nextMessage, werewolfState);
      }) as EventListener);
      stream.events.addEventListener('done', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        if (data?.sessionId) {
          collaborationAgentSessionsRef.current = {
            ...collaborationAgentSessionsRef.current,
            [agentName]: data.sessionId,
          };
        }
        const finalContent = data?.specCodingRevision?.applied
          ? `${data.output || content || data.error || '无输出'}\n\n---\n已刷新 Spec：${data.specCodingRevision.summary}`
          : (data?.output || content || data?.error || '无输出');
        const finalMessage = {
          ...baseMessage,
          content: finalContent,
          status: data?.isError ? 'error' as const : 'done' as const,
          error: data?.error || null,
          engine: data?.engine,
          model: data?.model,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          agentSessions: {
            ...(room.agentSessions || {}),
            ...(data?.sessionId ? { [agentName]: data.sessionId } : {}),
          },
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState);
        stream.events.close();
        resolve(finalContent);
      }) as EventListener);
      stream.events.addEventListener('failed', ((event: MessageEvent) => {
        const data = JSON.parse(event.data || '{}');
        const errorText = data?.message || 'Agent 对话失败';
        const finalMessage = {
          ...baseMessage,
          content: content || errorText,
          status: 'error' as const,
          error: errorText,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState);
        stream.events.close();
        reject(new Error(errorText));
      }) as EventListener);
      stream.events.onerror = () => {
        const errorText = 'Agent 流式连接中断';
        const finalMessage = {
          ...baseMessage,
          content: content || errorText,
          status: 'error' as const,
          error: errorText,
        };
        updateCollaborationRoom((room) => ({
          ...room,
          messages: (room.messages || []).map((message) => message.id === baseMessage.id ? finalMessage : message),
        }));
        updateStreamingCollaborationMessage(finalMessage, werewolfState);
        stream.events.close();
        reject(new Error(errorText));
      };
    });
  }, [
    appendStreamingCollaborationMessage,
    binding?.attachedAgentSessions,
    binding?.supervisorSessionId,
    boundCommander,
    buildCollaborationWorkflowContext,
    callWerewolfLabAgent,
    isWerewolfLab,
    updateCollaborationRoom,
    updateStreamingCollaborationMessage,
    werewolfState,
    workflowDraft.workingDirectory,
  ]);

  const handleHostCollaborationMessage = useCallback(() => {
    const text = collaborationDraft.trim();
    if (!text) {
      toast('warning', '请先写下主持人消息');
      return;
    }
    const nextTopic = collaborationTopic.trim() || collaborationRoom?.topic || text.slice(0, 60);
    const hostMessage = createCollaborationMessage({
      speakerType: 'human',
      speakerName: '主持人',
      content: text,
      status: 'done',
    });
    updateCollaborationRoom((room) => ({
      ...room,
      topic: nextTopic,
      selectedAgents: selectedCollaborationAgentList,
      messages: [
        ...(room.messages || []),
        hostMessage,
      ],
    }));
    appendCollaborationMessageToChat(hostMessage);
    setCollaborationDraft('');
  }, [appendCollaborationMessageToChat, collaborationDraft, collaborationRoom?.topic, collaborationTopic, selectedCollaborationAgentList, toast, updateCollaborationRoom]);

  const insertCollaborationMention = useCallback((mention: string) => {
    setCollaborationDraft((current) => {
      const next = insertMention(current, mention);
      requestAnimationFrame(() => {
        const el = collaborationTextareaRef.current;
        if (!el) return;
        const pos = next.length;
        el.focus();
        el.setSelectionRange(pos, pos);
      });
      return next;
    });
  }, []);

  const toggleCollaborationAgent = useCallback((agentName: string, checked: boolean) => {
    const next = new Set(selectedCollaborationAgents);
    if (checked) next.add(agentName);
    else next.delete(agentName);
    const list = Array.from(next);
    setSelectedCollaborationAgents(next);
    updateCollaborationRoom((room) => ({ ...room, selectedAgents: list }));
  }, [selectedCollaborationAgents, updateCollaborationRoom]);

  const handleWerewolfBoardChange = useCallback((boardId: string) => {
    const board = getWerewolfLabBoard(boardId);
    const supervisor = effectiveCollaborationSupervisor;
    const fallbackPlayers = pickRandomTemporaryWerewolfAgents(board.playerCount);
    const selectedAgents = [supervisor, ...fallbackPlayers];
    setWerewolfBoardId(board.id);
    setSelectedCollaborationAgents(new Set(selectedAgents));
    updateCollaborationRoom((room) => ({
      ...room,
      selectedAgents,
      werewolf: {
        enabled: true,
        phase: 'setup',
        dayNumber: 1,
        boardId: board.id,
        boardName: board.name,
        players: [],
        eliminated: [],
        votes: [],
        revealedRoles: false,
        lastSummary: `已选择 ${board.name}，并随机抽取 ${board.playerCount} 个临时人格。`,
        currentAction: 'setup',
      },
    }));
  }, [
    effectiveCollaborationSupervisor,
    updateCollaborationRoom,
  ]);

  const refreshRandomWerewolfPlayers = useCallback(() => {
    const board = selectedWerewolfBoard;
    const supervisor = effectiveCollaborationSupervisor;
    const randomPlayers = pickRandomTemporaryWerewolfAgents(board.playerCount);
    const selectedAgents = [supervisor, ...randomPlayers];
    setSelectedCollaborationAgents(new Set(selectedAgents));
    updateCollaborationRoom((room) => ({
      ...room,
      selectedAgents,
      werewolf: {
        enabled: true,
        phase: 'setup',
        dayNumber: 1,
        boardId: board.id,
        boardName: board.name,
        players: [],
        eliminated: [],
        votes: [],
        revealedRoles: false,
        lastSummary: `已重新随机抽取 ${board.playerCount} 个临时人格。`,
        currentAction: 'setup',
      },
    }));
  }, [
    effectiveCollaborationSupervisor,
    selectedWerewolfBoard,
    updateCollaborationRoom,
  ]);

  const setWerewolfDefaultRuntime = useCallback((patch: { engine?: string; model?: string }) => {
    updateWerewolfLabConfig((current) => ({
      ...current,
      defaultEngine: patch.engine ?? current.defaultEngine ?? '',
      defaultModel: patch.model ?? current.defaultModel ?? '',
    }));
  }, [updateWerewolfLabConfig]);

  const setWerewolfAgentOverrideEnabled = useCallback((agentName: string, enabled: boolean) => {
    updateWerewolfLabConfig((current) => ({
      ...current,
      agentOverrides: {
        ...(current.agentOverrides || {}),
        [agentName]: {
          ...(current.agentOverrides?.[agentName] || {}),
          enabled,
        },
      },
    }));
  }, [updateWerewolfLabConfig]);

  const setWerewolfAgentOverrideRuntime = useCallback((agentName: string, patch: { engine?: string; model?: string }) => {
    updateWerewolfLabConfig((current) => ({
      ...current,
      agentOverrides: {
        ...(current.agentOverrides || {}),
        [agentName]: {
          ...(current.agentOverrides?.[agentName] || {}),
          enabled: current.agentOverrides?.[agentName]?.enabled ?? true,
          engine: patch.engine ?? current.agentOverrides?.[agentName]?.engine ?? '',
          model: patch.model ?? current.agentOverrides?.[agentName]?.model ?? '',
        },
      },
    }));
  }, [updateWerewolfLabConfig]);

  const runWerewolfRehearsal = useCallback(async () => {
    if (!plannedWerewolfAgents.length) {
      toast('warning', '当前没有可演练的角色');
      return;
    }
    setWerewolfRehearsing(true);
    let readyCount = 0;
    let failedCount = 0;
    try {
      for (const agentName of plannedWerewolfAgents) {
        const { effectiveEngine, effectiveModel } = resolveWerewolfAgentRuntimeConfig(agentName);
        if (!effectiveEngine || !effectiveModel) {
          failedCount += 1;
          updateWerewolfLabConfig((current) => ({
            ...current,
            rehearsal: {
              ...(current.rehearsal || {}),
              [agentName]: {
                status: 'failed',
                engine: effectiveEngine,
                model: effectiveModel,
                error: '缺少 engine 或 model 配置',
                checkedAt: Date.now(),
              },
            },
          }));
          continue;
        }

        const existing = werewolfRehearsalStatus[agentName];
        const sameConfig = existing?.status === 'ready'
          && existing?.sessionId
          && existing.engine === effectiveEngine
          && existing.model === effectiveModel;
        if (sameConfig) {
          readyCount += 1;
          if (existing.sessionId && collaborationAgentSessionsRef.current[agentName] !== existing.sessionId) {
            collaborationAgentSessionsRef.current = {
              ...collaborationAgentSessionsRef.current,
              [agentName]: existing.sessionId,
            };
          }
          updateCollaborationRoom((room) => ({
            ...room,
            agentSessions: {
              ...(room.agentSessions || {}),
              ...(existing.sessionId ? { [agentName]: existing.sessionId } : {}),
            },
          }));
          continue;
        }

        updateWerewolfLabConfig((current) => ({
          ...current,
          rehearsal: {
            ...(current.rehearsal || {}),
            [agentName]: {
              status: 'running',
              engine: effectiveEngine,
              model: effectiveModel,
              checkedAt: Date.now(),
            },
          },
        }));

        try {
          const result = await agentApi.chat(agentName, {
            message: agentName === effectiveCollaborationSupervisor
              ? '这是 AI 狼人杀开局前的会话演练。请只回复 READY。'
              : '这是 AI 狼人杀开局前的会话演练。请只回复 READY。',
            mode: 'standalone-chat',
            sessionId: null,
            workingDirectory: workflowDraft.workingDirectory || undefined,
            workflowContext: {
              temporaryLab: 'werewolf',
              rehearsal: true,
              frontendSessionId: activeSessionId || undefined,
              collaborationTopic: collaborationTopic.trim() || collaborationRoom?.topic || 'AI 狼人杀能力测试',
              collaborationSpeaker: agentName,
            },
            temporaryRoleConfig: buildTemporaryWerewolfRoleConfig({
              agentName,
              supervisorName: effectiveCollaborationSupervisor,
              state: werewolfState,
              engine: effectiveEngine,
              model: effectiveModel,
            }),
          });
          if (!result.sessionId) {
            throw new Error('未返回 sessionId');
          }
          readyCount += 1;
          collaborationAgentSessionsRef.current = {
            ...collaborationAgentSessionsRef.current,
            [agentName]: result.sessionId,
          };
          updateCollaborationRoom((room) => ({
            ...room,
            agentSessions: {
              ...(room.agentSessions || {}),
              [agentName]: result.sessionId as string,
            },
          }));
          updateWerewolfLabConfig((current) => ({
            ...current,
            rehearsal: {
              ...(current.rehearsal || {}),
              [agentName]: {
                status: 'ready',
                sessionId: result.sessionId || undefined,
                engine: effectiveEngine,
                model: effectiveModel,
                checkedAt: Date.now(),
              },
            },
          }));
        } catch (error: any) {
          failedCount += 1;
          updateWerewolfLabConfig((current) => ({
            ...current,
            rehearsal: {
              ...(current.rehearsal || {}),
              [agentName]: {
                status: 'failed',
                engine: effectiveEngine,
                model: effectiveModel,
                error: error?.message || '演练失败',
                checkedAt: Date.now(),
              },
            },
          }));
        }
      }

      if (failedCount > 0) {
        toast('warning', `演练完成：${readyCount} 个就绪，${failedCount} 个失败。已成功创建的 session 会保留。`);
      } else {
        toast('success', `演练完成，${readyCount} 个角色均已就绪。`);
      }
    } finally {
      setWerewolfRehearsing(false);
    }
  }, [
    activeSessionId,
    collaborationRoom?.topic,
    collaborationTopic,
    effectiveCollaborationSupervisor,
    plannedWerewolfAgents,
    resolveWerewolfAgentRuntimeConfig,
    toast,
    updateCollaborationRoom,
    updateWerewolfLabConfig,
    werewolfRehearsalStatus,
    werewolfState,
    workflowDraft.workingDirectory,
  ]);

  const buildCollaborationPrompt = useCallback((agentName: string, input: {
    kind: 'single' | 'round' | 'summary';
    topic: string;
    hostMessage?: string;
    roundId?: string;
    transcript?: CollaborationRoomMessage[];
    participants?: string[];
  }) => {
    const context = buildWorkflowPromptContext({
      agentName,
      transcript: input.transcript || collaborationMessages,
      rounds: collaborationRoom?.rounds || [],
      hostMessage: input.hostMessage,
      topic: input.topic,
      participants: input.participants,
    });
    if (input.kind === 'summary') {
      return [
        `你是本次协作室的总结者 ${agentName}。`,
        `议题：${input.topic}`,
        input.participants?.length ? `参与者：${input.participants.join('、')}` : '',
        '请基于下面的多方发言，输出结构化总结：共识、分歧、风险、下一步动作。必要时指出哪些内容应转为 Spec 修订、workflow 编排调整或运行反馈。',
        '',
        '本轮公开讨论记录：',
        context.publicTranscriptBlock,
        '',
        '历史轮次沉淀：',
        context.historyBlock,
      ].filter(Boolean).join('\n\n');
    }
    return [
      `你正在参加一个由人类主持的多 Agent 协作室。你的身份是 ${agentName}。`,
      `议题：${input.topic || '未命名议题'}`,
      input.participants?.length ? `本轮参与者：${input.participants.join('、')}` : '',
      `主持人本轮指令：${context.hostDirectiveBlock}`,
      '请只代表你自己的角色职责发言，给出高密度观点。不要替其他 Agent 总结，不要输出工具调用说明。',
      '建议包含：你的判断、依据、风险、需要其他角色补充的问题、可执行建议。',
      '',
      '公开协作记录：',
      context.publicTranscriptBlock,
      '',
      '你的个人连续记录：',
      context.privateTranscriptBlock,
      '',
      '历史轮次沉淀：',
      context.historyBlock,
    ].filter(Boolean).join('\n\n');
  }, [collaborationMessages, collaborationRoom?.rounds]);

  const buildWerewolfPrompt = useCallback((agentName: string, input: {
    kind: 'speech' | 'vote' | 'host-summary' | 'sheriff-speech' | 'wolf-vote' | 'sheriff-vote';
    state: CollaborationWerewolfState;
    hostMessage?: string;
    transcript?: CollaborationRoomMessage[];
  }) => {
    const player = input.state.players.find((item) => item.agentName === agentName);
    const temporaryAgent = getTemporaryWerewolfAgent(agentName);
    const alivePlayers = getAliveWerewolfPlayers(input.state).map((item) => item.agentName);
    const wolfPartners = player?.role === 'werewolf'
      ? input.state.players.filter((item) => item.role === 'werewolf' && item.agentName !== agentName).map((item) => item.agentName)
      : [];
    const transcriptBuckets = splitWerewolfTranscriptForPrompt({
      messages: input.transcript || collaborationMessages,
      state: input.state,
      viewer: agentName,
      allowGodView: agentName === effectiveCollaborationSupervisor || input.kind === 'host-summary',
      limit: 16,
    });
    const memoryBuckets = splitWerewolfMemoriesForPrompt({
      memories: input.state.memories || [],
      state: input.state,
      viewer: agentName,
      allowGodView: agentName === effectiveCollaborationSupervisor || input.kind === 'host-summary',
      limit: 12,
    });
    const publicTranscriptBlock = formatPromptBlock(transcriptBuckets.publicLines, '暂无公开记录。');
    const teamTranscriptBlock = formatPromptBlock(transcriptBuckets.teamLines, '暂无阵营记录。');
    const privateTranscriptBlock = formatPromptBlock(transcriptBuckets.privateLines, '暂无个人私密记录。');
    const publicMemoryBlock = formatPromptBlock(memoryBuckets.publicLines, '暂无公开共享记忆。');
    const teamMemoryBlock = formatPromptBlock(memoryBuckets.teamLines, '暂无阵营共享记忆。');
    const privateMemoryBlock = formatPromptBlock(memoryBuckets.privateLines, '暂无个人私密记忆。');
    const roster = formatWerewolfRoster(input.state, agentName === effectiveCollaborationSupervisor || input.kind === 'host-summary');
    const personaRoster = formatWerewolfPersonaRoster(input.state);
    if (input.kind === 'host-summary') {
      return [
        `你是主持人 ${agentName}，正在主持一个多 Agent 回合制身份推理测试。`,
        `当前阶段：${input.state.phase}，第 ${input.state.dayNumber} 天。`,
        '请基于最近发言输出主持总结：当前局势、主要矛盾、票型观察、归票建议、下一步主持建议。',
        '语气保持主持人口吻，可少量使用贴合场景的 emoji 增强临场感，但不要过密。',
        '如果这是白天发言收口，请明确指出谁的发言最像归票位、谁在带节奏、谁像冲锋/倒钩位，以及建议把票压到哪几名玩家身上。',
        '如果这是警长竞选收口，请明确总结上警玩家、退水情况、谁更像真预言家或悍跳位、警长票流关注点，并提醒进入警长投票。',
        '不要代替玩家投票。不要泄露隐藏身份，除非消息中已公开或玩家已出局且规则要求公开。',
        '桌上的人格特征是公开信息，你可以用它判断谁更像适合悍跳、归票、冲锋、倒钩、拿警徽或藏身份的人。',
        '',
        '公开人格席位表：',
        personaRoster,
        '',
        '本局公开记忆：',
        publicMemoryBlock,
        '',
        '本局阵营记忆：',
        teamMemoryBlock,
        '',
        '本局私密记忆：',
        privateMemoryBlock,
        '',
        '历史对局记忆：',
        werewolfHistoryPromptBlock,
        '',
        '玩家列表：',
        roster,
        '',
        '最近公开记录：',
        publicTranscriptBlock,
        '',
        '最近阵营记录：',
        teamTranscriptBlock,
        '',
        '最近私密记录：',
        privateTranscriptBlock,
      ].join('\n\n');
    }
    if (input.kind === 'vote' || input.kind === 'wolf-vote' || input.kind === 'sheriff-vote') {
      const sheriffCandidates = (input.state.sheriffCandidates || []).filter((name) => alivePlayers.includes(name));
      return [
        `你正在参加一个多 Agent 回合制身份推理测试。你的玩家名是 ${agentName}。`,
        player ? `你的隐藏身份：${formatWerewolfRole(player.role)}。你的角色性格提示：${player.persona} 请像这个人一样自然发言，不要复述提示词。` : '',
        temporaryAgent ? `你的说话手感：${temporaryAgent.speechStyle} ${temporaryAgent.rhythm}` : '',
        temporaryAgent ? `你常见的开口方式：${temporaryAgent.opening}` : '',
        temporaryAgent ? `你常见的收口方式：${temporaryAgent.closing}` : '',
        player ? `你的角色规则：${WEREWOLF_ROLE_PROMPTS[player.role]}` : '',
        wolfPartners.length ? `你的狼队友：${wolfPartners.join('、')}。只有狼人内部会议和狼人视角可见这类信息。` : '',
        `当前阶段：${input.kind === 'wolf-vote' ? '狼人夜间刀口投票' : input.kind === 'sheriff-vote' ? '警长投票' : `投票，第 ${input.state.dayNumber} 天` }。`,
        input.kind === 'wolf-vote'
          ? `可投票刀口：${alivePlayers.join('、') || '无'}`
          : input.kind === 'sheriff-vote'
            ? `警上候选人：${sheriffCandidates.join('、') || '无'}`
          : (input.state.sheriff ? `当前警长：${input.state.sheriff}${input.state.badgeDestroyed ? '（警徽已撕）' : '（持有警徽）'}` : '当前没有警长。'),
        input.kind === 'wolf-vote'
          ? '请只从存活玩家里选择今夜刀口；允许自刀，但要明确考虑收益与风险。'
          : input.kind === 'sheriff-vote'
            ? `请只从警上候选人中投票：${sheriffCandidates.join('、') || '无'}。`
          : `可投票对象：${alivePlayers.filter((name) => name !== agentName).join('、') || '无'}`,
        input.hostMessage ? `主持人补充：${input.hostMessage}` : '',
        input.kind === 'wolf-vote'
          ? '请结合白天站边、神职嫌疑、悍跳安排和次日口风需要，给出今夜刀口。'
          : input.kind === 'sheriff-vote'
            ? '请结合上警发言、退水情况、谁更适合拿警徽和带警徽流，投出你的警长票。警长投票阶段每位存活玩家只有 1 票。'
          : '请注意票型：警长票按 1.5 票结算，普通票按 1 票结算；你的理由要尽量结合警长票、归票、站边和白天发言矛盾。',
        '桌上所有玩家的人格特征都是公开可观察信息，可以把它们作为判断谁像带节奏位、归票位、悍跳位的辅助依据。',
        '',
        '公开人格席位表：',
        personaRoster,
        '',
        '本局公开记忆：',
        publicMemoryBlock,
        '',
        wolfPartners.length ? '本局狼队共享记忆：' : '本局阵营共享记忆：',
        teamMemoryBlock,
        '',
        '你的个人私密记忆：',
        privateMemoryBlock,
        '',
        '历史对局记忆：',
        werewolfHistoryPromptBlock,
        '',
        '回复末尾必须包含 <result>...</result>，其中直接放一个 JSON 对象。',
        input.kind === 'wolf-vote'
          ? 'JSON 示例：{"action":"wolf-vote","target":"玩家名","reason":"一句话理由"}'
          : input.kind === 'sheriff-vote'
            ? 'JSON 示例：{"action":"sheriff-vote","target":"玩家名","reason":"一句话理由"}'
            : 'JSON 示例：{"action":"day-vote","target":"玩家名","reason":"一句话理由"}',
        '如果确实不投，target 写 null。',
        '',
        '最近公开记录：',
        publicTranscriptBlock,
        '',
        wolfPartners.length ? '最近狼队共享记录：' : '最近阵营共享记录：',
        teamTranscriptBlock,
        '',
        '最近个人私密记录：',
        privateTranscriptBlock,
      ].filter(Boolean).join('\n\n');
    }
    return [
      `你正在参加一个多 Agent 回合制身份推理测试。你的玩家名是 ${agentName}。`,
      player ? `你的隐藏身份：${formatWerewolfRole(player.role)}。你的角色性格提示：${player.persona} 请像这个人一样自然发言，不要复述提示词。` : '',
      temporaryAgent ? `你的说话手感：${temporaryAgent.speechStyle} ${temporaryAgent.rhythm}` : '',
      temporaryAgent ? `你常见的开口方式：${temporaryAgent.opening}` : '',
      temporaryAgent ? `你常见的收口方式：${temporaryAgent.closing}` : '',
      player ? `你的角色规则：${WEREWOLF_ROLE_PROMPTS[player.role]}` : '',
      wolfPartners.length ? `你的狼队友：${wolfPartners.join('、')}。不要在公开发言里直接暴露狼队关系。` : '',
      `当前阶段：${input.state.phase}，第 ${input.state.dayNumber} 天。`,
      input.kind === 'sheriff-speech' ? '当前环节：警长竞选发言。你可以说明为什么自己适合拿警徽，也可以选择退水。请顺手点评上警格局、站边与警长票可能流向。' : '',
      input.state.sheriff ? `当前警长：${input.state.sheriff}${input.state.badgeDestroyed ? '（警徽已撕）' : '（持有警徽）'}` : '当前没有警长。',
      `存活玩家：${alivePlayers.join('、')}`,
      `发言顺序：${getWerewolfSpeechOrder(input.state).join(' -> ') || '未定'}`,
      input.hostMessage ? `主持人本轮指令：${input.hostMessage}` : '',
      input.state.currentAction === 'guard-action'
        ? '你现在要做守卫夜间决策。回复末尾必须包含 <result>...</result>，其中直接放一个 JSON 对象，例如 {"action":"guard-action","target":"某玩家名","reason":"一句话"}。如果选择空守，target 写 null。'
        : '',
      input.state.currentAction === 'witch-action'
        ? '你现在要做女巫夜间决策。回复末尾必须包含 <result>...</result>，其中直接放一个 JSON 对象，例如 {"action":"witch-action","save":true,"poisonTarget":null,"reason":"一句话"}。save 表示是否使用解药；poisonTarget 为毒药目标名，不用毒则写 null。'
        : '',
      input.state.currentAction === 'seer-check'
        ? '你现在要做预言家夜间查验决策。回复末尾必须包含 <result>...</result>，其中直接放一个 JSON 对象，例如 {"action":"seer-check","target":"某玩家名","reason":"一句话"}。'
        : '',
      input.state.currentAction === 'hunter-shot'
        ? '你现在要做猎人开枪决策。回复末尾必须包含 <result>...</result>，其中直接放一个 JSON 对象，例如 {"action":"hunter-shot","target":"某玩家名","reason":"一句话"}。不开枪时 target 写 null。'
        : '',
      '',
      '桌上所有玩家的人格特征都是公开信息，你可以合理判断谁更像适合起跳、归票、冲锋、倒钩、藏身份或带节奏的人。',
      '',
      '公开人格席位表：',
      personaRoster,
      '',
      '本局公开记忆：',
      publicMemoryBlock,
      '',
      wolfPartners.length ? '本局狼队共享记忆：' : '本局阵营共享记忆：',
      teamMemoryBlock,
      '',
      '你的个人私密记忆：',
      privateMemoryBlock,
      '',
      '历史对局记忆：',
      werewolfHistoryPromptBlock,
      '',
      '发言要求：',
      '- 只代表自己发言，可以质疑、辩护、提问或回应 @你的内容。',
      '- 发言要像一个具体参与者在桌上说话，不要输出“persona/style/bias/提示词”等元信息。',
      '- 风格差异要体现在语气、节奏、开口方式和追问方式里，但整体仍然要像真人桌聊，不要演得太满。',
      '- 不要直接暴露自己的隐藏身份，除非这是你的策略。',
      '- 如果你是狼人，可以伪装、保护队友、必要时考虑自爆；如果你是神职，要考虑信息释放节奏；如果你是村民，要根据发言找矛盾。',
      '- 如果当前是狼人夜间内部会议，第一位狼人必须先明确今晚安排：谁更适合悍跳、谁负责冲锋/倒钩、刀口优先级是什么。后续狼人围绕这个安排补充或调整。',
      '- 如果当前主持人要求你在 <result> 中输出 JSON 决策，必须照做；<result> 外可以保留自然语言思考，但最终结算只认 <result> 里的 JSON。',
      '- 每名玩家在同一轮白天讨论里最多发言两轮；若你已进入第二轮，请收口，不要继续展开新分支。',
      '- 如果你是本轮最后一个发言位，请主动做归票，总结 1 到 2 个优先出局位，并说明票型理由。',
      '- 结尾可以点名你最想追问的一个 Agent，格式如 @agentName；如果不需要继续追问，可以不 @。',
      '',
      '玩家列表：',
      roster,
      '',
      '最近公开记录：',
      publicTranscriptBlock,
      '',
      wolfPartners.length ? '最近狼队共享记录：' : '最近阵营共享记录：',
      teamTranscriptBlock,
      '',
      '最近个人私密记录：',
      privateTranscriptBlock,
    ].filter(Boolean).join('\n\n');
  }, [collaborationMessages, effectiveCollaborationSupervisor, werewolfHistoryPromptBlock]);

  const handleWorkflowGroupChat = useCallback(async () => {
    const hostMessage = collaborationDraft.trim();
    if (!hostMessage) {
      toast('warning', '请先写下主持人消息，并用 @agent 或 @全员 指定下一位发言者');
      return;
    }
    const mentionScope = workflowRoundtableAgents.length ? workflowRoundtableAgents : availableCollaborationAgents;
    const initialTargets = extractNextRoundMentions(hostMessage, mentionScope);
    const topic = collaborationTopic.trim() || collaborationRoom?.topic || hostMessage || '工作流协作群聊';
    const roundId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const participants = Array.from(new Set(initialTargets));
    const hostCollaborationMessage = createCollaborationMessage({
      roundId,
      speakerType: 'human',
      speakerName: '主持人',
      content: hostMessage,
      status: 'done',
    });
    const systemMessage = createCollaborationMessage({
      roundId,
      speakerType: 'system',
      speakerName: '系统',
      content: participants.length
        ? `群聊开始：${participants.join('、')}。后续只由被 @ 到的 Agent 按顺序接话。`
        : '主持人未 @ 任何 Agent，本轮群聊到此结束。',
      status: 'done',
    });

    updateCollaborationRoom((room) => ({
      ...room,
      topic,
      selectedAgents: mentionScope,
      mode: 'roundtable',
      rounds: [
        ...(room.rounds || []),
        {
          id: roundId,
          topic,
          participants,
          status: participants.length ? 'running' : 'completed',
          startedAt: Date.now(),
          ...(!participants.length ? { completedAt: Date.now(), summary: '主持人未 @ 任何 Agent，本轮结束。' } : {}),
        },
      ],
      messages: [
        ...(room.messages || []),
        hostCollaborationMessage,
        systemMessage,
      ],
    }));
    appendCollaborationMessagesToChat([hostCollaborationMessage, systemMessage]);
    setCollaborationDraft('');

    if (participants.length === 0) {
      toast('info', '没有 @ 到 Agent，本轮已结束');
      return;
    }

    try {
      setCollaborationBusy(true);
      const roundTranscript: CollaborationRoomMessage[] = [
        ...collaborationMessages,
        createCollaborationMessage({
          roundId,
          speakerType: 'human',
          speakerName: '主持人',
          content: hostMessage,
          status: 'done',
        }),
      ];
      const spokenCounts = new Map<string, number>();
      const queue = [...participants];
      const allParticipants = new Set(participants);
      let turns = 0;
      const maxTurns = Math.max(6, mentionScope.length * 2);
      while (queue.length > 0 && turns < maxTurns) {
        const agentName = queue.shift();
        if (!agentName) continue;
        const nextCount = (spokenCounts.get(agentName) || 0) + 1;
        if (nextCount > 2) continue;
        spokenCounts.set(agentName, nextCount);
        turns += 1;
        const output = await callCollaborationAgent(agentName, buildCollaborationPrompt(agentName, {
          kind: 'round',
          topic,
          hostMessage,
          roundId,
          transcript: roundTranscript,
          participants: Array.from(allParticipants),
        }), roundId);
        roundTranscript.push(createCollaborationMessage({
          roundId,
          speakerType: agentName === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent',
          speakerName: agentName,
          content: output,
          status: 'done',
        }));
        const nextMentions = extractNextRoundMentions(output, mentionScope, agentName)
          .filter((name) => (spokenCounts.get(name) || 0) < 2);
        nextMentions.forEach((name) => {
          allParticipants.add(name);
          if (!queue.includes(name)) queue.push(name);
        });
      }

      const finalParticipants = Array.from(allParticipants);
      const summarizer = finalParticipants.includes(boundCommander || 'default-supervisor')
        ? (boundCommander || 'default-supervisor')
        : finalParticipants[0];
      const summary = await callCollaborationAgent(summarizer, buildCollaborationPrompt(summarizer, {
        kind: 'summary',
        topic,
        roundId,
        transcript: roundTranscript,
        participants: finalParticipants,
      }), roundId);
      const roundVoteCards = buildRoundVoteChartCard({
        title: '本轮群聊票型',
        subtitle: '根据本轮 VOTE 结构化投票自动汇总',
        votes: extractRoundVotes(roundTranscript, finalParticipants),
      });
      const summaryMessage = createCollaborationMessage({
        roundId,
        speakerType: summarizer === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent',
        speakerName: summarizer,
        content: summary,
        cards: roundVoteCards,
        status: 'done',
      });
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          summaryMessage,
        ],
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, participants: finalParticipants, status: 'completed', completedAt: Date.now(), summary }
          : round),
      }));
      appendCollaborationMessageToChat(summaryMessage);
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, status: 'failed', completedAt: Date.now(), summary: error?.message || '执行失败' }
          : round),
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `群聊中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
      }));
      toast('error', error?.message || '群聊失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    appendCollaborationMessagesToChat,
    availableCollaborationAgents,
    boundCommander,
    buildCollaborationPrompt,
    callCollaborationAgent,
    collaborationDraft,
    collaborationMessages,
    collaborationRoom?.topic,
    collaborationTopic,
    toast,
    updateCollaborationRoom,
    workflowRoundtableAgents,
  ]);

  const handleInviteCollaborationSpeaker = useCallback(async () => {
    const mentionScope = selectedCollaborationAgentList.length
      ? selectedCollaborationAgentList
      : availableCollaborationAgents;
    const targetAgents = extractNextRoundMentions(collaborationDraft, mentionScope);
    if (targetAgents.length === 0) {
      toast('warning', '请在主持人消息里使用 @agent 或 @全员');
      return;
    }
    const hostMessage = collaborationDraft.trim();
    const topic = collaborationTopic.trim() || collaborationRoom?.topic || hostMessage || '临时协作议题';
    if (hostMessage) {
      const hostCollaborationMessage = createCollaborationMessage({
        speakerType: 'human',
        speakerName: '主持人',
        content: hostMessage,
        status: 'done',
      });
      updateCollaborationRoom((room) => ({
        ...room,
        topic,
        selectedAgents: selectedCollaborationAgentList,
        messages: [
          ...(room.messages || []),
          hostCollaborationMessage,
        ],
      }));
      appendCollaborationMessageToChat(hostCollaborationMessage);
      setCollaborationDraft('');
    }
    try {
      setCollaborationBusy(true);
      const runningTranscript = [...collaborationMessages];
      for (const agentName of targetAgents) {
        const output = await callCollaborationAgent(agentName, buildCollaborationPrompt(agentName, {
          kind: 'single',
          topic,
          hostMessage,
          transcript: runningTranscript,
          participants: mentionScope,
        }));
        runningTranscript.push(createCollaborationMessage({
          speakerType: agentName === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent',
          speakerName: agentName,
          content: output,
          status: 'done',
        }));
      }
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            speakerType: 'system',
            speakerName: '系统',
            content: `点名发言失败：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
      }));
      toast('error', error?.message || 'Agent 发言失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    buildCollaborationPrompt,
    callCollaborationAgent,
    appendCollaborationMessageToChat,
    collaborationDraft,
    collaborationMessages,
    collaborationRoom?.topic,
    collaborationTopic,
    availableCollaborationAgents,
    boundCommander,
    selectedCollaborationAgentList,
    toast,
    updateCollaborationRoom,
  ]);

  const handleStartCollaborationRound = useCallback(async () => {
    const hostMessage = collaborationDraft.trim();
    if (!hostMessage) {
      toast('warning', '请先写下主持人消息，并用 @agent 或 @全员 指定下一位发言者');
      return;
    }
    const mentionScope = selectedCollaborationAgentList.length
      ? selectedCollaborationAgentList
      : availableCollaborationAgents;
    const initialTargets = extractNextRoundMentions(hostMessage, mentionScope);
    const topic = collaborationTopic.trim() || collaborationRoom?.topic || hostMessage || '协作室圆桌';
    const roundId = `round-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const participants = Array.from(new Set(initialTargets));
    const roundHostMessage = createCollaborationMessage({
      roundId,
      speakerType: 'human' as const,
      speakerName: '主持人',
      content: hostMessage,
      status: 'done' as const,
    });
    const roundSystemMessage = createCollaborationMessage({
      roundId,
      speakerType: 'system',
      speakerName: '系统',
      content: participants.length
        ? `圆桌开始：${participants.join('、')}。后续只由被 @ 到的 Agent 接话。`
        : '主持人未 @ 任何 Agent，本轮圆桌到此结束。',
      status: 'done',
    });

    updateCollaborationRoom((room) => ({
      ...room,
      topic,
      selectedAgents: mentionScope,
      mode: 'roundtable',
      rounds: [
        ...(room.rounds || []),
        {
          id: roundId,
          topic,
          participants,
          status: participants.length ? 'running' : 'completed',
          startedAt: Date.now(),
          ...(!participants.length ? { completedAt: Date.now(), summary: '主持人未 @ 任何 Agent，本轮结束。' } : {}),
        },
      ],
      messages: [
        ...(room.messages || []),
        roundHostMessage,
        roundSystemMessage,
      ],
    }));
    appendCollaborationMessagesToChat([roundHostMessage, roundSystemMessage]);
    setCollaborationDraft('');

    if (participants.length === 0) {
      toast('info', '没有 @ 到 Agent，本轮已结束');
      return;
    }

    try {
      setCollaborationBusy(true);
      const roundTranscript: CollaborationRoomMessage[] = [
        ...collaborationMessages,
        createCollaborationMessage({
          roundId,
          speakerType: 'human',
          speakerName: '主持人',
          content: hostMessage,
          status: 'done',
        }),
      ];
      const spokenCounts = new Map<string, number>();
      const queue = [...participants];
      const allParticipants = new Set(participants);
      let turns = 0;
      const maxTurns = Math.max(6, mentionScope.length * 2);
      while (queue.length > 0 && turns < maxTurns) {
        const agentName = queue.shift();
        if (!agentName) continue;
        const nextCount = (spokenCounts.get(agentName) || 0) + 1;
        if (nextCount > 2) continue;
        spokenCounts.set(agentName, nextCount);
        turns += 1;
        const output = await callCollaborationAgent(agentName, buildCollaborationPrompt(agentName, {
          kind: 'round',
          topic,
          hostMessage,
          roundId,
          transcript: roundTranscript,
          participants: Array.from(allParticipants),
        }), roundId);
        roundTranscript.push(createCollaborationMessage({
          roundId,
          speakerType: agentName === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent',
          speakerName: agentName,
          content: output,
          status: 'done',
        }));
        const nextMentions = extractNextRoundMentions(output, mentionScope, agentName)
          .filter((name) => (spokenCounts.get(name) || 0) < 2);
        nextMentions.forEach((name) => {
          allParticipants.add(name);
          if (!queue.includes(name)) queue.push(name);
        });
      }

      const finalParticipants = Array.from(allParticipants);
      const summarizer = finalParticipants.includes(boundCommander || 'default-supervisor')
        ? (boundCommander || 'default-supervisor')
        : finalParticipants[0];
      const summary = await callCollaborationAgent(summarizer, buildCollaborationPrompt(summarizer, {
        kind: 'summary',
        topic,
        roundId,
        transcript: roundTranscript,
        participants: finalParticipants,
      }), roundId);
      const roundVoteCards = buildRoundVoteChartCard({
        title: '本轮圆桌票型',
        subtitle: '根据本轮 VOTE 结构化投票自动汇总',
        votes: extractRoundVotes(roundTranscript, finalParticipants),
      });
      const summaryMessage = createCollaborationMessage({
        roundId,
        speakerType: summarizer === (boundCommander || 'default-supervisor') ? 'supervisor' : 'agent',
        speakerName: summarizer,
        content: summary,
        cards: roundVoteCards,
        status: 'done',
      });
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          summaryMessage,
        ],
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, participants: finalParticipants, status: 'completed', completedAt: Date.now(), summary }
          : round),
      }));
      appendCollaborationMessageToChat(summaryMessage);
      toast('success', '圆桌讨论已完成');
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, status: 'failed', completedAt: Date.now(), summary: error?.message || '执行失败' }
          : round),
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `圆桌中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
      }));
      toast('error', error?.message || '圆桌讨论失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    availableCollaborationAgents,
    appendCollaborationMessagesToChat,
    boundCommander,
    buildCollaborationPrompt,
    callCollaborationAgent,
    collaborationDraft,
    collaborationMessages,
    collaborationRoom?.topic,
    collaborationTopic,
    selectedCollaborationAgentList,
    toast,
    updateCollaborationRoom,
  ]);

  const handleSetupWerewolf = useCallback(() => {
    const supervisor = effectiveCollaborationSupervisor;
    const board = selectedWerewolfBoard;
    const participants = isWerewolfLab
      ? autoWerewolfPlayers
      : (selectedCollaborationAgentList.length
      ? selectedCollaborationAgentList
      : availableCollaborationAgents.slice(0, 6)
    ).filter((agent) => agent !== supervisor).slice(0, board.playerCount);
    if (participants.length < board.playerCount) {
      toast('warning', `当前板子需要 ${board.playerCount} 个玩家`);
      return;
    }
    const nextState = createWerewolfState([supervisor, ...participants], supervisor, board.id);
    const setupMessage = createCollaborationMessage({
      speakerType: 'supervisor',
      speakerName: supervisor,
      content: [
        'AI 上帝发言 🎲：本局已完成配置。',
        `板子：${board.name}（${board.description}）`,
        `胜利规则：${board.winRuleLabel}`,
        `主持人：${supervisor}`,
        '玩家：',
        formatWerewolfRoster(nextState, false),
        '',
        'AI 上帝发言 🎙️：请确认开局。后续会按上警、黑夜、遗言、白天发言、放逐投票的顺序推进；女巫首夜可以自救。',
      ].join('\n'),
      status: 'done',
      werewolf: {
        phase: 'setup',
        action: 'setup',
        visibility: 'public',
        actor: supervisor,
      },
    });
    updateCollaborationRoom((room) => ({
      ...room,
      topic: collaborationTopic.trim() || 'AI 狼人杀能力测试',
      selectedAgents: [supervisor, ...participants],
      mode: 'roundtable',
      werewolf: nextState,
      messages: [
        ...(room.messages || []),
        setupMessage,
      ],
    }));
    appendCollaborationMessageToChat(setupMessage, nextState);
    setSelectedCollaborationAgents(new Set([supervisor, ...participants]));
    setCollaborationTopic('AI 狼人杀能力测试');
    setWerewolfViewMode('night');
  }, [
    availableCollaborationAgents,
    autoWerewolfPlayers,
    collaborationTopic,
    effectiveCollaborationSupervisor,
    isWerewolfLab,
    selectedCollaborationAgentList,
    selectedWerewolfBoard,
    toast,
    appendCollaborationMessageToChat,
    updateCollaborationRoom,
  ]);

  const handleWerewolfSheriffElection = useCallback(async () => {
    if (!werewolfState?.players?.length) return;
    const alivePlayers = getAliveWerewolfPlayers(werewolfState).filter((player) => !player.idiotRevealed);
    const candidates = alivePlayers
      .filter((player) => ['seer', 'werewolf', 'villager', 'hunter'].includes(player.role))
      .slice(0, Math.min(4, alivePlayers.length));
    const roundId = `ww-sheriff-${werewolfState.dayNumber}-${Date.now()}`;
    const hostMessage = collaborationDraft.trim() || '警长竞选：先上警举手，再按顺序做上警发言。每名上警玩家只发言一轮，最后一名上警玩家负责归票，提醒场上如何投警长票。';
    const openingMessage = createCollaborationMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: effectiveCollaborationSupervisor,
      content: `AI 上帝发言 🎙️：现在开始警长竞选。\n${hostMessage}`,
      status: 'done',
      werewolf: { phase: 'day', action: 'sheriff-election', visibility: 'public', actor: effectiveCollaborationSupervisor },
    });
    const handsMessage = createCollaborationMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: effectiveCollaborationSupervisor,
      content: candidates.length
        ? `AI 上帝发言 📣：上警举手结束。${candidates.map((player) => player.agentName).join('、')} 选择上警，共 ${candidates.length} 人上警。`
        : 'AI 上帝发言 📣：本轮无人上警。',
      status: 'done',
      werewolf: { phase: 'day', action: 'sheriff-election', visibility: 'public', actor: effectiveCollaborationSupervisor },
    });
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: {
        ...(room.werewolf || werewolfState),
        phase: 'day',
        currentAction: 'sheriff-election',
        currentActor: effectiveCollaborationSupervisor,
        sheriffCandidates: candidates.map((player) => player.agentName),
      },
      messages: [
        ...(room.messages || []),
        openingMessage,
        handsMessage,
      ],
    }));
    appendCollaborationMessagesToChat([openingMessage, handsMessage], werewolfState);
    setCollaborationDraft('');

    try {
      setCollaborationBusy(true);
      appendCollaborationPendingMessage(
        `AI 上帝正在组织第 ${werewolfState.dayNumber} 天警长竞选，请稍候。`,
        '警长竞选',
      );
      const transcript: CollaborationRoomMessage[] = [...collaborationMessages, openingMessage, handsMessage];
      const withdrawnCandidates = new Set<string>();
      for (const candidate of candidates) {
        const output = await callCollaborationAgent(candidate.agentName, buildWerewolfPrompt(candidate.agentName, {
          kind: 'sheriff-speech',
          state: {
            ...werewolfState,
            phase: 'day',
            sheriffCandidates: candidates.map((player) => player.agentName),
          },
          hostMessage,
          transcript,
        }), roundId, {
          werewolf: { phase: 'day', action: 'sheriff-speech', visibility: 'public', actor: candidate.agentName },
        });
        const speechMessage = createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: candidate.agentName,
          content: output,
          status: 'done',
          werewolf: { phase: 'day', action: 'sheriff-speech', visibility: 'public', actor: candidate.agentName },
        });
        transcript.push(speechMessage);
        if (parseWerewolfSheriffWithdrawal(output)) withdrawnCandidates.add(candidate.agentName);
      }
      const finalCandidates = candidates.filter((candidate) => !withdrawnCandidates.has(candidate.agentName));
      const withdrawalMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: [
          `AI 上帝发言 📋：上警发言结束。`,
          `退水情况：${withdrawnCandidates.size ? Array.from(withdrawnCandidates).join('、') : '无人退水'}。`,
          `留在警上的玩家：${finalCandidates.length ? finalCandidates.map((player) => player.agentName).join('、') : '无人留警上'}。`,
        ].join('\n'),
        status: 'done',
        werewolf: { phase: 'day', action: 'sheriff-speech', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
      transcript.push(withdrawalMessage);
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          withdrawalMessage,
        ],
      }));
      appendCollaborationMessageToChat(withdrawalMessage, werewolfState);

      const sheriffVotes: CollaborationWerewolfVote[] = [];
      let sheriff: CollaborationWerewolfPlayer | undefined;
      let voteSummaryText = '无人进入警长投票。';
      if (finalCandidates.length > 0) {
        const voteStartMessage = createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: `AI 上帝发言 🗳️：现在开始警长投票。留警上的玩家有 ${finalCandidates.map((player) => player.agentName).join('、')}。请所有存活玩家依次投票。`,
          status: 'done',
          werewolf: { phase: 'day', action: 'sheriff-vote', visibility: 'public', actor: effectiveCollaborationSupervisor },
        });
        transcript.push(voteStartMessage);
        updateCollaborationRoom((room) => ({
          ...room,
          messages: [
            ...(room.messages || []),
            voteStartMessage,
          ],
        }));
        appendCollaborationMessageToChat(voteStartMessage, werewolfState);

        for (const voter of alivePlayers) {
          const output = await callCollaborationAgent(voter.agentName, buildWerewolfPrompt(voter.agentName, {
            kind: 'sheriff-vote',
            state: {
              ...werewolfState,
              phase: 'day',
              currentAction: 'sheriff-vote',
              sheriffCandidates: finalCandidates.map((player) => player.agentName),
            },
            hostMessage: `当前进行警长投票，仅能从 ${finalCandidates.map((player) => player.agentName).join('、')} 中投一人。`,
            transcript,
          }), roundId, {
            werewolf: { phase: 'day', action: 'sheriff-vote', visibility: 'public', actor: voter.agentName },
          });
          const structuredVote = extractWerewolfStructuredResult(output, isWerewolfVoteResult);
          const parsedVote = structuredVote?.target
            ? {
              target: structuredVote.target,
              reason: structuredVote.reason || '',
            }
            : parseVoteTarget(output, finalCandidates.map((player) => player.agentName));
          if (parsedVote) {
            sheriffVotes.push({
              voter: voter.agentName,
              target: parsedVote.target,
              reason: parsedVote.reason,
              round: werewolfState.dayNumber,
            });
          }
          transcript.push(createCollaborationMessage({
            roundId,
            speakerType: 'agent',
            speakerName: voter.agentName,
            content: output,
            status: 'done',
            werewolf: { phase: 'day', action: 'sheriff-vote', visibility: 'public', actor: voter.agentName },
          }));
        }
        const tally = new Map<string, number>();
        sheriffVotes.forEach((vote) => tally.set(vote.target, (tally.get(vote.target) || 0) + 1));
        const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        const topScore = sorted[0]?.[1] ?? 0;
        const topCandidates = sorted.filter(([, score]) => score === topScore).map(([name]) => name);
        sheriff = topCandidates.length === 1
          ? finalCandidates.find((candidate) => candidate.agentName === topCandidates[0])
          : undefined;
        voteSummaryText = [
          `警长票型：${buildWerewolfVoteLines(sheriffVotes).join('；') || '暂无有效警长票'}`,
          `得票统计：${buildWerewolfTallySummary(sheriffVotes)}`,
          topCandidates.length > 1
            ? `AI 上帝发言 ⚖️：${topCandidates.join('、')} 平票，暂未产生警长。`
            : sheriff
              ? `AI 上帝发言 👑：${sheriff.agentName} 获得警徽。`
              : 'AI 上帝发言 👑：本轮没有产生警长。',
        ].join('\n');
      }
      const nextState: CollaborationWerewolfState = {
        ...werewolfState,
        phase: 'day',
        sheriff: sheriff?.agentName,
        sheriffCandidates: finalCandidates.map((player) => player.agentName),
        sheriffElectionDone: true,
        players: werewolfState.players.map((player) => ({
          ...player,
          sheriffCandidate: finalCandidates.some((candidate) => candidate.agentName === player.agentName),
          sheriff: player.agentName === sheriff?.agentName,
        })),
        currentAction: 'day-speech',
        currentActor: effectiveCollaborationSupervisor,
        breakpoint: undefined,
        lastSummary: sheriff
          ? [
            `警长投票完成：${sheriff.agentName} 获得警徽。`,
            voteSummaryText,
            '请注意后续票型里警长票按 1.5 票结算，白天发言顺序将围绕警长位置推进。',
          ].join('\n')
          : [
            finalCandidates.length
              ? '警长投票结束，但本轮未产生警长。'
              : '警长竞选结束，无人留在警上，本局无警徽。',
            voteSummaryText,
          ].join('\n'),
        memories: [
          ...(werewolfState.memories || []),
          createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'day',
            action: 'sheriff-vote',
            title: '警长竞选结果',
            summary: [
              `上警名单：${candidates.map((player) => player.agentName).join('、') || '无'}。`,
              `退水名单：${withdrawnCandidates.size ? Array.from(withdrawnCandidates).join('、') : '无人退水'}。`,
              `留警上：${finalCandidates.map((player) => player.agentName).join('、') || '无人留警上'}。`,
              sheriff
                ? `${sheriff.agentName} 获得警徽。`
                : '本轮未产生警长。',
              sheriffVotes.length ? `警长票型：${buildWerewolfVoteLines(sheriffVotes).join('；')}` : '',
            ].filter(Boolean).join(' '),
            visibility: 'public',
            actor: effectiveCollaborationSupervisor,
          }),
        ],
      };
      const resultMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: nextState.lastSummary || '警长竞选结束。',
        cards: buildWerewolfTallyChartCard({
          title: '警长投票统计',
          subtitle: sheriff ? `${sheriff.agentName} 获得警徽` : '本轮未产生警长',
          votes: sheriffVotes,
        }),
        status: 'done',
        werewolf: { phase: 'day', action: 'sheriff-vote', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: nextState,
        messages: [
          ...(room.messages || []),
          resultMessage,
        ],
      }));
      appendCollaborationMessageToChat(resultMessage, nextState);
      toast('success', '警长竞选完成');
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `警长竞选中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
      }));
      toast('error', error?.message || '警长竞选失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    buildWerewolfPrompt,
    callCollaborationAgent,
    appendCollaborationMessageToChat,
    appendCollaborationMessagesToChat,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    werewolfState,
  ]);

  const handleWerewolfSpeechRound = useCallback(async () => {
    if (!werewolfState?.players?.length) {
      toast('warning', '请先初始化测试局');
      return;
    }
    const alivePlayers = getWerewolfSpeechOrder(werewolfState)
      .map((name) => werewolfState.players.find((player) => player.agentName === name))
      .filter((player): player is CollaborationWerewolfPlayer => Boolean(player));
    if (alivePlayers.length < 2) {
      toast('warning', '存活玩家不足，无法继续发言');
      return;
    }
    const roundId = `ww-day-${werewolfState.dayNumber}-${Date.now()}`;
    const hostMessage = collaborationDraft.trim() || `第 ${werewolfState.dayNumber} 天白天发言，请按顺序发言：${alivePlayers.map((player) => player.agentName).join(' -> ')}。每名玩家最多发言两轮；若点名继续追问，也只能在两轮内完成。最后一名发言位不要 @ 新人，必须负责归票，给出 1 到 2 个优先出局位和票型理由。`;
    const explosion = resolveWerewolfExplosion(werewolfState, hostMessage);
    if (explosion.exploded) {
      const explosionMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: explosion.content || '狼人自爆，进入下一夜。',
        status: 'done',
        werewolf: { phase: 'day', action: 'settlement', visibility: 'public', actor: explosion.exploded },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: explosion.state,
        messages: [
          ...(room.messages || []),
          explosionMessage,
        ],
      }));
      appendCollaborationMessageToChat(explosionMessage, explosion.state);
      setCollaborationDraft('');
      toast('success', '狼人自爆，白天中止');
      return;
    }
    const hostCollaborationMessage = createCollaborationMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: effectiveCollaborationSupervisor,
      content: [
        `AI 上帝发言 ☀️：现在进入第 ${werewolfState.dayNumber} 天白天发言。`,
        `发言顺序：${alivePlayers.map((player) => player.agentName).join(' -> ')}。`,
        hostMessage,
      ].join('\n'),
      status: 'done',
      werewolf: {
        phase: 'day',
        action: 'day-speech',
        visibility: 'public',
        actor: effectiveCollaborationSupervisor,
      },
    });
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: { ...(room.werewolf || werewolfState), phase: 'day', currentAction: 'day-speech', currentActor: effectiveCollaborationSupervisor },
      rounds: [
        ...(room.rounds || []),
        {
          id: roundId,
          topic: `AI 狼人杀 D${werewolfState.dayNumber} 发言`,
          participants: alivePlayers.map((player) => player.agentName),
          status: 'running',
          startedAt: Date.now(),
        },
      ],
      messages: [
        ...(room.messages || []),
        hostCollaborationMessage,
      ],
    }));
    appendCollaborationMessageToChat(hostCollaborationMessage, werewolfState);
    setCollaborationDraft('');

    try {
      setCollaborationBusy(true);
      appendCollaborationPendingMessage(
        `AI 上帝正在组织第 ${werewolfState.dayNumber} 天白天发言，请稍候。`,
        '白天发言',
      );
      const transcript: CollaborationRoomMessage[] = [
        ...collaborationMessages,
        hostCollaborationMessage,
      ];
      for (const player of alivePlayers) {
        const output = await callCollaborationAgent(player.agentName, buildWerewolfPrompt(player.agentName, {
          kind: 'speech',
          state: { ...werewolfState, phase: 'day' },
          hostMessage,
          transcript,
        }), roundId, {
          werewolf: {
            phase: 'day',
            action: 'day-speech',
            visibility: 'public',
            actor: player.agentName,
          },
        });
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: player.agentName,
          content: output,
          status: 'done',
          werewolf: {
            phase: 'day',
            action: 'day-speech',
            visibility: 'public',
            actor: player.agentName,
          },
        }));
      }
      const summary = await callCollaborationAgent(effectiveCollaborationSupervisor, buildWerewolfPrompt(effectiveCollaborationSupervisor, {
        kind: 'host-summary',
        state: { ...werewolfState, phase: 'day' },
        transcript,
      }), roundId, {
        werewolf: { phase: 'day', action: 'settlement', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
      const summaryMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: summary,
        status: 'done',
        werewolf: { phase: 'day', action: 'settlement', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? {
          ...room.werewolf,
          phase: 'voting',
          currentAction: 'vote',
          currentActor: effectiveCollaborationSupervisor,
          lastSummary: summary,
          breakpoint: undefined,
          memories: [
            ...(room.werewolf.memories || []),
            createWerewolfMemoryEntry({
              round: werewolfState.dayNumber,
              phase: 'day',
              action: 'day-speech',
              title: `第 ${werewolfState.dayNumber} 天白天总结`,
              summary,
              visibility: 'public',
              actor: effectiveCollaborationSupervisor,
            }),
          ],
        } : room.werewolf,
        messages: [
          ...(room.messages || []),
          summaryMessage,
        ],
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, status: 'completed', completedAt: Date.now(), summary }
          : round),
      }));
      appendCollaborationMessageToChat(summaryMessage, {
        ...werewolfState,
        phase: 'voting',
        currentAction: 'vote',
        currentActor: effectiveCollaborationSupervisor,
        lastSummary: summary,
      });
      toast('success', '白天发言轮完成，进入投票阶段');
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        rounds: (room.rounds || []).map((round) => round.id === roundId
          ? { ...round, status: 'failed', completedAt: Date.now(), summary: error?.message || '执行失败' }
          : round),
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `发言轮中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
      }));
      toast('error', error?.message || '发言轮失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    buildWerewolfPrompt,
    callCollaborationAgent,
    appendCollaborationMessageToChat,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    werewolfState,
  ]);

  const handleWerewolfNightRound = useCallback(async () => {
    if (!werewolfState?.players?.length) {
      toast('warning', '请先初始化测试局');
      return;
    }
    const alivePlayers = getAliveWerewolfPlayers(werewolfState);
    const wolves = alivePlayers.filter((player) => player.role === 'werewolf');
    const seer = alivePlayers.find((player) => player.role === 'seer');
    const witch = alivePlayers.find((player) => player.role === 'witch');
    const guard = alivePlayers.find((player) => player.role === 'guard');
    const roleState = getWerewolfRoleState(werewolfState);
    const roundId = `ww-night-${werewolfState.dayNumber}-${Date.now()}`;
    const hostMessage = collaborationDraft.trim() || `第 ${werewolfState.dayNumber} 夜行动：狼人先进行内部会议，先商量第二天怎么演、怎么站边、刀口怎么服务白天格局，需要时再决定谁悍跳或带节奏；随后守卫守护，狼人落刀，女巫决定是否用药，预言家查验。女巫首夜可以自救。`;
    const wolfCandidates = alivePlayers;
    let wolfTarget: CollaborationWerewolfPlayer | undefined;
    let guarded: string | undefined;
    let saved: string | undefined;
    let poisoned: string | undefined;
    let seerTarget: CollaborationWerewolfPlayer | undefined;
    let deaths: string[] = [];
    let nextState: CollaborationWerewolfState = werewolfState;
    let badgeResult: ReturnType<typeof resolveWerewolfBadgeAfterDeaths> = { state: werewolfState };
    const openingMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: hostMessage,
        status: 'done',
        werewolf: { phase: 'night', action: 'system', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
    const nightMessages: CollaborationRoomMessage[] = [openingMessage];
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: { ...(room.werewolf || werewolfState), phase: 'night', currentAction: 'wolf-meeting', currentActor: effectiveCollaborationSupervisor, lastError: undefined },
      messages: [...(room.messages || []), openingMessage],
    }));
    appendCollaborationMessageToChat(openingMessage, werewolfState);
    setCollaborationDraft('');

    try {
      setCollaborationBusy(true);
      appendCollaborationPendingMessage(
        `AI 上帝正在推进第 ${werewolfState.dayNumber} 夜，请稍候。`,
        '黑夜处理中',
      );
      const transcript: CollaborationRoomMessage[] = [...collaborationMessages, openingMessage];
      const pushNightStageMessage = (message: CollaborationRoomMessage) => {
        transcript.push(message);
        nightMessages.push(message);
        updateCollaborationRoom((room) => ({
          ...room,
          messages: [
            ...(room.messages || []),
            message,
          ],
        }));
        appendCollaborationMessageToChat(message, werewolfState);
      };
      pushNightStageMessage(createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: 'AI 上帝发言 🌙：天黑请闭眼。',
        status: 'done',
        werewolf: { phase: 'night', action: 'system', visibility: 'public', actor: effectiveCollaborationSupervisor },
      }));
      if (wolves.length) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🐺：狼队请睁眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-meeting', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolves[0]?.agentName },
        }));
      }
      for (const [wolfIndex, wolf] of wolves.entries()) {
        const output = await callCollaborationAgent(wolf.agentName, buildWerewolfPrompt(wolf.agentName, {
          kind: 'speech',
          state: { ...werewolfState, phase: 'night', currentAction: 'wolf-meeting', currentActor: wolf.agentName },
          hostMessage: wolfIndex === 0
            ? '狼人内部会议：你是第一位发言的狼人，请先给出今夜安排，包括谁更适合悍跳、谁负责冲锋/倒钩、刀口优先级和白天口风方向。'
            : '狼人内部会议：请基于前面狼队发言，补充或修正悍跳安排、冲锋/倒钩分工、刀口优先级和白天口风方向。',
          transcript,
        }), roundId, {
          werewolf: { phase: 'night', action: 'wolf-meeting', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolf.agentName },
        });
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: wolf.agentName,
          content: output,
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-meeting', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolf.agentName },
        }));
      }
      const wolfVotes: CollaborationWerewolfVote[] = [];
      for (const wolf of wolves) {
        const voteOutput = await callCollaborationAgent(wolf.agentName, buildWerewolfPrompt(wolf.agentName, {
          kind: 'wolf-vote',
          state: { ...werewolfState, phase: 'night', currentAction: 'wolf-kill', currentActor: wolf.agentName },
          hostMessage: `请在以下可选刀口中投票：${wolfCandidates.map((player) => player.agentName).join('、')}。`,
          transcript,
        }), roundId, {
          werewolf: { phase: 'night', action: 'wolf-kill', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolf.agentName },
        });
        const structuredVote = extractWerewolfStructuredResult(voteOutput, isWerewolfVoteResult);
        const parsedVote = structuredVote?.target
          ? {
            target: structuredVote.target,
            reason: structuredVote.reason || '',
          }
          : parseVoteTarget(voteOutput, wolfCandidates.map((player) => player.agentName));
        if (parsedVote) {
          wolfVotes.push({
            voter: wolf.agentName,
            target: parsedVote.target,
            reason: parsedVote.reason,
            round: werewolfState.dayNumber,
          });
        }
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: wolf.agentName,
          content: voteOutput,
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-kill', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolf.agentName },
        }));
      }
      if (wolves.length) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🌙：狼队请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-kill', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolves[0]?.agentName },
        }));
      }
      if (wolfVotes.length > 0) {
        const tally = new Map<string, number>();
        wolfVotes.forEach((vote) => tally.set(vote.target, (tally.get(vote.target) || 0) + 1));
        const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
        const votedTarget = sorted[0]?.[0];
        const votedPlayer = wolfCandidates.find((player) => player.agentName === votedTarget);
        if (votedPlayer) wolfTarget = votedPlayer;
        const wolfVoteSummary = createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: `狼队内部投票结果：${buildWerewolfVoteLines(wolfVotes).join('；')}。\n最终刀口：${wolfTarget?.agentName || '未确定'}。`,
          cards: buildWerewolfTallyChartCard({
            title: '狼队刀口票型',
            subtitle: '仅狼队可见',
            votes: wolfVotes,
            visibility: 'werewolves',
            audience: wolves.map((player) => player.agentName),
          }),
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-kill', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolves[0]?.agentName },
        });
        transcript.push(wolfVoteSummary);
        nightMessages.push(wolfVoteSummary);
        updateCollaborationRoom((room) => ({
          ...room,
          messages: [
            ...(room.messages || []),
            wolfVoteSummary,
          ],
        }));
        appendCollaborationMessageToChat(wolfVoteSummary, werewolfState);
      }
      if (!wolfTarget) {
        wolfTarget = pickWerewolfTarget(alivePlayers) || undefined;
      }
      if (guard) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🛡️：守卫请睁眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'guard-action', visibility: 'private', audience: [guard.agentName], actor: guard.agentName },
        }));
        const output = await callCollaborationAgent(guard.agentName, buildWerewolfPrompt(guard.agentName, {
          kind: 'speech',
          state: { ...werewolfState, phase: 'night', currentAction: 'guard-action', currentActor: guard.agentName },
          hostMessage: `守卫行动：请从存活玩家中选择一名守护对象。上一夜目标：${roleState.guardLastTarget || '无'}。`,
          transcript,
        }), roundId, {
          werewolf: { phase: 'night', action: 'guard-action', visibility: 'private', audience: [guard.agentName], actor: guard.agentName },
        });
        const guardResult = extractWerewolfStructuredResult(output, isWerewolfGuardResult);
        if (guardResult?.target) {
          const selected = alivePlayers.find((player) => player.agentName === guardResult.target && player.agentName !== guard.agentName);
          if (selected) guarded = selected.agentName;
        }
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: guard.agentName,
          content: output,
          status: 'done',
          werewolf: { phase: 'night', action: 'guard-action', visibility: 'private', audience: [guard.agentName], actor: guard.agentName },
        }));
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🌙：守卫请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'guard-action', visibility: 'private', audience: [guard.agentName], actor: guard.agentName },
        }));
      }
      if (witch && wolfTarget) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🧪：女巫请睁眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'witch-action', visibility: 'private', audience: [witch.agentName], actor: witch.agentName },
        }));
        const output = await callCollaborationAgent(witch.agentName, buildWerewolfPrompt(witch.agentName, {
          kind: 'speech',
          state: { ...werewolfState, phase: 'night', currentAction: 'witch-action', currentActor: witch.agentName },
          hostMessage: [
            `${wolfTarget.agentName} 今夜被袭击。女巫首夜可以自救。`,
            roleState.witchAntidoteUsed ? '你的解药已经用过。' : '你的解药仍可使用。',
            roleState.witchPoisonUsed ? '你的毒药已经用过。' : '你的毒药仍可使用。',
          ].join('\n'),
          transcript,
        }), roundId, {
          werewolf: { phase: 'night', action: 'witch-action', visibility: 'private', audience: [witch.agentName], actor: witch.agentName },
        });
        const witchResult = extractWerewolfStructuredResult(output, isWerewolfWitchResult);
        if (witchResult?.save && !roleState.witchAntidoteUsed) saved = wolfTarget.agentName;
        if (witchResult?.poisonTarget && !roleState.witchPoisonUsed) {
          const selected = alivePlayers.find((player) => player.agentName === witchResult.poisonTarget && player.agentName !== witch.agentName);
          if (selected) poisoned = selected.agentName;
        }
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: witch.agentName,
          content: output,
          status: 'done',
          werewolf: { phase: 'night', action: 'witch-action', visibility: 'private', audience: [witch.agentName], actor: witch.agentName },
        }));
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🌙：女巫请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'witch-action', visibility: 'private', audience: [witch.agentName], actor: witch.agentName },
        }));
      }
      if (seer) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🔮：预言家请睁眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
        }));
        const output = await callCollaborationAgent(seer.agentName, buildWerewolfPrompt(seer.agentName, {
          kind: 'speech',
          state: { ...werewolfState, phase: 'night', currentAction: 'seer-check', currentActor: seer.agentName },
          hostMessage: '预言家查验：请从存活玩家中选择一名查验对象，并说明理由。',
          transcript,
        }), roundId, {
          werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
        });
        const seerResult = extractWerewolfStructuredResult(output, isWerewolfSeerResult);
        if (seerResult?.target) {
          const selected = alivePlayers.find((player) => player.agentName === seerResult.target && player.agentName !== seer.agentName);
          if (selected) seerTarget = selected;
        }
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: seer.agentName,
          content: output,
          status: 'done',
          werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
        }));
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: 'AI 上帝发言 🌙：预言家请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
        }));
      }
      deaths = [
        wolfTarget && wolfTarget.agentName !== guarded && wolfTarget.agentName !== saved ? wolfTarget.agentName : '',
        poisoned || '',
      ].filter(Boolean);
      const baseNightState: CollaborationWerewolfState = {
        ...werewolfState,
        roleState: {
          ...roleState,
          guardLastTarget: guarded || roleState.guardLastTarget,
          witchAntidoteUsed: roleState.witchAntidoteUsed || Boolean(saved),
          witchPoisonUsed: roleState.witchPoisonUsed || Boolean(poisoned),
        },
        lastError: undefined,
        night: {
          round: werewolfState.dayNumber,
          guarded,
          wolfTarget: wolfTarget?.agentName,
          saved,
          poisoned,
          seerTarget: seerTarget?.agentName,
          deaths,
        },
      };
      const afterDeaths = applyWerewolfDeaths(baseNightState, deaths);
      const pendingHunter = deaths.find((name) => getWerewolfPlayer(afterDeaths, name)?.role === 'hunter' && !afterDeaths.roleState?.hunterShotUsed);
      badgeResult = resolveWerewolfBadgeAfterDeaths(afterDeaths, deaths);
      nextState = {
        ...badgeResult.state,
        phase: deaths.length ? 'last-words' : 'day',
        lastNightVictim: deaths[0] || undefined,
        pendingLastWords: deaths,
        pendingHunterShot: pendingHunter,
        currentAction: pendingHunter ? 'hunter-shot' : deaths.length ? 'last-words' : 'day-speech',
        currentActor: pendingHunter || deaths[0] || effectiveCollaborationSupervisor,
        lastSummary: deaths.length
          ? `天亮了 ☀️，昨夜 ${deaths.join('、')} 出局${pendingHunter ? `；${pendingHunter} 可选择是否发动猎人技能` : '，进入遗言'}。`
          : '天亮了 ☀️，昨夜平安夜，进入白天发言。',
        memories: [
          ...(werewolfState.memories || []),
          ...(wolves.length && wolfTarget ? [createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'night',
            action: 'wolf-meeting',
            title: `第 ${werewolfState.dayNumber} 夜狼队会议`,
            summary: `狼队内部围绕刀口与次日站边进行了沟通，最终刀口定为 ${wolfTarget.agentName}。`,
            visibility: 'werewolves',
            audience: wolves.map((player) => player.agentName),
            actor: wolves[0]?.agentName,
          })] : []),
          ...(guarded && guard ? [createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'night',
            action: 'guard-action',
            title: `第 ${werewolfState.dayNumber} 夜守卫行动`,
            summary: `守卫选择守护 ${guarded}。`,
            visibility: 'private',
            audience: [guard.agentName],
            actor: guard.agentName,
          })] : []),
          ...(witch && wolfTarget ? [createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'night',
            action: 'witch-action',
            title: `第 ${werewolfState.dayNumber} 夜女巫行动`,
            summary: [
              `${wolfTarget.agentName} 今夜被刀。`,
              saved ? `解药救下 ${saved}。` : '未使用解药。',
              poisoned ? `毒药指向 ${poisoned}。` : '未使用毒药。',
            ].join(' '),
            visibility: 'private',
            audience: [witch.agentName],
            actor: witch.agentName,
          })] : []),
          ...(seer && seerTarget ? [createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'night',
            action: 'seer-check',
            title: `第 ${werewolfState.dayNumber} 夜预言家查验`,
            summary: `查验 ${seerTarget.agentName}，结果为${seerTarget.role === 'werewolf' ? '狼人' : '好人'}。`,
            visibility: 'private',
            audience: [seer.agentName],
            actor: seer.agentName,
          })] : []),
        ],
      };
      const winner = getWerewolfWinner(nextState);
      if (winner) {
        nextState = { ...nextState, phase: 'ended', currentAction: 'settlement', currentActor: effectiveCollaborationSupervisor, lastSummary: winner, revealedRoles: true };
      }
      nextState = {
        ...nextState,
        memories: [
          ...(nextState.memories || []),
          createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'night',
            action: 'settlement',
            title: `第 ${werewolfState.dayNumber} 夜结算`,
            summary: nextState.lastSummary || '黑夜结算完成。',
            visibility: 'public',
            actor: effectiveCollaborationSupervisor,
          }),
        ],
      };
      const settlementMessages: CollaborationRoomMessage[] = [
        ...(wolves.length && wolfTarget ? [createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: `狼人夜间行动：狼队最终刀口为 ${wolfTarget.agentName}。`,
          status: 'done',
          werewolf: { phase: 'night', action: 'wolf-kill', visibility: 'werewolves', audience: wolves.map((player) => player.agentName), actor: wolves[0].agentName },
        })] : []),
        ...(poisoned ? [createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: `上帝记录 📝：女巫毒药目标 ${poisoned}。`,
        status: 'done',
        werewolf: { phase: 'night', action: 'witch-action', visibility: 'god', actor: witch?.agentName },
      })] : []),
        ...(badgeResult.message ? [createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: badgeResult.message,
        status: 'done',
        werewolf: { phase: 'night', action: badgeResult.action || 'badge-transfer', visibility: 'public', actor: effectiveCollaborationSupervisor },
      })] : []),
        createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: deaths.length ? `天亮了 ☀️，昨夜 ${deaths.join('、')} 出局。` : '天亮了 ☀️，昨夜平安夜。',
        status: 'done',
        werewolf: { phase: nextState.phase, action: 'settlement', visibility: 'public', actor: effectiveCollaborationSupervisor },
      }),
      ];
      nightMessages.push(...settlementMessages);

      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: nextState,
        rounds: [
          ...(room.rounds || []),
          {
            id: roundId,
            topic: `AI 狼人杀 N${werewolfState.dayNumber} 黑夜`,
            participants: alivePlayers.map((player) => player.agentName),
            status: 'completed',
            startedAt: Date.now(),
            completedAt: Date.now(),
            summary: nextState.lastSummary,
          },
        ],
        messages: [
          ...(room.messages || []),
          ...settlementMessages,
        ],
      }));
      appendCollaborationMessagesToChat(settlementMessages, nextState);
      if (nextState.phase === 'ended' && nextState.lastSummary) {
        void saveWerewolfHistory({
          id: `${selectedWerewolfBoard.id}-${Date.now()}`,
          boardId: selectedWerewolfBoard.id,
          boardName: selectedWerewolfBoard.name,
          result: nextState.lastSummary,
          summary: nextState.lastSummary,
          lessons: [
            nextState.sheriff ? `本局警长：${nextState.sheriff}` : '本局无警长',
            nextState.votes.length ? `累计票流 ${nextState.votes.length} 条` : '票流较少',
          ],
          highlights: nextState.eliminated || [],
          generatedAt: new Date().toISOString(),
        }).then(() => fetchWerewolfHistory(8).then(setWerewolfHistoryEntries).catch(() => {}));
      }
      toast('success', nextState.lastSummary || '黑夜结算完成');
    } catch (error: any) {
      const errorText = error?.message || '未知错误';
      const errorMessage = createCollaborationMessage({
        roundId,
        speakerType: 'system',
        speakerName: '系统',
        content: `黑夜轮中断：${errorText}\n当前阶段已保留，可点击右侧按钮重试本夜。`,
        status: 'error',
        error: errorText,
        werewolf: { phase: 'night', action: 'system', visibility: 'public', actor: effectiveCollaborationSupervisor },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? {
          ...room.werewolf,
          phase: 'setup',
          currentAction: 'wolf-meeting',
          currentActor: effectiveCollaborationSupervisor,
          lastError: errorText,
          breakpoint: buildWerewolfBreakpoint({
            handler: 'night',
            roundId,
            stepLabel: `第 ${werewolfState.dayNumber} 夜`,
            resumeFrom: room.werewolf?.currentAction || 'wolf-meeting',
            failedActor: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
            error: errorText,
          }),
          lastSummary: `黑夜轮中断：${errorText}。可重试当前黑夜。`,
        } : room.werewolf,
        messages: [...(room.messages || []), errorMessage],
      }));
      appendCollaborationMessageToChat(errorMessage, werewolfState);
      toast('error', `${errorText}，可重试当前黑夜`);
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    appendCollaborationMessageToChat,
    appendCollaborationMessagesToChat,
    buildWerewolfPrompt,
    callCollaborationAgent,
    collaborationMessages,
    collaborationDraft,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    werewolfState,
  ]);

  const handleWerewolfLastWordsRound = useCallback(async () => {
    if (!werewolfState?.players?.length) return;
    if (werewolfState.pendingHunterShot) {
      const hunterName = werewolfState.pendingHunterShot;
      const hunter = getWerewolfPlayer(werewolfState, hunterName);
      if (!hunter || hunter.role !== 'hunter') return;
      const candidates = getAliveWerewolfPlayers(werewolfState).filter((player) => player.agentName !== hunterName).map((player) => player.agentName);
      const output = await callCollaborationAgent(hunterName, buildWerewolfPrompt(hunterName, {
        kind: 'speech',
        state: { ...werewolfState, phase: 'last-words', currentAction: 'hunter-shot', currentActor: hunterName },
        hostMessage: `你已出局，现在进入猎人技能结算。可带走目标：${candidates.join('、') || '无'}。若不开枪，请在 <result> 中把 target 写 null。`,
      }), `ww-hunter-${werewolfState.dayNumber}-${Date.now()}`, {
        werewolf: { phase: 'last-words', action: 'hunter-shot', visibility: 'public', actor: hunterName },
      });
      const hunterStructured = extractWerewolfStructuredResult(output, isWerewolfHunterResult);
      const target = hunterStructured?.target && candidates.includes(hunterStructured.target) ? hunterStructured.target : undefined;
      const hunterResult = target
        ? resolveWerewolfHunterShot({ ...werewolfState, pendingHunterShot: hunterName }, hunterName, target)
        : resolveWerewolfHunterShot({ ...werewolfState, pendingHunterShot: hunterName }, hunterName);
      const deathsAfterShot = hunterResult.target ? [hunterResult.target] : [];
      const badgeResult = resolveWerewolfBadgeAfterDeaths(hunterResult.state, deathsAfterShot);
      const nextState: CollaborationWerewolfState = {
        ...badgeResult.state,
        phase: 'last-words',
        pendingLastWords: Array.from(new Set([...(werewolfState.pendingLastWords || []), ...deathsAfterShot])),
        pendingHunterShot: undefined,
        currentAction: 'last-words',
        currentActor: effectiveCollaborationSupervisor,
        lastSummary: hunterResult.content || '猎人未发动技能，进入遗言。',
        memories: [
          ...(badgeResult.state.memories || []),
          createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'last-words',
            action: 'hunter-shot',
            title: '猎人技能处理',
            summary: hunterResult.content || '猎人未发动技能。',
            visibility: 'public',
            actor: werewolfState.pendingHunterShot,
          }),
        ],
      };
      const winner = getWerewolfWinner(nextState);
      const hunterMessage = createCollaborationMessage({
        roundId: `ww-hunter-${werewolfState.dayNumber}-${Date.now()}`,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: [
          `AI 上帝发言 🎯：${werewolfState.pendingHunterShot} 出局，进入猎人技能结算。`,
          hunterResult.content || '猎人选择不开枪。',
          badgeResult.message || '',
          winner ? `结局：${winner}` : '',
        ].filter(Boolean).join('\n'),
        status: 'done',
        werewolf: { phase: 'last-words', action: 'hunter-shot', visibility: 'public', actor: werewolfState.pendingHunterShot },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: winner
          ? { ...nextState, phase: 'ended', currentAction: 'settlement', lastSummary: winner, revealedRoles: true }
          : nextState,
        messages: [
          ...(room.messages || []),
          hunterMessage,
        ],
      }));
      appendCollaborationMessageToChat(hunterMessage, winner
        ? { ...nextState, phase: 'ended', currentAction: 'settlement', lastSummary: winner, revealedRoles: true }
        : nextState);
      toast('success', winner || '猎人技能已处理');
      return;
    }
    const targets = werewolfState.pendingLastWords || [];
    const roundId = `ww-last-words-${werewolfState.dayNumber}-${Date.now()}`;
    const cameFromNight = Boolean(werewolfState.lastNightVictim);
    const nextPhase = cameFromNight ? 'day' : 'night';
    const nextDayNumber = cameFromNight ? werewolfState.dayNumber : werewolfState.dayNumber + 1;
    const nextAction = cameFromNight ? 'day-speech' : 'wolf-meeting';
    const openingContent = targets.length
      ? `AI 上帝发言 🕯️：${targets.join('、')} 请依次留下遗言。遗言结束后${cameFromNight ? '进入白天发言' : '进入下一夜'}。`
      : `AI 上帝发言 🕯️：本轮没有待处理遗言，${cameFromNight ? '直接进入白天发言' : '直接进入下一夜'}。`;
    const lastWordsMessage = createCollaborationMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: effectiveCollaborationSupervisor,
      content: openingContent,
      status: 'done',
      werewolf: { phase: 'last-words', action: 'last-words', visibility: 'public', audience: targets, actor: targets[0] || effectiveCollaborationSupervisor },
    });
    updateCollaborationRoom((room) => ({
      ...room,
      messages: [
        ...(room.messages || []),
        lastWordsMessage,
      ],
    }));
    appendCollaborationMessageToChat(lastWordsMessage, werewolfState);
    try {
      if (targets.length) {
        setCollaborationBusy(true);
        const transcript: CollaborationRoomMessage[] = [...collaborationMessages, lastWordsMessage];
        for (const target of targets) {
          const output = await callCollaborationAgent(target, buildWerewolfPrompt(target, {
            kind: 'speech',
            state: {
              ...werewolfState,
              phase: 'last-words',
              currentAction: 'last-words',
              currentActor: target,
            },
            hostMessage: `你已经出局，现在是遗言环节。请用一轮发言留下你的判断、站边和对场上玩家的最后提醒。`,
            transcript,
          }), roundId, {
            werewolf: { phase: 'last-words', action: 'last-words', visibility: 'public', actor: target },
          });
          transcript.push(createCollaborationMessage({
            roundId,
            speakerType: 'agent',
            speakerName: target,
            content: output,
            status: 'done',
            werewolf: { phase: 'last-words', action: 'last-words', visibility: 'public', actor: target },
          }));
        }
      }
      const closingContent = targets.length
        ? `AI 上帝发言 📣：遗言结束。${cameFromNight ? `现在进入第 ${nextDayNumber} 天白天发言。` : `现在进入第 ${nextDayNumber} 夜。`}`
        : openingContent;
      const nextState: CollaborationWerewolfState = {
        ...werewolfState,
        phase: nextPhase,
        dayNumber: nextDayNumber,
        pendingLastWords: [],
        currentAction: nextAction,
        currentActor: effectiveCollaborationSupervisor,
        lastSummary: closingContent,
        breakpoint: undefined,
      };
      const closingMessage = targets.length ? createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: closingContent,
        status: 'done',
        werewolf: { phase: nextPhase, action: 'settlement', visibility: 'public', actor: effectiveCollaborationSupervisor },
      }) : null;
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? {
          ...room.werewolf,
          phase: nextPhase,
          dayNumber: nextDayNumber,
          pendingLastWords: [],
          currentAction: nextAction,
          currentActor: effectiveCollaborationSupervisor,
          lastSummary: closingContent,
          memories: [
            ...(room.werewolf.memories || []),
            createWerewolfMemoryEntry({
              round: werewolfState.dayNumber,
              phase: 'last-words',
              action: 'last-words',
              title: '死后遗言处理',
              summary: closingContent,
              visibility: 'public',
              actor: targets[0] || effectiveCollaborationSupervisor,
            }),
          ],
        } : room.werewolf,
        messages: closingMessage
          ? [...(room.messages || []), closingMessage]
          : (room.messages || []),
      }));
      if (closingMessage) {
        appendCollaborationMessageToChat(closingMessage, nextState);
      }
      toast('success', '遗言环节已处理');
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `遗言环节中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
        werewolf: room.werewolf ? {
          ...room.werewolf,
          lastError: error?.message || '未知错误',
          breakpoint: buildWerewolfBreakpoint({
            handler: 'last-words',
            roundId,
            stepLabel: `第 ${werewolfState.dayNumber} 天遗言`,
            resumeFrom: werewolfState.pendingHunterShot || (werewolfState.pendingLastWords || [])[0] || effectiveCollaborationSupervisor,
            failedActor: effectiveCollaborationSupervisor,
            error: error?.message || '未知错误',
          }),
        } : room.werewolf,
      }));
      toast('error', error?.message || '遗言环节失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    buildWerewolfPrompt,
    callCollaborationAgent,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    appendCollaborationMessageToChat,
    toast,
    updateCollaborationRoom,
    werewolfState?.pendingLastWords,
    werewolfState?.players?.length,
    werewolfState?.dayNumber,
  ]);

  const handleWerewolfVoteRound = useCallback(async () => {
    if (!werewolfState?.players?.length) {
      toast('warning', '请先初始化测试局');
      return;
    }
    const alivePlayers = getAliveWerewolfPlayers(werewolfState);
    if (alivePlayers.length < 2) {
      toast('warning', '存活玩家不足，无法投票');
      return;
    }
    const roundId = `ww-vote-${werewolfState.dayNumber}-${Date.now()}`;
    const hostMessage = collaborationDraft.trim() || `第 ${werewolfState.dayNumber} 天投票，请每位玩家投出一名怀疑对象。请结合归票、站边、警长票和普通票票型给出理由。`;
    const voteHostMessage = createCollaborationMessage({
      roundId,
      speakerType: 'supervisor',
      speakerName: effectiveCollaborationSupervisor,
      content: [
        `AI 上帝发言 🗳️：现在开始第 ${werewolfState.dayNumber} 天放逐投票。`,
        '请所有存活玩家依次投票，警长票按 1.5 票结算。',
        hostMessage,
      ].join('\n'),
      status: 'done',
      werewolf: {
        phase: 'voting',
        action: 'vote',
        visibility: 'public',
        actor: effectiveCollaborationSupervisor,
      },
    });
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: room.werewolf ? { ...room.werewolf, phase: 'voting', currentAction: 'vote', currentActor: effectiveCollaborationSupervisor } : room.werewolf,
      messages: [
        ...(room.messages || []),
        voteHostMessage,
      ],
    }));
    appendCollaborationMessageToChat(voteHostMessage, werewolfState);
    setCollaborationDraft('');

    try {
      setCollaborationBusy(true);
      appendCollaborationPendingMessage(
        `AI 上帝正在组织第 ${werewolfState.dayNumber} 天投票结算，请稍候。`,
        '投票结算',
      );
      const transcript: CollaborationRoomMessage[] = [
        ...collaborationMessages,
        voteHostMessage,
      ];
      const votes = [];
      for (const player of alivePlayers) {
        const candidates = alivePlayers.map((item) => item.agentName).filter((name) => name !== player.agentName);
        const output = await callCollaborationAgent(player.agentName, buildWerewolfPrompt(player.agentName, {
          kind: 'vote',
          state: werewolfState,
          hostMessage,
          transcript,
        }), roundId, {
          werewolf: {
            phase: 'voting',
            action: 'vote',
            visibility: 'public',
            actor: player.agentName,
          },
        });
        const structuredVote = extractWerewolfStructuredResult(output, isWerewolfVoteResult);
        const parsedVote = structuredVote?.target
          ? {
            target: structuredVote.target,
            reason: structuredVote.reason || '',
          }
          : parseVoteTarget(output, candidates);
        if (parsedVote) {
          votes.push({
            voter: player.agentName,
            target: parsedVote.target,
            reason: parsedVote.reason,
            round: werewolfState.dayNumber,
          });
        }
        transcript.push(createCollaborationMessage({
          roundId,
          speakerType: 'agent',
          speakerName: player.agentName,
          content: output,
          status: 'done',
          werewolf: {
            phase: 'voting',
            action: 'vote',
            visibility: 'public',
            actor: player.agentName,
          },
        }));
      }

      const tally = new Map<string, number>();
      for (const vote of votes) {
        const weight = werewolfState.sheriff === vote.voter && !werewolfState.badgeDestroyed ? 1.5 : 1;
        tally.set(vote.target, (tally.get(vote.target) || 0) + weight);
      }
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const eliminated = sorted[0]?.[0] || '';
      const eliminatedPlayer = getWerewolfPlayer(werewolfState, eliminated);
      const idiotFlips = Boolean(eliminatedPlayer?.role === 'idiot' && !werewolfState.roleState?.idiotRevealed);
      const roleState = {
        ...getWerewolfRoleState(werewolfState),
        idiotRevealed: getWerewolfRoleState(werewolfState).idiotRevealed || idiotFlips,
      };
      const baseVoteState: CollaborationWerewolfState = {
        ...werewolfState,
        roleState,
        players: werewolfState.players.map((player) => (
          player.agentName === eliminated && idiotFlips ? { ...player, idiotRevealed: true } : player
        )),
        votes: [...werewolfState.votes, ...votes],
        lastNightVictim: undefined,
      };
      const afterElimination = eliminated && !idiotFlips
        ? applyWerewolfDeaths(baseVoteState, [eliminated])
        : baseVoteState;
      const badgeResult = eliminated && !idiotFlips
        ? resolveWerewolfBadgeAfterDeaths(afterElimination, [eliminated])
        : { state: afterElimination };
      const hunterPending = eliminatedPlayer?.role === 'hunter' && !idiotFlips && !badgeResult.state.roleState?.hunterShotUsed
        ? eliminated
        : undefined;
      const provisionalState: CollaborationWerewolfState = {
        ...badgeResult.state,
        phase: hunterPending ? 'last-words' : 'night',
        dayNumber: eliminated && !hunterPending ? werewolfState.dayNumber + 1 : werewolfState.dayNumber,
        pendingLastWords: eliminated && !idiotFlips ? [eliminated] : [],
        pendingHunterShot: hunterPending,
        currentAction: hunterPending ? 'hunter-shot' : 'wolf-meeting',
        currentActor: effectiveCollaborationSupervisor,
        breakpoint: undefined,
        lastSummary: idiotFlips
          ? `${eliminated} 被投票放逐，白痴翻牌免死并失去投票权，白天结束进入下一夜。`
          : eliminated
            ? `${eliminated} 被投票放逐${hunterPending ? '，猎人可选择是否发动技能。' : '。'}`
            : '本轮没有有效出局玩家。',
        memories: [
          ...(badgeResult.state.memories || []),
          createWerewolfMemoryEntry({
            round: werewolfState.dayNumber,
            phase: 'voting',
            action: 'vote',
            title: `第 ${werewolfState.dayNumber} 天投票结算`,
            summary: buildWerewolfTallySummary(votes, werewolfState.sheriff, werewolfState.badgeDestroyed),
            visibility: 'public',
            actor: effectiveCollaborationSupervisor,
          }),
        ],
      };
      const winner = getWerewolfWinner(provisionalState);
      const nextState: CollaborationWerewolfState = winner
        ? { ...provisionalState, phase: 'ended', currentAction: 'settlement', currentActor: effectiveCollaborationSupervisor, lastSummary: winner, revealedRoles: true }
        : provisionalState;
      const voteLines = buildWerewolfVoteLines(votes, werewolfState.sheriff, werewolfState.badgeDestroyed);
      const tallySummary = buildWerewolfTallySummary(votes, werewolfState.sheriff, werewolfState.badgeDestroyed);
      const voteSummary = [
        `投票结果：${voteLines.join('；') || '没有有效票'}`,
        `票型统计：${tallySummary}`,
        eliminated
          ? idiotFlips
            ? `白痴翻牌：${eliminated} 免死，但之后失去投票权。`
            : `出局：${eliminated}`
          : '本轮没有出局玩家',
        badgeResult.message || '',
        hunterPending ? `猎人技能待处理：${hunterPending} 可以选择是否开枪。` : '',
        winner ? `结局：${winner}` : hunterPending ? '进入猎人技能/遗言处理' : `进入第 ${nextState.dayNumber} 夜`,
        '',
        '当前玩家：',
        formatWerewolfRoster(nextState, Boolean(winner)),
      ].filter(Boolean).join('\n');

      const voteSummaryMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: voteSummary,
        cards: buildWerewolfTallyChartCard({
          title: `第 ${werewolfState.dayNumber} 天放逐票型`,
          subtitle: eliminated ? `出局：${eliminated}` : '本轮没有出局玩家',
          votes,
          sheriff: werewolfState.sheriff,
          badgeDestroyed: werewolfState.badgeDestroyed,
        }),
        status: 'done',
        werewolf: {
          phase: nextState.phase,
          action: 'settlement',
          visibility: 'public',
          actor: effectiveCollaborationSupervisor,
        },
      });
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: nextState,
        messages: [
          ...(room.messages || []),
          voteSummaryMessage,
        ],
      }));
      appendCollaborationMessageToChat(voteSummaryMessage, nextState);
      if (nextState.phase === 'ended' && nextState.lastSummary) {
        void saveWerewolfHistory({
          id: `${selectedWerewolfBoard.id}-${Date.now()}`,
          boardId: selectedWerewolfBoard.id,
          boardName: selectedWerewolfBoard.name,
          result: nextState.lastSummary,
          summary: voteSummary,
          lessons: [
            nextState.sheriff ? `本局警长：${nextState.sheriff}` : '本局无警长',
            votes.length ? `最终投票 ${votes.length} 人参与` : '有效投票不足',
          ],
          highlights: nextState.eliminated || [],
          generatedAt: new Date().toISOString(),
        }).then(() => fetchWerewolfHistory(8).then(setWerewolfHistoryEntries).catch(() => {}));
      }
      toast('success', winner ? winner : '投票结算完成');
    } catch (error: any) {
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            roundId,
            speakerType: 'system',
            speakerName: '系统',
            content: `投票轮中断：${error?.message || '未知错误'}`,
            status: 'error',
            error: error?.message || '未知错误',
          }),
        ],
        werewolf: room.werewolf ? {
          ...room.werewolf,
          lastError: error?.message || '未知错误',
          breakpoint: buildWerewolfBreakpoint({
            handler: 'vote',
            roundId,
            stepLabel: `第 ${werewolfState.dayNumber} 天投票`,
            resumeFrom: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
            failedActor: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
            error: error?.message || '未知错误',
          }),
        } : room.werewolf,
      }));
      toast('error', error?.message || '投票轮失败');
    } finally {
      setCollaborationBusy(false);
    }
  }, [
    buildWerewolfPrompt,
    callCollaborationAgent,
    appendCollaborationMessageToChat,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    werewolfState,
  ]);

  const handleWerewolfSupervisorStep = useCallback(async () => {
    if (!werewolfState?.players?.length) {
      handleSetupWerewolf();
      return;
    }
    if (werewolfState.breakpoint?.handler === 'night') {
      await handleWerewolfNightRound();
      return;
    }
    if (werewolfState.breakpoint?.handler === 'sheriff-election') {
      await handleWerewolfSheriffElection();
      return;
    }
    if (werewolfState.breakpoint?.handler === 'day-speech') {
      await handleWerewolfSpeechRound();
      return;
    }
    if (werewolfState.breakpoint?.handler === 'last-words') {
      await handleWerewolfLastWordsRound();
      return;
    }
    if (werewolfState.breakpoint?.handler === 'vote') {
      await handleWerewolfVoteRound();
      return;
    }
    if (werewolfState.phase === 'setup' || werewolfState.phase === 'night') {
      await handleWerewolfNightRound();
      return;
    }
    if (werewolfState.phase === 'last-words') {
      await handleWerewolfLastWordsRound();
      return;
    }
    if (werewolfState.phase === 'day') {
      if (!werewolfState.sheriffElectionDone) {
        await handleWerewolfSheriffElection();
        return;
      }
      await handleWerewolfSpeechRound();
      return;
    }
    if (werewolfState.phase === 'voting') {
      await handleWerewolfVoteRound();
      return;
    }
    toast('info', '测试局已结束，可以重新选择板子并初始化');
  }, [
    handleSetupWerewolf,
    handleWerewolfLastWordsRound,
    handleWerewolfNightRound,
    handleWerewolfSheriffElection,
    handleWerewolfSpeechRound,
    handleWerewolfVoteRound,
    werewolfState?.breakpoint?.handler,
    toast,
    werewolfState?.phase,
    werewolfState?.players?.length,
  ]);

  const handleWerewolfAutoRun = useCallback(async () => {
    werewolfAutoStopRef.current = false;
    werewolfAutoTurnsRef.current = 0;
    setWerewolfAutoRunning(true);
    await handleWerewolfSupervisorStep();
  }, [
    handleWerewolfSupervisorStep,
  ]);

  const handleWerewolfPause = useCallback(() => {
    werewolfAutoStopRef.current = true;
    setWerewolfAutoRunning(false);
    updateCollaborationRoom((room) => ({
      ...room,
      messages: [
        ...(room.messages || []),
        createCollaborationMessage({
          speakerType: 'system',
          speakerName: '系统',
          content: '人工已暂停自动流程。可以补充指令后继续推进。',
          status: 'done',
        }),
      ],
    }));
  }, [updateCollaborationRoom]);

  useEffect(() => {
    if (!werewolfAutoRunning || werewolfAutoStopRef.current) return;
    if (collaborationBusy) return;
    if (werewolfState?.phase === 'ended') {
      setWerewolfAutoRunning(false);
      return;
    }
    if (werewolfAutoTurnsRef.current >= 12) {
      setWerewolfAutoRunning(false);
      updateCollaborationRoom((room) => ({
        ...room,
        messages: [
          ...(room.messages || []),
          createCollaborationMessage({
            speakerType: 'system',
            speakerName: '系统',
            content: '自动推进已到达本次上限，已暂停等待人工检查。',
            status: 'done',
          }),
        ],
      }));
      return;
    }
    const timer = window.setTimeout(() => {
      if (!werewolfAutoStopRef.current) {
        werewolfAutoTurnsRef.current += 1;
        void handleWerewolfSupervisorStep();
      }
    }, werewolfStepDelay);
    return () => window.clearTimeout(timer);
  }, [
    collaborationBusy,
    handleWerewolfSupervisorStep,
    updateCollaborationRoom,
    werewolfAutoRunning,
    werewolfState?.dayNumber,
    werewolfState?.phase,
    werewolfState?.players?.length,
    werewolfStepDelay,
  ]);

  const renderMentionSuggestions = () => (
    mentionSuggestions.length > 0 ? (
      <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full rounded-xl border bg-background p-2 shadow-lg">
        <div className="mb-1 text-[10px] text-muted-foreground">@ 提示</div>
        <div className="flex flex-wrap gap-1.5">
          {mentionSuggestions.map((name, index) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={index === activeMentionIndex ? 'secondary' : 'ghost'}
              className="h-7 max-w-full px-2 text-xs"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertCollaborationMention(name)}
            >
              <span className="truncate">@{name}</span>
            </Button>
          ))}
        </div>
      </div>
    ) : null
  );

  return (
    <>
      <style jsx>{`
        @keyframes seatFall {
          0% { transform: translateY(0) scale(1); opacity: 1; }
          35% { transform: translateY(2px) scale(1.05); opacity: 1; }
          100% { transform: translateY(12px) scale(0.9); opacity: 0.45; }
        }
        @keyframes fadeIn {
          0% { opacity: 0; transform: scale(0.94); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes seatDisconnect {
          0% { opacity: 1; filter: grayscale(0); }
          100% { opacity: 0.38; filter: grayscale(1); }
        }
      `}</style>
      <aside
        className={cn(
          'flex h-full min-h-0 flex-col border-l bg-card/40 backdrop-blur-sm',
          werewolfMode && 'werewolf-wood-panel border-l-stone-700/60'
        )}
      >
        <div className={cn('border-b px-4 py-4', werewolfMode && 'border-stone-700/60 bg-black/5')}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Command</p>
              <h2 className="text-lg font-semibold">首页指挥区</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">
                指挥官
              </Badge>
              <Button size="icon" variant="ghost" className="h-11 w-11" onClick={expanded ? onCollapse : onExpand}>
                <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>{expanded ? 'right_panel_close' : 'right_panel_open'}</span>
              </Button>
            </div>
          </div>
            <div className={`mt-4 grid gap-2 ${availableTabs.length <= 1 ? 'grid-cols-1' : availableTabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {availableTabs.map((tab) => (
              <Button
                key={tab}
                size="sm"
                variant={activeTab === tab ? 'default' : 'outline'}
                className="justify-center"
                onClick={() => onTabChange(tab)}
              >
                {TAB_LABELS[tab]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 pb-16">
          {isWerewolfLab ? (
            <div className="mb-4 rounded-2xl border border-primary/20 bg-primary/5 p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 text-left"
                onClick={() => setWerewolfContextExpanded((prev) => !prev)}
              >
                <div>
                  <div className="text-sm font-medium">多Agent能力实验室</div>
                  <div className="mt-1 text-xs text-muted-foreground">AI 狼人杀群聊、回合制和投票测试台</div>
                </div>
                <span className="material-symbols-outlined text-muted-foreground">
                  {werewolfContextExpanded ? 'expand_less' : 'expand_more'}
                </span>
              </button>
              {werewolfContextExpanded ? (
                <div className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
                  {sidebarHint?.reason ? <div>触发原因：{sidebarHint.reason}</div> : null}
                  {sidebarHint?.summary ? <div className="rounded-lg border bg-background/70 p-2">{sidebarHint.summary}</div> : null}
                  {sidebarHint?.recommendedNextAction ? <div>推荐动作：{sidebarHint.recommendedNextAction}</div> : null}
                  {recentConversation.length > 0 ? (
                    <details className="rounded-lg border bg-background/70 p-2">
                      <summary className="cursor-pointer text-foreground">最近对话摘录</summary>
                      <div className="mt-2 space-y-1">
                        {recentConversation.map((message) => (
                          <div key={message.id} className="break-words">
                            <span className="font-medium text-foreground">{message.role === 'user' ? '用户' : '助手'}：</span>
                            {message.content.length > 120 ? `${message.content.slice(0, 120)}...` : message.content}
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {shouldShowHomeContext && (sidebarHint?.summary || sidebarHint?.reason || recentConversation.length > 0 || sidebarHint?.knownFacts?.length || sidebarHint?.missingFields?.length || sidebarHint?.questions?.length || sidebarHint?.recommendedNextAction) && (
            <div className="mb-4 space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">当前对话上下文</div>
                  <div className="mt-1 text-xs text-muted-foreground">由最近一条结构化 `home_sidebar` 结果驱动，侧边栏表单会按此自动预填。</div>
                </div>
                <div className="flex items-center gap-2">
                  {sidebarHint?.stage ? (
                    <Badge variant="secondary">{formatSidebarStage(sidebarHint.stage)}</Badge>
                  ) : null}
                  <Badge variant="outline">AI整理</Badge>
                </div>
              </div>
              {sidebarHint?.reason ? (
                <div className="text-xs text-muted-foreground leading-5">
                  触发原因：{sidebarHint.reason}
                </div>
              ) : null}
              {sidebarHint?.summary ? (
                <div className="rounded-xl border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                  {sidebarHint.summary}
                </div>
              ) : null}
              {(activeTab === 'workflow' ? workflowFocusFacts : activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {(activeTab === 'workflow' ? workflowFocusFacts : activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).map((fact) => (
                    <div key={fact} className="min-w-0 whitespace-normal break-all rounded-xl border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                      {fact}
                    </div>
                  ))}
                </div>
              ) : null}
              {sidebarHint?.knownFacts?.length ? (
                <div className="rounded-xl border bg-background/70 p-3">
                  <div className="text-xs font-medium text-foreground">已确认上下文</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sidebarHint.knownFacts.map((fact) => (
                      <Badge key={fact} variant="outline" className="max-w-full whitespace-normal break-all text-left">
                        {fact}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.missingFields?.length ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="text-xs font-medium text-foreground">仍缺信息</div>
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {sidebarHint.missingFields.map((field) => (
                      <div key={field}>- {field}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.questions?.length ? (
                <div className="rounded-xl border bg-background/70 p-3">
                  <div className="text-xs font-medium text-foreground">建议下一轮补问</div>
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {sidebarHint.questions.map((question) => (
                      <div key={question}>- {question}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.recommendedNextAction ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">推荐动作：</span>
                  {sidebarHint.recommendedNextAction}
                </div>
              ) : null}
              {recentConversation.length > 0 ? (
                <details className="rounded-xl border bg-background/70 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开最近对话摘录</summary>
                  <div className="mt-3 space-y-2">
                    {recentConversation.map((message) => (
                      <div key={message.id} className="rounded-xl border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                        <span className="mr-2 font-medium text-foreground">{message.role === 'user' ? '用户' : '助手'}</span>
                        {message.content.length > 120 ? `${message.content.slice(0, 120)}...` : message.content}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )}

          {availableTabs.includes('commander') && activeTab === 'commander' && (
            <div className="space-y-4">
              {shouldShowWorkflowRuntimePanels && boundHumanQuestions.length > 0 ? (
                <HumanQuestionInbox
                  questions={boundHumanQuestions}
                  title="当前工作流待审批"
                  emptyText="当前绑定工作流暂无待审批消息。"
                  compact={false}
                  submittingQuestionId={submittingHumanQuestionId}
                  onSubmit={answerHumanQuestion}
                />
              ) : null}

              {shouldShowWorkflowRuntimePanels ? (
                <HumanQuestionInbox
                  questions={binding ? otherHumanQuestions : unansweredHumanQuestions}
                  onNavigate={navigateToHumanQuestion}
                />
              ) : null}

              {shouldShowWorkflowRuntimePanels ? (
              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">当前指挥官</p>
                    <div className="mt-1 text-base font-semibold">{boundCommander || 'default-supervisor'}</div>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-400 to-stone-900 text-white flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined">military_tech</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  指挥官会跟随当前会话最近一次启动的 workflow 运行自动切换，不再要求手动绑定。
                </p>
              </div>
              ) : null}

              <div className="rounded-2xl border p-4 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">协作室</div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {isWerewolfLab
                        ? 'Supervisor 主导回合制流程；人类负责开局、暂停、补充指令和关键节点推进。'
                        : '由你主持当前议题，点名空闲 Agent 发言，或发起一轮多 Agent 圆桌讨论。'}
                    </p>
                  </div>
                  <Badge variant={collaborationBusy ? 'secondary' : 'outline'}>
                    {collaborationBusy ? '讨论中' : `${collaborationMessages.length} 条`}
                  </Badge>
                </div>

                {!isWerewolfLab ? (
                  <>
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">议题</label>
                      <Input
                        value={collaborationTopic}
                        onChange={(event) => setCollaborationTopic(event.target.value)}
                        onBlur={() => {
                          const topic = collaborationTopic.trim();
                          if (!topic && !collaborationRoom?.topic) return;
                          updateCollaborationRoom((room) => ({ ...room, topic }));
                        }}
                        placeholder="例如：请评估当前修复方案的风险和下一步动作"
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-muted-foreground">本工作流圆桌席位</label>
                        <Badge variant="outline" className="text-[10px]">
                          {workflowRoundtableAgents.length} 位
                        </Badge>
                      </div>
                      {workflowRoundtableSeats.length > 0 ? (
                        <div className="rounded-2xl border bg-muted/10 p-3">
                          <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                            <span>顺时针发言</span>
                            <span>由被 @ 的 Agent 依次接话</span>
                          </div>
                          <div className="relative mx-auto aspect-square max-w-[360px]">
                            {workflowRoundtableSeats.map((seat, index) => {
                              const total = workflowRoundtableSeats.length;
                              const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
                              const radius = total <= 4 ? 34 : total <= 6 ? 38 : 41;
                              const x = 50 + radius * Math.cos(angle);
                              const y = 50 + radius * Math.sin(angle);
                              const nextAngle = (Math.PI * 2 * ((index + 0.5) % Math.max(total, 1))) / Math.max(total, 1) - Math.PI / 2;
                              const arrowX = 50 + (radius - 7) * Math.cos(nextAngle);
                              const arrowY = 50 + (radius - 7) * Math.sin(nextAngle);
                              return (
                                <div key={seat.id}>
                                  {total > 1 ? (
                                    <div
                                      className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70"
                                      style={{ left: `${arrowX}%`, top: `${arrowY}%` }}
                                    >
                                      ↻
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="absolute -translate-x-1/2 -translate-y-1/2"
                                    style={{ left: `${x}%`, top: `${y}%` }}
                                    onClick={() => setSelectedSeatId(seat.id)}
                                  >
                                    <div className={`relative flex h-16 w-16 items-center justify-center rounded-full border bg-background transition-all duration-300 hover:scale-105 ${seat.avatarClass} ${seat.ringClass || ''} ${seat.active ? 'scale-105' : ''}`}>
                                      {seat.speaking ? <span className="absolute inset-[-5px] animate-ping rounded-full border border-primary/40" /> : null}
                                      {seat.seatNumber ? (
                                        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border bg-background px-1 text-[9px] font-semibold text-muted-foreground shadow-sm">
                                          {seat.seatNumber}
                                        </span>
                                      ) : null}
                                      <span className={`text-lg font-semibold ${seat.speaking ? 'animate-[spin_4s_linear_infinite]' : ''}`}>{getWerewolfSpeakerInitial(seat.name)}</span>
                                    </div>
                                    <div className={`mt-1 max-w-[92px] truncate text-center text-[10px] font-medium ${seat.nameClass || 'text-foreground'}`}>{seat.name}</div>
                                  </button>
                                </div>
                              );
                            })}
                            <div className="absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-background/95 p-3 text-center shadow-sm">
                              <div className="text-[10px] text-muted-foreground">当前席位</div>
                              <div className={`mt-1 line-clamp-2 text-xs font-semibold ${activeRoundtableSeat?.nameClass || 'text-foreground'}`}>
                                {activeRoundtableSeat?.name || '未选中'}
                              </div>
                              {activeRoundtableSeat?.seatNumber ? (
                                <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                              ) : null}
                              <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat?.statusLabel || '待命'}</div>
                              {activeRoundtableSeat?.meta ? (
                                <div className="mt-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground">
                                  {activeRoundtableSeat.meta}
                                </div>
                              ) : null}
                            </div>
                          </div>
                          {activeRoundtableSeat ? (
                            <div className={`mt-3 rounded-xl border p-3 text-xs ${activeRoundtableSeat.accentClass || 'bg-background'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className={`font-medium ${activeRoundtableSeat.nameClass || 'text-foreground'}`}>{activeRoundtableSeat.name}</div>
                                  {activeRoundtableSeat.seatNumber ? (
                                    <div className="text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                                  ) : null}
                                </div>
                                <Badge variant="outline" className="text-[9px]">{activeRoundtableSeat.subtitle}</Badge>
                              </div>
                              <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{activeRoundtableSeat.detail}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="px-2 py-3 text-xs text-muted-foreground">暂无可用 Agent。</div>
                      )}
                      <div className="text-[11px] leading-5 text-muted-foreground">
                        工作流下的 Agent 天然构成一个群聊圆桌。用 <span className="font-medium">@agent</span> 或 <span className="font-medium">@全员</span> 控制下一轮顺序发言；没有新的 @ 时，本轮自然结束。
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">主持人消息</label>
                      <div className="relative">
                        <Textarea
                          ref={collaborationTextareaRef}
                          value={collaborationDraft}
                          onChange={(event) => setCollaborationDraft(event.target.value)}
                          placeholder="写下本轮目标，并用 @agent 或 @全员 指定下一位发言者。"
                          className="min-h-[86px]"
                          onKeyDown={(event) => {
                            if (mentionSuggestions.length > 0) {
                              if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
                                return;
                              }
                              if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                                return;
                              }
                              if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                                event.preventDefault();
                                insertCollaborationMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
                                return;
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setCollaborationDraft((prev) => `${prev} `);
                              }
                            }
                          }}
                        />
                        {renderMentionSuggestions()}
                      </div>
                    </div>

                    <Button
                      type="button"
                      className="w-full"
                      onClick={handleWorkflowGroupChat}
                      disabled={collaborationBusy || workflowRoundtableAgents.length === 0}
                    >
                      {collaborationBusy ? '群聊进行中...' : '发送到工作流群聊'}
                    </Button>
                  </>
                ) : null}

                {isWerewolfLab ? (
                <div className={cn('rounded-xl border border-dashed p-3 space-y-3', werewolfSectionClass)}>
                  <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">AI 狼人杀测试</div>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {isWerewolfLab
                          ? '先选择板子，由系统随机抽取临时人格；Supervisor 按流程推进，人类只在关键节点接入。'
                          : '用当前 Agent 做回合制身份推理测试，验证多 Agent 发言、@点名、主持总结和投票结算。'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn('h-7 gap-1 px-2 text-xs', werewolfGhostButtonClass)}
                        onClick={() => setWerewolfRolebookOpen(true)}
                      >
                        <span className="material-symbols-outlined text-sm">style</span>
                        角色图鉴
                      </Button>
                      <Badge variant={werewolfState?.enabled ? 'secondary' : 'outline'} className={cn('text-[10px]', werewolfBadgeClass)}>
                        {werewolfState?.enabled ? `${werewolfState.phase} · D${werewolfState.dayNumber}` : '未开始'}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="space-y-2">
                      <label className="text-xs text-muted-foreground">板子</label>
                      <select
                        value={selectedWerewolfBoard.id}
                        onChange={(event) => handleWerewolfBoardChange(event.target.value)}
                        disabled={collaborationBusy || Boolean(werewolfState?.players?.length && werewolfState.phase !== 'setup')}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        {WEREWOLF_LAB_BOARDS.map((board) => (
                          <option key={board.id} value={board.id}>{board.name}</option>
                        ))}
                      </select>
                      <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        {selectedWerewolfBoard.description}
                      </div>
                      <div className={cn('rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        规则：{selectedWerewolfBoard.winRuleLabel}。{selectedWerewolfBoard.winRuleDescription}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <label className="text-xs text-muted-foreground">流程</label>
                        <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                          {isWerewolfConfigured ? 'Supervisor 主导中' : '等待确认开局'}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-5 gap-1 text-[10px]">
                        {[
                          ['setup', '配置'],
                          ['night', '黑夜'],
                          ['sheriff-election', '警长'],
                          ['last-words', '遗言'],
                          ['day', '发言'],
                          ['voting', '投票'],
                        ].map(([phase, label]) => {
                          const active = werewolfState?.phase === phase || werewolfState?.currentAction === phase;
                          return (
                            <div key={phase} className={cn('rounded-md border px-2 py-1 text-center', active ? 'border-primary bg-primary/10 text-primary' : 'bg-muted/20 text-muted-foreground', werewolfMode && !active ? 'border-amber-800/30 bg-stone-800/15 text-stone-300' : undefined)}>
                              {label}
                            </div>
                          );
                        })}
                      </div>
                      <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                        {isWerewolfConfigured
                          ? `当前：${selectedWerewolfBoard.name}，第 ${werewolfState?.dayNumber || 1} 天。可以在人工介入里补充指令，再让 Supervisor 推进。`
                          : `选择板子后会随机选择 ${selectedWerewolfBoard.playerCount} 个临时人格，并按 ${selectedWerewolfBoard.name} 分配身份。`}
                      </div>
                    </div>
                  </div>

                  <div className={cn('grid gap-3 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto] sm:items-start', werewolfCardClass)}>
                    <div className="min-w-0">
                      <div className="text-xs font-medium">视角</div>
                      <div className="text-[10px] leading-5 text-muted-foreground">
                        {werewolfViewMode === 'god'
                          ? '上帝视角会显示所有身份。'
                          : effectiveWerewolfNightViewer
                            ? isWerewolfConfigured
                              ? `黑夜视角绑定：${effectiveWerewolfNightViewer}（${formatWerewolfRole(effectiveWerewolfNightViewerRole || 'villager')}）。狼人视角可见狼队，其余玩家只看自己。`
                              : `黑夜视角预绑定：${effectiveWerewolfNightViewer}。开局分配身份后会自动沿用。`
                            : werewolfViewCandidateNames.length
                              ? '黑夜视角未绑定玩家时，只显示公开信息。请在下方选择一名玩家。'
                              : '开局后可绑定任意玩家查看其黑夜视角。'}
                      </div>
                      {werewolfViewMode === 'night' && werewolfViewCandidateNames.length ? (
                        <div className="mt-2 grid gap-1.5">
                          <label className="text-[10px] font-medium text-foreground">选择绑定玩家</label>
                          <select
                            value={effectiveWerewolfNightViewer}
                            onChange={(event) => persistWerewolfView(werewolfViewMode, event.target.value)}
                            className={cn('h-8 w-full rounded-md border border-input bg-background px-2 text-xs', werewolfMode && 'border-amber-800/30 bg-stone-950/20')}
                          >
                            <option value="">未绑定，只看公开信息</option>
                            {werewolfViewCandidateNames.map((agentName) => (
                              <option key={agentName} value={agentName}>
                                {agentName}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </div>
                    <div className={cn('inline-flex rounded-md border bg-background p-0.5', werewolfMode && 'border-amber-800/40 bg-stone-950/20')}>
                      <Button
                        type="button"
                        size="sm"
                        variant={werewolfViewMode === 'night' ? 'default' : 'ghost'}
                        className={cn('h-7 px-2 text-xs', werewolfViewMode === 'night' ? werewolfGoldButtonClass : werewolfGhostButtonClass)}
                        onClick={() => persistWerewolfView('night', effectiveWerewolfNightViewer)}
                      >
                        黑夜视角
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={werewolfViewMode === 'god' ? 'default' : 'ghost'}
                        className={cn('h-7 px-2 text-xs', werewolfViewMode === 'god' ? werewolfGoldButtonClass : werewolfGhostButtonClass)}
                        onClick={() => persistWerewolfView('god', effectiveWerewolfNightViewer)}
                      >
                        上帝视角
                      </Button>
                    </div>
                  </div>

                  {isWerewolfConfigured ? (
                    <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 text-xs sm:grid-cols-3', werewolfCardClass)}>
                      <div>
                        <div className="text-[10px] text-muted-foreground">当前环节</div>
                        <div className="mt-1 font-medium">{getWerewolfCurrentActionLabel({
                          state: werewolfState,
                          viewMode: werewolfViewMode,
                          viewer: effectiveWerewolfNightViewer,
                        })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">正在行动</div>
                        <div className="mt-1 truncate font-medium">{getWerewolfCurrentActorLabel({
                          state: werewolfState,
                          viewMode: werewolfViewMode,
                          viewer: effectiveWerewolfNightViewer,
                        })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">存活情况</div>
                        <div className="mt-1 line-clamp-3 leading-5">
                          {getWerewolfSurvivalSummary(werewolfState, werewolfViewMode === 'god' || Boolean(werewolfState?.revealedRoles))}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isWerewolfConfigured ? (
                    <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 text-xs sm:grid-cols-2', werewolfCardClass)}>
                      <div>
                        <div className="text-[10px] text-muted-foreground">警长 / 警徽</div>
                        <div className="mt-1 leading-5">
                          {werewolfState?.badgeDestroyed
                            ? '警徽已撕'
                            : werewolfState?.sheriff
                              ? `${werewolfState.sheriff} 持有警徽`
                              : werewolfState?.sheriffElectionDone
                                ? '本局无警长'
                                : '待上警举手与警长竞选'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground">发言顺序</div>
                        <div className="mt-1 line-clamp-3 leading-5">
                          {werewolfState ? getWerewolfSpeechOrder(werewolfState).join(' -> ') : '未定'}
                        </div>
                      </div>
                      {werewolfViewMode === 'god' && werewolfState?.night ? (
                        <div className="sm:col-span-2">
                          <div className="text-[10px] text-muted-foreground">上帝夜间记录</div>
                          <div className="mt-1 leading-5">
                            N{werewolfState.night.round}：
                            {werewolfState.night.guarded ? ` 守护 ${werewolfState.night.guarded};` : ''}
                            {werewolfState.night.wolfTarget ? ` 狼刀 ${werewolfState.night.wolfTarget};` : ''}
                            {werewolfState.night.saved ? ` 解药 ${werewolfState.night.saved};` : ''}
                            {werewolfState.night.poisoned ? ` 毒药 ${werewolfState.night.poisoned};` : ''}
                            {werewolfState.night.seerTarget ? ` 查验 ${werewolfState.night.seerTarget};` : ''}
                            {werewolfState.night.deaths?.length ? ` 出局 ${werewolfState.night.deaths.join('、')}` : ' 平安夜'}
                          </div>
                        </div>
                      ) : null}
                      {werewolfViewMode === 'night' && effectiveWerewolfNightViewerRole === 'witch' && werewolfState?.night?.wolfTarget ? (
                        <div className="sm:col-span-2">
                          <div className="text-[10px] text-muted-foreground">女巫夜间已知</div>
                          <div className="mt-1 leading-5">
                            今夜被袭击：{werewolfState.night.wolfTarget}
                            {werewolfState.dayNumber === 1 ? '；首夜可以自救。' : '。'}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {!isWerewolfConfigured ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-medium">随机角色</div>
                        <div className="flex items-center gap-2">
                          <div className="text-[10px] text-muted-foreground">
                            将启用 {selectedWerewolfBoard.playerCount} / {listTemporaryWerewolfAgentNames().length}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className={cn('h-7 px-2 text-xs', werewolfGhostButtonClass)}
                            onClick={refreshRandomWerewolfPlayers}
                            disabled={collaborationBusy}
                          >
                            刷新随机
                          </Button>
                        </div>
                      </div>
                      <div className={cn('grid max-h-44 gap-2 overflow-y-auto rounded-xl border bg-muted/10 p-2 sm:grid-cols-2', werewolfCardClass)}>
                        {listTemporaryWerewolfAgentNames().map((agentName) => {
                          const checked = autoWerewolfPlayers.includes(agentName);
                          return (
                            <label key={agentName} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${checked ? 'bg-background' : 'opacity-50'}`}>
                              <Checkbox
                                checked={checked}
                                disabled
                              />
                              <span className="min-w-0 flex-1 truncate">{agentName}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <div className={cn('space-y-3 rounded-xl border bg-muted/10 p-3', werewolfCardClass)}>
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium">高级设置</div>
                        <div className="text-[10px] leading-5 text-muted-foreground">
                          支持默认 engine/model，并为每个临时玩家和 Supervisor 单独覆盖。演练会提前创建 session，成功项会保留。
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className={cn('h-7 px-2 text-xs', werewolfGhostButtonClass)}
                        onClick={() => setWerewolfAdvancedSettingsOpen((prev) => !prev)}
                      >
                        {werewolfAdvancedSettingsOpen ? '收起' : '展开'}
                      </Button>
                    </div>

                    {werewolfAdvancedSettingsOpen ? (
                      <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-muted-foreground">默认引擎</div>
                            <EngineSelect
                              value={werewolfDefaultEngine}
                              onChange={(value) => setWerewolfDefaultRuntime({ engine: value })}
                              className="h-8"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <div className="text-[10px] text-muted-foreground">默认模型</div>
                            <ModelSelect
                              value={werewolfDefaultModel}
                              onChange={(value) => setWerewolfDefaultRuntime({ model: value })}
                              className="h-8"
                              engine={werewolfDefaultEngine}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          {plannedWerewolfAgents.map((agentName) => {
                            const override = werewolfLabConfig?.agentOverrides?.[agentName];
                            const overrideEnabled = override?.enabled === true;
                            const { effectiveEngine, effectiveModel } = resolveWerewolfAgentRuntimeConfig(agentName);
                            const rehearsal = werewolfRehearsalStatus[agentName];
                            const statusLabel = rehearsal?.status === 'ready'
                              ? '已就绪'
                              : rehearsal?.status === 'failed'
                                ? '失败'
                                : rehearsal?.status === 'running'
                                  ? '演练中'
                                  : '未演练';
                            return (
                              <div key={agentName} className="rounded-lg border bg-background/70 p-2.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-xs font-medium">{agentName}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      当前生效：{effectiveEngine || '-'} / {effectiveModel || '-'}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge variant={rehearsal?.status === 'ready' ? 'secondary' : rehearsal?.status === 'failed' ? 'destructive' : 'outline'} className="text-[9px]">
                                      {statusLabel}
                                    </Badge>
                                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                      <Checkbox
                                        checked={overrideEnabled}
                                        onCheckedChange={(checked) => setWerewolfAgentOverrideEnabled(agentName, checked === true)}
                                      />
                                      独立配置
                                    </label>
                                  </div>
                                </div>
                                {overrideEnabled ? (
                                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                    <EngineSelect
                                      value={override?.engine || ''}
                                      onChange={(value) => setWerewolfAgentOverrideRuntime(agentName, { engine: value })}
                                      className="h-8"
                                    />
                                    <ModelSelect
                                      value={override?.model || ''}
                                      onChange={(value) => setWerewolfAgentOverrideRuntime(agentName, { model: value })}
                                      className="h-8"
                                      engine={override?.engine || effectiveEngine}
                                    />
                                  </div>
                                ) : null}
                                {rehearsal?.error ? (
                                  <div className="mt-2 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[10px] leading-5 text-destructive">
                                    {rehearsal.error}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn('h-8 text-xs', werewolfGhostButtonClass)}
                            onClick={() => void runWerewolfRehearsal()}
                            disabled={collaborationBusy || werewolfRehearsing}
                          >
                            {werewolfRehearsing ? '演练中...' : '演练并创建 Session'}
                          </Button>
                          <div className="text-[10px] text-muted-foreground">
                            已就绪 {plannedWerewolfAgents.filter((agentName) => werewolfRehearsalStatus[agentName]?.status === 'ready').length} / {plannedWerewolfAgents.length}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {werewolfState?.players?.length ? (
                    <div className="space-y-2">
                      <div className={cn('rounded-2xl border bg-muted/10 p-3', werewolfSectionClass)}>
                        <div className="mb-2 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>顺时针发言</span>
                          <span>警长位高亮，死亡席位断线显示</span>
                        </div>
                        <div className="relative mx-auto aspect-square max-w-[420px]">
                            {werewolfRoundtableSeats.map((seat, index) => {
                            const total = werewolfRoundtableSeats.length;
                            const angle = (Math.PI * 2 * index) / Math.max(total, 1) - Math.PI / 2;
                            const radius = total <= 6 ? 38 : total <= 9 ? 41 : 43;
                            const x = 50 + radius * Math.cos(angle);
                            const y = 50 + radius * Math.sin(angle);
                            const nextAngle = (Math.PI * 2 * ((index + 0.5) % Math.max(total, 1))) / Math.max(total, 1) - Math.PI / 2;
                            const arrowX = 50 + (radius - 8) * Math.cos(nextAngle);
                            const arrowY = 50 + (radius - 8) * Math.sin(nextAngle);
                            const player = werewolfState.players.find((item) => item.agentName === seat.id);
                            const revealRole = player ? shouldRevealWerewolfRoleForViewer({
                              player,
                              state: werewolfState,
                              viewMode: werewolfViewMode,
                              viewer: effectiveWerewolfNightViewer,
                            }) : false;
                              const roleSpriteStyle = player && revealRole ? getWerewolfRoleSpriteStyle(player.role) : null;
                              const justEliminated = recentlyEliminatedSeatIds.includes(seat.id);
                              return (
                                <div key={seat.id}>
                                  {total > 1 ? (
                                    <div
                                      className="absolute -translate-x-1/2 -translate-y-1/2 text-[11px] text-muted-foreground/70"
                                      style={{ left: `${arrowX}%`, top: `${arrowY}%` }}
                                    >
                                      ↻
                                    </div>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="absolute -translate-x-1/2 -translate-y-1/2"
                                  style={{ left: `${x}%`, top: `${y}%` }}
                                  onClick={() => setSelectedSeatId(seat.id)}
                                >
                                  <div className={`relative flex h-16 w-16 items-center justify-center rounded-full border bg-background transition-all duration-300 hover:scale-105 ${seat.avatarClass} ${seat.ringClass || ''} ${player?.sheriff ? 'ring-2 ring-amber-400/80 shadow-[0_0_0_8px_rgba(251,191,36,0.18)]' : ''} ${seat.active ? 'scale-105' : ''} ${seat.dimmed ? 'opacity-45 grayscale animate-[seatDisconnect_240ms_ease-out_forwards]' : ''} ${justEliminated ? 'animate-[seatFall_1.2s_ease-out]' : ''}`}>
                                    {seat.speaking ? <span className="absolute inset-[-5px] animate-ping rounded-full border border-primary/40" /> : null}
                                    {justEliminated ? <span className="absolute inset-[-6px] rounded-full border border-destructive/50 animate-ping" /> : null}
                                    {seat.seatNumber ? (
                                      <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border bg-background px-1 text-[9px] font-semibold text-muted-foreground shadow-sm">
                                        {seat.seatNumber}
                                      </span>
                                    ) : null}
                                    {player?.sheriff ? (
                                      <span className="absolute -left-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-amber-500/50 bg-amber-500/15 px-1 text-[9px] font-semibold text-amber-700 shadow-sm dark:text-amber-300">
                                        警
                                      </span>
                                    ) : null}
                                    {roleSpriteStyle ? (
                                      <span
                                        className={`h-10 w-8 rounded border border-amber-500/35 bg-cover shadow-sm ${seat.speaking ? 'animate-[spin_6s_linear_infinite]' : ''}`}
                                        style={roleSpriteStyle}
                                        aria-label={player ? formatWerewolfRole(player.role) : seat.name}
                                      />
                                    ) : (
                                      <span className={`text-lg font-semibold ${seat.speaking ? 'animate-[spin_4s_linear_infinite]' : ''}`}>{getWerewolfSpeakerInitial(seat.name)}</span>
                                    )}
                                  </div>
                                  <div className={`mt-1 max-w-[92px] truncate text-center text-[10px] font-medium ${seat.nameClass || 'text-foreground'}`}>{seat.name}</div>
                                </button>
                                </div>
                              );
                            })}
                          <div className={cn('absolute left-1/2 top-1/2 flex h-36 w-36 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border bg-background/95 p-3 text-center shadow-sm', werewolfCardClass)}>
                            {phaseTransitionBanner ? (
                              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/88 animate-[fadeIn_220ms_ease-out]">
                                <div className={cn('rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary shadow-sm', werewolfBadgeClass)}>
                                  {phaseTransitionBanner.label}
                                </div>
                              </div>
                            ) : null}
                            <div className="text-[10px] text-muted-foreground">当前席位</div>
                            <div className={`mt-1 line-clamp-2 text-xs font-semibold ${activeRoundtableSeat?.nameClass || 'text-foreground'}`}>
                              {activeRoundtableSeat?.name || '未选中'}
                            </div>
                            {activeRoundtableSeat?.seatNumber ? (
                              <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                            ) : null}
                            <div className="mt-1 text-[10px] text-muted-foreground">{activeRoundtableSeat?.statusLabel || '待命'}</div>
                            {activeRoundtableSeat?.meta ? (
                              <div className="mt-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[9px] text-muted-foreground">
                                {activeRoundtableSeat.meta}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        {activeRoundtableSeat ? (
                          <div className={cn(`mt-3 rounded-xl border p-3 text-xs ${activeRoundtableSeat.accentClass || 'bg-background'}`, werewolfCardClass)}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className={`font-medium ${activeRoundtableSeat.nameClass || 'text-foreground'}`}>{activeRoundtableSeat.name}</div>
                                {activeRoundtableSeat.seatNumber ? (
                                  <div className="text-[10px] text-muted-foreground">{activeRoundtableSeat.seatNumber} 号位</div>
                                ) : null}
                              </div>
                              <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>{activeRoundtableSeat.statusLabel}</Badge>
                            </div>
                            <div className="mt-1 text-[11px] leading-5 text-muted-foreground">{activeRoundtableSeat.detail}</div>
                            {(() => {
                              const player = werewolfState.players.find((item) => item.agentName === activeRoundtableSeat.id);
                              if (!player) return null;
                              const revealRole = shouldRevealWerewolfRoleForViewer({
                                player,
                                state: werewolfState,
                                viewMode: werewolfViewMode,
                                viewer: effectiveWerewolfNightViewer,
                              });
                              return (
                                <div className="mt-2 text-[10px] text-foreground">
                                  身份：{revealRole ? formatWerewolfRole(player.role) : '隐藏'}
                                  {player.sheriff ? ' · 警长' : ''}
                                  {player.sheriffCandidate ? ' · 上警' : ''}
                                  {player.idiotRevealed ? ' · 白痴已翻牌' : ''}
                                </div>
                              );
                            })()}
                          </div>
                        ) : null}
                      </div>
                      {werewolfState.votes.length > 0 ? (
                        <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                          最近票流：{werewolfState.votes.slice(-6).map((vote) => `${vote.voter}->${vote.target}`).join('；')}
                        </div>
                      ) : null}
                      {werewolfHistoryEntries.length > 0 ? (
                        <div className={cn('space-y-2 rounded-lg border bg-muted/10 p-2.5', werewolfCardClass)}>
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-medium text-foreground">历史对局记忆</div>
                            <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                              {werewolfHistoryEntries.length} 条
                            </Badge>
                          </div>
                          <div className="space-y-1.5">
                            {werewolfHistoryEntries.slice(0, 6).map((entry) => (
                              <div key={entry.id} className={cn('rounded-lg border bg-background/70 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                                <div className="font-medium text-foreground">{entry.boardName} · {entry.result}</div>
                                <div className="mt-0.5">{entry.summary}</div>
                                {entry.lessons?.length ? <div className="mt-1 text-[10px]">经验：{entry.lessons.join('；')}</div> : null}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                        {werewolfState.lastSummary ? (
                        <div className={cn('rounded-lg border bg-muted/20 p-2 text-[10px] leading-5 text-muted-foreground', werewolfCardClass)}>
                          {werewolfState.lastSummary}
                        </div>
                      ) : null}
                      {werewolfState.lastError ? (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-[10px] leading-5 text-destructive">
                          上次推进失败：{werewolfState.lastError}。可点击“{werewolfNextActionLabel}”重试。
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className={cn('rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground', werewolfCardClass)}>
                      {isWerewolfLab
                        ? '请选择板子，系统会随机选择参与人格并分配身份。临时人格不进入业务 Agent 列表。'
                        : '先选择 3 到 6 个 Agent，然后初始化测试局。Supervisor 会作为主持人，不参与玩家列表。'}
                    </div>
                  )}

                  {isWerewolfConfigured ? (
                    <div className={cn('space-y-2 rounded-lg border bg-muted/10 p-3', werewolfCardClass)}>
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium">人工介入</div>
                          <div className="text-[10px] leading-5 text-muted-foreground">
                            当前介入点：{werewolfHumanInterventionLabel}。补充内容会交给 Supervisor 带入下一步。
                          </div>
                        </div>
                        <Badge variant="outline" className={cn('text-[9px]', werewolfBadgeClass)}>
                          {werewolfAutoRunning ? '自动中' : '可暂停'}
                        </Badge>
                      </div>
                      <div className="relative">
                        <Textarea
                          ref={collaborationTextareaRef}
                          value={collaborationDraft}
                          onChange={(event) => setCollaborationDraft(event.target.value)}
                          placeholder="可选：写给 Supervisor 的补充指令，例如指定重点追问、暂停观察或调整发言顺序。"
                          className="min-h-[72px]"
                          disabled={collaborationBusy}
                          onKeyDown={(event) => {
                            if (mentionSuggestions.length > 0) {
                              if (event.key === 'ArrowDown') {
                                event.preventDefault();
                                setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
                                return;
                              }
                              if (event.key === 'ArrowUp') {
                                event.preventDefault();
                                setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                                return;
                              }
                              if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                                event.preventDefault();
                                insertCollaborationMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
                                return;
                              }
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setCollaborationDraft((prev) => `${prev} `);
                              }
                            }
                          }}
                        />
                        {renderMentionSuggestions()}
                      </div>
                    </div>
                  ) : null}

                  <div className={cn('grid gap-2 rounded-lg border bg-muted/10 p-3 sm:grid-cols-[1fr_auto]', werewolfCardClass)}>
                    <div className="space-y-1">
                      <div className="text-xs font-medium">推进节奏</div>
                      <div className="text-[10px] leading-5 text-muted-foreground">
                        自动推进会在每个关键节点停顿，可随时暂停后补充人工指令。
                      </div>
                      <select
                        value={werewolfStepDelay}
                        onChange={(event) => setWerewolfStepDelay(Number(event.target.value))}
                        className={cn('mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-xs', werewolfMode && 'border-amber-800/30 bg-stone-950/20')}
                        disabled={collaborationBusy}
                      >
                        <option value={600}>快速 · 0.6s</option>
                        <option value={1200}>标准 · 1.2s</option>
                        <option value={2400}>慢速 · 2.4s</option>
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={werewolfGhostButtonClass}
                        onClick={handleWerewolfAutoRun}
                        disabled={collaborationBusy || werewolfAutoRunning || werewolfState?.phase === 'ended'}
                      >
                        全流程自动推进
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={werewolfGhostButtonClass}
                        onClick={handleWerewolfPause}
                        disabled={!werewolfAutoRunning && !collaborationBusy}
                      >
                        暂停
                      </Button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <Button
                      type="button"
                      className={werewolfGoldButtonClass}
                      onClick={handleWerewolfSupervisorStep}
                      disabled={collaborationBusy || werewolfAutoRunning || werewolfState?.phase === 'ended' || (!isWerewolfLab && availableCollaborationAgents.length < 3)}
                    >
                      {collaborationBusy ? 'Supervisor 推进中...' : werewolfNextActionLabel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className={werewolfGhostButtonClass}
                      onClick={() => handleWerewolfBoardChange(selectedWerewolfBoard.id)}
                      disabled={collaborationBusy}
                    >
                      重置配置
                    </Button>
                  </div>
                  {!isWerewolfLab ? (
                    <div className="text-[10px] leading-5 text-muted-foreground">
                      圆桌只会由 <span className="font-mono">@agent</span> 或 <span className="font-mono">@全员</span> 触发；没有新的 @ 时，本轮自然结束。
                    </div>
                  ) : null}
                </div>
                ) : null}

                {!isWerewolfLab && collaborationMessages.length > 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-foreground">最近讨论</div>
                      {collaborationRounds.length > 0 ? (
                        <Badge variant="outline" className="text-[10px]">回合 {collaborationRounds.length}</Badge>
                      ) : null}
                    </div>
                  <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
                      {[...collaborationMessages]
                        .filter((message) => !isWerewolfLab || canSeeWerewolfMessage({
                          message,
                          state: werewolfState,
                          viewMode: werewolfViewMode,
                          viewer: effectiveWerewolfNightViewer,
                        }))
                        .slice(-10)
                        .map((message) => {
                        const displayMessage = isWerewolfLab ? prepareWerewolfMessageForChat(message) : message;
                        const werewolfVisual = isWerewolfLab
                          ? getWerewolfSpeakerVisual(message.speakerName, werewolfState?.players)
                          : null;
                        const tone =
                          werewolfVisual
                            ? werewolfVisual.card
                            : message.speakerType === 'human'
                            ? 'border-primary/30 bg-primary/5'
                            : message.speakerType === 'supervisor'
                              ? 'border-amber-500/30 bg-amber-500/5'
                              : message.speakerType === 'system'
                                ? 'border-muted bg-muted/30'
                                : 'border-sky-500/25 bg-sky-500/5';
                        return (
                          <div key={message.id} className={`rounded-xl border p-3 text-xs ${tone}`}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold ${
                                  werewolfVisual
                                    ? werewolfVisual.avatar
                                    : message.speakerType === 'supervisor'
                                      ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                      : message.speakerType === 'system'
                                        ? 'border-muted bg-muted/60 text-muted-foreground'
                                        : 'border-primary/30 bg-primary/10 text-primary'
                                }`}>
                                  {message.speakerType === 'system' ? '系' : getWerewolfSpeakerInitial(message.speakerName)}
                                </span>
                                <div className={`min-w-0 truncate font-medium ${werewolfVisual?.name || 'text-foreground'}`}>
                                  {message.speakerName}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                {isWerewolfLab && message.werewolf?.action ? (
                                  <Badge variant="secondary" className="text-[9px]">
                                    {formatWerewolfActionLabel(message.werewolf.action)}
                                  </Badge>
                                ) : null}
                                <Badge variant={message.status === 'error' ? 'destructive' : 'outline'} className="text-[9px]">
                                  {message.speakerType === 'human' ? '主持' : message.speakerType === 'supervisor' ? '总结' : message.speakerType === 'system' ? '系统' : 'Agent'}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(message.createdAt).toLocaleTimeString()}
                                </span>
                              </div>
                            </div>
                            <div className="mt-2 whitespace-pre-wrap break-words leading-5 text-muted-foreground">
                              {displayMessage.content}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : !isWerewolfLab ? (
                  <div className="rounded-xl border border-dashed p-4 text-xs leading-5 text-muted-foreground">
                    还没有协作记录。可以先写一条主持人消息，用 @agent 或 @全员 指定下一位发言者。
                  </div>
                ) : null}
              </div>

              {shouldShowWorkflowRuntimePanels ? (
              <div className="rounded-2xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">工作流状态</span>
                  <Badge variant="secondary">{workflowStatus?.status || 'idle'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">当前阶段</div>
                    <div className="mt-1 text-sm font-medium">{workflowStatus?.currentPhase || '未开始'}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">当前步骤</div>
                    <div className="mt-1 text-sm font-medium">{workflowStatus?.currentStep || '未开始'}</div>
                  </div>
                </div>
                <details className="rounded-xl border bg-muted/10 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开运行上下文</summary>
                  <div className="mt-3 text-xs text-muted-foreground space-y-1">
                    <div>当前会话：{activeSessionId || '未创建'}</div>
                    <div>运行配置：{boundWorkflow || '尚未通过当前会话启动 workflow'}</div>
                    <div>候选配置：{effectiveWorkflowTarget || '未选择'}</div>
                    <div>指挥官：{boundCommander}</div>
                    {currentCreationSession ? (
                      <div>创建进度：{currentCreationSession.workflowName} / {getCreationSessionStatusLabel(currentCreationSession.status)}</div>
                    ) : null}
                  </div>
                </details>
                {workflowStatus?.specCodingSummary ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行绑定的 Spec Coding 制品</div>
                    <div>版本：v{workflowStatus.specCodingSummary.version}</div>
                    <div>状态：{workflowStatus.specCodingSummary.status}</div>
                    {workflowStatus.specCodingSummary.source ? (
                      <div>来源：{workflowStatus.specCodingSummary.source === 'run' ? 'run snapshot' : 'creation baseline'}</div>
                    ) : null}
                    <div>阶段：{workflowStatus.specCodingSummary.phaseCount}</div>
                    {typeof workflowStatus.specCodingSummary.taskCount === 'number' ? (
                      <div>任务：{workflowStatus.specCodingSummary.taskCount}</div>
                    ) : null}
                    <div>修订：{workflowStatus.specCodingSummary.revisionCount}</div>
                    {workflowStatus.specCodingSummary.progress?.summary ? (
                      <div>进度：{workflowStatus.specCodingSummary.progress.summary}</div>
                    ) : null}
                    {workflowStatus.specCodingSummary.latestRevision?.summary ? (
                      <div>最近修订：{workflowStatus.specCodingSummary.latestRevision.summary}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.latestSupervisorReview?.content ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">最近一次 Supervisor 审阅</div>
                    <div>类型：{formatSupervisorReviewType(workflowStatus.latestSupervisorReview.type)}</div>
                    <div>阶段：{workflowStatus.latestSupervisorReview.stateName}</div>
                    <div className="leading-5">{workflowStatus.latestSupervisorReview.content}</div>
                    {workflowStatus.latestSupervisorReview.affectedArtifacts?.length ? (
                      <div>
                        影响制品：{workflowStatus.latestSupervisorReview.affectedArtifacts.join('、')}
                      </div>
                    ) : null}
                    {workflowStatus.latestSupervisorReview.impact?.length ? (
                      <div className="space-y-1 pt-1">
                        <div className="text-foreground">影响范围</div>
                        {workflowStatus.latestSupervisorReview.impact.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.finalReview ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行结算</div>
                    <div>状态：{workflowStatus.finalReview.status}</div>
                    <div>总评：{workflowStatus.finalReview.summary}</div>
                    {workflowStatus.finalReview.scoreCards?.length ? (
                      <div>评分卡：{workflowStatus.finalReview.scoreCards.length}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.rehearsal?.enabled ? (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">演练模式</div>
                    <div>{workflowStatus.rehearsal.summary}</div>
                    {workflowStatus.rehearsal.recommendedNextSteps?.length ? (
                      <div className="space-y-1 pt-1">
                        {workflowStatus.rehearsal.recommendedNextSteps.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {preflightChecks.length > 0 ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                    <div className="font-medium text-foreground">最近一次启动前检查</div>
                    {persistedPreflight?.configFile ? (
                      <div>目标：{persistedPreflight.configFile}</div>
                    ) : null}
                    {persistedPreflight ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={persistedPreflight.ok ? 'secondary' : 'destructive'}>
                          {persistedPreflight.ok ? '通过' : '未通过'}
                        </Badge>
                        {persistedPreflight.warningCount > 0 ? (
                          <Badge variant="outline">警告 {persistedPreflight.warningCount}</Badge>
                        ) : null}
                        {persistedPreflight.policy?.inferredCommandCount ? (
                          <Badge variant="outline">推断命令 {persistedPreflight.policy.inferredCommandCount}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {persistedPreflight?.checkedAt ? (
                      <div className="text-[11px] text-muted-foreground">
                        检查时间：{new Date(persistedPreflight.checkedAt).toLocaleString()}
                      </div>
                    ) : null}
                    {preflightChecks.slice(0, 4).map((check) => (
                      <div key={check.id} className="rounded-lg border bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>{check.summary}</span>
                          <Badge variant={check.status === 'failed' ? 'destructive' : 'outline'}>
                            {check.category}
                          </Badge>
                        </div>
                        {check.origin === 'inferred' ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">来源：项目默认推断。说明当前 workflow 没显式配置 preflight，系统按项目类型自动补了检查命令。</div>
                        ) : null}
                        <div className="mt-1 truncate text-[11px]" title={check.commands[0]?.command || ''}>
                          {check.commands[0]?.command || ''}
                        </div>
                        {check.commands[0]?.exitCode !== undefined && check.commands[0]?.exitCode !== null ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            退出码：{check.commands[0]?.exitCode}
                          </div>
                        ) : null}
                        {check.status !== 'passed' ? (
                          <details className="mt-2 rounded-md border bg-muted/30 px-2.5 py-2">
                            <summary className="cursor-pointer text-[11px] font-medium text-foreground">
                              查看失败原因与处理建议
                            </summary>
                            <div className="mt-2 space-y-2 text-[11px] text-muted-foreground">
                              {check.commands[0]?.errorText ? (
                                <div>
                                  <div className="font-medium text-foreground">错误摘要</div>
                                  <pre className="mt-1 whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.errorText}</pre>
                                </div>
                              ) : null}
                              {check.commands[0]?.stderr ? (
                                <div>
                                  <div className="font-medium text-foreground">标准错误</div>
                                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.stderr}</pre>
                                </div>
                              ) : null}
                              {check.commands[0]?.stdout ? (
                                <div>
                                  <div className="font-medium text-foreground">标准输出</div>
                                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">{check.commands[0]?.stdout}</pre>
                                </div>
                              ) : null}
                              <div className="rounded bg-amber-500/10 px-2 py-1.5 text-amber-700 dark:text-amber-300">
                                {check.category === 'compile'
                                  ? '先确认当前工作目录能否手动执行这条编译命令；如果是推断出来的命令不适合你的项目，可以在 workflow 里显式配置 preCommands 覆盖它。'
                                  : check.category === 'test'
                                    ? '先手动执行这条测试命令确认失败原因，再决定是否修复环境、依赖或用更准确的预检查命令替换。'
                                    : '先手动执行这条命令确认环境与路径是否正确，再决定是否调整 workflow 的预检查命令。'}
                              </div>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="pt-2 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleStartWorkflow} disabled={startingWorkflow || !effectiveWorkflowTarget}>
                    {startingWorkflow ? '检查并启动中...' : '检查并启动'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，汇报当前会话最新运行 ${boundWorkflow || effectiveWorkflowTarget || '（暂无运行）'} 的进度、风险和下一步建议。`)}
                  >
                    询问
                  </Button>
                </div>
              </div>
              ) : null}

              {shouldShowWorkflowRuntimePanels ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">最近汇报</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，生成一份结构化进度汇报。`)}
                  >
                    立即汇报
                  </Button>
                </div>
                {reports.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                    还没有进度汇报。绑定并启动一个工作流后，指挥官会在这里持续汇报。
                  </div>
                ) : reports.map((report) => (
                  <div key={report.id} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{report.title}</div>
                      <Badge variant={report.tone === 'warning' ? 'destructive' : 'secondary'}>
                        {new Date(report.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground leading-5">{report.content}</p>
                  </div>
                ))}
              </div>
              ) : null}
            </div>
          )}

          {availableTabs.includes('workflow') && activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                {isWorkflowCreationCompleted && effectiveCreationSession ? (
                  <>
                    <h3 className="text-sm font-medium">工作流已创建</h3>
                    <p className="mt-2 text-xs text-muted-foreground leading-5">
                      当前对话已经完成工作流创建。这里保留基础信息和快捷入口，后续编辑直接进入工作流设计页。
                    </p>
                    <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                      <div className="font-medium text-foreground">创建结果</div>
                      <div>工作流：{effectiveCreationSession.workflowName}</div>
                      <div>配置文件：{effectiveCreationSession.filename}</div>
                      <div>状态：{getCreationSessionStatusLabel(effectiveCreationSession.status)}</div>
                      <div>Spec Coding：{effectiveCreationSession.specCodingId}</div>
                    </div>
                    {workflowDraft.workingDirectory ? (
                      <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">工作目录</div>
                        <div className="whitespace-normal break-all">目录：{workflowDraft.workingDirectory}</div>
                        <div>模式：{workflowDraft.workspaceMode === 'isolated-copy' ? '创建副本工程后执行' : '直接在工作目录执行'}</div>
                      </div>
                    ) : null}
                    <div className="mt-4 flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => router.push(`/workbench/${encodeURIComponent(effectiveCreationSession.filename)}?mode=design`)}
                      >
                        打开工作流设计页
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => router.push('/workflows')}>
                        打开工作流页
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-medium">AI 引导创建工作流</h3>
                    <p className="mt-2 text-xs text-muted-foreground leading-5">
                      从首页打开工作流创建面板，关键上下文会挂在当前对话下，方便回到原对话继续查看和恢复。
                    </p>
                    {currentCreationSession ? (
                      <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">当前创建进度</div>
                        <div>工作流：{currentCreationSession.workflowName}</div>
                        <div>配置文件：{currentCreationSession.filename}</div>
                        <div>状态：{getCreationSessionStatusLabel(currentCreationSession.status)}</div>
                        <div>Spec Coding：{currentCreationSession.specCodingId}</div>
                      </div>
                    ) : null}
                    {workflowDraft.workingDirectory ? (
                      <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                        <div className="font-medium text-foreground">当前识别到的工作目录上下文</div>
                        <div className="whitespace-normal break-all">目录：{workflowDraft.workingDirectory}</div>
                        <div>模式：{workflowDraft.workspaceMode === 'isolated-copy' ? '创建副本工程后执行' : '直接在工作目录执行'}</div>
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">工作流名称</label>
                        <Input
                          value={workflowDraft.name}
                          onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, name: e.target.value }))}
                          placeholder="例如：移动端重构流程"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">需求概述</label>
                        <Textarea
                          value={workflowDraft.requirements}
                          onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, requirements: e.target.value }))}
                          placeholder="例如：围绕首页重构、状态机工作流改造、Agent 角色化做一套协作流程"
                          rows={4}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">补充说明</label>
                        <Textarea
                          value={workflowDraft.description}
                          onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, description: e.target.value }))}
                          placeholder="可选：约束、目标目录、验收标准"
                          rows={3}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">参考工作流</label>
                        <SingleCombobox
                          value={workflowDraft.referenceWorkflow || '__none__'}
                          onValueChange={(value) => setWorkflowDraft((prev) => ({ ...prev, referenceWorkflow: value === '__none__' ? '' : value }))}
                          options={[
                            { value: '__none__', label: '不使用参考工作流' },
                            ...workflows.map((workflow) => ({
                              value: workflow.filename,
                              label: `${workflow.name} (${workflow.filename})`,
                            })),
                          ]}
                          placeholder={loading ? '加载中...' : '选择参考工作流'}
                        />
                        <p className="text-xs text-muted-foreground">
                          会沿用参考工作流的结构和 Agent 选用，只更新需求与任务分配。
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs text-muted-foreground">工作目录</label>
                        <Input
                          value={workflowDraft.workingDirectory}
                          onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, workingDirectory: e.target.value }))}
                          placeholder="例如：/workspace/project"
                        />
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button size="sm" onClick={() => setWorkflowModalOpen(true)}>创建工作流</Button>
                      <Button size="sm" variant="outline" onClick={() => router.push('/workflows')}>
                        打开工作流页
                      </Button>
                    </div>
                  </>
                )}
              </div>
              <div className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">当前工作流目标</h3>
                  <Badge variant="outline">{effectiveWorkflowTarget ? '已锁定' : '待选择'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground leading-5">
                  {effectiveWorkflowTarget
                    ? `当前会以 ${effectiveWorkflowTarget} 作为运行目标。`
                    : '当前还没有选中的运行目标，可从下方已有工作流中挑一个，也可以先创建工作流。'}
                </div>
                <details className="rounded-xl border bg-muted/10 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开已有工作流列表</summary>
                  <div className="mt-3 space-y-3">
                    {loading ? (
                      <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">加载中...</div>
                    ) : workflows.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">还没有工作流配置。</div>
                    ) : workflows.map((workflow) => (
                      <Button
                        key={workflow.filename}
                        variant={selectedWorkflow === workflow.filename || boundWorkflow === workflow.filename ? 'default' : 'outline'}
                        className="h-auto w-full justify-start rounded-2xl p-4 text-left"
                        onClick={() => {
                          setSelectedWorkflow(workflow.filename);
                          setInspectedWorkflow(workflow);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{workflow.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{workflow.filename}</div>
                          </div>
                          <Badge variant="outline">{workflow.mode || 'workflow'}</Badge>
                        </div>
                        {workflow.description ? (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{workflow.description}</p>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          {availableTabs.includes('agent') && activeTab === 'agent' && (
            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                <h3 className="text-sm font-medium">AI 引导创建 Agent</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-5">
                  右侧触发正式引导弹框，而不是把创建过程塞进聊天气泡。
                </p>
                {sidebarHint?.agentDraft?.workingDirectory ? (
                  <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">当前识别到的工程上下文</div>
                    <div className="whitespace-normal break-all">目录：{sidebarHint.agentDraft.workingDirectory}</div>
                  </div>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => setAgentModalOpen(true)}>打开 Agent 引导</Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/agents')}>
                    打开 Agent 页
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">当前 Agent 草案焦点</div>
                  <Badge variant="outline">{agentDraft.displayName ? '已识别' : '待补全'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground leading-5">
                  {agentDraft.mission || '优先收敛名称、职责、工作目录和风格，剩余字段由 AI 草案补齐。'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">名称</label>
                  <Input
                    value={agentDraft.displayName}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, displayName: e.target.value }))}
                    placeholder="例如：架构审查官"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">队伍</label>
                  <SingleCombobox
                    value={agentDraft.team}
                    onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, team: value as AgentDraftState['team'] }))}
                    options={[
                      { value: 'blue', label: '蓝队（攻击）' },
                      { value: 'red', label: '红队（防守）' },
                      { value: 'judge', label: '裁定席' },
                    ]}
                    searchable={false}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">职责</label>
                  <Textarea
                    value={agentDraft.mission}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, mission: e.target.value }))}
                    placeholder="例如：负责需求拆解、架构评审和关键风险识别"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">风格</label>
                  <Input
                    value={agentDraft.style}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, style: e.target.value }))}
                    placeholder="例如：冷静、严谨、强势"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">擅长领域</label>
                  <Textarea
                    value={agentDraft.specialties}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, specialties: e.target.value }))}
                    placeholder="例如：架构设计, 评审, 风险识别"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">参考工作流</label>
                  <SingleCombobox
                    value={agentDraft.referenceWorkflow || ''}
                    onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, referenceWorkflow: value || '' }))}
                    options={[
                      { value: '', label: '不指定' },
                      ...workflows.map((workflow) => ({
                        value: workflow.filename,
                        label: workflow.name ? `${workflow.name} (${workflow.filename})` : workflow.filename,
                      })),
                    ]}
                    placeholder="可选：参考已有 workflow 角色分工"
                    searchable
                  />
                </div>
              </div>

              <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{agentDraftPreview?.name || agentDraft.displayName || 'Agent 角色预览'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(agentDraftPreview?.team || agentDraft.team)} · {(agentDraftPreview?.activeEngine || engine || 'follow-global')}
                    </div>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined">smart_toy</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-5">
                  {agentDraftPreview?.description || agentDraft.mission || '填写职责后会在这里显示角色卡预览。'}
                </p>
                {agentDraftPreview?.capabilities?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agentDraftPreview.capabilities.slice(0, 4).map((capability) => (
                      <Badge key={capability} variant="outline">{capability}</Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              {agentDraftPreview ? (
                <div className="rounded-2xl border p-4 space-y-2">
                  <div className="text-sm font-medium">AI 草案预览</div>
                  <div className="text-xs text-muted-foreground break-all">name: {agentDraftPreview.name}</div>
                  <div className="text-xs text-muted-foreground">team: {agentDraftPreview.team}</div>
                  <div className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                    {agentDraftPreview.systemPrompt}
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={handleGenerateAgentDraft} disabled={draftingAgent}>
                  {draftingAgent ? '生成中...' : 'AI生成草案'}
                </Button>
                <Button className="flex-1" onClick={handleCreateAgent} disabled={creatingAgent}>
                  {creatingAgent ? '创建中...' : '保存 Agent 草案'}
                </Button>
              </div>

              {agentDraftRaw ? (
                <details className="rounded-2xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">查看原始草案输出</summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{agentDraftRaw}</pre>
                </details>
              ) : null}
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-background/80 px-3 py-2 flex items-center justify-center">
          <Button
            size="sm"
            variant="ghost"
            className="h-10 w-full gap-2"
            onClick={expanded ? onCollapse : onExpand}
            title={expanded ? '收起首页指挥区' : '展开首页指挥区'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>
              {expanded ? 'right_panel_close' : 'right_panel_open'}
            </span>
            <span className="text-xs">{expanded ? '收起侧边栏' : '展开侧边栏'}</span>
          </Button>
        </div>
      </aside>

      <NewConfigModal
        isOpen={workflowModalOpen}
        onClose={closeWorkflowModal}
        homepageCompact
        resumeCreationSessionId={resumableCreationSession?.creationSessionId || null}
        frontendSessionId={activeSessionId}
        inheritEngine={engine}
        inheritModel={model}
        onSuccess={(filename, result) => {
          const nextCreationSession = result?.creationSession;
          if (nextCreationSession) {
            setCurrentCreationSession({
              creationSessionId: nextCreationSession.id,
              filename: nextCreationSession.filename,
              workflowName: nextCreationSession.workflowName,
              status: nextCreationSession.status,
              specCodingId: nextCreationSession.specCoding.id,
              createdAt: nextCreationSession.createdAt,
              updatedAt: nextCreationSession.updatedAt,
            });
          }
          setSessionWorkbenchState((prev) => ({
            ...(prev || {}),
            homeSidebar: {
              type: 'home_sidebar',
              mode: 'peek',
              activeTab: 'commander',
              intent: 'workflow-run',
              stage: 'review',
              shouldOpenModal: false,
              summary: `工作流 ${filename} 已创建，可直接启动或继续完善。`,
            },
          }));
          setWorkflowModalOpen(false);
          setSelectedWorkflow(filename);
          onTabChange('commander');
          router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
        }}
        initialMode="ai-guided"
        initialWorkflowName={workflowDraft.name}
        initialReferenceWorkflow={workflowDraft.referenceWorkflow}
        initialRequirements={workflowDraft.requirements}
        initialDescription={workflowDraft.description}
        initialWorkingDirectory={workflowDraft.workingDirectory}
        initialWorkspaceMode={workflowDraft.workspaceMode}
      />

      <AIAgentCreatorModal
        open={agentModalOpen}
        engine={engine}
        model={model}
        initialDraft={agentDraft}
        onClose={closeAgentModal}
        onCreate={async (agent) => {
          try {
            await agentApi.saveAgent(agent.name, agent);
            toast('success', `已创建 Agent：${agent.name}`);
            await loadSidebarData();
            return true;
          } catch (error: any) {
            toast('error', error?.message || '创建 Agent 失败');
            return false;
          }
        }}
        onContinueEdit={(agent) => {
          setAgentModalOpen(false);
          router.push('/agents');
          toast('success', `已生成 Agent 草案：${agent.name}，请在 Agent 页面继续精修`);
        }}
      />

      <Sheet open={!!inspectedWorkflow} onOpenChange={(open) => !open && setInspectedWorkflow(null)}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{inspectedWorkflow?.name || '工作流详情'}</SheetTitle>
            <SheetDescription>{inspectedWorkflow?.filename || ''}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm">
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">描述</div>
              <div className="mt-2 leading-6">{inspectedWorkflow?.description || '暂无描述'}</div>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">模式</div>
              <div className="mt-2">{inspectedWorkflow?.mode || 'workflow'}</div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => {
                if (inspectedWorkflow?.filename) setSelectedWorkflow(inspectedWorkflow.filename);
                setInspectedWorkflow(null);
                onTabChange('commander');
              }}>
                设为当前目标
              </Button>
              <Button variant="outline" onClick={() => inspectedWorkflow?.filename && router.push(`/workbench/${encodeURIComponent(inspectedWorkflow.filename)}`)}>
                打开
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      <Sheet open={werewolfRolebookOpen} onOpenChange={setWerewolfRolebookOpen}>
        <SheetContent side="right" className="w-[min(94vw,960px)] overflow-y-auto sm:max-w-[960px]">
          <SheetHeader>
            <SheetTitle>狼人杀角色图鉴</SheetTitle>
            <SheetDescription>
              使用当前卡牌资产展示常见身份。右侧实验局只会按所选板子启用对应角色。
            </SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-6">
            {WEREWOLF_ROLEBOOK_CAMPS.map((camp) => {
              const entries = WEREWOLF_ROLEBOOK_ENTRIES.filter((entry) => entry.camp === camp);
              if (!entries.length) return null;
              return (
                <section key={camp} className="space-y-3">
                  <div className="flex items-center justify-between gap-3 border-b pb-2">
                    <div className="text-sm font-medium">{camp}</div>
                    <Badge variant={camp === '狼人阵营' ? 'destructive' : camp === '第三方' ? 'outline' : 'secondary'} className="text-[10px]">
                      {entries.length} 个角色
                    </Badge>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {entries.map((entry) => {
                      const asset = WEREWOLF_ROLE_ASSETS[entry.key];
                      const spriteStyle = getWerewolfRoleSpriteStyle(entry.key);
                      return (
                        <div key={entry.key} className="grid grid-cols-[82px_1fr] gap-3 rounded-xl border bg-muted/10 p-3">
                          <div
                            className="h-[116px] w-[78px] overflow-hidden rounded-md border bg-muted shadow-sm"
                            aria-label={`${asset.label}卡牌`}
                            role="img"
                            style={spriteStyle || undefined}
                          />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <div className="font-medium leading-5">{asset.label}</div>
                              <Badge variant="outline" className="text-[9px]">
                                {entry.timing}
                              </Badge>
                            </div>
                            <p className="mt-2 text-xs leading-5 text-muted-foreground">
                              {entry.description}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
      {confirmDialogProps ? <ConfirmDialog {...confirmDialogProps} /> : null}
    </>
  );
}
