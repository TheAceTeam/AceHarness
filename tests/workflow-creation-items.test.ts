import { describe, expect, test } from 'vitest';
import {
  applyWorkflowCreationItem,
  assembleWorkflowConfigFromItems,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
  validateWorkflowCreationItem,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
} from '@/lib/ai/workflow-creation-items';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';

describe('workflow creation item assembly', () => {
  test('assembles an AI-selected lightweight workflow from structured mode data', () => {
    let state = createEmptyWorkflowCreationState();
    const outline = {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowMode: 'lightweight',
        states: [{ name: '执行', isInitial: true, isFinal: true }],
      },
    } as const;
    const extracted = extractWorkflowCreationItemResult(
      `<result>${JSON.stringify(outline)}</result>`,
      WORKFLOW_STATE_OUTLINE_KIND,
    );
    expect(extracted).toMatchObject({ ok: true });
    expect(validateWorkflowCreationItem(outline)).toEqual({ ok: true, errors: [] });
    state = applyWorkflowCreationItem(state, extracted.ok ? extracted.result : outline);
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_STEPS_KIND,
      data: {
        stateName: '执行',
        steps: [{ name: '整理任务', agent: 'developer', task: '整理需求并完成实现。' }],
      },
    });

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'AI Task Workflow',
      filename: 'workflows/ai-task.yaml',
      description: '整理需求并完成实现',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
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
    expect(config.workflow.states[0].maxSelfTransitions).toBeUndefined();
    expect(config.workflow.states[0].steps).toHaveLength(1);
    expect(config.workflow.states[0].steps[0]).toMatchObject({
      agent: 'developer',
      task: '整理需求并完成实现。',
      skills: ['aceharness-tasklist'],
    });
  });

  test('preserves state-machine assembly when AI selects state-machine', () => {
    let state = createEmptyWorkflowCreationState();
    state = applyWorkflowCreationItem(state, {
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        workflowMode: 'state-machine',
        states: [
          { name: '分析', isInitial: true },
          { name: '完成', isFinal: true },
        ],
      },
    });

    const config = assembleWorkflowConfigFromItems(state, {
      workflowName: 'State Machine Workflow',
      filename: 'state-machine.yaml',
      workingDirectory: process.cwd(),
      workspaceMode: 'in-place',
    });

    expect(config.workflow.profile).toBeUndefined();
    expect(config.workflow.mode).toBe('state-machine');
    expect(config.workflow.states.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(config)).not.toContain('phase-based');
  });
});
