import type { ReviewPolicyOperation } from '@/lib/workflow/state-review-policy';

export type WorkflowAdversarialIntent = 'disabled' | 'on-demand';
export type WorkflowReviewMode = 'standard' | 'adversarial';
export type WorkflowReviewConfidence = 'high' | 'medium' | 'low';
export type WorkflowProductKind = 'lightweight' | 'state-machine';

export interface RunReviewStateKey {
  configFile: string;
  stateId: string;
}

export interface RunReviewStateSuggestion extends RunReviewStateKey {
  kind: 'state';
  mode: WorkflowReviewMode;
  confidence: WorkflowReviewConfidence;
  riskSignals: string[];
  rationale: string;
}

export interface RunReviewLightweightSuggestion {
  kind: 'lightweight';
  configFile: string;
  requiresAdversarial: boolean;
  confidence: WorkflowReviewConfidence;
  riskSignals: string[];
  rationale: string;
}

export type RunReviewSuggestion = RunReviewStateSuggestion | RunReviewLightweightSuggestion;

export interface RunReviewStatePlan extends RunReviewStateKey {
  kind: 'state';
  stateName: string;
  workflowName: string;
  baseMode: WorkflowReviewMode;
  suggestedMode: WorkflowReviewMode;
  effectiveMode: WorkflowReviewMode;
  source: 'global' | 'ai' | 'config-lock' | 'user';
  locked: boolean;
  configLocked: boolean;
  suggestion?: RunReviewStateSuggestion;
  operations: ReviewPolicyOperation[];
  warnings: string[];
  blocked: boolean;
  /** AI planning failed or omitted this target; an explicit run-level user choice is required. */
  manualSelectionRequired: boolean;
}

export interface RunReviewWorkflowPlan {
  kind: 'workflow';
  configFile: string;
  workflowName: string;
  baseKind: WorkflowProductKind;
  effectiveKind: WorkflowProductKind;
  requiresAdversarial: boolean;
  source: 'global' | 'ai' | 'user';
  locked: boolean;
  suggestion?: RunReviewLightweightSuggestion;
  operations: ReviewPolicyOperation[];
  warnings: string[];
  blocked: boolean;
  /** AI planning failed or omitted this target; an explicit run-level user choice is required. */
  manualSelectionRequired: boolean;
}

export interface RunReviewStateOverride extends RunReviewStateKey {
  kind?: 'state';
  /** null means handing the state back to the run-level AI suggestion. */
  mode: WorkflowReviewMode | null;
}

export interface RunReviewWorkflowOverride {
  kind: 'lightweight';
  configFile: string;
  /** null means handing the workflow back to the run-level AI suggestion. */
  requiresAdversarial: boolean | null;
}

export type RunReviewOverride = RunReviewStateOverride | RunReviewWorkflowOverride;

export interface RunReviewPlan {
  id: string;
  rootConfigFile: string;
  intent: WorkflowAdversarialIntent;
  baseConfigHash: string;
  contextHash: string;
  createdAt: string;
  expiresAt: string;
  workflows: RunReviewWorkflowPlan[];
  states: RunReviewStatePlan[];
  warnings: string[];
  blocked: boolean;
  /** Present when the on-demand batch evaluator failed and the plan fell back to manual selection. */
  evaluationError?: string;
}

export interface CreateRunReviewPlanInput {
  configFile: string;
  intent: WorkflowAdversarialIntent;
  initialContexts?: {
    globalContext?: string;
    phaseContexts?: Record<string, string>;
    taskInput?: Record<string, unknown>;
    workingDirectory?: string;
  };
  rehearsal?: boolean;
}

export interface RunReviewPlanResponse {
  plan: RunReviewPlan;
  preflightPreview?: unknown;
}
