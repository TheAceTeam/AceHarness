import { describe, expect, test } from 'vitest';
import {
  SPEC_CODING_META_KIND,
  SPEC_REQUIREMENT_KIND,
  SPEC_TASK_KIND,
  WORKFLOW_CLARIFICATION_QUESTION_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
  applyWorkflowCreationItem,
  assembleClarificationForm,
  assemblePlanDraftFromItems,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
  validateWorkflowCreationItem,
} from '../src/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '../src/lib/core/creator-validation';

describe('AI Workflow Creation Experience', () => {
  test('clarification questions can be accepted one item at a time', () => {
    const firstQuestion = [
      '这个答案会影响后续任务拆分。',
      '<result>',
      JSON.stringify({
        kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
        data: {
          id: 'target_outcome',
          label: '目标结果',
          question: '这条工作流最终要交付什么结果？',
          selectionMode: 'single',
          options: [
            { id: 'code', label: '代码变更', description: '以实现和测试为主', recommended: true },
            { id: 'spec', label: '方案文档', description: '以设计制品为主' },
          ],
          placeholder: '默认按代码变更和测试证据交付。',
          required: true,
        },
      }),
      '</result>',
    ].join('\n');

    const extracted = extractWorkflowCreationItemResult(firstQuestion, WORKFLOW_CLARIFICATION_QUESTION_KIND);

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    const state = applyWorkflowCreationItem(createEmptyWorkflowCreationState(), extracted.result);
    const form = assembleClarificationForm(state);
    expect(form.questions).toHaveLength(1);
    expect(form.questions[0]).toMatchObject({
      id: 'target_outcome',
      label: '目标结果',
    });
  });

  test('invalid item feedback identifies the exact field and fix', () => {
    const validation = validateWorkflowCreationItem({
      kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
      data: {
        id: 'target_outcome',
        label: '目标结果',
        question: '',
        selectionMode: 'single',
        options: [{ id: 'code', label: '代码变更' }],
      },
    } as any);

    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    const message = validation.errors.join('\n');
    expect(message).toContain('错误字段：data.question');
    expect(message).toContain('修改方式');
  });

  test('spec plan is assembled from small named items instead of a monolithic plan JSON', () => {
    let state = createEmptyWorkflowCreationState();
    state = applyWorkflowCreationItem(state, {
      kind: SPEC_CODING_META_KIND,
      data: {
        summary: '在线文档协作编辑器',
        goals: ['多人协同编辑', '版本历史'],
        nonGoals: ['不重写存储层'],
        constraints: ['保持现有 UI 风格'],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: SPEC_REQUIREMENT_KIND,
      data: {
        id: 'R1',
        title: '实时协作',
        userStory: '作为团队成员，我希望多人同时编辑同一文档。',
        acceptanceCriteria: ['WHEN 多人编辑 THEN 1 秒内同步到其他用户。'],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: SPEC_TASK_KIND,
      data: {
        id: 'T1.1',
        title: '实现协作同步',
        requirementIds: ['R1'],
        actions: ['接入同步状态', '补充冲突测试'],
        deliverables: ['代码', '测试结果'],
        validation: '运行协作同步测试',
      },
    });

    const draft = assemblePlanDraftFromItems(state, {
      workflowName: 'collab-editor',
      filename: 'collab-editor.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      requirements: '多人在线文档协作',
    });

    expect(draft.type).toBe('plan_draft');
    expect(draft.artifacts?.requirements).toContain('## 术语表');
    expect(draft.artifacts?.design).toContain('## 数据模型');
    expect(draft.artifacts?.design).toContain('## 测试方案');
    expect(draft.artifacts?.requirements).toContain('实时协作');
    expect(draft.artifacts?.tasks).toContain('T1.1');
    expect(draft.artifacts?.tasks).toContain('需求追踪：R1');
  });

  test('workflow outline and state steps assemble serial states while allowing parallel steps only inside a state', () => {
    let state = createEmptyWorkflowCreationState();
    state = applyWorkflowCreationItem(state, {
      kind: SPEC_TASK_KIND,
      data: {
        id: 'T1.1',
        title: '实现与验证',
        requirementIds: ['R1'],
        actions: ['实现', '测试'],
        deliverables: ['代码', '测试结果'],
        validation: '运行测试',
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        states: [
          { name: '准备', description: '确认输入' },
          { name: '实现验证', description: '实现和测试' },
          { name: '完成', description: '汇总交付', isFinal: true },
        ],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '准备',
        steps: [{ name: '确认范围', agent: 'architect', task: '确认范围和风险' }],
      },
    });
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '实现验证',
        steps: [
          { name: '编码实现', agent: 'developer', task: '完成实现', parallelGroup: 'implementation' },
          { name: '测试验证', agent: 'tester', task: '运行测试', parallelGroup: 'implementation' },
        ],
      },
    });

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'collab-editor',
      filename: 'collab-editor.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      requirements: '多人在线文档协作',
      recommendedSupervisorAgent: 'default-supervisor',
    });

    expect(config.workflow.states.map((item: any) => item.name)).toEqual(['准备', '实现验证', '完成']);
    expect(config.workflow.states[1].steps.map((step: any) => step.parallelGroup)).toEqual(['implementation', 'implementation']);
    expect(config.workflow.states.flatMap((item: any) => item.steps || []).map((step: any) => step.agent)).not.toContain('default-supervisor');
    expect(validateWorkflowDraft(config).ok).toBe(true);
  });

  test('workflow step generation rejects agents outside the available roster so AI can repair them', () => {
    const validation = validateWorkflowCreationItem({
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '审查',
        steps: [
          { name: '审查结果', agent: 'reviewer', task: '审查实现结果' },
        ],
      },
    } as any, {
      expectedStateName: '审查',
      availableStepAgents: ['architect', 'tester'],
      supervisorAgents: ['default-supervisor'],
    });

    expect(validation.ok).toBe(false);
    if (validation.ok) return;
    const message = validation.errors.join('\n');
    expect(message).toContain('步骤 Agent "reviewer" 不在可用普通执行 Agent 列表中');
    expect(message).toContain('必须从这些 Agent 中选择：architect、tester');
  });
});
