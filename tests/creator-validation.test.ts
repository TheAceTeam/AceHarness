import { describe, expect, test } from 'vitest';
import { validateWorkflowDraft, validateAgentDraft, buildDefaultAgentDraft } from '@/lib/creator-validation';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function validPhaseBasedConfig(projectRoot: string) {
  return {
    workflow: {
      name: 'Test Workflow',
      phases: [{
        name: 'Phase 1',
        steps: [{ name: 'Step 1', agent: 'developer', task: 'Do something' }],
      }],
      supervisor: { enabled: true, agent: 'default-supervisor' },
    },
    context: { projectRoot },
  };
}

function validStateMachineConfig(projectRoot: string) {
  return {
    workflow: {
      name: 'Test SM',
      mode: 'state-machine',
      states: [
        {
          name: 'Init',
          isInitial: true,
          isFinal: false,
          steps: [{ name: 'Step 1', agent: 'developer', task: 'Start' }],
          transitions: [{ to: 'Done', condition: { verdict: 'pass' }, priority: 100 }],
        },
        {
          name: 'Done',
          isInitial: false,
          isFinal: true,
          steps: [{ name: 'Step 2', agent: 'developer', task: 'Finish' }],
          transitions: [],
        },
      ],
    },
    context: { projectRoot },
  };
}

describe('validateWorkflowDraft', () => {
  test('valid phase-based config passes validation', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const result = validateWorkflowDraft(validPhaseBasedConfig(tmpDir));
    expect(result.ok).toBe(true);
    expect(result.normalized).not.toBeNull();
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('empty projectRoot is an error', () => {
    const result = validateWorkflowDraft(validPhaseBasedConfig(''));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.path.includes('projectRoot'))).toBe(true);
  });

  test('relative projectRoot is an error', () => {
    const result = validateWorkflowDraft(validPhaseBasedConfig('relative/path'));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('绝对路径'))).toBe(true);
  });

  test('nonexistent projectRoot is an error', () => {
    const result = validateWorkflowDraft(validPhaseBasedConfig('/nonexistent/path/abc123'));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('不存在'))).toBe(true);
  });

  test('state-machine with no initial state is an error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[0].isInitial = false;
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('初始状态'))).toBe(true);
  });

  test('state-machine with multiple initial states is an error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[1].isInitial = true;
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('初始状态'))).toBe(true);
  });

  test('state-machine with no final state is an error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[1].isFinal = false;
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('终止状态'))).toBe(true);
  });

  test('duplicate state names is an error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[1].name = 'Init';
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('重复'))).toBe(true);
  });

  test('transition to nonexistent state is an error', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[0].transitions[0].to = 'Nonexistent';
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('不存在'))).toBe(true);
  });

  test('final state with transitions is a warning', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[1].transitions = [{ to: 'Init', condition: { verdict: 'fail' }, priority: 100 }];
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(true); // warning, not error
    expect(result.issues.some((i) => i.severity === 'warning' && i.message.includes('终止状态'))).toBe(true);
  });

  test('missing supervisor is a warning', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validPhaseBasedConfig(tmpDir);
    config.workflow.supervisor = undefined;
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(true); // warning, not error
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});

describe('validateAgentDraft', () => {
  test('valid agent draft passes validation', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'blue',
      activeEngine: '',
      engineModels: {},
      capabilities: ['code'],
      systemPrompt: 'You are a test agent.',
    });
    expect(result.ok).toBe(true);
  });

  test('black-gold team with normal roleType is an error', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'black-gold',
      roleType: 'normal',
      activeEngine: '',
      engineModels: {},
      capabilities: ['code'],
      systemPrompt: 'Test',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('black-gold'))).toBe(true);
  });

  test('activeEngine not in engineModels is an error', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'blue',
      activeEngine: 'kiro-cli',
      engineModels: { 'claude-code': 'opus' },
      capabilities: ['code'],
      systemPrompt: 'Test',
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('engineModels'))).toBe(true);
  });

  test('engineModels with empty activeEngine is a warning', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'blue',
      activeEngine: '',
      engineModels: { 'claude-code': 'opus' },
      capabilities: ['code'],
      systemPrompt: 'Test',
    });
    expect(result.ok).toBe(true);
    expect(result.issues.some((i) => i.severity === 'warning' && i.message.includes('activeEngine'))).toBe(true);
  });
});

describe('buildDefaultAgentDraft', () => {
  test('returns default values when called without input', () => {
    const draft = buildDefaultAgentDraft();
    expect(draft.name).toBe('example-agent');
    expect(draft.team).toBe('blue');
    expect(draft.roleType).toBe('normal');
    expect(draft.capabilities).toEqual(['通用协作']);
  });

  test('overrides values from input', () => {
    const draft = buildDefaultAgentDraft({ name: 'custom', team: 'red' });
    expect(draft.name).toBe('custom');
    expect(draft.team).toBe('red');
  });

  test('black-gold team defaults to supervisor roleType', () => {
    const draft = buildDefaultAgentDraft({ team: 'black-gold' });
    expect(draft.roleType).toBe('supervisor');
  });
});
