import { describe, expect, test } from 'vitest';
import type { ReviewPolicy, StateMachineState, WorkflowStep } from '@/lib/core/schemas';
import {
  hashReviewStep,
  inferLegacyReviewPolicy,
  isManagedStepUnmodified,
  isStepBaselineUnmodified,
  isStrictAdversarialRoleSequence,
  normalizeStateMachineWorkflowConfig,
  reconcileReviewPolicy,
  withReviewStepBaseline,
} from '@/lib/workflow/state-review-policy';

function policy(mode: 'standard' | 'adversarial', source: ReviewPolicy['source'] = 'user'): ReviewPolicy {
  return {
    mode,
    source,
    locked: source === 'user',
    confidence: 'high',
    riskSignals: mode === 'adversarial' ? ['跨模块变更'] : [],
    rationale: mode === 'adversarial' ? '跨模块变更需要独立挑战。' : '行为确定且可验证。',
  };
}

function state(steps: WorkflowStep[], reviewPolicy: ReviewPolicy = policy('standard', 'ai')): StateMachineState {
  return {
    id: 'state-execute',
    name: '执行',
    isInitial: true,
    isFinal: false,
    steps,
    transitions: [
      { to: '完成', condition: { verdict: 'pass' }, priority: 10 },
      { to: '执行', condition: { verdict: 'conditional_pass' }, priority: 20 },
      { to: '执行', condition: { verdict: 'fail' }, priority: 30 },
    ],
    reviewPolicy,
  };
}

describe('state review policy domain', () => {
  test('lightweight fixed state never carries state-level reviewPolicy', () => {
    const input = {
      workflow: {
        name: 'lightweight',
        mode: 'state-machine',
        profile: 'lightweight',
        lightweight: {},
        states: [{
          name: 'Execute',
          isInitial: true,
          isFinal: true,
          reviewPolicy: policy('adversarial'),
          steps: [{
            name: 'Run tasklist',
            agent: 'worker',
            task: 'Run tasklist',
            skills: ['aceharness-tasklist'],
          }],
          transitions: [],
        }],
      },
    };

    const normalized = normalizeStateMachineWorkflowConfig(input) as any;
    expect(normalized.workflow.states[0].reviewPolicy).toBeUndefined();
    expect(normalized.workflow.states[0]).not.toHaveProperty('maxSelfTransitions');
    expect(input.workflow.states[0].reviewPolicy).toBeDefined();
  });

  test('normalizes legacy configs without mutating input and materializes stable identities on save', () => {
    const input = {
      workflow: {
        name: 'legacy',
        mode: 'state-machine',
        states: [
          {
            name: '执行',
            isInitial: true,
            isFinal: false,
            steps: [{ name: '实现', agent: 'worker', task: '实现' }],
            transitions: [],
            reviewPolicy: {
              mode: 'standard', source: 'ai', locked: false, confidence: 'low', riskSignals: [], rationale: '不确定',
            },
          },
          {
            name: '完成',
            isInitial: false,
            isFinal: true,
            steps: [{ name: '汇总', agent: 'worker', task: '汇总', role: 'judge' }],
            transitions: [],
            reviewPolicy: policy('adversarial'),
          },
        ],
      },
    };

    const view = normalizeStateMachineWorkflowConfig(input, { workflowKey: 'legacy.yaml' }) as any;
    expect(input.workflow.states[0]).not.toHaveProperty('id');
    expect(view.workflow.states[0].id).toMatch(/^virtual-state-/);
    expect(view.workflow.states[0].steps[0].id).toMatch(/^virtual-step-/);
    expect(view.workflow.states[0].reviewPolicy.mode).toBe('adversarial');
    expect(view.workflow.states[0].steps.map((step: any) => step.role)).toEqual(['defender', 'attacker', 'judge']);
    expect(view.workflow.states[0].maxSelfTransitions).toBe(2);
    expect(view.workflow.states[1].reviewPolicy).toBeUndefined();

    let nextId = 0;
    const saved = normalizeStateMachineWorkflowConfig(view, {
      materializeIds: true,
      workflowKey: 'legacy.yaml',
      idFactory: () => `uuid-${++nextId}`,
    }) as any;
    expect(saved.workflow.states[0].id).toBe('uuid-1');
    expect(saved.workflow.states[0].steps[0].id).toBe('uuid-2');
  });

  test('legacy inference only accepts the strict final attacker and judge sequence', () => {
    const strict = state([
      { name: '实现', agent: 'worker', task: '实现', role: 'defender' },
      { name: '挑战', agent: 'worker', task: '挑战', role: 'attacker' },
      { name: '裁决', agent: 'worker', task: '裁决', role: 'judge' },
    ], undefined as any);
    const orphanJudge = state([
      { name: '实现', agent: 'worker', task: '实现' },
      { name: '汇总', agent: 'worker', task: '汇总', role: 'judge' },
    ], undefined as any);

    expect(isStrictAdversarialRoleSequence(strict)).toBe(true);
    expect(inferLegacyReviewPolicy(strict)?.mode).toBe('adversarial');
    expect(isStrictAdversarialRoleSequence(orphanJudge)).toBe(false);
    expect(inferLegacyReviewPolicy(orphanJudge)?.mode).toBe('standard');
  });

  test('reports a pre-protocol role step as pre-protocol rather than as unknown origin', () => {
    const result = reconcileReviewPolicy(state([
      { id: 'legacy-work', name: '实现', agent: 'worker', task: '实现', role: 'defender', provenance: { origin: 'legacy' } },
      { id: 'legacy-judge', name: '汇总', agent: 'worker', task: '汇总', role: 'judge', provenance: { origin: 'legacy' } },
    ], policy('standard', 'ai')), policy('standard'), { availableAgents: ['worker'] });

    const warnings = result.warnings.join('');
    expect(warnings).toContain('状态级审查之前');
    expect(warnings).not.toContain('来源不明');
    expect(warnings).not.toContain('已被手工修改');
    // The step is kept, and the reason shown next to the operation says why.
    expect(result.nextState.steps.some((step) => step.id === 'legacy-judge')).toBe(true);
    expect(result.operations.some((operation) => operation.reason.includes('状态级审查之前的配置'))).toBe(true);
  });

  test('normalization leaves a pre-protocol config untouched unless adoption is requested', () => {
    const legacy = () => ({
      workflow: {
        name: 'legacy',
        mode: 'state-machine',
        states: [
          {
            name: '并行收尾',
            isInitial: true,
            isFinal: false,
            steps: [
              { name: '实现 A', agent: 'worker', task: 'A', parallelGroup: 'g' },
              { name: '实现 B', agent: 'worker', task: 'B', parallelGroup: 'g' },
            ],
            transitions: [],
          },
          {
            name: '旧对抗',
            isInitial: false,
            isFinal: false,
            steps: [
              { name: '产出', agent: 'worker', task: '产出', role: 'defender' },
              { name: '挑战', agent: 'worker', task: '挑战', role: 'attacker' },
              { name: '裁决', agent: 'worker', task: '裁决', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    const kept = normalizeStateMachineWorkflowConfig(legacy(), { workflowKey: 'legacy.yaml' }) as any;
    const [parallelState, adversarialState] = kept.workflow.states;
    // No injected closer, no inferred policy, no rebound runtime identity and no
    // lowered self-transition ceiling: the workflow executes exactly as before.
    expect(parallelState.steps).toHaveLength(2);
    expect(parallelState.reviewPolicy).toBeUndefined();
    expect(parallelState.maxSelfTransitions).toBeUndefined();
    expect(adversarialState.reviewPolicy).toBeUndefined();
    expect(adversarialState.maxSelfTransitions).toBeUndefined();
    expect(adversarialState.steps.map((step: any) => step.agentInstanceId)).toEqual([undefined, undefined, undefined]);
    // Identity normalisation still happens — that is what lets it run at all.
    expect(kept.workflow.states.every((state: any) => Boolean(state.id))).toBe(true);
    expect(parallelState.steps.every((step: any) => Boolean(step.id) && step.provenance?.origin === 'legacy')).toBe(true);

    const adopted = normalizeStateMachineWorkflowConfig(legacy(), {
      workflowKey: 'legacy.yaml',
      adoptLegacyPolicy: true,
    }) as any;
    expect(adopted.workflow.states[0].steps).toHaveLength(3);
    expect(adopted.workflow.states[0].reviewPolicy?.mode).toBe('standard');
    expect(adopted.workflow.states[1].reviewPolicy?.mode).toBe('adversarial');
    expect(adopted.workflow.states[1].maxSelfTransitions).toBe(2);
    expect(adopted.workflow.states[1].steps.every((step: any) => Boolean(step.agentInstanceId))).toBe(true);
  });

  test('normalization adds a stable serial closer when a standard state ends in parallel', () => {
    const config = {
      workflow: {
        name: 'parallel-standard',
        mode: 'state-machine',
        states: [{
          name: '执行',
          isInitial: true,
          isFinal: false,
          reviewPolicy: policy('standard', 'ai'),
          steps: [
            { name: '实现 A', agent: 'worker', task: '实现 A', parallelGroup: 'g' },
            { name: '实现 B', agent: 'worker', task: '实现 B', parallelGroup: 'g' },
          ],
          transitions: [],
        }],
      },
    };
    const first = normalizeStateMachineWorkflowConfig(config, { workflowKey: 'parallel.yaml' }) as any;
    const second = normalizeStateMachineWorkflowConfig(config, { workflowKey: 'parallel.yaml' }) as any;
    expect(first.workflow.states[0].steps).toHaveLength(3);
    expect(first.workflow.states[0].steps[2].provenance).toMatchObject({
      origin: 'review-policy', managedRole: 'standard-closer',
    });
    expect(first.workflow.states[0].steps[2].id).toBe(second.workflow.states[0].steps[2].id);
    const saved = normalizeStateMachineWorkflowConfig(first, {
      materializeIds: true,
      workflowKey: 'parallel.yaml',
    }) as any;
    expect(isManagedStepUnmodified(saved.workflow.states[0].steps[2])).toBe(true);
  });

  test('keeps managed baselines valid when normalization adds adversarial instance IDs', () => {
    const defender = withReviewStepBaseline({ id: 'd', name: '实现', agent: 'worker', task: '实现', role: 'defender' }, 'ai-draft');
    const attacker = withReviewStepBaseline({ id: 'a', name: '挑战', agent: 'worker', task: '挑战', role: 'attacker' }, 'review-policy', 'attacker');
    const judge = withReviewStepBaseline({ id: 'j', name: '裁决', agent: 'worker', task: '裁决', role: 'judge' }, 'review-policy', 'judge');
    const config = {
      workflow: {
        name: 'instances',
        mode: 'state-machine',
        states: [state([defender, attacker, judge], policy('adversarial', 'ai'))],
      },
    };
    const normalized = normalizeStateMachineWorkflowConfig(config, { workflowKey: 'instances.yaml' }) as any;
    const steps = normalized.workflow.states[0].steps;
    expect(new Set(steps.map((step: any) => step.agentInstanceId)).size).toBe(3);
    expect(isStepBaselineUnmodified(steps[0])).toBe(true);
    expect(isManagedStepUnmodified(steps[1])).toBe(true);
    expect(isManagedStepUnmodified(steps[2])).toBe(true);
  });

  test('turns a standard state into an isolated three-role adversarial state with one Agent config', () => {
    const business = withReviewStepBaseline({
      id: 'step-business', name: '实现', agent: 'worker', task: '实现功能',
    }, 'ai-draft');
    const result = reconcileReviewPolicy(state([business]), policy('adversarial'), {
      availableAgents: ['worker'],
      idFactory: (() => { let id = 0; return () => `managed-${++id}`; })(),
    });

    expect(result.blocked).toBe(false);
    expect(result.nextState.steps.map((step) => step.role)).toEqual(['defender', 'attacker', 'judge']);
    expect(new Set(result.nextState.steps.map((step) => step.agentInstanceId)).size).toBe(3);
    expect(result.nextState.steps.every((step) => step.agent === 'worker')).toBe(true);
    expect(result.nextState.maxSelfTransitions).toBe(2);
    expect(isStrictAdversarialRoleSequence(result.nextState)).toBe(true);
    expect(result.operations.filter((operation) => operation.op === 'insert')).toHaveLength(2);
  });

  test('repairs strict adversarial instance collisions and parallel join rules before runtime', () => {
    const result = reconcileReviewPolicy(state([
      { id: 'd1', name: '实现 A', agent: 'worker', task: 'A', role: 'defender', agentInstanceId: 'shared', parallelGroup: 'g', concurrency: { groupId: 'g', joinPolicy: { mode: 'any', onUnjoinedBranches: 'detach' } as any } },
      { id: 'd2', name: '实现 B', agent: 'worker', task: 'B', role: 'defender', agentInstanceId: 'shared', parallelGroup: 'g', concurrency: { groupId: 'g', joinPolicy: { mode: 'any' } } },
      { id: 'a', name: '挑战', agent: 'worker', task: '挑战', role: 'attacker', agentInstanceId: 'shared' },
      { id: 'j', name: '裁决', agent: 'worker', task: '裁决', role: 'judge', agentInstanceId: 'shared' },
    ], policy('adversarial', 'ai')), policy('adversarial', 'ai'), { availableAgents: ['worker'] });

    expect(result.blocked).toBe(false);
    expect(result.operations.length).toBeGreaterThan(0);
    expect(result.nextState.steps.slice(0, 2).every((step) => step.concurrency?.joinPolicy?.mode === 'all')).toBe(true);
    expect((result.nextState.steps[0].concurrency?.joinPolicy as any)?.onUnjoinedBranches).toBeUndefined();
    expect(new Set(result.nextState.steps.slice(0, 2).map((step) => step.agentInstanceId)).size).toBe(2);
    const defenderInstances = new Set(result.nextState.steps.slice(0, 2).map((step) => step.agentInstanceId));
    expect(defenderInstances.has(result.nextState.steps[2].agentInstanceId)).toBe(false);
    expect(defenderInstances.has(result.nextState.steps[3].agentInstanceId)).toBe(false);
    expect(result.nextState.steps[2].agentInstanceId).not.toBe(result.nextState.steps[3].agentInstanceId);
  });

  test('does not trust a verdict keyword in an arbitrary user step', () => {
    const result = reconcileReviewPolicy(state([
      { id: 'user-step', name: '处理', agent: 'worker', task: '处理并给出裁决建议', provenance: { origin: 'user' } },
    ], policy('adversarial', 'ai')), policy('standard'), { availableAgents: ['worker'] });

    expect(result.nextState.steps).toHaveLength(2);
    expect(result.nextState.steps.at(-1)?.provenance?.managedRole).toBe('standard-closer');
  });

  test('keeps a legacy tail judge as the standard output step without adding another model call', () => {
    const result = reconcileReviewPolicy(state([
      { id: 'work', name: '实现', agent: 'worker', task: '实现', provenance: { origin: 'legacy' } },
      { id: 'legacy-judge', name: '汇总结果', agent: 'worker', task: '汇总结果', role: 'judge', provenance: { origin: 'legacy' } },
    ], policy('standard', 'legacy')), policy('standard'), { availableAgents: ['worker'] });

    expect(result.nextState.steps).toHaveLength(2);
    expect(result.nextState.steps.at(-1)).toMatchObject({
      id: 'legacy-judge', role: undefined, provenance: { origin: 'user', managedRole: 'standard-closer' },
    });
    expect(result.nextState.steps.some((step) => step.provenance?.origin === 'review-policy')).toBe(false);
  });

  test('leaves an existing managed standard closer untouched instead of stacking a second verdict instruction', () => {
    // A user-authored step is never rewritten, so the reconciler appends its
    // own managed closer instead of inlining the verdict instruction.
    const business: WorkflowStep = {
      id: 'step-business', name: '实现', agent: 'worker', task: '实现功能', provenance: { origin: 'user' },
    };
    const withCloser = reconcileReviewPolicy(state([business]), policy('standard', 'ai'), { availableAgents: ['worker'] }).nextState;
    const closerBefore = withCloser.steps.at(-1)!;
    expect(closerBefore.provenance?.managedRole).toBe('standard-closer');

    // Re-projecting the same state (each run rewrites only the rationale) must
    // not touch the managed closer.
    const again = reconcileReviewPolicy(withCloser, {
      ...policy('standard', 'ai'),
      rationale: '本次运行由 AI 评估当前状态风险后决定。',
    }, { availableAgents: ['worker'] });

    const closerAfter = again.nextState.steps.at(-1)!;
    expect(again.nextState.steps).toHaveLength(withCloser.steps.length);
    expect(closerAfter.task).toBe(closerBefore.task);
    expect(closerAfter.provenance?.managedRole).toBe('standard-closer');
    expect(again.operations).toHaveLength(0);
  });

  test('preserves an explicit self-transition limit during mode changes', () => {
    const business = withReviewStepBaseline({
      id: 'step-business', name: '实现', agent: 'worker', task: '实现功能',
    }, 'ai-draft');
    const explicit = { ...state([business]), maxSelfTransitions: 3 };
    const adversarial = reconcileReviewPolicy(explicit, policy('adversarial'), { availableAgents: ['worker'] }).nextState;
    expect(adversarial.maxSelfTransitions).toBe(3);
    const standard = reconcileReviewPolicy(adversarial, policy('standard'), { availableAgents: ['worker'] }).nextState;
    expect(standard.maxSelfTransitions).toBe(3);
  });

  test('direct terminal reconciliation removes an inapplicable policy', () => {
    const terminal = {
      ...state([{ id: 'summary', name: '汇总', agent: 'worker', task: '汇总' }], policy('adversarial')),
      isInitial: false,
      isFinal: true,
    };
    const result = reconcileReviewPolicy(terminal, policy('standard'), { availableAgents: ['worker'] });
    expect(result.blocked).toBe(true);
    expect(result.nextState.reviewPolicy).toBeUndefined();
  });

  test('reverses unmodified managed roles but preserves a user-edited attacker', () => {
    const business = withReviewStepBaseline({
      id: 'step-business', name: '实现', agent: 'worker', task: '实现功能',
    }, 'ai-draft');
    const adversarial = reconcileReviewPolicy(state([business]), policy('adversarial'), {
      availableAgents: ['worker'],
      idFactory: (() => { let id = 0; return () => `managed-${++id}`; })(),
    }).nextState;
    const attackerIndex = adversarial.steps.findIndex((step) => step.role === 'attacker');
    expect(isManagedStepUnmodified(adversarial.steps[attackerIndex])).toBe(true);
    adversarial.steps[attackerIndex] = {
      ...adversarial.steps[attackerIndex],
      task: `${adversarial.steps[attackerIndex].task}\n用户补充的审查范围`,
    };
    expect(adversarial.steps[attackerIndex].provenance?.baselineHash).not.toBe(hashReviewStep(adversarial.steps[attackerIndex]));

    const result = reconcileReviewPolicy(adversarial, policy('standard'), { availableAgents: ['worker'] });
    const preserved = result.nextState.steps.find((step) => step.id === adversarial.steps[attackerIndex].id);
    expect(result.blocked).toBe(false);
    expect(preserved).toMatchObject({ role: undefined, provenance: { origin: 'user' } });
    expect(preserved?.task).toContain('用户补充的审查范围');
    // A hand-edited managed step is reported as edited, not as "unknown origin".
    expect(result.warnings.join('')).toContain('已被手工修改');
    expect(result.warnings.join('')).not.toContain('状态级审查之前');
    expect(result.nextState.steps.some((step) => step.provenance?.managedRole === 'standard-closer')).toBe(true);
  });
});
