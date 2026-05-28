import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { stringify, parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import type { SpecCodingDocument, StepTaskBindingSnapshot, StepTaskBindingValidation } from '@/lib/core/schemas';
import { normalizeSpecCodingDocument } from '@/lib/spec/coding-store';

const RUNS_DIR = getWorkspaceRunsDir();

/** Separator used to delimit output chunks in persisted stream files */
export const STREAM_CHUNK_SEPARATOR = '\n\n<!-- chunk-boundary -->\n\n';

export interface PersistedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

export interface PersistedAgentState {
  name: string;
  team: string;
  model: string;
  status: string;
  completedTasks: number;
  tokenUsage: PersistedTokenUsage;
  costUsd: number;
  sessionId: string | null;
  iterationCount: number;
  summary: string;
}

export interface PersistedIterationState {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  consecutiveCleanRounds: number;
  status: string;
  bugsFoundPerRound: number[];
}

export interface PersistedProcessInfo {
  pid: number;
  id: string;
  agent: string;
  step: string;
  stepId?: string;
  startTime: string;
}

export interface PersistedActiveConcurrencyGroup {
  id: string;
  stateName: string;
  steps: string[];
  joinPolicy?: any;
  status: 'running' | 'completed' | 'failed';
}

export interface PersistedStepLog {
  id: string; // UUID for this step execution
  stepName: string;
  agent: string;
  status: 'completed' | 'failed';
  output: string;
  error: string;
  costUsd: number;
  durationMs: number;
  timestamp: string;
  tokenUsage?: PersistedTokenUsage;
  sessionId?: string | null;
  engineName?: string;
  gitStepDiffId?: string;
  gitBeforeSnapshotId?: string;
  gitAfterSnapshotId?: string;
}

export type WorkflowGitSnapshotKind = 'run-baseline' | 'step-before' | 'step-after' | 'run-final';

export interface WorkflowGitSnapshot {
  id: string;
  ref: string;
  commit: string;
  shortCommit: string;
  tree: string;
  kind: WorkflowGitSnapshotKind;
  label: string;
  stepName?: string;
  phaseName?: string;
  stateName?: string;
  agent?: string;
  createdAt: string;
  reusedFromId?: string;
}

export interface WorkflowGitStepDiff {
  id: string;
  stepLogId: string;
  stepName: string;
  phaseName?: string;
  stateName?: string;
  agent: string;
  status: 'running' | 'completed' | 'failed';
  beforeSnapshotId: string;
  afterSnapshotId?: string;
  startedAt: string;
  completedAt?: string;
}

export interface WorkflowGitState {
  enabled: boolean;
  runId: string;
  workspacePath: string;
  repoRoot: string;
  wasGitRepository: boolean;
  initializedRepository: boolean;
  baselineSnapshotId?: string;
  baselineRef?: string;
  baselineCommit?: string;
  snapshots: WorkflowGitSnapshot[];
  stepDiffs: WorkflowGitStepDiff[];
  lastSnapshotId?: string;
  lastSnapshotTree?: string;
  lastSnapshotCommit?: string;
  error?: string;
  updatedAt: string;
}

export interface PersistedQualityCommandResult {
  command: string;
  exitCode: number | null;
  status: 'passed' | 'failed' | 'warning';
  stdout?: string;
  stderr?: string;
  errorText?: string | null;
}

export interface PersistedQualityCheck {
  id: string;
  stateName: string;
  stepName: string;
  agent: string;
  category: 'lint' | 'compile' | 'test' | 'custom';
  status: 'passed' | 'failed' | 'warning';
  origin?: 'workflow' | 'inferred';
  summary: string;
  createdAt: string;
  commands: PersistedQualityCommandResult[];
}

export interface DeltaMergeState {
  status: 'not-applicable' | 'available' | 'previewing' | 'awaiting-confirmation' | 'applying' | 'merged' | 'failed';
  requestedAt?: string;
  previewedAt?: string;
  appliedAt?: string;
  appliedBy?: string;
  error?: string;
  baseHash?: string;
  deltaHash?: string;
  mergedHash?: string;
  diff?: string;
  aiSummary?: string;
  previewPath?: string;
}

export interface HumanQuestionAnswerSchema {
  type: 'text' | 'single-choice' | 'multi-choice' | 'approval-transition';
  required?: boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string; description?: string }>;
}

export interface HumanQuestionAnswer {
  text?: string;
  selectedOption?: string;
  selectedOptions?: string[];
  selectedState?: string;
  instruction?: string;
  raw?: any;
}

export interface HumanQuestion {
  id: string;
  runId: string;
  configFile: string;
  status: 'unanswered' | 'answered' | 'dismissed';
  kind: 'approval' | 'clarification' | 'choice' | 'confirmation' | 'freeform';
  title: string;
  message: string;
  supervisorAdvice?: string;
  createdAt: string;
  answeredAt?: string;
  supervisorAgent?: string;
  supervisorSessionId?: string | null;
  workflowFrontendSessionId?: string | null;
  currentState?: string | null;
  previousState?: string | null;
  suggestedNextState?: string;
  availableStates?: string[];
  result?: any;
  requiresWorkflowPause?: boolean;
  answerSchema: HumanQuestionAnswerSchema;
  answer?: HumanQuestionAnswer;
  source?: {
    type: 'human-approval' | 'checkpoint-advice' | 'supervisor-chat' | 'manual' | string;
    [key: string]: any;
  };
}

export interface HumanAnswerContext {
  questionId: string;
  title: string;
  question: string;
  answer: string;
  instruction?: string;
  answeredAt: string;
}

export type WorkflowSpecRevisionVoteChoice = 'revise' | 'keep' | 'defer';

export interface WorkflowSpecRevisionBallot {
  agent: string;
  choice: WorkflowSpecRevisionVoteChoice;
  reason: string;
  votedAt: string;
}

export interface WorkflowSpecRevisionVoteRecord {
  id: string;
  trigger: 'state-complete' | 'human-review' | 'force-transition';
  title: string;
  question: string;
  status: 'running' | 'completed' | 'failed';
  stateName?: string | null;
  nextState?: string | null;
  contextSummary?: string;
  createdAt: string;
  completedAt?: string;
  ballots: WorkflowSpecRevisionBallot[];
  tally: Record<WorkflowSpecRevisionVoteChoice, number>;
  recommendedChoice?: WorkflowSpecRevisionVoteChoice;
  supervisorDecision?: {
    apply: boolean;
    summary: string;
    madeAt: string;
    affectedArtifacts?: string[];
    impact?: string[];
  };
  revision?: {
    applied: boolean;
    summary: string;
    affectedArtifacts?: string[];
    error?: string | null;
  };
}

export interface PersistedRunState {
  runId: string;
  configFile: string;
  /** Authenticated user who owns/started this run. */
  runOwnerId?: string;
  runOwnerName?: string;
  /** Backward-compatible aliases used by older dashboard readers. */
  createdBy?: string;
  createdByName?: string;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' | 'crashed' | 'pending';
  statusReason?: string;
  startTime: string;
  endTime: string | null;
  currentPhase: string | null;
  currentStep: string | null;
  activeSteps?: string[];
  activeConcurrencyGroups?: PersistedActiveConcurrencyGroup[];
  completedSteps: string[];
  failedSteps: string[];
  stepLogs: PersistedStepLog[];
  agents: PersistedAgentState[];
  iterationStates: Record<string, PersistedIterationState>;
  processes: PersistedProcessInfo[];
  /** If set, the workflow was waiting at a checkpoint when it stopped */
  pendingCheckpoint?: {
    phase: string;
    checkpoint: string;
    message: string;
    isIterativePhase: boolean;
    /** State machine: suggested next state for human approval */
    suggestedNextState?: string;
    /** State machine: available states to choose from */
    availableStates?: string[];
    /** State machine: supervisor advice for human checkpoint */
    supervisorAdvice?: string;
    /** State machine: full approval result for UI restore */
    result?: {
      verdict?: string;
      issues?: any[];
      summary?: string;
      stepOutputs?: string[];
    };
    /** State machine: linked supervisor question for restored approval UI */
    humanQuestionId?: string;
    humanQuestion?: HumanQuestion;
  };
  humanQuestions?: HumanQuestion[];
  pendingHumanQuestionId?: string | null;
  humanAnswersContext?: HumanAnswerContext[];
  globalContext?: string;
  phaseContexts?: Record<string, string>;

  // State machine specific fields
  mode?: 'state-machine' | 'phase-based';
  currentState?: string | null;
  transitionCount?: number;
  maxTransitions?: number;
  stateHistory?: Array<{
    from: string;
    to: string;
    reason: string;
    issues: any[];
    timestamp: string;
  }>;
  issueTracker?: Array<{
    type: string;
    severity: string;
    description: string;
    foundInState?: string;
    foundByAgent?: string;
  }>;
  requirements?: string;
  supervisorFlow?: Array<{
    type: string;
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
    stateName?: string;
  }>;
  agentFlow?: Array<{
    id: string;
    type: string;
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }>;
  /** 实际工作目录（隔离的 run-xxx 目录或原始 projectRoot） */
  workingDirectory?: string;
  /** Git baseline and per-step snapshots captured by the workflow runner. */
  workspaceGit?: WorkflowGitState;
  /** 运行绑定的 supervisor agent 名称 */
  supervisorAgent?: string;
  /** 运行绑定的 supervisor sessionId */
  supervisorSessionId?: string | null;
  /** 当前运行中各 agent 的会话绑定 */
  attachedAgentSessions?: Record<string, string>;
  /** 首页/运行页共享的前端聊天会话 ID */
  workflowFrontendSessionId?: string | null;
  /** 最近一次 supervisor 审阅/建议 */
  latestSupervisorReview?: {
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision' | 'human-question';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null;
  /** 最近一次 spec 修订投票（进行中或最近完成） */
  specRevisionVote?: WorkflowSpecRevisionVoteRecord | null;
  /** spec 修订投票历史 */
  specRevisionVoteHistory?: WorkflowSpecRevisionVoteRecord[];
  /** preCommands 收集到的结构化质量门禁结果 */
  qualityChecks?: PersistedQualityCheck[];
  /** Explicit creation session bound to this run, only set when provided at start */
  creationSessionId?: string;
  /** 当前 run 绑定的独立 SpecCoding 快照 */
  runSpecCoding?: SpecCodingDocument | null;
  /** Startup snapshot of workflow step -> tasks.md task bindings. */
  stepTaskBindingsSnapshot?: StepTaskBindingSnapshot[];
  /** Last system validation result for workflow step -> tasks.md bindings. */
  bindingValidation?: StepTaskBindingValidation;
  /** 持久化 spec 模式 */
  persistMode?: 'none' | 'repository';
  /** 持久化 spec 的仓库根目录（repository 模式下写入 delta spec 的目标目录） */
  specRootDir?: string;
  /** 工作流名称，持久化模式下用于定位 delta 目录 */
  workflowName?: string;
  /** delta spec 是否已合入 master */
  deltaSpecMerged?: boolean;
  /** delta spec 合入 master 的人工确认状态 */
  deltaMergeState?: DeltaMergeState;
  /** 演练模式元数据 */
  rehearsal?: {
    enabled: boolean;
    summary: string;
    recommendedNextSteps: string[];
  } | null;
}

function runDir(runId: string): string {
  return resolve(RUNS_DIR, runId);
}

function stateFilePath(runId: string): string {
  return resolve(runDir(runId), 'state.yaml');
}

function outputsDir(runId: string): string {
  return resolve(runDir(runId), 'outputs');
}

export async function saveRunState(state: PersistedRunState): Promise<void> {
  const dir = runDir(state.runId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const yamlContent = '# Auto-generated run state\n' + stringify(state);
  await writeFile(stateFilePath(state.runId), yamlContent, 'utf-8');
}

export async function loadRunState(runId: string): Promise<PersistedRunState | null> {
  try {
    const content = await readFile(stateFilePath(runId), 'utf-8');
    const state = parse(content) as PersistedRunState;
    if (state?.runSpecCoding) {
      state.runSpecCoding = normalizeSpecCodingDocument(state.runSpecCoding);
    }
    return state;
  } catch {
    return null;
  }
}

export async function saveProcessOutput(
  runId: string,
  stepName: string,
  output: string
): Promise<string> {
  const dir = outputsDir(runId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  const filepath = resolve(dir, `${safeName}.md`);
  await writeFile(filepath, output, 'utf-8');
  return filepath;
}

/**
 * Load all completed step outputs for a run.
 * Returns a map of stepName → output content.
 */
export async function loadStepOutputs(runId: string): Promise<Record<string, string>> {
  const dir = outputsDir(runId);
  if (!existsSync(dir)) return {};
  const files = await readdir(dir);
  const results: Record<string, string> = {};
  for (const file of files) {
    if (file.endsWith('.md') || file.endsWith('.txt')) {
      try {
        const content = await readFile(resolve(dir, file), 'utf-8');
        // Strip extension to get step name
        const stepName = file.replace(/\.(md|txt)$/, '');
        results[stepName] = content;
      } catch { /* skip unreadable */ }
    }
  }
  return results;
}

/**
 * List output files for a run with metadata.
 */
export async function listOutputFiles(runId: string): Promise<{ stepName: string; filename: string; size: number }[]> {
  const dir = outputsDir(runId);
  if (!existsSync(dir)) return [];
  const { stat } = await import('fs/promises');
  const files = await readdir(dir);
  const results: { stepName: string; filename: string; size: number }[] = [];
  for (const file of files) {
    try {
      const fileStat = await stat(resolve(dir, file));
      const stepName = file.replace(/\.(md|txt)$/, '');
      results.push({ stepName, filename: file, size: fileStat.size });
    } catch { /* skip */ }
  }
  return results;
}

export async function findRunningRuns(): Promise<PersistedRunState[]> {
  if (!existsSync(RUNS_DIR)) return [];
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const results: PersistedRunState[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const state = await loadRunState(entry.name);
      if (state && state.status === 'running') {
        results.push(state);
      }
    }
  }
  return results;
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Save live stream content for a running step */
export async function saveStreamContent(
  runId: string,
  stepName: string,
  content: string
): Promise<void> {
  const dir = resolve(runDir(runId), 'streams');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  await writeFile(resolve(dir, `${safeName}.stream.md`), content, 'utf-8');
}

/** Append a human feedback marker to the stream file for the current step */
export async function appendFeedbackToStream(
  runId: string,
  stepName: string,
  message: string
): Promise<void> {
  const dir = resolve(runDir(runId), 'streams');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  const filepath = resolve(dir, `${safeName}.stream.md`);
  const timestamp = new Date().toISOString();
  const feedbackChunk = `${STREAM_CHUNK_SEPARATOR}<!-- human-feedback: ${timestamp} -->\n${message}`;
  try {
    const { appendFile } = await import('fs/promises');
    await appendFile(filepath, feedbackChunk, 'utf-8');
  } catch {
    // File may not exist yet — write it
    await writeFile(filepath, feedbackChunk, 'utf-8');
  }
}

/** Load live stream content for a step */
export async function loadStreamContent(
  runId: string,
  stepName: string
): Promise<string | null> {
  const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  const filepath = resolve(runDir(runId), 'streams', `${safeName}.stream.md`);
  try {
    return await readFile(filepath, 'utf-8');
  } catch {
    return null;
  }
}
