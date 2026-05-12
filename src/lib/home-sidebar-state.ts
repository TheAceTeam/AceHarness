export type HomeSidebarTab = 'commander' | 'workflow' | 'agent';
export type HomeSidebarMode = 'hidden' | 'peek' | 'active';

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
  createdAt: number;
  cards?: any[];
  status?: 'pending' | 'done' | 'error';
  error?: string | null;
  engine?: string;
  model?: string;
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
  mode?: 'free' | 'roundtable';
  messages: CollaborationRoomMessage[];
  rounds: CollaborationRoomRound[];
  agentSessions?: Record<string, string>;
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
    bindingType: 'workflow-run' | 'roundtable' | 'agent-chat';
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
  if (hint?.activeTab) return hint.activeTab;
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
