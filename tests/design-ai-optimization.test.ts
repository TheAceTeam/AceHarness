import { describe, expect, test } from 'vitest';
import {
  applyDesignOptimizationPatch,
  buildDesignOptimizationPrompt,
  doesWorkflowPatchMatchTarget,
  extractDesignOptimizationSnapshot,
  extractWorkflowPatchItemPayload,
  extractWorkflowPatchValue,
  type DesignOptimizationTarget,
  type WorkflowPatchPayload,
} from '@/lib/workflow/design-ai-optimization';
import {
  isStepBaselineUnmodified,
} from '@/lib/workflow/state-review-policy';

describe('design-ai-optimization', () => {
  test('applies workflow-scope patch without overwriting preserved context', () => {
    const baseConfig = {
      workflow: {
        name: 'demo',
        mode: 'state-machine',
        states: [{ name: 'Build', isInitial: true, isFinal: true, steps: [{ name: 'Code', agent: 'dev', task: 'write code' }], transitions: [] }],
      },
      context: {
        projectRoot: '/repo/demo',
        workspaceMode: 'in-place',
        engine: 'codex',
        extraFlag: 'keep-me',
      },
      roles: [{ name: 'dev' }],
    };
    const target: DesignOptimizationTarget = {
      scope: 'workflow',
      workflowMode: 'state-machine',
      workflowName: 'demo',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'workflow',
      workflowMode: 'state-machine',
      patch: {
        workflow: {
          name: 'demo-v2',
          mode: 'state-machine',
          states: [{ name: 'Review', isInitial: true, isFinal: true, steps: [{ name: 'Check', agent: 'qa', task: 'review code' }], transitions: [] }],
        },
      },
    };

    const next = applyDesignOptimizationPatch(baseConfig, payload, target);

    expect(next?.workflow.name).toBe('demo-v2');
    expect(next?.context.projectRoot).toBe('/repo/demo');
    expect(next?.context.workspaceMode).toBe('in-place');
    expect(next?.context.engine).toBe('codex');
    expect(next?.context.extraFlag).toBe('keep-me');
    expect(next?.roles).toEqual([{ name: 'dev' }]);
  });

  test('applies state-scope patch to the selected state only', () => {
    const baseConfig = {
      workflow: {
        name: 'state-demo',
        mode: 'state-machine',
        states: [
          { name: 'Draft', steps: [{ name: 'Write', agent: 'writer', task: 'draft' }], transitions: [] },
          { name: 'Review', steps: [{ name: 'Check', agent: 'reviewer', task: 'review' }], transitions: [] },
        ],
      },
      context: { projectRoot: '/repo/demo' },
    };
    const target: DesignOptimizationTarget = {
      scope: 'state',
      workflowMode: 'state-machine',
      stateIndex: 1,
      stateName: 'Review',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'state',
      workflowMode: 'state-machine',
      patch: {
        state: {
          name: 'Review',
          description: 'optimized',
          steps: [{ name: 'Deep Review', agent: 'reviewer', task: 'deep review' }],
          transitions: [{ to: 'Draft', condition: { verdict: 'fail' } }],
        },
      },
    };

    const next = applyDesignOptimizationPatch(baseConfig, payload, target);

    expect(next?.workflow.states[0].name).toBe('Draft');
    expect(next?.workflow.states[1]).toMatchObject({
      name: 'Review',
      description: 'optimized',
    });
  });

  test('applies step-scope patch to the selected step only', () => {
    const baseConfig = {
      workflow: {
        name: 'demo',
        mode: 'state-machine',
        states: [
          {
            name: 'Build',
            isInitial: true,
            isFinal: true,
            steps: [
              { name: 'Code', agent: 'dev', task: 'write code' },
              { name: 'Test', agent: 'qa', task: 'run tests' },
            ],
            transitions: [],
          },
        ],
      },
      context: { projectRoot: '/repo/demo' },
    };
    const target: DesignOptimizationTarget = {
      scope: 'step',
      workflowMode: 'state-machine',
      containerType: 'state',
      containerIndex: 0,
      containerName: 'Build',
      stepIndex: 1,
      stepName: 'Test',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'step',
      workflowMode: 'state-machine',
      patch: {
        step: {
          name: 'Test',
          agent: 'qa',
          task: 'run unit and integration tests',
          skills: ['vitest'],
        },
      },
    };

    const next = applyDesignOptimizationPatch(baseConfig, payload, target);

    expect(next?.workflow.states[0].steps[0].task).toBe('write code');
    expect(next?.workflow.states[0].steps[1]).toMatchObject({
      task: 'run unit and integration tests',
      skills: ['vitest'],
    });
  });

  test('rejects a mismatched patch scope and exposes scoped snapshots', () => {
    const config = {
      workflow: {
        name: 'demo',
        mode: 'state-machine',
        states: [{ name: 'Draft', steps: [{ name: 'Write', agent: 'writer', task: 'draft' }], transitions: [] }],
      },
    };
    const target: DesignOptimizationTarget = {
      scope: 'step',
      workflowMode: 'state-machine',
      containerType: 'state',
      containerIndex: 0,
      containerName: 'Draft',
      stepIndex: 0,
      stepName: 'Write',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'state',
      workflowMode: 'state-machine',
      patch: {
        step: { name: 'Write', agent: 'writer', task: 'rewrite draft' },
      },
    };

    expect(doesWorkflowPatchMatchTarget(payload, target, config)).toBe(false);
    expect(extractWorkflowPatchValue(payload, target)).toMatchObject({
      task: 'rewrite draft',
    });
    expect(extractDesignOptimizationSnapshot(config, target)).toMatchObject({
      name: 'Write',
      agent: 'writer',
    });
  });

  test('workflow patch parse errors include exact field values and fixes', () => {
    const result = extractWorkflowPatchItemPayload([
      '<result>',
      JSON.stringify({
        kind: 'workflow_patch_item',
        data: {
          scope: 'state',
          workflowMode: 'state-machine',
          patch: { step: { name: 'Wrong bucket' } },
        },
      }),
      '</result>',
    ].join('\n'), 'demo.yaml');

    expect(result.payload).toBeNull();
    expect(result.parseError).toContain('错误字段：data.patch.state');
    expect(result.parseError).toContain('patch keys=step');
    expect(result.parseError).toContain('修改方式');
  });

  test('builds an optimization prompt without requiring spec artifacts', () => {
    const prompt = buildDesignOptimizationPrompt({
      target: {
        scope: 'workflow',
        workflowMode: 'state-machine',
        workflowName: 'direct-workflow',
      },
      workflowName: 'direct-workflow',
      configFile: 'direct-workflow.yaml',
      instruction: '把流程改成先分析再执行再验证',
      currentConfig: {
        workflow: {
          name: 'direct-workflow',
          mode: 'state-machine',
          states: [{ name: '执行', steps: [{ name: '处理', agent: 'developer', task: '处理需求' }] }],
        },
      },
      currentSpecArtifacts: { requirements: '', design: '', tasks: '' },
      requirements: '直接根据用户需求处理业务任务',
    });

    expect(prompt).toContain('当前没有 Spec 制品');
    expect(prompt).toContain('不要新增 specTaskBinding');
    expect(prompt).toContain('workflow_patch_item');
    expect(prompt).not.toContain('当前 requirements.md');
  });

  test('preserves stable step metadata when applying a step patch', () => {
    const baseConfig = {
      workflow: {
        name: 'state-demo',
        mode: 'state-machine',
        states: [{
          name: '执行',
          steps: [{
            id: 'step-1',
            name: '实现',
            agent: 'developer',
            task: '实现功能',
            provenance: { origin: 'ai-draft', baselineHash: 'review-step:v1:abc' },
          }],
          transitions: [],
        }],
      },
    };
    const target: DesignOptimizationTarget = {
      scope: 'step', workflowMode: 'state-machine', containerType: 'state', containerIndex: 0,
      containerName: '执行', stepIndex: 0, stepName: '实现',
    };
    const next = applyDesignOptimizationPatch(baseConfig, {
      scope: 'step', workflowMode: 'state-machine',
      patch: { step: { name: '实现', agent: 'developer', task: '实现并验证功能', id: 'model-id' } },
    }, target);

    expect(next?.workflow.states[0].steps[0]).toMatchObject({
      id: 'step-1', task: '实现并验证功能', provenance: { origin: 'ai-draft' },
    });
    expect(next?.workflow.states[0].steps[0].provenance.baselineHash).not.toBe('review-step:v1:abc');
    expect(isStepBaselineUnmodified(next?.workflow.states[0].steps[0])).toBe(true);
  });

  test('step patches cannot forge locked review identities or role bindings', () => {
    const baseStep = {
      id: 'defender-1', name: '实现', agent: 'developer', task: '实现功能', role: 'defender',
      agentInstanceId: 'instance-defender', parallelGroup: 'defenders',
      concurrency: { groupId: 'defenders', joinPolicy: { mode: 'all' } },
      provenance: { origin: 'user' },
    };
    const baseConfig = {
      workflow: {
        name: 'identity-demo', mode: 'state-machine', states: [{
          id: 'state-1', name: '执行',
          reviewPolicy: {
            mode: 'adversarial', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '用户锁定',
          },
          steps: [baseStep], transitions: [],
        }],
      },
    };
    const next = applyDesignOptimizationPatch(baseConfig, {
      scope: 'step', workflowMode: 'state-machine', patch: { step: {
        id: 'model-id', name: '实现', agent: 'other', task: '优化实现', role: 'judge',
        agentInstanceId: 'forged', parallelGroup: 'unsafe',
        concurrency: { groupId: 'unsafe', joinPolicy: { mode: 'any' } },
        provenance: { origin: 'review-policy' },
      } },
    }, {
      scope: 'step', workflowMode: 'state-machine', containerType: 'state', containerIndex: 0,
      containerName: '执行', stepIndex: 0, stepName: '实现',
    });

    expect(next?.workflow.states[0].steps[0]).toMatchObject({
      id: 'defender-1', agent: 'developer', task: '优化实现', role: 'defender',
      agentInstanceId: 'instance-defender', parallelGroup: 'defenders',
      concurrency: { groupId: 'defenders', joinPolicy: { mode: 'all' } },
      provenance: { origin: 'user' },
    });
  });

  test('direct step optimization rejects policy-managed adversarial tail steps', () => {
    const baseConfig = {
      workflow: {
        name: 'managed-demo', mode: 'state-machine', states: [{
          name: '执行',
          reviewPolicy: { mode: 'adversarial', source: 'ai', locked: false, confidence: 'high', riskSignals: [], rationale: '高风险' },
          steps: [{
            id: 'attacker', name: '对抗审查', agent: 'reviewer', task: '找反例', role: 'attacker',
            agentInstanceId: 'attacker-instance',
            provenance: { origin: 'review-policy', managedRole: 'attacker', baselineHash: 'review-step:v1:x' },
          }],
          transitions: [],
        }],
      },
    };
    expect(applyDesignOptimizationPatch(baseConfig, {
      scope: 'step', workflowMode: 'state-machine', patch: { step: { name: '对抗审查', task: '覆盖托管提示词' } },
    }, {
      scope: 'step', workflowMode: 'state-machine', containerType: 'state', containerIndex: 0,
      containerName: '执行', stepIndex: 0, stepName: '对抗审查',
    })).toBeNull();
  });

  test('protects locked policy-managed steps from state patches', () => {
    const lockedState = {
      id: 'state-review', name: '评审',
      reviewPolicy: {
        mode: 'adversarial', source: 'user', locked: true, confidence: 'high', rationale: '用户锁定', riskSignals: ['高风险'],
      },
      steps: [
        { id: 'business', name: '实现', agent: 'dev', task: '实现', role: 'defender' },
        {
          id: 'attacker', name: '攻击审查', agent: 'reviewer', task: '寻找反例', role: 'attacker',
          provenance: { origin: 'review-policy', managedRole: 'attacker', baselineHash: 'review-step:v1:a' },
        },
      ],
      transitions: [],
    };
    const next = applyDesignOptimizationPatch({
      workflow: { name: 'locked-demo', mode: 'state-machine', states: [lockedState] },
    }, {
      scope: 'state', workflowMode: 'state-machine', patch: { state: {
        ...lockedState,
        description: '业务描述可优化',
        reviewPolicy: { ...lockedState.reviewPolicy, mode: 'standard' },
        steps: [{ id: 'business', name: '实现', agent: 'dev', task: '优化后的实现' }],
      } },
    }, {
      scope: 'state', workflowMode: 'state-machine', stateIndex: 0, stateName: '评审',
    });

    expect(next?.workflow.states[0].description).toBe('业务描述可优化');
    expect(next?.workflow.states[0].reviewPolicy).toEqual(lockedState.reviewPolicy);
    expect(next?.workflow.states[0].steps).toContainEqual(lockedState.steps[1]);
  });

  test('applies review-policy-only AI output through the local reconciler', () => {
    const baseConfig = {
      workflow: {
        name: 'review-only', mode: 'state-machine', states: [{
          id: 'state-1', name: '执行', isInitial: true, isFinal: false, maxSelfTransitions: 3,
          reviewPolicy: {
            mode: 'standard', source: 'ai', locked: false, confidence: 'medium', riskSignals: [], rationale: '低风险',
          },
          steps: [{ id: 'step-1', name: '实现', agent: 'worker', task: '实现功能', provenance: { origin: 'user' } }],
          transitions: [],
        }],
      },
    };
    const target: DesignOptimizationTarget = {
      scope: 'state', workflowMode: 'state-machine', stateIndex: 0, stateId: 'state-1', stateName: '执行', reviewPolicyOnly: true,
    };
    const next = applyDesignOptimizationPatch(baseConfig, {
      scope: 'state', workflowMode: 'state-machine', patch: { state: {
        reviewPolicy: {
          mode: 'adversarial', confidence: 'high', riskSignals: ['跨模块'], rationale: '需要独立挑战',
        },
        name: '模型试图重命名',
        transitions: [{ to: '错误目标' }],
      } },
    }, target);

    expect(next?.workflow.states[0].name).toBe('执行');
    expect(next?.workflow.states[0].transitions).toEqual([]);
    expect(next?.workflow.states[0].reviewPolicy).toMatchObject({ mode: 'adversarial', source: 'ai', locked: false });
    expect(next?.workflow.states[0].steps.map((step: any) => step.role)).toEqual(['defender', 'attacker', 'judge']);
  });

  test('only unlocks a locked review policy when the target carries explicit hand-back intent', () => {
    const baseConfig = {
      workflow: {
        name: 'locked-review', mode: 'state-machine', states: [{
          id: 'state-1', name: '执行', isInitial: true, isFinal: false,
          reviewPolicy: {
            mode: 'standard', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '用户锁定',
          },
          steps: [{ id: 'step-1', name: '实现', agent: 'worker', task: '实现功能', provenance: { origin: 'user' } }],
          transitions: [],
        }],
      },
    };
    const payload = {
      scope: 'state' as const,
      workflowMode: 'state-machine' as const,
      patch: { state: { reviewPolicy: {
        mode: 'adversarial', confidence: 'high', riskSignals: ['高风险'], rationale: '重新评估',
      } } },
    };
    const target = {
      scope: 'state' as const, workflowMode: 'state-machine' as const,
      stateIndex: 0, stateId: 'state-1', stateName: '执行', reviewPolicyOnly: true,
    };

    expect(applyDesignOptimizationPatch(baseConfig, payload, target)).toBeNull();
    expect(applyDesignOptimizationPatch(baseConfig, payload, { ...target, unlockForAi: true })?.workflow.states[0].reviewPolicy)
      .toMatchObject({ mode: 'adversarial', source: 'ai', locked: false });
  });

  test('rejects workflow patches that remove a locked review state', () => {
    const lockedState = {
      id: 'state-locked', name: '锁定状态',
      reviewPolicy: {
        mode: 'standard', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '用户锁定',
      },
      steps: [{ id: 'step-1', name: '执行', agent: 'worker', task: '执行' }], transitions: [],
    };
    expect(applyDesignOptimizationPatch({
      workflow: { name: 'locked', mode: 'state-machine', states: [lockedState] },
    }, {
      scope: 'workflow', workflowMode: 'state-machine',
      patch: { workflow: { name: 'locked', mode: 'state-machine', states: [] } },
    }, {
      scope: 'workflow', workflowMode: 'state-machine', workflowName: 'locked',
    })).toBeNull();
  });

  test('review-only prompts exclude workflow structure changes and non-executable agents', () => {
    const prompt = buildDesignOptimizationPrompt({
      target: {
        scope: 'state', workflowMode: 'state-machine', stateIndex: 0, stateId: 'state-1', stateName: '执行', reviewPolicyOnly: true,
      },
      workflowName: 'review-only', configFile: 'review-only.yaml', instruction: '重新评估',
      currentConfig: {
        workflow: { name: 'review-only', mode: 'state-machine', states: [{ id: 'state-1', name: '执行', steps: [] }] },
      },
      availableAgents: [
        { name: 'worker', team: 'blue' },
        { name: 'supervisor', team: 'black-gold', roleType: 'supervisor' },
      ],
    });
    expect(prompt).toContain('只重新评估状态');
    expect(prompt).toContain('patch.state 只包含 reviewPolicy');
    expect(prompt).toContain('worker');
    expect(prompt).not.toContain('- supervisor |');
  });
});
