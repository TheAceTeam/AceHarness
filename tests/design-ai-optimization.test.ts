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
});
