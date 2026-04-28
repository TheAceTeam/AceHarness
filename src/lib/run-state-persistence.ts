import { mkdir, writeFile, readFile, readdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { stringify, parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import type { OpenSpecDocument } from '@/lib/schemas';
import { normalizeOpenSpecDocument } from '@/lib/openspec-store';

const RUNS_DIR = getWorkspaceRunsDir();

/** Separator used to delimit output chunks in persisted stream files */
export const STREAM_CHUNK_SEPARATOR = '\n\n<!-- chunk-boundary -->\n\n';

export interface PersistedAgentState {
  name: string;
  team: string;
  model: string;
  status: string;
  completedTasks: number;
  tokenUsage: { inputTokens: number; outputTokens: number };
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

export interface PersistedRunState {
  runId: string;
  configFile: string;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' | 'crashed' | 'pending';
  statusReason?: string;
  startTime: string;
  endTime: string | null;
  currentPhase: string | null;
  currentStep: string | null;
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
  };
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
  /** 运行绑定的 supervisor agent 名称 */
  supervisorAgent?: string;
  /** 运行绑定的 supervisor sessionId */
  supervisorSessionId?: string | null;
  /** 当前运行中各 agent 的会话绑定 */
  attachedAgentSessions?: Record<string, string>;
  /** 最近一次 supervisor 审阅/建议 */
  latestSupervisorReview?: {
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null;
  /** preCommands 收集到的结构化质量门禁结果 */
  qualityChecks?: PersistedQualityCheck[];
  /** 当前 run 绑定的独立 OpenSpec 快照 */
  runOpenSpec?: OpenSpecDocument | null;
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
    if (state?.runOpenSpec) {
      state.runOpenSpec = normalizeOpenSpecDocument(state.runOpenSpec);
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
