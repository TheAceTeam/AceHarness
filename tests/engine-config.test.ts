import { describe, expect, test } from 'vitest';
import { getEngineConfigDir, getEngineSkillsSubdir } from '@/lib/engines/engine-config';
import { resolveAgentSelection, resolveWorkflowAgentSelection } from '@/lib/agent/engine-selection';

describe('engine config', () => {
  test('getEngineConfigDir returns the shared .agents workspace directory for each engine type', () => {
    expect(getEngineConfigDir('claude-code')).toBe('.agents');
    expect(getEngineConfigDir('claude-code-acp')).toBe('.agents');
    expect(getEngineConfigDir('kiro-cli')).toBe('.agents');
    expect(getEngineConfigDir('opencode')).toBe('.agents');
    expect(getEngineConfigDir('codex')).toBe('.agents');
    expect(getEngineConfigDir('cursor')).toBe('.agents');
    expect(getEngineConfigDir('trae-cli')).toBe('.agents');
    expect(getEngineConfigDir('magic-cli')).toBe('.agents');
  });

  test('getEngineConfigDir uses .agents for unknown engine types too', () => {
    expect(getEngineConfigDir('unknown-engine')).toBe('.agents');
    expect(getEngineConfigDir('')).toBe('.agents');
  });

  test('getEngineSkillsSubdir appends /skills to the shared agent config directory', () => {
    expect(getEngineSkillsSubdir('claude-code')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('claude-code-acp')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('kiro-cli')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('opencode')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('codex')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('cursor')).toBe('.agents/skills');
    expect(getEngineSkillsSubdir('trae-cli')).toBe('.agents/skills');
  });

  test('getEngineSkillsSubdir uses .agents/skills for unknown engine types', () => {
    expect(getEngineSkillsSubdir('unknown')).toBe('.agents/skills');
  });

});

describe('resolveAgentSelection', () => {
  test('agent with empty activeEngine follows system default and uses global engine/model', () => {
    const result = resolveAgentSelection(
      { engineModels: {}, activeEngine: '' },
      { engine: 'claude-code', defaultModel: 'opus' },
    );

    expect(result.followsSystem).toBe(true);
    expect(result.effectiveEngine).toBe('claude-code');
    expect(result.effectiveModel).toBe('opus');
    expect(result.configuredEngine).toBe('');
  });

  test('agent with explicit activeEngine uses its own engine and model from engineModels', () => {
    const result = resolveAgentSelection(
      { engineModels: { 'kiro-cli': 'sonnet', 'claude-code': 'opus' }, activeEngine: 'kiro-cli' },
      { engine: 'claude-code', defaultModel: 'opus' },
    );

    expect(result.followsSystem).toBe(false);
    expect(result.effectiveEngine).toBe('kiro-cli');
    expect(result.effectiveModel).toBe('sonnet');
    expect(result.configuredEngine).toBe('kiro-cli');
  });

  test('workflow engine overrides both agent config and global config', () => {
    const result = resolveAgentSelection(
      { engineModels: { 'kiro-cli': 'sonnet' }, activeEngine: 'kiro-cli' },
      { engine: 'claude-code', defaultModel: 'opus' },
      'codex',
    );

    expect(result.effectiveEngine).toBe('codex');
    expect(result.effectiveModel).toBe('sonnet'); // still uses agent's model for its engine
  });

  test('agent with activeEngine but missing model in engineModels falls back to first available model', () => {
    const result = resolveAgentSelection(
      { engineModels: { 'kiro-cli': 'sonnet' }, activeEngine: 'cursor' },
      { engine: 'claude-code', defaultModel: 'opus' },
    );

    expect(result.effectiveEngine).toBe('cursor');
    expect(result.effectiveModel).toBe('sonnet'); // fallback to first available model
  });

  test('null roleConfig gracefully falls back to global defaults', () => {
    const result = resolveAgentSelection(
      null,
      { engine: 'claude-code', defaultModel: 'opus' },
    );

    expect(result.followsSystem).toBe(true);
    expect(result.effectiveEngine).toBe('claude-code');
    expect(result.effectiveModel).toBe('opus');
  });

  test('no global config and no agent config results in empty engine/model', () => {
    const result = resolveAgentSelection({ engineModels: {}, activeEngine: '' });

    expect(result.followsSystem).toBe(true);
    expect(result.effectiveEngine).toBe('');
    expect(result.effectiveModel).toBe('');
  });
});

describe('resolveWorkflowAgentSelection', () => {
  test('workflow with no execution policy inherits global engine and default model', () => {
    const result = resolveWorkflowAgentSelection(
      { name: 'coder', engineModels: {}, activeEngine: '' },
      { engine: 'claude-code', defaultModel: 'opus' },
      { workflowContext: {} },
    );

    expect(result.followsSystem).toBe(true);
    expect(result.effectiveEngine).toBe('claude-code');
    expect(result.effectiveModel).toBe('opus');
  });

  test('agent active engine wins when workflow has no engine policy', () => {
    const result = resolveWorkflowAgentSelection(
      { name: 'architect', engineModels: { codex: 'gpt-5.4' }, activeEngine: 'codex' },
      { engine: 'opencode', defaultModel: 'glm-5' },
      {
        agentName: 'architect',
        workflowContext: {
          executionPolicy: {
            autoCompactOnStepChange: false,
            agentOverrides: {},
          },
        },
      },
    );

    expect(result.followsSystem).toBe(false);
    expect(result.effectiveEngine).toBe('codex');
    expect(result.effectiveModel).toBe('gpt-5.4');
  });

  test('workflow default policy overrides global selection for all agents', () => {
    const result = resolveWorkflowAgentSelection(
      { name: 'coder', engineModels: { codex: 'gpt-5-codex' }, activeEngine: '' },
      { engine: 'claude-code', defaultModel: 'opus' },
      {
        workflowContext: {
          executionPolicy: {
            defaultEngine: 'codex',
            defaultModel: 'gpt-5-codex',
            agentOverrides: {},
          },
        },
      },
    );

    expect(result.followsSystem).toBe(true);
    expect(result.effectiveEngine).toBe('codex');
    expect(result.effectiveModel).toBe('gpt-5-codex');
  });

  test('workflow agent override wins for the targeted agent only', () => {
    const result = resolveWorkflowAgentSelection(
      { name: 'reviewer', engineModels: { cursor: 'cursor-fast' }, activeEngine: '' },
      { engine: 'claude-code', defaultModel: 'opus' },
      {
        workflowContext: {
          executionPolicy: {
            defaultEngine: 'codex',
            defaultModel: 'gpt-5-codex',
            agentOverrides: {
              reviewer: {
                enabled: true,
                engine: 'cursor',
                model: 'cursor-fast',
              },
            },
          },
        },
      },
    );

    expect(result.followsSystem).toBe(false);
    expect(result.configuredEngine).toBe('cursor');
    expect(result.effectiveEngine).toBe('cursor');
    expect(result.effectiveModel).toBe('cursor-fast');
  });
});
