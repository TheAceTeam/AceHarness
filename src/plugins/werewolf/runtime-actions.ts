import type {
  CollaborationRoomMessage,
  CollaborationRoomState,
  CollaborationWerewolfPlayer,
  CollaborationWerewolfState,
  CollaborationWerewolfVote,
} from '@/lib/core/home-sidebar-state';
import type { WerewolfLabBoard } from '@/plugins/werewolf/agents';
import {
  applyWerewolfDeaths,
  buildWerewolfBreakpoint,
  buildWerewolfTallyChartCard,
  buildWerewolfTallySummary,
  buildWerewolfVoteLines,
  createCollaborationMessage,
  createWerewolfMemoryEntry,
  createWerewolfState,
  extractWerewolfStructuredResult,
  fetchWerewolfHistory,
  formatWerewolfRoster,
  getAliveWerewolfPlayers,
  getWerewolfPlayer,
  getWerewolfRoleState,
  getWerewolfSpeechOrder,
  getWerewolfWinner,
  isWerewolfGuardResult,
  isWerewolfHunterResult,
  isWerewolfSeerResult,
  isWerewolfVoteResult,
  isWerewolfWitchResult,
  pickWerewolfTarget,
  resolveWerewolfBadgeAfterDeaths,
  resolveWerewolfExplosion,
  resolveWerewolfHunterShot,
  saveWerewolfHistory,
  parseWerewolfSheriffWithdrawal,
  type WerewolfHistoryEntry,
} from '@/plugins/werewolf/runtime-core';

type WerewolfToastLevel = 'success' | 'warning' | 'error' | 'info';

type WerewolfToast = (level: WerewolfToastLevel, message: string) => void;

type WerewolfPromptKind = 'speech' | 'vote' | 'host-summary' | 'sheriff-speech' | 'wolf-vote' | 'sheriff-vote';

type BuildWerewolfPrompt = (agentName: string, input: {
  kind: WerewolfPromptKind;
  state: CollaborationWerewolfState;
  hostMessage?: string;
  transcript?: CollaborationRoomMessage[];
}) => string;

type CallCollaborationAgent = (
  agentName: string,
  message: string,
  roundId?: string,
  messagePatch?: Pick<CollaborationRoomMessage, 'werewolf' | 'chatroom'>
) => Promise<string>;

type UpdateCollaborationRoom = (updater: (room: CollaborationRoomState) => CollaborationRoomState) => void;

type AppendCollaborationMessageToChat = (message: CollaborationRoomMessage, state?: CollaborationWerewolfState | null) => void;
type AppendCollaborationMessagesToChat = (messages: CollaborationRoomMessage[], state?: CollaborationWerewolfState | null) => void;
type AppendCollaborationPendingMessage = (content: string, actionLabel?: string) => void;

type CommonActionContext = {
  werewolfState: CollaborationWerewolfState | null;
  collaborationDraft: string;
  collaborationMessages: CollaborationRoomMessage[];
  effectiveCollaborationSupervisor: string;
  toast: WerewolfToast;
  updateCollaborationRoom: UpdateCollaborationRoom;
  appendCollaborationMessageToChat: AppendCollaborationMessageToChat;
  appendCollaborationMessagesToChat: AppendCollaborationMessagesToChat;
  appendCollaborationPendingMessage: AppendCollaborationPendingMessage;
  setCollaborationBusy: (busy: boolean) => void;
  setCollaborationDraft: (value: string) => void;
  callCollaborationAgent: CallCollaborationAgent;
  buildWerewolfPrompt: BuildWerewolfPrompt;
};

export function runWerewolfSetup(context: {
  availableCollaborationAgents: string[];
  autoWerewolfPlayers: string[];
  collaborationTopic: string;
  effectiveCollaborationSupervisor: string;
  isWerewolfLab: boolean;
  selectedCollaborationAgentList: string[];
  selectedWerewolfBoard: WerewolfLabBoard;
  toast: WerewolfToast;
  appendCollaborationMessageToChat: AppendCollaborationMessageToChat;
  updateCollaborationRoom: UpdateCollaborationRoom;
  setSelectedCollaborationAgents: (value: Set<string>) => void;
  setCollaborationTopic: (value: string) => void;
  setWerewolfViewMode: (value: 'god' | 'night') => void;
}) {
  const {
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
    setSelectedCollaborationAgents,
    setCollaborationTopic,
    setWerewolfViewMode,
  } = context;

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
      '系统事件 🎲：本局已完成配置。',
      `板子：${board.name}（${board.description}）`,
      `胜利规则：${board.winRuleLabel}`,
      `系统事件：${supervisor}`,
      '玩家：',
      formatWerewolfRoster(nextState, false),
      '',
      '系统事件 🎙️：请确认开局。后续会按上警、黑夜、遗言、白天发言、放逐投票的顺序推进；女巫首夜可以自救。',
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
    mode: 'group-chat',
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
}

export async function runWerewolfSheriffElection(context: CommonActionContext): Promise<void> {
  const {
    werewolfState,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    appendCollaborationMessageToChat,
    appendCollaborationMessagesToChat,
    appendCollaborationPendingMessage,
    setCollaborationBusy,
    setCollaborationDraft,
    callCollaborationAgent,
    buildWerewolfPrompt,
  } = context;

  if (!werewolfState?.players?.length) return;
  const alivePlayers = getAliveWerewolfPlayers(werewolfState).filter((player) => !player.idiotRevealed);
  const wolves = alivePlayers.filter((p) => p.role === 'werewolf');
  const seers = alivePlayers.filter((p) => p.role === 'seer');
  const others = alivePlayers.filter((p) => !['werewolf', 'seer', 'idiot'].includes(p.role));
  const pool: typeof alivePlayers = [];
  const shuffledWolves = [...wolves].sort(() => Math.random() - 0.5);
  pool.push(...shuffledWolves.slice(0, Math.min(Math.random() < 0.5 ? 1 : 2, shuffledWolves.length)));
  if (seers.length && Math.random() < 0.75) pool.push(seers[0]);
  const shuffledOthers = [...others].sort(() => Math.random() - 0.5);
  const remaining = Math.min(4, alivePlayers.length) - pool.length;
  pool.push(...shuffledOthers.slice(0, Math.max(0, remaining)));
  const candidates = pool.sort(() => Math.random() - 0.5).slice(0, Math.min(4, alivePlayers.length));
  const roundId = `ww-sheriff-${werewolfState.dayNumber}-${Date.now()}`;
  const hostMessage = collaborationDraft.trim() || '警长竞选：先上警举手，再按顺序做上警发言。每名上警玩家只发言一轮，最后一名上警玩家负责归票，提醒场上如何投警长票。';
  const openingMessage = createCollaborationMessage({
    roundId,
    speakerType: 'supervisor',
    speakerName: effectiveCollaborationSupervisor,
    content: `系统事件 🎙️：现在开始警长竞选。\n${hostMessage}`,
    status: 'done',
    werewolf: { phase: 'day', action: 'sheriff-election', visibility: 'public', actor: effectiveCollaborationSupervisor },
  });
  const handsMessage = createCollaborationMessage({
    roundId,
    speakerType: 'supervisor',
    speakerName: effectiveCollaborationSupervisor,
    content: candidates.length
      ? `系统事件 📣：上警举手结束。${candidates.map((player) => player.agentName).join('、')} 选择上警，共 ${candidates.length} 人上警。`
      : '系统事件 📣：本轮无人上警。',
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
      `系统事件正在组织第 ${werewolfState.dayNumber} 天警长竞选，请稍候。`,
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
        '系统事件 📋：上警发言结束。',
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
      const sheriffVoters = alivePlayers.filter((player) => !finalCandidates.some((candidate) => candidate.agentName === player.agentName));
      const voteStartMessage = createCollaborationMessage({
        roundId,
        speakerType: 'supervisor',
        speakerName: effectiveCollaborationSupervisor,
        content: `系统事件 🗳️：现在开始警长投票。留警上的玩家有 ${finalCandidates.map((player) => player.agentName).join('、')}。本轮仅警下玩家可以投票：${sheriffVoters.map((player) => player.agentName).join('、') || '无人'}。`,
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

      for (const voter of sheriffVoters) {
        const output = await callCollaborationAgent(voter.agentName, buildWerewolfPrompt(voter.agentName, {
          kind: 'sheriff-vote',
          state: {
            ...werewolfState,
            phase: 'day',
            currentAction: 'sheriff-vote',
            sheriffCandidates: finalCandidates.map((player) => player.agentName),
          },
          hostMessage: `当前进行警长投票。你是警下玩家，仅能从 ${finalCandidates.map((player) => player.agentName).join('、')} 中投一人。上警玩家本轮不能投票。`,
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
          : null;
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
          ? `系统事件 ⚖️：${topCandidates.join('、')} 平票，暂未产生警长。`
          : sheriff
            ? `系统事件 👑：${sheriff.agentName} 获得警徽。`
            : '系统事件 👑：本轮没有产生警长。',
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
    const errorText = error?.message || '未知错误';
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: room.werewolf ? {
        ...room.werewolf,
        lastError: errorText,
        breakpoint: buildWerewolfBreakpoint({
          handler: 'sheriff-election',
          roundId,
          stepLabel: `第 ${werewolfState.dayNumber} 天警长竞选`,
          resumeFrom: 'sheriff-speech',
          failedActor: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
          error: errorText,
        }),
      } : room.werewolf,
      messages: [
        ...(room.messages || []),
        createCollaborationMessage({
          roundId,
          speakerType: 'system',
          speakerName: '系统',
          content: `警长竞选中断：${errorText}\n可点击重试继续竞选。`,
          status: 'error',
          error: errorText,
        }),
      ],
    }));
    toast('error', `${errorText}，可重试警长竞选`);
  } finally {
    setCollaborationBusy(false);
  }
}

export async function runWerewolfSpeechRound(context: CommonActionContext): Promise<void> {
  const {
    werewolfState,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    appendCollaborationMessageToChat,
    appendCollaborationPendingMessage,
    setCollaborationBusy,
    setCollaborationDraft,
    callCollaborationAgent,
    buildWerewolfPrompt,
  } = context;

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
      `系统事件 ☀️：现在进入第 ${werewolfState.dayNumber} 天白天发言。`,
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
      `系统事件正在组织第 ${werewolfState.dayNumber} 天白天发言，请稍候。`,
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
    const errorText = error?.message || '未知错误';
    updateCollaborationRoom((room) => ({
      ...room,
      rounds: (room.rounds || []).map((round) => round.id === roundId
        ? { ...round, status: 'failed', completedAt: Date.now(), summary: errorText }
        : round),
      messages: [
        ...(room.messages || []),
        createCollaborationMessage({
          roundId,
          speakerType: 'system',
          speakerName: '系统',
          content: `发言轮中断：${errorText}\n可点击重试继续发言。`,
          status: 'error',
          error: errorText,
        }),
      ],
      werewolf: room.werewolf ? {
        ...room.werewolf,
        lastError: errorText,
        breakpoint: buildWerewolfBreakpoint({
          handler: 'day-speech',
          roundId,
          stepLabel: `第 ${werewolfState.dayNumber} 天发言`,
          resumeFrom: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
          failedActor: room.werewolf?.currentActor || effectiveCollaborationSupervisor,
          error: errorText,
        }),
      } : room.werewolf,
    }));
    toast('error', `${errorText}，可重试发言轮`);
  } finally {
    setCollaborationBusy(false);
  }
}

export async function runWerewolfNightRound(context: CommonActionContext & {
  selectedWerewolfBoard: WerewolfLabBoard;
  setWerewolfHistoryEntries: (entries: WerewolfHistoryEntry[]) => void;
}): Promise<void> {
  const {
    werewolfState,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    appendCollaborationMessageToChat,
    appendCollaborationMessagesToChat,
    appendCollaborationPendingMessage,
    setCollaborationBusy,
    setCollaborationDraft,
    callCollaborationAgent,
    buildWerewolfPrompt,
    selectedWerewolfBoard,
    setWerewolfHistoryEntries,
  } = context;

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
  const breakpoint = werewolfState.breakpoint;
  const isResume = breakpoint?.handler === 'night';
  const roundId = isResume && breakpoint?.roundId ? breakpoint.roundId : `ww-night-${werewolfState.dayNumber}-${Date.now()}`;
  const hostMessage = collaborationDraft.trim() || `第 ${werewolfState.dayNumber} 夜行动：狼人先进行内部会议，先商量第二天怎么演、怎么站边、刀口怎么服务白天格局，需要时再决定谁悍跳或带节奏；随后守卫守护，狼人落刀，女巫决定是否用药，预言家查验。女巫首夜可以自救。`;
  const wolfCandidates = alivePlayers;
  const nightStepOrder = ['wolf-meeting', 'guard-action', 'wolf-kill', 'witch-action', 'seer-check'] as const;
  const resumeFrom = isResume ? (breakpoint?.resumeFrom || 'wolf-meeting') : 'wolf-meeting';
  const startStepIndex = Math.max(0, nightStepOrder.indexOf(resumeFrom as any));
  let wolfTarget: CollaborationWerewolfPlayer | undefined = isResume && werewolfState.night?.wolfTarget
    ? alivePlayers.find((p) => p.agentName === werewolfState.night?.wolfTarget) : undefined;
  let guarded: string | undefined = isResume ? werewolfState.night?.guarded : undefined;
  let saved: string | undefined = isResume ? werewolfState.night?.saved : undefined;
  let poisoned: string | undefined = isResume ? werewolfState.night?.poisoned : undefined;
  let seerTarget: CollaborationWerewolfPlayer | undefined = isResume && werewolfState.night?.seerTarget
    ? alivePlayers.find((p) => p.agentName === werewolfState.night?.seerTarget) : undefined;
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
  if (!isResume) {
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: { ...(room.werewolf || werewolfState), phase: 'night', currentAction: 'wolf-meeting', currentActor: effectiveCollaborationSupervisor, lastError: undefined, breakpoint: undefined },
      messages: [...(room.messages || []), openingMessage],
    }));
    appendCollaborationMessageToChat(openingMessage, werewolfState);
  } else {
    updateCollaborationRoom((room) => ({
      ...room,
      werewolf: { ...(room.werewolf || werewolfState), phase: 'night', currentAction: resumeFrom as any, currentActor: effectiveCollaborationSupervisor, lastError: undefined, breakpoint: undefined },
    }));
  }
  setCollaborationDraft('');

  try {
    setCollaborationBusy(true);
    appendCollaborationPendingMessage(
      `系统事件正在推进第 ${werewolfState.dayNumber} 夜，请稍候。`,
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
      content: '系统事件 🌙：天黑请闭眼。',
      status: 'done',
      werewolf: { phase: 'night', action: 'system', visibility: 'public', actor: effectiveCollaborationSupervisor },
    }));

    if (startStepIndex <= nightStepOrder.indexOf('wolf-meeting')) {
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, currentAction: 'wolf-meeting', currentActor: wolves[0]?.agentName || effectiveCollaborationSupervisor } : room.werewolf,
      }));
      if (wolves.length) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: '系统事件 🐺：狼队请睁眼。',
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
    }

    if (startStepIndex <= nightStepOrder.indexOf('wolf-kill')) {
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, currentAction: 'wolf-kill', currentActor: wolves[0]?.agentName || effectiveCollaborationSupervisor } : room.werewolf,
      }));
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
          : null;
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
          content: '系统事件 🌙：狼队请闭眼。',
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
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, night: { ...(room.werewolf.night || { round: werewolfState.dayNumber }), wolfTarget: wolfTarget?.agentName } } : room.werewolf,
      }));
    }

    if (startStepIndex <= nightStepOrder.indexOf('guard-action')) {
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, currentAction: 'guard-action', currentActor: guard?.agentName || effectiveCollaborationSupervisor } : room.werewolf,
      }));
      if (guard) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: '系统事件 🛡️：守卫请睁眼。',
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
          content: '系统事件 🌙：守卫请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'guard-action', visibility: 'private', audience: [guard.agentName], actor: guard.agentName },
        }));
      }
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, night: { ...(room.werewolf.night || { round: werewolfState.dayNumber }), guarded } } : room.werewolf,
      }));
    }

    if (startStepIndex <= nightStepOrder.indexOf('witch-action')) {
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, currentAction: 'witch-action', currentActor: witch?.agentName || effectiveCollaborationSupervisor } : room.werewolf,
      }));
      if (witch && wolfTarget) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: '系统事件 🧪：女巫请睁眼。',
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
            '提醒：不要机械首夜开药。若暂时无法判断刀口是否为高价值神职，通常优先保留解药，留给后续可能吃刀的预言家或关键信息位。',
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
          content: '系统事件 🌙：女巫请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'witch-action', visibility: 'private', audience: [witch.agentName], actor: witch.agentName },
        }));
      }
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, night: { ...(room.werewolf.night || { round: werewolfState.dayNumber }), saved, poisoned } } : room.werewolf,
      }));
    }

    if (startStepIndex <= nightStepOrder.indexOf('seer-check')) {
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, currentAction: 'seer-check', currentActor: seer?.agentName || effectiveCollaborationSupervisor } : room.werewolf,
      }));
      if (seer) {
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: '系统事件 🔮：预言家请睁眼。',
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
        if (seerTarget) {
          pushNightStageMessage(createCollaborationMessage({
            roundId,
            speakerType: 'supervisor',
            speakerName: effectiveCollaborationSupervisor,
            content: `系统事件 🔍：${seerTarget.agentName} 的查验结果为${seerTarget.role === 'werewolf' ? '狼人' : '好人'}。`,
            status: 'done',
            werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
          }));
        }
        pushNightStageMessage(createCollaborationMessage({
          roundId,
          speakerType: 'supervisor',
          speakerName: effectiveCollaborationSupervisor,
          content: '系统事件 🌙：预言家请闭眼。',
          status: 'done',
          werewolf: { phase: 'night', action: 'seer-check', visibility: 'private', audience: [seer.agentName], actor: seer.agentName },
        }));
      }
      updateCollaborationRoom((room) => ({
        ...room,
        werewolf: room.werewolf ? { ...room.werewolf, night: { ...(room.werewolf.night || { round: werewolfState.dayNumber }), seerTarget: seerTarget?.agentName } } : room.werewolf,
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
        content: `全局记录 📝：女巫毒药目标 ${poisoned}。`,
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
}

export async function runWerewolfLastWordsRound(context: CommonActionContext): Promise<void> {
  const {
    werewolfState,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    appendCollaborationMessageToChat,
    setCollaborationBusy,
    callCollaborationAgent,
    buildWerewolfPrompt,
  } = context;

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
        `系统事件 🎯：${werewolfState.pendingHunterShot} 出局，进入猎人技能结算。`,
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
    ? `系统事件 🕯️：${targets.join('、')} 请依次留下遗言。遗言结束后${cameFromNight ? '进入白天发言' : '进入下一夜'}。`
    : `系统事件 🕯️：本轮没有待处理遗言，${cameFromNight ? '直接进入白天发言' : '直接进入下一夜'}。`;
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
          hostMessage: '你已经出局，现在是遗言环节。请用一轮发言留下你的判断、站边和对场上玩家的最后提醒。',
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
      ? `系统事件 📣：遗言结束。${cameFromNight ? `现在进入第 ${nextDayNumber} 天白天发言。` : `现在进入第 ${nextDayNumber} 夜。`}`
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
}

export async function runWerewolfVoteRound(context: CommonActionContext & {
  selectedWerewolfBoard: WerewolfLabBoard;
  setWerewolfHistoryEntries: (entries: WerewolfHistoryEntry[]) => void;
}): Promise<void> {
  const {
    werewolfState,
    collaborationDraft,
    collaborationMessages,
    effectiveCollaborationSupervisor,
    toast,
    updateCollaborationRoom,
    appendCollaborationMessageToChat,
    appendCollaborationPendingMessage,
    setCollaborationBusy,
    setCollaborationDraft,
    callCollaborationAgent,
    buildWerewolfPrompt,
    selectedWerewolfBoard,
    setWerewolfHistoryEntries,
  } = context;

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
      `系统事件 🗳️：现在开始第 ${werewolfState.dayNumber} 天放逐投票。`,
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
      `系统事件正在组织第 ${werewolfState.dayNumber} 天投票结算，请稍候。`,
      '投票结算',
    );
    const transcript: CollaborationRoomMessage[] = [
      ...collaborationMessages,
      voteHostMessage,
    ];
    const votes: CollaborationWerewolfVote[] = [];
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
        : null;
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
}

export async function runWerewolfSupervisorStep(context: {
  werewolfState: CollaborationWerewolfState | null;
  handleSetupWerewolf: () => void;
  handleWerewolfNightRound: () => Promise<void>;
  handleWerewolfSheriffElection: () => Promise<void>;
  handleWerewolfSpeechRound: () => Promise<void>;
  handleWerewolfLastWordsRound: () => Promise<void>;
  handleWerewolfVoteRound: () => Promise<void>;
  toast: WerewolfToast;
}): Promise<void> {
  const {
    werewolfState,
    handleSetupWerewolf,
    handleWerewolfNightRound,
    handleWerewolfSheriffElection,
    handleWerewolfSpeechRound,
    handleWerewolfLastWordsRound,
    handleWerewolfVoteRound,
    toast,
  } = context;

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
}
