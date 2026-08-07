import { createHash, randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import { extractJsonObject } from '@/lib/ai/result-channel';
import {
  executeChatRuntimeWithContextRecovery,
  getOrCreateChatRuntimeEngine,
  resolveRequestedChatRuntimeModel,
} from '@/lib/chat/chat-engine-runtime';
import type { ReviewPolicy, StateMachineState } from '@/lib/core/schemas';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { LIGHTWEIGHT_TASKLIST_SKILL, isLightweightWorkflowConfig } from '@/lib/workflow/lightweight';
import {
  canonicalJson,
  normalizeStateMachineWorkflowConfig,
  reconcileReviewPolicy,
} from '@/lib/workflow/state-review-policy';
import {
  normalizeWorkflowConfigRef,
  resolveWorkflowConfigDependencyGraphWithContent,
  type WorkflowConfigDependencyGraphWithContent,
} from '@/lib/workflow/subworkflow-config';
import type {
  RunReviewLightweightSuggestion,
  RunReviewOverride,
  RunReviewStateOverride,
  RunReviewStatePlan,
  RunReviewStateSuggestion,
  RunReviewSuggestion,
  RunReviewWorkflowOverride,
  RunReviewWorkflowPlan,
  RunReviewPlan,
  WorkflowAdversarialIntent,
  WorkflowReviewMode,
} from '@/lib/workflow/run-review-types';

const RUN_REVIEW_PLAN_TTL_MS = 15 * 60 * 1000;

type StateReviewCandidate = {
  kind: 'state';
  configFile: string;
  workflowName: string;
  stateId: string;
  stateName: string;
  description: string;
  baseMode: WorkflowReviewMode;
  configLocked: boolean;
  stepSummaries: Array<{ name: string; task: string; agent: string }>;
};

type LightweightReviewCandidate = {
  kind: 'lightweight';
  configFile: string;
  workflowName: string;
  task: string;
  agent: string;
  workflowDescription: string;
};

type ReviewCandidate = StateReviewCandidate | LightweightReviewCandidate;

export interface RunReviewPlanArtifact {
  plan: RunReviewPlan;
  /** Authoritative server-side run projection. Never accept this value from the client. */
  effectiveConfigContents: Record<string, string>;
  originalConfigContents: Record<string, string>;
  suggestions: Record<string, RunReviewSuggestion>;
}

export type RunReviewBatchEvaluator = (
  candidates: ReviewCandidate[],
  context: {
    initialContexts?: Record<string, unknown>;
    workingDirectory?: string;
    userId?: string;
  },
) => Promise<Record<string, RunReviewSuggestion>>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stateKey(configFile: string, stateId: string): string {
  return `${normalizeWorkflowConfigRef(configFile)}::${stateId}`;
}

function lightweightKey(configFile: string): string {
  return `${normalizeWorkflowConfigRef(configFile)}::lightweight`;
}

function candidateKey(candidate: ReviewCandidate): string {
  return candidate.kind === 'lightweight'
    ? lightweightKey(candidate.configFile)
    : stateKey(candidate.configFile, candidate.stateId);
}

function computeBaseConfigHash(graph: WorkflowConfigDependencyGraphWithContent): string {
  const files = graph.configs
    .map((entry) => ({ configFile: entry.file, sha256: sha256(entry.content) }))
    .sort((left, right) => left.configFile.localeCompare(right.configFile));
  return `run-review-config:v2:${sha256(canonicalJson(files))}`;
}

export function computeRunReviewContextHash(input: {
  initialContexts?: Record<string, unknown>;
  rehearsal?: boolean;
}): string {
  return `run-review-context:v2:${sha256(canonicalJson({
    initialContexts: input.initialContexts || {},
    rehearsal: Boolean(input.rehearsal),
  }))}`;
}

function availableAgents(config: any, state: StateMachineState): string[] {
  const denied = new Set((Array.isArray(config?.roles) ? config.roles : [])
    .filter((role: any) => role?.roleType === 'supervisor' || role?.team === 'black-gold')
    .map((role: any) => String(role?.name || '').trim())
    .filter(Boolean));
  const configured = (Array.isArray(config?.roles) ? config.roles : [])
    .map((role: any) => String(role?.name || '').trim())
    .filter((name: string) => name && !denied.has(name));
  const used = (state.steps || [])
    .map((step) => String(step.agent || '').trim())
    .filter((name) => name && !denied.has(name));
  return Array.from(new Set([...configured, ...used]));
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return ['high', 'medium', 'low'].includes(String(value))
    ? String(value) as 'high' | 'medium' | 'low'
    : 'medium';
}

function normalizeRiskSignals(value: unknown): string[] {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item: unknown) => String(item || '').trim())
    .filter(Boolean)));
}

function normalizeStateSuggestion(value: any, candidate: StateReviewCandidate): RunReviewStateSuggestion | null {
  if (!value || !['standard', 'adversarial'].includes(value.mode)) return null;
  const confidence = normalizeConfidence(value.confidence);
  const requestedMode = value.mode as WorkflowReviewMode;
  return {
    kind: 'state',
    configFile: candidate.configFile,
    stateId: candidate.stateId,
    mode: confidence === 'low' && requestedMode === 'standard' ? 'adversarial' : requestedMode,
    confidence,
    riskSignals: normalizeRiskSignals(value.riskSignals),
    rationale: String(value.rationale || '').trim(),
  };
}

function normalizeLightweightSuggestion(
  value: any,
  candidate: LightweightReviewCandidate,
): RunReviewLightweightSuggestion | null {
  if (!value || typeof value.requiresAdversarial !== 'boolean') return null;
  const confidence = normalizeConfidence(value.confidence);
  return {
    kind: 'lightweight',
    configFile: candidate.configFile,
    requiresAdversarial: confidence === 'low' ? true : value.requiresAdversarial,
    confidence,
    riskSignals: normalizeRiskSignals(value.riskSignals),
    rationale: String(value.rationale || '').trim(),
  };
}

function normalizeEvaluatorSuggestions(
  candidates: ReviewCandidate[],
  input: Record<string, RunReviewSuggestion>,
): Record<string, RunReviewSuggestion> {
  const byKey = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const normalized: Record<string, RunReviewSuggestion> = {};
  for (const [key, value] of Object.entries(input || {})) {
    const candidate = byKey.get(key);
    if (!candidate) throw new Error(`运行级批量评估返回了未知目标: ${key}`);
    const suggestion = candidate.kind === 'lightweight'
      ? normalizeLightweightSuggestion(value, candidate)
      : normalizeStateSuggestion(value, candidate);
    if (!suggestion) throw new Error(`运行级批量评估返回了无效建议: ${key}`);
    normalized[key] = suggestion;
  }
  const missing = [...byKey.keys()].filter((key) => !normalized[key]);
  if (missing.length > 0) throw new Error(`运行级批量评估遗漏目标: ${missing.join(', ')}`);
  return normalized;
}

export async function evaluateRunReviewCandidatesWithAi(
  candidates: ReviewCandidate[],
  context: { initialContexts?: Record<string, unknown>; workingDirectory?: string; userId?: string },
): Promise<Record<string, RunReviewSuggestion>> {
  if (candidates.length === 0) return {};
  const engine = await getOrCreateChatRuntimeEngine(undefined, undefined, context.userId);
  if (!engine) throw new Error('无法创建运行级对抗规划引擎');
  const prompt = [
    '你是工作流运行级审查模式规划器。请一次性评估下面所有目标。',
    '只能返回窄建议；不得返回状态或步骤全集、Agent、实例 ID、来源、锁或完整 workflow。',
    'kind=state 时，只有风险边界、不确定性、独立验收价值或错误代价明显较高才选择 adversarial，否则选择 standard。',
    'kind=lightweight 时，判断本次任务是否必须使用 defender → attacker → judge；不得直接生成步骤。',
    'confidence=low 会被系统保守提升为需要 adversarial。',
    '必须恰好为每个输入目标返回一项，不得遗漏或增加目标。',
    '输出格式：<result>{"suggestions":[{"kind":"state","configFile":"...","stateId":"...","mode":"standard|adversarial","confidence":"high|medium|low","riskSignals":["..."],"rationale":"..."},{"kind":"lightweight","configFile":"...","requiresAdversarial":true,"confidence":"high|medium|low","riskSignals":["..."],"rationale":"..."}]}</result>',
    `本次运行上下文：${canonicalJson(context.initialContexts || {})}`,
    `待评估目标：${canonicalJson(candidates)}`,
  ].join('\n\n');
  const result = await executeChatRuntimeWithContextRecovery(engine, {
    agent: 'run-review-planner',
    step: 'run-review-plan',
    prompt,
    systemPrompt: '严格按结构化协议输出，不执行工具，不改写工作流。',
    model: resolveRequestedChatRuntimeModel(),
    workingDirectory: context.workingDirectory || getWorkspaceRoot(),
    allowedTools: [],
    forceNewSession: true,
    userId: context.userId,
  });
  if (!result.success) throw new Error(result.error || result.output || '运行级批量评估失败');
  const parsed = extractJsonObject(result.output);
  const rows = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
  const byKey = new Map(candidates.map((candidate) => [candidateKey(candidate), candidate]));
  const suggestions: Record<string, RunReviewSuggestion> = {};
  for (const row of rows) {
    const key = row?.kind === 'lightweight'
      ? lightweightKey(String(row?.configFile || ''))
      : stateKey(String(row?.configFile || ''), String(row?.stateId || ''));
    const candidate = byKey.get(key);
    if (!candidate || suggestions[key]) throw new Error(`运行级批量评估返回了未知或重复目标: ${key}`);
    const suggestion = candidate.kind === 'lightweight'
      ? normalizeLightweightSuggestion(row, candidate)
      : normalizeStateSuggestion(row, candidate);
    if (!suggestion) throw new Error(`运行级批量评估返回了无效建议: ${key}`);
    suggestions[key] = suggestion;
  }
  const missing = [...byKey.keys()].filter((key) => !suggestions[key]);
  if (missing.length > 0) throw new Error(`运行级批量评估遗漏目标: ${missing.join(', ')}`);
  return suggestions;
}

function buildCandidates(graph: WorkflowConfigDependencyGraphWithContent): {
  normalizedConfigs: Map<string, any>;
  stateCandidates: StateReviewCandidate[];
  lightweightCandidates: LightweightReviewCandidate[];
} {
  const normalizedConfigs = new Map<string, any>();
  const stateCandidates: StateReviewCandidate[] = [];
  const lightweightCandidates: LightweightReviewCandidate[] = [];
  for (const entry of graph.configs) {
    const parsed = parse(entry.content) as any;
    if (parsed?.workflow?.mode !== 'state-machine') {
      normalizedConfigs.set(entry.file, parsed);
      continue;
    }
    const config = normalizeStateMachineWorkflowConfig(parsed, {
      materializeIds: false,
      workflowKey: entry.file,
    });
    normalizedConfigs.set(entry.file, config);
    if (isLightweightWorkflowConfig(config)) {
      const state = config.workflow.states?.[0];
      const step = state?.steps?.[0];
      lightweightCandidates.push({
        kind: 'lightweight',
        configFile: entry.file,
        workflowName: String(config.workflow.name || entry.workflowName || entry.file),
        task: String(step?.task || config.context?.requirements || ''),
        agent: String(step?.agent || ''),
        workflowDescription: String(config.workflow.description || ''),
      });
      continue;
    }
    for (const state of (config.workflow.states || []) as StateMachineState[]) {
      if (state.isFinal) continue;
      const id = String(state.id || '').trim();
      if (!id) throw new Error(`状态缺少稳定 ID: ${entry.file}/${state.name}`);
      stateCandidates.push({
        kind: 'state',
        configFile: entry.file,
        workflowName: String(config.workflow.name || entry.workflowName || entry.file),
        stateId: id,
        stateName: state.name,
        description: String(state.description || ''),
        baseMode: state.reviewPolicy?.mode === 'adversarial' ? 'adversarial' : 'standard',
        configLocked: Boolean(state.reviewPolicy?.locked),
        stepSummaries: (state.steps || []).map((step) => ({
          name: step.name,
          task: String(step.task || ''),
          agent: String(step.agent || ''),
        })),
      });
    }
  }
  return { normalizedConfigs, stateCandidates, lightweightCandidates };
}

/**
 * An explicit run-level decision is not an AI judgement. Inheriting the
 * suggestion's confidence here would let the conservative low-confidence
 * upgrade in `normalizeReviewPolicy` flip a user's own "standard" choice back
 * to adversarial while the plan still reports the chosen mode.
 */
function createPolicy(
  mode: WorkflowReviewMode,
  origin: 'global' | 'user' | 'ai',
  suggestion?: RunReviewStateSuggestion,
): ReviewPolicy {
  if (origin === 'ai') {
    return {
      mode,
      source: 'ai',
      locked: false,
      confidence: suggestion?.confidence || 'high',
      riskSignals: suggestion?.riskSignals || [],
      rationale: suggestion?.rationale || '本次运行由 AI 评估当前状态风险后决定。',
    };
  }
  return {
    mode,
    source: 'user',
    locked: true,
    confidence: 'high',
    riskSignals: [],
    rationale: origin === 'global'
      ? '本次运行全局意愿要求关闭对抗。'
      : `本次运行由用户指定${mode === 'adversarial' ? '对抗' : '标准'}模式。`,
  };
}

function deriveAdversarialStateMachine(
  config: any,
  configFile: string,
  suggestion?: RunReviewLightweightSuggestion,
): { config: any; operations: RunReviewWorkflowPlan['operations']; warnings: string[]; blocked: boolean } {
  const sourceState = config.workflow.states?.[0] as StateMachineState | undefined;
  const sourceStep = sourceState?.steps?.[0];
  if (!sourceState || !sourceStep) {
    return { config, operations: [], warnings: ['轻量工作流缺少固定执行步骤，无法派生对抗状态机。'], blocked: true };
  }
  const suffix = sha256(normalizeWorkflowConfigRef(configFile)).slice(0, 10);
  const executionName = '执行与对抗';
  const finalName = '完成';
  const sourceSkills = Array.isArray(sourceStep.skills)
    ? sourceStep.skills.filter((skill: string) => skill !== LIGHTWEIGHT_TASKLIST_SKILL)
    : undefined;
  const executionState: StateMachineState = {
    ...sourceState,
    id: `run-review-execution-${suffix}`,
    name: executionName,
    description: sourceState.description || config.workflow.description || '执行本次任务，并进行独立攻击审查与裁决。',
    isInitial: true,
    isFinal: false,
    steps: [{
      ...sourceStep,
      id: sourceStep.id || `run-review-defender-${suffix}`,
      role: undefined,
      agentInstanceId: undefined,
      ...(sourceSkills?.length ? { skills: sourceSkills } : { skills: undefined }),
      specTaskBinding: undefined,
    }],
    transitions: [
      { to: finalName, condition: { verdict: 'pass' }, priority: 10, label: '通过' },
      { to: executionName, condition: { verdict: 'conditional_pass' }, priority: 20, label: '修正后复核' },
      { to: executionName, condition: { verdict: 'fail' }, priority: 30, label: '失败后修正' },
    ],
    reviewPolicy: undefined,
    maxSelfTransitions: 2,
  };
  const reconciled = reconcileReviewPolicy(
    executionState,
    {
      mode: 'adversarial',
      source: 'ai',
      locked: false,
      confidence: suggestion?.confidence || 'high',
      riskSignals: suggestion?.riskSignals || [],
      rationale: suggestion?.rationale || '本次轻量任务需要独立攻击审查，已派生运行级状态机。',
    },
    {
      workflowKey: configFile,
      availableAgents: availableAgents(config, executionState),
    },
  );
  if (reconciled.blocked) {
    return { config, operations: reconciled.operations, warnings: reconciled.warnings, blocked: true };
  }
  const { profile: _profile, lightweight: _lightweight, ...workflow } = config.workflow;
  const derived = {
    ...config,
    workflow: {
      ...workflow,
      description: workflow.description || '由轻量工作流为本次 run 派生的对抗执行快照。',
      states: [
        reconciled.nextState,
        {
          id: `run-review-final-${suffix}`,
          name: finalName,
          description: '本次运行已完成。',
          isInitial: false,
          isFinal: true,
          steps: [],
          transitions: [],
        },
      ],
      supervisor: workflow.supervisor || { enabled: true, agent: 'default-supervisor' },
    },
  };
  return { config: derived, operations: reconciled.operations, warnings: reconciled.warnings, blocked: false };
}

function isWorkflowOverride(value: RunReviewOverride): value is RunReviewWorkflowOverride {
  return value.kind === 'lightweight';
}

function projectPlan(input: {
  graph: WorkflowConfigDependencyGraphWithContent;
  normalizedConfigs: Map<string, any>;
  stateCandidates: StateReviewCandidate[];
  lightweightCandidates: LightweightReviewCandidate[];
  intent: WorkflowAdversarialIntent;
  suggestions: Record<string, RunReviewSuggestion>;
  overrides?: RunReviewOverride[];
}): {
  workflows: RunReviewWorkflowPlan[];
  states: RunReviewStatePlan[];
  effectiveConfigContents: Record<string, string>;
  warnings: string[];
  blocked: boolean;
} {
  const stateOverrides = new Map<string, RunReviewStateOverride['mode']>();
  const workflowOverrides = new Map<string, RunReviewWorkflowOverride['requiresAdversarial']>();
  for (const override of input.overrides || []) {
    if (isWorkflowOverride(override)) {
      workflowOverrides.set(lightweightKey(override.configFile), override.requiresAdversarial);
    } else {
      stateOverrides.set(stateKey(override.configFile, override.stateId), override.mode);
    }
  }
  const stateByKey = new Map(input.stateCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  const lightweightByKey = new Map(input.lightweightCandidates.map((candidate) => [candidateKey(candidate), candidate]));
  for (const override of input.overrides || []) {
    const key = isWorkflowOverride(override)
      ? lightweightKey(override.configFile)
      : stateKey(override.configFile, override.stateId);
    if (isWorkflowOverride(override) ? !lightweightByKey.has(key) : !stateByKey.has(key)) {
      throw new Error(`运行级覆盖引用了未知目标: ${key}`);
    }
    if (input.intent === 'disabled') throw new Error('关闭对抗时不允许运行级覆盖');
  }

  const workflows: RunReviewWorkflowPlan[] = [];
  const states: RunReviewStatePlan[] = [];
  const allWarnings: string[] = [];
  const effectiveConfigContents: Record<string, string> = {};
  let blocked = false;
  for (const entry of input.graph.configs) {
    let config = input.normalizedConfigs.get(entry.file);
    if (config?.workflow?.mode !== 'state-machine') {
      effectiveConfigContents[entry.file] = entry.content;
      continue;
    }
    if (isLightweightWorkflowConfig(config)) {
      const key = lightweightKey(entry.file);
      const candidate = lightweightByKey.get(key)!;
      const suggestion = input.suggestions[key] as RunReviewLightweightSuggestion | undefined;
      const hasOverride = workflowOverrides.has(key) && workflowOverrides.get(key) !== null;
      const manualSelectionRequired = input.intent === 'on-demand' && !suggestion && !hasOverride;
      const requiresAdversarial = input.intent === 'disabled'
        ? false
        : hasOverride
          ? Boolean(workflowOverrides.get(key))
          : Boolean(suggestion?.requiresAdversarial);
      const source: RunReviewWorkflowPlan['source'] = input.intent === 'disabled'
        ? 'global'
        : hasOverride ? 'user' : 'ai';
      const derived = requiresAdversarial
        ? deriveAdversarialStateMachine(config, entry.file, suggestion)
        : { config, operations: [], warnings: [], blocked: false };
      config = derived.config;
      blocked ||= derived.blocked || manualSelectionRequired;
      allWarnings.push(...derived.warnings.map((warning) => `${candidate.workflowName}: ${warning}`));
      workflows.push({
        kind: 'workflow',
        configFile: entry.file,
        workflowName: candidate.workflowName,
        baseKind: 'lightweight',
        effectiveKind: requiresAdversarial ? 'state-machine' : 'lightweight',
        requiresAdversarial,
        source,
        locked: source === 'global' || source === 'user',
        ...(suggestion ? { suggestion } : {}),
        operations: derived.operations,
        warnings: derived.warnings,
        blocked: derived.blocked || manualSelectionRequired,
        manualSelectionRequired,
      });
      effectiveConfigContents[entry.file] = requiresAdversarial ? stringify(config) : entry.content;
      continue;
    }

    workflows.push({
      kind: 'workflow',
      configFile: entry.file,
      workflowName: String(config.workflow.name || entry.workflowName || entry.file),
      baseKind: 'state-machine',
      effectiveKind: 'state-machine',
      requiresAdversarial: false,
      source: input.intent === 'disabled' ? 'global' : 'ai',
      locked: input.intent === 'disabled',
      operations: [],
      warnings: [],
      blocked: false,
      manualSelectionRequired: false,
    });
    config.workflow.states = (config.workflow.states || []).map((state: StateMachineState) => {
      if (state.isFinal) return state;
      const key = stateKey(entry.file, String(state.id || ''));
      const candidate = stateByKey.get(key)!;
      const suggestion = input.suggestions[key] as RunReviewStateSuggestion | undefined;
      const hasUserOverride = stateOverrides.has(key) && stateOverrides.get(key) !== null;
      let mode: WorkflowReviewMode;
      let source: RunReviewStatePlan['source'];
      let locked: boolean;
      // A config lock still supplies the default, so an AI outage never blocks
      // a locked state on manual selection.
      const manualSelectionRequired = input.intent === 'on-demand'
        && !candidate.configLocked
        && !suggestion
        && !hasUserOverride;
      if (input.intent === 'disabled') {
        mode = 'standard';
        source = 'global';
        locked = true;
      } else if (hasUserOverride) {
        mode = stateOverrides.get(key)! as WorkflowReviewMode;
        source = 'user';
        locked = true;
      } else if (candidate.configLocked) {
        mode = candidate.baseMode;
        source = 'config-lock';
        locked = true;
      } else {
        mode = suggestion?.mode || candidate.baseMode;
        source = 'ai';
        locked = false;
      }
      // The run-level global intent outranks a config lock by design. Say so
      // instead of silently discarding the choice made at design time.
      const lockOverrideWarnings = input.intent === 'disabled'
        && candidate.configLocked
        && candidate.baseMode === 'adversarial'
        ? ['配置中锁定的对抗模式已被本次运行的全局意愿覆盖为标准模式。']
        : [];
      const reconciled = reconcileReviewPolicy(
        state,
        source === 'config-lock' && state.reviewPolicy
          ? { ...state.reviewPolicy }
          : createPolicy(mode, source === 'config-lock' ? 'user' : source, suggestion),
        {
          workflowKey: entry.file,
          availableAgents: availableAgents(config, state),
        },
      );
      const stateWarnings = [...lockOverrideWarnings, ...reconciled.warnings];
      blocked ||= reconciled.blocked || manualSelectionRequired;
      allWarnings.push(...stateWarnings.map((warning) => `${candidate.stateName}: ${warning}`));
      states.push({
        kind: 'state',
        configFile: entry.file,
        stateId: candidate.stateId,
        stateName: candidate.stateName,
        workflowName: candidate.workflowName,
        baseMode: candidate.baseMode,
        suggestedMode: suggestion?.mode || candidate.baseMode,
        effectiveMode: mode,
        source,
        locked,
        configLocked: candidate.configLocked,
        ...(suggestion ? { suggestion } : {}),
        operations: reconciled.operations,
        warnings: stateWarnings,
        blocked: reconciled.blocked || manualSelectionRequired,
        manualSelectionRequired,
      });
      return reconciled.nextState;
    });
    effectiveConfigContents[entry.file] = stringify(config);
  }
  return {
    workflows,
    states,
    effectiveConfigContents,
    warnings: Array.from(new Set(allWarnings)),
    blocked,
  };
}

export async function createRunReviewPlanArtifact(input: {
  rootConfigFile: string;
  intent: WorkflowAdversarialIntent;
  initialContexts?: Record<string, unknown>;
  rehearsal?: boolean;
  userId?: string;
  evaluator?: RunReviewBatchEvaluator;
}): Promise<RunReviewPlanArtifact> {
  if (!['disabled', 'on-demand'].includes(input.intent)) throw new Error('必须选择本次运行的全局对抗意愿');
  const graph = await resolveWorkflowConfigDependencyGraphWithContent(input.rootConfigFile);
  const { normalizedConfigs, stateCandidates, lightweightCandidates } = buildCandidates(graph);
  // Locked states are evaluated too. The lock still decides the effective mode,
  // but hiding the AI's read would leave "on-demand" a dead option on a
  // workflow created with adversarial review switched off.
  const targets: ReviewCandidate[] = input.intent === 'on-demand'
    ? [...lightweightCandidates, ...stateCandidates]
    : [];
  const evaluator = input.evaluator || evaluateRunReviewCandidatesWithAi;
  let suggestions: Record<string, RunReviewSuggestion> = {};
  let evaluationError = '';
  if (input.intent === 'on-demand' && targets.length > 0) {
    try {
      const rawSuggestions = await evaluator(targets, {
        initialContexts: input.initialContexts,
        workingDirectory: String(input.initialContexts?.workingDirectory || ''),
        userId: input.userId,
      });
      suggestions = normalizeEvaluatorSuggestions(targets, rawSuggestions);
    } catch (error) {
      evaluationError = error instanceof Error ? error.message : String(error);
    }
  }
  const projection = projectPlan({
    graph,
    normalizedConfigs,
    stateCandidates,
    lightweightCandidates,
    intent: input.intent,
    suggestions,
  });
  const createdAt = new Date();
  const plan: RunReviewPlan = {
    id: `start-plan-${randomUUID()}`,
    rootConfigFile: graph.root,
    intent: input.intent,
    baseConfigHash: computeBaseConfigHash(graph),
    contextHash: computeRunReviewContextHash({ initialContexts: input.initialContexts, rehearsal: input.rehearsal }),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + RUN_REVIEW_PLAN_TTL_MS).toISOString(),
    workflows: projection.workflows,
    states: projection.states,
    warnings: projection.warnings,
    blocked: projection.blocked,
    ...(evaluationError ? { evaluationError } : {}),
  };
  return {
    plan,
    effectiveConfigContents: projection.effectiveConfigContents,
    originalConfigContents: Object.fromEntries(graph.configs.map((entry) => [entry.file, entry.content])),
    suggestions,
  };
}

export async function applyRunReviewPlanOverrides(input: {
  artifact: RunReviewPlanArtifact;
  overrides?: RunReviewOverride[];
}): Promise<RunReviewPlanArtifact> {
  const graph = await resolveWorkflowConfigDependencyGraphWithContent(input.artifact.plan.rootConfigFile);
  const currentHash = computeBaseConfigHash(graph);
  if (currentHash !== input.artifact.plan.baseConfigHash) throw new Error('工作流配置已变化，请重新确认本次运行方案');
  const { normalizedConfigs, stateCandidates, lightweightCandidates } = buildCandidates(graph);
  const projection = projectPlan({
    graph,
    normalizedConfigs,
    stateCandidates,
    lightweightCandidates,
    intent: input.artifact.plan.intent,
    suggestions: input.artifact.suggestions,
    overrides: input.overrides,
  });
  return {
    ...input.artifact,
    plan: {
      ...input.artifact.plan,
      workflows: projection.workflows,
      states: projection.states,
      warnings: projection.warnings,
      blocked: projection.blocked,
    },
    effectiveConfigContents: projection.effectiveConfigContents,
  };
}

export async function validateRunReviewPlanArtifact(input: {
  artifact: RunReviewPlanArtifact;
  initialContexts?: Record<string, unknown>;
  rehearsal?: boolean;
}): Promise<void> {
  if (Date.now() >= Date.parse(input.artifact.plan.expiresAt)) throw new Error('本次运行方案已过期，请重新预览');
  const contextHash = computeRunReviewContextHash({ initialContexts: input.initialContexts, rehearsal: input.rehearsal });
  if (contextHash !== input.artifact.plan.contextHash) throw new Error('本次运行上下文已变化，请重新预览');
  const graph = await resolveWorkflowConfigDependencyGraphWithContent(input.artifact.plan.rootConfigFile);
  if (computeBaseConfigHash(graph) !== input.artifact.plan.baseConfigHash) {
    throw new Error('工作流配置已变化，请重新预览');
  }
}
