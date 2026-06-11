import { describe, expect, test } from 'vitest';
import {
  buildWorkflowDesignConfigForSave,
  hasWorkflowDesignDraftChanges,
  normalizeWorkflowAgentOverridesForSave,
} from '@/lib/workflow/design-config-draft';

const stateMachineConfig = {
  workflow: {
    name: 'state-machine-demo',
    mode: 'state-machine',
    states: [
      {
        name: 'baseline',
        agent: 'judge-agent',
        steps: [],
      },
    ],
  },
  context: {
    projectRoot: '/repo/demo',
    workspaceMode: 'in-place',
    requirements: 'check workflow save semantics',
    timeoutMinutes: 45,
    engine: 'codex',
    executionPolicy: {
      defaultEngine: 'codex',
      defaultModel: 'gpt-5',
      autoCompactOnStepChange: true,
      agentOverrides: {
        'judge-agent': {
          enabled: true,
          engine: '',
          model: 'gpt-5',
        },
      },
    },
    skills: ['spec-reader'],
    mcpServers: ['local-mcp'],
  },
};

const persistedDraftState = {
  projectRoot: '/repo/demo',
  workspaceMode: 'in-place' as const,
  requirements: 'check workflow save semantics',
  timeoutMinutes: 45,
  engine: 'codex',
  workflowDefaultModel: 'gpt-5',
  workflowAutoCompactOnStepChange: true,
  workflowAgentOverrides: {
    'judge-agent': {
      enabled: true,
      engine: '',
      model: 'gpt-5',
    },
    'disabled-agent': {
      enabled: false,
      engine: 'claude',
      model: 'sonnet',
    },
  },
  skills: ['spec-reader'],
  mcpServers: ['local-mcp'],
};

describe('workflow design config draft helpers', () => {
  test('normalizes workflow agent overrides before save', () => {
    expect(normalizeWorkflowAgentOverridesForSave(persistedDraftState.workflowAgentOverrides)).toEqual({
      'judge-agent': {
        enabled: true,
        model: 'gpt-5',
      },
    });
  });

  test('treats identical persisted and draft design configs as clean', () => {
    const persisted = buildWorkflowDesignConfigForSave(stateMachineConfig, persistedDraftState);
    const draft = buildWorkflowDesignConfigForSave(
      JSON.parse(JSON.stringify(stateMachineConfig)),
      persistedDraftState,
    );

    expect(hasWorkflowDesignDraftChanges(persisted, draft)).toBe(false);
  });

  test('detects unsaved design changes for state machine workflows', () => {
    const persisted = buildWorkflowDesignConfigForSave(stateMachineConfig, persistedDraftState);
    const nextConfig = JSON.parse(JSON.stringify(stateMachineConfig));
    nextConfig.workflow.states[0].steps = [
      { name: 'judge-step', agent: 'judge-agent', task: 'verify result' },
    ];
    const changedDraftState = {
      ...persistedDraftState,
      workflowDefaultModel: 'gpt-5.1',
    };
    const draft = buildWorkflowDesignConfigForSave(nextConfig, changedDraftState);

    expect(hasWorkflowDesignDraftChanges(persisted, draft)).toBe(true);
  });
});
