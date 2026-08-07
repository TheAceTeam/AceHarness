import { describe, expect, test } from 'vitest';
import {
  applyWorkflowCreationItem,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
  validateWorkflowCreationItem,
  WORKFLOW_CLARIFICATION_BUNDLE_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
} from '@/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';

describe('workflow creation item assembly', () => {
  test('validates and applies a bundled clarification response in one item', () => {
    const result = {
      kind: WORKFLOW_CLARIFICATION_BUNDLE_KIND,
      data: {
        summary: '读取当前项目并输出只读体检报告。',
        facts: ['只读分析', '输出三个改进建议'],
        gaps: [],
        questions: [{
          id: 'validation_evidence',
          label: '验证证据',
          question: '体检报告应采用哪种验收方式？',
          selectionMode: 'single',
          options: [
            { id: 'report', label: '人工审阅报告', recommended: true },
            { id: 'commands', label: '附带命令结果' },
          ],
          required: true,
        }],
      },
    } as const;

    expect(validateWorkflowCreationItem(result)).toEqual({ ok: true, errors: [] });
    const state = applyWorkflowCreationItem(createEmptyWorkflowCreationState(), result);
    expect(state.clarification).toMatchObject({
      summary: '读取当前项目并输出只读体检报告。',
      knownFacts: ['只读分析', '输出三个改进建议'],
      missingFields: [],
    });
    expect(state.clarification.questions).toHaveLength(1);
    expect(state.clarification.questions[0]).toMatchObject({
      id: 'validation_evidence',
      question: '体检报告应采用哪种验收方式？',
    });
  });

  test('keeps a single unmarked lightweight outline state and uses an available normal Agent', () => {
    let state = createEmptyWorkflowCreationState();
    const outline = {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowKind: 'lightweight',
        workflowKindRationale: '目标单一，可由一个 Agent 一次完成。',
        states: [{ name: '项目体检', description: '读取项目并输出体检报告。' }],
      },
    } as const;
    const validationContext = {
      creationJourney: 'ai-guided' as const,
      targetWorkflowKind: 'lightweight' as const,
      creationAdversarialIntent: 'disabled' as const,
    };

    expect(validateWorkflowCreationItem(outline, validationContext)).toEqual({ ok: true, errors: [] });
    state = applyWorkflowCreationItem(state, outline);
    expect(state.workflow.outline).toHaveLength(1);
    expect(state.workflow.outline[0]).toMatchObject({
      name: '项目体检',
      isInitial: true,
      isFinal: true,
      transitions: [],
    });

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: '项目快速体检',
      requirements: '读取项目并输出体检报告。',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      recommendedAgents: ['不存在的推荐 Agent'],
      availableAgents: ['analyst'],
      creationAdversarialIntent: 'disabled',
    });

    expect(config.workflow.states).toHaveLength(1);
    expect(config.workflow.states[0].steps).toHaveLength(1);
    expect(config.workflow.states[0].steps[0].agent).toBe('analyst');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });

  test('rejects a lightweight outline with two raw states', () => {
    const result = validateWorkflowCreationItem({
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowKind: 'lightweight',
        workflowKindRationale: '错误地拆成了两个状态。',
        states: [{ name: '执行' }, { name: '完成', isFinal: true }],
      },
    }, {
      creationJourney: 'ai-guided',
      targetWorkflowKind: 'lightweight',
      creationAdversarialIntent: 'disabled',
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('lightweight 规划说明必须只有 1 个状态');
  });

  test('assembles an AI-guided lightweight workflow from a safe on-demand assessment', () => {
    let state = createEmptyWorkflowCreationState();
    const outline = {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowKind: 'lightweight',
        workflowKindRationale: '任务目标单一，可由一个 Agent 一次完成。',
        reviewAssessment: {
          requiresAdversarial: false,
          rationale: '任务边界清晰且失败代价低。',
          riskSignals: [],
          confidence: 'high',
        },
        states: [{ name: '执行', isInitial: true, isFinal: true }],
      },
    } as const;
    const validationContext = {
      creationJourney: 'ai-guided' as const,
      targetWorkflowKind: 'lightweight' as const,
      creationAdversarialIntent: 'on-demand' as const,
    };
    const extracted = extractWorkflowCreationItemResult(
      `<result>${JSON.stringify(outline)}</result>`,
      WORKFLOW_STATE_OUTLINE_KIND,
      validationContext,
    );
    expect(extracted).toMatchObject({ ok: true });
    expect(validateWorkflowCreationItem(outline, validationContext)).toEqual({ ok: true, errors: [] });
    state = applyWorkflowCreationItem(state, extracted.ok ? extracted.result : outline);

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'AI Task Workflow',
      filename: 'workflows/ai-task.yaml',
      description: '整理需求并完成实现',
      requirements: '整理需求并完成实现。',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      recommendedAgents: ['developer'],
      creationAdversarialIntent: 'on-demand',
    });

    expect(config.workflow).toMatchObject({
      mode: 'state-machine',
      profile: 'lightweight',
      lightweight: {},
    });
    expect(config.workflow.supervisor).toBeUndefined();
    expect(config.workflow.maxTransitions).toBeUndefined();
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
    expect(JSON.stringify(config)).not.toContain('docs/tasklists');
    expect(JSON.stringify(config)).not.toContain('phase-based');
    expect(config.workflow.states).toHaveLength(1);
    expect(config.workflow.states[0]).toMatchObject({ isInitial: true, isFinal: true, transitions: [] });
    expect(config.workflow.states[0].reviewPolicy).toBeUndefined();
    expect(config.workflow.states[0].maxSelfTransitions).toBeUndefined();
    expect(config.workflow.states[0].steps).toHaveLength(1);
    expect(config.workflow.states[0].steps[0]).toMatchObject({
      agent: 'developer',
      task: '整理需求并完成实现。',
      skills: ['aceharness-tasklist'],
    });
  });

  test('assembles a state-machine using the final per-state policy', () => {
    let state = createEmptyWorkflowCreationState();
    const outline = {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowKind: 'state-machine',
        workflowKindRationale: '任务需要独立执行和完成边界。',
        reviewAssessment: {
          requiresAdversarial: false,
          rationale: '当前风险可由标准模式处理。',
          riskSignals: [],
          confidence: 'high',
        },
        states: [
          {
            name: '分析',
            isInitial: true,
            reviewPolicy: {
              mode: 'standard',
              rationale: '分析任务边界明确。',
              riskSignals: [],
              confidence: 'high',
            },
          },
          { name: '完成', isFinal: true },
        ],
      },
    } as const;
    const validationContext = {
      creationJourney: 'ai-guided' as const,
      targetWorkflowKind: 'state-machine' as const,
      creationAdversarialIntent: 'on-demand' as const,
      availableStepAgents: ['developer'],
    };
    expect(validateWorkflowCreationItem(outline, validationContext)).toEqual({ ok: true, errors: [] });
    state = applyWorkflowCreationItem(state, outline);

    const stateSteps = {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '分析',
        reviewPolicy: {
          mode: 'standard',
          rationale: '补充步骤后仍属于低风险分析。',
          riskSignals: [],
          confidence: 'high',
        },
        steps: [{ name: '需求分析', agent: 'developer', task: '分析需求并给出可验证结论。' }],
      },
    } as const;
    expect(validateWorkflowCreationItem(stateSteps, validationContext)).toEqual({ ok: true, errors: [] });
    state = applyWorkflowCreationItem(state, stateSteps);
    state.workflow.stateSteps['分析'][0].agent = 'hallucinated-agent';

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'State Machine Workflow',
      filename: 'state-machine.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
      recommendedAgents: ['hallucinated-agent'],
      availableAgents: ['developer'],
      creationAdversarialIntent: 'on-demand',
    });

    expect(config.workflow.profile).toBeUndefined();
    expect(config.workflow.mode).toBe('state-machine');
    expect(config.workflow.states).toHaveLength(2);
    expect(config.workflow.states[0].reviewPolicy).toMatchObject({ mode: 'standard' });
    expect(config.workflow.states[0].steps).toHaveLength(1);
    expect(config.workflow.states.flatMap((workflowState: any) => workflowState.steps || []).every((step: any) => step.agent === 'developer')).toBe(true);
    expect(config.workflow.states[0].steps[0].role).toBeUndefined();
    expect(config.workflow.states[0].steps[0].task).toContain('verdict');
    expect(config.workflow.states[1].reviewPolicy).toBeUndefined();
    expect(config.workflow.states[1].steps[0].role).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('phase-based');
    expect(validateWorkflowDraft(config, { mode: 'portable' }).ok).toBe(true);
  });

  test('rejects lightweight when on-demand assessment requires adversarial review', () => {
    const result = validateWorkflowCreationItem({
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowKind: 'lightweight',
        workflowKindRationale: '最初认为任务简单。',
        reviewAssessment: {
          requiresAdversarial: true,
          rationale: '发现不可逆发布风险。',
          riskSignals: ['不可逆发布'],
          confidence: 'high',
        },
        states: [{ name: '执行', isInitial: true, isFinal: true }],
      },
    }, {
      creationJourney: 'ai-guided',
      targetWorkflowKind: 'lightweight',
      creationAdversarialIntent: 'on-demand',
    });

    expect(result.ok).toBe(false);
    expect(result.errors).not.toHaveLength(0);
  });
});
