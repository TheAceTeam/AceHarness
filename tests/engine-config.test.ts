import { describe, expect, test } from 'vitest';
import { getEngineConfigDir, getEngineSkillsSubdir } from '@/lib/engines/engine-config';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';

describe('engine config', () => {
  test('getEngineConfigDir returns the correct workspace directory for each engine type', () => {
    expect(getEngineConfigDir('claude-code')).toBe('.claude');
    expect(getEngineConfigDir('kiro-cli')).toBe('.kiro');
    expect(getEngineConfigDir('opencode')).toBe('.opencode');
    expect(getEngineConfigDir('codex')).toBe('.codex');
    expect(getEngineConfigDir('cursor')).toBe('.cursor');
    expect(getEngineConfigDir('cangjie-magic')).toBe('.claude');
    expect(getEngineConfigDir('trae-cli')).toBe('.trae');
  });

  test('getEngineConfigDir falls back to .claude for unknown engine types', () => {
    expect(getEngineConfigDir('unknown-engine')).toBe('.claude');
    expect(getEngineConfigDir('')).toBe('.claude');
  });

  test('getEngineSkillsSubdir appends /skills to the engine config directory', () => {
    expect(getEngineSkillsSubdir('claude-code')).toBe('.claude/skills');
    expect(getEngineSkillsSubdir('kiro-cli')).toBe('.kiro/skills');
    expect(getEngineSkillsSubdir('opencode')).toBe('.opencode/skills');
    expect(getEngineSkillsSubdir('codex')).toBe('.codex/skills');
    expect(getEngineSkillsSubdir('cursor')).toBe('.cursor/skills');
    expect(getEngineSkillsSubdir('trae-cli')).toBe('.trae/skills');
  });

  test('getEngineSkillsSubdir falls back correctly for unknown engine types', () => {
    expect(getEngineSkillsSubdir('unknown')).toBe('.claude/skills');
  });

  test('cangjie-magic shares claude-code config directory but has distinct engine type', () => {
    expect(getEngineConfigDir('cangjie-magic')).toBe(getEngineConfigDir('claude-code'));
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
