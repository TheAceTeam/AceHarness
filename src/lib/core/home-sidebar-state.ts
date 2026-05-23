export const HOME_SIDEBAR_TABS = ['commander', 'workflow', 'agent'] as const;
export type HomeSidebarTab = typeof HOME_SIDEBAR_TABS[number];
export type HomeSidebarMode = 'hidden' | 'peek' | 'active';

export function isHomeSidebarTab(value: unknown): value is HomeSidebarTab {
  return value === 'commander' || value === 'workflow' || value === 'agent';
}

export function normalizeHomeSidebarTab(value: unknown): HomeSidebarTab | null {
  return isHomeSidebarTab(value) ? value : null;
}

export function normalizeHomeSidebarTabs(values: unknown): HomeSidebarTab[] {
  if (!Array.isArray(values)) return [];
  const tabs: HomeSidebarTab[] = [];
  for (const value of values) {
    const tab = normalizeHomeSidebarTab(value);
    if (tab && !tabs.includes(tab)) tabs.push(tab);
  }
  return tabs;
}

export type HomeSidebarIntent =
  | 'general'
  | 'create-workflow'
  | 'create-agent'
  | 'workflow-run'
  | 'workflow-review'
  | 'supervisor-chat';

export type HomeSidebarStage =
  | 'idle'
  | 'clarifying'
  | 'spec-draft'
  | 'spec-review'
  | 'workflow-draft'
  | 'agent-draft'
  | 'preflight'
  | 'running'
  | 'review';

export interface HomeSidebarWorkflowDraft {
  name?: string;
  requirements?: string;
  description?: string;
  referenceWorkflow?: string;
  workingDirectory?: string;
  workspaceMode?: 'isolated-copy' | 'in-place';
}

export interface HomeSidebarAgentDraft {
  displayName?: string;
  team?: string;
  mission?: string;
  style?: string;
  specialties?: string;
  workingDirectory?: string;
}

export interface SessionPreflightCheckSummary {
  id: string;
  category: 'lint' | 'compile' | 'test' | 'custom';
  status: 'passed' | 'failed' | 'warning';
  origin?: 'workflow' | 'inferred';
  summary: string;
  command?: string;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  errorText?: string | null;
}

export interface SessionPreflightSnapshot {
  configFile: string;
  checkedAt: number;
  ok: boolean;
  failedCount: number;
  warningCount: number;
  policy?: {
    blockOnFailure: boolean;
    allowOnWarning: boolean;
    inferredCommandCount: number;
  };
  checks: SessionPreflightCheckSummary[];
}

export interface CollaborationRoomMessage {
  id: string;
  roundId?: string;
  speakerType: 'human' | 'agent' | 'supervisor' | 'system';
  speakerName: string;
  content: string;
  rawContent?: string;
  createdAt: number;
  cards?: any[];
  status?: 'pending' | 'done' | 'error';
  error?: string | null;
  engine?: string;
  model?: string;
  chatroom?: {
    kind?: 'setup' | 'host' | 'agent' | 'system' | 'summary' | 'vote' | 'vote-result' | 'topic-change';
    mode?: CollaborationChatroomMode;
    voteId?: string;
    mentions?: string[];
    participants?: string[];
    summaryTitle?: string;
  };
  werewolf?: {
    phase?: CollaborationWerewolfPhase;
    action?: CollaborationWerewolfAction;
    visibility?: 'public' | 'god' | 'private' | 'werewolves';
    audience?: string[];
    actor?: string;
  };
}

export interface CollaborationRoomRound {
  id: string;
  topic: string;
  participants: string[];
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

export type CollaborationChatroomStatus = 'setup' | 'running' | 'voting' | 'summarizing' | 'ended';
export type CollaborationChatroomMode = 'broadcast' | 'mention-driven' | 'facilitated';

export interface CollaborationChatroomRound {
  id: string;
  title?: string;
  topic: string;
  mode: CollaborationChatroomMode;
  participants: string[];
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  summary?: string;
  messageIds?: string[];
}

export interface CollaborationChatroomVote {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, string>;
  reasons?: Record<string, string>;
  status: 'open' | 'closed';
  allowAbstain?: boolean;
  createdAt: number;
  completedAt?: number;
}

export interface CollaborationChatroomSummary {
  id: string;
  roundId?: string;
  title: string;
  content: string;
  generatedBy?: string;
  createdAt: number;
}

export interface CollaborationChatroomTemporaryAgent {
  id: string;
  name: string;
  personaPrompt: string;
  engine?: string;
  model?: string;
  createdAt: number;
}

export interface CollaborationChatroomParticipant {
  id: string;
  name: string;
  sourceType: 'preset' | 'custom' | 'agent';
  sourceAgent?: string;
  presetId?: string;
  guestConfigId?: string;
  runtimeAgentName?: string;
  personaPrompt?: string;
  systemPrompt?: string;
  useDefaultModel?: boolean;
  engine?: string;
  model?: string;
  openingStatus?: 'pending' | 'done' | 'failed';
  openingError?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface CollaborationAgentExecutionOverride {
  enabled?: boolean;
  engine?: string;
  model?: string;
}

export interface CollaborationChatroomState {
  status: CollaborationChatroomStatus;
  topic: string;
  participants: string[];
  facilitator?: string;
  rounds: CollaborationChatroomRound[];
  activeRoundId?: string;
  activeVote?: CollaborationChatroomVote | null;
  voteHistory: CollaborationChatroomVote[];
  summaries: CollaborationChatroomSummary[];
  settings: {
    responseMode: CollaborationChatroomMode;
    maxTurnsPerRound: number;
    maxRepliesPerAgent: number;
    autoSummarize: boolean;
    defaultEngine?: string;
    defaultModel?: string;
    defaultRuntimeMode?: 'inherit' | 'explicit';
    agentOverrides?: Record<string, CollaborationAgentExecutionOverride>;
    workspacePath?: string;
  };
  participantRoster?: CollaborationChatroomParticipant[];
  temporaryAgents?: CollaborationChatroomTemporaryAgent[];
}

export type CollaborationWerewolfPhase = 'setup' | 'night' | 'last-words' | 'day' | 'voting' | 'ended';
export type CollaborationWerewolfAction =
  | 'setup'
  | 'sheriff-election'
  | 'sheriff-speech'
  | 'sheriff-vote'
  | 'badge-transfer'
  | 'badge-destroy'
  | 'wolf-meeting'
  | 'guard-action'
  | 'seer-check'
  | 'wolf-kill'
  | 'witch-action'
  | 'hunter-shot'
  | 'idiot-reveal'
  | 'last-words'
  | 'day-speech'
  | 'vote'
  | 'settlement'
  | 'system'
  | 'idle';

export interface CollaborationWerewolfPlayer {
  agentName: string;
  role: 'werewolf' | 'seer' | 'witch' | 'hunter' | 'idiot' | 'guard' | 'villager';
  alive: boolean;
  persona: string;
  sheriffCandidate?: boolean;
  sheriff?: boolean;
  badgeDestroyed?: boolean;
  idiotRevealed?: boolean;
}

export interface CollaborationWerewolfVote {
  voter: string;
  target: string;
  reason?: string;
  round: number;
}

export interface CollaborationWerewolfMemoryEntry {
  id: string;
  createdAt: number;
  round: number;
  phase: CollaborationWerewolfPhase;
  action?: CollaborationWerewolfAction;
  title: string;
  summary: string;
  visibility: 'public' | 'god' | 'private' | 'werewolves';
  audience?: string[];
  actor?: string;
}

export interface CollaborationWerewolfState {
  enabled: boolean;
  phase: CollaborationWerewolfPhase;
  dayNumber: number;
  boardId?: string;
  boardName?: string;
  players: CollaborationWerewolfPlayer[];
  eliminated: string[];
  votes: CollaborationWerewolfVote[];
  lastSummary?: string;
  lastError?: string;
  revealedRoles?: boolean;
  currentActor?: string;
  currentAction?: CollaborationWerewolfAction;
  lastNightVictim?: string;
  pendingLastWords?: string[];
  speechOrder?: string[];
  sheriff?: string;
  sheriffCandidates?: string[];
  sheriffElectionDone?: boolean;
  badgeDestroyed?: boolean;
  pendingHunterShot?: string;
  roleState?: {
    witchAntidoteUsed?: boolean;
    witchPoisonUsed?: boolean;
    hunterShotUsed?: boolean;
    guardLastTarget?: string;
    idiotRevealed?: boolean;
  };
  night?: {
    round: number;
    guarded?: string;
    wolfTarget?: string;
    saved?: string;
    poisoned?: string;
    seerTarget?: string;
    deaths?: string[];
  };
  breakpoint?: {
    handler?: 'night' | 'sheriff-election' | 'day-speech' | 'last-words' | 'vote';
    roundId?: string;
    stepLabel?: string;
    resumeFrom?: string;
    failedActor?: string;
    failedAt?: number;
    error?: string;
  };
  memories?: CollaborationWerewolfMemoryEntry[];
}

export interface CollaborationRoomState {
  topic?: string;
  selectedAgents?: string[];
  mode?: 'free' | 'group-chat';
  messages: CollaborationRoomMessage[];
  rounds: CollaborationRoomRound[];
  agentSessions?: Record<string, string>;
  chatroom?: CollaborationChatroomState | null;
  werewolfLabConfig?: {
    defaultEngine?: string;
    defaultModel?: string;
    agentOverrides?: Record<string, {
      enabled?: boolean;
      engine?: string;
      model?: string;
    }>;
    rehearsal?: Record<string, {
      status: 'idle' | 'running' | 'ready' | 'failed';
      sessionId?: string;
      engine?: string;
      model?: string;
      promptVersion?: number;
      error?: string;
      checkedAt?: number;
    }>;
  };
  werewolf?: CollaborationWerewolfState | null;
  werewolfView?: {
    mode: 'god' | 'night';
    viewer?: string;
    viewerRole?: CollaborationWerewolfPlayer['role'];
  };
}

export interface HomeSidebarHint {
  type: 'home_sidebar';
  mode?: HomeSidebarMode;
  tabs?: HomeSidebarTab[];
  activeTab?: HomeSidebarTab;
  intent?: HomeSidebarIntent;
  stage?: HomeSidebarStage;
  reason?: string;
  summary?: string;
  knownFacts?: string[];
  missingFields?: string[];
  questions?: string[];
  recommendedNextAction?: string;
  shouldOpenModal?: boolean;
  workflowDraft?: HomeSidebarWorkflowDraft;
  agentDraft?: HomeSidebarAgentDraft;
}

export interface SessionWorkbenchState {
  homeSidebar?: HomeSidebarHint | null;
  latestPreflight?: SessionPreflightSnapshot | null;
  collaborationRoom?: CollaborationRoomState | null;
  wechatBinding?: {
    integrationId: string;
    integrationName: string;
    bindingId: string;
    accountId?: string;
    externalConversationId: string;
    externalConversationName?: string;
    bindingType: 'workflow-run' | 'agent-chat';
    targetLabel: string;
    webhookPath?: string;
    secret?: string;
    updatedAt: number;
  } | null;
}

export function inferHomeSidebarTab(
  hint?: HomeSidebarHint | null,
  context?: {
    hasWorkflowBinding?: boolean;
    hasCreationSession?: boolean;
  }
): HomeSidebarTab {
  const activeTab = normalizeHomeSidebarTab(hint?.activeTab);
  if (activeTab) return activeTab;
  if (hint?.intent === 'create-agent') return 'agent';
  if (hint?.intent === 'create-workflow' || hint?.intent === 'workflow-review') return 'workflow';
  if (hint?.intent === 'workflow-run' || hint?.intent === 'supervisor-chat') return 'commander';
  if (hint?.agentDraft) return 'agent';
  if (hint?.workflowDraft || context?.hasCreationSession) return 'workflow';
  if (context?.hasWorkflowBinding) return 'commander';
  return 'commander';
}

export function inferHomeSidebarMode(
  hint?: HomeSidebarHint | null,
  context?: {
    hasWorkflowBinding?: boolean;
    hasCreationSession?: boolean;
  }
): HomeSidebarMode {
  if (hint?.mode) return hint.mode;
  if (hint?.intent || hint?.workflowDraft || hint?.agentDraft) return 'active';
  if (context?.hasWorkflowBinding || context?.hasCreationSession) return 'peek';
  return 'hidden';
}

export function isWorkflowSidebarHint(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (hint.intent === 'create-workflow' || hint.intent === 'workflow-run' || hint.intent === 'workflow-review') {
    return true;
  }
  if (hint.activeTab === 'workflow') return true;
  if (normalizeHomeSidebarTabs(hint.tabs).includes('workflow')) return true;
  return Boolean(hint.workflowDraft);
}

export function isCreationSidebarIntent(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (hint.intent === 'create-workflow' || hint.intent === 'create-agent') return true;
  if (hint.activeTab === 'workflow' && hint.workflowDraft) return true;
  if (hint.activeTab === 'agent' && hint.agentDraft) return true;
  return false;
}

export function shouldSuppressCardsForSidebarHint(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (isCreationSidebarIntent(hint)) return true;
  return hint.shouldOpenModal === true;
}
