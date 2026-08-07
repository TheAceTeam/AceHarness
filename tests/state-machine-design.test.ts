import { describe, expect, test } from 'vitest';
import type { StateMachineState } from '@/lib/core/schemas';
import {
  buildWorkflowStepFromEditData,
} from '@/components/StateMachineDesignPanel';
import { renameStateAndReferences } from '@/lib/workflow/state-machine-design';

describe('state machine design updates', () => {
  test('renames a state and every transition targeting it', () => {
    const states = [
      {
        name: '输入质检',
        steps: [{ name: 'check', agent: 'architect', task: 'check input' }],
        transitions: [
          { to: '输入质检', condition: { verdict: 'conditional_pass' }, priority: 100 },
          { to: 'DT设计', condition: { verdict: 'pass' }, priority: 100 },
        ],
        isInitial: true,
        isFinal: false,
      },
      {
        name: 'DT设计',
        steps: [{ name: 'design', agent: 'architect', task: 'design' }],
        transitions: [
          { to: '输入质检', condition: { verdict: 'fail' }, priority: 100 },
        ],
        isInitial: false,
        isFinal: false,
      },
    ] as StateMachineState[];

    const renamed = renameStateAndReferences(states, '输入质检', '输入质检1');

    expect(renamed[0].name).toBe('输入质检1');
    expect(renamed[0].transitions.map((transition) => transition.to)).toEqual(['输入质检1', 'DT设计']);
    expect(renamed[1].transitions[0].to).toBe('输入质检1');
    expect(states[0].name).toBe('输入质检');
  });

  test('preserves step skills without changing the Agent global configuration', () => {
    const agentConfig = { name: 'developer', skills: ['global-skill'] };
    const savedStep = buildWorkflowStepFromEditData({
      type: 'agent',
      name: 'review',
      agent: agentConfig.name,
      task: 'Review the change',
      skills: ['review-skill', ' review-skill ', 'aceharness-tasklist'],
      parallelGroup: 'parallel-review',
      concurrency: { groupId: 'parallel-review', joinPolicy: { mode: 'all' } },
      specTaskBinding: { taskId: 'task-1', taskIds: ['task-1'] },
    });

    expect(savedStep.skills).toEqual(['review-skill', 'aceharness-tasklist']);
    expect(agentConfig.skills).toEqual(['global-skill']);
  });

  test('does not carry skills onto a subworkflow step', () => {
    const savedStep = buildWorkflowStepFromEditData({
      type: 'subworkflow',
      name: 'Run child workflow',
      workflow: 'child.yaml',
      skills: ['parent-skill'],
    }, {
      name: 'Previous step',
      agent: 'developer',
      task: 'Previous task',
      skills: ['stale-skill'],
    });

    expect(savedStep.type).toBe('subworkflow');
    expect(savedStep).not.toHaveProperty('skills');
  });

  test('preserves stable IDs and provenance when editing an existing agent step', () => {
    const savedStep = buildWorkflowStepFromEditData({
      type: 'agent',
      name: 'Implement',
      agent: 'developer',
      task: 'Implement and verify',
      role: 'defender',
    }, {
      id: 'step-stable',
      name: 'Implement',
      agent: 'developer',
      task: 'Implement',
      role: 'defender',
      agentInstanceId: 'instance-stable',
      provenance: { origin: 'user' },
    });

    expect(savedStep).toMatchObject({
      id: 'step-stable',
      task: 'Implement and verify',
      role: 'defender',
      agentInstanceId: 'instance-stable',
      provenance: { origin: 'user' },
    });
  });
});
