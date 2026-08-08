import { describe, expect, test } from 'vitest';
import {
  buildWorkflowDesignConfigForSave,
  hasWorkflowDesignDraftChanges,
  normalizeWorkflowAgentOverridesForSave,
} from '@/lib/workflow/design-config-draft';
import { resolveWorkflowPolicyAgentNames } from '@/lib/workflow/lightweight';

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

const lightweightConfig = {
  workflow: {
    name: 'lightweight-demo',
    mode: 'state-machine',
    profile: 'lightweight',
    supervisor: {
      enabled: true,
      agent: 'default-supervisor',
    },
    states: [
      {
        name: 'execute',
        isInitial: true,
        isFinal: true,
        steps: [{
          name: 'run',
          agent: 'developer',
          task: 'run tasklist',
          skills: ['aceharness-tasklist'],
        }],
        transitions: [],
      },
    ],
  },
  context: {
    projectRoot: '/repo/demo',
    workspaceMode: 'in-place',
    requirements: 'run tasklist',
    timeoutMinutes: 300,
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

  test('materializes legacy all-state review adoption in the save payload without mutating the draft', () => {
    const config = {
      ...stateMachineConfig,
      workflow: {
        ...stateMachineConfig.workflow,
        states: [{
          name: 'reviewed',
          isInitial: true,
          isFinal: false,
          reviewPolicy: {
            mode: 'adversarial' as const,
            source: 'ai' as const,
            locked: false,
            confidence: 'high' as const,
            riskSignals: ['cross-module'],
            rationale: 'needs independent review',
          },
          steps: [],
          transitions: [],
        }],
      },
    };

    const saved = buildWorkflowDesignConfigForSave(config, persistedDraftState);

    expect((saved.workflow as any).reviewProtocol).toBe('state-level');
    expect(config.workflow).not.toHaveProperty('reviewProtocol');
  });

  test('removes historical supervisor from lightweight design save payloads', () => {
    const normalized = buildWorkflowDesignConfigForSave({
      ...lightweightConfig,
      context: {
        ...lightweightConfig.context,
        executionPolicy: {
          defaultModel: 'gpt-5',
          agentOverrides: {
            'default-supervisor': {
              enabled: true,
              model: 'gpt-5-supervisor',
            },
            developer: {
              enabled: true,
              model: 'gpt-5-dev',
            },
          },
        },
      },
    }, {
      ...persistedDraftState,
      requirements: 'run tasklist',
      timeoutMinutes: 300,
      workflowAgentOverrides: {
        'default-supervisor': {
          enabled: true,
          model: 'gpt-5-supervisor',
        },
        developer: {
          enabled: true,
          model: 'gpt-5-dev',
        },
      },
    });

    expect(normalized.workflow.supervisor).toBeUndefined();
    expect(normalized.workflow.profile).toBe('lightweight');
    expect(normalized.context.executionPolicy.agentOverrides).toEqual({
      developer: {
        enabled: true,
        model: 'gpt-5-dev',
      },
    });
  });

  test('keeps supervisor unchanged for state-machine design save payloads', () => {
    const config = {
      ...stateMachineConfig,
      workflow: {
        ...stateMachineConfig.workflow,
        supervisor: {
          enabled: true,
          agent: 'review-supervisor',
        },
      },
    };
    const normalized = buildWorkflowDesignConfigForSave(config, persistedDraftState);

    expect(normalized.workflow.supervisor).toEqual({
      enabled: true,
      agent: 'review-supervisor',
    });
  });

  test('omits supervisor from lightweight policy agent list', () => {
    expect(resolveWorkflowPolicyAgentNames({
      workflow: lightweightConfig.workflow,
      agentConfigs: [
        { name: 'default-supervisor', roleType: 'supervisor' },
        { name: 'developer', roleType: 'normal' },
      ],
    })).toEqual(['developer']);
  });

  test('includes supervisor fallback in state-machine policy agent list', () => {
    expect(resolveWorkflowPolicyAgentNames({
      workflow: stateMachineConfig.workflow,
      agentConfigs: [
        { name: 'default-supervisor', roleType: 'supervisor' },
        { name: 'judge-agent', roleType: 'normal' },
      ],
    })).toEqual(['judge-agent', 'default-supervisor']);
  });
});
