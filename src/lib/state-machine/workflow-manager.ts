/**
 * 状态机工作流管理器
 * 支持跨阶段回退的动态流程控制
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat, mkdir, rm, writeFile, copyFile } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { existsSync } from 'fs';
import { createDirectoryLinkSync } from '@/lib/core/directory-links';
import { cpus } from 'os';
import { parse } from 'yaml';
import { resolveAgentEngineSelection, resolveAgentModel } from '@/lib/workflow/manager';
import { resolveWorkflowExecutionPolicy } from '@/lib/agent/engine-selection';
import { processManager } from '@/lib/core/process-manager';
import type { EngineJsonResult, EngineResultMetadata, EngineTokenUsage } from '@/lib/engines/engine-interface';
import { createRun, updateRun } from '@/lib/run/store';
import {
  saveRunState, saveProcessOutput, appendStreamContent, appendFeedbackToStream,
  loadRunState, loadStepOutputs,
  type PersistedRunState,
  type PersistedProcessInfo,
  type PersistedStepLog,
  type PersistedQualityCheck,
  type PersistedQualityCommandResult,
  type DeltaMergeState,
  type WorkflowGitState,
  type HumanQuestion,
  type HumanQuestionAnswer,
  type HumanAnswerContext,
  type PersistedSubworkflowRunRef,
  type PersistedSubworkflowAuditEvent,
  type WorkflowSpecRevisionBallot,
  type WorkflowSpecRevisionVoteChoice,
  type WorkflowSpecRevisionVoteRecord,
} from '@/lib/run/state-persistence';
import { appendRuntimeOutputPreview, compactRuntimeOutputPreview } from '@/lib/run/output-compaction';
import {
  appendWorkflowExperience,
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
  saveWorkflowFinalReview,
  type WorkflowChildSpecDeltaSummary,
  type WorkflowFinalReview,
} from '@/lib/workflow/experience-store';
import type {
  StateMachineWorkflowConfig, StateMachineState, StateTransition,
  Issue, WorkflowStep, RoleConfig, TransitionCondition, SpecCodingDocument,
} from '@/lib/core/schemas';
import { formatTimestamp } from '@/lib/core/utils';
import { createEngine, getConfiguredEngine, getLogicalEngineId, resolveRequestedEngineType, type Engine, type EngineType } from '@/lib/engines';
import { getEngineSkillsSubdir } from '@/lib/engines/engine-config';
import type { EngineStreamEvent } from '@/lib/engines/engine-interface';
import { compactEngineContextManually, executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';
import { getRuntimeAgentsDirPath, getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { getWorkspaceRoot, getWorkspaceRunsDir } from '@/lib/core/app-paths';
import {
  buildDatabaseCapabilityPrompt,
  buildRuntimeDatabaseEnv,
  createRuntimeDatabaseGrant,
  expandDatabaseCapabilitySkillNames,
  writeRuntimeDatabaseEnvFile,
  type RuntimeDatabaseGrant,
} from '@/lib/runtime/database-capabilities';
import { listChatSessions, updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from '@/lib/chat/persistence';
import { appendWorkflowAgoraMessage, createWorkflowParticipants } from '@/lib/agora/workflow-topic';
import {
  DEFAULT_SUPERVISOR_NAME,
  ensureDefaultSupervisorConfig,
  resolveWorkflowSupervisorAgent,
} from '@/lib/core/default-supervisor';
import {
  appendSpecCodingRevision,
  appendSupervisorSpecCodingRevision,
  cloneSpecCodingForRun,
  loadCreationSession,
  markSpecCodingStateStatus,
  normalizeSpecCodingDocument,
  updateSpecCodingTaskStatuses,
} from '@/lib/spec/coding-store';
import { applyAiSpecCodingDraft, normalizeStringArray } from '@/lib/ai/draft-utils';
import { extractPlanDraftResult } from '@/lib/ai/result-normalizers';
import {
  compileStepTaskBindings,
  getSpecTaskBindingIds,
  getWorkflowStepRefs,
  type StepTaskBindingSnapshot,
  type StepTaskBindingValidation,
} from '@/lib/spec/task-binding';
import {
  ensureSpecDirStructure,
  getSpecRootDir,
  writeDeltaSpec,
  readDeltaSpec,
  readChecklist,
  type ChecklistQuestion,
} from '@/lib/spec/persistence';
import { importWorkspaceArtifactsIntoRunSpecCoding } from '@/lib/run/runtime-spec-import';
import { appendMemoryEntries } from '@/lib/workflow/memory-store';
import { upsertRelationshipSignal } from '@/lib/agent/relationship-store';
import {
  extractJsonObject as extractStructuredJsonObject,
  extractStructuredResult,
} from '@/lib/ai/result-channel';
import {
  ensureWorkflowGitState,
  recordWorkflowGitSnapshot,
  upsertWorkflowGitStepDiff,
} from '@/lib/workflow/git-baseline';
import {
  mergeMcpServers,
  resolveMcpServersByNames,
  type ManagedMcpServer,
} from '@/lib/mcp/registry';
import {
  createWorkflowConfigSnapshot,
  getSubworkflowConfigFile,
  isSubworkflowStep,
  normalizeWorkflowConfigRef,
  readWorkflowConfigSnapshot,
} from '@/lib/workflow/subworkflow-config';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const ZERO_ENGINE_USAGE: EngineTokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const STREAM_IDLE_INTERRUPT_MS = 10 * 60 * 1000;
const STREAM_IDLE_CHECK_MS = 30 * 1000;
const AUTO_CONTINUE_FEEDBACK = '系统检测到当前步骤已连续 10 分钟没有新的流式输出。请继续当前任务，并在无法继续时明确说明当前阻塞点。';
const STEP_AUTO_RECOVERY_MAX_ATTEMPTS = 3;
const TRANSIENT_ENGINE_RETRY_MAX_ATTEMPTS = 2;
const MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_PARENT = 8;
const MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_USER = 16;
const MAX_SUBWORKFLOW_RUNS_PER_ROOT = 64;
const MAX_PARALLEL_SUBWORKFLOW_BRANCHES = 8;
const MAX_CHILD_EVENT_COUNT = 500;
const MAX_CHILD_OUTPUT_SUMMARY_BYTES = 16 * 1024;
const MAX_SUBWORKFLOW_AUDIT_EVENTS = 300;

type LiveFeedbackStatus = 'queued' | 'interrupting' | 'delivered';

interface LiveFeedbackEntry {
  id: string;
  message: string;
  timestamp: string;
  interrupt: boolean;
  automatic?: boolean;
}

interface LiveFeedbackOptions {
  id?: string;
  interrupt?: boolean;
  automatic?: boolean;
}

type WorkflowActionActor = {
  id?: string;
  name?: string;
};

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeEngineUsage(metadata?: EngineResultMetadata): EngineTokenUsage {
  const usage = metadata?.usage;
  return {
    input_tokens: numberOrZero(usage?.input_tokens),
    output_tokens: numberOrZero(usage?.output_tokens),
    cache_creation_input_tokens: numberOrZero(usage?.cache_creation_input_tokens),
    cache_read_input_tokens: numberOrZero(usage?.cache_read_input_tokens),
  };
}

function metadataNumber(metadata: EngineResultMetadata | undefined, snakeKey: string, camelKey: string): number {
  return numberOrZero(metadata?.[snakeKey] ?? metadata?.[camelKey]);
}

function toPersistedTokenUsage(usage: EngineTokenUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
  };
}

function toLiveFeedbackSnapshot(entries: LiveFeedbackEntry[]) {
  return entries.map((entry) => ({
    id: entry.id,
    message: entry.message,
    timestamp: entry.timestamp,
    status: entry.interrupt ? 'interrupting' as const : 'queued' as const,
    interrupt: entry.interrupt,
    automatic: entry.automatic,
  }));
}

function addTokenUsage(agent: AgentState, usage: TokenUsage): void {
  agent.tokenUsage.inputTokens += usage.inputTokens;
  agent.tokenUsage.outputTokens += usage.outputTokens;
  agent.tokenUsage.cacheCreationInputTokens = (agent.tokenUsage.cacheCreationInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
  agent.tokenUsage.cacheReadInputTokens = (agent.tokenUsage.cacheReadInputTokens || 0) + (usage.cacheReadInputTokens || 0);
}

function replaceAgentStateSessionId(agent: AgentState | undefined | null, nextSessionId?: string | null): void {
  if (!agent) return;
  agent.sessionId = nextSessionId || null;
}

export interface AgentState {
  name: string;
  team: string;
  engine?: string;
  model: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  currentTask: string | null;
  completedTasks: number;
  tokenUsage: TokenUsage;
  costUsd: number;
  sessionId: string | null;
  lastOutput: string;
  summary: string;
}

export interface StateExecutionResult {
  stateName: string;
  verdict: 'pass' | 'conditional_pass' | 'fail';
  issues: Issue[];
  stepOutputs: string[];
  summary: string;
}

export interface StateTransitionRecord {
  from: string;
  to: string;
  reason: string;
  issues: Issue[];
  timestamp: string;
}

export function stripNonAiStreamArtifacts(text: string): string {
  return text
    .replace(/\n?\s*<!-- chunk-boundary -->\s*\n?/g, '\n')
    .replace(/\n?\s*<!-- human-feedback:[\s\S]*?-->\s*\n?/g, '\n')
    .trim();
}

function hasMeaningfulAiOutput(...parts: Array<string | null | undefined>): boolean {
  return parts.some((part) => typeof part === 'string' && stripNonAiStreamArtifacts(part).length > 0);
}

function isAceHarnessSkillName(skillName: string): boolean {
  return skillName.toLowerCase().startsWith('aceharness-');
}

function promptContentKey(value: string | null | undefined): string {
  const text = String(value || '');
  return `${text.length}:${text.slice(0, 120)}:${text.slice(-120)}`;
}

type AgentPromptMemo = {
  roadmapKey?: string;
  globalContextKey?: string;
  stateHistoryKey?: string;
  stateContextKeys: Record<string, string>;
  skillRulesShown?: boolean;
  skillContentSeen: Set<string>;
};

function buildAgentCompactSourceFromStepLogs(
  stepLogs: PersistedStepLog[],
  agentName: string,
  currentPrompt: string,
): string {
  const recentLogs = stepLogs.filter((log) => log.agent === agentName).slice(-5);
  if (recentLogs.length === 0) return currentPrompt;

  const history = recentLogs.map((log) => {
    const summarySource = log.output || log.error || '';
    const summary = compactStepConclusion(summarySource).slice(0, 4000);
    return [
      `## ${log.stepName}`,
      `状态: ${log.status}`,
      summary ? `${log.output ? '输出摘要' : '错误摘要'}:\n${summary}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return [
    '# 该 Agent 在当前工作流中的历史步骤摘要',
    history,
    '# 当前步骤请求',
    currentPrompt,
  ].join('\n\n');
}

export function extractTaggedBlock(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
  return text.match(pattern)?.[1]?.trim() || null;
}

function extractTaggedBlocks(text: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'gi');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const value = match[1]?.trim();
    if (value) blocks.push(value);
  }
  return blocks;
}

export function compactStepConclusion(raw: string): string {
  const tagged = extractTaggedBlock(raw, 'step-conclusion');
  if (tagged) return tagged;

  const text = stripNonAiStreamArtifacts(raw).trim();
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const tail = lines.slice(-30).join('\n').trim();
  return tail.length > 4000 ? tail.slice(-4000).trim() : tail;
}

function createEmptySpecRevisionTally(): Record<WorkflowSpecRevisionVoteChoice, number> {
  return {
    revise: 0,
    keep: 0,
    defer: 0,
  };
}

function countSpecRevisionVotes(ballots: WorkflowSpecRevisionBallot[]): Record<WorkflowSpecRevisionVoteChoice, number> {
  const tally = createEmptySpecRevisionTally();
  for (const ballot of ballots) {
    tally[ballot.choice] = (tally[ballot.choice] || 0) + 1;
  }
  return tally;
}

function getSpecRevisionChoiceLabel(choice: WorkflowSpecRevisionVoteChoice): string {
  switch (choice) {
    case 'revise':
      return '建议修订';
    case 'keep':
      return '保持现状';
    default:
      return '暂缓判断';
  }
}

function decideSpecRevisionChoice(tally: Record<WorkflowSpecRevisionVoteChoice, number>): WorkflowSpecRevisionVoteChoice {
  const ordered = (Object.entries(tally) as Array<[WorkflowSpecRevisionVoteChoice, number]>)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const [topChoice, topCount] = ordered[0] || ['defer', 0];
  const secondCount = ordered[1]?.[1] || 0;
  if (topCount === 0 || topCount === secondCount) return 'defer';
  return topChoice;
}

export type StepSegment =
  | { type: 'serial'; step: WorkflowStep }
  | { type: 'parallel'; groupId: string; steps: WorkflowStep[] };

type HumanHelpOption = {
  label: string;
  value: string;
  description?: string;
};

type HumanHelpRequest = {
  title: string;
  question: string;
  reason?: string;
  severity?: string;
  answerType: 'text' | 'single-choice' | 'multi-choice';
  options?: HumanHelpOption[];
  placeholder?: string;
  raw: any;
};

type SupervisorHumanHelpDecision = {
  needsHuman: boolean;
  title?: string;
  message?: string;
  supervisorAdvice?: string;
  answerType?: HumanHelpRequest['answerType'];
  options?: HumanHelpOption[];
  placeholder?: string;
  fallbackInstruction?: string;
  rawOutput?: string;
};

type RuntimeJoinPolicy = {
  mode: 'all' | 'any' | 'quorum' | 'manual';
  quorum?: number;
  timeoutMinutes?: number;
  onTimeout?: 'continue' | 'fail' | 'manual-review';
  onUnjoinedBranches?: 'stop' | 'detach' | 'wait-background';
};

type ActiveConcurrencyGroup = {
  id: string;
  stateName: string;
  steps: string[];
  joinPolicy?: RuntimeJoinPolicy;
  status: 'running' | 'waiting-approval' | 'completed' | 'failed';
};

type ParallelBranchResult = {
  step: WorkflowStep;
  status: 'fulfilled' | 'rejected';
  output?: string;
  error?: string;
  verdict?: 'pass' | 'conditional_pass' | 'fail';
  issues?: Issue[];
  childRunId?: string;
  childConfigFile?: string;
  childStatus?: string;
};

type ChannelOutputEntry = {
  stateName: string;
  stepName: string;
  agent: string;
  summary: string;
  timestamp: string;
};

type SpecRevisionVoteTrigger = WorkflowSpecRevisionVoteRecord['trigger'];

type SpecRevisionVoteTriggerInput = {
  trigger: SpecRevisionVoteTrigger;
  stateName?: string | null;
  nextState?: string | null;
  result?: StateExecutionResult | null;
  instruction?: string | null;
  checkpointAdvice?: string | null;
  question?: HumanQuestion | null;
  answer?: HumanQuestionAnswer | null;
};

type SpecRevisionVoteAgentDecision = {
  choice: WorkflowSpecRevisionVoteChoice;
  reason: string;
  rawOutput: string;
};

type SpecRevisionVoteSupervisorDecision = {
  apply: boolean;
  summary: string;
  affectedArtifacts: string[];
  impact: string[];
  rawOutput: string;
};

function getStepConcurrencyGroup(step: WorkflowStep): string | undefined {
  return step.concurrency?.groupId || step.parallelGroup || undefined;
}

function getStepRuntimeAgentName(step: WorkflowStep): string {
  return getStepConcurrencyGroup(step) ? (step.agentInstanceId || step.agent) : step.agent;
}

function normalizeGuardText(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function groupStateStepsIntoSegments(steps: WorkflowStep[]): StepSegment[] {
  const segments: StepSegment[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    const groupId = getStepConcurrencyGroup(step);
    if (!groupId) {
      segments.push({ type: 'serial', step });
      i += 1;
      continue;
    }

    const groupSteps: WorkflowStep[] = [step];
    let j = i + 1;
    while (j < steps.length && getStepConcurrencyGroup(steps[j]) === groupId) {
      groupSteps.push(steps[j]);
      j += 1;
    }

    if (groupSteps.length > 1) {
      segments.push({ type: 'parallel', groupId, steps: groupSteps });
    } else {
      segments.push({ type: 'serial', step });
    }
    i = j;
  }
  return segments;
}

function resolveJoinPolicy(segment: Extract<StepSegment, { type: 'parallel' }>, config: StateMachineWorkflowConfig): RuntimeJoinPolicy {
  const stepPolicy = segment.steps.find((step) => step.concurrency?.joinPolicy)?.concurrency?.joinPolicy;
  const workflowPolicy = config.workflow.concurrency?.joinPolicies?.[segment.groupId];
  return (stepPolicy || workflowPolicy || { mode: 'all' }) as RuntimeJoinPolicy;
}

function isStepToolFailure(message: string): boolean {
  return /(?:ENOENT|ENOTDIR|EISDIR|EACCES|EPERM):/i.test(message)
    || /no such file or directory/i.test(message)
    || /file not found/i.test(message)
    || /cannot find path/i.test(message)
    || /找不到文件|文件不存在|路径不存在|没有那个文件或目录/.test(message)
    || /permission denied/i.test(message);
}

export function isEngineLevelFailure(message: string): boolean {
  const normalized = String(message || '');
  if (!normalized.trim()) return false;
  if (/引擎连续失败|自动恢复\s*\d+\s*次后仍失败/.test(normalized)) return true;
  if (isStepToolFailure(normalized)) return false;

  return /acp\s+connection\s+closed/i.test(normalized)
    || /apierror/i.test(normalized)
    || /模型调用失败(?:\s*\(\s*\d{3}\s*\))?\s*:/i.test(normalized)
    || /(?:unauthorized|invalid token|invalid api key|authentication failed|permission denied)/i.test(normalized)
    || /(?:无效的令牌|令牌无效|认证失败|鉴权失败|API\s*Key\s*无效)/i.test(normalized)
    || /(?:HTTP\s*)?(?:401|403)\b/i.test(normalized)
    || /context window limit/i.test(normalized)
    || /reached (its |the )?context window limit/i.test(normalized)
    || /maximum context length/i.test(normalized)
    || /prompt is too long/i.test(normalized)
    || /SDK API retry limit/i.test(normalized)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/i.test(normalized)
    || /engine (?:not initialized|unavailable|connection .*failed|process .*failed|session .*failed)/i.test(normalized)
    || /failed to create .*process streams/i.test(normalized)
    || /引擎(?:未初始化|初始化失败|不可用|连接.*失败|连接.*断开|连续失败)/.test(normalized);
}

function isTransientEngineFailure(message: string): boolean {
  const normalized = String(message || '');
  if (!normalized.trim()) return false;
  if (/(?:unauthorized|invalid token|invalid api key|authentication failed)/i.test(normalized)) return false;
  if (/(?:无效的令牌|令牌无效|认证失败|鉴权失败|API\s*Key\s*无效)/.test(normalized)) return false;
  if (/(?:HTTP\s*)?(?:401|403)\b/i.test(normalized)) return false;
  if (/context window limit|maximum context length|prompt is too long/i.test(normalized)) return false;

  return /acp\s+connection\s+closed/i.test(normalized)
    || /SDK API retry limit/i.test(normalized)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/i.test(normalized)
    || /(?:HTTP\s*)?(?:429|500|502|503|504)\b/i.test(normalized)
    || /engine (?:unavailable|connection .*failed|process .*failed|session .*failed)/i.test(normalized)
    || /引擎(?:不可用|连接.*失败|连接.*断开)/.test(normalized);
}

function isRecoverableStepExecutionError(message: string): boolean {
  const normalized = String(message || '').trim();
  return Boolean(normalized) && !isEngineLevelFailure(normalized);
}

function buildStepAutoRecoveryPrompt(input: {
  stateName?: string | null;
  stepName: string;
  attempt: number;
  maxAttempts: number;
  error: string;
}) {
  return [
    `## 系统自动恢复（第 ${input.attempt}/${input.maxAttempts} 次）`,
    '',
    '上一次执行当前步骤时出现了可恢复错误。不要停止任务，也不要从头重做整个工作流；请在当前会话中针对错误继续修正并完成本步骤。',
    '',
    `- 当前状态: ${input.stateName || '未指定'}`,
    `- 当前步骤: ${input.stepName}`,
    '',
    '### 完整错误信息',
    '```text',
    input.error,
    '```',
    '',
    '### 恢复要求',
    '- 先根据错误定位原因；如果是文件或路径不存在，请重新检查 workspace、相对路径、文件名、大小写和生成位置。',
    '- 不要假设失败路径一定存在；必要时先列目录或搜索相关文件，再继续。',
    '- 如果某个文件确实不存在，请说明替代依据，并继续完成当前步骤能完成的部分。',
    '- 最终仍需按当前步骤原始要求输出结论或交付物。',
  ].join('\n');
}

function hasAdvancedTransitionCondition(transition: StateTransition): boolean {
  const condition = transition.condition || {};
  return Boolean(
    condition.issueTypes?.length
    || condition.severities?.length
    || condition.minIssueCount !== undefined
    || condition.maxIssueCount !== undefined
  );
}

export class StateMachineWorkflowManager extends EventEmitter {
  private status: 'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' = 'idle';
  private statusReason: string | null = null;
  private shouldStop = false;
  private currentState: string | null = null;
  private currentRunId: string | null = null;
  private currentConfigFile: string = '';
  private currentRequirements: string = '';
  private rootRunId: string | null = null;
  private parentRunId: string | null = null;
  private parentConfigFile: string | null = null;
  private parentStateName: string | null = null;
  private parentStepId: string | null = null;
  private parentStepName: string | null = null;
  private nestingPath: Array<{ runId: string; configFile: string; stepName?: string; stateName?: string }> = [];
  private subworkflowRuns: PersistedSubworkflowRunRef[] = [];
  private activeSubworkflowRunId: string | null = null;
  private subworkflowAuditEvents: PersistedSubworkflowAuditEvent[] = [];
  private workflowSnapshotRoot: string | null = null;
  private workflowSnapshotManifestHash: string | null = null;
  private embeddedProjectRoot: string | null = null;
  private embeddedWorkspaceMode: 'in-place' | 'isolated-copy' | null = null;
  private embeddedContextOverrides: Record<string, any> | null = null;
  private agents: AgentState[] = [];
  private agentConfigs: RoleConfig[] = [];
  private stateHistory: StateTransitionRecord[] = [];
  private issueTracker: Issue[] = [];
  private transitionCount = 0;
  /** Track self-transitions per state for circuit breaking */
  private selfTransitionCounts: Map<string, number> = new Map();
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  /** 累计等待（停摆）时长（毫秒），不计入实际执行时间。 */
  private accumulatedWaitMs: number = 0;
  /** 本次等待开始时刻（ISO），未在等待时为 null。 */
  private waitStartedAt: string | null = null;
  private pendingForceTransition: string | null = null;
  private pendingForceInstruction: string | null = null;
  /** Tracks human approval context for crash recovery */
  private pendingApprovalInfo: {
    suggestedNextState: string;
    availableStates: string[];
    result: any;
    supervisorAdvice?: string;
  } | null = null;
  private globalContext: string = '';
  private stateContexts: Map<string, string> = new Map();
  private workspaceSkillsCache: string = '';
  private workspaceSkillsCacheProjectRoot: string = '';
  private workspaceSkillNames: Set<string> = new Set();
  /** Per-agent prompt memory for omitting unchanged repeated context within one run session. */
  private promptMemos: Map<string, AgentPromptMemo> = new Map();
  /** Skills copied to workspace that need cleanup on finish */
  private copiedSkills: { dir: string; indexCopied: boolean } | null = null;
  private currentStep: string | null = null;
  private activeStepKeys: Set<string> = new Set();
  private activeConcurrencyGroups: ActiveConcurrencyGroup[] = [];
  private channelOutputsById: Map<string, ChannelOutputEntry[]> = new Map();
  private completedSteps: string[] = [];
  private failedSteps: string[] = [];
  private resumeStateName: string | null = null;
  private resumeStepKey: string | null = null;
  private currentProcesses: PersistedProcessInfo[] = [];
  private currentSupervisorAgent: string = DEFAULT_SUPERVISOR_NAME;
  private latestSupervisorReview: {
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision' | 'human-question';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null = null;
  private humanQuestions: HumanQuestion[] = [];
  private pendingHumanQuestionId: string | null = null;
  private humanAnswersContext: HumanAnswerContext[] = [];
  private humanQuestionWaiters = new Map<string, (question: HumanQuestion | null) => void>();
  private specRevisionVote: WorkflowSpecRevisionVoteRecord | null = null;
  private specRevisionVoteHistory: WorkflowSpecRevisionVoteRecord[] = [];
  private specRevisionVoteTail: Promise<void> = Promise.resolve();
  private currentRunSpecCoding: SpecCodingDocument | null = null;
  private currentWorkflowConfig: StateMachineWorkflowConfig | null = null;
  private currentSpecRootDir: string | null = null;
  private deltaSpecMerged: boolean = false;
  private deltaMergeState: DeltaMergeState | undefined;
  private workflowName: string = '';
  private stepTaskBindingsByStepKey: Map<string, StepTaskBindingSnapshot> = new Map();
  private stepTaskBindingsSnapshot: StepTaskBindingSnapshot[] = [];
  private bindingValidation: StepTaskBindingValidation | undefined;
  private supervisorFlow: { type: string; from: string; to: string; question?: string; method?: string; round: number; timestamp: string; stateName?: string }[] = [];
  /** Agent 工作流：追踪 Agent 之间的信息传递 */
  private agentFlow: {
    id: string;
    type: 'stream' | 'request' | 'response' | 'supervisor';
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }[] = [];
  private stepLogs: PersistedStepLog[] = [];
  private qualityChecks: PersistedQualityCheck[] = [];
  /** Current engine instance (Kiro CLI, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';
  private engineExecutionTail: Promise<void> = Promise.resolve();
  private workflowGit: WorkflowGitState | null = null;
  /** Resolved workflow-level MCP servers from context.mcpServers */
  private workflowMcpServers: ManagedMcpServer[] = [];
  private runtimeDatabaseGrant: RuntimeDatabaseGrant | null = null;
  /** Optional frontend chat session to auto-bind with this run */
  public _frontendSessionId?: string;
  /** Explicit creation session to bind to the next run */
  public _creationSessionId?: string;
  private runtimeGeneration = 0;

  /** Get the workspace skills subdir based on current engine type */
  private get workspaceSkillsSubdir(): string {
    return getEngineSkillsSubdir(this.engineType);
  }

  private resolveProjectRootPath(projectRoot?: string | null): string {
    const baseDir = this._userPersonalDir || getWorkspaceRoot();
    return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
  }

  private async resolveWorkflowMcpServers(workflowConfig: StateMachineWorkflowConfig): Promise<void> {
    const names = Array.isArray(workflowConfig.context?.mcpServers)
      ? workflowConfig.context.mcpServers
      : [];
    const baseDirectory = this.getWorkingDirectory() || workflowConfig.context?.projectRoot || this.resolveProjectRootPath();
    this.workflowMcpServers = await resolveMcpServersByNames(names, baseDirectory);
    for (const role of this.agentConfigs || []) {
      if (!Array.isArray((role as any).mcpServers)) continue;
      const roleNames = (role as any).mcpServers.filter((item: unknown): item is string => typeof item === 'string');
      if (roleNames.length === 0) continue;
      (role as any).mcpServers = await resolveMcpServersByNames(roleNames, baseDirectory);
    }
  }

  private getEffectiveMcpServers(roleConfig?: RoleConfig | null): ManagedMcpServer[] {
    return mergeMcpServers(this.workflowMcpServers, roleConfig?.mcpServers as any);
  }

  private getAgentPromptMemo(agentName: string): AgentPromptMemo {
    const key = agentName || 'default';
    let memo = this.promptMemos.get(key);
    if (!memo) {
      memo = { stateContextKeys: {}, skillContentSeen: new Set<string>() };
      this.promptMemos.set(key, memo);
    }
    return memo;
  }

  private isStateLastStep(step: WorkflowStep, state: StateMachineState): boolean {
    const steps = state.steps || [];
    const index = steps.findIndex((item) => item === step || item.name === step.name);
    return index >= 0 && index === steps.length - 1;
  }

  private shouldRequireFinalVerdict(step: WorkflowStep, state: StateMachineState): boolean {
    return this.isStateLastStep(step, state) && !step.parallelGroup;
  }

  private getWorkflowAgoraAgentSessions(): Record<string, string> {
    return Object.fromEntries(
      this.agents
        .filter((agent) => Boolean(agent.sessionId))
        .map((agent) => [agent.name, agent.sessionId as string])
    );
  }

  private getWorkflowAgoraParticipants() {
    const names = new Set<string>();
    const addName = (name?: string | null) => {
      const trimmed = String(name || '').trim();
      if (trimmed) names.add(trimmed);
    };
    addName(this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME);
    this.agents.forEach((agent) => addName(agent.name));
    return createWorkflowParticipants([...names], {
      coordinatorAgent: this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME,
    });
  }

  private async resolveWorkflowFrontendSessionIdForRun(runState: PersistedRunState): Promise<string | null> {
    const persisted = String(runState.workflowFrontendSessionId || '').trim();
    if (persisted) return persisted;
    const current = String(this._frontendSessionId || '').trim();
    if (current) return current;

    const sessions = await listChatSessions().catch(() => []);
    const matched = sessions.find((session) => session.workflowBinding?.runId === runState.runId);
    return matched?.id || null;
  }
  constructor() {
    super();
  }

  private async withEngineExecutionLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.engineExecutionTail.catch(() => {});
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    this.engineExecutionTail = previous.then(() => current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private async autoCompactAgentContextIfNeeded(input: {
    agentName: string;
    stepName: string;
    workflowConfig: StateMachineWorkflowConfig;
    prompt: string;
    systemPrompt: string;
    model: string;
    workingDirectory: string;
    timeoutMs?: number;
  }): Promise<{ prompt: string; sessionId?: string }> {
    const policy = resolveWorkflowExecutionPolicy(input.workflowConfig.context);
    const agent = this.agents.find((item) => item.name === input.agentName);
    const existingSessionId = agent?.sessionId || undefined;
    if (!policy.autoCompactOnStepChange || !existingSessionId || !this.currentEngine) {
      return { prompt: input.prompt, sessionId: existingSessionId };
    }
    if (!this.stepLogs.some((log) => log.agent === input.agentName)) {
      return { prompt: input.prompt, sessionId: existingSessionId };
    }

    try {
      this.emit('log', {
        agent: input.agentName,
        level: 'info',
        message: `步骤切换前自动压缩 ${input.agentName} 的上下文：${input.stepName}`,
      });
      const compacted = await this.withEngineExecutionLock(() => compactEngineContextManually(this.currentEngine!, {
        agent: input.agentName,
        step: input.stepName,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        model: input.model,
        workingDirectory: input.workingDirectory,
        timeoutMs: input.timeoutMs,
        sessionId: existingSessionId,
        appendSystemPrompt: true,
        runId: this.currentRunId || undefined,
      }, {
        buildCompactSource: async () => buildAgentCompactSourceFromStepLogs(this.stepLogs, input.agentName, input.prompt),
      }));
      replaceAgentStateSessionId(agent, compacted.nextSessionId);
      await this.persistState();
      this.emit('log', {
        agent: input.agentName,
        level: 'info',
        message: `已完成步骤级自动上下文总结：${compacted.method}`,
      });
      return {
        prompt: compacted.prompt,
        sessionId: compacted.nextSessionId || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('log', {
        agent: input.agentName,
        level: 'warning',
        message: `步骤级自动上下文总结失败，继续原会话：${message}`,
      });
      return { prompt: input.prompt, sessionId: existingSessionId };
    }
  }

  async loadAgentConfigs(): Promise<void> {
    const agentsDir = await getRuntimeAgentsDirPath();
    this.agentConfigs = [];
    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        try {
          const content = await readFile(resolve(agentsDir, file), 'utf-8');
          const config = parse(content) as RoleConfig;
          if (config?.name) {
            this.agentConfigs.push(config);
          }
        } catch (e) {
        }
      }
    } catch {
    }
    this.agentConfigs = ensureDefaultSupervisorConfig(this.agentConfigs);
  }

  /**
   * Load and cache workspace skills from <engine-config>/skills/
   */
  private async loadWorkspaceSkills(projectRoot: string): Promise<string> {
    if (this.workspaceSkillsCache && this.workspaceSkillsCacheProjectRoot === projectRoot) {
      return this.workspaceSkillsCache;
    }

    // Try project-level first, then server-level skills directory
    const candidates = [
      join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir),
      await getRuntimeSkillsDirPath(),
    ];

    for (const skillsDir of candidates) {
      try {
        const skillIndex = resolve(skillsDir, 'SKILL.md');
        const indexContent = await readFile(skillIndex, 'utf-8');

        this.workspaceSkillNames.clear();
        try {
          const entries = await readdir(skillsDir);
          for (const entry of entries) {
            const entryPath = resolve(skillsDir, entry);
            const entryStat = await stat(entryPath).catch(() => null);
            if (entryStat?.isDirectory()) {
              this.workspaceSkillNames.add(entry);
            }
          }
        } catch { /* ignore */ }

        const result = indexContent.trim();
        this.workspaceSkillsCache = result;
        this.workspaceSkillsCacheProjectRoot = projectRoot;
        return result;
      } catch { /* try next candidate */ }
    }

    this.workspaceSkillsCache = '';
    this.workspaceSkillsCacheProjectRoot = projectRoot;
    this.workspaceSkillNames.clear();
    return '';
  }

  /**
   * Load a single skill's content from project or system skills directory
   */
  private async loadSkillContent(skillName: string, projectRoot: string): Promise<string | null> {
    const projectSkillPath = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir, skillName, 'SKILL.md');
    try {
      return await readFile(projectSkillPath, 'utf-8');
    } catch { /* not found in project */ }

    const systemSkillPath = join(await getRuntimeSkillsDirPath(), skillName, 'SKILL.md');
    try {
      return await readFile(systemSkillPath, 'utf-8');
    } catch { /* not found in system */ }

    return null;
  }

  /**
   * Load agent-level and workflow-level skills, returning formatted prompt content
   */
  private async loadAdditionalSkills(skillNames: string[], projectRoot: string): Promise<string> {
    const unique = [...new Set(skillNames)].filter(n => !this.workspaceSkillNames.has(n));
    if (unique.length === 0) return '';

    const loaded: { name: string; content: string }[] = [];
    for (const name of unique) {
      const content = await this.loadSkillContent(name, projectRoot);
      if (content) loaded.push({ name, content });
    }
    if (loaded.length === 0) return '';

    let result = `### Agent/工作流指定 Skills\n\n`;
    for (const skill of loaded) {
      result += `#### ${skill.name}\n\n${skill.content}\n\n---\n\n`;
    }
    return result;
  }

  /**
   * Copy skills from server skills/ directory to workspace <engine-config>/skills/
   * so that AI agents can discover and read them naturally.
   */
  private async syncSkillsToWorkspace(config: StateMachineWorkflowConfig): Promise<void> {
    const projectRoot = config.context?.projectRoot;
    if (!projectRoot) return;

    const serverSkillsDir = await getRuntimeSkillsDirPath();
    const workspaceSkillsDir = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir);

    if (!existsSync(serverSkillsDir)) return;

    // Collect all skill names needed: context.skills + agent.skills
    const needed = new Set<string>();
    if (config.context?.skills) config.context.skills.forEach(s => needed.add(s));
    for (const roleConfig of this.agentConfigs || []) {
      if (Array.isArray((roleConfig as any).skills)) {
        (roleConfig as any).skills.forEach((s: string) => needed.add(s));
      }
    }
    if (needed.size === 0) {
      // 没有指定 skills 时，只逐项链接非 CSIHarness 内置 skill，避免镜像整棵目录。
      await mkdir(workspaceSkillsDir, { recursive: true });
      const entries = await readdir(serverSkillsDir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory() || isAceHarnessSkillName(entry.name)) continue;
        const src = resolve(serverSkillsDir, entry.name);
        const dst = resolve(workspaceSkillsDir, entry.name);
        if (existsSync(dst)) continue;
        try {
          createDirectoryLinkSync(src, dst);
          console.log(`[SM-Skills] 已链接 skill "${entry.name}" → ${dst}`);
        } catch (error) {
          console.warn(`[SM-Skills] 链接 skill "${entry.name}" 失败:`, error);
        }
      }
      return;
    }

    const dirExistedBefore = existsSync(workspaceSkillsDir);
    await mkdir(workspaceSkillsDir, { recursive: true });

    const linkedNames: string[] = [];
    for (const skillName of needed) {
      if (isAceHarnessSkillName(skillName)) continue;
      const src = resolve(serverSkillsDir, skillName);
      const dst = resolve(workspaceSkillsDir, skillName);
      if (!existsSync(src)) continue;
      if (existsSync(dst)) continue;
      try {
        createDirectoryLinkSync(src, dst);
        linkedNames.push(skillName);
        console.log(`[SM-Skills] 已链接 skill "${skillName}" → ${dst}`);
      } catch (error) {
        console.warn(`[SM-Skills] 链接 skill "${skillName}" 失败:`, error);
      }
    }

    if (linkedNames.length > 0) {
      this.copiedSkills = { dir: workspaceSkillsDir, indexCopied: false };
      (this.copiedSkills as any).names = linkedNames;
      (this.copiedSkills as any).dirExistedBefore = dirExistedBefore;
    }
  }

  /**
   * Remove skills that were linked/copied to workspace during syncSkillsToWorkspace
   */
  private async cleanupWorkspaceSkills(): Promise<void> {
    if (!this.copiedSkills) return;
    const { dir } = this.copiedSkills;
    const names: string[] = (this.copiedSkills as any).names || [];
    const dirExistedBefore: boolean = (this.copiedSkills as any).dirExistedBefore ?? true;

    for (const name of names) {
      const dst = resolve(dir, name);
      try {
        await rm(dst, { recursive: true, force: true });
        console.log(`[SM-Skills] 已清理 skill "${name}"`);
      } catch { /* ignore */ }
    }

    if (!dirExistedBefore) {
      try {
        const remaining = await readdir(dir);
        if (remaining.length === 0) {
          await rm(dir, { recursive: true, force: true });
          const configDir = resolve(dir, '..');
          const configRemaining = await readdir(configDir);
          if (configRemaining.length === 0) {
            await rm(configDir, { recursive: true, force: true });
          }
        }
      } catch { /* ignore */ }
    }

    this.copiedSkills = null;
  }

  /**
   * Copy a directory with progress updates so frontend can show preparation details.
   */
  private async copyDirectoryWithProgress(
    srcDir: string,
    destDir: string,
    runId: string,
    reportStatus: (message: string, step: string) => Promise<void>
  ): Promise<void> {
    const files: Array<{ src: string; dst: string; size: number }> = [];
    const formatBytes = (bytes: number): string => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = bytes;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    };

    await reportStatus('准备中：扫描目录并计算总体积...', '复制工作目录（建立清单）');

    const stack = [{ src: srcDir, dst: destDir }];
    let scannedFiles = 0;
    let lastScanReport = 0;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const entries = await readdir(cur.src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(cur.src, entry.name);
        const dstPath = join(cur.dst, entry.name);
        if (entry.isDirectory()) {
          stack.push({ src: srcPath, dst: dstPath });
          continue;
        }
        let size = 0;
        try { size = (await stat(srcPath)).size; } catch { /* keep zero */ }
        files.push({ src: srcPath, dst: dstPath, size });
        scannedFiles += 1;
        const now = Date.now();
        if (now - lastScanReport > 1000) {
          lastScanReport = now;
          this.currentStep = `复制工作目录（建立清单：已扫描 ${scannedFiles} 文件）`;
          this.emit('status', {
            status: 'preparing',
            message: `准备中：建立清单，已扫描 ${scannedFiles} 文件`,
            runId,
            startTime: this.runStartTime,
            currentPhase: '准备阶段',
            currentStep: this.currentStep,
            currentConfigFile: this.currentConfigFile,
          });
        }
      }
    }

    const totalFiles = files.length;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    if (totalFiles === 0) {
      await reportStatus('准备中：工作目录为空，无需复制', '复制工作目录 (完成)');
      return;
    }

    let copiedFiles = 0;
    let copiedBytes = 0;
    const copyStartAt = Date.now();
    let displayedEtaSec: number | null = null;
    let speedEma = 0;
    const speedSamples: Array<{ t: number; bytes: number }> = [];

    const buildStepText = (etaSec: number | null): string => {
      const percent = Math.min(100, Math.round((copiedBytes / Math.max(totalBytes, 1)) * 100));
      const etaText = etaSec === null ? '计算中' : `${etaSec}s`;
      return `复制工作目录 (${formatBytes(copiedBytes)}/${formatBytes(totalBytes)}，${percent}%，文件 ${copiedFiles}/${totalFiles}，预计剩余${etaText})`;
    };

    const emitProgress = async (force = false) => {
      const now = Date.now();
      speedSamples.push({ t: now, bytes: copiedBytes });
      while (speedSamples.length > 1 && now - speedSamples[0].t > 20000) speedSamples.shift();

      let etaSec: number | null = null;
      if (speedSamples.length >= 2) {
        const first = speedSamples[0];
        const last = speedSamples[speedSamples.length - 1];
        const dt = Math.max(1, (last.t - first.t) / 1000);
        const instSpeed = Math.max(0, (last.bytes - first.bytes) / dt);
        if (instSpeed > 0) {
          speedEma = speedEma === 0 ? instSpeed : (speedEma * 0.75 + instSpeed * 0.25);
        }
      }
      if (speedEma > 0 && copiedBytes < totalBytes) {
        etaSec = Math.max(1, Math.ceil((totalBytes - copiedBytes) / speedEma));
        if (displayedEtaSec !== null) etaSec = Math.min(displayedEtaSec, etaSec);
        displayedEtaSec = etaSec;
      } else if (copiedBytes >= totalBytes) {
        etaSec = 0;
        displayedEtaSec = 0;
      }

      const stepText = buildStepText(etaSec);
      this.currentStep = stepText;
      this.emit('status', {
        status: 'preparing',
        message: `准备中：${stepText}`,
        runId,
        startTime: this.runStartTime,
        currentPhase: '准备阶段',
        currentStep: this.currentStep,
        currentConfigFile: this.currentConfigFile,
      });
      if (force) {
        await reportStatus(`准备中：${stepText}`, this.currentStep);
      }
    };

    await emitProgress(true);

    const maxWorkers = Math.min(32, Math.max(8, cpus().length * 2));
    const workerCount = Math.min(maxWorkers, totalFiles);
    let cursor = 0;

    const worker = async () => {
      while (!this.shouldStop) {
        const idx = cursor++;
        if (idx >= totalFiles) break;
        const file = files[idx];
        await mkdir(dirname(file.dst), { recursive: true });
        await copyFile(file.src, file.dst);
        copiedFiles += 1;
        copiedBytes += file.size;
      }
    };

    const ticker = setInterval(() => {
      void emitProgress(false);
    }, 1000);

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      clearInterval(ticker);
    }

    await emitProgress(true);
  }

  getStatus() {
    const supervisorAgent = this.agents.find((agent) => agent.name === this.currentSupervisorAgent);
    const preparingPhase = this.status === 'preparing' ? '准备阶段' : null;
    const runSpecCoding = this.currentRunSpecCoding
      ? normalizeSpecCodingDocument(this.currentRunSpecCoding)
      : null;
    const subworkflowSummary = this.buildSubworkflowRunSummary(this.subworkflowRuns);
    return {
      status: this.status,
      statusReason: this.statusReason,
      runId: this.currentRunId,
      currentState: this.currentState,
      currentPhase: this.currentState || preparingPhase, // alias for frontend compatibility
      currentStep: this.currentStep,
      activeSteps: Array.from(this.activeStepKeys),
      activeConcurrencyGroups: this.activeConcurrencyGroups,
      pendingLiveFeedback: toLiveFeedbackSnapshot(this.liveFeedback),
      completedSteps: this.completedSteps,
      failedSteps: this.failedSteps,
      currentConfigFile: this.currentConfigFile,
      agents: this.agents,
      stateHistory: this.stateHistory,
      issueTracker: this.issueTracker,
      transitionCount: this.transitionCount,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      accumulatedWaitMs: this.accumulatedWaitMs,
      waitStartedAt: this.waitStartedAt,
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
      supervisorFlow: this.supervisorFlow,
      agentFlow: this.agentFlow,
      stepLogs: this.stepLogs,
      childRunIds: this.subworkflowRuns.map((item) => item.runId),
      subworkflowRuns: this.subworkflowRuns,
      subworkflowSummary,
      activeSubworkflowRunId: this.activeSubworkflowRunId,
      subworkflowAuditEvents: this.subworkflowAuditEvents,
      workflowSnapshotRoot: this.workflowSnapshotRoot,
      workflowSnapshotManifestHash: this.workflowSnapshotManifestHash,
      runOwnerId: this._createdBy,
      runOwnerName: this._createdByName,
      createdBy: this._createdBy,
      createdByName: this._createdByName,
      workingDirectory: this.getWorkingDirectory(),
      workspaceGit: this.workflowGit || undefined,
      supervisorAgent: this.currentSupervisorAgent,
      supervisorSessionId: supervisorAgent?.sessionId || null,
      workflowFrontendSessionId: this._frontendSessionId || null,
      attachedAgentSessions: Object.fromEntries(
        this.agents
          .filter((agent) => Boolean(agent.sessionId))
          .map((agent) => [agent.name, agent.sessionId as string])
      ),
      latestSupervisorReview: this.latestSupervisorReview,
      humanQuestions: this.humanQuestions,
      pendingHumanQuestionId: this.pendingHumanQuestionId,
      pendingHumanQuestion: this.getPendingHumanQuestion(),
      humanAnswersContext: this.humanAnswersContext,
      specRevisionVote: this.specRevisionVote,
      specRevisionVoteHistory: this.specRevisionVoteHistory,
      qualityChecks: this.qualityChecks,
      runSpecCoding,
      stepTaskBindingsSnapshot: this.stepTaskBindingsSnapshot,
      bindingValidation: this.bindingValidation,
      persistMode: this.currentRunSpecCoding?.persistMode,
      specRootDir: this.currentSpecRootDir,
      deltaSpecMerged: this.deltaSpecMerged,
      deltaMergeState: this.deltaMergeState,
    };
  }

  private buildSubworkflowRunSummary(runs: PersistedSubworkflowRunRef[] = []) {
    const counts = {
      total: runs.length,
      active: 0,
      failed: 0,
      waitingHuman: 0,
      detached: 0,
      completed: 0,
      stopped: 0,
      superseded: 0,
      abandoned: 0,
    };
    for (const ref of runs) {
      if (ref.status === 'pending' || ref.status === 'starting' || ref.status === 'running') counts.active += 1;
      if (ref.status === 'failed' || ref.status === 'crashed') counts.failed += 1;
      if (ref.status === 'waiting-human') counts.waitingHuman += 1;
      if (ref.status === 'detached') counts.detached += 1;
      if (ref.status === 'completed') counts.completed += 1;
      if (ref.status === 'stopped' || ref.status === 'cancelled') counts.stopped += 1;
      if (ref.status === 'superseded') counts.superseded += 1;
      if (ref.status === 'abandoned') counts.abandoned += 1;
    }
    return {
      ...counts,
      latest: runs.at(-1) || null,
    };
  }

  private async syncRunSpecCodingDelta(): Promise<void> {
    if (!this.currentRunSpecCoding || this.currentRunSpecCoding.persistMode !== 'repository' || !this.currentRunId) {
      return;
    }
    const specRootDir = this.currentSpecRootDir
      || (this.getWorkingDirectory() ? getSpecRootDir(this.getWorkingDirectory()!, this.currentRunSpecCoding.specRoot) : null);
    if (!specRootDir) return;
    this.currentSpecRootDir = specRootDir;
    await ensureSpecDirStructure(specRootDir);
    await writeDeltaSpec(specRootDir, this.workflowName, this.currentRunId, this.currentRunSpecCoding);
  }

  async applySupervisorChatSpecCodingRevision(input: {
    supervisorAgent: string;
    summary: string;
    content: string;
    affectedArtifacts?: string[];
    impact?: string[];
  }): Promise<SpecCodingDocument | null> {
    if (!this.currentRunId || !this.currentRunSpecCoding) return null;

    this.currentRunSpecCoding = appendSpecCodingRevision(this.currentRunSpecCoding, {
      summary: input.summary,
      createdBy: input.supervisorAgent,
      status: this.currentRunSpecCoding.status,
      progressSummary: input.summary,
    });
    this.latestSupervisorReview = {
      type: 'chat-revision',
      stateName: this.currentState || '全局',
      content: input.content,
      timestamp: new Date().toISOString(),
      affectedArtifacts: input.affectedArtifacts || [],
      impact: input.impact || [],
    };
    await this.persistState();
    await this.syncRunSpecCodingDelta().catch(() => {});
    this.emit('supervisor-review', this.latestSupervisorReview);
    return this.currentRunSpecCoding;
  }

  async importWorkspaceDeltaSpecRevision(input?: {
    summary?: string;
    createdBy?: string;
  }): Promise<SpecCodingDocument | null> {
    if (!this.currentRunId || !this.currentRunSpecCoding || this.currentRunSpecCoding.persistMode !== 'repository') {
      return null;
    }
    const specRootDir = this.currentSpecRootDir
      || (this.getWorkingDirectory() ? getSpecRootDir(this.getWorkingDirectory()!, this.currentRunSpecCoding.specRoot) : null);
    if (!specRootDir) {
      throw new Error('缺少 Spec 根目录，无法导入 workspace delta spec');
    }

    const deltaSpec = await readDeltaSpec(specRootDir, this.workflowName, this.currentRunId);
    if (!deltaSpec) {
      throw new Error('Delta spec 不存在，无法导入 workspace 修改');
    }

    const nextSpecCoding = importWorkspaceArtifactsIntoRunSpecCoding({
      current: this.currentRunSpecCoding,
      artifacts: deltaSpec.artifacts,
      summary: input?.summary || '用户从 workspace delta spec 导入修订',
      createdBy: input?.createdBy,
    });

    if (this.currentWorkflowConfig) {
      const compiled = compileStepTaskBindings(this.currentWorkflowConfig, nextSpecCoding);
      if (!compiled.validation.ok) {
        throw Object.assign(new Error('导入后的 Spec task 与 workflow step 绑定不一致'), {
          bindingValidation: compiled.validation,
        });
      }
      this.currentWorkflowConfig = compiled.config as StateMachineWorkflowConfig;
      this.bindingValidation = compiled.validation;
      this.stepTaskBindingsSnapshot = compiled.validation.bindings;
      this.stepTaskBindingsByStepKey = new Map(
        this.stepTaskBindingsSnapshot.map((binding) => [binding.stepKey, binding])
      );
    }

    this.currentSpecRootDir = specRootDir;
    this.currentRunSpecCoding = nextSpecCoding;
    this.deltaSpecMerged = false;
    this.deltaMergeState = {
      ...(this.deltaMergeState || {}),
      status: 'available',
      requestedAt: this.deltaMergeState?.requestedAt || new Date().toISOString(),
      error: undefined,
    };
    await this.persistState();
    await this.syncRunSpecCodingDelta();
    this.emit('status', {
      status: this.status,
      message: '已从 workspace delta spec 导入用户修订',
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: this.currentState,
      currentStep: this.currentStep,
      activeSteps: Array.from(this.activeStepKeys),
      completedSteps: this.completedSteps,
      currentConfigFile: this.currentConfigFile,
      deltaSpecMerged: this.deltaSpecMerged,
      deltaMergeState: this.deltaMergeState,
      ...this.buildRunSpecCodingStatusPayload(),
    });
    return this.currentRunSpecCoding;
  }

  async start(
    configFile: string,
    requirementsOrChecks?: string | PersistedQualityCheck[],
    maybePreflightChecks?: PersistedQualityCheck[],
    initialContexts?: { globalContext?: string; phaseContexts?: Record<string, string> },
    requestedRunId?: string,
  ): Promise<void> {
    if (this.status === 'running' || this.status === 'preparing') {
      throw new Error('工作流已在运行中');
    }

    try {
      const requirements = typeof requirementsOrChecks === 'string' ? requirementsOrChecks : undefined;
      const preflightChecks = Array.isArray(requirementsOrChecks)
        ? requirementsOrChecks
        : (maybePreflightChecks || []);
      this.status = 'preparing';
      this.shouldStop = false;
      this.stateHistory = [];
      this.issueTracker = [];
      this.transitionCount = 0;
      this.selfTransitionCounts = new Map();
      this.completedSteps = [];
      this.failedSteps = [];
      this.resumeStateName = null;
      this.resumeStepKey = null;
      this.activeStepKeys.clear();
      this.activeConcurrencyGroups = [];
      this.channelOutputsById.clear();
      this.currentProcesses = [];
      this.supervisorFlow = [];
      this.agentFlow = [];
      this.stepLogs = [];
      this.qualityChecks = [...preflightChecks];
      this.currentState = null;
      this.currentSupervisorAgent = DEFAULT_SUPERVISOR_NAME;
      this.latestSupervisorReview = null;
      this.specRevisionVote = null;
      this.specRevisionVoteHistory = [];
      this.specRevisionVoteTail = Promise.resolve();
      this.currentRunSpecCoding = null;
      this.currentSpecRootDir = null;
      this.workflowGit = null;
      this.workflowMcpServers = [];
      this.stepTaskBindingsByStepKey.clear();
      this.stepTaskBindingsSnapshot = [];
      this.bindingValidation = undefined;
      this.runStartTime = new Date().toISOString();
      this.accumulatedWaitMs = 0;
      this.waitStartedAt = null;
      this.currentConfigFile = configFile;
      this.rootRunId = null;
      this.parentRunId = null;
      this.parentConfigFile = null;
      this.parentStateName = null;
      this.parentStepId = null;
      this.parentStepName = null;
      this.nestingPath = [];
      this.subworkflowRuns = [];
      this.activeSubworkflowRunId = null;
      this.subworkflowAuditEvents = [];
      this.workflowSnapshotRoot = null;
      this.workflowSnapshotManifestHash = null;
      this.embeddedProjectRoot = null;
      this.embeddedWorkspaceMode = null;
      this.embeddedContextOverrides = null;
      this.isolatedDir = null;
      this.currentProjectRoot = null;

      // Clear stale in-memory flags from previous run
      this.pendingForceTransition = null;
      this.pendingForceInstruction = null;
      this.pendingApprovalInfo = null;
      this.humanQuestions = [];
      this.pendingHumanQuestionId = null;
      this.humanAnswersContext = [];
      this.humanQuestionWaiters.clear();
      this.interruptFlag = false;
      this.feedbackInterrupt = false;
      this.liveFeedback = [];
      this.globalContext = initialContexts?.globalContext || '';
      this.stateContexts = new Map(Object.entries(initialContexts?.phaseContexts || {}));

      this.parentRunId = typeof (this as any)._parentRunId === 'string' ? (this as any)._parentRunId : null;
      this.parentConfigFile = typeof (this as any)._parentConfigFile === 'string' ? (this as any)._parentConfigFile : null;
      this.parentStateName = typeof (this as any)._parentStateName === 'string' ? (this as any)._parentStateName : null;
      this.parentStepId = typeof (this as any)._parentStepId === 'string' ? (this as any)._parentStepId : null;
      this.parentStepName = typeof (this as any)._parentStepName === 'string' ? (this as any)._parentStepName : null;
      this.rootRunId = typeof (this as any)._rootRunId === 'string' ? (this as any)._rootRunId : null;
      this.nestingPath = Array.isArray((this as any)._nestingPath) ? [...(this as any)._nestingPath] : [];
      this.embeddedProjectRoot = typeof (this as any)._embeddedProjectRoot === 'string' ? (this as any)._embeddedProjectRoot : null;
      this.embeddedWorkspaceMode = (this as any)._embeddedWorkspaceMode === 'isolated-copy' ? 'isolated-copy' : ((this as any)._embeddedWorkspaceMode === 'in-place' ? 'in-place' : null);
      this.embeddedContextOverrides = (this as any)._embeddedContextOverrides && typeof (this as any)._embeddedContextOverrides === 'object'
        ? { ...(this as any)._embeddedContextOverrides }
        : null;

      // Load config
      const configContent = await this.readWorkflowConfigContent(configFile);
      let workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
      this.currentWorkflowConfig = workflowConfig;
      this.workflowName = workflowConfig.workflow.name || '';
      this.currentRequirements = requirements || workflowConfig.context?.requirements || '';
      this.currentSupervisorAgent = resolveWorkflowSupervisorAgent(workflowConfig);
      if (this.embeddedProjectRoot) {
        const nextContext = {
          ...(workflowConfig.context || {}),
          ...(this.embeddedContextOverrides || {}),
          projectRoot: this.embeddedProjectRoot,
          workspaceMode: this.embeddedWorkspaceMode || 'in-place',
        } as any;
        if (this.embeddedContextOverrides?.__mergeMcpServers) {
          nextContext.mcpServers = Array.from(new Set([
            ...((Array.isArray(workflowConfig.context?.mcpServers) ? workflowConfig.context.mcpServers : [])),
            ...((Array.isArray(this.embeddedContextOverrides.mcpServers) ? this.embeddedContextOverrides.mcpServers : [])),
          ]));
          delete nextContext.__mergeMcpServers;
        }
        if (this.embeddedContextOverrides?.__mergeSkills) {
          nextContext.skills = Array.from(new Set([
            ...((Array.isArray((workflowConfig.context as any)?.skills) ? (workflowConfig.context as any).skills : [])),
            ...((Array.isArray(this.embeddedContextOverrides.skills) ? this.embeddedContextOverrides.skills : [])),
          ]));
          delete nextContext.__mergeSkills;
        }
        if (this.embeddedContextOverrides?.__mergeRagKnowledgeBases) {
          nextContext.capabilitySkills = this.mergeRagCapabilitySkills(
            workflowConfig.context?.capabilitySkills,
            this.embeddedContextOverrides.capabilitySkills,
          );
          nextContext.skills = this.ensureRagSkill(nextContext.skills);
          delete nextContext.__mergeRagKnowledgeBases;
        } else if (this.embeddedContextOverrides?.capabilitySkills?.rag) {
          nextContext.capabilitySkills = {
            ...((workflowConfig.context as any)?.capabilitySkills || {}),
            ...(this.embeddedContextOverrides.capabilitySkills || {}),
          };
        }
        if (this.hasRagCapability(nextContext.capabilitySkills)) {
          nextContext.skills = this.ensureRagSkill(nextContext.skills);
        }
        workflowConfig = {
          ...workflowConfig,
          context: nextContext,
        };
        this.currentWorkflowConfig = workflowConfig;
      } else if (this.embeddedContextOverrides) {
        const nextContext = {
          ...(workflowConfig.context || {}),
          ...this.embeddedContextOverrides,
        } as any;
        if (this.embeddedContextOverrides.__mergeMcpServers) {
          nextContext.mcpServers = Array.from(new Set([
            ...((Array.isArray(workflowConfig.context?.mcpServers) ? workflowConfig.context.mcpServers : [])),
            ...((Array.isArray(this.embeddedContextOverrides.mcpServers) ? this.embeddedContextOverrides.mcpServers : [])),
          ]));
          delete nextContext.__mergeMcpServers;
        }
        if (this.embeddedContextOverrides.__mergeSkills) {
          nextContext.skills = Array.from(new Set([
            ...((Array.isArray((workflowConfig.context as any)?.skills) ? (workflowConfig.context as any).skills : [])),
            ...((Array.isArray(this.embeddedContextOverrides.skills) ? this.embeddedContextOverrides.skills : [])),
          ]));
          delete nextContext.__mergeSkills;
        }
        if (this.embeddedContextOverrides.__mergeRagKnowledgeBases) {
          nextContext.capabilitySkills = this.mergeRagCapabilitySkills(
            workflowConfig.context?.capabilitySkills,
            this.embeddedContextOverrides.capabilitySkills,
          );
          nextContext.skills = this.ensureRagSkill(nextContext.skills);
          delete nextContext.__mergeRagKnowledgeBases;
        } else if (this.embeddedContextOverrides.capabilitySkills?.rag) {
          nextContext.capabilitySkills = {
            ...((workflowConfig.context as any)?.capabilitySkills || {}),
            ...(this.embeddedContextOverrides.capabilitySkills || {}),
          };
        }
        if (this.hasRagCapability(nextContext.capabilitySkills)) {
          nextContext.skills = this.ensureRagSkill(nextContext.skills);
        }
        workflowConfig = {
          ...workflowConfig,
          context: nextContext,
        };
        this.currentWorkflowConfig = workflowConfig;
      }
      // Resolve projectRoot to absolute path relative to user's personal dir
      this.currentProjectRoot = workflowConfig.context?.projectRoot
        ? this.resolveProjectRootPath(workflowConfig.context.projectRoot)
        : null;

      if (workflowConfig.workflow.mode !== 'state-machine') {
        throw new Error('配置文件不是状态机模式');
      }
      this.assertRequiredVerdictTransitions(workflowConfig);

      // === Create run FIRST so frontend can see it immediately ===
      const totalSteps = workflowConfig.workflow.states.reduce(
        (sum, s) => sum + s.steps.length, 0
      );
      const runId = requestedRunId || `run-${formatTimestamp()}`;
      this.currentRunId = runId;
      if (!this.rootRunId) this.rootRunId = runId;
      if (!this.nestingPath.length) {
        this.nestingPath = [{ runId, configFile, stepName: 'Root' }];
      }

      await createRun({
        id: runId,
        configFile,
        configName: workflowConfig.workflow.name,
        startTime: this.runStartTime,
        endTime: null,
        status: 'preparing',
        currentPhase: null,
        totalSteps,
        completedSteps: 0,
      });

      this.emit('status', {
        status: 'preparing',
        message: '准备中...',
        runId,
        startTime: this.runStartTime,
        currentPhase: '准备阶段',
        currentStep: '初始化运行上下文',
        currentConfigFile: this.currentConfigFile,
        workflowFrontendSessionId: this._frontendSessionId || null,
      });
      this.currentStep = '初始化运行上下文';
      await this.persistState();

      const creationSession = this._creationSessionId
        ? await loadCreationSession(this._creationSessionId).catch(() => null)
        : null;
      if (creationSession?.specCoding) {
        this.currentRunSpecCoding = cloneSpecCodingForRun(creationSession.specCoding, {
          runId,
          filename: configFile,
        });
        const compiled = compileStepTaskBindings(workflowConfig, this.currentRunSpecCoding);
        workflowConfig = compiled.config as StateMachineWorkflowConfig;
        this.currentWorkflowConfig = workflowConfig;
        this.assertRequiredVerdictTransitions(workflowConfig);
        this.bindingValidation = compiled.validation;
        this.stepTaskBindingsSnapshot = compiled.validation.bindings;
        this.stepTaskBindingsByStepKey = new Map(
          this.stepTaskBindingsSnapshot.map((binding) => [binding.stepKey, binding])
        );
        if (!compiled.validation.ok) {
          throw new Error(`Spec task 绑定校验失败: ${compiled.validation.errors.join('; ')}`);
        }
        // 持久化 spec 模式：初始化 delta 目录并写入初始快照
        if (this.currentRunSpecCoding.persistMode === 'repository') {
          const workingDir = this.currentProjectRoot || this.getWorkingDirectory() || workflowConfig.context?.projectRoot || '';
          if (workingDir) {
            this.currentSpecRootDir = getSpecRootDir(workingDir, this.currentRunSpecCoding.specRoot);
            await this.syncRunSpecCodingDelta();
          }
        }
        await this.persistState();
      }

      const reportPreparingProgress = async (message: string, step: string) => {
        this.currentStep = step;
        this.emit('status', {
          status: 'preparing',
          message,
          runId,
          startTime: this.runStartTime,
          currentPhase: '准备阶段',
          currentStep: this.currentStep,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.persistState();
      };

      const workspaceMode = workflowConfig.context?.workspaceMode || 'isolated-copy';

      // === Preparing phase: directory isolation (cp for independence) ===
      if (workspaceMode === 'isolated-copy' && this._userPersonalDir && workflowConfig.context?.projectRoot) {
        await reportPreparingProgress('准备中：复制工作目录...', '复制工作目录');
        // Resolve projectRoot relative to personalDir or runtime root, not install cwd
        const srcDir = this.resolveProjectRootPath(workflowConfig.context.projectRoot);
        if (this.shouldStop) return;
        if (!existsSync(srcDir)) {
          this.emit('log', { message: `项目目录不存在: ${srcDir}，跳过目录隔离` });
        } else {
          const isoDir = resolve(this._userPersonalDir, runId);
          try {
            await mkdir(isoDir, { recursive: true });
            // Persist target working directory early so cleanup can find it
            this.isolatedDir = isoDir;
            this.currentProjectRoot = isoDir;
            await this.persistState();
            await this.copyDirectoryWithProgress(srcDir, isoDir, runId, reportPreparingProgress);
            if (this.shouldStop) {
              // Stopped during copy — clean up incomplete dir
              await rm(isoDir, { recursive: true, force: true }).catch(() => {});
              return;
            }
            workflowConfig.context.projectRoot = isoDir;
          } catch (e: any) {
            if (this.shouldStop) return;
            this.isolatedDir = null;
            this.emit('log', { message: `目录隔离复制失败: ${e.message}，使用原目录` });
          }
        }
      }

      if (this.shouldStop) return;

      const workflowGitWorkspacePath = this.getWorkingDirectory() || workflowConfig.context?.projectRoot;
      if (workflowGitWorkspacePath && workflowConfig.context?.gitBaselineEnabled !== false) {
        await reportPreparingProgress('准备中：建立 Git 基线...', '建立 Git 基线');
        await this.ensureWorkflowGitBaseline(workflowGitWorkspacePath);
      } else if (workflowGitWorkspacePath) {
        await this.disableWorkflowGitBaseline(workflowGitWorkspacePath);
      }

      // === Preparing phase: load agents, init engine, sync skills ===
      await reportPreparingProgress('准备中：加载 Agent 配置...', '加载 Agent 配置');
      await this.loadAgentConfigs();
      this.ensureSupervisorAgentExists(workflowConfig);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：构建 Agent 视图...', '构建 Agent 视图');
      this.initializeAgents(workflowConfig);
      await reportPreparingProgress('准备中：初始化执行引擎...', '初始化执行引擎');
        await this.initializeEngine(resolveWorkflowExecutionPolicy(workflowConfig.context).defaultEngine || workflowConfig.context?.engine);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：加载 MCP 配置...', '加载 MCP 配置');
      await this.resolveWorkflowMcpServers(workflowConfig);
      const agentRagKnowledgeBases = (workflowConfig.roles || this.agentConfigs || []).flatMap((role: any) => Array.isArray(role?.ragKnowledgeBases) ? role.ragKnowledgeBases : []);
      workflowConfig.context.skills = expandDatabaseCapabilitySkillNames({
        skills: workflowConfig.context.skills,
        capabilitySkills: workflowConfig.context.capabilitySkills,
        agentRagKnowledgeBases,
      });
      this.runtimeDatabaseGrant = await createRuntimeDatabaseGrant({
        capabilitySkills: workflowConfig.context.capabilitySkills,
        skills: workflowConfig.context.skills,
        agentRagKnowledgeBases,
        workspaceRoot: workflowConfig.context.projectRoot || workflowGitWorkspacePath || process.cwd(),
        runId,
        workflowConfigFile: configFile,
      });
      await writeRuntimeDatabaseEnvFile(this.runtimeDatabaseGrant);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：同步 Skills...', '同步 Skills');
      await this.syncSkillsToWorkspace(workflowConfig);

      // Try to load existing state (for continuing previous runs)
      const existingState = await loadRunState(runId);
      if (existingState) {
        this._creationSessionId = existingState.creationSessionId || this._creationSessionId;
        this.stateHistory = (existingState.stateHistory || []) as StateTransitionRecord[];
        this.issueTracker = (existingState.issueTracker || []) as Issue[];
        this.transitionCount = existingState.transitionCount || 0;
        this.completedSteps = existingState.completedSteps || [];
        this.failedSteps = existingState.failedSteps || this.deriveFailedStepKeys(existingState.stepLogs || []);
        const validStates = new Set((workflowConfig.workflow.states || []).map((s) => s.name));
        const restoredState = existingState.currentState;
        this.currentState = restoredState && validStates.has(restoredState) ? restoredState : null;
        this.currentStep = existingState.currentStep || this.currentStep;
        this.runStartTime = existingState.startTime;
        // 恢复累计等待时长，并把"停摆→恢复"这段间隔计入等待。
        this.accumulatedWaitMs = existingState.accumulatedWaitMs || 0;
        {
          const pauseStartedAt = existingState.waitStartedAt || existingState.endTime;
          if (pauseStartedAt) {
            this.accumulatedWaitMs += Math.max(0, Date.now() - new Date(pauseStartedAt).getTime());
          }
        }
        this.waitStartedAt = null;
        this.latestSupervisorReview = existingState.latestSupervisorReview || this.latestSupervisorReview;
        this.humanQuestions = existingState.humanQuestions || [];
        this.pendingHumanQuestionId = existingState.pendingHumanQuestionId || existingState.pendingCheckpoint?.humanQuestionId || null;
        this.humanAnswersContext = existingState.humanAnswersContext || [];
        this.specRevisionVote = existingState.specRevisionVote || null;
        this.specRevisionVoteHistory = existingState.specRevisionVoteHistory || [];
        this.currentRunSpecCoding = existingState.runSpecCoding
          ? normalizeSpecCodingDocument(existingState.runSpecCoding)
          : this.currentRunSpecCoding;
        this.currentSpecRootDir = existingState.specRootDir || this.currentSpecRootDir;
        this.bindingValidation = existingState.bindingValidation || this.bindingValidation;
        this.stepTaskBindingsSnapshot = existingState.stepTaskBindingsSnapshot || this.stepTaskBindingsSnapshot;
        this.stepTaskBindingsByStepKey = new Map(
          this.stepTaskBindingsSnapshot.map((binding) => [binding.stepKey, binding])
        );
      }

      // === Switch to running ===
      this.status = 'running';
      this.currentStep = null;
      this.resumeStateName = null;
      this.resumeStepKey = null;
      this.emit('status', {
        status: 'running',
        message: '状态机工作流已启动',
        runId,
        startTime: this.runStartTime,
        endTime: this.runEndTime,
        currentConfigFile: this.currentConfigFile,
        workingDirectory: this.getWorkingDirectory(),
        workflowFrontendSessionId: this._frontendSessionId || null,
      });
      await this.persistState();

      await this.executeStateMachine(workflowConfig, this.currentRequirements);
      await this.specRevisionVoteTail.catch(() => {});

      if (!this.shouldStop) {
        this.status = 'completed';
        this.clearRuntimeActivity();
        this.completeRunSpecCoding('工作流执行完成。');
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          runId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
          ...this.buildRunSpecCodingStatusPayload(),
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'failed',
          message: error.message,
          runId: this.currentRunId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    const childRunId = this.activeSubworkflowRunId;
    if (childRunId) {
      const runtime = this.getActiveSubworkflowRuntime(childRunId);
      if (runtime.stopPropagation === 'detach') {
        const ref = this.subworkflowRuns.find((item) => item.runId === childRunId);
        if (ref) {
          this.upsertSubworkflowRun({
            ...ref,
            status: 'detached',
            summary: '父工作流已停止；该子工作流按 stopPropagation=detach 脱离父流程继续运行。',
          });
          this.emit('subworkflow-status', {
            parentRunId: this.currentRunId,
            runId: childRunId,
            status: 'detached',
            reason: 'parent-stopped',
          });
        }
        this.activeSubworkflowRunId = null;
      } else {
        try {
          const { workflowRegistry } = await import('@/lib/workflow/registry');
          const childManager = await workflowRegistry.getManagerByRunId(childRunId);
          await (childManager as any)?.stop?.();
        } catch {
          // best-effort child stop; parent stop must continue.
        }
      }
    }
    this.clearRuntimeActivity();
    this.emit('status', {
      status: 'stopped',
      message: '工作流已停止',
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Kill any running child processes immediately
    this.cancelCurrentProcesses();

    await this.finalizeRun('stopped');
  }

  private cleanupCurrentEngine(): void {
    const engine = this.currentEngine;
    if (!engine) return;
    try {
      engine.cancel();
    } catch {
      // best-effort cleanup
    }
    try {
      (engine as any).cleanup?.();
    } catch {
      // best-effort cleanup
    }
    this.currentEngine = null;
  }

  forceTransition(targetState: string, instruction?: string, actor?: WorkflowActionActor): void {
    if (this.status !== 'running') {
      throw new Error('工作流未在运行中');
    }
    const fromState = this.currentState;
    this.pendingForceTransition = targetState;
    if (instruction) {
      this.pendingForceInstruction = instruction;
    }
    this.runtimeGeneration += 1;
    this.clearRuntimeActivity();
    const activeChild = this.activeSubworkflowRunId
      ? this.subworkflowRuns.find((item) => item.runId === this.activeSubworkflowRunId)
      : null;
    this.recordSubworkflowAudit({
      action: 'force-transition',
      actor,
      childRunId: activeChild?.runId,
      childConfigFile: activeChild?.configFile,
      stateName: activeChild?.parentStateName || fromState || undefined,
      stepName: activeChild?.parentStepName,
      details: {
        fromState,
        targetState,
        instruction,
      },
    });
    void this.persistState();
    this.emit('status', {
      status: this.status,
      currentState: this.currentState,
      currentStep: this.currentStep,
      activeSteps: Array.from(this.activeStepKeys),
      activeConcurrencyGroups: this.activeConcurrencyGroups,
      message: `正在强制跳转到 ${targetState}`,
    });
    this.emit('force-transition', { targetState, from: this.currentState, instruction, actor });
    if (fromState !== '__human_approval__' && fromState !== targetState && this.currentWorkflowConfig) {
      this.queueSpecRevisionVote({
        trigger: 'force-transition',
        stateName: fromState,
        nextState: targetState,
        instruction,
      }, this.currentWorkflowConfig);
    }

    // Kill the running processes so the main loop can pick up the forced transition immediately
    this.cancelCurrentProcesses();
  }

  setContext(scope: 'global' | 'phase', context: string, stateName?: string): void {
    if (scope === 'global') {
      this.globalContext = context;
    } else if (scope === 'phase' && stateName) {
      // For state machine, 'phase' refers to 'state'
      this.stateContexts.set(stateName, context);
    }
  }

  getContexts(): { globalContext: string; phaseContexts: Record<string, string> } {
    return {
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
    };
  }

  getHumanQuestions(): HumanQuestion[] {
    return [...this.humanQuestions];
  }

  getPendingHumanQuestion(): HumanQuestion | null {
    if (!this.pendingHumanQuestionId) return null;
    return this.humanQuestions.find((question) => question.id === this.pendingHumanQuestionId && question.status === 'unanswered') || null;
  }

  private formatHumanQuestionAnswer(answer: HumanQuestionAnswer): string {
    const parts: string[] = [];
    if (answer.selectedState) parts.push(`选择状态: ${answer.selectedState}`);
    if (answer.selectedOption) parts.push(`选择: ${answer.selectedOption}`);
    if (answer.selectedOptions?.length) parts.push(`选择: ${answer.selectedOptions.join('、')}`);
    if (answer.text) parts.push(answer.text);
    if (answer.instruction) parts.push(`附加指令: ${answer.instruction}`);
    return parts.filter(Boolean).join('\n') || '已确认';
  }

  private async appendSupervisorChatEvent(input: {
    type: string;
    title: string;
    body?: string;
    tags?: string[];
    dedupeKey?: string;
    speakerName?: string;
    speakerType?: 'human' | 'agent' | 'system';
  }): Promise<void> {
    if (!this._frontendSessionId) return;
    const speakerName = input.speakerName || this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    await appendWorkflowAgoraMessage({
      sessionId: this._frontendSessionId,
      type: input.type,
      title: input.title,
      body: input.body,
      speakerName,
      speakerType: input.speakerType || 'agent',
      dedupeKey: input.dedupeKey,
      participants: this.getWorkflowAgoraParticipants(),
      agentSessions: this.getWorkflowAgoraAgentSessions(),
      workspacePath: this.getWorkingDirectory() || undefined,
    }).catch(() => {});
  }

  async createHumanQuestion(input: Partial<HumanQuestion> & {
    title: string;
    message: string;
    answerSchema: HumanQuestion['answerSchema'];
  }): Promise<HumanQuestion> {
    if (!this.currentRunId) {
      throw new Error('当前没有运行中的工作流');
    }

    const existingPending = this.getPendingHumanQuestion();
    if (existingPending && input.source && existingPending.source && this.isSameHumanQuestionSource(existingPending.source, input.source) && input.kind === existingPending.kind) {
      return existingPending;
    }

    const supervisorAgent = this.agents.find((agent) => agent.name === this.currentSupervisorAgent);
    const workflowPath = input.workflowPath || [
      ...this.nestingPath.map((item) => ({
        runId: item.runId,
        configFile: item.configFile,
        stateName: item.stateName || null,
        stepName: item.stepName || null,
      })),
      {
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        workflowName: this.workflowName || this.currentConfigFile,
        stateName: this.currentState || null,
        stepName: this.currentStep || null,
      },
    ];
    const question: HumanQuestion = {
      id: input.id || `hq-${Date.now()}-${randomUUID().slice(0, 8)}`,
      runId: this.currentRunId,
      configFile: this.currentConfigFile,
      parentRunId: input.parentRunId ?? this.parentRunId ?? undefined,
      rootRunId: input.rootRunId ?? this.rootRunId ?? this.currentRunId,
      workflowPath,
      sourceRunId: input.sourceRunId ?? this.currentRunId,
      sourceConfigFile: input.sourceConfigFile ?? this.currentConfigFile,
      status: 'unanswered',
      kind: input.kind || 'clarification',
      title: input.title,
      message: input.message,
      supervisorAdvice: input.supervisorAdvice,
      createdAt: input.createdAt || new Date().toISOString(),
      supervisorAgent: input.supervisorAgent || this.currentSupervisorAgent,
      supervisorSessionId: input.supervisorSessionId ?? supervisorAgent?.sessionId ?? null,
      workflowFrontendSessionId: input.workflowFrontendSessionId ?? this._frontendSessionId ?? null,
      currentState: input.currentState ?? this.currentState,
      previousState: input.previousState,
      suggestedNextState: input.suggestedNextState,
      availableStates: input.availableStates,
      result: input.result,
      requiresWorkflowPause: input.requiresWorkflowPause ?? true,
      answerSchema: input.answerSchema,
      source: input.source || { type: 'manual' },
    };

    this.humanQuestions = [question, ...this.humanQuestions.filter((item) => item.id !== question.id)].slice(0, 100);
    if (question.requiresWorkflowPause) {
      this.pendingHumanQuestionId = question.id;
    }
    this.latestSupervisorReview = {
      type: 'human-question',
      stateName: this.currentState || '全局',
      content: `${question.title}\n${question.message}`,
      timestamp: question.createdAt,
    };
    await this.persistState();
    const isParallelManualJoin = question.source?.type === 'parallel-manual-join';
    const isHumanHelp = question.source?.type === 'human-help';
    await this.appendSupervisorChatEvent({
      type: isParallelManualJoin ? 'parallel-manual-join-question' : isHumanHelp ? 'human-help-question' : 'human-question',
      title: `${isParallelManualJoin ? '等待并发人工确认' : isHumanHelp ? '等待人工客服回复' : '等待人工回复'}：${question.title}`,
      body: question.message,
      tags: ['human', isParallelManualJoin ? 'parallel-manual-join' : isHumanHelp ? 'human-help' : 'approval', question.kind],
      dedupeKey: `workflow-human-question-${question.id}`,
    });
    this.emit('human-question-required', { question, humanQuestions: this.humanQuestions });
    this.emit('status', { status: this.status, pendingHumanQuestion: question, currentConfigFile: this.currentConfigFile });
    return question;
  }

  private isSameHumanQuestionSource(existing: HumanQuestion['source'], next: HumanQuestion['source']): boolean {
    if (!existing || !next || existing.type !== next.type) return false;
    if (existing.type === 'parallel-manual-join' || next.type === 'parallel-manual-join') {
      return existing.type === next.type
        && existing.groupId === next.groupId
        && existing.stateName === next.stateName;
    }
    if (existing.type === 'human-help' || next.type === 'human-help') {
      return existing.type === next.type
        && existing.stateName === next.stateName
        && existing.stepName === next.stepName;
    }
    return true;
  }

  async answerHumanQuestion(questionId: string, answer: HumanQuestionAnswer, actor?: WorkflowActionActor): Promise<HumanQuestion> {
    const index = this.humanQuestions.findIndex((question) => question.id === questionId);
    if (index < 0) {
      throw new Error('找不到待回答的 Supervisor 消息');
    }

    const now = new Date().toISOString();
    const existing = this.humanQuestions[index];
    if (existing.status === 'answered') return existing;
    if (existing.status !== 'unanswered') {
      throw new Error('该 Supervisor 消息已失效，不能重复回答');
    }
    if (existing.requiresWorkflowPause && this.pendingHumanQuestionId !== questionId) {
      throw new Error('该人工审查点已不是当前等待项，请刷新运行状态后重试');
    }
    if (existing.answerSchema.type === 'approval-transition' && this.currentState !== '__human_approval__') {
      throw new Error('该人工审查点已离开等待状态，请刷新运行状态后重试');
    }
    const updated: HumanQuestion = {
      ...existing,
      status: 'answered',
      answer,
      answeredAt: now,
    };
    this.humanQuestions[index] = updated;
    if (this.pendingHumanQuestionId === questionId) {
      this.pendingHumanQuestionId = null;
    }

    const answerText = this.formatHumanQuestionAnswer(answer);
    this.humanAnswersContext = [
      ...this.humanAnswersContext,
      {
        questionId,
        title: existing.title,
        question: existing.message,
        answer: answerText,
        instruction: answer.instruction,
        answeredAt: now,
      },
    ].slice(-20);

    if (existing.answerSchema.type === 'approval-transition') {
      this.pendingForceTransition = answer.selectedState || existing.suggestedNextState || existing.availableStates?.[0] || null;
      this.pendingForceInstruction = answer.instruction || answer.text || null;
    }

    if (existing.parentRunId || (existing.workflowPath?.length || 0) > 1) {
      this.recordSubworkflowAudit({
        action: 'human-answer',
        actor,
        childRunId: existing.sourceRunId,
        childConfigFile: existing.sourceConfigFile,
        stateName: existing.currentState || undefined,
        stepName: existing.workflowPath?.at(-1)?.stepName || undefined,
        details: {
          questionId,
          questionTitle: existing.title,
          answerType: existing.answerSchema.type,
        },
      });
    }

    await this.persistState();
    const isParallelManualJoin = existing.source?.type === 'parallel-manual-join';
    const isHumanHelp = existing.source?.type === 'human-help';
    await this.appendSupervisorChatEvent({
      type: isParallelManualJoin ? 'parallel-manual-join-answer' : isHumanHelp ? 'human-help-answer' : 'human-answer',
      title: `${isParallelManualJoin ? '并发人工确认已回复' : isHumanHelp ? '人工客服已回复' : '人工已回复'}：${existing.title}`,
      body: answerText,
      tags: ['human', isParallelManualJoin ? 'parallel-manual-join' : isHumanHelp ? 'human-help' : 'answered', 'answered'],
      dedupeKey: `workflow-human-answer-${questionId}-${now}`,
      speakerName: '你',
      speakerType: 'human',
    });
    this.emit('human-question-answered', { question: updated, answer });
    this.emit('status', { status: this.status, pendingHumanQuestion: null, currentConfigFile: this.currentConfigFile });
    const waiter = this.humanQuestionWaiters.get(questionId);
    if (waiter) {
      this.humanQuestionWaiters.delete(questionId);
      waiter(updated);
    }
    return updated;
  }

  private async waitForHumanQuestionAnswer(questionId: string): Promise<HumanQuestion | null> {
    const existing = this.humanQuestions.find((question) => question.id === questionId);
    if (!existing || existing.status !== 'unanswered') return existing || null;
    return new Promise((resolve) => {
      this.humanQuestionWaiters.set(questionId, resolve);
      const checkInterval = setInterval(() => {
        const question = this.humanQuestions.find((item) => item.id === questionId) || null;
        if (!question || question.status !== 'unanswered' || this.pendingForceTransition || this.shouldStop) {
          clearInterval(checkInterval);
          this.humanQuestionWaiters.delete(questionId);
          resolve(question);
        }
      }, 500);
    });
  }

  /** 标记进入等待（停摆）：记录起点，供累计等待时长用。重复调用不覆盖已有起点。 */
  private beginWait(): void {
    if (!this.waitStartedAt) {
      this.waitStartedAt = new Date().toISOString();
    }
  }

  /** 结束等待：把 [waitStartedAt, now] 累加进 accumulatedWaitMs 并清空起点。 */
  private endWait(): void {
    if (this.waitStartedAt) {
      this.accumulatedWaitMs += Math.max(0, Date.now() - new Date(this.waitStartedAt).getTime());
      this.waitStartedAt = null;
    }
  }

  private async waitForHumanApproval(): Promise<void> {
    this.beginWait(); // 进入人工审查等待，计入等待时长
    try {
      const pendingQuestion = this.getPendingHumanQuestion();
      if (pendingQuestion) {
        await this.waitForHumanQuestionAnswer(pendingQuestion.id);
        return;
      }

      // Wait for human to call forceTransition
      await new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.pendingForceTransition || this.shouldStop) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 500); // Check every 500ms
      });
    } finally {
      this.endWait(); // 人工审查结束，累加本次等待
    }
  }

  private isHumanHelpEnabled(config: StateMachineWorkflowConfig): boolean {
    return config.workflow?.humanHelp?.enabled === true;
  }

  private normalizeHumanHelpOptions(rawOptions: any, limit = 8): HumanHelpOption[] {
    if (!Array.isArray(rawOptions)) return [];
    const seen = new Set<string>();
    const options: HumanHelpOption[] = [];
    for (const raw of rawOptions) {
      const label = typeof raw === 'string'
        ? raw.trim()
        : String(raw?.label || raw?.title || raw?.name || raw?.value || '').trim();
      const value = typeof raw === 'string'
        ? raw.trim()
        : String(raw?.value || raw?.id || raw?.key || label).trim();
      if (!label || !value || seen.has(value)) continue;
      seen.add(value);
      const description = typeof raw === 'object' && typeof raw?.description === 'string'
        ? raw.description.trim()
        : undefined;
      options.push({ label, value, description });
      if (options.length >= limit) break;
    }
    return options;
  }

  private normalizeHumanHelpAnswerType(rawType: any, options: HumanHelpOption[], config: StateMachineWorkflowConfig): HumanHelpRequest['answerType'] {
    const text = String(rawType || '').trim().toLowerCase();
    if (['multi', 'multiple', 'multi-choice', 'checkbox', '多选'].includes(text)) return 'multi-choice';
    if (['single', 'choice', 'single-choice', 'radio', 'select', '选择', '单选'].includes(text)) return options.length > 0 ? 'single-choice' : 'text';
    if (['text', 'freeform', 'free-form', 'input', '输入', '文本'].includes(text)) return 'text';
    if (options.length > 0) {
      return config.workflow?.humanHelp?.defaultSelectionMode === 'multiple' ? 'multi-choice' : 'single-choice';
    }
    return 'text';
  }

  private parseHumanHelpRequests(output: string, config: StateMachineWorkflowConfig): HumanHelpRequest[] {
    if (!this.isHumanHelpEnabled(config)) return [];
    const requests: HumanHelpRequest[] = [];
    for (const block of extractTaggedBlocks(output, 'human-help')) {
      let parsed: any = null;
      try {
        parsed = JSON.parse(block);
      } catch {
        parsed = this.extractJsonObject(block) || { question: block };
      }
      const options = this.normalizeHumanHelpOptions(parsed?.options || parsed?.choices);
      const question = String(
        parsed?.question || parsed?.message || parsed?.ask || parsed?.prompt || parsed?.reason || block
      ).trim();
      if (!question) continue;
      const title = String(parsed?.title || parsed?.label || '需要人工客服协助').trim();
      requests.push({
        title,
        question,
        reason: typeof parsed?.reason === 'string' ? parsed.reason.trim() : undefined,
        severity: typeof parsed?.severity === 'string' ? parsed.severity.trim() : undefined,
        answerType: this.normalizeHumanHelpAnswerType(parsed?.answerType || parsed?.type || parsed?.selectionMode, options, config),
        options,
        placeholder: typeof parsed?.placeholder === 'string' ? parsed.placeholder.trim() : undefined,
        raw: parsed,
      });
    }
    return requests;
  }

  private async reviewHumanHelpRequest(input: {
    request: HumanHelpRequest;
    output: string;
    step: WorkflowStep;
    state: StateMachineState;
    config: StateMachineWorkflowConfig;
  }): Promise<SupervisorHumanHelpDecision> {
    const { request, output, step, state, config } = input;
    if (config.workflow?.humanHelp?.supervisorReviewEnabled === false || config.workflow?.supervisor?.enabled === false) {
      return {
        needsHuman: true,
        title: request.title,
        message: request.question,
        supervisorAdvice: request.reason,
        answerType: request.answerType,
        options: request.options,
        placeholder: request.placeholder,
      };
    }

    const options = request.options || [];
    const answerType = this.normalizeHumanHelpAnswerType(request.answerType, options, config);
    const supervisorConfig = this.agentConfigs.find((role) => role.name === this.currentSupervisorAgent)
      || config.roles?.find((role) => role.name === this.currentSupervisorAgent);
    if (supervisorConfig) {
      try {
        const prompt = [
          `你是工作流 Supervisor「${this.currentSupervisorAgent}」。Agent 在步骤中请求人工客服，请判断是否真的需要打断用户。`,
          '',
          '# 判断规则',
          '- 如果用户需求、工作流要求或当前步骤说明明确要求该步骤需要人工反馈、人工审查、人工复核、人工确认、人工审批或人工验收，必须 needsHuman=true。',
          '- 只有缺少必须由用户提供的信息、必要环境/仓库/配置不可得、存在冲突矛盾需要用户决策时，才 needsHuman=true。',
          '- 如果 Agent 还没充分自查、可以读取仓库/配置/上下文、可以采用保守默认值或继续验证，应 needsHuman=false，并给出 fallbackInstruction。',
          '- 不要为了省事请求用户；也不要压掉真正阻塞执行的问题。',
          '',
          '# 当前状态',
          `状态: ${state.name}`,
          `步骤: ${step.name}`,
          `Agent: ${getStepRuntimeAgentName(step)}`,
          '',
          '# Agent 请求',
          `标题: ${request.title}`,
          `问题: ${request.question}`,
          request.reason ? `原因: ${request.reason}` : '',
          request.options?.length ? `选项: ${request.options.map((option) => `${option.label}=${option.value}`).join('；')}` : '',
          '',
          '# Agent 本轮输出摘录',
          compactStepConclusion(output).slice(0, 1800),
          '',
          '请只输出 JSON：',
          '{"needsHuman":true|false,"supervisorAdvice":"复核意见","fallbackInstruction":"needsHuman=false 时给 Agent 的继续指令","title":"可选，给人的标题","message":"可选，给人的问题","answerType":"text|single-choice|multi-choice"}',
        ].filter(Boolean).join('\n');
        const rawOutput = await this.queryAgent(this.currentSupervisorAgent, prompt, config);
        const parsed = this.extractJsonObject(rawOutput);
        if (parsed && typeof parsed.needsHuman === 'boolean') {
          return {
            needsHuman: parsed.needsHuman,
            title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : request.title,
            message: typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : request.question,
            supervisorAdvice: typeof parsed.supervisorAdvice === 'string' && parsed.supervisorAdvice.trim()
              ? parsed.supervisorAdvice.trim()
              : compactStepConclusion(rawOutput).slice(0, 800),
            fallbackInstruction: typeof parsed.fallbackInstruction === 'string' ? parsed.fallbackInstruction.trim() : undefined,
            answerType: this.normalizeHumanHelpAnswerType(parsed.answerType, options, config) || answerType,
            options,
            placeholder: request.placeholder,
            rawOutput,
          };
        }
      } catch {
        // Fall through to deterministic review if the Supervisor model call fails.
      }
    }

    const text = [
      request.title,
      request.question,
      request.reason,
      compactStepConclusion(output).slice(0, 1200),
    ].filter(Boolean).join('\n').toLowerCase();
    const explicitBlockers = /缺少|missing|not found|找不到|不存在|没有|权限|permission|credential|token|api[_-]?key|密钥|账号|环境|仓库|repo|repository|配置|config|冲突|矛盾|选择|确认|决策|拍板|人工|用户/.test(text);
    const agentCanSelfServe = /还没查|未查|没有查|先查|可以查|自行|默认配置|保守默认|继续检查|搜索|读取/.test(text);
    const needsHuman = explicitBlockers && !agentCanSelfServe;
    if (!needsHuman) {
      return {
        needsHuman: false,
        supervisorAdvice: 'Supervisor 复核：当前问题更像可由 Agent 继续自查处理，暂不打断用户。',
        fallbackInstruction: [
          '请先自行检查仓库、配置文件、环境变量说明和已有上下文。',
          '若仍然缺少必须由用户提供的信息，请说明你已经检查过哪些位置，再重新发起人工客服请求。',
        ].join('\n'),
        rawOutput: '',
      };
    }
    return {
      needsHuman: true,
      title: request.title,
      message: request.question,
      supervisorAdvice: request.reason
        ? `Supervisor 复核：该请求可能阻塞当前步骤，原因是 ${request.reason}`
        : 'Supervisor 复核：该请求涉及必要信息或用户决策，需要人工客服介入。',
      answerType,
      options,
      placeholder: request.placeholder,
      rawOutput: '',
    };
  }

  private buildHumanHelpAnswerSchema(decision: SupervisorHumanHelpDecision, request: HumanHelpRequest): HumanQuestion['answerSchema'] {
    const options = decision.options?.length ? decision.options : request.options || [];
    const type = decision.answerType || request.answerType;
    if ((type === 'single-choice' || type === 'multi-choice') && options.length > 0) {
      return {
        type,
        required: true,
        options,
      };
    }
    return {
      type: 'text',
      required: true,
      placeholder: decision.placeholder || request.placeholder || '请补充当前步骤继续执行所需的信息。',
    };
  }

  private formatHumanHelpResumePrompt(input: {
    question: HumanQuestion;
    answer?: HumanQuestionAnswer;
    request: HumanHelpRequest;
    decision: SupervisorHumanHelpDecision;
  }): string {
    const answerText = input.answer ? this.formatHumanQuestionAnswer(input.answer) : '用户未提供明确内容。';
    return [
      '## 人工客服回复',
      '你之前通过 <human-help> 请求人工客服。Supervisor 已完成复核，人类已回复。',
      '',
      `原问题: ${input.question.title}`,
      input.question.message,
      '',
      input.decision.supervisorAdvice ? `Supervisor 复核意见:\n${input.decision.supervisorAdvice}` : '',
      '',
      `人类回复:\n${answerText}`,
      '',
      '请基于以上回复继续当前步骤，不要重新请求同一个问题；如果仍有新的阻塞点，必须说明新增事实后再使用 <human-help>。',
    ].filter(Boolean).join('\n');
  }

  private async handleHumanHelpRequests(input: {
    requests: HumanHelpRequest[];
    output: string;
    step: WorkflowStep;
    state: StateMachineState;
    config: StateMachineWorkflowConfig;
    runtimeAgentName: string;
  }): Promise<string | null> {
    const { requests, output, step, state, config, runtimeAgentName } = input;
    const request = requests[0];
    if (!request) return null;
    const stateName = state.name || this.currentState || '';

    const timestamp = new Date().toISOString();
    this.emit('human-help-requested', {
      state: stateName,
      step: step.name,
      agent: runtimeAgentName,
      request,
      timestamp,
    });
    await this.appendSupervisorChatEvent({
      type: 'human-help-request',
      title: `请求人工客服：${stateName} / ${step.name}`,
      body: [
        `${runtimeAgentName} 请求人工介入。`,
        `问题: ${request.question}`,
        request.reason ? `原因: ${request.reason}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['human-help', stateName, step.name],
      speakerName: runtimeAgentName,
      dedupeKey: `workflow-human-help-request-${this.currentRunId}-${stateName}-${step.name}-${timestamp}`,
    });

    const decision = await this.reviewHumanHelpRequest({ request, output, step, state, config });
    this.supervisorFlow.push({
      type: 'human-help-review',
      from: this.currentSupervisorAgent,
      to: decision.needsHuman ? 'user' : runtimeAgentName,
      question: decision.supervisorAdvice || decision.message || request.question,
      round: this.transitionCount,
      timestamp: new Date().toISOString(),
      stateName,
    });
    await this.appendSupervisorChatEvent({
      type: decision.needsHuman ? 'human-help-review' : 'human-help-dismissed',
      title: decision.needsHuman
        ? `Supervisor 确认需要人工：${stateName} / ${step.name}`
        : `Supervisor 判定无需人工：${stateName} / ${step.name}`,
      body: decision.needsHuman
        ? [
          '@你 这里需要你补充信息后才能继续。',
          decision.supervisorAdvice || '',
          decision.message || request.question,
        ].filter(Boolean).join('\n\n')
        : [
          decision.supervisorAdvice || 'Supervisor 判定当前问题不需要人工介入。',
          decision.fallbackInstruction ? `给 Agent 的继续指令:\n${decision.fallbackInstruction}` : '',
      ].filter(Boolean).join('\n\n'),
      tags: ['human-help', decision.needsHuman ? 'needs-human' : 'dismissed'],
      dedupeKey: `workflow-human-help-review-${this.currentRunId}-${stateName}-${step.name}-${Date.now()}`,
    });

    if (!decision.needsHuman) {
      return [
        '## Supervisor 复核人工客服请求',
        decision.supervisorAdvice || 'Supervisor 判定当前问题不需要人工介入。',
        decision.fallbackInstruction ? `\n继续执行指令:\n${decision.fallbackInstruction}` : '',
        '',
        '请基于以上指令继续当前步骤，不要再次请求同一个人工客服问题。',
      ].filter(Boolean).join('\n');
    }

    const agent = this.agents.find((item) => item.name === runtimeAgentName);
    if (agent) {
      agent.status = 'waiting';
      agent.currentTask = `${step.name}（等待人工客服）`;
      this.emit('agents', { agents: this.agents });
      await this.persistState();
    }

    const humanQuestion = await this.createHumanQuestion({
      kind: decision.answerType === 'text' || request.answerType === 'text' ? 'clarification' : 'choice',
      title: decision.title || request.title,
      message: decision.message || request.question,
      supervisorAdvice: decision.supervisorAdvice,
      currentState: stateName,
      result: {
        stateName,
        stepName: step.name,
        agent: runtimeAgentName,
        request,
        supervisorDecision: {
          needsHuman: decision.needsHuman,
          supervisorAdvice: decision.supervisorAdvice,
        },
      },
      requiresWorkflowPause: config.workflow?.humanHelp?.blockUntilAnswered !== false,
      answerSchema: this.buildHumanHelpAnswerSchema(decision, request),
      source: {
        type: 'human-help',
        stateName,
        stepName: step.name,
        agent: runtimeAgentName,
      },
    });

    const answered = await this.waitForHumanQuestionAnswer(humanQuestion.id);
    if (this.shouldStop) {
      throw new Error('工作流已停止');
    }
    const finalQuestion = answered || this.humanQuestions.find((question) => question.id === humanQuestion.id) || humanQuestion;
    await this.appendSupervisorChatEvent({
      type: 'human-answer',
      title: `人工客服已回复：${finalQuestion.title}`,
      body: finalQuestion.answer ? this.formatHumanQuestionAnswer(finalQuestion.answer) : '已回复。',
      tags: ['human', 'human-help', 'answered'],
      speakerName: '你',
      speakerType: 'human',
      dedupeKey: `workflow-human-help-answer-${finalQuestion.id}-${finalQuestion.answeredAt || Date.now()}`,
    });
    return this.formatHumanHelpResumePrompt({
      question: finalQuestion,
      answer: finalQuestion.answer,
      request,
      decision,
    });
  }

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();
    this.clearRuntimeActivity();

    try {
      await this.finalizeSupervisorOutputs(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('log', { message: `Supervisor 结算输出失败: ${message}` });
    }

    // Cleanup copied skills and engine processes from workspace/run execution
    this.cancelCurrentProcesses();
    this.cleanupCurrentEngine();
    await this.cleanupWorkspaceSkills();
    await this.recordFinalGitSnapshot(status);

    // 持久化 spec 模式：运行完成后标记 delta 可人工合入 master
    if (status === 'completed' && this.currentRunSpecCoding?.persistMode === 'repository' && this.currentRunId) {
      if (!this.deltaSpecMerged && this.deltaMergeState?.status !== 'merged') {
        this.deltaMergeState = {
          ...(this.deltaMergeState || {}),
          status: 'available',
          requestedAt: this.deltaMergeState?.requestedAt || new Date().toISOString(),
          error: undefined,
        };
        this.deltaSpecMerged = false;
        this.emit('log', { message: '持久化 Spec: Delta 已可合入 Master，请在 Workbench 中人工确认。' });
      }
    }

    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentState,
        completedSteps,
      });

      await this.persistState(status);
    } catch (err) {
    }

    await this.appendSupervisorChatEvent({
      type: status === 'completed' ? 'run-completed' : status === 'failed' ? 'run-failed' : 'run-stopped',
      title: status === 'completed' ? '工作流执行完成' : status === 'failed' ? '工作流执行失败' : '工作流已停止',
      body: status === 'completed'
        ? `完成步骤：${this.agents.reduce((sum, agent) => sum + agent.completedTasks, 0)}`
        : this.statusReason || '',
      speakerName: this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME,
      dedupeKey: `workflow-run-${status}-${this.currentRunId}`,
    });

    this.status = 'idle';
  }

  private clearRuntimeActivity(): void {
    this.activeStepKeys.clear();
    this.activeConcurrencyGroups = [];
    this.currentStep = null;
  }

  private async readWorkflowConfigContent(configFile: string): Promise<string> {
    if (this.rootRunId) {
      try {
        return (await readWorkflowConfigSnapshot({
          rootRunId: this.rootRunId,
          configFile,
        })).content;
      } catch (error) {
        if (this.parentRunId || this.rootRunId === this.currentRunId) throw error;
      }
    }
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    return readFile(configPath, 'utf-8');
  }

  private refreshCurrentStep(): void {
    const active = Array.from(this.activeStepKeys);
    const activeGroup = this.activeConcurrencyGroups.find((group) => group.status === 'running' || group.status === 'waiting-approval');
    if (active.length === 0) {
      this.currentStep = activeGroup ? `并发:${activeGroup.stateName}:${activeGroup.id}` : null;
    } else if (active.length === 1) {
      this.currentStep = active[0];
    } else {
      this.currentStep = activeGroup ? `并发:${activeGroup.stateName}:${activeGroup.id}` : active[0];
    }
  }

  private markStepActive(stepKey: string): void {
    this.activeStepKeys.add(stepKey);
    this.refreshCurrentStep();
  }

  private markStepInactive(stepKey: string): void {
    this.activeStepKeys.delete(stepKey);
    this.refreshCurrentStep();
  }

  private getStateStepKey(stateName: string, stepName: string): string {
    return `${stateName}-${stepName}`;
  }

  private getWorkflowStepKey(stateName: string, step: WorkflowStep): string {
    return this.getStateStepKey(stateName, step.name);
  }

  private addFailedStep(stepKey: string): void {
    if (!this.failedSteps.includes(stepKey)) {
      this.failedSteps.push(stepKey);
    }
  }

  private clearFailedStep(stepKey: string): void {
    this.failedSteps = this.failedSteps.filter((item) => item !== stepKey);
  }

  private deriveFailedStepKeys(stepLogs: PersistedStepLog[] = []): string[] {
    return Array.from(new Set(
      stepLogs
        .filter((log) => log.status === 'failed' && typeof log.stepName === 'string' && log.stepName.trim())
        .map((log) => log.stepName)
    ));
  }

  private getLatestStepLog(stepKey: string, status?: PersistedStepLog['status']): PersistedStepLog | null {
    for (let i = this.stepLogs.length - 1; i >= 0; i--) {
      const log = this.stepLogs[i];
      if (log.stepName !== stepKey) continue;
      if (status && log.status !== status) continue;
      return log;
    }
    return null;
  }

  private getSegmentStepKeys(stateName: string, segment: StepSegment): string[] {
    return segment.type === 'parallel'
      ? segment.steps.map((step) => this.getWorkflowStepKey(stateName, step))
      : [this.getWorkflowStepKey(stateName, segment.step)];
  }

  private getResumeStepKeyForRun(runState: PersistedRunState, config: StateMachineWorkflowConfig): string | null {
    const stateName = runState.currentState;
    if (!stateName || stateName === '__human_approval__') return null;
    const state = config.workflow.states.find((item) => item.name === stateName);
    if (!state) return null;
    const validStepKeys = new Set(state.steps.map((step) => this.getWorkflowStepKey(state.name, step)));
    if (validStepKeys.size === 0) return null;

    const failedLog = [...(runState.stepLogs || [])]
      .reverse()
      .find((log) => log.status === 'failed' && validStepKeys.has(log.stepName));
    if (failedLog) return failedLog.stepName;

    const activeStep = (runState.activeSteps || []).find((stepKey) => validStepKeys.has(stepKey));
    if (activeStep) return activeStep;

    const currentStep = runState.currentStep || '';
    return validStepKeys.has(currentStep) ? currentStep : null;
  }

  private collectSkippedStepOutput(step: WorkflowStep, stateName: string, stepOutputs: string[], issues: Issue[], useVerdict = true): 'pass' | 'conditional_pass' | 'fail' | null {
    const stepKey = this.getWorkflowStepKey(stateName, step);
    const log = this.getLatestStepLog(stepKey, 'completed');
    if (!log?.output) return null;
    stepOutputs.push(log.output);
    issues.push(...this.parseIssuesFromOutput(log.output, step, stateName));
    if (useVerdict) return this.parseVerdict(log.output);
    return null;
  }

  private upsertCurrentProcess(proc: PersistedProcessInfo): void {
    const idx = this.currentProcesses.findIndex((item) => item.id === proc.id);
    if (idx >= 0) this.currentProcesses[idx] = proc;
    else this.currentProcesses.push(proc);
  }

  private removeCurrentProcess(processId?: string): void {
    if (!processId) return;
    this.currentProcesses = this.currentProcesses.filter((proc) => proc.id !== processId);
  }

  private cancelCurrentProcesses(): boolean {
    const processIds = new Set(this.currentProcesses.map((proc) => proc.id).filter(Boolean));
    const stepIds = new Set(this.currentProcesses.map((proc) => proc.stepId).filter(Boolean) as string[]);
    const running = processManager.getAllProcesses().filter((p: any) =>
      (p.status === 'running' || p.status === 'queued') && (processIds.has(p.id) || (p.stepId && stepIds.has(p.stepId)))
    );

    for (const proc of running) {
      const killed = processManager.killProcess(proc.id);
      if (!killed) {
        const rawProc = processManager.getProcessRaw(proc.id);
        if (rawProc?.childProcess) {
          try { rawProc.childProcess.kill('SIGTERM'); } catch { /* already dead */ }
        } else if (this.currentEngine) {
          this.currentEngine.cancel();
        }
        if (rawProc) {
          rawProc.status = 'killed';
          rawProc.endTime = new Date();
        }
      }
    }

    let cancelledViaEngine = false;
    if (running.length === 0 && this.currentEngine && this.currentProcesses.length > 0) {
      this.currentEngine.cancel();
      cancelledViaEngine = true;
    }

    return running.length > 0 || cancelledViaEngine;
  }

  private async persistState(finalStatus?: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.currentRunId) return;
    try {
      if (this.currentRunSpecCoding) {
        this.currentRunSpecCoding = normalizeSpecCodingDocument(this.currentRunSpecCoding);
      }
      const statusToPersist = finalStatus || (
        this.shouldStop ? 'stopped' : (this.status === 'idle' ? 'completed' : this.status)
      );
      const preparingPhase = statusToPersist === 'preparing' ? '准备阶段' : null;
      const attachedAgentSessions = Object.fromEntries(
        this.agents
          .filter((agent) => Boolean(agent.sessionId))
          .map((agent) => [agent.name, agent.sessionId as string])
      );
      const supervisorSessionId = this.agents.find((agent) => agent.name === this.currentSupervisorAgent)?.sessionId || null;
      await saveRunState({
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        parentRunId: this.parentRunId || undefined,
        rootRunId: this.rootRunId || this.currentRunId,
        parentConfigFile: this.parentConfigFile || undefined,
        parentStateName: this.parentStateName || undefined,
        parentStepId: this.parentStepId || undefined,
        parentStepName: this.parentStepName || undefined,
        nestingPath: this.nestingPath,
        childRunIds: this.subworkflowRuns.map((item) => item.runId),
        subworkflowRuns: this.subworkflowRuns,
        activeSubworkflowRunId: this.activeSubworkflowRunId,
        subworkflowAuditEvents: this.subworkflowAuditEvents,
        workflowSnapshotRoot: this.workflowSnapshotRoot || undefined,
        workflowSnapshotManifestHash: this.workflowSnapshotManifestHash || undefined,
        runOwnerId: this._createdBy,
        runOwnerName: this._createdByName,
        createdBy: this._createdBy,
        createdByName: this._createdByName,
        status: statusToPersist as any,
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: finalStatus ? this.runEndTime : null,
        accumulatedWaitMs: this.accumulatedWaitMs,
        waitStartedAt: this.waitStartedAt,
        currentPhase: this.currentState || preparingPhase,
        currentStep: this.currentStep,
        activeSteps: Array.from(this.activeStepKeys),
        activeConcurrencyGroups: this.activeConcurrencyGroups,
        pendingLiveFeedback: toLiveFeedbackSnapshot(this.liveFeedback),
        completedSteps: this.completedSteps,
        failedSteps: this.failedSteps,
        stepLogs: [...this.stepLogs],
        agents: this.agents.map(a => ({
          name: a.name,
          team: a.team,
          engine: a.engine,
          model: a.model,
          status: a.status,
          completedTasks: a.completedTasks,
          tokenUsage: a.tokenUsage,
          costUsd: a.costUsd,
          sessionId: a.sessionId,
          iterationCount: 0,
          summary: a.summary,
        })),
        iterationStates: {},
        processes: this.currentProcesses,
        mode: 'state-machine',
        currentState: this.currentState,
        transitionCount: this.transitionCount,
        maxTransitions: 50,
        stateHistory: this.stateHistory,
        issueTracker: this.issueTracker,
        requirements: this.currentRequirements,
        globalContext: this.globalContext,
        phaseContexts: Object.fromEntries(this.stateContexts),
        supervisorFlow: this.supervisorFlow,
        agentFlow: this.agentFlow as any,
        // 只在真正等待人工审批时才写入 pendingCheckpoint；已完成/失败/停止时清除
        ...(!finalStatus && this.currentState === '__human_approval__' && this.pendingApprovalInfo ? {
          pendingCheckpoint: {
            phase: '__human_approval__',
            checkpoint: 'human-approval',
            message: `等待人工审查，建议下一状态: ${this.pendingApprovalInfo.suggestedNextState}`,
            isIterativePhase: false,
            suggestedNextState: this.pendingApprovalInfo.suggestedNextState,
            availableStates: this.pendingApprovalInfo.availableStates,
            supervisorAdvice: this.pendingApprovalInfo.supervisorAdvice,
            result: this.pendingApprovalInfo.result,
            humanQuestionId: this.pendingHumanQuestionId || undefined,
            humanQuestion: this.getPendingHumanQuestion() || undefined,
          },
        } : {}),
        workingDirectory: this.getWorkingDirectory() || undefined,
        workspaceGit: this.workflowGit || undefined,
        supervisorAgent: this.currentSupervisorAgent,
        supervisorSessionId,
        attachedAgentSessions,
        workflowFrontendSessionId: this._frontendSessionId || null,
        latestSupervisorReview: this.latestSupervisorReview,
        humanQuestions: this.humanQuestions,
        pendingHumanQuestionId: this.pendingHumanQuestionId,
        humanAnswersContext: this.humanAnswersContext,
        specRevisionVote: this.specRevisionVote,
        specRevisionVoteHistory: this.specRevisionVoteHistory,
        qualityChecks: this.qualityChecks,
        creationSessionId: this._creationSessionId,
        runSpecCoding: this.currentRunSpecCoding,
        stepTaskBindingsSnapshot: this.stepTaskBindingsSnapshot,
        bindingValidation: this.bindingValidation,
        persistMode: this.currentRunSpecCoding?.persistMode,
        specRootDir: this.currentSpecRootDir || undefined,
        workflowName: this.workflowName || undefined,
        deltaSpecMerged: this.deltaSpecMerged,
        deltaMergeState: this.deltaMergeState,
      });
      await this.syncRunSpecCodingDelta().catch(() => {});
      if (this._frontendSessionId) {
        await updateChatSessionWorkflowBinding(this._frontendSessionId, {
          configFile: this.currentConfigFile,
          runId: this.currentRunId,
          supervisorAgent: this.currentSupervisorAgent,
          supervisorSessionId,
          attachedAgentSessions,
        });
        await updateChatSessionCreationBinding(this._frontendSessionId, {
          filename: this.currentConfigFile,
          status: 'run-bound',
        });
      }
    } catch (err) {
    }
  }

  private extractJsonObject(raw: string): any | null {
    return extractStructuredJsonObject(raw);
  }

  private buildSpecRevisionVoteContext(input: SpecRevisionVoteTriggerInput): string {
    const result = input.result;
    const issueSummary = result?.issues?.length
      ? result.issues.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.description}`).join('\n')
      : '- 无';
    const stepOutputSummary = result?.stepOutputs?.length
      ? result.stepOutputs
        .map((output, index) => `- 步骤 ${index + 1}: ${compactStepConclusion(output).replace(/\s+/g, ' ').slice(0, 800) || '[无输出]'}`)
        .join('\n')
      : '- 无';
    const humanAnswer = input.answer ? this.formatHumanQuestionAnswer(input.answer) : '';
    const recentAnswers = this.humanAnswersContext.slice(-5)
      .map((item) => `- ${item.title}: ${item.answer}`)
      .join('\n');
    const specCoding = this.currentRunSpecCoding;
    const specSummary = specCoding
      ? [
        `- 版本: v${specCoding.version}`,
        specCoding.summary ? `- 摘要: ${specCoding.summary}` : '',
        specCoding.progress?.summary ? `- 进度: ${specCoding.progress.summary}` : '',
        `- 阶段: ${specCoding.phases.length}，任务: ${specCoding.tasks.length}，修订: ${specCoding.revisions.length}`,
        specCoding.revisions.at(-1)?.summary ? `- 最近修订: ${specCoding.revisions.at(-1)?.summary}` : '',
      ].filter(Boolean).join('\n')
      : '- 当前没有 Run Spec Coding';

    return [
      `触发类型: ${input.trigger}`,
      input.stateName ? `当前状态: ${input.stateName}` : '',
      input.nextState ? `下一状态: ${input.nextState}` : '',
      input.instruction ? `强制/人工指令: ${input.instruction}` : '',
      input.checkpointAdvice ? `Supervisor 检查点建议:\n${input.checkpointAdvice.slice(0, 2000)}` : '',
      input.question ? `人工审查问题: ${input.question.title}\n${input.question.message}` : '',
      humanAnswer ? `人工输入:\n${humanAnswer}` : '',
      recentAnswers ? `最近人工输入:\n${recentAnswers}` : '',
      result ? `执行结论: ${result.verdict}\n${result.summary}` : '',
      `问题摘要:\n${issueSummary}`,
      `步骤输出摘要:\n${stepOutputSummary}`,
      `当前 Spec Coding:\n${specSummary}`,
    ].filter(Boolean).join('\n\n');
  }

  private emitSpecRevisionVoteStatus(message?: string): void {
    this.emit('status', {
      status: this.status,
      message,
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: this.currentState,
      currentStep: this.currentStep,
      currentConfigFile: this.currentConfigFile,
      workflowFrontendSessionId: this._frontendSessionId || null,
      specRevisionVote: this.specRevisionVote,
      specRevisionVoteHistory: this.specRevisionVoteHistory,
      ...this.buildRunSpecCodingStatusPayload(),
    });
  }

  private normalizeSpecRevisionVoteChoice(value: unknown): WorkflowSpecRevisionVoteChoice {
    const text = String(value || '').trim().toLowerCase();
    if (text === 'revise' || /修订|修改|更新|调整/.test(text)) return 'revise';
    if (text === 'keep' || /保持|无需|不需要|不用|现状/.test(text)) return 'keep';
    return 'defer';
  }

  private getSpecRevisionVoterAgents(input: SpecRevisionVoteTriggerInput): string[] {
    const names = new Set<string>();
    const addName = (name?: string | null) => {
      const trimmed = String(name || '').trim();
      if (trimmed && trimmed !== this.currentSupervisorAgent) names.add(trimmed);
    };
    const state = input.stateName
      ? this.currentWorkflowConfig?.workflow?.states?.find((item) => item.name === input.stateName)
      : null;
    state?.steps?.forEach((step) => addName(getStepRuntimeAgentName(step)));
    if (names.size === 0) {
      this.agents.forEach((agent) => addName(agent.name));
    }
    return [...names].slice(0, 8);
  }

  private async requestSpecRevisionVoteFromAgent(
    agentName: string,
    context: string,
    config: StateMachineWorkflowConfig
  ): Promise<SpecRevisionVoteAgentDecision> {
    const prompt = [
      '请作为工作流议场成员，判断当前是否需要修订 Run Spec Coding。',
      '只能在以下三项中选择一个：',
      '- revise: 需要修订 requirements/design/tasks/progress 中的内容',
      '- keep: 当前 spec 仍准确，无需修订',
      '- defer: 信息不足，暂缓判断',
      '',
      '请输出 <result> JSON，格式：',
      '{"kind":"spec_revision_vote","payload":{"choice":"revise|keep|defer","reason":"你的理由，说明是否受人工输入、AI结论或状态跳转影响"}}',
      '',
      '# 上下文',
      context,
    ].join('\n');

    const rawOutput = await this.queryAgent(agentName, prompt, config);
    const parsed = extractStructuredResult<any>(rawOutput, (value: any): value is any => (
      value?.kind === 'spec_revision_vote'
      || value?.type === 'spec_revision_vote'
      || value?.kind === 'vote'
      || value?.type === 'vote'
    )) || this.extractJsonObject(rawOutput);
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
    const choice = this.normalizeSpecRevisionVoteChoice(payload?.choice || payload?.vote || payload?.decision);
    const reason = typeof payload?.reason === 'string' && payload.reason.trim()
      ? payload.reason.trim()
      : compactStepConclusion(rawOutput).slice(0, 1000) || `${agentName} 未提供理由`;

    return { choice, reason, rawOutput };
  }

  private async requestSupervisorSpecRevisionDecision(
    vote: WorkflowSpecRevisionVoteRecord,
    context: string,
    config: StateMachineWorkflowConfig
  ): Promise<SpecRevisionVoteSupervisorDecision> {
    const ballotSummary = vote.ballots.map((ballot) => (
      `- ${ballot.agent}: ${getSpecRevisionChoiceLabel(ballot.choice)}。${ballot.reason}`
    )).join('\n') || '- 无有效投票';
    const prompt = [
      `你是工作流指挥官 ${this.currentSupervisorAgent}。内部 Agent 已完成一次 spec 修订表决，请根据投票、人工输入和 AI 执行结论做最终判断。`,
      '',
      `推荐结果: ${getSpecRevisionChoiceLabel(vote.recommendedChoice || 'defer')}`,
      `票数: revise=${vote.tally.revise}, keep=${vote.tally.keep}, defer=${vote.tally.defer}`,
      '',
      'Agent 投票:',
      ballotSummary,
      '',
      '# 上下文',
      context,
      '',
      '如果需要修订，请在同一回复中输出两个 <result>：',
      '1. {"kind":"spec_coding_revision","payload":{"apply":true,"summary":"修订摘要","affectedArtifacts":["requirements","design","tasks"],"impact":["影响点"]}}',
      '2. {"kind":"plan_draft","payload":{"summary":"新的摘要","goals":[],"nonGoals":[],"constraints":[],"clarification":{"summary":"进度摘要"},"artifacts":{"requirements":"完整 requirements.md","design":"完整 design.md","tasks":"完整 tasks.md"}}}',
      '',
      '如果不需要修订，只输出 spec_coding_revision，apply=false，并说明理由。',
    ].join('\n');

    const rawOutput = await this.queryAgent(this.currentSupervisorAgent, prompt, config);
    const parsed = extractStructuredResult<any>(rawOutput, (value: any): value is any => (
      value?.kind === 'spec_coding_revision'
      || value?.type === 'spec_coding_revision'
      || value?.type === 'spec-coding-revision'
    )) || this.extractJsonObject(rawOutput);
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : parsed;
    const recommendedApply = vote.recommendedChoice === 'revise';
    return {
      apply: typeof payload?.apply === 'boolean' ? payload.apply : recommendedApply,
      summary: typeof payload?.summary === 'string' && payload.summary.trim()
        ? payload.summary.trim()
        : (recommendedApply ? '内部表决建议修订 Spec Coding。' : '内部表决建议保持当前 Spec Coding。'),
      affectedArtifacts: normalizeStringArray(payload?.affectedArtifacts || payload?.affected_artifacts, 6),
      impact: normalizeStringArray(payload?.impact, 8),
      rawOutput,
    };
  }

  private async applySupervisorVoteSpecRevision(
    vote: WorkflowSpecRevisionVoteRecord,
    decision: SpecRevisionVoteSupervisorDecision,
    config: StateMachineWorkflowConfig
  ): Promise<WorkflowSpecRevisionVoteRecord> {
    if (!this.currentRunSpecCoding || !decision.apply) {
      return {
        ...vote,
        revision: {
          applied: false,
          summary: decision.summary,
          affectedArtifacts: decision.affectedArtifacts,
          error: null,
        },
      };
    }

    const draft = extractPlanDraftResult(decision.rawOutput);
    if (!draft) {
      return {
        ...vote,
        revision: {
          applied: false,
          summary: decision.summary,
          affectedArtifacts: decision.affectedArtifacts,
          error: 'Supervisor 未返回 plan_draft，已记录决策但未自动改写 spec。',
        },
      };
    }

    try {
      let nextSpecCoding = applyAiSpecCodingDraft(this.currentRunSpecCoding, draft);
      nextSpecCoding = appendSpecCodingRevision(nextSpecCoding, {
        summary: decision.summary,
        createdBy: this.currentSupervisorAgent,
        status: nextSpecCoding.status === 'draft' ? 'in-progress' : nextSpecCoding.status,
        progressSummary: decision.summary,
      });

      const compiled = compileStepTaskBindings(config, nextSpecCoding);
      if (!compiled.validation.ok) {
        throw new Error(`自动修订后的 Spec task 与 workflow step 绑定不一致: ${compiled.validation.errors.join('; ')}`);
      }
      this.currentWorkflowConfig = compiled.config as StateMachineWorkflowConfig;
      this.bindingValidation = compiled.validation;
      this.stepTaskBindingsSnapshot = compiled.validation.bindings;
      this.stepTaskBindingsByStepKey = new Map(
        this.stepTaskBindingsSnapshot.map((binding) => [binding.stepKey, binding])
      );
      this.currentRunSpecCoding = nextSpecCoding;
      this.deltaSpecMerged = false;
      await this.syncRunSpecCodingDelta().catch(() => {});

      this.latestSupervisorReview = {
        type: 'chat-revision',
        stateName: vote.stateName || this.currentState || '全局',
        content: decision.summary,
        timestamp: new Date().toISOString(),
        affectedArtifacts: decision.affectedArtifacts,
        impact: decision.impact,
      };
      this.emit('supervisor-review', this.latestSupervisorReview);

      return {
        ...vote,
        revision: {
          applied: true,
          summary: decision.summary,
          affectedArtifacts: decision.affectedArtifacts,
          error: null,
        },
      };
    } catch (error: any) {
      return {
        ...vote,
        revision: {
          applied: false,
          summary: decision.summary,
          affectedArtifacts: decision.affectedArtifacts,
          error: error?.message || String(error),
        },
      };
    }
  }

  private async runSpecRevisionVote(input: SpecRevisionVoteTriggerInput, config: StateMachineWorkflowConfig): Promise<void> {
    if (!this.currentRunId || !this.currentRunSpecCoding || config.workflow.supervisor?.enabled === false || this.shouldStop) {
      return;
    }

    const context = this.buildSpecRevisionVoteContext(input);
    const voters = this.getSpecRevisionVoterAgents(input);
    if (voters.length === 0) return;

    const voteId = `spec-revision-vote-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const voteTitle = input.trigger === 'human-review'
      ? '人工审查后 Spec 修订表决'
      : input.trigger === 'force-transition'
        ? '强制跳转后 Spec 修订表决'
        : '状态完成后 Spec 修订表决';
    const voteQuestion = '是否需要基于本次人工输入、AI 结论或状态流转修订 Run Spec Coding？';
    let vote: WorkflowSpecRevisionVoteRecord = {
      id: voteId,
      trigger: input.trigger,
      title: voteTitle,
      question: voteQuestion,
      status: 'running',
      stateName: input.stateName || null,
      nextState: input.nextState || null,
      contextSummary: [
        input.stateName ? `状态 ${input.stateName}` : '',
        input.nextState ? `下一状态 ${input.nextState}` : '',
        input.result?.verdict ? `verdict=${input.result.verdict}` : '',
      ].filter(Boolean).join('；') || undefined,
      createdAt: new Date().toISOString(),
      ballots: [],
      tally: createEmptySpecRevisionTally(),
    };

    this.specRevisionVote = vote;
    await this.persistState();
    await this.appendSupervisorChatEvent({
      type: 'spec-revision-vote',
      title: vote.title,
      body: `${vote.question}\n参与 Agent: ${voters.join('、')}`,
      tags: ['spec', 'vote', input.trigger],
      dedupeKey: `workflow-spec-revision-vote-start-${vote.id}`,
      speakerName: this.currentSupervisorAgent,
    });
    this.emitSpecRevisionVoteStatus('已发起 Spec 修订内部表决');

    const ballots: WorkflowSpecRevisionBallot[] = [];
    for (const agentName of voters) {
      if (this.shouldStop) break;
      try {
        const decision = await this.requestSpecRevisionVoteFromAgent(agentName, context, config);
        ballots.push({
          agent: agentName,
          choice: decision.choice,
          reason: decision.reason,
          votedAt: new Date().toISOString(),
        });
      } catch (error: any) {
        ballots.push({
          agent: agentName,
          choice: 'defer',
          reason: error?.message || String(error),
          votedAt: new Date().toISOString(),
        });
      }
      vote = {
        ...vote,
        ballots: [...ballots],
        tally: countSpecRevisionVotes(ballots),
      };
      this.specRevisionVote = vote;
      await this.persistState();
      this.emitSpecRevisionVoteStatus(`${agentName} 已完成 Spec 修订表决`);
    }

    vote = {
      ...vote,
      status: 'completed',
      completedAt: new Date().toISOString(),
      ballots,
      tally: countSpecRevisionVotes(ballots),
      recommendedChoice: decideSpecRevisionChoice(countSpecRevisionVotes(ballots)),
    };

    const decision = await this.requestSupervisorSpecRevisionDecision(vote, context, this.currentWorkflowConfig || config);
    vote = {
      ...vote,
      supervisorDecision: {
        apply: decision.apply,
        summary: decision.summary,
        madeAt: new Date().toISOString(),
        affectedArtifacts: decision.affectedArtifacts,
        impact: decision.impact,
      },
    };
    vote = await this.applySupervisorVoteSpecRevision(vote, decision, this.currentWorkflowConfig || config);

    this.specRevisionVote = vote;
    this.specRevisionVoteHistory = [vote, ...this.specRevisionVoteHistory.filter((item) => item.id !== vote.id)].slice(0, 20);
    await this.persistState();
    await this.appendSupervisorChatEvent({
      type: 'spec-revision-vote-result',
      title: `Spec 修订表决完成：${getSpecRevisionChoiceLabel(vote.recommendedChoice || 'defer')}`,
      body: [
        `票数: 修订 ${vote.tally.revise} / 保持 ${vote.tally.keep} / 暂缓 ${vote.tally.defer}`,
        vote.supervisorDecision?.summary,
        vote.revision?.applied ? 'Supervisor 已应用 spec 修订。' : vote.revision?.error ? `未自动应用: ${vote.revision.error}` : '未应用 spec 修订。',
      ].filter(Boolean).join('\n'),
      tags: ['spec', 'vote-result', input.trigger],
      dedupeKey: `workflow-spec-revision-vote-result-${vote.id}`,
      speakerName: this.currentSupervisorAgent,
    });
    this.emitSpecRevisionVoteStatus('Spec 修订内部表决完成');
  }

  private shouldQueueSpecRevisionVote(input: SpecRevisionVoteTriggerInput, config: StateMachineWorkflowConfig): boolean {
    if (!this.currentRunSpecCoding || this.shouldStop) return false;
    const stateName = input.stateName || this.currentState || '';
    const state = config.workflow.states.find((item) => item.name === stateName);
    return state?.enableSpecRevisionOnComplete === true;
  }

  private queueSpecRevisionVote(input: SpecRevisionVoteTriggerInput, config: StateMachineWorkflowConfig): void {
    const workflowConfig = this.currentWorkflowConfig || config;
    if (!this.shouldQueueSpecRevisionVote(input, workflowConfig)) return;
    this.specRevisionVoteTail = this.specRevisionVoteTail
      .catch(() => {})
      .then(() => this.runSpecRevisionVote(input, workflowConfig))
      .catch(async (error: any) => {
        const now = new Date().toISOString();
        const failedVote: WorkflowSpecRevisionVoteRecord = {
          id: `spec-revision-vote-failed-${Date.now()}-${randomUUID().slice(0, 8)}`,
          trigger: input.trigger,
          title: 'Spec 修订表决失败',
          question: '是否需要修订 Run Spec Coding？',
          status: 'failed',
          stateName: input.stateName || null,
          nextState: input.nextState || null,
          contextSummary: error?.message || String(error),
          createdAt: now,
          completedAt: now,
          ballots: [],
          tally: createEmptySpecRevisionTally(),
          recommendedChoice: 'defer',
          revision: {
            applied: false,
            summary: '内部表决执行失败',
            error: error?.message || String(error),
          },
        };
        this.specRevisionVote = failedVote;
        this.specRevisionVoteHistory = [failedVote, ...this.specRevisionVoteHistory].slice(0, 20);
        this.emitSpecRevisionVoteStatus('Spec 修订内部表决失败');
        await this.persistState();
      });
  }

  private async ensureWorkflowGitBaseline(workspacePath?: string | null): Promise<void> {
    if (!this.currentRunId || !workspacePath) return;
    try {
      this.workflowGit = await ensureWorkflowGitState({
        workspacePath,
        runId: this.currentRunId,
        existing: this.workflowGit || undefined,
      });
      await this.persistState();
    } catch (error: any) {
      this.workflowGit = {
        enabled: false,
        runId: this.currentRunId,
        workspacePath,
        repoRoot: workspacePath,
        wasGitRepository: false,
        initializedRepository: false,
        snapshots: [],
        stepDiffs: [],
        error: error?.message || String(error),
        updatedAt: new Date().toISOString(),
      };
      await this.persistState();
    }
  }

  private async disableWorkflowGitBaseline(workspacePath?: string | null): Promise<void> {
    if (!this.currentRunId || !workspacePath) return;
    this.workflowGit = {
      enabled: false,
      runId: this.currentRunId,
      workspacePath,
      repoRoot: workspacePath,
      wasGitRepository: false,
      initializedRepository: false,
      snapshots: [],
      stepDiffs: [],
      error: 'Git 基线已在工作流配置中关闭',
      updatedAt: new Date().toISOString(),
    };
    await this.persistState();
  }

  private async recordStepGitBefore(input: {
    stepLogId: string;
    stepName: string;
    stateName?: string;
    agent: string;
  }): Promise<string | undefined> {
    if (!this.workflowGit?.enabled) return undefined;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'step-before',
        label: `步骤开始前: ${input.stepName}`,
        stepName: input.stepName,
        stateName: input.stateName,
        agent: input.agent,
      });
      this.workflowGit = upsertWorkflowGitStepDiff(recorded.state, {
        id: `git-step-${input.stepLogId}`,
        stepLogId: input.stepLogId,
        stepName: input.stepName,
        stateName: input.stateName,
        agent: input.agent,
        status: 'running',
        beforeSnapshotId: recorded.snapshot.id,
        startedAt: new Date().toISOString(),
      });
      await this.persistState();
      return recorded.snapshot.id;
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState();
      return undefined;
    }
  }

  private async recordStepGitAfter(input: {
    stepLogId: string;
    stepName: string;
    stateName?: string;
    agent: string;
    status: 'completed' | 'failed';
    beforeSnapshotId?: string;
  }): Promise<string | undefined> {
    if (!this.workflowGit?.enabled) return undefined;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'step-after',
        label: `步骤结束后: ${input.stepName}`,
        stepName: input.stepName,
        stateName: input.stateName,
        agent: input.agent,
      });
      const existing = this.workflowGit.stepDiffs.find((item) => item.id === `git-step-${input.stepLogId}`);
      this.workflowGit = upsertWorkflowGitStepDiff(recorded.state, {
        id: `git-step-${input.stepLogId}`,
        stepLogId: input.stepLogId,
        stepName: input.stepName,
        stateName: input.stateName,
        agent: input.agent,
        status: input.status,
        beforeSnapshotId: existing?.beforeSnapshotId || input.beforeSnapshotId || recorded.snapshot.id,
        afterSnapshotId: recorded.snapshot.id,
        startedAt: existing?.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      await this.persistState();
      return recorded.snapshot.id;
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState();
      return undefined;
    }
  }

  private async recordFinalGitSnapshot(status: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.workflowGit?.enabled) return;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'run-final',
        label: `工作流结束: ${status}`,
        stateName: this.currentState || undefined,
        agent: this.currentSupervisorAgent || undefined,
      });
      this.workflowGit = recorded.state;
      await this.persistState(status);
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState(status);
    }
  }

  private buildFallbackFinalReview(status: 'completed' | 'failed' | 'stopped'): WorkflowFinalReview {
    const generatedAt = new Date().toISOString();
    return {
      runId: this.currentRunId || '',
      configFile: this.currentConfigFile,
      workflowName: undefined,
      projectRoot: this.getWorkingDirectory() || undefined,
      workflowMode: 'state-machine',
      supervisorAgent: this.currentSupervisorAgent,
      status,
      summary: `工作流以 ${status} 状态结束。建议结合运行记录进一步复盘。`,
      nextFocus: this.issueTracker.slice(0, 3).map((issue) => `${issue.type}: ${issue.description}`),
      experience: this.issueTracker.slice(0, 3).map((issue) => `记录 ${issue.type} 类问题的排查与修复路径，避免重复出现。`),
      scoreCards: this.agents.map((agent) => ({
        agent: agent.name,
        score: agent.status === 'completed' ? 8.5 : agent.status === 'failed' ? 5.5 : 7.0,
        strengths: agent.completedTasks > 0 ? ['完成了分配步骤'] : [],
        weaknesses: agent.status !== 'completed' ? ['结果仍需进一步验证'] : [],
      })),
      agentNames: this.agents.map((agent) => agent.name),
      keywords: [],
      generatedAt,
    };
  }

  private flattenSpecCodingTasks(tasks: SpecCodingDocument['tasks'] = []): SpecCodingDocument['tasks'] {
    const result: SpecCodingDocument['tasks'] = [];
    const visit = (items: SpecCodingDocument['tasks']) => {
      for (const item of items || []) {
        result.push(item);
        if (Array.isArray(item.children) && item.children.length > 0) {
          visit(item.children);
        }
      }
    };
    visit(tasks);
    return result;
  }

  private async collectChildSpecDeltaSummaries(): Promise<WorkflowChildSpecDeltaSummary[]> {
    const summaries: WorkflowChildSpecDeltaSummary[] = [];
    for (const childRef of this.subworkflowRuns) {
      const childState = await loadRunState(childRef.runId).catch(() => null);
      const spec = childState?.runSpecCoding ? normalizeSpecCodingDocument(childState.runSpecCoding) : null;
      if (!childState && !spec) continue;
      const tasks = spec ? this.flattenSpecCodingTasks(spec.tasks || []) : [];
      const latestVote = childState?.specRevisionVoteHistory?.[0] || childState?.specRevisionVote || null;
      summaries.push({
        runId: childRef.runId,
        configFile: childRef.configFile,
        parentStateName: childRef.parentStateName,
        parentStepName: childRef.parentStepName,
        status: childState?.status || childRef.status,
        workflowName: childState?.workflowName || spec?.workflowName,
        specStatus: spec?.status,
        specVersion: spec?.version,
        progressSummary: spec?.progress?.summary || childRef.summary,
        completedTaskCount: tasks.filter((task) => task.status === 'completed').length,
        totalTaskCount: tasks.length,
        artifactKeys: spec?.artifacts
          ? Object.entries(spec.artifacts)
            .filter(([, value]) => typeof value === 'string' && value.trim().length > 0)
            .map(([key]) => key)
          : [],
        latestRevision: spec?.revisions?.at(-1) || null,
        latestVote: latestVote
          ? {
              id: latestVote.id,
              status: latestVote.status,
              recommendedChoice: latestVote.recommendedChoice,
              summary: latestVote.supervisorDecision?.summary || latestVote.contextSummary,
            }
          : null,
        deltaMerge: childState?.deltaMergeState
          ? {
              status: childState.deltaMergeState.status,
              requestedAt: childState.deltaMergeState.requestedAt,
              appliedAt: childState.deltaMergeState.appliedAt,
              aiSummary: childState.deltaMergeState.aiSummary,
              error: childState.deltaMergeState.error,
            }
          : null,
      });
    }
    return summaries;
  }

  private async finalizeSupervisorOutputs(status: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.currentRunId || !this.currentConfigFile) return;
    const configPath = await getRuntimeWorkflowConfigPath(this.currentConfigFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    const supervisorConfig = workflowConfig.workflow.supervisor;
    if (supervisorConfig?.enabled === false) return;

    const scoringEnabled = supervisorConfig?.scoringEnabled !== false;
    const experienceEnabled = supervisorConfig?.experienceEnabled !== false;
    if (!scoringEnabled && !experienceEnabled) return;
    const childSpecDeltas = await this.collectChildSpecDeltaSummaries();

    const summaryPrompt = [
      '你是 CSIHarness 的工作流指挥官，请输出本次工作流的结算结果。',
      '请严格输出 JSON，不要附加其他说明。',
      'scoreCards.score 使用 10 分制，范围 0-10，可保留 1 位小数。',
      'JSON 结构：',
      '{"summary":"", "nextFocus":[""], "experience":[""], "scoreCards":[{"agent":"", "score":0, "strengths":[""], "weaknesses":[""]}]}',
      '',
      `工作流状态: ${status}`,
      `当前状态数: ${this.stateHistory.length}`,
      `问题数: ${this.issueTracker.length}`,
      '',
      'Agent 执行数据：',
      ...this.agents.map((agent) => `- ${agent.name}: status=${agent.status}, completedTasks=${agent.completedTasks}, costUsd=${agent.costUsd}, summary=${agent.summary || ''}`),
      '',
      '子工作流摘要：',
      ...(this.subworkflowRuns.length > 0
        ? this.subworkflowRuns.map((child) => `- ${child.parentStateName || '-'} / ${child.parentStepName || '-'} -> ${child.configFile} (${child.runId}): status=${child.status}, verdict=${child.verdict || '-'}, summary=${(child.summary || '').replace(/\s+/g, ' ').slice(0, 1000)}`)
        : ['- 无']),
      '',
      '子工作流 Spec Delta：',
      ...(childSpecDeltas.length > 0
        ? childSpecDeltas.map((child) => [
            `- ${child.parentStateName || '-'} / ${child.parentStepName || '-'} -> ${child.configFile} (${child.runId})`,
            `  - runStatus=${child.status || '-'}, specStatus=${child.specStatus || '-'}, specVersion=${child.specVersion || '-'}`,
            `  - tasks=${child.completedTaskCount}/${child.totalTaskCount}, artifacts=${child.artifactKeys.join(',') || '-'}`,
            child.progressSummary ? `  - progress=${child.progressSummary.replace(/\s+/g, ' ').slice(0, 600)}` : '',
            child.latestRevision?.summary ? `  - latestRevision=${child.latestRevision.summary.replace(/\s+/g, ' ').slice(0, 600)}` : '',
            child.latestVote?.summary ? `  - latestVote=${child.latestVote.status}/${child.latestVote.recommendedChoice || '-'}: ${child.latestVote.summary.replace(/\s+/g, ' ').slice(0, 400)}` : '',
            child.deltaMerge?.status ? `  - deltaMerge=${child.deltaMerge.status}${child.deltaMerge.aiSummary ? `: ${child.deltaMerge.aiSummary.replace(/\s+/g, ' ').slice(0, 400)}` : ''}` : '',
          ].filter(Boolean).join('\n'))
        : ['- 无']),
      '',
      '问题摘要：',
      ...(this.issueTracker.length > 0
        ? this.issueTracker.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.description}`)
        : ['- 无']),
    ].join('\n');

    const raw = await this.queryAgent(this.currentSupervisorAgent, summaryPrompt, workflowConfig);
    const parsed = this.extractJsonObject(raw);
    const fallback = this.buildFallbackFinalReview(status);
    const finalReview: WorkflowFinalReview = {
      ...fallback,
      ...(parsed && typeof parsed === 'object' ? {
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : fallback.summary,
        nextFocus: Array.isArray(parsed.nextFocus) ? parsed.nextFocus.filter((item: unknown) => typeof item === 'string') : fallback.nextFocus,
        experience: Array.isArray(parsed.experience) ? parsed.experience.filter((item: unknown) => typeof item === 'string') : fallback.experience,
        scoreCards: Array.isArray(parsed.scoreCards)
          ? parsed.scoreCards
            .filter((item: any) => item && typeof item.agent === 'string')
            .map((item: any) => ({
              agent: item.agent,
              score: this.normalizeWorkflowScore(item.score),
              strengths: Array.isArray(item.strengths) ? item.strengths.filter((v: unknown) => typeof v === 'string') : [],
              weaknesses: Array.isArray(item.weaknesses) ? item.weaknesses.filter((v: unknown) => typeof v === 'string') : [],
            }))
          : fallback.scoreCards,
      } : {}),
      runId: this.currentRunId,
      configFile: this.currentConfigFile,
      workflowName: workflowConfig.workflow.name,
      projectRoot: this.getWorkingDirectory() || workflowConfig.context?.projectRoot || undefined,
      workflowMode: 'state-machine',
      supervisorAgent: this.currentSupervisorAgent,
      status,
      agentNames: this.agents.map((agent) => agent.name),
      childSpecDeltas,
      keywords: [
        workflowConfig.workflow.name,
        workflowConfig.context?.requirements,
        ...(this.issueTracker.slice(0, 5).map((issue) => issue.type)),
        ...(this.agents.slice(0, 6).map((agent) => agent.name)),
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      generatedAt: new Date().toISOString(),
    };

    if (scoringEnabled) {
      await saveWorkflowFinalReview(finalReview);
    }
    if (experienceEnabled) {
      await appendWorkflowExperience(finalReview);
    }
    await appendMemoryEntries([
      {
        scope: 'workflow',
        key: this.currentConfigFile,
        kind: 'review',
        title: `${workflowConfig.workflow.name} 运行复盘`,
        content: finalReview.summary,
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['workflow', status],
      },
      {
        scope: 'project',
        key: this.getWorkingDirectory() || workflowConfig.context?.projectRoot || this.currentConfigFile,
        kind: 'experience',
        title: `${workflowConfig.workflow.name} 项目经验`,
        content: [...finalReview.experience, ...finalReview.nextFocus].filter(Boolean).join('；'),
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['project', status],
      },
      {
        scope: 'role',
        key: this.currentSupervisorAgent,
        kind: 'review',
        title: `${this.currentSupervisorAgent} 监督复盘`,
        content: finalReview.summary,
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['role', 'supervisor', status],
      },
      ...finalReview.scoreCards.map((card) => ({
        scope: 'role' as const,
        key: card.agent,
        kind: 'experience' as const,
        title: `${card.agent} 协作评分`,
        content: [
          `得分 ${card.score}`,
          card.strengths.length ? `优势: ${card.strengths.join('；')}` : '',
          card.weaknesses.length ? `短板: ${card.weaknesses.join('；')}` : '',
        ].filter(Boolean).join('；'),
        source: 'workflow-score-card',
        runId: this.currentRunId || undefined,
        configFile: this.currentConfigFile,
        agent: card.agent,
        tags: ['role', 'score-card', status],
      })),
    ]).catch(() => {});
    const relationshipTasks: Promise<void>[] = [];
    for (let i = 0; i < finalReview.scoreCards.length; i += 1) {
      for (let j = i + 1; j < finalReview.scoreCards.length; j += 1) {
        const left = finalReview.scoreCards[i];
        const right = finalReview.scoreCards[j];
        const deltaScore = Math.round((((left.score + right.score) / 2) - 6.5) / 0.4);
        relationshipTasks.push(
          upsertRelationshipSignal({
            agent: left.agent,
            peer: right.agent,
            deltaScore,
            strengths: [...left.strengths, ...right.strengths].slice(0, 4),
            runId: this.currentRunId || undefined,
            configFile: this.currentConfigFile,
          })
        );
      }
    }
    await Promise.allSettled(relationshipTasks);
  }

  private normalizeWorkflowScore(raw: unknown): number {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return 7.0;
    const normalized = numeric > 10 ? numeric / 10 : numeric;
    return Math.round(Math.max(0, Math.min(10, normalized)) * 10) / 10;
  }

  /**
   * Initialize the AI engine based on workflow config first, then global config.
   */
  private async initializeEngine(workflowEngine?: string): Promise<void> {
    try {
      const requestedEngine = workflowEngine?.trim();
try {
        this.engineType = requestedEngine
          ? await resolveRequestedEngineType(requestedEngine)
          : await getConfiguredEngine();
      } catch {
        const globalEngine = await getConfiguredEngine();
        this.emit('log', `工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
        this.engineType = globalEngine;
      }
      this.emit('log', `使用引擎: ${this.engineType}`);

      // Always initialize currentEngine for the selected engine, including claude-code.
      this.currentEngine = await createEngine(this.engineType);
      if (!this.currentEngine) {
        throw new Error(`引擎初始化失败: ${this.engineType} 不可用`);
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async ensureEngineForExecution(requestedEngine?: string): Promise<void> {
    const requested = String(requestedEngine || this.engineType || '').trim();
    let resolvedEngine: EngineType;
    try {
      resolvedEngine = requested
        ? await resolveRequestedEngineType(requested)
        : await getConfiguredEngine();
    } catch {
      resolvedEngine = await getConfiguredEngine();
      this.emit('log', `Agent 配置的引擎无效: ${requested || '<empty>'}，回退到全局引擎 ${resolvedEngine}`);
    }

    if (this.currentEngine && this.engineType === resolvedEngine) return;

    if (this.currentEngine) {
      try {
        this.currentEngine.cancel();
      } catch {}
      const cleanup = (this.currentEngine as any).cleanup;
      if (typeof cleanup === 'function') {
        try {
          cleanup.call(this.currentEngine);
        } catch {}
      }
    }

    const nextEngine = await createEngine(resolvedEngine);
    if (!nextEngine) {
      throw new Error(`引擎初始化失败: ${resolvedEngine} 不可用`);
    }
    this.currentEngine = nextEngine;
    this.engineType = resolvedEngine;
    this.emit('log', `使用引擎: ${this.engineType}`);
  }

  /**
   * Execute a task using the configured engine (Kiro CLI, Claude Code, etc.)
   */
  private async executeWithEngine(
    processId: string,
    agent: string,
    step: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    options: any
  ): Promise<EngineJsonResult> {
    return this.withEngineExecutionLock(async () => {
      await this.ensureEngineForExecution(options.engineType);
      if (!this.currentEngine) {
        throw new Error(`引擎未初始化 (engineType=${this.engineType})`);
      }

      const engine = this.currentEngine;
      const displayStep =
        options.streamStepName || options.streamStepLabel || step;

      // Register process in processManager so it's visible to the frontend.
      const proc = processManager.registerExternalProcess(
        processId,
        agent,
        displayStep,
        options.runId,
        options.stepId
      );
      (proc as any)._cancelFn = () => {
        try {
          engine.cancel();
        } catch {
          // Best-effort cancellation; process state is still marked as killed.
        }
      };

      let fullStreamContent = '';

      const streamHandler = (event: EngineStreamEvent) => {
        // 'thought' events are forwarded separately (matching Claude Code's { thinking } field),
        // not accumulated into streamContent.
        if (event.type === 'thought') {
          processManager.emit('stream', {
            id: processId,
            step: displayStep,
            thinking: event.content,
          });
          return;
        }

        // Only accumulate 'text' events into the preview stream.
        if (event.type !== 'text') return;

        fullStreamContent += event.content;
        const retainedPreview = processManager.appendStreamContent(processId, event.content) || event.content;
        processManager.emit('stream', {
          id: processId,
          step: displayStep,
          delta: event.content,
          total: retainedPreview,
        });
      };

      engine.on('stream', streamHandler);

      try {
        const result = await executeEngineWithContextRecovery(engine, {
          agent, step, prompt, systemPrompt, model,
          workingDirectory: options.workingDirectory,
          allowedTools: options.allowedTools,
          timeoutMs: options.timeoutMs,
          sessionId: options.resumeSessionId,
          appendSystemPrompt: options.appendSystemPrompt,
          runId: options.runId,
          mcpServers: options.mcpServers,
          userId: this._createdBy,
          env: buildRuntimeDatabaseEnv(this.runtimeDatabaseGrant),
        }, {
          onContextReset: (event) => {
            this.emit('log', {
              agent,
              level: 'warning',
              message: `上下文超限，已清空 ${this.engineType} 会话并重试: ${event.method}`,
            });
          },
        });

        // Mark process as completed
        const resolvedSessionId = resolveRecoveredSessionId(result, options.resumeSessionId);
        const rawProc = processManager.getProcessRaw(processId);
        if (rawProc) {
          rawProc.status = result.success ? 'completed' : 'failed';
          rawProc.endTime = new Date();
          processManager.setProcessOutput(processId, result.output || fullStreamContent || rawProc.streamContent);
          rawProc.sessionId = resolvedSessionId || undefined;
          if (!result.success) {
            processManager.setProcessError(processId, result.error || result.output || '引擎执行失败（无输出）');
          }
        }

        const metadata = result.metadata;
        const usage = normalizeEngineUsage(metadata);

        const fallbackOutput = result.output || fullStreamContent || rawProc?.streamContent || '';
        return {
          result: result.success ? fallbackOutput : (result.error || fallbackOutput || '引擎执行失败（无输出）'),
          session_id: resolvedSessionId || '',
          is_error: !result.success,
          cost_usd: metadataNumber(metadata, 'cost_usd', 'costUsd'),
          duration_ms: metadataNumber(metadata, 'duration_ms', 'durationMs'),
          duration_api_ms: metadataNumber(metadata, 'duration_api_ms', 'durationApiMs'),
          num_turns: metadataNumber(metadata, 'num_turns', 'numTurns'),
          usage,
        };
      } finally {
        engine.off('stream', streamHandler);
      }
    });
  }

  private initializeAgents(workflowConfig: StateMachineWorkflowConfig): void {
    const runtimeAgentRoles = new Map<string, string>();
    const addRuntimeAgent = (runtimeName: string | undefined, baseRole: string | undefined) => {
      if (!runtimeName || !baseRole) return;
      if (!runtimeAgentRoles.has(runtimeName)) runtimeAgentRoles.set(runtimeName, baseRole);
    };

    for (const state of workflowConfig.workflow.states) {
      for (const step of state.steps) {
        addRuntimeAgent(getStepRuntimeAgentName(step), step.agent);
      }
    }
    if (workflowConfig.workflow.supervisor?.enabled !== false) {
      addRuntimeAgent(this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME, this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME);
    }

    this.agents = Array.from(runtimeAgentRoles.entries()).map(([agentName, baseRole]) => {
      const roleConfig = this.agentConfigs.find((r) => r.name === baseRole)
        || workflowConfig.roles?.find((r) => r.name === baseRole);
      const selection = resolveAgentEngineSelection(roleConfig, workflowConfig.context);
      return {
        name: agentName,
        team: roleConfig?.team || (baseRole === this.currentSupervisorAgent ? 'black-gold' : 'blue'),
        engine: selection.engine,
        model: selection.model,
        status: 'waiting',
        currentTask: null,
        completedTasks: 0,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        costUsd: 0,
        sessionId: null,
        lastOutput: '',
        summary: '',
      };
    });

    this.emit('agents', { agents: this.agents });
  }

  private ensureSupervisorAgentExists(workflowConfig: StateMachineWorkflowConfig): void {
    const supervisorName = this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    const existsInConfigs = this.agentConfigs.some((config) => config.name === supervisorName);
    const existsInWorkflow = workflowConfig.roles?.some((config) => config.name === supervisorName);
    if (!existsInConfigs && !existsInWorkflow) {
      this.currentSupervisorAgent = DEFAULT_SUPERVISOR_NAME;
    }
  }

  private getSegmentHandoffDelayMs(config: StateMachineWorkflowConfig): number {
    const raw = config.context?.segmentDelayMs ?? process.env.ACE_STATE_SEGMENT_DELAY_MS;
    const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw || '0'), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    return Math.min(parsed, 30000);
  }

  private runSupervisorReviewInBackground(
    type: 'state-review' | 'checkpoint-advice',
    state: StateMachineState,
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig,
    nextState?: string
  ): void {
    void this.collectSupervisorReview(type, state, result, config, nextState).catch((error: any) => {
      const message = error?.message || 'Supervisor 审阅失败';
      const timestamp = new Date().toISOString();
      this.supervisorFlow.push({
        type: `${type}-error`,
        from: this.currentSupervisorAgent,
        to: state.name,
        question: message,
        round: this.transitionCount,
        timestamp,
        stateName: state.name,
      });
      this.emit('supervisor-review', {
        type,
        stateName: state.name,
        content: `Supervisor 异步审阅失败: ${message}`,
        timestamp,
      });
      this.emit('log', { message: `Supervisor 异步审阅失败: ${message}` });
    });
  }

  private async collectSupervisorReview(
    type: 'state-review' | 'checkpoint-advice',
    state: StateMachineState,
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig,
    nextState?: string
  ): Promise<string | null> {
    if (config.workflow.supervisor?.enabled === false) return null;
    if (type === 'state-review' && config.workflow.supervisor?.stageReviewEnabled === false) return null;
    if (type === 'checkpoint-advice' && config.workflow.supervisor?.checkpointAdviceEnabled === false) return null;

    const issueSummary = result.issues.length > 0
      ? result.issues.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.description}`).join('\n')
      : '- 无';
    const stepSummary = result.stepOutputs
      .map((output, index) => {
        const snippet = output.replace(/\s+/g, ' ').trim().slice(0, 300);
        const step = state.steps[index];
        return `- ${step?.name || `步骤${index + 1}`}: ${snippet || '[无输出]'}`;
      })
      .join('\n');
    const specCodingGuardrail = this.currentRunSpecCoding
      ? [
        '当前 Run Spec Coding 投影：',
        `- 版本: v${this.currentRunSpecCoding.version}`,
        this.currentRunSpecCoding.summary ? `- 摘要: ${this.currentRunSpecCoding.summary}` : '',
        this.currentRunSpecCoding.progress?.summary ? `- 进度: ${this.currentRunSpecCoding.progress.summary}` : '',
        this.currentRunSpecCoding.tasks?.length
          ? `- tasks.md: ${this.currentRunSpecCoding.tasks.filter((task) => task.status === 'completed').length}/${this.currentRunSpecCoding.tasks.length} 已完成`
          : '',
        '- 你负责非状态内容的修订；普通步骤只能更新状态。',
      ].filter(Boolean).join('\n')
      : '';
    // 持久化模式：注入 CHECKLIST 问题
    let checklistBlock = '';
    if (this.currentRunSpecCoding?.persistMode === 'repository') {
      const workingDir = this.getWorkingDirectory() || config.context?.projectRoot;
      if (workingDir) {
        const specRootDir = getSpecRootDir(workingDir, this.currentRunSpecCoding.specRoot);
        const checklist = await readChecklist(specRootDir).catch(() => []);
        const unanswered = checklist.filter((q) => !q.answered);
        if (unanswered.length > 0) {
          checklistBlock = [
            '',
            '## CHECKLIST - 待提问问题',
            '以下问题来自仓库持久化 CHECKLIST.md，必须在人工审批或 supervisor 审查时全部提出：',
            ...unanswered.map((q) => `- [ ] ${q.text}`),
          ].join('\n');
        }
      }
    }
    const relatedExperiences = this.currentConfigFile
      ? await findRelevantWorkflowExperiences({
          configFile: this.currentConfigFile,
          workflowName: config.workflow?.name,
          requirements: config.context?.requirements,
          projectRoot: this.getWorkingDirectory() || config.context?.projectRoot,
          agentName: this.currentSupervisorAgent,
          excludeRunId: this.currentRunId || undefined,
          limit: 2,
        }).catch(() => [])
      : [];
    const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '修订前相关历史经验');
    const verdictTransitionContext = this.buildStateVerdictTransitionContext(state);
    const prompt = [
      `你是工作流指挥官 ${this.currentSupervisorAgent}。`,
      type === 'state-review'
        ? `请对状态阶段 "${state.name}" 做一次阶段审阅。`
        : `请在人工检查点前，对状态阶段 "${state.name}" 给出检查点建议。`,
      '',
      `当前 verdict: ${result.verdict}`,
      nextState ? `建议下一状态: ${nextState}` : '',
      verdictTransitionContext,
      '',
      '问题摘要：',
      issueSummary,
      '',
      '步骤输出摘要：',
      stepSummary || '- 无',
      experienceBlock,
      specCodingGuardrail ? `\n${specCodingGuardrail}` : '',
      checklistBlock ? `\n${checklistBlock}` : '',
      '',
      type === 'state-review'
        ? '请输出：1. 当前阶段结论 2. 是否建议继续迭代 3. 下一步指导意见'
        : '请输出：1. 是否建议人工放行 2. 若不建议放行，需重点检查的风险 3. 给操作者的简短建议',
    ].filter(Boolean).join('\n');

    const response = await this.queryAgent(this.currentSupervisorAgent, prompt, config);
    if (isEngineLevelFailure(response)) {
      throw new Error(response.trim() || 'Supervisor 模型调用失败');
    }
    const timestamp = new Date().toISOString();
    this.latestSupervisorReview = {
      type,
      stateName: state.name,
      content: response,
      timestamp,
    };
    this.supervisorFlow.push({
      type,
      from: this.currentSupervisorAgent,
      to: type === 'checkpoint-advice' ? 'user' : state.name,
      question: response,
      round: this.transitionCount,
      timestamp,
      stateName: state.name,
    });
    await this.appendSupervisorChatEvent({
      type,
      title: type === 'checkpoint-advice'
        ? `Supervisor 检查点建议：${state.name}`
        : `Supervisor 阶段审阅：${state.name}`,
      body: response,
      tags: [type, state.name],
      dedupeKey: `workflow-supervisor-review-${this.currentRunId}-${state.name}-${type}-${timestamp}`,
    });
    this.emit('supervisor-review', this.latestSupervisorReview);
    if (this.currentRunSpecCoding) {
      this.currentRunSpecCoding = appendSupervisorSpecCodingRevision(this.currentRunSpecCoding, {
        stateName: state.name,
        nextState,
        type,
        reviewContent: response,
        supervisorAgent: this.currentSupervisorAgent,
        verdict: result.verdict,
      });
      if (!state.isFinal) {
        this.keepRunSpecCodingActiveUntilWorkflowFinal(`状态 ${state.name} 已完成审阅，工作流仍在运行。`);
      }
    }
    await this.persistState();
    return response;
  }

  private deriveRunSpecCodingStateUpdate(
    state: StateMachineState,
    result: StateExecutionResult,
    nextState?: string | null
  ): { status: 'pending' | 'in-progress' | 'completed' | 'blocked'; summary: string } {
    if (result.verdict === 'fail') {
      return {
        status: 'blocked',
        summary: `状态 ${state.name} 执行失败，当前运行被标记为阻塞。`,
      };
    }

    if (state.isFinal) {
      return {
        status: 'completed',
        summary: `终止状态 ${state.name} 已完成，本轮运行已到达收口阶段。`,
      };
    }

    if (nextState && nextState !== state.name) {
      return {
        status: 'completed',
        summary: `状态 ${state.name} 已完成，下一状态为 ${nextState}。`,
      };
    }

    return {
      status: 'in-progress',
      summary: result.verdict === 'conditional_pass'
        ? `状态 ${state.name} 进入继续迭代。`
        : `状态 ${state.name} 仍在推进中。`,
    };
  }

  private async executeStateMachine(
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<void> {
    const maxTransitions = config.workflow.maxTransitions || 50;

    // If resuming, use existing currentState; otherwise find initial state
    if (!this.currentState) {
      const initialState = config.workflow.states.find(s => s.isInitial)
        || config.workflow.states[0];
      this.currentState = initialState.name;
    }

    this.emit('state-change', {
      state: this.currentState,
      message: `进入状态: ${this.currentState}`,
    });

    while (this.currentState && !this.shouldStop) {
      // Check max transitions
      if (this.transitionCount >= maxTransitions) {
        throw new Error(`达到最大状态转移次数 (${maxTransitions})，可能存在死循环`);
      }

      // Find current state config
      const stateConfig = config.workflow.states.find(s => s.name === this.currentState);
      if (!stateConfig) {
        throw new Error(`找不到状态配置: ${this.currentState}`);
      }

      // Check if final state
      if (stateConfig.isFinal) {
        // Execute final state steps (e.g. regression tests) before completing
        if (stateConfig.steps.length > 0) {
          const finalResult = await this.executeState(stateConfig, config, requirements);
          if (this.currentRunSpecCoding) {
            const statusUpdate = this.deriveRunSpecCodingStateUpdate(stateConfig, finalResult, null);
            this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
              stateName: stateConfig.name,
              status: statusUpdate.status,
              summary: statusUpdate.summary,
            });
            await this.persistState();
          }
          this.queueSpecRevisionVote({
            trigger: 'state-complete',
            stateName: stateConfig.name,
            nextState: null,
            result: finalResult,
          }, config);
        }
        this.emit('state-change', {
          state: this.currentState,
          message: `到达终止状态: ${this.currentState}`,
        });
        break;
      }

      // Execute current state
      const result = await this.executeState(stateConfig, config, requirements);

      // Evaluate transitions
      // Remember whether this transition was forced by the user so we can skip human approval
      const wasForced = !!this.pendingForceTransition;
      const nextState = await this.evaluateTransitions(
        stateConfig.transitions,
        result,
        config
      );
      if (!wasForced && nextState !== '__human_approval__') {
        this.queueSpecRevisionVote({
          trigger: 'state-complete',
          stateName: stateConfig.name,
          nextState,
          result,
        }, config);
      }

      if (this.currentRunSpecCoding) {
        const statusUpdate = this.deriveRunSpecCodingStateUpdate(stateConfig, result, nextState);
        this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
          stateName: stateConfig.name,
          status: statusUpdate.status,
          summary: statusUpdate.summary,
        });
        if (!stateConfig.isFinal) {
          this.keepRunSpecCodingActiveUntilWorkflowFinal(statusUpdate.summary);
        }
        await this.persistState();
      }

      if (config.workflow.supervisor?.stageReviewAsync === false) {
        await this.collectSupervisorReview('state-review', stateConfig, result, config, nextState);
      } else {
        this.runSupervisorReviewInBackground('state-review', stateConfig, result, config, nextState);
      }

      // Check self-transition circuit breaker
      if (nextState === this.currentState) {
        const currentSelfCount = this.selfTransitionCounts.get(this.currentState!) || 0;
        const maxSelfTransitions = stateConfig.maxSelfTransitions || 3;
        if (currentSelfCount >= maxSelfTransitions) {
          // Circuit breaker triggered - force transition to a different state or fail
          this.emit('circuit-breaker', {
            state: this.currentState,
            selfTransitionCount: currentSelfCount,
            maxSelfTransitions,
            message: `状态 "${this.currentState}" 自我转换次数超过限制 (${maxSelfTransitions})，自动熔断`,
          });
          // Find an alternative transition target
          const alternativeTransition = stateConfig.transitions.find(t => t.to !== this.currentState);
          if (alternativeTransition) {
            this.stateHistory.push({
              from: this.currentState!,
              to: alternativeTransition.to,
              reason: `熔断：自我转换超过限制，强制转向 ${alternativeTransition.to}`,
              issues: result.issues,
              timestamp: new Date().toISOString(),
            });
            this.transitionCount++;
            this.currentState = alternativeTransition.to;
            this.selfTransitionCounts.set(this.currentState, 0);
            this.emit('transition', {
              from: this.currentState,
              to: alternativeTransition.to,
              transitionCount: this.transitionCount,
              issues: result.issues,
              circuitBreaker: true,
            });
            continue;
          } else {
            throw new Error(`状态 "${this.currentState}" 达到最大自我转换次数 (${maxSelfTransitions}) 且无其他转移路径，工作流终止`);
          }
        }
        // Increment self-transition counter
        this.selfTransitionCounts.set(this.currentState!, currentSelfCount + 1);
      } else {
        // Reset self-transition counter when moving to a different state
        this.selfTransitionCounts.set(this.currentState!, 0);
      }

      // Check if human approval is required
      // Skip human approval if transitioning to self (iteration) or if forced by user
      const requiresApproval = stateConfig.requireHumanApproval && nextState !== this.currentState && !wasForced;

      if (requiresApproval) {
        const fromStateName = this.currentState;
        const checkpointAdvice = await this.collectSupervisorReview('checkpoint-advice', stateConfig, result, config, nextState);

        // First transition: current state -> __human_approval__
        this.stateHistory.push({
          from: this.currentState,
          to: '__human_approval__',
          reason: `需要人工审查: ${this.getTransitionReason(result)}`,
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: '__human_approval__',
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        this.currentState = '__human_approval__';

        // Save approval context for crash recovery
        this.pendingApprovalInfo = {
          suggestedNextState: nextState,
          availableStates: config.workflow.states.map(s => s.name),
          result,
          supervisorAdvice: checkpointAdvice || undefined,
        };

        // Persist state so crash recovery can restore to human approval
        await this.persistState();

        const humanQuestion = await this.createHumanQuestion({
          kind: 'approval',
          title: '等待人工审查',
          message: checkpointAdvice || `Supervisor 建议进入 ${nextState}，请确认下一步状态。`,
          supervisorAdvice: checkpointAdvice || undefined,
          currentState: '__human_approval__',
          previousState: fromStateName,
          suggestedNextState: nextState,
          availableStates: config.workflow.states.map(s => s.name),
          result,
          requiresWorkflowPause: true,
          answerSchema: {
            type: 'approval-transition',
            required: true,
            options: config.workflow.states.map(s => ({ label: s.name, value: s.name })),
          },
          source: { type: 'checkpoint-advice', fromState: fromStateName, suggestedNextState: nextState },
        });

        // Emit state change to human approval
        this.emit('state-change', {
          state: '__human_approval__',
          message: '等待人工审查决策',
        });

        // Emit human approval required event and wait
        const humanApprovalPayload = {
          runId: this.currentRunId,
          rootRunId: this.rootRunId || this.currentRunId,
          configFile: this.currentConfigFile,
          currentConfigFile: this.currentConfigFile,
          runOwnerId: this._createdBy,
          createdBy: this._createdBy,
          workflowFrontendSessionId: this._frontendSessionId || null,
          currentState: '__human_approval__',
          nextState,
          suggestedNextState: nextState,
          result,
          availableStates: config.workflow.states.map(s => s.name),
          supervisorAdvice: checkpointAdvice || undefined,
          humanQuestion,
        };
        this.emit('human-approval-required', humanApprovalPayload);
        void import('@/lib/channel/delivery')
          .then((mod) => mod.deliverWorkflowEventToChannels('human-approval-required', humanApprovalPayload))
          .catch(() => {});

        // Wait for human decision via forceTransition
        await this.waitForHumanApproval();

        // After human approval, pendingForceTransition will be set
        const humanSelectedState: string = this.pendingForceTransition || nextState;
        this.pendingForceTransition = null;
        const answeredHumanQuestion = humanQuestion.status === 'answered'
          ? humanQuestion
          : this.humanQuestions.find((question) => question.id === humanQuestion.id) || humanQuestion;
        this.pendingApprovalInfo = null;

        // Second transition: __human_approval__ -> selected state
        const instruction = this.pendingForceInstruction || '';
        this.pendingForceInstruction = null;
        this.queueSpecRevisionVote({
          trigger: 'human-review',
          stateName: fromStateName,
          nextState: humanSelectedState,
          result,
          instruction,
          checkpointAdvice,
          question: humanQuestion,
          answer: answeredHumanQuestion.answer,
        }, config);
        this.stateHistory.push({
          from: '__human_approval__',
          to: humanSelectedState,
          reason: instruction
            ? `人工决策: 选择进入 ${humanSelectedState}，附加指令: ${instruction}`
            : `人工决策: 选择进入 ${humanSelectedState}`,
          issues: [],
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: '__human_approval__',
          to: humanSelectedState,
          transitionCount: this.transitionCount,
          issues: [],
        });

        // 人工审批后仍然是状态流转，需要补充 Agent 级绿色流转线
        const fromState = fromStateName
          ? config.workflow.states.find(s => s.name === fromStateName)
          : undefined;
        const toState = config.workflow.states.find(s => s.name === humanSelectedState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent,
              toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name} (人工审查后)`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = humanSelectedState;
        this.emit('state-change', {
          state: this.currentState,
          message: `进入状态: ${this.currentState}`,
        });
      } else {
        // No human approval needed, proceed automatically
        // Record transition
        this.stateHistory.push({
          from: this.currentState,
          to: nextState,
          reason: this.getTransitionReason(result),
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: nextState,
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        // 添加状态切换的流转线
        const fromState = config.workflow.states.find(s => s.name === this.currentState);
        const toState = config.workflow.states.find(s => s.name === nextState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent: fromAgent,
              toAgent: toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name}`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = nextState;
        this.emit('state-change', {
          state: this.currentState,
          message: `进入状态: ${this.currentState}`,
        });
      }
    }
  }

  private summarizeParallelResults(groupId: string, results: ParallelBranchResult[]): string {
    return [
      `并发组 ${groupId} 已完成，以下结果供后续串行步骤继承：`,
      ...results.map((item) => {
        const branchId = item.step.concurrency?.branchId || item.step.name;
        const status = item.status === 'fulfilled'
          ? (item.verdict ? `成功/${item.verdict}` : '成功')
          : '失败';
        const text = item.output || item.error || '';
        const summary = compactStepConclusion(text).replace(/\s+/g, ' ').trim().slice(0, 800) || '[无摘要]';
        return `- ${item.step.name} (${branchId}, ${getStepRuntimeAgentName(item.step)}): ${status}。${summary}`;
      }),
    ].join('\n');
  }

  private getParallelBranchJoinSuccess(result: ParallelBranchResult): boolean {
    return result.status === 'fulfilled' && result.verdict !== 'fail';
  }

  private evaluateParallelJoin(
    groupId: string,
    results: ParallelBranchResult[],
    joinPolicy: RuntimeJoinPolicy,
  ): { passed: boolean; successCount: number; requiredCount: number; mode: RuntimeJoinPolicy['mode'] } {
    const successCount = results.filter((item) => this.getParallelBranchJoinSuccess(item)).length;
    const requiredQuorum = joinPolicy.mode === 'quorum' ? (joinPolicy.quorum || results.length) : results.length;
    const requiredCount = joinPolicy.mode === 'any'
      ? 1
      : joinPolicy.mode === 'quorum'
        ? Math.min(Math.max(1, requiredQuorum), results.length)
        : results.length;
    let passed = false;
    if (joinPolicy.mode === 'any') passed = successCount > 0;
    else if (joinPolicy.mode === 'quorum') passed = successCount >= requiredCount;
    else passed = successCount === results.length;

    return {
      passed,
      successCount,
      requiredCount,
      mode: joinPolicy.mode,
    };
  }

  private canParallelJoinStillPass(results: ParallelBranchResult[], total: number, joinPolicy: RuntimeJoinPolicy): boolean {
    if (joinPolicy.mode === 'all' || joinPolicy.mode === 'manual') {
      return results.length < total || results.every((item) => this.getParallelBranchJoinSuccess(item));
    }
    const successCount = results.filter((item) => this.getParallelBranchJoinSuccess(item)).length;
    const failedCount = results.filter((item) => item.status === 'rejected' || item.verdict === 'fail').length;
    const remaining = Math.max(0, total - results.length);
    const requiredCount = joinPolicy.mode === 'any'
      ? 1
      : Math.min(Math.max(1, joinPolicy.quorum || total), total);
    return successCount + remaining >= requiredCount && failedCount < total;
  }

  private shouldEarlyJoinParallel(results: ParallelBranchResult[], total: number, joinPolicy: RuntimeJoinPolicy): boolean {
    if (joinPolicy.mode !== 'any' && joinPolicy.mode !== 'quorum') return false;
    const joinResult = this.evaluateParallelJoin('__parallel__', results, joinPolicy);
    return joinResult.passed || !this.canParallelJoinStillPass(results, total, joinPolicy);
  }

  private async stopUnjoinedSubworkflowBranches(
    state: StateMachineState,
    pendingSteps: WorkflowStep[],
  ): Promise<void> {
    for (const step of pendingSteps) {
      if (!isSubworkflowStep(step)) continue;
      const ref = [...this.subworkflowRuns].reverse().find((item) =>
        item.parentStateName === state.name
        && item.parentStepName === step.name
        && ['pending', 'starting', 'running', 'waiting-human'].includes(item.status)
      );
      if (!ref) continue;
      try {
        const { workflowRegistry } = await import('@/lib/workflow/registry');
        const manager = await workflowRegistry.getManagerByRunId(ref.runId);
        await (manager as any)?.stop?.();
        this.upsertSubworkflowRun({
          ...ref,
          status: 'cancelled',
          endedAt: new Date().toISOString(),
          summary: '并发组已提前 join，该子工作流分支被停止。',
        });
        this.emit('subworkflow-cancelled', {
          parentRunId: this.currentRunId,
          runId: ref.runId,
          state: state.name,
          step: step.name,
          childConfigFile: ref.configFile,
          reason: 'parallel-unjoined-branch',
        });
      } catch {
        // best effort
      }
    }
  }

  private async executeParallelBranches(
    segment: Extract<StepSegment, { type: 'parallel' }>,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements: string | undefined,
    joinPolicy: RuntimeJoinPolicy,
    useVerdict = true,
  ): Promise<ParallelBranchResult[]> {
    const subworkflowBranchCount = segment.steps.filter((step) => isSubworkflowStep(step)).length;
    if (subworkflowBranchCount > MAX_PARALLEL_SUBWORKFLOW_BRANCHES) {
      throw new Error(`并发子工作流分支超过上限 ${MAX_PARALLEL_SUBWORKFLOW_BRANCHES}: ${segment.groupId}`);
    }
    const allowEarlyJoin = Boolean(joinPolicy.onUnjoinedBranches) || segment.steps.some((step) => isSubworkflowStep(step));
    const siblingNames = segment.steps.map((step) => step.name).join(', ');
    const pending = new Map<number, Promise<{ index: number; result: ParallelBranchResult }>>();
    const resultsByIndex = new Map<number, ParallelBranchResult>();

    const makeBranch = (step: WorkflowStep, index: number) => (async () => {
      const extraContext = [
        `当前步骤属于并发组 ${segment.groupId}。`,
        step.concurrency?.branchId ? `当前分支 branchId: ${step.concurrency.branchId}。` : '',
        `同组并行步骤: ${siblingNames}。`,
        step.channelIds?.length ? `绑定 channelIds: ${step.channelIds.join(', ')}。` : '',
        '并发执行不会等待兄弟分支输出；请只基于当前上下文完成本分支，后续串行步骤会收到汇总结果。',
      ].filter(Boolean).join('\n');
      try {
        const output = await this.executeWorkflowStepDispatch(step, state, config, requirements, extraContext, useVerdict);
        const parsed = this.extractJsonObject(output);
        return {
          index,
          result: {
            step,
            status: 'fulfilled' as const,
            output,
            verdict: this.parseVerdict(output),
            issues: this.parseIssuesFromOutput(output, step, state.name),
            childRunId: typeof parsed?.childRunId === 'string' ? parsed.childRunId : undefined,
            childConfigFile: typeof parsed?.childConfigFile === 'string' ? parsed.childConfigFile : undefined,
            childStatus: typeof parsed?.status === 'string' ? parsed.status : undefined,
          },
        };
      } catch (error: any) {
        return {
          index,
          result: {
            step,
            status: 'rejected' as const,
            error: error?.message || String(error),
          },
        };
      }
    })();

    segment.steps.forEach((step, index) => {
      pending.set(index, makeBranch(step, index));
    });

    while (pending.size > 0) {
      const settled = await Promise.race(pending.values());
      pending.delete(settled.index);
      resultsByIndex.set(settled.index, settled.result);
      const currentResults = Array.from(resultsByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, result]) => result);
      if (
        allowEarlyJoin
        &&
        (joinPolicy.mode === 'any' || joinPolicy.mode === 'quorum')
        && this.shouldEarlyJoinParallel(currentResults, segment.steps.length, joinPolicy)
      ) {
        const pendingSteps = Array.from(pending.keys()).map((index) => segment.steps[index]).filter(Boolean);
        const onUnjoined = joinPolicy.onUnjoinedBranches || 'stop';
        if (onUnjoined === 'stop') {
          this.cancelCurrentProcesses();
          await this.stopUnjoinedSubworkflowBranches(state, pendingSteps);
        } else if (onUnjoined === 'detach' || onUnjoined === 'wait-background') {
          for (const step of pendingSteps) {
            const index = segment.steps.indexOf(step);
            if (index >= 0) {
              resultsByIndex.set(index, {
                step,
                status: 'rejected',
                error: onUnjoined === 'detach'
                  ? '并发组已提前 join，该分支已 detach 后台继续。'
                  : '并发组已提前 join，该分支作为后台任务跟踪。',
              });
            }
          }
        }
        break;
      }
    }

    if (pending.size > 0 && (joinPolicy.onUnjoinedBranches || 'stop') === 'stop') {
      for (const index of pending.keys()) {
        resultsByIndex.set(index, {
          step: segment.steps[index],
          status: 'rejected',
          error: '并发组已提前 join，该未加入分支已停止。',
        });
      }
    }

    if (pending.size > 0 && (joinPolicy.onUnjoinedBranches || 'stop') !== 'stop') {
      void Promise.allSettled(pending.values());
    } else {
      await Promise.allSettled(pending.values());
    }

    return segment.steps.map((step, index) => resultsByIndex.get(index) || {
      step,
      status: 'rejected' as const,
      error: '并发分支未产生结果',
    });
  }

  private async waitForManualParallelJoin(input: {
    groupId: string;
    state: StateMachineState;
    results: ParallelBranchResult[];
    joinResult: { passed: boolean; successCount: number; requiredCount: number; mode: RuntimeJoinPolicy['mode'] };
    summary: string;
  }): Promise<{ passed: boolean; instruction?: string }> {
    const { groupId, state, results, joinResult, summary } = input;
    const defaultChoice = joinResult.passed ? 'approve' : 'reject';
    const message = [
      `并发组 ${groupId} 已完成，当前自动判定为 ${joinResult.passed ? '通过' : '失败'}。`,
      `满足分支: ${joinResult.successCount}/${results.length}，策略要求: ${joinResult.requiredCount}/${results.length}。`,
      '',
      summary,
      '',
      '请人工确认是否放行后续步骤。',
    ].join('\n');

    const humanQuestion = await this.createHumanQuestion({
      kind: 'approval',
      title: `并发组人工确认：${groupId}`,
      message,
      currentState: state.name,
      suggestedNextState: defaultChoice,
      result: {
        verdict: joinResult.passed ? 'pass' : 'fail',
        summary,
        stepOutputs: results.map((item) => item.output || item.error || ''),
        issues: results.flatMap((item) => item.issues || []),
        parallelGroup: {
          id: groupId,
          stateName: state.name,
          joinPolicy: { mode: input.joinResult.mode },
          successCount: joinResult.successCount,
          requiredCount: joinResult.requiredCount,
        },
      },
      requiresWorkflowPause: true,
      answerSchema: {
        type: 'single-choice',
        required: true,
        options: [
          { label: '通过并继续', value: 'approve', description: '接受并发组结果，继续后续步骤或状态转移。' },
          { label: '判为失败', value: 'reject', description: '将当前并发组判定为失败，当前状态按失败处理。' },
        ],
      },
      source: {
        type: 'parallel-manual-join',
        groupId,
        stateName: state.name,
        suggestedDecision: defaultChoice,
      },
    });

    this.emit('human-approval-required', {
      currentState: state.name,
      result: humanQuestion.result,
      supervisorAdvice: message,
      humanQuestion,
      pendingHumanQuestion: humanQuestion,
      parallelGroupId: groupId,
      joinPolicy: 'manual',
    });

    const answered = await this.waitForHumanQuestionAnswer(humanQuestion.id);
    const answer = answered?.answer;
    const selected = answer?.selectedOption || answer?.raw?.selectedOption || defaultChoice;
    return {
      passed: selected !== 'reject',
      instruction: answer?.instruction || answer?.text,
    };
  }

  private async executeParallelSegment(
    segment: Extract<StepSegment, { type: 'parallel' }>,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    useVerdict = true
  ): Promise<{ outputs: string[]; issues: Issue[]; verdict: 'pass' | 'conditional_pass' | 'fail'; summary: string; failed: boolean }> {
    const joinPolicy = resolveJoinPolicy(segment, config);
    const groupState: ActiveConcurrencyGroup = {
      id: segment.groupId,
      stateName: state.name,
      steps: segment.steps.map((step) => step.name),
      joinPolicy,
      status: 'running',
    };
    this.activeConcurrencyGroups = [...this.activeConcurrencyGroups.filter((group) => !(group.id === segment.groupId && group.stateName === state.name)), groupState];
    this.refreshCurrentStep();
    this.emit('parallel-group-start', {
      state: state.name,
      groupId: segment.groupId,
      steps: segment.steps.map((step) => step.name),
      joinPolicy,
    });
    await this.persistState();

    const results = await this.executeParallelBranches(segment, state, config, requirements, joinPolicy, useVerdict);

    const engineError = results.find((item) => item.status === 'rejected' && isEngineLevelFailure(item.error || ''));
    if (engineError) {
      groupState.status = 'failed';
      this.activeConcurrencyGroups = this.activeConcurrencyGroups.map((group) =>
        group === groupState ? { ...groupState } : group
      );
      await this.persistState();
      throw new Error(`引擎异常，已停止工作流：${engineError.error}`);
    }

    const outputs = results.map((item) => item.status === 'fulfilled' ? (item.output || '') : `ERROR: ${item.error || '并发分支失败'}`);
    const issues = results.flatMap((item) => item.issues || []);

    const summary = this.summarizeParallelResults(segment.groupId, results);
    let joinResult = this.evaluateParallelJoin(segment.groupId, results, joinPolicy);
    let manualInstruction = '';
    if (joinPolicy.mode === 'manual') {
      groupState.status = 'waiting-approval';
      this.activeConcurrencyGroups = this.activeConcurrencyGroups.map((group) =>
        group.id === groupState.id && group.stateName === groupState.stateName ? { ...groupState } : group
      );
      this.refreshCurrentStep();
      await this.persistState();

      const manualDecision = await this.waitForManualParallelJoin({
        groupId: segment.groupId,
        state,
        results,
        joinResult,
        summary,
      });
      if (this.shouldStop) {
        throw new Error('工作流已停止');
      }
      joinResult = {
        ...joinResult,
        passed: manualDecision.passed,
      };
      manualInstruction = manualDecision.instruction || '';
    }

    groupState.status = joinResult.passed ? 'completed' : 'failed';
    this.activeConcurrencyGroups = this.activeConcurrencyGroups.map((group) =>
      group.id === groupState.id && group.stateName === groupState.stateName ? { ...groupState } : group
    );
    this.refreshCurrentStep();

    let verdict: 'pass' | 'conditional_pass' | 'fail' = joinResult.passed ? 'pass' : 'fail';
    if (joinResult.passed && useVerdict) {
      const successfulVerdicts = results
        .filter((item) => this.getParallelBranchJoinSuccess(item))
        .map((item) => item.verdict)
        .filter(Boolean);
      if (successfulVerdicts.includes('conditional_pass')) {
        verdict = 'conditional_pass';
      }
    }
    if (!joinResult.passed) verdict = 'fail';

    const logMessage = [
      `并发组 ${segment.groupId} 完成：${joinResult.passed ? '通过' : '失败'} (${joinResult.successCount}/${results.length}，要求 ${joinResult.requiredCount})`,
      joinPolicy.mode === 'manual' ? `manual join 已人工${joinResult.passed ? '放行' : '判失败'}` : '',
      manualInstruction ? `人工指令: ${manualInstruction}` : '',
      joinPolicy.timeoutMinutes ? `timeoutMinutes=${joinPolicy.timeoutMinutes}, onTimeout=${joinPolicy.onTimeout || '未设置'}（第一阶段仅记录，不主动终止分支）` : '',
    ].filter(Boolean).join('；');
    this.emit('log', { message: logMessage });
    this.emit('parallel-group-complete', { state: state.name, groupId: segment.groupId, joinPolicy, results, passed: joinResult.passed });
    await this.persistState();

    return { outputs, issues, verdict, summary, failed: !joinResult.passed };
  }

  private async executeState(
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<StateExecutionResult> {
    const stateGeneration = this.runtimeGeneration;
    const stateLead = state.steps[0]?.agent || this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    const stateCloser = [...state.steps].reverse().find((step) => step.agent)?.agent || stateLead;
    this.emit('state-executing', {
      state: state.name,
      stepCount: state.steps.length,
    });
    if (this.currentRunSpecCoding) {
      this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
        stateName: state.name,
        status: 'in-progress',
        summary: `当前推进到状态 ${state.name}。`,
      });
      await this.persistState();
    }
    await this.appendSupervisorChatEvent({
      type: 'state-start',
      title: `状态开始：${state.name}`,
      body: `${state.steps.length} 个步骤待处理。`,
      speakerName: stateLead,
      dedupeKey: `workflow-state-start-${this.currentRunId || this.currentConfigFile}-${state.name}`,
    });

    const stepOutputs: string[] = [];
    const issues: Issue[] = [];
    let verdict: 'pass' | 'conditional_pass' | 'fail' = 'pass';
    let previousParallelSummary = '';

    const segments = groupStateStepsIntoSegments(state.steps);
    const resumeStepKey = this.resumeStateName === state.name ? this.resumeStepKey : null;
    let skippingUntilResumeStep = Boolean(resumeStepKey);
    let executedSegmentInThisPass = false;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const useSegmentVerdict = i === segments.length - 1;
      if (this.shouldStop) break;
      // Allow forced transition to interrupt mid-state
      if (this.pendingForceTransition) break;

      const segmentStepKeys = this.getSegmentStepKeys(state.name, segment);
      if (skippingUntilResumeStep) {
        if (!resumeStepKey || !segmentStepKeys.includes(resumeStepKey)) {
          this.emit('log', {
            message: `恢复运行：跳过已完成步骤 ${segmentStepKeys.join(', ')}`,
          });
          if (segment.type === 'parallel') {
            const skippedResults: Array<{ step: WorkflowStep; status: 'fulfilled' | 'rejected'; output?: string; error?: string }> = [];
            for (const skippedStep of segment.steps) {
              const key = this.getWorkflowStepKey(state.name, skippedStep);
              const log = this.getLatestStepLog(key, 'completed');
              if (log?.output) {
                stepOutputs.push(log.output);
                issues.push(...this.parseIssuesFromOutput(log.output, skippedStep, state.name));
                skippedResults.push({ step: skippedStep, status: 'fulfilled', output: log.output });
                if (useSegmentVerdict) {
                  const stepVerdict = this.parseVerdict(log.output);
                  if (stepVerdict === 'fail') verdict = 'fail';
                  else if (stepVerdict === 'conditional_pass' && verdict === 'pass') verdict = 'conditional_pass';
                }
              }
            }
            if (skippedResults.length > 0) {
              previousParallelSummary = this.summarizeParallelResults(segment.groupId, skippedResults);
            }
          } else {
            const skippedVerdict = this.collectSkippedStepOutput(segment.step, state.name, stepOutputs, issues, useSegmentVerdict);
            if (skippedVerdict === 'fail') verdict = 'fail';
            else if (skippedVerdict === 'conditional_pass' && verdict === 'pass') verdict = 'conditional_pass';
            previousParallelSummary = '';
          }
          continue;
        }

        this.emit('log', {
          message: `恢复运行：从失败步骤 ${resumeStepKey} 继续`,
        });
        skippingUntilResumeStep = false;
        this.resumeStateName = null;
        this.resumeStepKey = null;
      }

      // Delay between segments when using non-claude engines to avoid throttling
      if (executedSegmentInThisPass && getLogicalEngineId(this.engineType) !== 'claude-code') {
        const delayMs = this.getSegmentHandoffDelayMs(config);
        if (delayMs > 0) {
          await new Promise(r => setTimeout(r, delayMs));
        }
      }

      if (segment.type === 'parallel') {
        const parallelResult = await this.executeParallelSegment(segment, state, config, requirements, useSegmentVerdict);
        executedSegmentInThisPass = true;
        stepOutputs.push(...parallelResult.outputs);
        issues.push(...parallelResult.issues);
        previousParallelSummary = parallelResult.summary;
        if (parallelResult.verdict === 'fail') verdict = 'fail';
        else if (parallelResult.verdict === 'conditional_pass' && verdict === 'pass') verdict = 'conditional_pass';
        if (parallelResult.failed) break;
        continue;
      }

      const step = segment.step;
      try {
        const stepGeneration = this.runtimeGeneration;
        const output = await this.executeWorkflowStepDispatch(step, state, config, requirements, previousParallelSummary, useSegmentVerdict);
        if (stepGeneration !== this.runtimeGeneration || stateGeneration !== this.runtimeGeneration) {
          this.emit('log', {
            level: 'warning',
            message: `忽略旧执行链路输出：${state.name}/${step.name}`,
          });
          continue;
        }
        executedSegmentInThisPass = true;
        previousParallelSummary = '';
        stepOutputs.push(output);

        // Parse issues from output
        const stepIssues = this.parseIssuesFromOutput(output, step, state.name);
        issues.push(...stepIssues);

        // Update verdict based on step role
        if (useSegmentVerdict) {
          const stepVerdict = this.parseVerdict(output);
          if (stepVerdict === 'fail') verdict = 'fail';
          else if (stepVerdict === 'conditional_pass' && verdict === 'pass') {
            verdict = 'conditional_pass';
          }
        }
      } catch (stepError: any) {
        const errorMsg = stepError.message || String(stepError);
        stepOutputs.push(`ERROR: ${errorMsg}`);

        if (isEngineLevelFailure(errorMsg)) {
          // Engine-level failures are fatal for state-machine execution to avoid
          // uncontrolled fallback iterations and token burn.
          throw new Error(`引擎异常，已停止工作流：${errorMsg}`);
        }

        verdict = 'fail';
        // Abort remaining steps in this state on non-engine step failure
        break;
      }
    }

    // Add issues to tracker
    this.issueTracker.push(...issues);
    const summary = this.generateStateSummary(state, issues);
    await this.appendSupervisorChatEvent({
      type: verdict === 'fail' ? 'state-failed' : 'state-complete',
      title: verdict === 'fail' ? `状态失败：${state.name}` : `状态完成：${state.name}`,
      body: summary,
      speakerName: stateCloser,
      dedupeKey: `workflow-state-${verdict === 'fail' ? 'failed' : 'complete'}-${this.currentRunId || this.currentConfigFile}-${state.name}`,
    });

    return {
      stateName: state.name,
      verdict,
      issues,
      stepOutputs,
      summary,
    };
  }

  private buildRunSpecCodingStatusPayload() {
    if (!this.currentRunSpecCoding) return {};
    return {
      specCodingSummary: {
        id: this.currentRunSpecCoding.id,
        version: this.currentRunSpecCoding.version,
        status: this.currentRunSpecCoding.status,
        source: 'run' as const,
        summary: this.currentRunSpecCoding.summary,
        phaseCount: this.currentRunSpecCoding.phases.length,
        taskCount: this.currentRunSpecCoding.tasks.length,
        assignmentCount: this.currentRunSpecCoding.assignments.length,
        checkpointCount: this.currentRunSpecCoding.checkpoints.length,
        revisionCount: this.currentRunSpecCoding.revisions.length,
        progress: this.currentRunSpecCoding.progress,
        latestRevision: this.currentRunSpecCoding.revisions.at(-1) || null,
      },
      specCodingDetails: {
        phases: this.currentRunSpecCoding.phases,
        tasks: this.currentRunSpecCoding.tasks,
        assignments: this.currentRunSpecCoding.assignments,
        checkpoints: this.currentRunSpecCoding.checkpoints,
        revisions: this.currentRunSpecCoding.revisions,
        artifacts: this.currentRunSpecCoding.artifacts,
      },
    };
  }

  private keepRunSpecCodingActiveUntilWorkflowFinal(summary?: string): void {
    if (!this.currentRunSpecCoding) return;
    const progress = this.currentRunSpecCoding.progress || {
      overallStatus: 'pending' as const,
      completedPhaseIds: [],
    };
    const status = this.currentRunSpecCoding.status === 'completed'
      ? 'in-progress'
      : this.currentRunSpecCoding.status;
    const overallStatus = progress.overallStatus === 'completed'
      ? 'in-progress'
      : progress.overallStatus;

    if (status === this.currentRunSpecCoding.status && overallStatus === progress.overallStatus && !summary) {
      return;
    }

    this.currentRunSpecCoding = {
      ...this.currentRunSpecCoding,
      status,
      progress: {
        ...progress,
        overallStatus,
        summary: summary || progress.summary,
      },
    };
  }

  private completeRunSpecCoding(summary = '工作流执行完成。'): void {
    if (!this.currentRunSpecCoding) return;
    this.currentRunSpecCoding = {
      ...this.currentRunSpecCoding,
      status: 'completed',
      progress: {
        ...this.currentRunSpecCoding.progress,
        overallStatus: 'completed',
        completedPhaseIds: this.currentRunSpecCoding.phases.map((phase) => phase.id),
        activePhaseId: undefined,
        summary,
      },
    };
  }

  private getRuntimeStepKey(stateName: string, step: WorkflowStep): string {
    if ((step as any).id) return String((step as any).id);
    return `state:${stateName}#${this.getStateStepIndex(stateName, step) + 1}:${step.name}`;
  }

  private getStateStepIndex(stateName: string, step: WorkflowStep): number {
    const state = this.currentWorkflowConfig?.workflow?.states?.find((item: any) => item.name === stateName);
    const index = state?.steps?.findIndex((item: any) => item === step || item.name === step.name);
    return typeof index === 'number' && index >= 0 ? index : 0;
  }

  private getStepSpecTaskIds(step: WorkflowStep, stateName: string): string[] {
    const snapshotIds = this.stepTaskBindingsByStepKey.get(this.getRuntimeStepKey(stateName, step))?.taskIds || [];
    const configIds = getSpecTaskBindingIds(step.specTaskBinding);
    return Array.from(new Set([...snapshotIds, ...configIds]));
  }

  private markBoundSpecTasksForStep(input: {
    step: WorkflowStep;
    stateName: string;
    status: 'pending' | 'in-progress' | 'completed' | 'blocked';
    updatedBy: string;
    validation: string;
  }): number {
    if (!this.currentRunSpecCoding) return 0;
    const taskIds = this.getStepSpecTaskIds(input.step, input.stateName);
    if (taskIds.length === 0) return 0;
    this.currentRunSpecCoding = updateSpecCodingTaskStatuses(this.currentRunSpecCoding, {
      updates: taskIds.map((id) => ({
        id,
        status: input.status,
        validation: input.validation,
      })),
      updatedBy: input.updatedBy,
    });
    this.emit('status', {
      status: this.status,
      message: `Spec Coding tasks.md 已由系统更新 ${taskIds.length} 项`,
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: input.stateName,
      currentStep: this.currentStep,
      activeSteps: Array.from(this.activeStepKeys),
      completedSteps: this.completedSteps,
      currentConfigFile: this.currentConfigFile,
      ...this.buildRunSpecCodingStatusPayload(),
    });
    return taskIds.length;
  }

  private async executeWorkflowStepDispatch(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string,
    useVerdict = true,
  ): Promise<string> {
    if (isSubworkflowStep(step)) {
      return this.executeSubworkflowStep(step, state, config, requirements, extraContext, useVerdict);
    }
    return this.executeStep(step, state, config, requirements, extraContext);
  }

  private truncateSubworkflowSummary(summary: string): string {
    let total = 0;
    let result = '';
    for (const char of String(summary || '')) {
      const bytes = Buffer.byteLength(char, 'utf-8');
      if (total + bytes > MAX_CHILD_OUTPUT_SUMMARY_BYTES) {
        return `${result}\n[子工作流摘要已截断，超过 ${MAX_CHILD_OUTPUT_SUMMARY_BYTES} bytes]`;
      }
      total += bytes;
      result += char;
    }
    return result;
  }

  private getActiveSubworkflowRunCount(): number {
    return this.subworkflowRuns.filter((item) =>
      ['pending', 'starting', 'running', 'waiting-human'].includes(item.status)
    ).length;
  }

  private async assertSubworkflowRunLimits(step: WorkflowStep, state: StateMachineState, childConfigFile: string, activeExisting?: PersistedSubworkflowRunRef | null): Promise<void> {
    if (activeExisting) return;
    if (this.getActiveSubworkflowRunCount() >= MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_PARENT) {
      throw new Error(`子工作流 active child runs 超过上限 ${MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_PARENT}: ${state.name}/${step.name}`);
    }
    if (this._createdBy) {
      const { workflowRegistry } = await import('@/lib/workflow/registry');
      const activeForUser = workflowRegistry.getRunningManagers()
        .map((entry: any) => entry.manager?.getStatus?.())
        .filter((status: any) => (status?.runOwnerId || status?.createdBy) === this._createdBy)
        .reduce((sum: number, status: any) => sum + (status?.subworkflowSummary?.active || 0), 0);
      if (activeForUser >= MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_USER) {
        throw new Error(`用户 active child runs 超过上限 ${MAX_ACTIVE_SUBWORKFLOW_RUNS_PER_USER}: ${this._createdBy}`);
      }
    }
    const rootChildCount = this.subworkflowRuns.filter((item) => item.runId).length;
    if (rootChildCount >= MAX_SUBWORKFLOW_RUNS_PER_ROOT) {
      throw new Error(`子工作流 root child runs 超过上限 ${MAX_SUBWORKFLOW_RUNS_PER_ROOT}: ${childConfigFile}`);
    }
  }

  private recordSubworkflowAudit(input: Omit<PersistedSubworkflowAuditEvent, 'id' | 'timestamp' | 'actorId' | 'actorName' | 'parentRunId' | 'rootRunId' | 'parentConfigFile'> & { actor?: WorkflowActionActor }): void {
    const { actor, ...eventInput } = input;
    const event: PersistedSubworkflowAuditEvent = {
      id: `swa-${Date.now()}-${randomUUID().slice(0, 8)}`,
      timestamp: new Date().toISOString(),
      actorId: actor?.id || this._createdBy,
      actorName: actor?.name || this._createdByName,
      parentRunId: this.currentRunId || undefined,
      rootRunId: this.rootRunId || this.currentRunId || undefined,
      parentConfigFile: this.currentConfigFile || undefined,
      ...eventInput,
    };
    this.subworkflowAuditEvents = [event, ...this.subworkflowAuditEvents].slice(0, MAX_SUBWORKFLOW_AUDIT_EVENTS);
  }

  private bumpSubworkflowEventCount(runId: string, action: PersistedSubworkflowAuditEvent['action'], payload: Omit<PersistedSubworkflowAuditEvent, 'id' | 'timestamp' | 'actorId' | 'actorName' | 'parentRunId' | 'rootRunId' | 'parentConfigFile' | 'action'>): void {
    const ref = this.subworkflowRuns.find((item) => item.runId === runId);
    const eventCount = (ref?.eventCount || 0) + 1;
    if (eventCount > MAX_CHILD_EVENT_COUNT) {
      throw new Error(`子工作流事件数量超过上限 ${MAX_CHILD_EVENT_COUNT}: ${runId}`);
    }
    if (ref) this.upsertSubworkflowRun({ ...ref, eventCount });
    this.recordSubworkflowAudit({ action, ...payload });
  }

  private upsertSubworkflowRun(ref: PersistedSubworkflowRunRef): void {
    const index = this.subworkflowRuns.findIndex((item) => item.runId === ref.runId);
    if (index >= 0) {
      this.subworkflowRuns = this.subworkflowRuns.map((item, i) => i === index ? { ...item, ...ref } : item);
    } else {
      this.subworkflowRuns = [...this.subworkflowRuns, ref];
    }
  }

  private getNextSubworkflowAttempt(parentStepName: string, parentStateName: string): number {
    return this.subworkflowRuns.filter((item) =>
      item.parentStepName === parentStepName && item.parentStateName === parentStateName
    ).length + 1;
  }

  private getSubworkflowInputs(step: WorkflowStep): any {
    return {
      ...((step as any).subworkflow?.inputs || {}),
      ...((step as any).inputs || {}),
    };
  }

  private buildSubworkflowInitialContexts(
    step: WorkflowStep,
    state: StateMachineState,
    childConfigFile: string,
    extraContext?: string,
  ): { globalContext?: string; phaseContexts?: Record<string, string> } {
    const inputs = this.getSubworkflowInputs(step);
    const parentBlocks: string[] = [];
    if ((inputs.globalContext || inputs.context || 'inherit') !== 'none' && this.globalContext.trim()) {
      parentBlocks.push(this.globalContext);
    }
    parentBlocks.push([
      '## Parent workflow context',
      `Parent run: ${this.currentRunId || 'unknown'}`,
      `Parent config: ${this.currentConfigFile || 'unknown'}`,
      `Parent state: ${state.name}`,
      `Parent step: ${step.name}`,
      `Child config: ${childConfigFile}`,
      extraContext ? `\n## Upstream context\n${extraContext}` : '',
    ].filter(Boolean).join('\n'));

    const stateContextsMode = inputs.stateContexts || 'relevant';
    let phaseContexts: Record<string, string> = {};
    if (stateContextsMode === 'inherit') {
      phaseContexts = Object.fromEntries(this.stateContexts);
    } else if (stateContextsMode === 'relevant') {
      const currentStateContext = this.stateContexts.get(state.name);
      if (currentStateContext) phaseContexts[state.name] = currentStateContext;
    }

    return {
      globalContext: parentBlocks.filter(Boolean).join('\n\n'),
      phaseContexts,
    };
  }

  private resolveSubworkflowRequirements(step: WorkflowStep, fallback?: string): string {
    const inputs = this.getSubworkflowInputs(step);
    const configured = inputs.requirements;
    if (!configured || configured === 'inherit') return fallback || this.currentRequirements || '';
    return String(configured);
  }

  private normalizeRagCapabilitySkills(capabilitySkills: any): any | null {
    const rag = capabilitySkills?.rag;
    if (!rag || typeof rag !== 'object') return null;
    const knowledgeBases = Array.isArray(rag.knowledgeBases)
      ? rag.knowledgeBases.map((kb: any) => String(kb || '').trim()).filter(Boolean)
      : [];
    if (!rag.enabled && knowledgeBases.length === 0) return null;
    return {
      ...rag,
      enabled: rag.enabled ?? knowledgeBases.length > 0,
      knowledgeBases,
    };
  }

  private mergeRagCapabilitySkills(childCapabilitySkills: any, parentCapabilitySkills: any): any {
    const childRag = this.normalizeRagCapabilitySkills(childCapabilitySkills);
    const parentRag = this.normalizeRagCapabilitySkills(parentCapabilitySkills);
    const knowledgeBases = Array.from(new Set([
      ...(Array.isArray(childRag?.knowledgeBases) ? childRag.knowledgeBases : []),
      ...(Array.isArray(parentRag?.knowledgeBases) ? parentRag.knowledgeBases : []),
    ]));
    const merged = {
      ...(childCapabilitySkills || {}),
      rag: {
        ...(parentRag || {}),
        ...(childRag || {}),
        enabled: Boolean(childRag?.enabled || parentRag?.enabled || knowledgeBases.length > 0),
        knowledgeBases,
      },
    };
    if (!merged.rag.enabled && knowledgeBases.length === 0) delete merged.rag;
    return merged;
  }

  private hasRagCapability(capabilitySkills: any): boolean {
    const rag = this.normalizeRagCapabilitySkills(capabilitySkills);
    return Boolean(rag?.enabled || (rag?.knowledgeBases || []).length > 0);
  }

  private ensureRagSkill(skills: any): string[] {
    const nextSkills = Array.isArray(skills) ? skills.map((skill) => String(skill)).filter(Boolean) : [];
    return Array.from(new Set([...nextSkills, 'aceharness-rag']));
  }

  private buildSubworkflowContextOverrides(step: WorkflowStep): Record<string, any> {
    const inputs = this.getSubworkflowInputs(step);
    const parentContext = this.currentWorkflowConfig?.context || {};
    const overrides: Record<string, any> = {};

    const mcpMode = inputs.mcpServers || 'merge';
    const parentMcp = Array.isArray(parentContext.mcpServers) ? parentContext.mcpServers : [];
    if (mcpMode === 'inherit' || mcpMode === 'parent-only') {
      overrides.mcpServers = parentMcp;
    } else if (mcpMode === 'merge' && parentMcp.length > 0) {
      overrides.mcpServers = parentMcp;
      (overrides as any).__mergeMcpServers = true;
    }

    const skillsMode = inputs.skills || 'merge';
    const parentSkills = Array.isArray((parentContext as any).skills) ? (parentContext as any).skills : [];
    if (skillsMode === 'inherit' || skillsMode === 'parent-only') {
      overrides.skills = parentSkills;
    } else if (skillsMode === 'merge' && parentSkills.length > 0) {
      overrides.skills = parentSkills;
      (overrides as any).__mergeSkills = true;
    }

    const ragMode = (inputs as any).rag || 'merge';
    const parentRag = this.normalizeRagCapabilitySkills((parentContext as any).capabilitySkills);
    if ((ragMode === 'inherit' || ragMode === 'parent-only') && parentRag) {
      overrides.capabilitySkills = {
        ...((overrides as any).capabilitySkills || {}),
        rag: parentRag,
      };
    } else if (ragMode === 'merge' && parentRag) {
      overrides.capabilitySkills = {
        ...((overrides as any).capabilitySkills || {}),
        rag: parentRag,
      };
      (overrides as any).__mergeRagKnowledgeBases = true;
    }

    const engineMode = inputs.engine || 'child';
    if (engineMode === 'inherit') {
      const inheritedEngine = (parentContext as any).engine || (parentContext as any).defaultEngine || this.engineType;
      overrides.engine = inheritedEngine;
      overrides.defaultEngine = inheritedEngine;
    } else if (engineMode === 'override') {
      const overrideEngine = (step as any).engine || (step as any).subworkflow?.engine;
      if (overrideEngine) {
        overrides.engine = overrideEngine;
        overrides.defaultEngine = overrideEngine;
      }
    }

    return overrides;
  }

  private resolveSubworkflowWorkspaceEmbedding(step: WorkflowStep, config: StateMachineWorkflowConfig): {
    projectRoot: string | null;
    workspaceMode: 'in-place' | 'isolated-copy' | null;
  } {
    const inputs = this.getSubworkflowInputs(step);
    const mode = inputs.workspace || 'inherit';
    if (mode === 'config') return { projectRoot: null, workspaceMode: null };
    const projectRoot = this.getWorkingDirectory() || config.context?.projectRoot || null;
    if (!projectRoot) return { projectRoot: null, workspaceMode: null };
    return {
      projectRoot,
      workspaceMode: mode === 'child-isolated-copy' ? 'isolated-copy' : 'in-place',
    };
  }

  private getSubworkflowRuntime(step: WorkflowStep): any {
    return {
      ...((step as any).subworkflow?.runtime || {}),
      ...((step as any).runtime || {}),
    };
  }

  private assertSubworkflowRuntimeDepth(step: WorkflowStep, childConfigFile: string): void {
    const runtime = this.getSubworkflowRuntime(step);
    const maxDepth = Math.min(
      Math.max(1, Number.isFinite(Number(runtime.maxDepth)) ? Number(runtime.maxDepth) : 5),
      8,
    );
    const childDepth = Math.max(1, this.nestingPath.length);
    if (childDepth > maxDepth) {
      throw new Error(`子工作流嵌套超过运行期最大深度 ${maxDepth}: ${[...this.nestingPath.map((item) => item.configFile), childConfigFile].join(' -> ')}`);
    }
  }

  private findActiveSubworkflowForStep(step: WorkflowStep, state: StateMachineState, childConfigFile: string): PersistedSubworkflowRunRef | null {
    const active = [...this.subworkflowRuns].reverse().find((item) =>
      item.parentStepName === step.name
      && item.parentStateName === state.name
      && item.configFile === childConfigFile
      && ['pending', 'starting', 'running', 'waiting-human'].includes(item.status)
    );
    return active || null;
  }

  private getActiveSubworkflowRuntime(childRunId: string | null): any {
    if (!childRunId || !this.currentWorkflowConfig) return {};
    const ref = this.subworkflowRuns.find((item) => item.runId === childRunId);
    if (!ref) return {};
    const state = this.currentWorkflowConfig.workflow.states.find((item) => item.name === ref.parentStateName);
    const step = state?.steps?.find((item) => item.name === ref.parentStepName);
    return step ? this.getSubworkflowRuntime(step) : {};
  }

  private buildSubworkflowTrace(stepId: string, childRunId: string, childConfigFile: string) {
    return {
      rootRunId: this.rootRunId || this.currentRunId,
      traceId: this.rootRunId || this.currentRunId || childRunId,
      spanId: `${this.currentRunId || 'parent'}:${stepId}`,
      parentSpanId: this.parentStepId ? `${this.parentRunId || 'parent'}:${this.parentStepId}` : undefined,
      workflowPath: [
        ...this.nestingPath.map((item) => `${item.configFile}${item.stepName ? `#${item.stepName}` : ''}`),
        `${childConfigFile}#${childRunId}`,
      ],
    };
  }

  private getSubworkflowSummary(runState: PersistedRunState | null, fallbackStatus: string): string {
    if (!runState) return `子工作流状态: ${fallbackStatus}`;
    const finalLog = [...(runState.stepLogs || [])].reverse().find((log) => log.output || log.error);
    const state = runState.currentPhase || runState.currentState || runState.configFile;
    const detail = finalLog?.output || finalLog?.error || runState.statusReason || '';
    return [`子工作流 ${runState.configFile} ${runState.status}`, state ? `当前状态: ${state}` : '', detail].filter(Boolean).join('\n');
  }

  private getSubworkflowDecisionOutput(runState: PersistedRunState | null, fallbackStatus: string): string {
    if (!runState) return `子工作流状态: ${fallbackStatus}`;
    const finalLog = [...(runState.stepLogs || [])].reverse().find((log) => log.output || log.error);
    return finalLog?.output || finalLog?.error || runState.statusReason || `子工作流状态: ${fallbackStatus}`;
  }

  private async ensureSubworkflowSnapshot(rootRunId: string, childConfigFile: string): Promise<{ snapshotFile?: string }> {
    try {
      const snapshot = await readWorkflowConfigSnapshot({ rootRunId, configFile: childConfigFile });
      this.workflowSnapshotRoot = snapshot.manifest.root;
      this.workflowSnapshotManifestHash = snapshot.manifest.manifestHash;
      return { snapshotFile: snapshot.snapshotFile };
    } catch (error) {
      if (rootRunId !== this.currentRunId || !this.currentConfigFile) throw error;
      await createWorkflowConfigSnapshot({ rootConfigFile: this.currentConfigFile, runId: rootRunId });
      const snapshot = await readWorkflowConfigSnapshot({ rootRunId, configFile: childConfigFile });
      this.workflowSnapshotRoot = snapshot.manifest.root;
      this.workflowSnapshotManifestHash = snapshot.manifest.manifestHash;
      return { snapshotFile: snapshot.snapshotFile };
    }
  }

  private async executeSubworkflowStep(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string,
    useVerdict = true,
  ): Promise<string> {
    if (!this.currentRunId) {
      throw new Error('子工作流执行失败：父工作流 runId 不存在');
    }
    const childConfigFile = normalizeWorkflowConfigRef(getSubworkflowConfigFile(step));
    if (!childConfigFile) {
      throw new Error(`子工作流步骤 "${state.name}/${step.name}" 未配置 workflow`);
    }
    if (this.nestingPath.some((item) => item.configFile === childConfigFile)) {
      throw new Error(`检测到运行期子工作流循环: ${[...this.nestingPath.map((item) => item.configFile), childConfigFile].join(' -> ')}`);
    }
    this.assertSubworkflowRuntimeDepth(step, childConfigFile);

    const stepId = randomUUID();
    const stepKey = this.getWorkflowStepKey(state.name, step);
    const activeExisting = this.findActiveSubworkflowForStep(step, state, childConfigFile);
    await this.assertSubworkflowRunLimits(step, state, childConfigFile, activeExisting);
    const childRunId = activeExisting?.runId || `run-${formatTimestamp()}-${randomUUID().slice(0, 8)}`;
    const rootRunId = this.rootRunId || this.currentRunId;
    const trace = this.buildSubworkflowTrace(stepId, childRunId, childConfigFile);
    const attempt = activeExisting?.attempt || this.getNextSubworkflowAttempt(step.name, state.name);
    const startedAt = new Date().toISOString();
    const beforeSnapshotId = await this.recordStepGitBefore({
      stepLogId: stepId,
      stepName: stepKey,
      stateName: state.name,
      agent: 'subworkflow',
    });
    const snapshot = await this.ensureSubworkflowSnapshot(rootRunId, childConfigFile);
    const childRef: PersistedSubworkflowRunRef = {
      parentStepId: stepId,
      parentStepName: step.name,
      parentStateName: state.name,
      configFile: childConfigFile,
      snapshotFile: snapshot.snapshotFile,
      runId: childRunId,
      attempt,
      status: activeExisting?.status || 'starting',
      startedAt,
    };

    this.clearFailedStep(stepKey);
    this.completedSteps = this.completedSteps.filter((item) => item !== stepKey);
    this.markStepActive(stepKey);
    this.activeSubworkflowRunId = childRunId;
    this.upsertSubworkflowRun(childRef);
    this.recordSubworkflowAudit({
      action: 'start',
      childRunId,
      childConfigFile,
      stateName: state.name,
      stepName: step.name,
      details: {
        attempt,
        snapshotFile: snapshot.snapshotFile,
      },
    });
    this.markBoundSpecTasksForStep({
      step,
      stateName: state.name,
      status: 'in-progress',
      updatedBy: 'system:subworkflow',
      validation: `Subworkflow started: ${state.name} / ${step.name}`,
    });
    await this.persistState();

    this.emit('step-start', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: 'subworkflow',
      stepType: 'subworkflow',
      childRunId,
      childConfigFile,
      ...trace,
    });
    this.emit('subworkflow-start', {
      parentRunId: this.currentRunId,
      runId: childRunId,
      state: state.name,
      step: step.name,
      childConfigFile,
      snapshotFile: snapshot.snapshotFile,
      attempt,
      ...trace,
    });

    const startedAtMs = Date.now();
    let finalStatus = 'failed';
    let finalSummary = '';
    let finalVerdict: 'pass' | 'conditional_pass' | 'fail' = 'fail';
    let errorMsg = '';
    let timeoutTriggered = false;

    try {
      const { workflowRegistry } = await import('@/lib/workflow/registry');
      const managerKey = `child:${this.currentRunId}:${activeExisting?.parentStepId || stepId}`;
      const childManager = await workflowRegistry.getManagerForRun({
        configFile: childConfigFile,
        managerKey,
        isStateMachine: true,
      });
      const updateChildRefStatus = (status: PersistedSubworkflowRunRef['status'], payload: any = {}) => {
        const current = this.subworkflowRuns.find((item) => item.runId === childRunId) || childRef;
        this.upsertSubworkflowRun({
          ...current,
          status,
          summary: payload?.message || payload?.summary || current.summary,
        });
        this.bumpSubworkflowEventCount(childRunId, status === 'waiting-human' ? 'waiting-human' : 'status', {
          childRunId,
          childConfigFile,
          stateName: state.name,
          stepName: step.name,
          details: {
            status,
            childOnly: payload?.childOnly,
            message: payload?.message,
          },
        });
        this.emit('subworkflow-status', {
          parentRunId: this.currentRunId,
          runId: childRunId,
          state: state.name,
          step: step.name,
          childConfigFile,
          status,
          ...trace,
          ...payload,
        });
        void this.persistState();
      };
      const onChildHumanQuestion = (payload: any) => {
        if (this.getSubworkflowRuntime(step).humanQuestions === 'child-only') {
          updateChildRefStatus('waiting-human', {
            ...payload,
            childOnly: true,
          });
          return;
        }
        updateChildRefStatus('waiting-human', payload);
        this.emit('subworkflow-waiting-human', {
          parentRunId: this.currentRunId,
          runId: childRunId,
          state: state.name,
          step: step.name,
          childConfigFile,
          ...trace,
          ...payload,
        });
      };
      const onChildStatus = (payload: any) => {
        const childStatus = payload?.status;
        if (childStatus === 'running' || childStatus === 'preparing') updateChildRefStatus('running', payload);
        if (childStatus === 'stopped') updateChildRefStatus('stopped', payload);
        if (childStatus === 'failed') updateChildRefStatus('failed', payload);
        if (childStatus === 'completed') updateChildRefStatus('completed', payload);
      };
      childManager.on?.('human-question-required', onChildHumanQuestion);
      childManager.on?.('human-approval-required', onChildHumanQuestion);
      childManager.on?.('status', onChildStatus);
      const childNestingPath = [
        ...this.nestingPath,
        { runId: childRunId, configFile: childConfigFile, stepName: step.name, stateName: state.name },
      ];
      (childManager as any)._createdBy = this._createdBy;
      (childManager as any)._createdByName = this._createdByName;
      (childManager as any)._userPersonalDir = this._userPersonalDir;
      (childManager as any)._frontendSessionId = this._frontendSessionId;
      (childManager as any)._creationSessionId = this._creationSessionId;
      (childManager as any)._parentRunId = this.currentRunId;
      (childManager as any)._parentConfigFile = this.currentConfigFile;
      (childManager as any)._parentStateName = state.name;
      (childManager as any)._parentStepId = stepId;
      (childManager as any)._parentStepName = step.name;
      (childManager as any)._rootRunId = rootRunId;
      (childManager as any)._nestingPath = childNestingPath;
      const workspaceEmbedding = this.resolveSubworkflowWorkspaceEmbedding(step, config);
      (childManager as any)._embeddedProjectRoot = workspaceEmbedding.projectRoot;
      (childManager as any)._embeddedWorkspaceMode = workspaceEmbedding.workspaceMode;
      (childManager as any)._embeddedContextOverrides = this.buildSubworkflowContextOverrides(step);

      const childStatus = childManager.getStatus?.();
      const runWithTimeout = async (operation: Promise<void>, childManagerForTimeout: any) => {
        const timeoutMinutes = this.getSubworkflowRuntime(step).timeoutMinutes;
        if (!timeoutMinutes || !Number.isFinite(Number(timeoutMinutes)) || Number(timeoutMinutes) <= 0) {
          await operation;
          return;
        }
        let timer: ReturnType<typeof setTimeout> | null = null;
        try {
          await Promise.race([
            operation,
            new Promise<void>((_, reject) => {
              timer = setTimeout(() => {
                timeoutTriggered = true;
                reject(new Error(`子工作流超时: ${childConfigFile} 超过 ${timeoutMinutes} 分钟`));
              }, Number(timeoutMinutes) * 60 * 1000);
            }),
          ]);
        } catch (error) {
          if (timeoutTriggered) {
            await childManagerForTimeout?.stop?.().catch?.(() => {});
          }
          throw error;
        } finally {
          if (timer) clearTimeout(timer);
        }
      };

      if (activeExisting && (childStatus?.status === 'running' || childStatus?.status === 'preparing')) {
        this.emit('subworkflow-status', {
          parentRunId: this.currentRunId,
          runId: childRunId,
          state: state.name,
          step: step.name,
          childConfigFile,
          status: childStatus.status,
          reused: true,
          ...trace,
        });
        await runWithTimeout(new Promise<void>((resolveWait) => {
          const timer = setInterval(() => {
            const s = childManager.getStatus?.();
            if (!s || !['running', 'preparing'].includes(s.status)) {
              clearInterval(timer);
              resolveWait();
            }
          }, 1000);
        }), childManager);
      } else {
        this.upsertSubworkflowRun({ ...childRef, status: 'running' });
        await this.persistState();
        const childRequirements = this.resolveSubworkflowRequirements(step, requirements);
        const childContexts = this.buildSubworkflowInitialContexts(step, state, childConfigFile, extraContext);
        await runWithTimeout((childManager as any).start(childConfigFile, childRequirements, [], childContexts, childRunId), childManager);
      }
      childManager.off?.('human-question-required', onChildHumanQuestion);
      childManager.off?.('human-approval-required', onChildHumanQuestion);
      childManager.off?.('status', onChildStatus);
    } catch (error: any) {
      errorMsg = error?.message || String(error);
    }

    const childRunState = await loadRunState(childRunId).catch(() => null);
    finalStatus = timeoutTriggered ? 'stopped' : (childRunState?.status || (errorMsg ? 'failed' : 'completed'));
    const childDecisionOutput = this.getSubworkflowDecisionOutput(childRunState, finalStatus);
    finalVerdict = finalStatus === 'completed' && useVerdict
      ? this.parseVerdict(childDecisionOutput)
      : (finalStatus === 'completed' ? 'pass' : 'fail');
    finalSummary = this.truncateSubworkflowSummary(this.getSubworkflowSummary(childRunState, finalStatus));
    let parentAllowedByHuman = false;
    if (timeoutTriggered && this.getSubworkflowRuntime(step).timeoutStrategy === 'ask-human') {
      const timeoutQuestion = await this.createHumanQuestion({
        kind: 'approval',
        title: `子工作流超时：${step.name}`,
        message: [
          `子工作流 ${childConfigFile} 已超过 ${this.getSubworkflowRuntime(step).timeoutMinutes} 分钟并已停止。`,
          '',
          finalSummary,
          '',
          '请选择父工作流是否继续。选择放行会把当前 parent step 记为 conditional_pass，child run 仍保留 stopped 状态。',
        ].join('\n'),
        currentState: state.name,
        requiresWorkflowPause: true,
        answerSchema: {
          type: 'single-choice',
          required: true,
          options: [
            { label: '按超时失败处理', value: 'fail', description: '父步骤按 stopped mapping 处理。' },
            { label: '人工放行继续', value: 'continue', description: '父步骤记为 conditional_pass 并继续后续流程。' },
          ],
        },
        source: {
          type: 'subworkflow-timeout',
          childRunId,
          childConfigFile,
          stateName: state.name,
          stepName: step.name,
        },
      });
      this.emit('subworkflow-waiting-human', {
        parentRunId: this.currentRunId,
        runId: childRunId,
        state: state.name,
        step: step.name,
        childConfigFile,
        reason: 'timeout',
        humanQuestion: timeoutQuestion,
        ...trace,
      });
      const answered = await this.waitForHumanQuestionAnswer(timeoutQuestion.id);
      const selected = answered?.answer?.selectedOption || answered?.answer?.raw?.selectedOption || 'fail';
      if (selected === 'continue') {
        parentAllowedByHuman = true;
        finalVerdict = 'conditional_pass';
        finalSummary = `${finalSummary}\n\n人工确认：子工作流超时后放行父流程继续。`;
      }
    }
    const childIssues = Array.isArray(childRunState?.issueTracker) ? childRunState.issueTracker : [];
    const childCostUsd = (childRunState?.agents || []).reduce((sum: number, agent: any) => sum + (Number(agent.costUsd) || 0), 0);
    const childDurationMs = childRunState?.startTime && childRunState?.endTime
      ? Math.max(0, new Date(childRunState.endTime).getTime() - new Date(childRunState.startTime).getTime())
      : Date.now() - startedAtMs;
    const endedAt = new Date().toISOString();
    const persistedChildStatus: PersistedSubworkflowRunRef['status'] = [
      'pending', 'starting', 'running', 'waiting-human', 'completed', 'failed',
      'stopped', 'crashed', 'cancelled', 'detached', 'abandoned', 'superseded',
    ].includes(finalStatus) ? finalStatus as PersistedSubworkflowRunRef['status'] : 'crashed';
    const subworkflowResultBlock = `<subworkflow-result>${JSON.stringify({
      ...(parentAllowedByHuman ? { verdict: finalVerdict } : {}),
      summary: finalSummary,
      childRunId,
      childConfigFile,
      status: finalStatus,
      issues: childIssues,
      costUsd: childCostUsd,
      durationMs: childDurationMs,
    })}</subworkflow-result>`;
    const output = useVerdict ? [childDecisionOutput, subworkflowResultBlock].filter(Boolean).join('\n') : subworkflowResultBlock;

    this.markStepInactive(stepKey);
    this.activeSubworkflowRunId = this.activeSubworkflowRunId === childRunId ? null : this.activeSubworkflowRunId;
    const childExecutionSucceeded = finalStatus === 'completed' || parentAllowedByHuman;
    const completed = childExecutionSucceeded && finalVerdict !== 'fail';
    if (completed) {
      if (!this.completedSteps.includes(stepKey)) this.completedSteps.push(stepKey);
      this.clearFailedStep(stepKey);
      this.markBoundSpecTasksForStep({
        step,
        stateName: state.name,
        status: 'completed',
        updatedBy: 'system:subworkflow',
        validation: `Subworkflow completed: ${state.name} / ${step.name}`,
      });
    } else {
      this.addFailedStep(stepKey);
      this.completedSteps = this.completedSteps.filter((item) => item !== stepKey);
      this.markBoundSpecTasksForStep({
        step,
        stateName: state.name,
        status: 'blocked',
        updatedBy: 'system:subworkflow',
        validation: `Subworkflow failed: ${state.name} / ${step.name}: ${errorMsg || finalStatus}`,
      });
    }

    const afterSnapshotId = await this.recordStepGitAfter({
      stepLogId: stepId,
      stepName: stepKey,
      stateName: state.name,
      agent: 'subworkflow',
      status: completed ? 'completed' : 'failed',
      beforeSnapshotId,
    });
    const compactLogOutput = compactRuntimeOutputPreview(output);
    this.stepLogs.push({
      id: stepId,
      stepName: stepKey,
      agent: 'subworkflow',
      status: completed ? 'completed' : 'failed',
      output: completed ? compactLogOutput.output : '',
      outputBytes: completed ? compactLogOutput.outputBytes : undefined,
      error: completed ? '' : (errorMsg || finalSummary || finalStatus),
      costUsd: childCostUsd,
      durationMs: childDurationMs,
      timestamp: endedAt,
      tokenUsage: toPersistedTokenUsage(ZERO_ENGINE_USAGE),
      sessionId: null,
      engineName: this.engineType,
      stepType: 'subworkflow',
      childRunId,
      childConfigFile,
      childStatus: finalStatus,
      childSummary: finalSummary,
      childVerdict: finalVerdict,
      ...(trace as any),
      gitStepDiffId: `git-step-${stepId}`,
      gitBeforeSnapshotId: beforeSnapshotId,
      gitAfterSnapshotId: afterSnapshotId,
    });
    this.upsertSubworkflowRun({
      ...childRef,
      status: persistedChildStatus,
      endedAt,
      summary: finalSummary,
      verdict: finalVerdict,
      error: completed ? undefined : (errorMsg || finalSummary || finalStatus),
    });
    this.recordSubworkflowAudit({
      action: 'result-mapping',
      childRunId,
      childConfigFile,
      stateName: state.name,
      stepName: step.name,
      resultMapping: {
        childStatus: finalStatus,
        parentVerdict: useVerdict ? finalVerdict : undefined,
      },
      details: {
        verdictSource: useVerdict ? 'child-output' : 'not-required',
        completed,
        error: completed ? undefined : (errorMsg || finalStatus),
      },
    });

    await saveProcessOutput(this.currentRunId, stepKey, finalSummary || output).catch(() => {});
    await this.persistState();

    if (completed) {
      this.emit('step-complete', {
        id: stepId,
        state: state.name,
        step: step.name,
        agent: 'subworkflow',
        stepType: 'subworkflow',
        childRunId,
        childConfigFile,
        childStatus: finalStatus,
        childVerdict: finalVerdict,
        ...trace,
        output: compactLogOutput.output,
        outputBytes: compactLogOutput.outputBytes,
        outputTruncated: compactLogOutput.truncated,
        costUsd: childCostUsd,
        durationMs: childDurationMs,
      });
      this.emit('subworkflow-complete', {
        parentRunId: this.currentRunId,
        runId: childRunId,
        state: state.name,
        step: step.name,
        childConfigFile,
        status: finalStatus,
        verdict: finalVerdict,
        summary: finalSummary,
        ...trace,
      });
      return output;
    }

    this.emit('step-failed', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: 'subworkflow',
      stepType: 'subworkflow',
      childRunId,
      childConfigFile,
      childStatus: finalStatus,
      childVerdict: finalVerdict,
      ...trace,
      error: errorMsg || finalSummary || finalStatus,
    });
    const subworkflowTerminalEvent = ['stopped', 'cancelled', 'detached'].includes(finalStatus)
      ? 'subworkflow-stopped'
      : 'subworkflow-failed';
    this.emit(subworkflowTerminalEvent, {
      parentRunId: this.currentRunId,
      runId: childRunId,
      state: state.name,
      step: step.name,
      childConfigFile,
      status: finalStatus,
      verdict: finalVerdict,
      error: errorMsg || finalSummary || finalStatus,
      summary: finalSummary,
      ...trace,
    });
    throw new Error(errorMsg || finalSummary || `子工作流失败: ${childConfigFile}`);
  }

  private async executeStep(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const stepStartGeneration = this.runtimeGeneration;
    const runtimeAgentName = getStepRuntimeAgentName(step);
    this.assertValidStepRuntimeAgent(step, state, runtimeAgentName);
    const agent = this.agents.find(a => a.name === runtimeAgentName);
    if (!agent) {
      throw new Error(`找不到 agent: ${runtimeAgentName}`);
    }

    const stepId = randomUUID();
    const stepKey = this.getWorkflowStepKey(state.name, step);
    const beforeSnapshotId = await this.recordStepGitBefore({
      stepLogId: stepId,
      stepName: stepKey,
      stateName: state.name,
      agent: runtimeAgentName,
    });

    agent.status = 'running';
    agent.currentTask = step.name;
    this.clearFailedStep(stepKey);
    this.completedSteps = this.completedSteps.filter((item) => item !== stepKey);
    this.markStepActive(stepKey);
    this.markBoundSpecTasksForStep({
      step,
      stateName: state.name,
      status: 'in-progress',
      updatedBy: `system:${runtimeAgentName}`,
      validation: `Step started: ${state.name} / ${step.name}`,
    });
    this.emit('agents', { agents: this.agents });
    
    this.agentFlow.push({
      id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'stream',
      fromAgent: runtimeAgentName,
      toAgent: runtimeAgentName,
      message: `开始执行步骤: ${step.name}`,
      stateName: state.name,
      stepName: step.name,
      round: 0,
      timestamp: new Date().toISOString(),
    });
    this.emit('agent-flow', { agentFlow: this.agentFlow });
    await this.persistState();

    this.emit('step-start', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: runtimeAgentName,
    });
    await this.appendSupervisorChatEvent({
      type: 'step-start',
      title: `步骤开始：${state.name} / ${step.name}`,
      body: `- Agent: ${runtimeAgentName}`,
      tags: ['task', 'running', runtimeAgentName],
      dedupeKey: `workflow-step-start-${stepId}`,
      speakerName: runtimeAgentName,
    });

    try {
      // 在执行 Agent 之前，先执行可选的预命令（例如编译 / 测试命令）
      this.lastPreCommandOutput = null;
      if (Array.isArray((step as any).preCommands) && (step as any).preCommands.length > 0) {
        try {
          const preOutput = await this.runPreCommands(
            (step as any).preCommands as string[],
            config,
            {
              stateName: state.name,
              stepName: step.name,
              agent: runtimeAgentName,
            }
          );
          this.lastPreCommandOutput = preOutput.text || null;
        } catch (e) {
          // 预命令执行本身不应中断整个步骤，将错误文本注入上下文由 Agent 决策
          const msg = e instanceof Error ? e.message : String(e);
          this.lastPreCommandOutput = `预执行命令执行异常（不会中断步骤，请你据此判断是否 fail）：\n${msg}`;
        }
      }

      // Build context (now async)
      const context = await this.buildStepContext(step, state, config, requirements, extraContext);

      // Execute step (reuse existing process manager logic)
      let stepResult = await this.runAgentStep(step, context, config, stepId);
      let output = stepResult.output;
      if (this.shouldRequireFinalVerdict(step, state) && !this.hasRequiredVerdictJson(output)) {
        const repairContext = this.buildMissingFinalVerdictPrompt(context, output, state, step);
        const repairResult = await this.runAgentStep(step, repairContext, config, stepId);
        output = [output, repairResult.output].filter(Boolean).join('\n\n---\n\n');
        stepResult = {
          ...stepResult,
          output,
          lastRoundOutput: repairResult.lastRoundOutput || repairResult.output,
          costUsd: stepResult.costUsd + repairResult.costUsd,
          durationMs: stepResult.durationMs + repairResult.durationMs,
          sessionId: repairResult.sessionId || stepResult.sessionId,
          tokenUsage: this.mergeTokenUsage(stepResult.tokenUsage, repairResult.tokenUsage),
        };
      }
      if (isEngineLevelFailure(output)) {
        throw new Error(output.trim() || '引擎返回致命错误输出');
      }
      this.assertStepOutputIsNotSupervisorReview(step, state, runtimeAgentName, output);
      const conclusion = compactStepConclusion(stepResult.lastRoundOutput || output);
      if (stepStartGeneration !== this.runtimeGeneration) {
        this.emit('log', {
          level: 'warning',
          message: `跳过旧执行链路成功写回：${state.name}/${step.name}`,
        });
        return output;
      }

      agent.status = 'completed';
      agent.completedTasks++;
      addTokenUsage(agent, stepResult.tokenUsage);
      agent.costUsd += stepResult.costUsd;
      agent.lastOutput = output;
      agent.summary = conclusion;
      // Store or clear session ID for reuse across iterations of the same runtime agent
      replaceAgentStateSessionId(agent, stepResult.sessionId);
      this.markStepInactive(stepKey);
      if (!this.completedSteps.includes(stepKey)) {
        this.completedSteps.push(stepKey);
      }
      this.clearFailedStep(stepKey);
      this.removeCurrentProcess(stepId);
      this.markBoundSpecTasksForStep({
        step,
        stateName: state.name,
        status: 'completed',
        updatedBy: `system:${runtimeAgentName}`,
        validation: `Step completed: ${state.name} / ${step.name}`,
      });

      const afterSnapshotId = await this.recordStepGitAfter({
        stepLogId: stepId,
        stepName: stepKey,
        stateName: state.name,
        agent: runtimeAgentName,
        status: 'completed',
        beforeSnapshotId,
      });
      const compactLogOutput = compactRuntimeOutputPreview(output);
      // Record step log for persistence
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: runtimeAgentName,
        status: 'completed',
        output: compactLogOutput.output,
        outputBytes: compactLogOutput.outputBytes,
        error: '',
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
        timestamp: new Date().toISOString(),
        tokenUsage: stepResult.tokenUsage,
        sessionId: stepResult.sessionId || null,
        engineName: this.engineType,
        gitStepDiffId: `git-step-${stepId}`,
        gitBeforeSnapshotId: beforeSnapshotId,
        gitAfterSnapshotId: afterSnapshotId,
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();

      this.emit('step-complete', {
        id: stepId,
        state: state.name,
        step: step.name,
        agent: runtimeAgentName,
        output: compactLogOutput.output,
        outputBytes: compactLogOutput.outputBytes,
        outputTruncated: compactLogOutput.truncated,
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
      });
      await this.appendSupervisorChatEvent({
        type: 'step-complete',
        title: `步骤完成：${state.name} / ${step.name}`,
        body: [
          `- Agent: ${runtimeAgentName}`,
          conclusion ? `- 结论: ${conclusion.slice(0, 1200)}` : '',
        ].filter(Boolean).join('\n'),
        tags: ['task', 'completed', runtimeAgentName],
        dedupeKey: `workflow-step-complete-${stepId}`,
        speakerName: runtimeAgentName,
      });

      // 记录步骤完成的流转线
      const currentStepIndex = state.steps.findIndex(s => s.name === step.name);
      if (currentStepIndex >= 0 && currentStepIndex < state.steps.length - 1) {
        const nextStep = state.steps[currentStepIndex + 1];
        const nextRuntimeAgentName = nextStep ? getStepRuntimeAgentName(nextStep) : '';
        if (nextStep && nextRuntimeAgentName !== runtimeAgentName) {
          this.agentFlow.push({
            id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'stream',
            fromAgent: runtimeAgentName,
            toAgent: nextRuntimeAgentName,
            message: `步骤流转: ${step.name} -> ${nextStep.name}`,
            stateName: state.name,
            stepName: step.name,
            round: 0,
            timestamp: new Date().toISOString(),
          });
          this.emit('agent-flow', { agentFlow: this.agentFlow });
        }
      }

      // Save output to file system
      if (this.currentRunId) {
        const stepFileName = stepKey;
        await saveProcessOutput(this.currentRunId, stepFileName, conclusion || output).catch(() => {});
      }

      if (step.channelIds?.length) {
        const entry: ChannelOutputEntry = {
          stateName: state.name,
          stepName: step.name,
          agent: runtimeAgentName,
          summary: conclusion,
          timestamp: new Date().toISOString(),
        };
        for (const channelId of step.channelIds) {
          const existing = this.channelOutputsById.get(channelId) || [];
          this.channelOutputsById.set(channelId, [...existing, entry].slice(-20));
        }
      }

      return output;
    } catch (error: any) {
      if (stepStartGeneration !== this.runtimeGeneration) {
        this.markStepInactive(stepKey);
        this.removeCurrentProcess(stepId);
        this.emit('log', {
          level: 'warning',
          message: `跳过旧执行链路失败写回：${state.name}/${step.name}`,
        });
        throw error;
      }
      agent.status = 'failed';
      this.markStepInactive(stepKey);
      this.removeCurrentProcess(stepId);

      // Record failed step log
      const errorMsg = error.message || String(error);
      this.addFailedStep(stepKey);
      this.completedSteps = this.completedSteps.filter((item) => item !== stepKey);
      this.markBoundSpecTasksForStep({
        step,
        stateName: state.name,
        status: 'blocked',
        updatedBy: `system:${runtimeAgentName}`,
        validation: `Step failed: ${state.name} / ${step.name}: ${errorMsg}`,
      });
      const afterSnapshotId = await this.recordStepGitAfter({
        stepLogId: stepId,
        stepName: stepKey,
        stateName: state.name,
        agent: runtimeAgentName,
        status: 'failed',
        beforeSnapshotId,
      });
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: runtimeAgentName,
        status: 'failed',
        output: '',
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
        tokenUsage: toPersistedTokenUsage(ZERO_ENGINE_USAGE),
        sessionId: null,
        engineName: this.engineType,
        gitStepDiffId: `git-step-${stepId}`,
        gitBeforeSnapshotId: beforeSnapshotId,
        gitAfterSnapshotId: afterSnapshotId,
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();
      await this.appendSupervisorChatEvent({
        type: 'step-failed',
        title: `步骤失败：${state.name} / ${step.name}`,
        body: [
          `- Agent: ${runtimeAgentName}`,
          `- 错误: ${errorMsg}`,
        ].join('\n'),
        tags: ['task', 'failed', runtimeAgentName],
        dedupeKey: `workflow-step-failed-${stepId}`,
        speakerName: runtimeAgentName,
      });

      // Save error output
      if (this.currentRunId) {
        await saveProcessOutput(this.currentRunId, stepKey, `ERROR: ${errorMsg}`).catch(() => {});
      }

      throw error;
    }
  }

  private assertValidStepRuntimeAgent(step: WorkflowStep, state: StateMachineState, runtimeAgentName: string): void {
    const supervisorName = this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    if (runtimeAgentName === supervisorName && step.agent !== supervisorName) {
      throw new Error(
        `状态机执行身份非法：Supervisor "${supervisorName}" 不能替代步骤 "${state.name}/${step.name}" 的 Agent "${step.agent}"`
      );
    }
  }

  private assertStepOutputIsNotSupervisorReview(
    step: WorkflowStep,
    state: StateMachineState,
    runtimeAgentName: string,
    output: string,
  ): void {
    const supervisorName = this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    if (runtimeAgentName === supervisorName || step.agent === supervisorName) return;

    const normalized = normalizeGuardText(output);
    if (!normalized) return;

    const latestReview = this.latestSupervisorReview;
    const latestReviewText = normalizeGuardText(latestReview?.content);
    if (
      latestReviewText.length > 80
      && (
        latestReviewText === normalized
        || (normalized.length <= latestReviewText.length + 500 && latestReviewText.includes(normalized))
        || (latestReviewText.length <= normalized.length + 500 && normalized.includes(latestReviewText))
      )
    ) {
      throw new Error(
        `状态机输出归属异常：步骤 "${state.name}/${step.name}" 收到了 Supervisor 审阅内容，拒绝标记为完成`
      );
    }

    const looksLikeSupervisorReview =
      normalized.includes('当前阶段结论')
      && normalized.includes('是否建议继续迭代')
      && normalized.includes('下一步指导意见');
    if (looksLikeSupervisorReview) {
      throw new Error(
        `状态机输出归属异常：步骤 "${state.name}/${step.name}" 的输出疑似 Supervisor 阶段审阅，拒绝标记为完成`
      );
    }
  }

  private getChannelContext(step: WorkflowStep): string {
    if (!step.channelIds?.length) return '';
    const blocks: string[] = [];
    for (const channelId of step.channelIds) {
      const entries = (this.channelOutputsById.get(channelId) || []).slice(-5);
      if (entries.length === 0) continue;
      blocks.push([
        `## Channel ${channelId} 最近输出`,
        ...entries.map((entry) => `- [${entry.timestamp}] ${entry.stateName}/${entry.stepName} (${entry.agent}): ${entry.summary.replace(/\s+/g, ' ').slice(0, 600)}`),
      ].join('\n'));
    }
    return blocks.join('\n\n');
  }

  private mergeTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
    return {
      inputTokens: (a.inputTokens || 0) + (b.inputTokens || 0),
      outputTokens: (a.outputTokens || 0) + (b.outputTokens || 0),
      cacheCreationInputTokens: (a.cacheCreationInputTokens || 0) + (b.cacheCreationInputTokens || 0),
      cacheReadInputTokens: (a.cacheReadInputTokens || 0) + (b.cacheReadInputTokens || 0),
    };
  }

  private hasRequiredVerdictJson(output: string): boolean {
    const parsed = this.extractJsonObject(output);
    return Boolean(parsed && ['pass', 'conditional_pass', 'fail'].includes(parsed.verdict));
  }

  private buildMissingFinalVerdictPrompt(
    originalContext: string,
    previousOutput: string,
    state: StateMachineState,
    step: WorkflowStep,
  ): string {
    const previous = compactRuntimeOutputPreview(previousOutput || '', 8000).output;
    return [
      originalContext,
      '\n# 系统补充要求：缺少最终裁决 JSON',
      `你刚才完成了状态 "${state.name}" 的最后步骤 "${step.name}"，但回复中没有包含可解析的最终裁决 JSON。`,
      '不要重新执行任务，不要重复完整过程，只基于你刚才的结果补交最终裁决。',
      '必须先输出以下 JSON 块（用 ```json 包裹），且 verdict 只能是 pass、conditional_pass、fail 三者之一：',
      '```json',
      '{',
      '  "verdict": "pass | conditional_pass | fail",',
      '  "remaining_issues": 0,',
      '  "summary": "一句话总结"',
      '}',
      '```',
      '随后必须输出 <step-conclusion>，用于步骤归档和后续步骤复用。',
      '\n# 你上一轮输出',
      previous || '[上一轮没有可用输出]',
    ].join('\n');
  }

  private buildWorkflowRoadmapContext(
    currentStep: WorkflowStep,
    currentState: StateMachineState,
    config: StateMachineWorkflowConfig,
    options: { includeVerdictTransitions?: boolean } = {},
  ): string {
    const states = config.workflow?.states || [];
    const currentStepKey = this.getWorkflowStepKey(currentState.name, currentStep);
    const lines: string[] = [
      '\n# 全局工作流路线与当前职责边界',
      '你可以看到完整工作流路线，用它来理解上下游分工，但不能把当前步骤的核心交付留给后续步骤。',
      '当前步骤必须尽量完成其任务描述中可完成的分析、实现、验证或裁决；后续步骤只负责在你的明确产出基础上继续推进。',
      '如果发现某件事确实应由后续步骤处理，请在本步输出的补充说明或状态收尾结论中写清楚具体输入、文件、风险和最小动作，不要只笼统写“留给后续”。',
      '',
    ];

    for (const state of states) {
      if (state.name === '__human_approval__') continue;
      const stateMarker = state.name === currentState.name ? '=> ' : '   ';
      lines.push(`${stateMarker}状态: ${state.name}${state.isInitial ? ' (初始)' : ''}${state.isFinal ? ' (最终)' : ''}`);
      if (state.description) lines.push(`   状态目标: ${state.description}`);
      for (const step of state.steps || []) {
        const stepKey = this.getWorkflowStepKey(state.name, step);
        const marker = stepKey === currentStepKey ? '   * 当前步骤' : '   - 步骤';
        const agentName = getStepRuntimeAgentName(step);
        const status = this.completedSteps.includes(stepKey)
          ? '已完成'
          : this.failedSteps.includes(stepKey)
            ? '失败待恢复'
          : this.activeStepKeys.has(stepKey)
            ? '运行中'
            : '待执行';
        lines.push(`${marker}: ${step.name} [${status}]${agentName ? ` / agent: ${agentName}` : ''}${step.role ? ` / role: ${step.role}` : ''}`);
        if (step.task) {
          const compactTask = String(step.task).replace(/\s+/g, ' ').trim();
          lines.push(`     任务: ${compactTask.slice(0, 220)}${compactTask.length > 220 ? '...' : ''}`);
        }
      }
      if (options.includeVerdictTransitions) {
        const transitions = (state.transitions || [])
          .map((transition) => {
            const verdict = transition.condition?.verdict;
            if (verdict === 'pass') return `pass -> ${transition.to}`;
            if (verdict === 'conditional_pass') return `conditional_pass -> ${transition.to}`;
            if (verdict === 'fail') return `fail -> ${transition.to}`;
            return transition.to;
          })
          .filter(Boolean);
        if (transitions.length > 0) {
          lines.push(`   verdict 流向: ${Array.from(new Set(transitions)).join(' / ')}`);
        }
      }
    }

    return lines.join('\n');
  }

  private buildStateVerdictTransitionContext(state: StateMachineState): string {
    const transitions = (state.transitions || [])
      .filter((transition) => transition.condition?.verdict)
      .map((transition) => {
        const verdict = transition.condition.verdict;
        return `- ${verdict}: 进入 "${transition.to}"${transition.label ? `（${transition.label}）` : ''}`;
      });

    return [
      '\n# 当前状态 verdict 转移规则',
      '本节是当前步骤必须遵守的流程控制规则，不是建议。',
      '`pass`、`conditional_pass`、`fail` 的下一步都以本状态 transitions 的真实配置为准，不要根据名称自行假设。',
      transitions.length > 0 ? transitions.join('\n') : '- 当前状态没有配置 verdict 转移。',
      '如果你的自然语言建议进入某个状态，最终 JSON verdict 必须能通过上述配置到达该状态；例如 conditional_pass 可能自迭代，也可能前进，必须看上面的实际目标。',
    ].join('\n');
  }

  private async buildStepContext(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const parts: string[] = [];
    const runtimeAgentName = getStepRuntimeAgentName(step);
    const memo = this.getAgentPromptMemo(runtimeAgentName || step.agent || 'default');
    const isLastStepInState = this.isStateLastStep(step, state);
    const requiresFinalVerdict = this.shouldRequireFinalVerdict(step, state);

    parts.push(`# 当前状态: ${state.name}`);
    if (state.description) {
      parts.push(`状态描述: ${state.description}`);
    }

    parts.push(`\n# 当前任务: ${step.name}`);
    parts.push(`任务描述: ${step.task}`);
    if (requiresFinalVerdict) {
      parts.push(this.buildStateVerdictTransitionContext(state));
    }

    const roadmapKey = `${state.name}:${requiresFinalVerdict ? 'with-verdict' : 'without-verdict'}:${config.workflow.states.map((item) => {
      const stepSig = (item.steps || []).map((stateStep) => stateStep.name).join('|');
      const transitionSig = (item.transitions || [])
        .map((transition) => `${transition.condition?.verdict || '*'}->${transition.to}`)
        .join('|');
      return `${item.name}:${stepSig}:${transitionSig}`;
    }).join('>')}`;
    if (memo.roadmapKey !== roadmapKey) {
      parts.push(this.buildWorkflowRoadmapContext(step, state, config, {
        includeVerdictTransitions: requiresFinalVerdict,
      }));
      memo.roadmapKey = roadmapKey;
    } else {
      parts.push(`\n# 工作流定位\n当前状态: ${state.name}\n当前步骤: ${step.name}\n上下游路线未变；继续按当前步骤任务推进，不要把本步骤核心交付留给后续步骤。`);
    }

    if (requirements) {
      parts.push(`\n# 需求说明\n${requirements}`);
    }

    if (this.currentRunSpecCoding) {
      const relevantPhase = this.currentRunSpecCoding.phases.find((phase) => phase.title === state.name);
      const flattenTasksForPrompt = (
        tasks: SpecCodingDocument['tasks'],
        depth = 0,
      ): Array<SpecCodingDocument['tasks'][number] & { depth: number }> => {
        return (tasks || []).flatMap((task) => [
          { ...task, depth },
          ...flattenTasksForPrompt(task.children || [], depth + 1),
        ]);
      };
      const allPromptTasks = flattenTasksForPrompt(this.currentRunSpecCoding.tasks || []);
      const boundTaskIds = this.getStepSpecTaskIds(step, state.name);
      const boundTasks = boundTaskIds
        .map((taskId) => allPromptTasks.find((task) => task.id === taskId))
        .filter(Boolean) as Array<SpecCodingDocument['tasks'][number] & { depth: number }>;
      const relevantTasks = relevantPhase
        ? allPromptTasks.filter((task) => task.phaseId === relevantPhase.id)
        : [];
      const taskContext = relevantTasks.length > 0
        ? relevantTasks
        : allPromptTasks.filter((task) => task.status !== 'completed').slice(0, 12);
      if (boundTaskIds.length > 0) {
        parts.push([
          '\n# 当前绑定的 tasks.md 任务',
          `本步骤绑定 taskId: ${boundTaskIds.join(', ')}`,
          boundTasks.length > 0
            ? `绑定任务: ${boundTasks.map((task) => `${task.id} ${task.title}`).join('；')}`
            : '绑定任务未在当前投影列表中找到；继续按步骤目标执行，系统会记录绑定异常。',
          '任务状态由工作流调度器根据步骤开始、完成、失败自动维护；普通执行 Agent 不需要也不应该输出任务状态标签。',
        ].join('\n'));
      }
      parts.push(`\n# 当前 Run Spec Coding 投影`);
      parts.push(`Spec Coding 版本: v${this.currentRunSpecCoding.version}`);
      parts.push('说明: 当前 Run Spec Coding 投影是本次运行绑定的正式规范制品投影。即使工作目录内没有 requirements.md / design.md / tasks.md 文件实体，也必须以这里注入的规范投影和 tasks.md 条目作为执行依据。不要改用旧基线文档替代它。');
      if (this.currentRunSpecCoding.summary) {
        parts.push(`Spec Coding 摘要: ${this.currentRunSpecCoding.summary}`);
      }
      if (this.currentRunSpecCoding.progress?.summary) {
        parts.push(`Spec Coding 进度: ${this.currentRunSpecCoding.progress.summary}`);
      }
      if (relevantPhase?.objective) {
        parts.push(`当前阶段目标: ${relevantPhase.objective}`);
      }
      if (relevantPhase?.ownerAgents?.length) {
        parts.push(`当前阶段责任 Agent: ${relevantPhase.ownerAgents.join(', ')}`);
      }
      if (taskContext.length > 0) {
        parts.push(relevantTasks.length > 0 ? '\n## 当前阶段 tasks.md 条目' : '\n## 相关未完成 tasks.md 条目');
        for (const task of taskContext) {
          const marker = task.status === 'completed' ? 'x' : task.status === 'in-progress' ? '-' : ' ';
          const indent = '  '.repeat(task.depth || 0);
          parts.push(`${indent}- [${marker}] ${task.id} ${task.title} <!-- status:${task.status} -->`);
        }
      }
      parts.push([
        '权限规则: 不能修改目标、约束、阶段定义、分工或其他非状态内容；非状态修订由 Supervisor 负责。',
        'tasks.md 状态标记: [ ]=未开始，[-]=进行中，[x]=已完成，blocked=阻塞。',
        '任务状态是系统维护字段，普通执行 Agent 不输出任务状态协议。',
      ].join('\n'));
    }

    const recentQualityChecks = this.qualityChecks
      .filter((item) => item.stateName === state.name || item.agent === step.agent)
      .slice(-3);
    if (recentQualityChecks.length > 0) {
      parts.push(`\n# 最近质量门禁`);
      for (const check of recentQualityChecks) {
        parts.push(`- [${check.category}/${check.status}] ${check.stepName}: ${check.summary}`);
      }
    }

    // Add global context
    if (this.globalContext) {
      const globalContextKey = promptContentKey(this.globalContext);
      if (memo.globalContextKey !== globalContextKey) {
        parts.push(`\n# 全局上下文\n${this.globalContext}`);
        memo.globalContextKey = globalContextKey;
      }
    }

    if (this.humanAnswersContext.length > 0) {
      const recentAnswers = this.humanAnswersContext.slice(-5).map((item) => [
        `- 问题: ${item.title}`,
        `  - 询问内容: ${item.question}`,
        `  - 人类回答: ${item.answer}`,
        item.instruction ? `  - 附加指令: ${item.instruction}` : '',
      ].filter(Boolean).join('\n'));
      parts.push(`\n# 本轮运行中的人类答复\n${recentAnswers.join('\n')}`);
    }

    if (this.isHumanHelpEnabled(config)) {
      parts.push([
        '\n# 人工客服请求协议',
        '当前工作流开启了“步骤内人工答疑”。你应先自主推进任务；遇到真正阻塞当前步骤继续执行的问题时，可以请求人类答复。',
        '支持场景包括：缺少必要运行环境或权限、缺少代码仓或关键文件、缺少必须配置项/密钥/账号、需求目标或验收标准存在疑问、Agent 已完成必要排查后仍无法解决的问题、必须由用户选择的产品/业务决策。',
        '如果用户需求、工作流要求或当前步骤说明明确提出当前步骤需要“人类确认/人工确认/用户确认/人工反馈/人工审查/人工复核/人工审批/人工验收”，则你必须在执行到需要人工介入的时点立即输出 <human-help>{...}</human-help> 块，把需要确认的问题交给人类；不要用普通文字替代，也不要直接视为已确认。',
        '需要人工介入时，输出一个单独的标签块，格式必须是：',
        '<human-help>',
        '{"title":"简短标题","question":"需要人类回答的具体问题","reason":"为什么这会阻塞当前步骤","answerType":"text|single-choice|multi-choice","options":[{"label":"选项文案","value":"option_value","description":"影响说明"}],"placeholder":"输入提示"}',
        '</human-help>',
        '输出 <human-help> 后先停止继续推进当前步骤，等待系统转交 Supervisor 复核和人类回复。',
      ].join('\n'));
    }

    if (step.channelIds?.length) {
      const channelContext = this.getChannelContext(step);
      if (channelContext) {
        parts.push(`\n# 共享 Channel 最近输出\n${channelContext}`);
      }
    }

    const stateContext = this.stateContexts.get(state.name);
    if (stateContext) {
      const stateContextKey = promptContentKey(stateContext);
      if (memo.stateContextKeys[state.name] !== stateContextKey) {
        parts.push(`\n# 状态上下文\n${stateContext}`);
        memo.stateContextKeys[state.name] = stateContextKey;
      }
    }

    // Add project path
    if (config.context?.projectRoot) {
      parts.push(`\n# 项目路径\n${config.context.projectRoot}`);
    }

    const conclusionScope = isLastStepInState
      ? `当前步骤是状态 "${state.name}" 的最后一个步骤。`
      : `当前步骤不是状态 "${state.name}" 的最后一个步骤。`;
    const resultGuidance = isLastStepInState
      ? '- 当前状态最终完成了什么，或给出了什么 pass / conditional_pass / fail 判断。'
      : '- 当前步骤完成了什么；不要输出 pass / conditional_pass / fail 流程裁决。';

    // Add system-managed step conclusion protocol for every step.
    if (this.currentRunId) {
      const outputPath = `${join(getWorkspaceRunsDir(), this.currentRunId, 'outputs')}/`;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const summaryFileName = `${ts}-${state.name}-${step.name}.md`;
      parts.push([
        '\n# 文档输出要求',
        `请将你产出的步骤成果详细总结写入以下目录：\n\`${outputPath}\``,
        `当前步骤的步骤成果详细总结文件名必须是：\`${summaryFileName}\``,
        '以上规则仅适用于系统要求的“步骤成果详细总结”归档文件。',
        '除步骤成果详细总结外，其他正式产物文件（例如代码、设计文档、API 文档、说明文档、脚本、配置等）应严格按照用户要求、任务要求和项目目录约定写入；如果用户要求产出到工作目录，就写入工作目录，不要写入该归档目录。',
      ].join('\n'));
    }

    // Add structured JSON output requirement for every state final decision step.
    if (requiresFinalVerdict) {
      const verdictTransitions = (state.transitions || [])
        .filter((transition) => transition.condition?.verdict)
        .map((transition) => `- ${transition.condition.verdict}: 进入 "${transition.to}"${transition.label ? `（${transition.label}）` : ''}`)
        .join('\n') || '- 当前状态未配置 verdict 转移。';
      parts.push(`\n# 结构化输出要求\n请输出以下 JSON 块（用 \`\`\`json 包裹），用于自动化流程判断；该 JSON 块必须放在 <step-conclusion> 之前。\n\n\`\`\`json\n{\n  "verdict": "pass | conditional_pass | fail",\n  "remaining_issues": 0,\n  "summary": "一句话总结"\n}\n\`\`\`\n\n字段说明：\n- \`verdict\`: 只能是 \`"pass"\`、\`"conditional_pass"\`、\`"fail"\`，它们的真实流向完全由当前状态 transitions 决定。\n- \`remaining_issues\`: 剩余未解决的问题数量（整数）。\n- \`summary\`: 一句话总结你的评估结论。\n\n# 当前状态 verdict 实际流向\n${verdictTransitions}\n你必须根据上面的实际流向选择 verdict：如果你的自然语言建议是进入某个状态，结构化 verdict 必须匹配能到达该状态的转移。不要根据名称假设 conditional_pass 一定前进或一定回退。\n\n# 裁决边界约束\n- 正式 verdict 只评估当前阶段/当前检查点的核心审查目标。\n- 只有会影响当前检查点是否通过的问题，才能计入 \`remaining_issues\`，并影响 \`pass / conditional_pass / fail\`。\n- 像附加文件命名、时间戳前缀、补充总结归档格式、展示文案、非核心输出排版这类低优先级问题，如果不影响当前检查点核心目标，不能计入 \`remaining_issues\`，也不能单独导致 \`conditional_pass\` 或 \`fail\`。\n- 这类非阻塞问题只能写进状态收尾结论的“后续建议”或普通补充观察，不要放进“结论”主项，不要渲染成阻塞项。`);
    }

    if (this.currentRunId) {
      parts.push([
        '\n# 步骤结论归档协议',
        conclusionScope,
        '步骤成果详细总结与步骤结论是两种不同输出。',
        '步骤成果详细总结请按时间戳前缀命名写入 outputs 目录；步骤结论必须放在回复末尾的 <step-conclusion> 中。',
        '如果本步骤还需输出流程裁决 JSON，顺序必须是：裁决 JSON -> <step-conclusion>。',
        '请在回复末尾单独输出 <step-conclusion>，里面只写可被下一状态或后续 agent 直接复用的步骤结论，不要包含完整过程日志、命令回显、长篇原始证据或重复上下文。',
        '步骤结论必须自包含：下一步 agent 不读完整对话时，也能知道本步骤做了什么、改了哪里、验证到什么程度、还剩什么风险。',
        '建议结构:',
        '<step-conclusion>',
        '## 结果 / 裁决',
        resultGuidance,
        '## 下一步所需上下文',
        '- 后续 agent 必须继承的事实、决策、约束、假设和用户确认点。',
        '## 涉及对象',
        '- 读取、修改或重点审查过的文件、符号、配置项、API、状态字段或制品路径。',
        '## 验证状态',
        '- 已运行的命令、人工检查或替代证据；如果未验证，说明原因和影响。',
        '## 未决问题 / 风险',
        '- 仍阻塞、待确认、兼容风险、失败路径或需要 owner/Supervisor 决策的事项；没有则写“无”。',
        '## 下一步建议',
        '- 建议下一个 agent 直接执行的最小动作，避免泛泛而谈。',
        '</step-conclusion>',
      ].join('\n'));
    }

    // Add workflow-level and current Agent skills. Step-level skills are deprecated.
    const promptRoleConfig = this.agentConfigs.find((r) => r.name === step.agent)
      || config.roles?.find((r) => r.name === step.agent);
    const allSkillNames: string[] = [];
    if (config.context?.skills) allSkillNames.push(...config.context.skills);
    if (Array.isArray((promptRoleConfig as any)?.skills)) allSkillNames.push(...(promptRoleConfig as any).skills);
    if (allSkillNames.length > 0 && config.context?.projectRoot) {
      const skillsAbsPath = await getRuntimeSkillsDirPath();
      const uniqueSkillNames = [...new Set(allSkillNames)];
      const skillLines = uniqueSkillNames.map((name) => {
        const source = (promptRoleConfig as any)?.skills?.includes(name) ? 'agent.skills' : 'workflow.context.skills';
        return `- ${name} (${source}): \`${skillsAbsPath}/${name}/SKILL.md\``;
      }).join('\n');
      const rules = memo.skillRulesShown
        ? ''
        : '\n首次使用某个 Skill 前，必须先读取其 SKILL.md，按其中命令和约束执行；不要自行猜测命令参数。\n';
      memo.skillRulesShown = true;
      const dbPrompt = buildDatabaseCapabilityPrompt(this.runtimeDatabaseGrant, skillsAbsPath);
      const newSkillNames = uniqueSkillNames.filter((name) => !memo.skillContentSeen.has(name));
      const additionalSkills = newSkillNames.length > 0
        ? await this.loadAdditionalSkills(newSkillNames, config.context.projectRoot)
        : '';
      parts.push(`\n# 必须使用的 Skills${rules}\n${skillLines}`);
      if (dbPrompt && !memo.skillContentSeen.has('__aceharness_database_capabilities__')) {
        parts.push(dbPrompt);
        memo.skillContentSeen.add('__aceharness_database_capabilities__');
      }
      if (Array.isArray((promptRoleConfig as any)?.ragKnowledgeBases) && (promptRoleConfig as any).ragKnowledgeBases.length > 0) {
        parts.push(`当前 Agent 关联的 RAG 知识库：${(promptRoleConfig as any).ragKnowledgeBases.join(', ')}。需要查资料时优先使用 aceharness-rag 检索这些知识库。`);
      }
      if (additionalSkills) {
        parts.push(`以下是本 agent 首次遇到的 Skill 说明；后续重复步骤只会给路径引用。\n\n${additionalSkills}`);
      }
      newSkillNames.forEach((name) => memo.skillContentSeen.add(name));
    }

    // Add live feedback
    if (this.liveFeedback.length > 0) {
      parts.push(`\n# 实时反馈`);
      for (const feedback of this.liveFeedback) {
        parts.push(`- ${feedback.message}`);
      }
    }

    // Add state history
    if (this.stateHistory.length > 0) {
      const recent = this.stateHistory.slice(-5);
      const stateHistoryKey = promptContentKey(JSON.stringify(recent));
      if (memo.stateHistoryKey !== stateHistoryKey) {
        parts.push(`\n# 状态转移历史`);
        for (const record of recent) {
          parts.push(`- ${record.from} → ${record.to}: ${record.reason}`);
        }
        memo.stateHistoryKey = stateHistoryKey;
      }

      // Extract human instruction from the most recent transition (if any)
      const lastTransition = this.stateHistory[this.stateHistory.length - 1];
      if (lastTransition?.reason?.includes('附加指令:')) {
        const instructionMatch = lastTransition.reason.match(/附加指令:\s*(.+)$/);
        if (instructionMatch) {
          parts.push(`\n# ⚠️ 人工指令（必须遵守）\n${instructionMatch[1]}`);
        }
      }
    }

    // Add recent issues
    if (this.issueTracker.length > 0) {
      parts.push(`\n# 已发现的问题`);
      const recent = this.issueTracker.slice(-10);
      for (const issue of recent) {
        parts.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
      }
    }

    // Add preCommands output (if any)
    if (this.lastPreCommandOutput) {
      const raw = this.lastPreCommandOutput;
      const maxLen = 4000;
      const display = raw.length > maxLen
        ? '...(截断，保留结尾)...\n' + raw.slice(-maxLen)
        : raw;
      parts.push(`\n# 预执行命令结果（系统自动执行，必须据此做出裁决）\n${display}`);
    }

    if (this.currentConfigFile) {
      const experiences = await findRelevantWorkflowExperiences({
        configFile: this.currentConfigFile,
        workflowName: config.workflow?.name,
        requirements: config.context?.requirements,
        projectRoot: this.getWorkingDirectory() || config.context?.projectRoot,
        limit: 3,
        excludeRunId: this.currentRunId || undefined,
      }).catch(() => []);
      const block = buildWorkflowExperiencePromptBlock(experiences, '历史经验记忆');
      if (block) {
        parts.push(`\n${block}`);
      }
    }

    // Add previous steps' conclusions from the last 2 completed states
    if (this.currentRunId && this.stateHistory.length > 0) {
      try {
        const outputs = await loadStepOutputs(this.currentRunId);
        // Find the last 2 states before current
        const previousStates: string[] = [];
        for (let i = this.stateHistory.length - 1; i >= 0 && previousStates.length < 2; i--) {
          const from = this.stateHistory[i].from;
          if (from !== '__origin__' && from !== '__human_approval__' && !previousStates.includes(from)) {
            previousStates.push(from);
          }
        }

        const conclusions: string[] = [];
        for (const prevState of previousStates) {
          // Find outputs matching this state (format: "stateName-stepName")
          const stateOutputs = Object.entries(outputs)
            .filter(([key]) => key.startsWith(`${prevState}-`));
          for (const [stepKey, content] of stateOutputs) {
            // Truncate to last 2000 chars to avoid prompt bloat
            const truncated = content.length > 2000
              ? '...(截断)\n' + content.slice(-2000)
              : content;
            conclusions.push(`## ${stepKey}\n${truncated}`);
          }
        }

        if (conclusions.length > 0) {
          parts.push(`\n# 前置步骤结论\n以下是之前步骤的产出，请参考：\n`);
          parts.push(conclusions.join('\n\n'));
        }
      } catch { /* non-critical */ }
    }

    // ========== Supervisor-Lite: 注入可选的下一状态 ==========
    if (state.transitions && state.transitions.length > 0) {
      parts.push(`\n# 可选的下一状态`);
      for (const t of state.transitions) {
        const targetState = config.workflow.states.find(s => s.name === t.to);
        parts.push(`- ${t.to}: ${targetState?.description || '无描述'}`);
      }
    }

    // ========== Supervisor-Lite: 注入额外上下文（信息收集循环） ==========
    if (extraContext) {
      parts.push(`\n# 补充信息\n${extraContext}`);
    }

    // Replace template variables
    let result = parts.join('\n');
    if (this.currentRunId) {
      result = result.replace(/\{runId\}/g, this.currentRunId);
    }
    return result;
  }

  /**
   * 在后端直接执行 preCommands（如 build.sh / 测试命令），并收集 stdout/stderr。
   * 命令串行执行，即使命令失败也不会抛出异常，而是把失败信息写入返回文本中。
   */
  private async runPreCommands(
    commands: string[],
    config: StateMachineWorkflowConfig,
    meta?: { stateName: string; stepName: string; agent: string }
  ): Promise<{ text: string; qualityCheck?: PersistedQualityCheck }> {
    const { exec } = await import('child_process');
    const cwd = config.context?.projectRoot
      ? this.resolveProjectRootPath(config.context.projectRoot)
      : this.resolveProjectRootPath();

    const results: string[] = [];
    const commandResults: PersistedQualityCommandResult[] = [];

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      results.push(`\n[${i + 1}] $ ${cmd}\n工作目录: ${cwd}\n`);
      const { stdout, stderr, exitCode, errorText } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
        errorText: string | null;
      }>((resolveInner) => {
        const child = exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, so, se) => {
          const code = (error as any)?.code ?? 0;
          resolveInner({
            stdout: so ?? '',
            stderr: se ?? '',
            exitCode: Number.isInteger(code) ? (code as number) : 0,
            errorText: error ? String(error) : null,
          });
        });
        // 避免悬挂：如果 exec 抛出同步异常
        child.on('error', (err) => {
          resolveInner({
            stdout: '',
            stderr: '',
            exitCode: null,
            errorText: String(err),
          });
        });
      });

      const truncate = (text: string, max: number) => {
        if (!text) return '';
        return text.length > max ? text.slice(0, max) + '\n...(截断)...' : text;
      };

      results.push(`exitCode: ${exitCode ?? 'unknown'}\n`);
      if (errorText) {
        results.push(`exec error: ${truncate(errorText, 1000)}\n`);
      }
      if (stdout) {
        results.push(`--- stdout ---\n${truncate(stdout, 4000)}\n`);
      }
      if (stderr) {
        results.push(`--- stderr ---\n${truncate(stderr, 4000)}\n`);
      }

      const category = this.classifyQualityCommand(cmd);
      const status = exitCode === 0 ? 'passed' : exitCode === null ? 'warning' : 'failed';
      commandResults.push({
        command: cmd,
        exitCode,
        status,
        stdout: truncate(stdout, 800),
        stderr: truncate(stderr, 800),
        errorText,
      });
    }

    let qualityCheck: PersistedQualityCheck | undefined;
    if (meta) {
      const failed = commandResults.filter((item) => item.status === 'failed').length;
      const warned = commandResults.filter((item) => item.status === 'warning').length;
      const categories = [...new Set(commandResults.map((item) => this.classifyQualityCommand(item.command)))];
      const category = categories.includes('lint')
        ? 'lint'
        : categories.includes('compile')
          ? 'compile'
          : categories.includes('test')
            ? 'test'
            : 'custom';
      const status = failed > 0 ? 'failed' : warned > 0 ? 'warning' : 'passed';
      qualityCheck = {
        id: `${meta.stateName}-${meta.stepName}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        stateName: meta.stateName,
        stepName: meta.stepName,
        agent: meta.agent,
        category,
        status,
        summary: failed > 0
          ? `${commands.length} 条预命令中有 ${failed} 条失败`
          : warned > 0
            ? `${commands.length} 条预命令执行完成，但有 ${warned} 条警告`
            : `${commands.length} 条预命令全部通过`,
        createdAt: new Date().toISOString(),
        commands: commandResults,
      };
      this.recordQualityCheck(qualityCheck);
    }

    return { text: results.join('\n'), qualityCheck };
  }

  private classifyQualityCommand(command: string): 'lint' | 'compile' | 'test' | 'custom' {
    const normalized = command.toLowerCase();
    if (/eslint|lint|cjlint/.test(normalized)) return 'lint';
    if (/tsc|build|compile|cjc|cjpm build|make/.test(normalized)) return 'compile';
    if (/test|pytest|jest|vitest|cjpm test/.test(normalized)) return 'test';
    return 'custom';
  }

  private recordQualityCheck(check: PersistedQualityCheck): void {
    const idx = this.qualityChecks.findIndex((item) => item.id === check.id);
    if (idx >= 0) {
      this.qualityChecks[idx] = check;
    } else {
      this.qualityChecks.push(check);
    }
  }

  private async runAgentStep(
    step: WorkflowStep,
    context: string,
    config: StateMachineWorkflowConfig,
    stepId?: string
  ): Promise<{ output: string; lastRoundOutput: string; costUsd: number; durationMs: number; sessionId?: string; tokenUsage: TokenUsage }> {
    // Find agent config for system prompt and model
    const roleConfig = this.agentConfigs.find(r => r.name === step.agent)
      || config.roles?.find(r => r.name === step.agent);

    const runtimeAgentName = getStepRuntimeAgentName(step);
    const selection = resolveAgentEngineSelection(roleConfig, config.context);
    const engineType = selection.engine;
    const model = selection.model;
    const agent = this.agents.find(a => a.name === runtimeAgentName);
    if (agent) {
      agent.engine = engineType;
      agent.model = model;
    }
    const systemPrompt = roleConfig?.systemPrompt || `你是一个 ${step.role || 'assistant'} 角色的 AI 助手。`;
    const workingDirectory = config.context?.projectRoot
      ? this.resolveProjectRootPath(config.context.projectRoot)
      : this.resolveProjectRootPath();
    const timeoutMs = (config.context?.timeoutMinutes || 60) * 60 * 1000;

    let currentProcessId = stepId || randomUUID();
    const compactedExecution = await this.autoCompactAgentContextIfNeeded({
      agentName: runtimeAgentName,
      stepName: this.currentState ? `${this.currentState} / ${step.name}` : step.name,
      workflowConfig: config,
      prompt: context,
      systemPrompt,
      model,
      workingDirectory,
      timeoutMs,
    });
    let currentPrompt = compactedExecution.prompt;
    // Reuse session from same agent if available (saves tokens, preserves memory)
    let currentSessionId: string | undefined = compactedExecution.sessionId;
    let accumulatedOutput = '';
    let lastRoundOutput = '';
    let accumulatedStreamPreview = '';
    let streamHasMeaningfulOutput = false;
    let currentProcessStreamLength = 0;
    let accumulatedCost = 0;
    let accumulatedDuration = 0;
    let autoRecoveryAttempts = 0;
    let transientEngineRetryAttempts = 0;
    const accumulatedTokenUsage: TokenUsage = toPersistedTokenUsage(ZERO_ENGINE_USAGE);

    // Use state-prefixed step name so frontend stream polling matches persisted stream files
    const streamStepName = this.currentState ? `${this.currentState}-${step.name}` : step.name;

    // Track process
    this.upsertCurrentProcess({
      pid: Date.now(),
      id: currentProcessId,
      agent: runtimeAgentName,
      step: streamStepName,
      stepId,
      startTime: new Date().toISOString(),
    });
    await this.persistState();

    const appendStreamPreview = (text: string) => {
      if (!text) return;
      streamHasMeaningfulOutput = streamHasMeaningfulOutput || hasMeaningfulAiOutput(text);
      accumulatedStreamPreview = appendRuntimeOutputPreview(accumulatedStreamPreview, text).output;
    };

    const flushProcessStream = (content?: string | null) => {
      if (!this.currentRunId || !content || content.length < currentProcessStreamLength) return;
      const delta = content.slice(currentProcessStreamLength);
      if (!delta) return;
      currentProcessStreamLength = content.length;
      appendStreamPreview(delta);
      appendStreamContent(this.currentRunId, streamStepName, delta).catch(() => {});
    };

    const appendFeedbackMarker = (feedbackPrompt: string) => {
      if (!this.currentRunId) return;
      appendFeedbackToStream(this.currentRunId, streamStepName, feedbackPrompt).catch(() => {});
    };

    // Set up periodic stream content flushing to disk (so frontend can read it)
    let lastFlush = 0;
    let lastStreamAt = Date.now();
    let watchdogTriggeredForProcess = '';
    let trailingFlushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushLatestProcessStream = () => {
      if (!this.currentRunId) return;
      const proc = processManager.getProcess(currentProcessId);
      const content = proc?.streamContent || '';
      if (!content) return;
      flushProcessStream(content);
      lastFlush = Date.now();
    };
    const scheduleTrailingFlush = (delayMs: number) => {
      if (trailingFlushTimer) return;
      trailingFlushTimer = setTimeout(() => {
        trailingFlushTimer = null;
        flushLatestProcessStream();
      }, Math.max(50, delayMs));
    };
    const streamFlushHandler = (data: { id: string; step: string; total?: string; delta?: string }) => {
      if (data.id !== currentProcessId) return;
      const now = Date.now();
      const proc = processManager.getProcess(currentProcessId);
      const content = proc?.streamContent || data.total || '';
      const hasVisibleOutputChange = Boolean(data.delta) || content.length > currentProcessStreamLength;
      if (hasVisibleOutputChange) {
        lastStreamAt = now;
        watchdogTriggeredForProcess = '';
      }
      if (this.currentRunId && now - lastFlush > 2000) {
        lastFlush = now;
        if (content) {
          flushProcessStream(content);
        }
      } else if (this.currentRunId && content) {
        scheduleTrailingFlush(2000 - (now - lastFlush));
      }
    };
    processManager.on('stream', streamFlushHandler);
    const idleWatchdog = setInterval(() => {
      if (!currentProcessId || this.shouldStop || this.interruptFlag) return;
      if (watchdogTriggeredForProcess === currentProcessId) return;
      if (Date.now() - lastStreamAt < STREAM_IDLE_INTERRUPT_MS) return;
      const proc = processManager.getProcess(currentProcessId);
      if (!proc || proc.status !== 'running') return;
      watchdogTriggeredForProcess = currentProcessId;
      this.queueLiveFeedback(AUTO_CONTINUE_FEEDBACK, { automatic: true });
      this.interruptFlag = true;
      this.feedbackInterrupt = true;
      this.cancelCurrentProcesses();
    }, STREAM_IDLE_CHECK_MS);

    // Feedback loop: run agent, handle interrupts and pending feedback
    try {
    while (true) {
      // Check if workflow was stopped
      if (this.shouldStop) {
        throw new Error('工作流已停止');
      }
      let result: EngineJsonResult;
      try {
        result = await this.executeWithEngine(
          currentProcessId,
          runtimeAgentName,
          step.name,
          currentPrompt,
          systemPrompt,
          model,
          {
            workingDirectory,
            timeoutMs,
            runId: this.currentRunId || undefined,
            stepId,
            resumeSessionId: currentSessionId,
            appendSystemPrompt: !!currentSessionId,
            streamStepName,
            engineType,
            mcpServers: this.getEffectiveMcpServers(roleConfig),
          }
        );
      } catch (err) {
        // If force transition killed the process, return partial output and let main loop handle it
        if (this.pendingForceTransition) {
          console.log(`[SM-ForceTransition] 进程被强制跳转终止，目标: ${this.pendingForceTransition}`);
          const proc = processManager.getProcess(currentProcessId);
          if (proc?.streamContent) {
            flushProcessStream(proc.streamContent);
          }
          if (this.currentRunId) {
            appendStreamContent(this.currentRunId, streamStepName, '\n\n<!-- chunk-boundary -->\n\n').catch(() => {});
          }
          return {
            output: accumulatedOutput || '(强制跳转，步骤未完成)',
            lastRoundOutput: '',
            costUsd: accumulatedCost,
            durationMs: accumulatedDuration,
            tokenUsage: accumulatedTokenUsage,
          };
        }
        // If interrupted with feedback, resume with feedback
        if (this.interruptFlag && this.liveFeedback.length > 0) {
          const isFeedbackOnly = this.feedbackInterrupt;
          this.interruptFlag = false;
          this.feedbackInterrupt = false;
          const proc = processManager.getProcess(currentProcessId);
          if (proc?.streamContent) {
            flushProcessStream(proc.streamContent);
          }
          const sessionId = proc?.sessionId;

          const { entries: feedbackEntries, prompt: feedbackPrompt } = this.consumeLiveFeedback();
          const feedbackTimestamp = new Date().toISOString();
          appendFeedbackMarker(feedbackPrompt);
          // If we have a session, resume it; otherwise start fresh with feedback prepended
          currentSessionId = sessionId || undefined;
          currentPrompt = isFeedbackOnly
            ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
            : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          if (!sessionId) {
            // No session yet — prepend original context so the agent has full info
            currentPrompt = context + '\n\n' + currentPrompt;
          }
          currentProcessId = stepId || currentProcessId;
          currentProcessStreamLength = 0;
          lastStreamAt = Date.now();
          watchdogTriggeredForProcess = '';
          this.upsertCurrentProcess({
            pid: Date.now(),
            id: currentProcessId,
            agent: runtimeAgentName,
            step: streamStepName,
            stepId,
            startTime: new Date().toISOString(),
          });
          this.emit('step-start', {
            state: this.currentState,
            step: streamStepName,
            agent: runtimeAgentName,
          });
          this.emitLiveFeedbackStatus(feedbackEntries, 'delivered', feedbackTimestamp);
          continue;
        }
        throw err;
      }

      // Accumulate stream content
      const proc = processManager.getProcess(currentProcessId);
      if (proc?.streamContent) {
        flushProcessStream(proc.streamContent);
      }

      if (result.is_error && this.interruptFlag && this.liveFeedback.length > 0 && !this.shouldStop) {
        const isFeedbackOnly = this.feedbackInterrupt;
        this.interruptFlag = false;
        this.feedbackInterrupt = false;
        const { entries: feedbackEntries, prompt: feedbackPrompt } = this.consumeLiveFeedback();
        const feedbackTimestamp = new Date().toISOString();
        appendFeedbackMarker(feedbackPrompt);
        const sessionId = result.session_id || currentSessionId;
        currentSessionId = sessionId || undefined;
        currentPrompt = isFeedbackOnly
          ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
          : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
        if (!sessionId) {
          currentPrompt = context + '\n\n' + currentPrompt;
        }
        currentProcessId = stepId || currentProcessId;
        currentProcessStreamLength = 0;
        lastStreamAt = Date.now();
        watchdogTriggeredForProcess = '';
        this.upsertCurrentProcess({
          pid: Date.now(),
          id: currentProcessId,
          agent: runtimeAgentName,
          step: streamStepName,
          stepId,
          startTime: new Date().toISOString(),
        });
        this.emit('step-start', {
          state: this.currentState,
          step: streamStepName,
          agent: runtimeAgentName,
        });
        this.emitLiveFeedbackStatus(feedbackEntries, 'delivered', feedbackTimestamp);
        continue;
      }

      if (result.is_error) {
        const errorMsg = result.result || '引擎执行失败（无输出）';
        if (isTransientEngineFailure(errorMsg) && transientEngineRetryAttempts < TRANSIENT_ENGINE_RETRY_MAX_ATTEMPTS) {
          transientEngineRetryAttempts += 1;
          const retryDelayMs = 1000 * transientEngineRetryAttempts;
          this.emit('log', {
            agent: runtimeAgentName,
            level: 'warning',
            message: `步骤 "${streamStepName}" 出现临时引擎异常，${retryDelayMs}ms 后重试 ${transientEngineRetryAttempts}/${TRANSIENT_ENGINE_RETRY_MAX_ATTEMPTS}: ${errorMsg}`,
          });
          await new Promise((resolveRetry) => setTimeout(resolveRetry, retryDelayMs));
          currentProcessId = stepId || currentProcessId;
          currentProcessStreamLength = 0;
          lastStreamAt = Date.now();
          watchdogTriggeredForProcess = '';
          continue;
        }
        if (!isRecoverableStepExecutionError(errorMsg)) {
          throw new Error(errorMsg);
        }

        if (autoRecoveryAttempts >= STEP_AUTO_RECOVERY_MAX_ATTEMPTS) {
          throw new Error(
            `引擎连续失败，已停止工作流：步骤 "${streamStepName}" 自动恢复 ${STEP_AUTO_RECOVERY_MAX_ATTEMPTS} 次后仍失败。最后错误：${errorMsg}`
          );
        }

        autoRecoveryAttempts += 1;
        const recoveryPrompt = buildStepAutoRecoveryPrompt({
          stateName: this.currentState,
          stepName: step.name,
          attempt: autoRecoveryAttempts,
          maxAttempts: STEP_AUTO_RECOVERY_MAX_ATTEMPTS,
          error: errorMsg,
        });
        const recoveryTimestamp = new Date().toISOString();
        appendFeedbackMarker(recoveryPrompt);

        const sessionId = result.session_id || currentSessionId;
        currentSessionId = sessionId || undefined;
        currentPrompt = sessionId ? recoveryPrompt : `${context}\n\n${recoveryPrompt}`;
        currentProcessId = stepId || currentProcessId;
        currentProcessStreamLength = 0;
        lastStreamAt = Date.now();
        watchdogTriggeredForProcess = '';
        this.upsertCurrentProcess({
          pid: Date.now(),
          id: currentProcessId,
          agent: runtimeAgentName,
          step: streamStepName,
          stepId,
          startTime: new Date().toISOString(),
        });
        this.emit('log', {
          agent: runtimeAgentName,
          level: 'warning',
          message: `步骤 "${streamStepName}" 出现可恢复错误，正在自动恢复 ${autoRecoveryAttempts}/${STEP_AUTO_RECOVERY_MAX_ATTEMPTS}: ${errorMsg}`,
        });
        continue;
      }

      if (autoRecoveryAttempts > 0) {
        autoRecoveryAttempts = 0;
      }
      if (transientEngineRetryAttempts > 0) {
        transientEngineRetryAttempts = 0;
      }
      const roundOutput = result.result || '';
      const humanHelpRequests = this.parseHumanHelpRequests(roundOutput, config);
      if (humanHelpRequests.length === 0) {
        accumulatedOutput += (accumulatedOutput ? '\n\n---\n\n' : '') + roundOutput;
        lastRoundOutput = roundOutput;
      }
      accumulatedCost += result.cost_usd || 0;
      accumulatedDuration += result.duration_ms || 0;
      const resultTokenUsage = toPersistedTokenUsage(result.usage || ZERO_ENGINE_USAGE);
      accumulatedTokenUsage.inputTokens += resultTokenUsage.inputTokens;
      accumulatedTokenUsage.outputTokens += resultTokenUsage.outputTokens;
      accumulatedTokenUsage.cacheCreationInputTokens = (accumulatedTokenUsage.cacheCreationInputTokens || 0) + (resultTokenUsage.cacheCreationInputTokens || 0);
      accumulatedTokenUsage.cacheReadInputTokens = (accumulatedTokenUsage.cacheReadInputTokens || 0) + (resultTokenUsage.cacheReadInputTokens || 0);

      // Always capture the latest session_id for reuse; clear if recovery could not produce one.
      currentSessionId = result.session_id || undefined;

      if (humanHelpRequests.length > 0 && !this.shouldStop) {
        const resumePrompt = await this.handleHumanHelpRequests({
          requests: humanHelpRequests,
          output: roundOutput,
          step,
          state: this.currentWorkflowConfig?.workflow?.states?.find((item) => item.name === this.currentState)
            || config.workflow.states.find((item) => (item.steps || []).some((stateStep) => stateStep === step || stateStep.name === step.name))
            || ({ name: this.currentState || '', steps: [step], transitions: [], isInitial: false, isFinal: false } as StateMachineState),
          config,
          runtimeAgentName,
        });
        if (resumePrompt) {
          appendFeedbackMarker(resumePrompt);
          currentPrompt = currentSessionId ? resumePrompt : `${context}\n\n${resumePrompt}`;
          currentProcessId = stepId || currentProcessId;
          currentProcessStreamLength = 0;
          lastStreamAt = Date.now();
          watchdogTriggeredForProcess = '';
          if (agent) {
            agent.status = 'running';
            agent.currentTask = step.name;
            this.emit('agents', { agents: this.agents });
          }
          this.upsertCurrentProcess({
            pid: Date.now(),
            id: currentProcessId,
            agent: runtimeAgentName,
            step: streamStepName,
            stepId,
            startTime: new Date().toISOString(),
          });
          this.emit('step-start', {
            state: this.currentState,
            step: streamStepName,
            agent: runtimeAgentName,
          });
          continue;
        }
      }

      // Check for pending live feedback after completion
      if (this.liveFeedback.length > 0 && !this.shouldStop) {
        const { entries: feedbackEntries, prompt: feedbackPrompt } = this.consumeLiveFeedback();
        const sessionId = result.session_id;
        if (!sessionId) break;

        const feedbackTimestamp = new Date().toISOString();
        appendFeedbackMarker(feedbackPrompt);
        currentSessionId = sessionId;
        currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
        currentProcessId = stepId || currentProcessId;
        currentProcessStreamLength = 0;
        lastStreamAt = Date.now();
        watchdogTriggeredForProcess = '';
        this.upsertCurrentProcess({
          pid: Date.now(),
          id: currentProcessId,
          agent: runtimeAgentName,
          step: streamStepName,
          stepId,
          startTime: new Date().toISOString(),
        });
        this.emitLiveFeedbackStatus(feedbackEntries, 'delivered', feedbackTimestamp);
        continue;
      }

      break;
    }
    } finally {
      if (trailingFlushTimer) {
        clearTimeout(trailingFlushTimer);
        trailingFlushTimer = null;
      }
      flushLatestProcessStream();
      clearInterval(idleWatchdog);
      processManager.off('stream', streamFlushHandler);
    }

    if (!hasMeaningfulAiOutput(accumulatedOutput) && !streamHasMeaningfulOutput) {
      throw new Error(`AI 服务中断：步骤 "${streamStepName}" 未产生任何输出`);
    }

    return {
      output: accumulatedOutput || accumulatedStreamPreview,
      lastRoundOutput,
      costUsd: accumulatedCost,
      durationMs: accumulatedDuration,
      sessionId: currentSessionId,
      tokenUsage: accumulatedTokenUsage,
    };
  }

  private async evaluateTransitions(
    transitions: StateTransition[],
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    // Check for pending forced transition (human override)
    if (this.pendingForceTransition) {
      const target = this.pendingForceTransition;
      this.pendingForceTransition = null;
      this.emit('transition-forced', { from: result.stateName, to: target });
      await this.appendSupervisorChatEvent({
        type: 'human-answer',
        title: `人工指定下一状态：${target}`,
        body: this.pendingForceInstruction || `从「${result.stateName}」转入「${target}」。`,
        speakerName: '你',
        speakerType: 'human',
        dedupeKey: `workflow-forced-transition-${this.currentRunId || this.currentConfigFile}-${result.stateName}-${target}-${Date.now()}`,
      });
      return target;
    }

    // AI-suggested next_state is only accepted when it is one of the configured
    // fallback targets for the emitted verdict.
    const aiSuggestedState = this.parseNextStateFromOutputs(result.stepOutputs, config);
    const configuredSuggestedTarget = aiSuggestedState
      ? transitions.some((transition) => (
          transition.to === aiSuggestedState
          && this.matchCondition(transition.condition, result)
          && !hasAdvancedTransitionCondition(transition)
        ))
      : false;
    if (aiSuggestedState && configuredSuggestedTarget) {
      return aiSuggestedState;
    }

    // Sort by priority (lower number = higher priority)
    const sorted = [...transitions].sort((a, b) => a.priority - b.priority);

    for (const transition of sorted) {
      if (this.matchCondition(transition.condition, result)) {
        return transition.to;
      }
    }

    // conditional_pass without explicit rule → self-transition (continue iterating)
    if (result.verdict === 'conditional_pass') {
      this.emit('escalation', {
        state: result.stateName,
        reason: `有条件通过 (conditional_pass)，继续迭代当前状态`,
        result,
      });
      return result.stateName;
    }

    // No matching transition - wait for human decision instead of crashing
    const configuredVerdicts = [...new Set(
      transitions
        .map((transition) => transition.condition?.verdict)
        .filter((verdict): verdict is 'pass' | 'conditional_pass' | 'fail' => Boolean(verdict))
    )];
    this.emit('escalation', {
      state: result.stateName,
      reason: `没有匹配的状态转移规则 (verdict: ${result.verdict}，已配置 verdict: ${configuredVerdicts.join(', ') || '无'})，等待人工决策`,
      result,
    });

    // Enter human approval mode so user can force-transition
    this.pendingApprovalInfo = {
      suggestedNextState: transitions[0]?.to || result.stateName,
      availableStates: config.workflow.states.map(s => s.name),
      result,
    };

    const humanQuestion = await this.createHumanQuestion({
      kind: 'approval',
      title: '需要人工选择下一状态',
      message: `verdict "${result.verdict}" 没有匹配的转移规则。当前状态应至少配置 pass / conditional_pass / fail 三条路径；如需继续，请人工选择下一步状态。`,
      currentState: result.stateName,
      suggestedNextState: transitions[0]?.to || result.stateName,
      availableStates: config.workflow.states.map(s => s.name),
      result,
      requiresWorkflowPause: true,
      answerSchema: {
        type: 'approval-transition',
        required: true,
        options: config.workflow.states.map(s => ({ label: s.name, value: s.name })),
      },
      source: { type: 'human-approval', reason: 'no-matching-transition' },
    });

    this.emit('human-approval-required', {
      currentState: result.stateName,
      suggestedNextState: transitions[0]?.to || result.stateName,
      result,
      availableStates: config.workflow.states.map(s => s.name),
      reason: `verdict "${result.verdict}" 没有匹配的转移规则，当前状态应配置完整三路 verdict 转移`,
      humanQuestion,
    });

    // Wait for human to force-transition
    await this.waitForHumanApproval();

    const humanSelectedState = this.pendingForceTransition || transitions[0]?.to || result.stateName;
    this.pendingForceTransition = null;
    this.pendingApprovalInfo = null;
    return humanSelectedState;
  }

  private matchCondition(
    condition: TransitionCondition,
    result: StateExecutionResult
  ): boolean {
    // Check verdict match (strict — no fallback for conditional_pass)
    if (condition.verdict && result.verdict !== condition.verdict) {
      return false;
    }

    // Check issue types
    if (condition.issueTypes && condition.issueTypes.length > 0) {
      const hasMatchingType = result.issues.some(
        issue => condition.issueTypes!.includes(issue.type)
      );
      if (!hasMatchingType) return false;
    }

    // Check severities
    if (condition.severities && condition.severities.length > 0) {
      const hasMatchingSeverity = result.issues.some(
        issue => condition.severities!.includes(issue.severity)
      );
      if (!hasMatchingSeverity) return false;
    }

    // Check issue count
    if (condition.minIssueCount !== undefined) {
      if (result.issues.length < condition.minIssueCount) return false;
    }
    if (condition.maxIssueCount !== undefined) {
      if (result.issues.length > condition.maxIssueCount) return false;
    }

    return true;
  }

  private parseNextStateFromOutputs(
    stepOutputs: string[],
    config: StateMachineWorkflowConfig
  ): string | null {
    const validStates = new Set(config.workflow.states.map(s => s.name));
    // Check outputs in reverse order (last judge output takes precedence)
    for (const output of [...stepOutputs].reverse()) {
      const parsed = this.extractJsonObject(output);
      if (parsed?.next_state && validStates.has(parsed.next_state)) {
        return parsed.next_state;
      }
    }
    return null;
  }

  private assertRequiredVerdictTransitions(config: StateMachineWorkflowConfig): void {
    const requiredVerdicts = ['pass', 'conditional_pass', 'fail'] as const;
    const invalidStates: string[] = [];

    for (const state of config.workflow.states || []) {
      if (state.isFinal) continue;
      const transitions = Array.isArray(state.transitions) ? state.transitions : [];
      const verdicts = transitions
        .map((transition) => transition.condition?.verdict)
        .filter((verdict): verdict is typeof requiredVerdicts[number] => requiredVerdicts.includes(verdict as any));

      const extras = transitions.filter((transition) => !requiredVerdicts.includes(transition.condition?.verdict as any));
      const missing = requiredVerdicts.filter((verdict) => !verdicts.includes(verdict));
      const duplicated = requiredVerdicts.filter((verdict) => verdicts.filter((item) => item === verdict).length > 1);

      if (extras.length > 0 || missing.length > 0 || duplicated.length > 0) {
        const parts: string[] = [];
        if (missing.length > 0) parts.push(`缺少 ${missing.join(', ')}`);
        if (duplicated.length > 0) parts.push(`${duplicated.join(', ')} 重复`);
        if (extras.length > 0) parts.push('存在未绑定 verdict 的额外转移');
        invalidStates.push(`${state.name}（${parts.join('；')}）`);
      }
    }

    if (invalidStates.length > 0) {
      throw new Error(`状态机运行前校验失败：非终止状态必须完整配置 pass / conditional_pass / fail 三条转移路径。异常状态：${invalidStates.join('；')}`);
    }
  }

  private parseIssuesFromOutput(
    output: string,
    step: WorkflowStep,
    stateName: string
  ): Issue[] {
    const issues: Issue[] = [];

    // Try to parse JSON block
    const parsed = this.extractJsonObject(output);
    if (parsed?.issues && Array.isArray(parsed.issues)) {
      for (const issue of parsed.issues) {
        if (!issue.description?.trim()) continue;
        issues.push({
          type: issue.type || 'implementation',
          severity: issue.severity || 'minor',
          description: issue.description.trim(),
          foundInState: stateName,
          foundByAgent: step.agent,
        });
      }
    }

    return issues;
  }

  private parseVerdict(output: string): 'pass' | 'conditional_pass' | 'fail' {
    // Empty judge output is invalid for transition decisions.
    // Treat as fail to prevent conditional_pass self-loop token burn.
    if (!output || !output.trim()) {
      return 'fail';
    }

    const parsed = this.extractJsonObject(output);
    if (parsed && ['pass', 'conditional_pass', 'fail'].includes(parsed.verdict)) {
      return parsed.verdict;
    }

    const conclusion = extractTaggedBlock(output, 'step-conclusion');
    const conclusionVerdict = conclusion ? this.parseVerdictFromConclusion(conclusion) : null;
    if (conclusionVerdict) {
      return conclusionVerdict;
    }

    // Fallback: check for keywords
    if (/\b(fail|失败|不通过)\b/i.test(output)) return 'fail';
    if (/\b(pass|通过|成功)\b/i.test(output)) return 'pass';
    return 'conditional_pass';
  }

  private parseVerdictFromConclusion(conclusion: string): 'pass' | 'conditional_pass' | 'fail' | null {
    const text = conclusion.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const verdictPattern = /(?:verdict|裁定|裁决|结果|结论|判断)\s*(?:为|是|:|：|=)?\s*`?\s*(conditional_pass|fail|pass|有条件通过|失败|不通过|通过|成功)\s*`?/i;
    const match = text.match(verdictPattern);
    if (!match) return null;
    const raw = match[1].toLowerCase();
    if (raw === 'fail' || raw === '失败' || raw === '不通过') return 'fail';
    if (raw === 'conditional_pass' || raw === '有条件通过') return 'conditional_pass';
    if (raw === 'pass' || raw === '通过' || raw === '成功') return 'pass';
    return null;
  }

  private getTransitionReason(result: StateExecutionResult): string {
    if (result.verdict === 'pass') {
      return '所有检查通过';
    } else if (result.issues.length > 0) {
      const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
      const majorCount = result.issues.filter(i => i.severity === 'major').length;
      return `发现 ${criticalCount} 个严重问题, ${majorCount} 个主要问题`;
    }
    return '条件性通过';
  }

  private generateStateSummary(state: StateMachineState, issues: Issue[]): string {
    const parts: string[] = [];
    parts.push(`状态 ${state.name} 执行完成`);
    parts.push(`执行了 ${state.steps.length} 个步骤`);
    if (issues.length > 0) {
      parts.push(`发现 ${issues.length} 个问题`);
    }
    return parts.join(', ');
  }

  // ========== Resume functionality ==========
  async recoverFromCrash(): Promise<void> {
    // Find any crashed runs and attempt to recover
    const runningRuns = await loadRunState(this.currentRunId || '').catch(() => null);
    if (!runningRuns) return;

    if (runningRuns.status === 'running' && runningRuns.mode === 'state-machine') {
      try {
        await this.resume(runningRuns.runId);
      } catch (error) {
      }
    }
  }

  async resume(runId: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    await this.restoreRunStateForContinuation(runState);

    this.emit('status', {
      status: 'running',
      message: '恢复运行中...',
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: this.currentState,
      currentStep: this.currentStep,
      currentConfigFile: this.currentConfigFile,
      workingDirectory: this.getWorkingDirectory(),
      workflowFrontendSessionId: this._frontendSessionId || null,
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configContent = await this.readWorkflowConfigContent(runState.configFile);
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.currentProjectRoot = runState.workingDirectory || workflowConfig.context?.projectRoot || null;
    if (runState.workingDirectory) {
      workflowConfig.context.projectRoot = runState.workingDirectory;
    }
    this.currentWorkflowConfig = workflowConfig;
    const resumeStepKey = this.getResumeStepKeyForRun(runState, workflowConfig);
    if (resumeStepKey && this.currentState) {
      this.resumeStateName = this.currentState;
      this.resumeStepKey = resumeStepKey;
      this.currentStep = resumeStepKey;
      this.emit('status', {
        status: 'running',
        message: `恢复运行：将从步骤 ${resumeStepKey} 继续`,
        runId: this.currentRunId,
        startTime: this.runStartTime,
        endTime: this.runEndTime,
        currentPhase: this.currentState,
        currentStep: this.currentStep,
        currentConfigFile: this.currentConfigFile,
        workingDirectory: this.getWorkingDirectory(),
        workflowFrontendSessionId: this._frontendSessionId || null,
      });
      await this.persistState();
    }
    this.workflowMcpServers = [];
    this.currentSupervisorAgent = runState.supervisorAgent || resolveWorkflowSupervisorAgent(workflowConfig);

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.ensureSupervisorAgentExists(workflowConfig);
    this.initializeAgents(workflowConfig);
    for (const persistedAgent of runState.agents || []) {
      const agent = this.agents.find((item) => item.name === persistedAgent.name);
      if (agent && persistedAgent.sessionId) {
        agent.sessionId = persistedAgent.sessionId;
      }
    }

    // Initialize engine
    await this.initializeEngine(resolveWorkflowExecutionPolicy(workflowConfig.context).defaultEngine || workflowConfig.context?.engine);
    await this.resolveWorkflowMcpServers(workflowConfig);
    if (workflowConfig.context?.gitBaselineEnabled !== false) {
      await this.ensureWorkflowGitBaseline(workflowConfig.context?.projectRoot || runState.workingDirectory);
    } else {
      await this.disableWorkflowGitBaseline(workflowConfig.context?.projectRoot || runState.workingDirectory);
    }

    // If resuming from __human_approval__, restore the approval wait flow
    if (this.currentState === '__human_approval__') {
      const availableStates = workflowConfig.workflow.states.map(s => s.name);
      // Infer suggested next state from the last transition's "to" before __human_approval__
      const lastTransition = this.stateHistory.filter(h => h.to === '__human_approval__').pop();
      const previousState = lastTransition?.from;
      // Find the state config that triggered approval, use its first transition target as suggestion
      const prevStateConfig = previousState
        ? workflowConfig.workflow.states.find(s => s.name === previousState)
        : null;
      const suggestedNextState = prevStateConfig?.transitions?.[0]?.to || availableStates[0] || '';
      const restoredApprovalResult = runState.pendingCheckpoint?.result || { issues: [] };

      this.pendingApprovalInfo = {
        suggestedNextState,
        availableStates,
        result: restoredApprovalResult,
        supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
      };

      if (!this.getPendingHumanQuestion() && runState.pendingCheckpoint?.humanQuestion) {
        const restoredQuestion = runState.pendingCheckpoint.humanQuestion;
        this.humanQuestions = [
          { ...restoredQuestion, status: 'unanswered' as const, runId, configFile: runState.configFile },
          ...this.humanQuestions.filter((item) => item.id !== restoredQuestion.id),
        ];
        this.pendingHumanQuestionId = restoredQuestion.id;
      }
      if (!this.getPendingHumanQuestion()) {
        const restoredQuestion = await this.createHumanQuestion({
          kind: 'approval',
          title: '等待人工审查',
          message: runState.pendingCheckpoint?.supervisorAdvice || `请确认下一步状态：${suggestedNextState}`,
          supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
          currentState: '__human_approval__',
          previousState,
          suggestedNextState,
          availableStates,
          result: restoredApprovalResult,
          requiresWorkflowPause: true,
          answerSchema: {
            type: 'approval-transition',
            required: true,
            options: availableStates.map(s => ({ label: s, value: s })),
          },
          source: { type: 'human-approval', restored: true },
        });
        if (restoredQuestion?.id) this.pendingHumanQuestionId = restoredQuestion.id;
      }
      const pendingHumanQuestion = this.getPendingHumanQuestion();

      this.emit('state-change', {
        state: '__human_approval__',
        message: '等待人工审查决策',
      });

      const humanApprovalPayload = {
        runId: this.currentRunId,
        rootRunId: this.rootRunId || this.currentRunId,
        configFile: this.currentConfigFile,
        currentConfigFile: this.currentConfigFile,
        runOwnerId: this._createdBy,
        createdBy: this._createdBy,
        workflowFrontendSessionId: this._frontendSessionId || null,
        currentState: '__human_approval__',
        nextState: suggestedNextState,
        suggestedNextState,
        result: restoredApprovalResult,
        availableStates,
        supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
        humanQuestion: pendingHumanQuestion,
      };
      this.emit('human-approval-required', humanApprovalPayload);
      void import('@/lib/channel/delivery')
        .then((mod) => mod.deliverWorkflowEventToChannels('human-approval-required', humanApprovalPayload))
        .catch(() => {});

      if (pendingHumanQuestion) {
        this.emit('human-question-required', { question: pendingHumanQuestion, humanQuestions: this.humanQuestions });
      }

      // Wait for human decision
      await this.waitForHumanApproval();

      const humanSelectedState: string = this.pendingForceTransition || suggestedNextState;
      const instruction = this.pendingForceInstruction || '';
      this.pendingForceTransition = null;
      this.pendingForceInstruction = null;
      this.pendingApprovalInfo = null;

      // Record transition from __human_approval__ to selected state
      this.stateHistory.push({
        from: '__human_approval__',
        to: humanSelectedState,
        reason: instruction
          ? `人工决策: 选择进入 ${humanSelectedState}，附加指令: ${instruction}`
          : `人工决策: 选择进入 ${humanSelectedState}`,
        issues: [],
        timestamp: new Date().toISOString(),
      });

      this.transitionCount++;
      this.emit('transition', {
        from: '__human_approval__',
        to: humanSelectedState,
        transitionCount: this.transitionCount,
        issues: [],
      });

      this.currentState = humanSelectedState;
    }

    // Continue execution from current state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          runId: this.currentRunId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'failed',
          message: error.message,
          runId: this.currentRunId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async restoreRunStateForContinuation(runState: PersistedRunState, targetState?: string): Promise<void> {
    await this.assertRestoredWorkflowSnapshot(runState);
    this.currentRunId = runState.runId;
    this.currentConfigFile = runState.configFile;
    this.rootRunId = runState.rootRunId || null;
    this.parentRunId = runState.parentRunId || null;
    this.parentConfigFile = runState.parentConfigFile || null;
    this.parentStateName = runState.parentStateName || null;
    this.parentStepId = runState.parentStepId || null;
    this.parentStepName = runState.parentStepName || null;
    this.nestingPath = runState.nestingPath?.length
      ? runState.nestingPath
      : [{ runId: runState.runId, configFile: runState.configFile, stepName: 'Root' }];
    this.subworkflowRuns = runState.subworkflowRuns || [];
    this.activeSubworkflowRunId = runState.activeSubworkflowRunId || null;
    this.subworkflowAuditEvents = runState.subworkflowAuditEvents || [];
    this.workflowSnapshotRoot = runState.workflowSnapshotRoot || null;
    this.workflowSnapshotManifestHash = runState.workflowSnapshotManifestHash || null;
    this._createdBy = runState.runOwnerId || runState.createdBy || this._createdBy;
    this._createdByName = runState.runOwnerName || runState.createdByName || this._createdByName;
    this._creationSessionId = runState.creationSessionId;
    const restoredFrontendSessionId = await this.resolveWorkflowFrontendSessionIdForRun(runState);
    this._frontendSessionId = restoredFrontendSessionId || undefined;
    this.currentRequirements = runState.requirements || '';
    this.currentState = targetState || runState.currentState || null;
    this.currentSupervisorAgent = runState.supervisorAgent || DEFAULT_SUPERVISOR_NAME;
    this.latestSupervisorReview = runState.latestSupervisorReview || null;
    this.humanQuestions = runState.humanQuestions || [];
    this.pendingHumanQuestionId = runState.pendingHumanQuestionId || runState.pendingCheckpoint?.humanQuestionId || null;
    this.humanAnswersContext = runState.humanAnswersContext || [];
    this.specRevisionVote = runState.specRevisionVote || null;
    this.specRevisionVoteHistory = runState.specRevisionVoteHistory || [];
    this.specRevisionVoteTail = Promise.resolve();
    this.stateHistory = runState.stateHistory || [];
    this.issueTracker = (runState.issueTracker || []) as Issue[];
    this.transitionCount = runState.transitionCount || 0;
    this.completedSteps = runState.completedSteps || [];
    this.failedSteps = runState.failedSteps || this.deriveFailedStepKeys(runState.stepLogs || []);
    this.currentStep = targetState ? null : (runState.currentStep || null);
    this.activeStepKeys.clear();
    this.activeConcurrencyGroups = [];
    this.stepLogs = runState.stepLogs || [];
    this.qualityChecks = runState.qualityChecks || [];
    this.runStartTime = runState.startTime || null;
    this.runEndTime = null;
    // 恢复累计等待时长，并把"停摆→恢复"这段间隔计入等待。
    this.accumulatedWaitMs = runState.accumulatedWaitMs || 0;
    {
      const pauseStartedAt = runState.waitStartedAt || runState.endTime;
      if (pauseStartedAt) {
        this.accumulatedWaitMs += Math.max(0, Date.now() - new Date(pauseStartedAt).getTime());
      }
    }
    this.waitStartedAt = null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.isolatedDir = runState.workingDirectory || null;
    this.currentProjectRoot = runState.workingDirectory || null;
    this.workflowGit = runState.workspaceGit || null;
    this.currentRunSpecCoding = runState.runSpecCoding
      ? normalizeSpecCodingDocument(runState.runSpecCoding)
      : null;
    this.currentSpecRootDir = runState.specRootDir || null;
    this.bindingValidation = runState.bindingValidation;
    this.stepTaskBindingsSnapshot = runState.stepTaskBindingsSnapshot || [];
    this.stepTaskBindingsByStepKey = new Map(
      this.stepTaskBindingsSnapshot.map((binding) => [binding.stepKey, binding])
    );
    this.deltaSpecMerged = runState.deltaSpecMerged || false;
    this.deltaMergeState = runState.deltaMergeState;
    this.workflowName = runState.workflowName || '';
    if (!this.currentRunSpecCoding && runState.persistMode === 'repository') {
      const workingDir = runState.workingDirectory;
      if (workingDir) {
        const specRootDir = getSpecRootDir(workingDir, runState.runSpecCoding?.specRoot);
        const deltaSpec = await readDeltaSpec(specRootDir, this.workflowName, runState.runId).catch(() => null);
        if (deltaSpec) {
          this.currentRunSpecCoding = deltaSpec;
        }
      }
    }

    this.humanQuestionWaiters.clear();
    this.selfTransitionCounts = new Map();
    for (const record of this.stateHistory) {
      if (record.from === record.to) {
        const currentCount = this.selfTransitionCounts.get(record.from) || 0;
        this.selfTransitionCounts.set(record.from, currentCount + 1);
      }
    }

    this.status = 'running';
    this.statusReason = null;
    this.shouldStop = false;
    this.pendingForceTransition = null;
    this.pendingForceInstruction = null;
    this.pendingApprovalInfo = null;
    this.interruptFlag = false;
    this.feedbackInterrupt = false;
    this.liveFeedback = [];
    this.resumeStateName = null;
    this.resumeStepKey = null;
    this.currentProcesses = [];
  }

  private async assertRestoredWorkflowSnapshot(runState: PersistedRunState): Promise<void> {
    if (!runState.workflowSnapshotManifestHash) return;
    const rootRunId = runState.rootRunId || runState.runId;
    const rootConfigFile = runState.workflowSnapshotRoot || runState.configFile;
    try {
      const snapshot = await readWorkflowConfigSnapshot({
        rootRunId,
        configFile: rootConfigFile,
      });
      if (snapshot.manifest.manifestHash !== runState.workflowSnapshotManifestHash) {
        throw new Error('run state 记录的 snapshot manifest hash 与实际 manifest 不一致');
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const statusReason = `工作流配置快照损坏，已标记为 crashed。请重新启动工作流，或从有效 run snapshot 恢复后再继续。原因: ${reason}`;
      await saveRunState({
        ...runState,
        status: 'crashed',
        statusReason,
        endTime: new Date().toISOString(),
      }).catch(() => {});
      throw new Error(statusReason);
    }
  }

  // ========== Live feedback functionality ==========
  private liveFeedback: LiveFeedbackEntry[] = [];
  private interruptFlag = false;
  private feedbackInterrupt = false; // true = non-urgent feedback interrupt (softer prompt tone)
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;
  private iterationFeedback: string = '';
  /** 最近一次预执行命令（preCommands）的输出，会注入到对应步骤上下文中 */
  private lastPreCommandOutput: string | null = null;
  /** Multi-user: createdBy userId, set by workflow start route */
  public _createdBy?: string;
  public _createdByName?: string;
  /** Multi-user: user's personal directory for isolation */
  public _userPersonalDir?: string;
  /** The isolated working directory for this run (if isolation is active) */
  private isolatedDir: string | null = null;
  /** Original projectRoot from config (before isolation) */
  private currentProjectRoot: string | null = null;
  private getWorkingDirectory(): string | null {
    return this.isolatedDir || this.currentProjectRoot || null;
  }

  setQueuedApprovalAction(action: 'approve' | 'iterate'): void {
    this.queuedApprovalAction = action;
  }

  setIterationFeedback(feedback: string): void {
    this.iterationFeedback = feedback;
  }

  approve(): void {
    this.queuedApprovalAction = 'approve';
    this.emit('approve');
  }

  requestIteration(feedback: string): void {
    this.iterationFeedback = feedback;
    this.queuedApprovalAction = 'iterate';
    this.emit('iterate');
  }

  getInternalStatus(): string {
    return this.status;
  }

  private createLiveFeedbackEntry(message: string, options: LiveFeedbackOptions = {}): LiveFeedbackEntry {
    return {
      id: options.id || `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      message,
      timestamp: new Date().toISOString(),
      interrupt: !!options.interrupt,
      automatic: options.automatic,
    };
  }

  private emitLiveFeedbackStatus(entries: LiveFeedbackEntry[], status: LiveFeedbackStatus, timestamp = new Date().toISOString()): void {
    if (entries.length === 0) return;
    this.emit('feedback-injected', {
      id: entries.length === 1 ? entries[0].id : undefined,
      ids: entries.map((entry) => entry.id),
      message: entries.map((entry) => entry.message).join('\n\n'),
      messages: entries.map((entry) => ({
        id: entry.id,
        message: entry.message,
        timestamp: entry.timestamp,
        interrupt: entry.interrupt,
        automatic: entry.automatic,
      })),
      timestamp,
      status,
      interrupt: entries.some((entry) => entry.interrupt),
      automatic: entries.every((entry) => entry.automatic),
    });
  }

  private queueLiveFeedback(message: string, options: LiveFeedbackOptions = {}): LiveFeedbackEntry {
    const existingIndex = options.id
      ? this.liveFeedback.findIndex((entry) => entry.id === options.id)
      : -1;
    if (existingIndex >= 0) {
      const current = this.liveFeedback[existingIndex];
      const next = {
        ...current,
        message,
        interrupt: current.interrupt || !!options.interrupt,
        automatic: current.automatic || options.automatic,
      };
      this.liveFeedback[existingIndex] = next;
      this.emitLiveFeedbackStatus([next], next.interrupt ? 'interrupting' : 'queued');
      return next;
    }
    const entry = this.createLiveFeedbackEntry(message, options);
    this.liveFeedback.push(entry);
    this.emitLiveFeedbackStatus([entry], entry.interrupt ? 'interrupting' : 'queued', entry.timestamp);
    return entry;
  }

  private consumeLiveFeedback(): { entries: LiveFeedbackEntry[]; prompt: string } {
    const entries = this.liveFeedback;
    this.liveFeedback = [];
    return {
      entries,
      prompt: entries.map((entry) => entry.message).join('\n\n'),
    };
  }

  injectLiveFeedback(message: string, options: LiveFeedbackOptions = {}): boolean {
    this.queueLiveFeedback(message, { ...options, interrupt: false });

    // Interrupt the running processes so feedback is delivered immediately via resume
    if (this.status === 'running' && this.currentState) {
      this.interruptFlag = true;
      this.feedbackInterrupt = true; // non-urgent flag, different prompt tone
      const interrupted = this.cancelCurrentProcesses();
      if (interrupted) {
        const entry = this.liveFeedback.find((item) => item.id === options.id && item.message === message)
          || this.liveFeedback.find((item) => item.message === message);
        if (entry) this.emitLiveFeedbackStatus([entry], 'interrupting');
      }
      return interrupted;
    }
    return false;
  }

  recallLiveFeedback(message: string): boolean {
    const idx = this.liveFeedback.findIndex((entry) => entry.message === message || entry.id === message);
    if (idx === -1) return false;
    const [entry] = this.liveFeedback.splice(idx, 1);
    this.emit('feedback-recalled', { id: entry.id, message: entry.message, timestamp: new Date().toISOString() });
    return true;
  }

  interruptWithFeedback(message: string, options: LiveFeedbackOptions = {}): boolean {
    if (this.status !== 'running' || !this.currentState) {
      return false;
    }

    const entry = this.queueLiveFeedback(message, { ...options, interrupt: true });
    this.interruptFlag = true;
    this.feedbackInterrupt = false;

    // Find and kill all running processes tracked by this manager
    const interrupted = this.cancelCurrentProcesses();
    if (interrupted) this.emitLiveFeedbackStatus([entry], 'interrupting');
    return interrupted;
  }

  // ========== Force complete functionality ==========
  async forceCompleteStep(options: { target?: 'parent-step' | 'child-current-step'; actor?: WorkflowActionActor } = {}): Promise<{ step: string; output: string; target?: string } | null> {
    if (this.status !== 'running' || !this.currentState) {
      return null;
    }

    if (options.target === 'child-current-step' && this.activeSubworkflowRunId) {
      const { workflowRegistry } = await import('@/lib/workflow/registry');
      const childManager = await workflowRegistry.getManagerByRunId(this.activeSubworkflowRunId);
      const result = await (childManager as any)?.forceCompleteStep?.({ target: 'parent-step' });
      const ref = this.subworkflowRuns.find((item) => item.runId === this.activeSubworkflowRunId);
      this.recordSubworkflowAudit({
        action: 'force-complete-child',
        actor: options.actor,
        childRunId: this.activeSubworkflowRunId,
        childConfigFile: ref?.configFile,
        stateName: ref?.parentStateName,
        stepName: ref?.parentStepName,
        details: {
          forwarded: Boolean(result),
        },
      });
      await this.persistState();
      return result ? { ...result, target: 'child-current-step' } : null;
    }

    // Find the first running process tracked by this manager
    const processIds = new Set(this.currentProcesses.map((proc) => proc.id));
    const stepIds = new Set(this.currentProcesses.map((proc) => proc.stepId).filter(Boolean) as string[]);
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => (p.status === 'running' || p.status === 'queued') && (processIds.has(p.id) || (p.stepId && stepIds.has(p.stepId)))
    );

    if (!running) return null;

    // Kill the process
    if (!processManager.killProcess(running.id) && this.currentEngine) {
      this.currentEngine.cancel();
      const rawProc = processManager.getProcessRaw(running.id);
      if (rawProc) { rawProc.status = 'killed'; rawProc.endTime = new Date(); }
    }

    // Get accumulated output
    const output = running.streamContent || '';

    this.emit('step-force-completed', {
      step: this.currentState,
      output,
      timestamp: new Date().toISOString(),
    });

    return {
      step: this.currentState,
      output,
      target: options.target || 'parent-step',
    };
  }

  // ========== Rerun from step functionality ==========
  async rerunFromStep(runId: string, stateName: string, actor?: WorkflowActionActor): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    // Find the state in history
    const persistedHistory = (runState.stateHistory || []) as StateTransitionRecord[];
    const stateIndex = persistedHistory.findIndex(h => h.to === stateName);
    if (stateIndex === -1) {
      throw new Error(`找不到状态: ${stateName}`);
    }

    // Restore state up to that point
    await this.restoreRunStateForContinuation({
      ...runState,
      stateHistory: persistedHistory.slice(0, stateIndex + 1),
      transitionCount: stateIndex + 1,
    }, stateName);
    const supersededAt = new Date().toISOString();
    this.subworkflowRuns = this.subworkflowRuns.map((ref) => {
      if (ref.parentStateName !== stateName || !['pending', 'starting', 'running', 'waiting-human', 'completed', 'failed', 'stopped', 'crashed'].includes(ref.status)) {
        return ref;
      }
      this.recordSubworkflowAudit({
        action: 'rerun-supersede',
        actor,
        childRunId: ref.runId,
        childConfigFile: ref.configFile,
        stateName: ref.parentStateName,
        stepName: ref.parentStepName,
        details: {
          previousStatus: ref.status,
          rerunState: stateName,
        },
      });
      return {
        ...ref,
        status: 'superseded' as const,
        endedAt: ref.endedAt || supersededAt,
        summary: `${ref.summary || ''}${ref.summary ? '\n' : ''}父工作流从该状态重跑，旧 child attempt 已 superseded。`,
      };
    });

    this.emit('status', {
      status: 'running',
      message: `从状态 ${stateName} 重新运行...`,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configContent = await this.readWorkflowConfigContent(runState.configFile);
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.currentWorkflowConfig = workflowConfig;
    this.workflowMcpServers = [];
    await this.resolveWorkflowMcpServers(workflowConfig);
    this.currentSupervisorAgent = runState.supervisorAgent || resolveWorkflowSupervisorAgent(workflowConfig);

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.ensureSupervisorAgentExists(workflowConfig);
    this.initializeAgents(workflowConfig);
    for (const persistedAgent of runState.agents || []) {
      const agent = this.agents.find((item) => item.name === persistedAgent.name);
      if (agent && persistedAgent.sessionId) {
        agent.sessionId = persistedAgent.sessionId;
      }
    }

    // Continue execution from this state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'failed',
          message: error.message,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  async forceJumpToState(runId: string, targetState: string, instruction?: string, actor?: WorkflowActionActor): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }
    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    await this.restoreRunStateForContinuation(runState, targetState);
    const configContent = await this.readWorkflowConfigContent(runState.configFile);
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    const target = workflowConfig.workflow.states.find((state) => state.name === targetState);
    if (!target) {
      throw new Error(`找不到目标状态: ${targetState}`);
    }
    if (runState.workingDirectory) {
      workflowConfig.context.projectRoot = runState.workingDirectory;
    }

    this.currentWorkflowConfig = workflowConfig;
    this.currentProjectRoot = runState.workingDirectory || workflowConfig.context?.projectRoot || null;
    this.currentSupervisorAgent = runState.supervisorAgent || resolveWorkflowSupervisorAgent(workflowConfig);
    this.stateHistory.push({
      from: runState.currentState || runState.currentPhase || runState.status || 'completed',
      to: targetState,
      reason: instruction
        ? `强制恢复跳转到 ${targetState}，附加指令: ${instruction}`
        : `强制恢复跳转到 ${targetState}`,
      issues: [],
      timestamp: new Date().toISOString(),
    });
    this.transitionCount++;
    this.recordSubworkflowAudit({
      action: 'force-transition',
      actor,
      stateName: targetState,
      details: {
        forceJump: true,
        targetState,
        instruction,
      },
    });
    this.emit('force-transition', {
      from: runState.currentState || runState.currentPhase || runState.status,
      targetState,
      instruction,
      runId,
      actor,
    });
    this.emit('transition-forced', {
      from: runState.currentState || runState.currentPhase || runState.status,
      to: targetState,
      instruction,
      runId,
    });

    this.emit('status', {
      status: 'running',
      message: `从已结束运行强制跳转到状态 ${targetState} 并恢复执行...`,
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: this.currentState,
      currentStep: this.currentStep,
      currentConfigFile: this.currentConfigFile,
      workingDirectory: this.getWorkingDirectory(),
      workflowFrontendSessionId: this._frontendSessionId || null,
    });
    await this.persistState();

    this.workflowMcpServers = [];
    await this.loadAgentConfigs();
    this.ensureSupervisorAgentExists(workflowConfig);
    this.initializeAgents(workflowConfig);
    for (const persistedAgent of runState.agents || []) {
      const agent = this.agents.find((item) => item.name === persistedAgent.name);
      if (agent && persistedAgent.sessionId) {
        agent.sessionId = persistedAgent.sessionId;
      }
    }
    await this.initializeEngine(resolveWorkflowExecutionPolicy(workflowConfig.context).defaultEngine || workflowConfig.context?.engine);
    await this.resolveWorkflowMcpServers(workflowConfig);
    if (workflowConfig.context?.gitBaselineEnabled !== false) {
      await this.ensureWorkflowGitBaseline(workflowConfig.context?.projectRoot || runState.workingDirectory);
    } else {
      await this.disableWorkflowGitBaseline(workflowConfig.context?.projectRoot || runState.workingDirectory);
    }

    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          runId: this.currentRunId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.clearRuntimeActivity();
        this.emit('status', {
          status: 'failed',
          message: error.message,
          runId: this.currentRunId,
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async queryAgent(
    agentName: string,
    question: string,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    const roleConfig = this.agentConfigs.find(r => r.name === agentName)
      || config.roles?.find(r => r.name === agentName);

    if (!roleConfig) {
      return `[错误] 找不到 Agent 配置: ${agentName}`;
    }

    const specCodingBlock = this.currentRunSpecCoding
      ? [
        '# 当前 Run Spec Coding 投影',
        `- 版本: v${this.currentRunSpecCoding.version}`,
        this.currentRunSpecCoding.summary ? `- 摘要: ${this.currentRunSpecCoding.summary}` : '',
        this.currentRunSpecCoding.progress?.summary ? `- 进度: ${this.currentRunSpecCoding.progress.summary}` : '',
        this.currentRunSpecCoding.tasks?.length
          ? `- tasks.md: ${this.currentRunSpecCoding.tasks.filter((task) => task.status === 'completed').length}/${this.currentRunSpecCoding.tasks.length} 已完成`
          : '',
        this.currentState ? `- 当前状态: ${this.currentState}` : '',
        '- 规则: 你可以基于该 Spec Coding 投影回答问题；普通 Agent 只能推进状态，系统会同步到正式 tasks.md；任务标记使用 [ ]=未开始、[-]=进行中、[x]=已完成；结构性修订由 Supervisor 负责。',
      ].filter(Boolean).join('\n')
      : '';
    const prompt = [
      specCodingBlock,
      '# 问题',
      question,
      '',
      '请直接回答这个问题，不需要执行其他任务。',
    ].filter(Boolean).join('\n\n');
    const selection = resolveAgentEngineSelection(roleConfig, config.context);
    const model = selection.model;
    const systemPrompt = roleConfig.systemPrompt || `你是一个 AI 助手。`;
    const agentState = this.agents.find((item) => item.name === agentName);
    if (agentState) {
      agentState.engine = selection.engine;
      agentState.model = selection.model;
    }

    const processId = `query-${agentName}-${Date.now()}`;

    try {
      const result = await this.executeWithEngine(
        processId,
        agentName,
        'query',
        prompt,
        systemPrompt,
        model,
        {
          workingDirectory: config.context?.projectRoot
            ? this.resolveProjectRootPath(config.context.projectRoot)
            : this.resolveProjectRootPath(),
          timeoutMs: 60000,
          resumeSessionId: agentState?.sessionId || undefined,
          engineType: selection.engine,
          mcpServers: this.getEffectiveMcpServers(roleConfig),
        }
      );
      const answer = result.result || '[无输出]';
      if (result.is_error || isEngineLevelFailure(answer)) {
        throw new Error(answer.trim() || 'Agent 查询失败');
      }
      replaceAgentStateSessionId(agentState, result.session_id);
      
      this.agentFlow.push({
        id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'response',
        fromAgent: agentName,
        toAgent: 'supervisor',
        message: answer,
        stateName: this.currentState || '',
        stepName: '',
        round: 0,
        timestamp: new Date().toISOString(),
      });
      this.emit('agent-flow', { agentFlow: this.agentFlow });
      
      return answer;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isEngineLevelFailure(message)) {
        throw error;
      }
      return `[错误] 查询 Agent 失败: ${message}`;
    }
  }

}

export const stateMachineWorkflowManager = new StateMachineWorkflowManager();
