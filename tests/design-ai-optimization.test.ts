import { describe, expect, test } from 'vitest';
import {
  applyDesignOptimizationPatch,
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
        mode: 'phase-based',
        phases: [{ name: 'Build', steps: [{ name: 'Code', agent: 'dev', task: 'write code' }] }],
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
      workflowMode: 'phase-based',
      workflowName: 'demo',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'workflow',
      workflowMode: 'phase-based',
      patch: {
        workflow: {
          name: 'demo-v2',
          mode: 'phase-based',
          phases: [{ name: 'Review', steps: [{ name: 'Check', agent: 'qa', task: 'review code' }] }],
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
        mode: 'phase-based',
        phases: [
          {
            name: 'Build',
            steps: [
              { name: 'Code', agent: 'dev', task: 'write code' },
              { name: 'Test', agent: 'qa', task: 'run tests' },
            ],
          },
        ],
      },
      context: { projectRoot: '/repo/demo' },
    };
    const target: DesignOptimizationTarget = {
      scope: 'step',
      workflowMode: 'phase-based',
      containerType: 'phase',
      containerIndex: 0,
      containerName: 'Build',
      stepIndex: 1,
      stepName: 'Test',
    };
    const payload: WorkflowPatchPayload = {
      scope: 'step',
      workflowMode: 'phase-based',
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

    expect(next?.workflow.phases[0].steps[0].task).toBe('write code');
    expect(next?.workflow.phases[0].steps[1]).toMatchObject({
      task: 'run unit and integration tests',
      skills: ['vitest'],
    });
  });

  test('rejects mismatched workflow mode and exposes scoped snapshots', () => {
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
      scope: 'step',
      workflowMode: 'phase-based',
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
});
