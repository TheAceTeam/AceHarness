import { describe, expect, test } from 'vitest';
import {
  WORKFLOW_CLARIFICATION_SUMMARY_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
  SPEC_CODING_META_KIND,
  SPEC_DECISION_KIND,
  SPEC_DESIGN_KIND,
  SPEC_REQUIREMENT_KIND,
  SPEC_TASK_KIND,
  applyWorkflowCreationItem,
  assembleClarificationForm,
  assemblePlanDraftFromItems,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
} from '@/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';

describe('workflow creation item protocol', () => {
  test('extracts one named item from the result channel', () => {
    const content = [
      '已确认摘要。',
      '<result>',
      JSON.stringify({
        kind: WORKFLOW_CLARIFICATION_SUMMARY_KIND,
        data: { summary: '创建一个按设计、实现、验证串行推进的工作流。' },
      }),
      '</result>',
    ].join('\n');

    const extracted = extractWorkflowCreationItemResult(content, WORKFLOW_CLARIFICATION_SUMMARY_KIND);

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.result).toMatchObject({
      kind: WORKFLOW_CLARIFICATION_SUMMARY_KIND,
      data: { summary: expect.stringContaining('串行推进') },
    });
  });

  test('assembles a clarification form and plan draft from small items', () => {
    let state = createEmptyWorkflowCreationState();
    const items = [
      { kind: WORKFLOW_CLARIFICATION_SUMMARY_KIND, data: { summary: '生成工作流创建向导。' } },
      { kind: SPEC_CODING_META_KIND, data: { summary: '分步创建工作流', goals: ['降低小模型压力'], nonGoals: ['迁移旧会话'], constraints: ['每轮只生成一个小点'], glossary: [{ term: '小点', definition: '一次 AI 调用只生成的单个结构化内容块。' }] } },
      { kind: SPEC_REQUIREMENT_KIND, data: { id: 'R1', title: '分步生成', userStory: '作为用户，我希望逐项确认内容。', acceptanceCriteria: ['WHEN 每个小点完成 THEN 页面能显示已确认内容。'] } },
      { kind: SPEC_DESIGN_KIND, data: { overview: '系统引导 AI 逐项输出，前端本地装配。', components: ['item runner', 'assembler'], interfaces: ['<result> item JSON'], dataModels: ['WorkflowCreationState 保存已确认小点。'], pseudocode: '1. 请求一个小点\n2. 校验并应用\n3. 刷新预览', keyCode: 'applyWorkflowCreationItem(state, item)', testPlan: ['运行 mock wrapper 测试'] } },
      { kind: SPEC_DECISION_KIND, data: { id: 'D1', topic: '输出协议', choice: '按 kind 输出小 JSON', reason: '降低一次性大 JSON 失败率' } },
      { kind: SPEC_TASK_KIND, data: { id: 'T1.1', title: '实现 item runner', requirementIds: ['R1'], designRefs: ['D1'], actions: ['顺序请求小点'], deliverables: ['可测试流程'], validation: '运行 mock 测试' } },
    ] as const;

    for (const item of items) {
      state = applyWorkflowCreationItem(state, item as any);
    }

    const clarification = assembleClarificationForm(state);
    const plan = assemblePlanDraftFromItems(state, {
      workflowName: '分步创建',
      filename: 'stepwise.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      requirements: '降低低端 AI 生成大 JSON 的失败率',
    });

    expect(clarification.summary).toContain('工作流创建向导');
    expect(plan.type).toBe('plan_draft');
    expect(plan.artifacts?.requirements).toContain('## 术语表');
    expect(plan.artifacts?.requirements).toContain('小点');
    expect(plan.artifacts?.requirements).toContain('分步生成');
    expect(plan.artifacts?.design).toContain('按 kind 输出小 JSON');
    expect(plan.artifacts?.design).toContain('## 数据模型');
    expect(plan.artifacts?.design).toContain('WorkflowCreationState');
    expect(plan.artifacts?.design).toContain('## 伪代码 / 关键代码');
    expect(plan.artifacts?.design).toContain('## 测试方案');
    expect(plan.artifacts?.tasks).toContain('T1.1');
    expect(plan.artifacts?.tasks).toContain('需求追踪：R1');
    expect(plan.artifacts?.tasks).toContain('设计追踪：D1');
    expect(plan.artifacts?.tasks).not.toContain('_需求：');
  });

  test('assembles a valid serial state-machine workflow from outline and state-step items', () => {
    let state = createEmptyWorkflowCreationState();
    const items = [
      { kind: SPEC_TASK_KIND, data: { id: 'T1.1', title: '设计方案', requirementIds: ['R1'], actions: ['产出设计'], deliverables: ['design.md'], validation: '审查设计' } },
      { kind: SPEC_TASK_KIND, data: { id: 'T2.1', title: '实现验证', requirementIds: ['R1'], actions: ['实现并测试'], deliverables: ['代码和测试'], validation: '运行测试' } },
      {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        data: {
          states: [
            { name: '设计', description: '确认设计方案' },
            { name: '实现', description: '完成实现和验证' },
            { name: '完成', description: '汇总结果', isFinal: true },
          ],
        },
      },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '设计',
          steps: [
            { name: '编写设计', agent: 'developer', task: '编写设计方案', specTaskBinding: { taskIds: ['T1.1'], requirementIds: ['R1'], artifactKeys: ['design'] } },
          ],
        },
      },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '实现',
          steps: [
            { name: '编码', agent: 'developer', task: '完成实现', parallelGroup: 'implementation', specTaskBinding: { taskIds: ['T2.1'], requirementIds: ['R1'], artifactKeys: ['tasks'] } },
            { name: '测试', agent: 'tester', task: '运行验证', parallelGroup: 'implementation', specTaskBinding: { taskIds: ['T2.1'], requirementIds: ['R1'], artifactKeys: ['tasks'] } },
          ],
        },
      },
    ] as const;

    for (const item of items) {
      state = applyWorkflowCreationItem(state, item as any);
    }

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: '串行状态工作流',
      filename: 'serial.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      requirements: '状态串行，步骤可并发',
      recommendedAgents: ['developer', 'tester'],
      recommendedSupervisorAgent: 'default-supervisor',
      specCoding: {
        tasks: [
          { id: 'T1.1', title: '设计方案' },
          { id: 'T2.1', title: '实现验证' },
        ],
      },
    });

    const states = config.workflow.states;
    expect(states.map((item: any) => item.name)).toEqual(['设计', '实现', '完成']);
    expect(states[0].transitions.map((item: any) => item.to)).toEqual(['实现', '实现', '设计']);
    expect(states[1].steps.map((item: any) => item.parallelGroup)).toEqual(['implementation', 'implementation']);
    expect(states.flatMap((state: any) => state.steps || []).map((step: any) => step.agent)).not.toContain('default-supervisor');

    const validation = validateWorkflowDraft(config, { mode: 'portable' });
    expect(validation.ok).toBe(true);
  });
});
