import type {
  ReviewPolicy,
  StateMachineState,
  WorkflowStep,
  WorkflowStepProvenance,
} from '@/lib/core/schemas';
import { isLightweightWorkflowConfig } from '@/lib/workflow/lightweight';

const VIRTUAL_STATE_PREFIX = 'virtual-state-';
const VIRTUAL_STEP_PREFIX = 'virtual-step-';
const INLINE_VERDICT_INSTRUCTION = '\n\n完成本步骤工作后，在同一次输出末尾给出严格的状态裁决 JSON，verdict 只能是 pass、conditional_pass 或 fail。';

type ReviewRole = 'defender' | 'attacker' | 'judge';
type ManagedRole = NonNullable<WorkflowStepProvenance['managedRole']>;

export type ReviewPolicyOperation = {
  op: 'insert' | 'delete' | 'retag' | 'convert';
  stepId?: string;
  stepName: string;
  reason: string;
  before?: Partial<WorkflowStep>;
  after?: Partial<WorkflowStep>;
  safe: boolean;
};

export interface ReconcileReviewPolicyContext {
  workflowKey?: string;
  idFactory?: () => string;
  fallbackAgent?: string;
  availableAgents?: string[];
}

export interface ReconcileReviewPolicyResult {
  nextState: StateMachineState;
  operations: ReviewPolicyOperation[];
  warnings: string[];
  requiresConfirmation: boolean;
  blocked: boolean;
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function semanticValue(value: unknown, omitProvenance = false): unknown {
  if (Array.isArray(value)) return value.map((item) => semanticValue(item, omitProvenance));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value as Record<string, unknown>)
    .filter((key) => (!omitProvenance || key !== 'provenance') && (value as Record<string, unknown>)[key] !== undefined)
    .sort()
    .map((key) => [key, semanticValue((value as Record<string, unknown>)[key], omitProvenance)]));
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(semanticValue(value));
}

export function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    hash ^= BigInt(codePoint & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt((codePoint >>> 8) & 0xff);
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

export function hashReviewStep(step: WorkflowStep | Record<string, unknown>): string {
  return `review-step:v1:${fnv1a64(JSON.stringify(semanticValue(step, true)))}`;
}

export function hashReviewState(state: StateMachineState | Record<string, unknown>): string {
  return `review-state:v1:${fnv1a64(canonicalJson(state))}`;
}

export function createReviewEntityId(idFactory?: () => string): string {
  if (idFactory) return idFactory();
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `review-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function virtualId(prefix: string, seed: string): string {
  return `${prefix}${fnv1a64(seed)}`;
}

function isVirtualId(value: unknown, prefix: string): boolean {
  return typeof value === 'string' && value.startsWith(prefix);
}

export function createReviewStepProvenance(
  step: WorkflowStep,
  origin: WorkflowStepProvenance['origin'],
  managedRole?: ManagedRole,
): WorkflowStepProvenance {
  return {
    origin,
    ...(managedRole ? { managedRole } : {}),
    baselineHash: hashReviewStep(step),
  };
}

export function withReviewStepBaseline(
  step: WorkflowStep,
  origin: WorkflowStepProvenance['origin'],
  managedRole?: ManagedRole,
): WorkflowStep {
  const next = { ...cloneValue(step) };
  delete next.provenance;
  next.provenance = createReviewStepProvenance(next, origin, managedRole);
  return next;
}

export function isStepBaselineUnmodified(step: WorkflowStep): boolean {
  return Boolean(step.provenance?.baselineHash && step.provenance.baselineHash === hashReviewStep(step));
}

export function isManagedStepUnmodified(step: WorkflowStep): boolean {
  return step.provenance?.origin === 'review-policy' && isStepBaselineUnmodified(step);
}

function getParallelGroup(step: WorkflowStep): string {
  return String(step.parallelGroup || step.concurrency?.groupId || '').trim();
}

function isSerialStep(step: WorkflowStep): boolean {
  return !getParallelGroup(step);
}

function buildExecutionSegments(steps: WorkflowStep[]): WorkflowStep[][] {
  const segments: WorkflowStep[][] = [];
  for (let index = 0; index < steps.length;) {
    const group = getParallelGroup(steps[index]);
    if (!group) {
      segments.push([steps[index]]);
      index += 1;
      continue;
    }
    const segment: WorkflowStep[] = [];
    while (index < steps.length && getParallelGroup(steps[index]) === group) {
      segment.push(steps[index]);
      index += 1;
    }
    segments.push(segment);
  }
  return segments;
}

export function isStrictAdversarialRoleSequence(state: Pick<StateMachineState, 'steps' | 'isFinal'>): boolean {
  if (state.isFinal) return false;
  const segments = buildExecutionSegments(state.steps || []);
  if (segments.length < 3) return false;
  const attacker = segments[segments.length - 2];
  const judge = segments[segments.length - 1];
  if (attacker.length !== 1 || !isSerialStep(attacker[0]) || attacker[0].role !== 'attacker') return false;
  if (judge.length !== 1 || !isSerialStep(judge[0]) || judge[0].role !== 'judge') return false;
  return segments.slice(0, -2).every((segment) => (
    segment.length > 0 && segment.every((step) => step.role === 'defender')
  ));
}

function hasValidAdversarialExecutionContract(state: Pick<StateMachineState, 'steps' | 'isFinal'>): boolean {
  if (!isStrictAdversarialRoleSequence(state)) return false;
  const steps = state.steps || [];
  if (steps.some((step) => !String(step.agentInstanceId || '').trim())) return false;

  const defenderInstances = new Set(steps
    .filter((step) => step.role === 'defender')
    .map((step) => String(step.agentInstanceId || '').trim()));
  const attackerInstances = new Set(steps
    .filter((step) => step.role === 'attacker')
    .map((step) => String(step.agentInstanceId || '').trim()));
  const judgeInstances = new Set(steps
    .filter((step) => step.role === 'judge')
    .map((step) => String(step.agentInstanceId || '').trim()));
  if ([...defenderInstances].some((id) => attackerInstances.has(id) || judgeInstances.has(id))) return false;
  if ([...attackerInstances].some((id) => judgeInstances.has(id))) return false;

  const groups = new Map<string, WorkflowStep[]>();
  for (const step of steps.filter((item) => item.role === 'defender')) {
    const groupId = getParallelGroup(step);
    if (!groupId) continue;
    groups.set(groupId, [...(groups.get(groupId) || []), step]);
  }
  return [...groups.values()].every((groupSteps) => {
    const instances = groupSteps.map((step) => String(step.agentInstanceId || '').trim());
    const hasInvalidUnjoinedPolicy = groupSteps.some((step) => {
      const onUnjoinedBranches = (step.concurrency?.joinPolicy as any)?.onUnjoinedBranches;
      return Boolean(onUnjoinedBranches && onUnjoinedBranches !== 'stop');
    });
    return new Set(instances).size === instances.length
      && !hasInvalidUnjoinedPolicy
      && groupSteps.every((step) => step.concurrency?.joinPolicy?.mode === 'all');
  });
}

export function isStandardReviewStructure(state: Pick<StateMachineState, 'steps' | 'isFinal'>): boolean {
  if (state.isFinal || !Array.isArray(state.steps) || state.steps.length === 0) return false;
  if (state.steps.some((step) => step.role === 'attacker' || step.role === 'judge')) return false;
  const finalSegment = buildExecutionSegments(state.steps).at(-1);
  return Boolean(finalSegment && finalSegment.length === 1 && isSerialStep(finalSegment[0]));
}

/**
 * A managed closer already carries its own verdict wording, which is not the
 * literal protocol constant. Recognising it here keeps reconciliation from
 * appending a second, near-duplicate verdict instruction on every projection.
 */
function providesTrustedVerdict(step: WorkflowStep | undefined): boolean {
  return Boolean(step && (
    step.provenance?.managedRole === 'standard-closer'
    || String(step.task || '').includes(INLINE_VERDICT_INSTRUCTION)
  ));
}

export function hasTrustedStandardVerdictOutput(state: Pick<StateMachineState, 'steps' | 'isFinal'>): boolean {
  if (!isStandardReviewStructure(state)) return false;
  return providesTrustedVerdict(state.steps?.at(-1));
}

export function inferLegacyReviewPolicy(state: StateMachineState): ReviewPolicy | undefined {
  if (state.isFinal) return undefined;
  const adversarial = isStrictAdversarialRoleSequence(state);
  return {
    mode: adversarial ? 'adversarial' : 'standard',
    source: adversarial ? 'legacy' : 'default',
    locked: false,
    confidence: adversarial ? 'high' : 'medium',
    riskSignals: adversarial ? ['检测到旧版 defender → attacker → judge 严格编排'] : [],
    rationale: adversarial
      ? '根据旧配置中严格的 defender、attacker、judge 执行顺序推断为对抗模式。'
      : '旧配置未声明状态级审查策略，按兼容规则采用标准模式。',
  };
}

function normalizeReviewPolicy(policy: ReviewPolicy | undefined, state: StateMachineState): ReviewPolicy | undefined {
  if (state.isFinal) return undefined;
  const base = policy || inferLegacyReviewPolicy(state)!;
  const confidence = ['high', 'medium', 'low'].includes(base.confidence) ? base.confidence : 'medium';
  const requestedMode = base.mode === 'adversarial' ? 'adversarial' : 'standard';
  const source = ['ai', 'user', 'legacy', 'default'].includes(base.source) ? base.source : 'default';
  // Low confidence overrides an explicit `standard` request. The only trace is
  // the sentence appended to `rationale` below, so a user who picked standard
  // gets adversarial back and reads it as a defect. Any surface confirming a
  // mode change must render the normalized mode, not the requested one.
  const forceAdversarial = confidence === 'low' && requestedMode === 'standard';
  const rationale = String(base.rationale || '').trim();
  return {
    mode: forceAdversarial ? 'adversarial' : requestedMode,
    source,
    // Design lock: `locked` constrains the AI, never the user. It exists so
    // design-time optimization will not rewrite a mode the user chose; it must
    // not gate the user's own edits — deleting the state, renaming it, toggling
    // final, changing the self-loop ceiling. `source: 'user'` implies it, so a
    // UI writing `locked: false` while source stays `'user'` is silently
    // reverted here on the next normalization. Hand the policy back to the AI
    // instead; that is the only supported way to release it.
    locked: source === 'user' ? true : Boolean(base.locked),
    confidence,
    riskSignals: Array.from(new Set((base.riskSignals || []).map((item) => String(item).trim()).filter(Boolean))),
    rationale: forceAdversarial
      ? `${rationale || '当前模式判断把握不足'}${rationale.endsWith('。') ? '' : '。'}判断把握不足，按保守规则采用对抗模式。`
      : rationale,
  };
}

function deterministicInstanceId(workflowKey: string, state: StateMachineState, step: WorkflowStep, index: number): string {
  return `review-instance-${fnv1a64([workflowKey, state.id || state.name, step.role || 'step', step.id || index].join('/'))}`;
}

/**
 * Whether a workflow has adopted state-level review.
 *
 * `workflow.reviewProtocol` is the durable answer and the only one written going
 * forward. The per-state fallback covers configs created before that field
 * existed: those configs put policies on every non-final state and must keep
 * being governed by the protocol. A partial set is not enough — treating one
 * policy as adoption would drag a whole pre-protocol workflow into the protocol.
 */
export function isStateLevelReviewAdopted(config: unknown): boolean {
  const workflow = (config as any)?.workflow;
  if (!workflow) return false;
  if (workflow.reviewProtocol === 'state-level') return true;
  const states = Array.isArray(workflow.states) ? workflow.states : [];
  const nonFinalStates = states.filter((state: StateMachineState) => state && !state.isFinal);
  return nonFinalStates.length > 0
    && nonFinalStates.every((state: StateMachineState) => Boolean(state.reviewPolicy));
}

/**
 * Persist the legacy all-state adoption signal as workflow metadata. The input is
 * left untouched so callers can use this while building save or validation
 * payloads without mutating their editor/runtime state.
 */
export function materializeStateLevelReviewAdoption<T>(input: T): T {
  const workflow = (input as any)?.workflow;
  if (!workflow || workflow.reviewProtocol === 'state-level' || !isStateLevelReviewAdopted(input)) return input;
  return {
    ...(input as any),
    workflow: {
      ...workflow,
      reviewProtocol: 'state-level',
    },
  } as T;
}

/**
 * Self-loop ceiling to use when a state does not pin one. Adversarial states get
 * a tighter budget because each iteration costs a full defender/attacker/judge
 * round. Every reader must go through this: the engine and the design panel
 * disagreeing here would show one ceiling and enforce another.
 */
export function defaultMaxSelfTransitions(state: Pick<StateMachineState, 'reviewPolicy'> | undefined): number {
  return state?.reviewPolicy?.mode === 'adversarial' ? 2 : 3;
}

/**
 * Identity normalisation (stable IDs, provenance) is safe everywhere and is what
 * lets a pre-protocol config run at all. Adopting the review protocol is not:
 * inferring a policy, defaulting `maxSelfTransitions`, binding runtime instances
 * and repairing structure all change how an existing workflow executes and what
 * it costs. So adoption is opt-in at the workflow level.
 */
export function normalizeStateMachineWorkflowConfig<T>(
  input: T,
  options: {
    materializeIds?: boolean;
    workflowKey?: string;
    idFactory?: () => string;
    /** Adopt the review protocol for states that do not declare a policy yet. */
    adoptLegacyPolicy?: boolean;
    /** Receives the structural changes adoption made, keyed by state id or name. */
    collectOperations?: (stateKey: string, operations: ReviewPolicyOperation[]) => void;
  } = {},
): T {
  if (!input || typeof input !== 'object') return input;
  const source = cloneValue(input) as any;
  if (source?.workflow?.mode !== 'state-machine' || !Array.isArray(source.workflow.states)) return source as T;
  if (isLightweightWorkflowConfig(source)) {
    source.workflow.states = source.workflow.states.map((state: StateMachineState) => {
      const nextState = { ...state } as StateMachineState;
      delete nextState.reviewPolicy;
      return nextState;
    });
    return source as T;
  }
  const adoptProtocol = Boolean(options.adoptLegacyPolicy) || isStateLevelReviewAdopted(source);
  const workflowKey = options.workflowKey || source.workflow.name || 'state-machine-workflow';
  const deniedAgentNames = new Set((Array.isArray(source.roles) ? source.roles : [])
    .filter((role: any) => role?.roleType === 'supervisor' || role?.team === 'black-gold')
    .map((role: any) => String(role?.name || '').trim())
    .filter(Boolean));
  source.workflow.states = source.workflow.states.map((rawState: StateMachineState, stateIndex: number) => {
    let state = { ...rawState, steps: Array.isArray(rawState.steps) ? rawState.steps.map((step) => ({ ...step })) : [] } as StateMachineState;
    const normalizationOperations: ReviewPolicyOperation[] = [];
    const shouldRepairLowStandard = !state.isFinal
      && state.reviewPolicy?.mode === 'standard'
      && state.reviewPolicy?.confidence === 'low';
    const stateSeed = `${workflowKey}/state/${state.name || stateIndex}/${stateIndex}`;
    if (!state.id || (options.materializeIds && isVirtualId(state.id, VIRTUAL_STATE_PREFIX))) {
      state.id = options.materializeIds
        ? createReviewEntityId(options.idFactory)
        : virtualId(VIRTUAL_STATE_PREFIX, stateSeed);
    }
    state.steps = state.steps.map((rawStep, stepIndex) => {
      let step = { ...rawStep } as WorkflowStep;
      const stepSeed = `${stateSeed}/step/${step.name || stepIndex}/${stepIndex}`;
      const hadValidBaseline = isStepBaselineUnmodified(step);
      let identityChanged = false;
      if (!step.id || (options.materializeIds && isVirtualId(step.id, VIRTUAL_STEP_PREFIX))) {
        step.id = options.materializeIds
          ? createReviewEntityId(options.idFactory)
          : virtualId(VIRTUAL_STEP_PREFIX, stepSeed);
        identityChanged = true;
      }
      if (identityChanged && hadValidBaseline && ['ai-draft', 'review-policy'].includes(step.provenance?.origin || '')) {
        step = withReviewStepBaseline(step, step.provenance!.origin, step.provenance?.managedRole);
      }
      if (!step.provenance) step.provenance = { origin: 'legacy' };
      return step;
    });
    // A workflow that has not adopted the protocol keeps its original execution
    // shape. Without this the engine would silently add a closing step, rebind
    // runtime instances and lower the self-transition ceiling on workflows
    // authored before the protocol existed.
    if (!rawState.reviewPolicy && !adoptProtocol) return state;
    state.reviewPolicy = normalizeReviewPolicy(state.reviewPolicy, state);
    if (state.isFinal) delete state.reviewPolicy;
    // `maxSelfTransitions` is deliberately left unset. Writing the adversarial
    // default here would freeze it: reconciliation only fills the field when it
    // is undefined, so a state normalised as adversarial could never fall back
    // to the standard ceiling after the user turns adversarial off for a run.
    // Readers resolve the default from the effective policy instead.
    if (state.reviewPolicy?.mode === 'adversarial') {
      state.steps = state.steps.map((step, stepIndex) => {
        if (step.agentInstanceId) return step;
        const before = cloneValue(step);
        const hadValidBaseline = isStepBaselineUnmodified(step);
        let next: WorkflowStep = {
          ...step,
          agentInstanceId: deterministicInstanceId(workflowKey, state, step, stepIndex),
        };
        if (hadValidBaseline && ['ai-draft', 'review-policy'].includes(step.provenance?.origin || '')) {
          next = withReviewStepBaseline(next, step.provenance!.origin, step.provenance?.managedRole);
        }
        addOperation(
          normalizationOperations,
          'retag',
          before,
          '为对抗角色绑定独立运行实例。',
          true,
          next,
        );
        return next;
      });
    }
    const hasLegacyReviewRole = state.steps.some((step) => step.role === 'attacker' || step.role === 'judge');
    const shouldRepairStandardTail = state.reviewPolicy?.mode === 'standard'
      && !hasLegacyReviewRole
      && (!isStandardReviewStructure(state)
        || (['ai', 'user'].includes(state.reviewPolicy.source) && !hasTrustedStandardVerdictOutput(state)));
    const shouldRepairAdversarialContract = state.reviewPolicy?.mode === 'adversarial'
      && isStrictAdversarialRoleSequence(state)
      && !hasValidAdversarialExecutionContract(state);
    if ((shouldRepairLowStandard && !isStrictAdversarialRoleSequence(state))
      || shouldRepairStandardTail
      || shouldRepairAdversarialContract) {
      let repairedStepIndex = 0;
      const repaired = reconcileReviewPolicy(state, state.reviewPolicy!, {
        workflowKey,
        idFactory: options.materializeIds
          ? options.idFactory
          : () => virtualId(VIRTUAL_STEP_PREFIX, `${stateSeed}/review-repair/${repairedStepIndex++}`),
        availableAgents: state.steps
          .map((step) => step.agent)
          .filter((agent): agent is string => Boolean(agent) && !deniedAgentNames.has(agent!)),
      });
      if (!repaired.blocked) {
        state = repaired.nextState;
        normalizationOperations.push(...repaired.operations);
      }
    }
    // Adoption reshapes the state too — inserting a closer, rebinding instances,
    // retagging roles. Surface both direct normalization mutations and the
    // reconcile-phase operations so a start plan can show every change.
    if (options.collectOperations && normalizationOperations.length > 0) {
      options.collectOperations(state.id || state.name, normalizationOperations);
    }
    return state;
  });
  return materializeStateLevelReviewAdoption(source) as T;
}

function roleInstanceId(state: StateMachineState, step: WorkflowStep, role: ReviewRole, index: number): string {
  return `review-instance-${fnv1a64([state.id || state.name, role, step.id || step.name, index].join('/'))}`;
}

function repairStrictAdversarialExecutionContract(
  state: StateMachineState,
  operations: ReviewPolicyOperation[],
): WorkflowStep[] {
  const steps = (state.steps || []).map((step) => cloneValue(step));
  const defenderInstances = new Set<string>();
  const groupInstances = new Map<string, Set<string>>();

  const finalizeSystemMutation = (before: WorkflowStep, next: WorkflowStep): WorkflowStep => {
    if (canonicalJson(before) === canonicalJson(next)) return next;
    if (['ai-draft', 'review-policy'].includes(before.provenance?.origin || '') && isStepBaselineUnmodified(before)) {
      return withReviewStepBaseline(next, before.provenance!.origin, before.provenance?.managedRole);
    }
    return next;
  };
  const freshRoleInstance = (step: WorkflowStep, role: ReviewRole, index: number, reserved: Set<string>) => {
    let attempt = 0;
    let instanceId = roleInstanceId(state, step, role, index);
    while (reserved.has(instanceId)) {
      attempt += 1;
      instanceId = roleInstanceId(state, step, role, index + (attempt * 100_000));
    }
    return instanceId;
  };

  for (let index = 0; index < steps.length - 2; index += 1) {
    const before = steps[index];
    let next = cloneValue(before);
    const groupId = getParallelGroup(next);
    const sameGroupInstances = groupId ? (groupInstances.get(groupId) || new Set<string>()) : new Set<string>();
    let instanceId = String(next.agentInstanceId || '').trim();
    if (!instanceId || (groupId && sameGroupInstances.has(instanceId))) {
      instanceId = freshRoleInstance(next, 'defender', index, sameGroupInstances);
      next.agentInstanceId = instanceId;
    }
    defenderInstances.add(instanceId);
    if (groupId) {
      sameGroupInstances.add(instanceId);
      groupInstances.set(groupId, sameGroupInstances);
      const joinPolicy: any = {
        ...(next.concurrency?.joinPolicy || {}),
        mode: 'all' as const,
      };
      delete joinPolicy.onUnjoinedBranches;
      next.concurrency = {
        ...(next.concurrency || {}),
        groupId,
        joinPolicy,
      };
    }
    next = finalizeSystemMutation(before, next);
    steps[index] = next;
    if (canonicalJson(before) !== canonicalJson(next)) {
      addOperation(operations, 'retag', before, '修复 defender 的隔离实例或并行汇合规则。', true, next);
    }
  }

  const attackerIndex = steps.length - 2;
  const attackerBefore = steps[attackerIndex];
  let attacker = cloneValue(attackerBefore);
  let attackerInstance = String(attacker.agentInstanceId || '').trim();
  if (!attackerInstance || defenderInstances.has(attackerInstance)) {
    attackerInstance = freshRoleInstance(attacker, 'attacker', attackerIndex, defenderInstances);
    attacker.agentInstanceId = attackerInstance;
  }
  attacker = finalizeSystemMutation(attackerBefore, attacker);
  steps[attackerIndex] = attacker;
  if (canonicalJson(attackerBefore) !== canonicalJson(attacker)) {
    addOperation(operations, 'retag', attackerBefore, '修复 attacker 与 defender 的运行实例隔离。', true, attacker);
  }

  const judgeIndex = steps.length - 1;
  const judgeBefore = steps[judgeIndex];
  let judge = cloneValue(judgeBefore);
  const judgeReserved = new Set([...defenderInstances, attackerInstance]);
  const judgeInstance = String(judge.agentInstanceId || '').trim();
  if (!judgeInstance || judgeReserved.has(judgeInstance)) {
    judge.agentInstanceId = freshRoleInstance(judge, 'judge', judgeIndex, judgeReserved);
  }
  judge = finalizeSystemMutation(judgeBefore, judge);
  steps[judgeIndex] = judge;
  if (canonicalJson(judgeBefore) !== canonicalJson(judge)) {
    addOperation(operations, 'retag', judgeBefore, '修复 judge 与 defender/attacker 的运行实例隔离。', true, judge);
  }

  return steps;
}

function chooseAgent(agents: string[], index: number): string {
  return agents[index % agents.length];
}

function chooseDistinctAgent(agents: string[], avoidedAgents: Set<string>, fallbackIndex: number): string {
  return agents.find((agent) => !avoidedAgents.has(agent)) || chooseAgent(agents, fallbackIndex);
}

function managedStep(
  state: StateMachineState,
  role: 'attacker' | 'judge',
  agent: string,
  index: number,
  idFactory?: () => string,
): WorkflowStep {
  const step: WorkflowStep = {
    id: createReviewEntityId(idFactory),
    name: role === 'attacker' ? '对抗审查' : '独立裁决',
    agent,
    agentInstanceId: `review-instance-${fnv1a64([state.id || state.name, role, index].join('/'))}`,
    role,
    task: role === 'attacker'
      ? '读取全部 defender 证据，主动寻找反例、边界、遗漏和错误假设，不得仅复述 defender 结论；输出可由 judge 核验的挑战证据。'
      : '读取 defender 与 attacker 的完整证据，独立给出 pass、conditional_pass 或 fail 裁决，并输出严格的状态裁决 JSON。',
    constraints: role === 'attacker'
      ? ['必须覆盖反例、边界、遗漏和错误假设', '不得仅复述 defender 结论']
      : ['只依据可见证据裁决', 'verdict 只能是 pass、conditional_pass 或 fail'],
  };
  return withReviewStepBaseline(step, 'review-policy', role);
}

function convertToUserStep(step: WorkflowStep, managedRole?: ManagedRole): WorkflowStep {
  const next = { ...cloneValue(step), role: undefined };
  delete next.agentInstanceId;
  next.provenance = { origin: 'user', ...(managedRole ? { managedRole } : {}) };
  return next;
}

function standardCloser(
  state: StateMachineState,
  agent: string,
  idFactory?: () => string,
  seedStep?: WorkflowStep,
): WorkflowStep {
  const step: WorkflowStep = seedStep
    ? {
        ...cloneValue(seedStep),
        role: undefined,
        parallelGroup: undefined,
        concurrency: undefined,
        agentInstanceId: undefined,
      }
    : {
        id: createReviewEntityId(idFactory),
        name: '标准裁决收口',
        agent,
        task: '汇总当前状态全部执行与验证结果，在同一次输出中给出严格的状态裁决 JSON，verdict 只能是 pass、conditional_pass 或 fail。',
      };
  return withReviewStepBaseline(step, 'review-policy', 'standard-closer');
}

function addOperation(
  operations: ReviewPolicyOperation[],
  op: ReviewPolicyOperation['op'],
  step: WorkflowStep,
  reason: string,
  safe: boolean,
  after?: WorkflowStep,
) {
  operations.push({
    op,
    stepId: step.id,
    stepName: step.name,
    reason,
    before: cloneValue(step),
    ...(after ? { after: cloneValue(after) } : {}),
    safe,
  });
}

export function reconcileReviewPolicy(
  rawState: StateMachineState,
  requestedPolicy: ReviewPolicy,
  context: ReconcileReviewPolicyContext = {},
): ReconcileReviewPolicyResult {
  const state = cloneValue(rawState);
  const operations: ReviewPolicyOperation[] = [];
  const warnings: string[] = [];
  if (state.isFinal) {
    delete state.reviewPolicy;
    return { nextState: state, operations, warnings: ['终态不参与审查模式配置。'], requiresConfirmation: false, blocked: true };
  }
  const targetPolicy = normalizeReviewPolicy(requestedPolicy, state)!;
  const hasExplicitAgentAllowlist = context.availableAgents !== undefined;
  const allowedAgentSource = hasExplicitAgentAllowlist
    ? context.availableAgents || []
    : (state.steps || []).map((step) => step.agent || '');
  const normalizedAllowlist = new Set(allowedAgentSource
    .map((item) => String(item).trim())
    .filter(Boolean));
  const fallbackAgent = String(context.fallbackAgent || '').trim();
  if (fallbackAgent && (!hasExplicitAgentAllowlist || normalizedAllowlist.has(fallbackAgent))) {
    normalizedAllowlist.add(fallbackAgent);
  }
  const availableAgents = Array.from(normalizedAllowlist);
  if (availableAgents.length === 0) {
    return {
      nextState: state,
      operations,
      warnings: ['当前没有可执行 Agent，无法建立审查编排。'],
      requiresConfirmation: false,
      blocked: true,
    };
  }
  const structureMatchesPolicy = targetPolicy.mode === 'adversarial'
    ? hasValidAdversarialExecutionContract(state)
    : isStandardReviewStructure(state)
      && (['legacy', 'default'].includes(targetPolicy.source) || hasTrustedStandardVerdictOutput(state));
  if (state.reviewPolicy?.mode === targetPolicy.mode
    && canonicalJson(state.reviewPolicy) === canonicalJson(targetPolicy)
    && structureMatchesPolicy) {
    return { nextState: state, operations, warnings, requiresConfirmation: false, blocked: false };
  }

  if (targetPolicy.mode === 'adversarial') {
    const existingStrict = isStrictAdversarialRoleSequence(state);
    if (existingStrict) {
      state.steps = repairStrictAdversarialExecutionContract(state, operations);
      state.reviewPolicy = targetPolicy;
      return {
        nextState: state,
        operations,
        warnings,
        requiresConfirmation: operations.length > 0,
        blocked: false,
      };
    }
    // 非严格旧编排中的孤立 attacker/judge 不是系统可删除内容；保留其业务字段并纳入 defender 段。
    const businessSteps = state.steps || [];
    const defenderSteps = businessSteps.map((step, index) => {
      let next: WorkflowStep = {
        ...step,
        role: 'defender',
        agentInstanceId: roleInstanceId(state, step, 'defender', index),
      };
      if (getParallelGroup(next)) {
        next.concurrency = {
          ...(next.concurrency || {}),
          groupId: getParallelGroup(next),
          joinPolicy: { mode: 'all' },
        };
      }
      if (['ai-draft', 'review-policy'].includes(step.provenance?.origin || '') && isStepBaselineUnmodified(step)) {
        next = withReviewStepBaseline(next, step.provenance!.origin);
      }
      if (step.role !== 'defender' || step.agentInstanceId !== next.agentInstanceId) {
        addOperation(operations, 'retag', step, '纳入 defender 执行段并绑定独立运行实例。', true, next);
      }
      return next;
    });
    if (defenderSteps.length === 0) {
      return {
        nextState: state,
        operations: [],
        warnings: ['对抗模式至少需要一个业务执行/验证步骤作为 defender。'],
        requiresConfirmation: false,
        blocked: true,
      };
    }
    const defenderAgents = new Set(defenderSteps.map((step) => step.agent).filter((agent): agent is string => Boolean(agent)));
    const attackerAgent = chooseDistinctAgent(availableAgents, defenderAgents, 1);
    const judgeAgent = chooseDistinctAgent(availableAgents, new Set([...defenderAgents, attackerAgent]), 2);
    const attacker = managedStep(state, 'attacker', attackerAgent, defenderSteps.length, context.idFactory);
    const judge = managedStep(state, 'judge', judgeAgent, defenderSteps.length + 1, context.idFactory);
    addOperation(operations, 'insert', attacker, '新增独立攻击审查步骤。', true, attacker);
    addOperation(operations, 'insert', judge, '新增独立裁决步骤。', true, judge);
    state.steps = [...defenderSteps, attacker, judge];
    state.reviewPolicy = targetPolicy;
    return { nextState: state, operations, warnings, requiresConfirmation: operations.length > 0, blocked: false };
  }

  const originalSteps = state.steps || [];
  const kept: WorkflowStep[] = [];
  // Keeping a role step instead of deleting it happens for two very different
  // reasons, and telling a user their own pre-protocol config is "of unknown
  // origin" reads like a defect report. Track them apart.
  let keptPreProtocolRoleStep = false;
  let keptModifiedManagedStep = false;
  let convertedUnsafeTailJudge = false;
  let safeJudge: WorkflowStep | undefined;
  const noteKeptStep = (step: WorkflowStep): boolean => {
    const wasManaged = step.provenance?.origin === 'review-policy';
    if (wasManaged) keptModifiedManagedStep = true;
    else keptPreProtocolRoleStep = true;
    return wasManaged;
  };
  for (const [stepIndex, step] of originalSteps.entries()) {
    if (step.role === 'attacker') {
      const canDelete = step.provenance?.managedRole === 'attacker' && isManagedStepUnmodified(step);
      if (canDelete) {
        addOperation(operations, 'delete', step, '删除未修改的 review-policy 托管 attacker。', true);
      } else {
        const converted = convertToUserStep(step);
        kept.push(converted);
        addOperation(
          operations,
          'convert',
          step,
          noteKeptStep(step)
            ? '托管的对抗步骤已被修改，保留并转为标准验证步骤。'
            : '步骤来自状态级审查之前的配置，保留并转为标准验证步骤。',
          false,
          converted,
        );
      }
      continue;
    }
    if (step.role === 'judge') {
      const canManage = step.provenance?.managedRole === 'judge' && isManagedStepUnmodified(step);
      if (canManage) {
        safeJudge = step;
      } else {
        const converted = convertToUserStep(step, 'standard-closer');
        kept.push(converted);
        convertedUnsafeTailJudge = stepIndex === originalSteps.length - 1 && isSerialStep(step);
        addOperation(
          operations,
          'convert',
          step,
          noteKeptStep(step)
            ? '托管的裁决步骤已被修改，保留为标准收口步骤。'
            : '裁决步骤来自状态级审查之前的配置，保留为标准收口步骤。',
          false,
          converted,
        );
      }
      continue;
    }
    if (step.role === 'defender') {
      let next: WorkflowStep = { ...step, role: undefined, agentInstanceId: undefined };
      if (['ai-draft', 'review-policy'].includes(step.provenance?.origin || '') && isStepBaselineUnmodified(step)) {
        next = withReviewStepBaseline(next, step.provenance!.origin);
      }
      kept.push(next);
      addOperation(operations, 'retag', step, '标准模式移除 defender 角色标签和隔离实例绑定。', true, next);
    } else {
      kept.push(step);
    }
  }

  const last = kept[kept.length - 1];
  const lastEndsParallel = Boolean(last && getParallelGroup(last));
  const canRewriteLast = Boolean(last
    && isSerialStep(last)
    && ['ai-draft', 'review-policy'].includes(last.provenance?.origin || '')
    && isStepBaselineUnmodified(last));

  if (safeJudge && lastEndsParallel) {
    const closer = standardCloser(state, safeJudge.agent || chooseAgent(availableAgents, 0), context.idFactory, safeJudge);
    kept.push(closer);
    addOperation(operations, 'convert', safeJudge, '状态以并行组结尾，将原 judge 转为标准串行收口步骤。', true, closer);
  } else if (safeJudge && canRewriteLast && last) {
    const rewritten = withReviewStepBaseline({
      ...last,
      task: `${String(last.task || '').replace(INLINE_VERDICT_INSTRUCTION, '')}${INLINE_VERDICT_INSTRUCTION}`,
    }, last.provenance?.origin || 'ai-draft', last.provenance?.managedRole);
    kept[kept.length - 1] = rewritten;
    addOperation(operations, 'convert', last, '最后一个串行步骤内联输出状态 verdict。', true, rewritten);
    addOperation(operations, 'delete', safeJudge, '标准模式由最后串行步骤内联裁决，删除未修改的独立 judge。', true);
  } else if (safeJudge) {
    const closer = standardCloser(state, safeJudge.agent || chooseAgent(availableAgents, 0), context.idFactory, safeJudge);
    kept.push(closer);
    addOperation(operations, 'convert', safeJudge, '为避免改写用户步骤，将原 judge 转为标准裁决收口步骤。', true, closer);
  } else if (!convertedUnsafeTailJudge
    && (!last || lastEndsParallel || !providesTrustedVerdict(last))) {
    if (canRewriteLast && last) {
      const rewritten = withReviewStepBaseline({
        ...last,
        task: `${String(last.task || '').replace(INLINE_VERDICT_INSTRUCTION, '')}${INLINE_VERDICT_INSTRUCTION}`,
      }, last.provenance?.origin || 'ai-draft', last.provenance?.managedRole);
      kept[kept.length - 1] = rewritten;
      addOperation(operations, 'convert', last, '最后一个串行步骤内联输出状态 verdict。', true, rewritten);
    } else {
      const closer = standardCloser(state, chooseAgent(availableAgents, 0), context.idFactory);
      kept.push(closer);
      addOperation(operations, 'insert', closer, '为保留用户步骤内容，新增标准裁决收口步骤。', true, closer);
    }
  }

  state.steps = kept;
  state.reviewPolicy = targetPolicy;
  // Reconciliation never pins the self-loop ceiling either. Writing it here would
  // freeze the value chosen for whichever mode happened to be applied first, so a
  // later switch to adversarial could not tighten it. An explicit value the user
  // set is left untouched; the rest is resolved by defaultMaxSelfTransitions.
  if (keptPreProtocolRoleStep) {
    warnings.push('这个状态里状态级审查之前配置的角色步骤已保留，并转为标准步骤；原工作流不变。');
  }
  if (keptModifiedManagedStep) {
    warnings.push('托管的对抗步骤已被手工修改，已保留而不是删除；应用前请确认转换结果。');
  }
  return {
    nextState: state,
    operations,
    warnings,
    requiresConfirmation: operations.length > 0,
    blocked: false,
  };
}

/**
 * Recover the adversarial intent a workflow was created under, so a start
 * dialog can preselect it instead of asking the same question twice. Creating
 * with `disabled` locks every non-final state to a user-sourced standard
 * policy; anything else means per-state decisions are still in play. Returns
 * null when the config carries neither a state-level policy nor an explicit
 * legacy Defender → Attacker → Judge chain, where the baseline is genuinely
 * unknown.
 */
export function inferBaselineAdversarialIntent(config: unknown): 'disabled' | 'on-demand' | null {
  const states = (config as any)?.workflow?.states;
  if (!Array.isArray(states)) return null;
  const targets = (states as StateMachineState[]).filter((state) => state && !state.isFinal);
  if (targets.length === 0) return null;
  // Pre-protocol workflows can still express a deliberate adversarial design
  // through an authored Defender → Attacker → Judge chain. Treat that as a
  // baseline rather than falling back to the start dialog's "no extra review"
  // default, which would otherwise describe an existing design as disabled.
  const carriesExplicitAdversarialChain = targets.some((state) => isStrictAdversarialRoleSequence(state));
  if (!carriesExplicitAdversarialChain && targets.every((state) => !state.reviewPolicy)) return null;
  return targets.every((state) => (
    state.reviewPolicy?.mode === 'standard'
    && state.reviewPolicy?.source === 'user'
    && state.reviewPolicy?.locked === true
  ))
    ? 'disabled'
    : 'on-demand';
}

export function getReviewPolicyProtectedSlice(state: StateMachineState) {
  const managedSteps = (state.steps || []).filter((step) => (
    step.provenance?.origin === 'review-policy'
    || step.provenance?.managedRole === 'standard-closer'
  ));
  const inlineVerdictStep = state.reviewPolicy?.mode === 'standard'
    && hasTrustedStandardVerdictOutput(state)
    && state.steps.at(-1)?.provenance?.managedRole !== 'standard-closer'
    ? state.steps.at(-1)
    : undefined;
  return {
    reviewPolicy: cloneValue(state.reviewPolicy),
    maxSelfTransitions: state.maxSelfTransitions,
    managedSteps: cloneValue(managedSteps),
    managedStepOrder: managedSteps.map((step) => step.id || step.name),
    inlineVerdictBinding: inlineVerdictStep ? {
      stepId: inlineVerdictStep.id,
      stepName: inlineVerdictStep.name,
      isFinalSerialStep: true,
      hasTrustedInstruction: true,
    } : undefined,
  };
}
