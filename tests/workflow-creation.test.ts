import { describe, expect, it } from 'vitest';
import {
  buildDashboardConversationSystemPrompt,
  buildDashboardSystemPrompt,
} from '../src/lib/chat/system-prompt';
import {
  SPEC_TASK_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
  applyWorkflowCreationItem,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
} from '../src/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '../src/lib/core/creator-validation';

describe('Workflow creation pipeline', () => {
  it('keeps dashboard chat on the modal handoff instead of the old full draft protocol', async () => {
    const systemPrompt = await buildDashboardSystemPrompt([], {
      personalDir: '/personal/work',
      workingDirectory: '/current/work',
    });

    expect(systemPrompt).toContain('home_sidebar');
    expect(systemPrompt).toContain('shouldOpenModal:true');
    expect(systemPrompt).toContain('workflow_state_steps');
    expect(systemPrompt).toContain('API 查询类 action 执行后');
    expect(systemPrompt).toContain('config.list');
    expect(systemPrompt).toContain('kind="card"');
    expect(systemPrompt).not.toContain('workflow_draft');
    expect(systemPrompt).toContain('个人用户工作目录: /personal/work');
    expect(systemPrompt).toContain('当前工作目录: /current/work');
    expect(systemPrompt.match(/当前工作目录:/g)).toHaveLength(1);
    expect(systemPrompt.match(/AI 运行目录/g)).toHaveLength(1);
    expect(systemPrompt.match(/Skills 运行目录/g)).toHaveLength(1);
  });

  it('builds a regular engineering prompt without creation-assistant handoff rules', async () => {
    const systemPrompt = await buildDashboardConversationSystemPrompt([], {
      personalDir: '/personal/work',
      workingDirectory: '/current/work',
    });

    expect(systemPrompt).toContain('CSIHarness 工程对话助手');
    expect(systemPrompt).toContain('未启用 workflow / Agent 创建助手模式');
    expect(systemPrompt).toContain('不要使用 `aceharness-workflow-creator` Skill');
    expect(systemPrompt).not.toContain('你是 ACEHarness 工作流助手');
    expect(systemPrompt).not.toContain('必须通过输出 `home_sidebar`');
    expect(systemPrompt).toContain('当前工作目录: /current/work');
  });

  it('extracts and applies the current workflow item protocol', () => {
    const output = [
      '先给出实现状态的步骤。',
      '<result>',
      JSON.stringify({
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '实现',
          steps: [
            {
              name: '编码实现',
              agent: 'developer',
              task: '完成核心实现并输出变更说明',
              specTaskBinding: {
                taskIds: ['T1.1'],
                requirementIds: ['R1'],
                artifactKeys: ['tasks'],
              },
            },
          ],
        },
      }),
      '</result>',
    ].join('\n');

    const extracted = extractWorkflowCreationItemResult(output, WORKFLOW_STATE_STEPS_KIND);

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const state = applyWorkflowCreationItem(createEmptyWorkflowCreationState(), extracted.result);
    expect(state.workflow.stateSteps['实现'][0]).toMatchObject({
      name: '编码实现',
      agent: 'developer',
    });
  });

  it('assembles a valid serial workflow from outline and per-state step items', () => {
    let state = createEmptyWorkflowCreationState();
    state = applyWorkflowCreationItem(state, {
      kind: SPEC_TASK_KIND,
      data: {
        id: 'T1.1',
        title: '实现功能',
        requirementIds: ['R1'],
        actions: ['编码', '补测试'],
        deliverables: ['代码与测试结果'],
        validation: '运行相关测试',
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        states: [
          { name: '设计', description: '确认实现方案' },
          { name: '实现', description: '完成编码和验证' },
          { name: '完成', description: '汇总交付', isFinal: true },
        ],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '设计',
        steps: [{ name: '设计方案', agent: 'architect', task: '确认实现方案' }],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '实现',
        steps: [
          {
            name: '编码实现',
            agent: 'developer',
            task: '完成实现',
            specTaskBinding: { taskIds: ['T1.1'], requirementIds: ['R1'], artifactKeys: ['tasks'] },
          },
        ],
      },
    });

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'Todo API',
      filename: 'todo-api.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      requirements: 'Build a REST API for a todo-list application with authentication',
      recommendedSupervisorAgent: 'default-supervisor',
    });

    expect(config.workflow.states.map((item: any) => item.name)).toEqual(['设计', '实现', '完成']);
    expect(config.workflow.states[0].transitions.map((item: any) => item.to)).toEqual(['实现', '实现', '设计']);
    expect(config.workflow.states.flatMap((item: any) => item.steps || []).map((step: any) => step.agent)).not.toContain('default-supervisor');

    const validation = validateWorkflowDraft(config);
    expect(validation.ok).toBe(true);
    expect(validation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });
});
