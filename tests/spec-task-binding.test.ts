import { describe, expect, test } from 'vitest';
import { compileStepTaskBindings } from '@/lib/spec/task-binding';

function specCoding() {
  return {
    id: 'spec-1',
    version: 1,
    status: 'confirmed',
    requirements: [],
    phases: [{ id: 'phase-1', title: 'Implement' }],
    assignments: [],
    checkpoints: [],
    tasks: [
      {
        id: 'T1.1',
        title: 'Implement feature',
        status: 'pending',
        phaseId: 'phase-1',
        ownerAgents: ['developer'],
        children: [],
      },
      {
        id: 'T1.2',
        title: 'Verify feature',
        status: 'pending',
        phaseId: 'phase-1',
        ownerAgents: ['tester'],
        children: [],
      },
    ],
    progress: { total: 2, completed: 0, running: 0, blocked: 0 },
    revisions: [],
    artifacts: {
      requirements: '# requirements.md',
      design: '# design.md',
      tasks: '# tasks.md',
    },
  } as any;
}

function workflowConfig(step: any) {
  return {
    workflow: {
      name: 'Binding Test',
      mode: 'state-machine',
      states: [
        {
          name: 'Implement',
          specPhaseId: 'phase-1',
          isInitial: true,
          isFinal: true,
          steps: [step],
          transitions: [],
        },
      ],
    },
    context: {
      projectRoot: 'C:/repo',
      workspaceMode: 'in-place',
    },
  } as any;
}

describe('compileStepTaskBindings', () => {
  test('preserves explicit AI-provided task bindings', () => {
    const result = compileStepTaskBindings(
      workflowConfig({
        id: 'step-implement',
        name: 'Implement feature',
        agent: 'developer',
        task: 'Implement the feature.',
        specTaskBinding: {
          taskIds: ['T1.2'],
          requirementIds: ['R1'],
          artifactKeys: ['tasks'],
        },
      }),
      specCoding(),
      { requireExplicit: true },
    );

    expect(result.validation.ok).toBe(true);
    expect(result.validation.bindings[0].source).toBe('explicit');
    expect(result.validation.bindings[0].taskIds).toEqual(['T1.2']);
    expect(result.config.workflow.states[0].steps[0].specTaskBinding).toMatchObject({
      taskId: 'T1.2',
      taskIds: ['T1.2'],
      requirementIds: ['R1'],
      artifactKeys: ['tasks'],
    });
  });

  test('fails explicit binding validation when a step omits a task binding', () => {
    const result = compileStepTaskBindings(
      workflowConfig({
        id: 'step-implement',
        name: 'Implement feature',
        agent: 'developer',
        task: 'Implement the feature.',
      }),
      specCoding(),
      { requireExplicit: true },
    );

    expect(result.validation.ok).toBe(false);
    expect(result.validation.errors.join('\n')).toContain('显式提供 specTaskBinding.taskIds');
    expect(result.validation.bindings[0].source).toBe('auto-title');
  });
});
