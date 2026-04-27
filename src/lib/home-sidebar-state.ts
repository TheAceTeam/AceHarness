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
  | 'openspec-draft'
  | 'openspec-review'
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
