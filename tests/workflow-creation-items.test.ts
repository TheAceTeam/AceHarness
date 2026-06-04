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
  validateWorkflowCreationItem,
} from '@/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';

function applyItems(items: Array<{ kind: any; data: any }>) {
  let state = createEmptyWorkflowCreationState();
  for (const item of items) {
    state = applyWorkflowCreationItem(state, item as any);
  }
  return state;
}

function assembleForTest(state: ReturnType<typeof createEmptyWorkflowCreationState>, overrides: Record<string, any> = {}) {
  return assembleWorkflowConfigFromItems(state, {
    workflowName: '测试工作流',
    filename: 'test-workflow.yaml',
    workingDirectory: process.cwd(),
    workspaceMode: 'in-place',
    requirements: '验证工作流装配',
    recommendedAgents: ['architect', 'developer', 'tester'],
    recommendedSupervisorAgent: 'default-supervisor',
    ...overrides,
  });
}

function fallbackTransitionMap(transitions: any[]) {
  return Object.fromEntries(transitions
    .filter((transition) => !transition.condition?.issueTypes?.length
      && !transition.condition?.severities?.length
      && transition.condition?.minIssueCount === undefined
      && transition.condition?.maxIssueCount === undefined
      && !transition.condition?.custom)
    .map((transition) => [transition.condition.verdict, transition]));
}

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

  test('rejects workflow state steps that use supervisor as a task agent', () => {
    const validation = validateWorkflowCreationItem({
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '实现',
        steps: [
          { name: '协调实现', agent: 'supervisor', task: '安排执行计划' },
        ],
      },
    }, {
      expectedStateName: '实现',
      availableStepAgents: ['architect', 'developer', 'tester'],
      supervisorAgents: ['default-supervisor', 'chief-supervisor'],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors.join('\n')).toContain('data.steps[0].agent');
    expect(validation.errors.join('\n')).toContain('不允许作为执行步骤 Agent');
  });

  test('rejects workflow state steps with the wrong state or unavailable agent before assembly', () => {
    const content = [
      '<result>',
      JSON.stringify({
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '验证',
          steps: [
            { name: '实现', agent: 'unknown-agent', task: '完成实现' },
          ],
        },
      }),
      '</result>',
    ].join('\n');

    const extracted = extractWorkflowCreationItemResult(content, WORKFLOW_STATE_STEPS_KIND, {
      expectedStateName: '实现',
      availableStepAgents: ['developer'],
      supervisorAgents: ['default-supervisor'],
    });

    expect(extracted.ok).toBe(false);
    if (extracted.ok) return;
    expect(extracted.error).toContain('stateName 应为 "实现"');
    expect(extracted.error).toContain('不在可用普通执行 Agent 列表中');
  });

  test('reports malformed result blocks with parse diagnostics', () => {
    const extracted = extractWorkflowCreationItemResult(
      '<result>{"kind":"workflow_state_steps","data": </result>',
      WORKFLOW_STATE_STEPS_KIND,
    );

    expect(extracted.ok).toBe(false);
    if (extracted.ok) return;
    expect(extracted.error).toContain('<result> 块无法匹配');
    expect(extracted.error).toContain('JSON 解析失败');
    expect(extracted.error).toContain('内容片段');
    expect(extracted.error).toContain('修改方式');
  });

  test('reports spec requirement missing fields with exact aliases and current values', () => {
    const validation = validateWorkflowCreationItem({
      kind: SPEC_REQUIREMENT_KIND,
      data: {
        title: '',
        acceptanceCriteria: 'done',
      },
    } as any);

    expect(validation.ok).toBe(false);
    const message = validation.errors.join('\n');
    expect(message).toContain('错误字段：data.title');
    expect(message).toContain('data.title=string');
    expect(message).toContain('错误字段：data.userStory');
    expect(message).toContain('data.description=未提供');
    expect(message).toContain('错误字段：data.acceptanceCriteria');
    expect(message).toContain('修改方式');
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

  test('assembles direct workflow without spec task bindings when spec planning is skipped', () => {
    const state = applyItems([
      {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        data: {
          states: [
            { name: '分析需求', description: '理解用户输入', isInitial: true },
            { name: '执行业务任务', description: '按需求完成业务处理' },
            { name: '完成', description: '汇总交付', isFinal: true },
          ],
        },
      },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '分析需求',
          steps: [{ name: '读取需求', agent: 'architect', task: '分析用户提出的实际业务需求' }],
        },
      },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '执行业务任务',
          steps: [{ name: '完成任务', agent: 'developer', task: '直接完成用户要求的业务任务' }],
        },
      },
    ]);

    const config = assembleForTest(state, {
      workflowName: '直接业务工作流',
      requirements: '直接完成用户的业务需求，不创建 Spec',
      includeSpecTaskBindings: false,
      specCoding: undefined,
    });

    const steps = config.workflow.states.flatMap((item: any) => item.steps || []);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every((step: any) => step.specTaskBinding === undefined)).toBe(true);
    expect(steps.map((step: any) => step.task).join('\n')).toContain('业务');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });

  test('preserves explicit state-machine transition targets from outline and state-step items', () => {
    const state = applyItems([
      {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        data: {
          states: [
            { name: '设计', description: '确认方案' },
            {
              name: '实现',
              description: '实现功能',
              transitions: [
                { to: '审查', condition: { verdict: 'pass' }, label: '实现完成，进入审查' },
                { to: '实现', condition: { verdict: 'conditional_pass' }, label: '小问题继续实现' },
                { to: '设计', condition: { verdict: 'fail' }, label: '方案失配，返回设计' },
              ],
            },
            {
              name: '审查',
              description: '验证和裁决',
              transitions: [
                { to: '完成', condition: { verdict: 'pass' }, label: '审查通过' },
                { to: '实现', condition: { verdict: 'conditional_pass' }, label: '带条件返工' },
                { to: '设计', condition: { verdict: 'fail' }, label: '重新设计' },
              ],
            },
            { name: '完成', description: '汇总结果', isFinal: true },
          ],
        },
      },
      { kind: WORKFLOW_STATE_STEPS_KIND, data: { stateName: '设计', steps: [{ name: '设计方案', agent: 'architect', task: '产出设计' }] } },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '实现',
          steps: [{ name: '编码实现', agent: 'developer', task: '实现并自测' }],
          transitions: [
            { to: '审查', condition: { verdict: 'pass' }, label: '提交审查' },
            { to: '实现', condition: { verdict: 'conditional_pass' }, label: '继续完善' },
            { to: '设计', condition: { verdict: 'fail' }, label: '退回设计' },
          ],
        },
      },
      { kind: WORKFLOW_STATE_STEPS_KIND, data: { stateName: '审查', steps: [{ name: '审查结果', agent: 'tester', task: '验证并裁决' }] } },
    ]);

    const config = assembleForTest(state);
    const states = config.workflow.states;
    const designFallbacks = fallbackTransitionMap(states[0].transitions);
    const implementationFallbacks = fallbackTransitionMap(states[1].transitions);
    const reviewFallbacks = fallbackTransitionMap(states[2].transitions);

    expect(designFallbacks.pass.to).toBe('实现');
    expect(designFallbacks.conditional_pass.to).toBe('实现');
    expect(designFallbacks.fail.to).toBe('设计');
    expect(implementationFallbacks.pass.to).toBe('审查');
    expect(implementationFallbacks.conditional_pass.to).toBe('实现');
    expect(implementationFallbacks.fail.to).toBe('设计');
    expect(reviewFallbacks.pass.to).toBe('完成');
    expect(reviewFallbacks.conditional_pass.to).toBe('实现');
    expect(reviewFallbacks.fail.to).toBe('设计');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });

  test('keeps advanced transition filters and fills missing verdict paths', () => {
    const state = applyItems([
      {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        data: {
          states: [
            { name: '实现', description: '实现核心能力' },
            {
              name: '验证',
              description: '检查质量',
              transitions: [
                { to: '完成', condition: { verdict: 'pass', issueTypes: ['test'] }, label: '测试专项通过' },
                { to: '实现', condition: { verdict: 'fail', severities: ['major'] }, label: '重大问题返工' },
              ],
            },
            { name: '完成', description: '汇总交付', isFinal: true },
          ],
        },
      },
      { kind: WORKFLOW_STATE_STEPS_KIND, data: { stateName: '实现', steps: [{ name: '实现', agent: 'developer', task: '完成实现' }] } },
      { kind: WORKFLOW_STATE_STEPS_KIND, data: { stateName: '验证', steps: [{ name: '验证', agent: 'tester', task: '运行测试' }] } },
    ]);

    const config = assembleForTest(state);
    const validationState = config.workflow.states.find((item: any) => item.name === '验证');
    const fallbackMap = fallbackTransitionMap(validationState.transitions);

    expect(validationState.transitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: '完成', condition: expect.objectContaining({ verdict: 'pass', issueTypes: ['test'] }) }),
      expect.objectContaining({ to: '实现', condition: expect.objectContaining({ verdict: 'fail', severities: ['major'] }) }),
    ]));
    expect(fallbackMap.pass.to).toBe('完成');
    expect(fallbackMap.conditional_pass.to).toBe('完成');
    expect(fallbackMap.fail.to).toBe('验证');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });

  test('deduplicates fallback verdict transitions and replaces configured supervisor step agents', () => {
    const state = applyItems([
      {
        kind: WORKFLOW_STATE_OUTLINE_KIND,
        data: {
          states: [
            {
              name: '处理',
              transitions: [
                { to: '完成', condition: { verdict: 'pass' }, label: '第一条通过' },
                { to: '处理', condition: { verdict: 'pass' }, label: '重复通过应被忽略' },
                { to: '未知状态', condition: { verdict: 'fail' }, label: '非法目标应回到默认目标' },
                { to: '完成', condition: { custom: 'legacy-extra-rule' }, label: '无 verdict 的旧规则应被忽略' },
              ],
            },
            { name: '完成', isFinal: true },
          ],
        },
      },
      {
        kind: WORKFLOW_STATE_STEPS_KIND,
        data: {
          stateName: '处理',
          steps: [
            { name: '规划', agent: 'chief-supervisor', task: '规划任务' },
            { name: '执行', agent: 'default-supervisor', task: '执行任务' },
          ],
        },
      },
    ]);

    const config = assembleForTest(state, {
      recommendedAgents: ['developer', 'tester'],
      recommendedSupervisorAgent: 'chief-supervisor',
    });
    const stateConfig = config.workflow.states[0];
    const fallbackMap = fallbackTransitionMap(stateConfig.transitions);

    expect(stateConfig.transitions.filter((transition: any) => transition.condition.verdict === 'pass')).toHaveLength(1);
    expect(fallbackMap.pass.to).toBe('完成');
    expect(fallbackMap.conditional_pass.to).toBe('完成');
    expect(fallbackMap.fail.to).toBe('处理');
    expect(stateConfig.steps.map((step: any) => step.agent)).not.toContain('chief-supervisor');
    expect(stateConfig.steps.map((step: any) => step.agent)).not.toContain('default-supervisor');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });
});
