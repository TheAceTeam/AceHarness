import { appendFile, mkdir, writeFile, readFile, readdir, rename, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { stringify, parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import type { SpecCodingDocument, StepTaskBindingSnapshot, StepTaskBindingValidation } from '@/lib/core/schemas';
import { buildRunSummaryCacheFromState, saveRunSummaryCache } from '@/lib/run/summary-cache';
import { normalizeSpecCodingDocument } from '@/lib/spec/coding-store';
import { getWorkflowEventStore } from '@/lib/workflow/event-store';

const RUNS_DIR = getWorkspaceRunsDir();
const streamPersistedLengths = new Map<string, number>();
const runStateWriteQueues = new Map<string, Promise<void>>();
const streamWriteQueues = new Map<string, Promise<void>>();
const WINDOWS_REPLACE_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800];

/** Separator used to delimit output chunks in persisted stream files */
export const STREAM_CHUNK_SEPARATOR = '\n\n<!-- chunk-boundary -->\n\n';

function isRetryableReplaceError(error: unknown): boolean {
  const code = typeof error === 'object' && error ? (error as { code?: unknown }).code : undefined;
  return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

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

export interface PersistedSubworkflowRunRef {
  parentStepId: string;
  parentStepName: string;
  parentStateName?: string;
  configFile: string;
  snapshotFile?: string;
  runId: string;
  attempt: number;
  status: 'pending' | 'starting' | 'running' | 'waiting-human' | 'completed' | 'failed' | 'stopped' | 'crashed' | 'cancelled' | 'detached' | 'abandoned' | 'superseded';
  startedAt?: string;
  endedAt?: string;
  summary?: string;
  verdict?: 'pass' | 'conditional_pass' | 'fail';
  error?: string;
  eventCount?: number;
}

export interface PersistedSubworkflowAuditEvent {
  id: string;
  timestamp: string;
  action:
    | 'start'
    | 'status'
    | 'waiting-human'
    | 'human-answer'
    | 'force-transition'
    | 'force-complete-child'
    | 'rerun-supersede'
    | 'result-mapping';
  actorId?: string;
  actorName?: string;
  parentRunId?: string;
  rootRunId?: string;
  childRunId?: string;
  parentConfigFile?: string;
  childConfigFile?: string;
  stateName?: string;
  stepName?: string;
  resultMapping?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

export interface PersistedActiveConcurrencyGroup {
  id: string;
  stateName: string;
  steps: string[];
  joinPolicy?: any;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
}

export interface PersistedStepLog {
  id: string; // UUID for this step execution
  stepName: string;
  agent: string;
  status: 'completed' | 'failed';
  output: string;
  outputRef?: string;
  outputBytes?: number;
  error: string;
  costUsd: number;
  durationMs: number;
  timestamp: string;
  tokenUsage?: PersistedTokenUsage;
  sessionId?: string | null;
  engineName?: string;
  stepType?: 'agent' | 'subworkflow';
  childRunId?: string;
  childConfigFile?: string;
  childStatus?: string;
  childSummary?: string;
  childVerdict?: 'pass' | 'conditional_pass' | 'fail';
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
  parentRunId?: string;
  rootRunId?: string;
  workflowPath?: Array<{
    runId: string;
    configFile?: string;
    workflowName?: string;
    stateName?: string | null;
    stepName?: string | null;
  }>;
  sourceRunId?: string;
  sourceConfigFile?: string;
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
  parentRunId?: string;
  rootRunId?: string;
  parentConfigFile?: string;
  parentStateName?: string;
  parentStepId?: string;
  parentStepName?: string;
  nestingPath?: Array<{
    runId: string;
    configFile: string;
    stepName?: string;
    stateName?: string;
  }>;
  childRunIds?: string[];
  subworkflowRuns?: PersistedSubworkflowRunRef[];
  activeSubworkflowRunId?: string | null;
  subworkflowAuditEvents?: PersistedSubworkflowAuditEvent[];
  workflowSnapshotRoot?: string;
  workflowSnapshotManifestHash?: string;
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
  /** 累计等待（停摆）时长（毫秒）：人工审查、token 耗尽、停止/崩溃后恢复等区间之和，不计入实际执行时间。 */
  accumulatedWaitMs?: number;
  /** 若当前正处于等待中，记录本次等待的开始时刻（ISO）；恢复运行时累加进 accumulatedWaitMs 并清空。 */
  waitStartedAt?: string | null;
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
  /** Live feedback that has been sent by the user but not yet consumed by the running agent. */
  pendingLiveFeedback?: Array<{
    id: string;
    message: string;
    timestamp: string;
    status?: 'queued' | 'interrupting' | 'delivered';
    interrupt?: boolean;
    automatic?: boolean;
  }>;
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

export interface LoadRunStateOptions {
  hydrateLargeOutputs?: boolean;
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

function checkpointsDir(runId: string): string {
  return resolve(runDir(runId), 'checkpoints');
}

function stepLogOutputsDir(runId: string): string {
  return resolve(outputsDir(runId), 'step-logs');
}

function streamDir(runId: string): string {
  return resolve(runDir(runId), 'streams');
}

function safeStepFileName(stepName: string): string {
  return stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}

function streamQueueKey(runId: string, stepName: string): string {
  return `${runId}:${safeStepFileName(stepName)}`;
}

function countStringBytes(items: string[]): number {
  return items.reduce((sum, item) => sum + Buffer.byteLength(item, 'utf-8'), 0);
}

async function externalizeStepOutputs(
  runId: string,
  key: string,
  result: any
): Promise<any> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const stepOutputs = Array.isArray(result.stepOutputs)
    ? result.stepOutputs.filter((item: any): item is string => typeof item === 'string')
    : [];
  if (stepOutputs.length === 0) return result;

  const dir = checkpointsDir(runId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeName = safeStepFileName(key || 'checkpoint');
  const filename = `${safeName}.step-outputs.json`;
  await writeFile(resolve(dir, filename), `${JSON.stringify(stepOutputs)}\n`, 'utf-8');
  return {
    ...result,
    stepOutputs: [],
    stepOutputRef: `checkpoints/${filename}`,
    stepOutputCount: stepOutputs.length,
    stepOutputBytes: countStringBytes(stepOutputs),
  };
}

async function hydrateStepOutputs(runId: string, result: any): Promise<any> {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  if (Array.isArray(result.stepOutputs) && result.stepOutputs.length > 0) return result;
  if (typeof result.stepOutputRef !== 'string' || !result.stepOutputRef) return result;
  try {
    const content = await readFile(resolve(runDir(runId), result.stepOutputRef), 'utf-8');
    const stepOutputs = JSON.parse(content);
    if (!Array.isArray(stepOutputs)) return result;
    return { ...result, stepOutputs };
  } catch {
    return result;
  }
}

async function compactHumanQuestionForState(runId: string, question: any): Promise<any> {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
  return {
    ...question,
    result: await externalizeStepOutputs(runId, `human-question-${question.id || 'unknown'}`, question.result),
  };
}

async function hydrateHumanQuestion(runId: string, question: any): Promise<any> {
  if (!question || typeof question !== 'object' || Array.isArray(question)) return question;
  return {
    ...question,
    result: await hydrateStepOutputs(runId, question.result),
  };
}

async function externalizeStepLogOutput(runId: string, log: PersistedStepLog): Promise<PersistedStepLog> {
  if (!log || typeof log !== 'object') return log;
  if (typeof log.output !== 'string' || log.output.length === 0) return log;

  const dir = stepLogOutputsDir(runId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeStep = safeStepFileName(log.stepName || 'step');
  const safeId = safeStepFileName(log.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const filename = `${safeStep}-${safeId}.md`;
  await writeFile(resolve(dir, filename), log.output, 'utf-8');

  return {
    ...log,
    output: '',
    outputRef: `outputs/step-logs/${filename}`,
    outputBytes: Buffer.byteLength(log.output, 'utf-8'),
  };
}

async function hydrateStepLogOutput(runId: string, log: PersistedStepLog): Promise<PersistedStepLog> {
  if (!log || typeof log !== 'object') return log;
  if (typeof log.output === 'string' && log.output.length > 0) return log;
  if (typeof log.outputRef !== 'string' || !log.outputRef) return log;
  try {
    const output = await readFile(resolve(runDir(runId), log.outputRef), 'utf-8');
    return { ...log, output };
  } catch {
    return log;
  }
}

async function compactStateForYaml(state: PersistedRunState): Promise<PersistedRunState> {
  const pendingCheckpoint = state.pendingCheckpoint
    ? {
        ...state.pendingCheckpoint,
        result: await externalizeStepOutputs(
          state.runId,
          `pending-checkpoint-${state.pendingCheckpoint.humanQuestionId || state.pendingHumanQuestionId || 'unknown'}`,
          state.pendingCheckpoint.result
        ),
        humanQuestion: state.pendingCheckpoint.humanQuestion
          ? {
              ...state.pendingCheckpoint.humanQuestion,
              result: await externalizeStepOutputs(
                state.runId,
                `pending-checkpoint-human-question-${state.pendingCheckpoint.humanQuestion.id || state.pendingCheckpoint.humanQuestionId || 'unknown'}`,
                state.pendingCheckpoint.humanQuestion.result
              ),
            }
          : state.pendingCheckpoint.humanQuestion,
      }
    : state.pendingCheckpoint;
  const humanQuestions = Array.isArray(state.humanQuestions)
    ? await Promise.all(state.humanQuestions.map((question) => compactHumanQuestionForState(state.runId, question)))
    : state.humanQuestions;
  const stepLogs = Array.isArray(state.stepLogs)
    ? await Promise.all(state.stepLogs.map((log) => externalizeStepLogOutput(state.runId, log)))
    : state.stepLogs;
  return {
    ...state,
    stepLogs,
    pendingCheckpoint,
    humanQuestions,
  };
}

async function hydrateExternalizedState(
  state: PersistedRunState,
  options: LoadRunStateOptions = {}
): Promise<PersistedRunState> {
  const hydrateLargeOutputs = options.hydrateLargeOutputs !== false;
  if (!hydrateLargeOutputs) return state;
  const pendingCheckpoint = state.pendingCheckpoint
    ? {
        ...state.pendingCheckpoint,
        result: await hydrateStepOutputs(state.runId, state.pendingCheckpoint.result),
        humanQuestion: await hydrateHumanQuestion(state.runId, state.pendingCheckpoint.humanQuestion),
      }
    : state.pendingCheckpoint;
  const humanQuestions = Array.isArray(state.humanQuestions)
    ? await Promise.all(state.humanQuestions.map((question) => hydrateHumanQuestion(state.runId, question)))
    : state.humanQuestions;
  const stepLogs = Array.isArray(state.stepLogs)
    ? await Promise.all(state.stepLogs.map((log) => hydrateStepLogOutput(state.runId, log)))
    : state.stepLogs;
  return {
    ...state,
    stepLogs,
    pendingCheckpoint,
    humanQuestions,
  };
}

function buildRunSnapshotFromState(state: PersistedRunState, summary: ReturnType<typeof buildRunSummaryCacheFromState>) {
  return {
    runId: state.runId,
    configFile: state.configFile,
    workflowName: state.workflowName,
    status: state.status,
    statusReason: state.statusReason,
    startTime: state.startTime,
    endTime: state.endTime,
    accumulatedWaitMs: state.accumulatedWaitMs ?? 0,
    waitStartedAt: state.waitStartedAt ?? null,
    currentPhase: state.currentPhase,
    currentState: state.currentState,
    currentStep: state.currentStep,
    mode: state.mode,
    activeSteps: state.activeSteps || [],
    activeConcurrencyGroups: state.activeConcurrencyGroups || [],
    completedSteps: state.completedSteps || [],
    failedSteps: state.failedSteps || [],
    pendingHumanQuestionId: state.pendingHumanQuestionId,
    workingDirectory: state.workingDirectory,
    supervisorAgent: state.supervisorAgent,
    supervisorSessionId: state.supervisorSessionId || null,
    attachedAgentSessions: state.attachedAgentSessions || {},
    workflowFrontendSessionId: state.workflowFrontendSessionId,
    agents: Array.isArray(state.agents)
      ? state.agents.map((agent) => ({
          name: agent.name,
          team: agent.team,
          model: agent.model,
          status: agent.status,
          completedTasks: agent.completedTasks || 0,
          tokenUsage: agent.tokenUsage || { inputTokens: 0, outputTokens: 0 },
          costUsd: typeof agent.costUsd === 'number' ? agent.costUsd : 0,
          sessionId: agent.sessionId || null,
          iterationCount: agent.iterationCount || 0,
          summary: agent.summary || '',
        }))
      : [],
    transitionCount: state.transitionCount,
    summary,
    updatedAt: new Date().toISOString(),
  };
}

async function replaceFileWithRetry(temp: string, target: string, fallbackContent: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= WINDOWS_REPLACE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableReplaceError(error) || attempt >= WINDOWS_REPLACE_RETRY_DELAYS_MS.length) break;
      await sleep(WINDOWS_REPLACE_RETRY_DELAYS_MS[attempt]);
    }
  }

  if (isRetryableReplaceError(lastError)) {
    await writeFile(target, fallbackContent, 'utf-8');
    await rm(temp, { force: true }).catch(() => {});
    return;
  }

  await rm(temp, { force: true }).catch(() => {});
  throw lastError;
}

async function writeRunStateNow(state: PersistedRunState): Promise<void> {
  const dir = runDir(state.runId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const persistedState = await compactStateForYaml(state);
  const yamlContent = '# Auto-generated run state\n' + stringify(persistedState);
  const target = stateFilePath(state.runId);
  const temp = resolve(dir, `state.yaml.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await writeFile(temp, yamlContent, 'utf-8');
  await replaceFileWithRetry(temp, target, yamlContent);
  const summary = buildRunSummaryCacheFromState(state);
  if (summary) {
    await saveRunSummaryCache(summary).catch((error) => {
      console.warn('[run-state] failed to update summary cache:', error);
    });
  }
  const snapshot = buildRunSnapshotFromState(state, summary);
  const store = getWorkflowEventStore();
  const event = await store.append(state.runId, 'run.state.saved', {
    configFile: state.configFile,
    status: state.status,
    currentPhase: state.currentPhase || state.currentState || null,
    currentStep: state.currentStep || null,
    completedStepCount: Array.isArray(state.completedSteps) ? state.completedSteps.length : 0,
    failedStepCount: Array.isArray(state.failedSteps) ? state.failedSteps.length : 0,
    stepLogCount: Array.isArray(state.stepLogs) ? state.stepLogs.length : 0,
    stateHistoryCount: Array.isArray(state.stateHistory) ? state.stateHistory.length : 0,
    snapshotRef: 'workflow_snapshots',
  }).catch((error) => {
    console.warn('[run-state] failed to append workflow event:', error);
    return null;
  });
  await store.saveSnapshot(state.runId, snapshot, { seq: event?.seq }).catch((error) => {
    console.warn('[run-state] failed to save workflow snapshot:', error);
  });
}

export async function saveRunState(state: PersistedRunState): Promise<void> {
  const previous = runStateWriteQueues.get(state.runId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => writeRunStateNow(state));
  runStateWriteQueues.set(state.runId, next);
  try {
    await next;
  } finally {
    if (runStateWriteQueues.get(state.runId) === next) {
      runStateWriteQueues.delete(state.runId);
    }
  }
}

export async function loadRunState(
  runId: string,
  options: LoadRunStateOptions = {}
): Promise<PersistedRunState | null> {
  try {
    const content = await readFile(stateFilePath(runId), 'utf-8');
    const state = parse(content) as PersistedRunState;
    if (state?.runSpecCoding) {
      state.runSpecCoding = normalizeSpecCodingDocument(state.runSpecCoding);
    }
    return hydrateExternalizedState(state, options);
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
  const safeName = safeStepFileName(stepName);
  const filepath = resolve(dir, `${safeName}.md`);
  await writeFile(filepath, output, 'utf-8');
  await getWorkflowEventStore().append(runId, 'step.output.saved', {
    stepName,
    outputRef: `outputs/${safeName}.md`,
    bytes: Buffer.byteLength(output, 'utf-8'),
  }).catch(() => {});
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
      if (!fileStat.isFile()) continue;
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
async function writeStreamContentNow(
  runId: string,
  stepName: string,
  content: string
): Promise<void> {
  const dir = streamDir(runId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeName = safeStepFileName(stepName);
  const key = `${runId}:${safeName}`;
  const previousLength = streamPersistedLengths.get(key) || 0;
  const nextLength = content.length;
  if (nextLength >= previousLength) {
    const delta = content.slice(previousLength);
    if (delta) {
      await appendFile(resolve(dir, `${safeName}.stream.md`), delta, 'utf-8');
      const chunkFile = resolve(dir, `${safeName}.chunks.jsonl`);
      const chunk = {
        ts: new Date().toISOString(),
        offset: previousLength,
        text: delta,
      };
      await appendFile(chunkFile, `${JSON.stringify(chunk)}\n`, 'utf-8').catch(() => {});
      await getWorkflowEventStore().append(runId, 'stream.chunk', {
        stepName,
        streamRef: `streams/${safeName}.chunks.jsonl`,
        offset: previousLength,
        bytes: Buffer.byteLength(delta, 'utf-8'),
      }).catch(() => {});
    }
  } else {
    await writeFile(resolve(dir, `${safeName}.stream.md`), content, 'utf-8');
    await getWorkflowEventStore().append(runId, 'stream.rewritten', {
      stepName,
      streamRef: `streams/${safeName}.stream.md`,
      bytes: Buffer.byteLength(content, 'utf-8'),
    }).catch(() => {});
  }
  streamPersistedLengths.set(key, nextLength);
}

async function appendStreamContentNow(
  runId: string,
  stepName: string,
  chunkText: string
): Promise<void> {
  if (!chunkText) return;
  const dir = streamDir(runId);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const safeName = safeStepFileName(stepName);
  const key = `${runId}:${safeName}`;
  const previousLength = streamPersistedLengths.get(key) || 0;
  await appendFile(resolve(dir, `${safeName}.stream.md`), chunkText, 'utf-8');
  const chunkFile = resolve(dir, `${safeName}.chunks.jsonl`);
  const chunk = {
    ts: new Date().toISOString(),
    offset: previousLength,
    text: chunkText,
  };
  await appendFile(chunkFile, `${JSON.stringify(chunk)}\n`, 'utf-8').catch(() => {});
  await getWorkflowEventStore().append(runId, 'stream.chunk', {
    stepName,
    streamRef: `streams/${safeName}.chunks.jsonl`,
    offset: previousLength,
    bytes: Buffer.byteLength(chunkText, 'utf-8'),
  }).catch(() => {});
  streamPersistedLengths.set(key, previousLength + chunkText.length);
}

export async function saveStreamContent(
  runId: string,
  stepName: string,
  content: string
): Promise<void> {
  const key = streamQueueKey(runId, stepName);
  const previous = streamWriteQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => writeStreamContentNow(runId, stepName, content));
  streamWriteQueues.set(key, next);
  try {
    await next;
  } finally {
    if (streamWriteQueues.get(key) === next) {
      streamWriteQueues.delete(key);
    }
  }
}

export async function appendStreamContent(
  runId: string,
  stepName: string,
  chunkText: string
): Promise<void> {
  const key = streamQueueKey(runId, stepName);
  const previous = streamWriteQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => appendStreamContentNow(runId, stepName, chunkText));
  streamWriteQueues.set(key, next);
  try {
    await next;
  } finally {
    if (streamWriteQueues.get(key) === next) {
      streamWriteQueues.delete(key);
    }
  }
}

/** Append a human feedback marker to the stream file for the current step */
export async function appendFeedbackToStream(
  runId: string,
  stepName: string,
  message: string
): Promise<void> {
  const key = streamQueueKey(runId, stepName);
  const previous = streamWriteQueues.get(key) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const dir = streamDir(runId);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });
      const safeName = safeStepFileName(stepName);
      const filepath = resolve(dir, `${safeName}.stream.md`);
      const timestamp = new Date().toISOString();
      const feedbackChunk = `${STREAM_CHUNK_SEPARATOR}<!-- human-feedback: ${timestamp} -->\n${message}`;
      try {
        await appendFile(filepath, feedbackChunk, 'utf-8');
      } catch {
        // File may not exist yet — write it
        await writeFile(filepath, feedbackChunk, 'utf-8');
      }
      await getWorkflowEventStore().append(runId, 'stream.feedback', {
        stepName,
        streamRef: `streams/${safeName}.stream.md`,
        bytes: Buffer.byteLength(feedbackChunk, 'utf-8'),
      }).catch(() => {});
      const lengthKey = `${runId}:${safeName}`;
      streamPersistedLengths.set(lengthKey, (streamPersistedLengths.get(lengthKey) || 0) + feedbackChunk.length);
    });
  streamWriteQueues.set(key, next);
  try {
    await next;
  } finally {
    if (streamWriteQueues.get(key) === next) {
      streamWriteQueues.delete(key);
    }
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
