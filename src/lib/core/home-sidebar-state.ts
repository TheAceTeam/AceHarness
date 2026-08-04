export const HOME_SIDEBAR_TABS = ['commander', 'agent'] as const;
export type HomeSidebarTab = typeof HOME_SIDEBAR_TABS[number];
export type HomeSidebarMode = 'hidden' | 'peek' | 'active';

export function isHomeSidebarTab(value: unknown): value is HomeSidebarTab {
  return value === 'commander' || value === 'agent';
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
  | 'create-agent'
  | 'workflow-run'
  | 'supervisor-chat';

export type HomeSidebarStage =
  | 'idle'
  | 'clarifying'
  | 'agent-draft'
  | 'preflight'
  | 'running'
  | 'review';

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

export interface CollaborationRoomState {
  roomId?: string;
  spaceType?: 'meeting-room' | 'office';
  roomType?: 'direct' | 'meeting';
  topic?: string;
  selectedAgents?: string[];
  mode?: 'free' | 'group-chat';
  messages: CollaborationRoomMessage[];
  rounds: CollaborationRoomRound[];
  agentSessions?: Record<string, string>;
  chatroom?: CollaborationChatroomState | null;
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
  agentDraft?: HomeSidebarAgentDraft;
}

export function normalizeHomeSidebarHint(value: unknown): HomeSidebarHint | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (source.type !== undefined && source.type !== 'home_sidebar') return null;
  if (source.kind !== undefined && source.kind !== 'home_sidebar') return null;
  if (source.workflowDraft !== undefined) return null;

  const mode = source.mode;
  if (mode !== undefined && mode !== 'hidden' && mode !== 'peek' && mode !== 'active') return null;

  const rawTabs = source.tabs;
  if (rawTabs !== undefined && (!Array.isArray(rawTabs) || rawTabs.some((tab) => !isHomeSidebarTab(tab)))) return null;
  const activeTab = source.activeTab;
  if (activeTab !== undefined && !isHomeSidebarTab(activeTab)) return null;

  const intent = source.intent;
  if (intent !== undefined && !['general', 'create-agent', 'workflow-run', 'supervisor-chat'].includes(String(intent))) return null;
  const stage = source.stage;
  if (stage !== undefined && !['idle', 'clarifying', 'agent-draft', 'preflight', 'running', 'review'].includes(String(stage))) return null;

  const stringFields = ['reason', 'summary', 'recommendedNextAction'] as const;
  if (stringFields.some((field) => source[field] !== undefined && typeof source[field] !== 'string')) return null;

  const listFields = ['knownFacts', 'missingFields', 'questions'] as const;
  if (listFields.some((field) => source[field] !== undefined && (!Array.isArray(source[field]) || source[field].some((item) => typeof item !== 'string')))) return null;

  if (source.shouldOpenModal !== undefined && typeof source.shouldOpenModal !== 'boolean') return null;

  const rawAgentDraft = source.agentDraft;
  if (rawAgentDraft !== undefined) {
    if (!rawAgentDraft || typeof rawAgentDraft !== 'object') return null;
    const draft = rawAgentDraft as Record<string, unknown>;
    const draftFields = ['displayName', 'team', 'mission', 'style', 'specialties', 'workingDirectory'];
    if (draftFields.some((field) => draft[field] !== undefined && typeof draft[field] !== 'string')) return null;
  }

  return {
    type: 'home_sidebar',
    ...(mode ? { mode: mode as HomeSidebarMode } : {}),
    ...(rawTabs ? { tabs: rawTabs as HomeSidebarTab[] } : {}),
    ...(activeTab ? { activeTab: activeTab as HomeSidebarTab } : {}),
    ...(intent ? { intent: intent as HomeSidebarIntent } : {}),
    ...(stage ? { stage: stage as HomeSidebarStage } : {}),
    ...(typeof source.reason === 'string' ? { reason: source.reason } : {}),
    ...(typeof source.summary === 'string' ? { summary: source.summary } : {}),
    ...(Array.isArray(source.knownFacts) ? { knownFacts: source.knownFacts as string[] } : {}),
    ...(Array.isArray(source.missingFields) ? { missingFields: source.missingFields as string[] } : {}),
    ...(Array.isArray(source.questions) ? { questions: source.questions as string[] } : {}),
    ...(typeof source.recommendedNextAction === 'string' ? { recommendedNextAction: source.recommendedNextAction } : {}),
    ...(typeof source.shouldOpenModal === 'boolean' ? { shouldOpenModal: source.shouldOpenModal } : {}),
    ...(rawAgentDraft ? { agentDraft: rawAgentDraft as HomeSidebarAgentDraft } : {}),
  };
}

export interface SessionWorkbenchState {
  conversationMode?: 'plain' | 'agent-chat' | 'workflow-running' | 'workflow-completed';
  creationAssistantEnabled?: boolean;
  creationTag?: boolean;
  homeSidebar?: HomeSidebarHint | null;
  rightRail?: {
    collapsed?: boolean;
    activePluginId?: string;
    pinned?: boolean;
    updatedAt?: number;
  } | null;
  embeddedWorkflow?: {
    runId?: string;
    configFile?: string;
    collapsed?: boolean;
    activePanel?: 'status' | 'questions' | 'events' | 'changes';
  } | null;
  latestPreflight?: SessionPreflightSnapshot | null;
  chatWorkspace?: {
    workingDirectory: string;
    sourceWorkspace?: string;
    autoCreated?: boolean;
    gitBaselineReady?: boolean;
    updatedAt: number;
  } | null;
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

export interface CreationAssistantSessionLike {
  workflowBinding?: unknown;
  agentBinding?: unknown;
  sessionWorkbenchState?: SessionWorkbenchState | null;
}

export const CREATION_ASSISTANT_DEFAULT_STORAGE_KEY = 'aceharness:chat:creation-assistant-default';

export function readStoredCreationAssistantEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(CREATION_ASSISTANT_DEFAULT_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeStoredCreationAssistantEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CREATION_ASSISTANT_DEFAULT_STORAGE_KEY, enabled ? 'true' : 'false');
  } catch {}
}

export function resolveCreationAssistantEnabled(
  session?: CreationAssistantSessionLike | null
): boolean {
  if (
    session?.workflowBinding
    || session?.agentBinding
    || session?.sessionWorkbenchState?.collaborationRoom
  ) {
    return false;
  }

  return session?.sessionWorkbenchState?.creationAssistantEnabled !== false;
}

export function isCreationAssistantSidebarHint(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (hint.intent === 'create-agent') return true;
  if (hint.agentDraft) return true;
  return Boolean(
    hint.shouldOpenModal
    && (
      hint.activeTab === 'agent'
      || hint.tabs?.includes('agent')
    )
  );
}

export function inferHomeSidebarTab(
  hint?: HomeSidebarHint | null,
  context?: {
    hasWorkflowBinding?: boolean;
  }
): HomeSidebarTab {
  const activeTab = normalizeHomeSidebarTab(hint?.activeTab);
  if (activeTab) return activeTab;
  if (hint?.intent === 'create-agent') return 'agent';
  if (hint?.intent === 'workflow-run' || hint?.intent === 'supervisor-chat') return 'commander';
  if (hint?.agentDraft) return 'agent';
  if (context?.hasWorkflowBinding) return 'commander';
  return 'commander';
}

export function inferHomeSidebarMode(
  hint?: HomeSidebarHint | null,
  context?: {
    hasWorkflowBinding?: boolean;
  }
): HomeSidebarMode {
  if (hint?.mode) return hint.mode;
  if (hint?.intent || hint?.agentDraft) return 'active';
  if (context?.hasWorkflowBinding) return 'peek';
  return 'hidden';
}

export function isWorkflowSidebarHint(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  return hint.intent === 'workflow-run' || hint.intent === 'supervisor-chat';
}

export function isCreationSidebarIntent(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (hint.intent === 'create-agent') return true;
  if (hint.activeTab === 'agent' && hint.agentDraft) return true;
  return false;
}

export function shouldSuppressCardsForSidebarHint(hint?: HomeSidebarHint | null): boolean {
  if (!hint) return false;
  if (isCreationSidebarIntent(hint)) return true;
  return hint.shouldOpenModal === true;
}
