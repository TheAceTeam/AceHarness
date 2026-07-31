import { describe, expect, test } from 'vitest';
import { MockEngine } from './helpers/mock-engine';
import {
  applyDesignOptimizationPatch,
  buildDesignOptimizationPrompt,
  doesWorkflowPatchMatchTarget,
  type DesignOptimizationTarget,
  extractWorkflowPatchItemPayload,
} from '@/lib/workflow/design-ai-optimization';

describe('design optimization mock wrapper contract', () => {
  test('prompt steers AI toward workflow_patch_item and returned patch can be applied', async () => {
    const currentConfig = {
      workflow: {
        name: 'feature-delivery',
        mode: 'state-machine',
        states: [
          {
            name: '实现',
            isInitial: true,
            isFinal: true,
            steps: [
              {
                name: '编码实现',
                agent: 'developer',
                task: '完成核心实现',
                constraints: ['保持现有接口兼容'],
              },
            ],
            transitions: [],
          },
        ],
      },
      context: {
        projectRoot: '/repo/project',
        workspaceMode: 'in-place',
        requirements: '根据最新 spec 完成功能实现',
        engine: 'mock-engine',
      },
    };
    const target: DesignOptimizationTarget = {
      scope: 'step',
      workflowMode: 'state-machine',
      containerType: 'state',
      containerIndex: 0,
      containerName: '实现',
      stepIndex: 0,
      stepName: '编码实现',
    };

    const prompt = buildDesignOptimizationPrompt({
      target,
      workflowName: 'feature-delivery',
      configFile: 'feature-delivery.yaml',
      instruction: '优化该步骤的 agent、task 和 specTaskBinding，并保持只改当前步骤。',
      currentConfig,
      currentSpecArtifacts: {
        requirements: '# requirements.md\n\n- R1: 完成功能实现',
        design: '# design.md\n\n- 设计要求：保留现有接口',
        tasks: '# tasks.md\n\n- [ ] T1.1 编码实现',
      },
      requirements: '根据最新 spec 完成功能实现',
      availableAgents: [
        { name: 'developer', description: '负责编码实现' },
        { name: 'reviewer', description: '负责代码审查' },
      ],
      availableSkills: [{ name: 'vitest', description: '执行测试' }],
      specTasks: [{ id: 'T1.1', title: '编码实现', ownerAgents: ['developer'] }],
    });

    expect(prompt).toContain('workflow_patch_item');
    expect(prompt).toContain('"scope":"step"');
    expect(prompt).toContain('"patch":{"step":{完整步骤对象}}');

    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      expect(options.prompt).toContain('workflow_patch_item');
      expect(options.prompt).toContain('状态 "实现" 内的步骤 "编码实现"');
      return {
        success: true,
        output: [
          '下面是优化思路。',
          '<result>',
          JSON.stringify({
            kind: 'workflow_patch_item',
            data: {
              filename: 'feature-delivery.yaml',
              summary: '增强步骤的执行说明与绑定',
              scope: 'step',
              workflowMode: 'state-machine',
              patch: {
                step: {
                  name: '编码实现',
                  agent: 'developer',
                  task: '完成核心实现并补齐关键测试，然后输出变更说明',
                  constraints: ['保持现有接口兼容', '先运行相关测试'],
                  skills: ['vitest'],
                  specTaskBinding: {
                    taskId: 'T1.1',
                    taskIds: ['T1.1'],
                  },
                },
              },
            },
          }),
          '</result>',
        ].join('\n'),
      };
    };

    const result = await engine.execute({
      prompt,
      systemPrompt: 'system',
      model: 'mock-model',
    } as any);

    expect(result.success).toBe(true);
    const preview = extractWorkflowPatchItemPayload(result.output || '', 'feature-delivery.yaml');
    expect(preview.parseError).toBeUndefined();
    expect(preview.payload?.scope).toBe('step');
    expect(preview.payload?.patch?.step).toBeTruthy();

    const payload = preview.payload!;
    expect(doesWorkflowPatchMatchTarget(payload, target, currentConfig)).toBe(true);

    const nextConfig = applyDesignOptimizationPatch(currentConfig, payload, target);
    expect(nextConfig?.workflow.states[0].steps[0]).toMatchObject({
      name: '编码实现',
      agent: 'developer',
      skills: ['vitest'],
    });
    expect(nextConfig?.workflow.states[0].steps[0].task).toContain('补齐关键测试');
    expect(nextConfig?.context.projectRoot).toBe('/repo/project');
  });
});
