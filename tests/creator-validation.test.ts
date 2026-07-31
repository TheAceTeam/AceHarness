import { describe, expect, test } from 'vitest';
import { validateWorkflowDraft, validateAgentDraft, buildDefaultAgentDraft } from '@/lib/core/creator-validation';
import { tmpdir } from 'os';
import { mkdtempSync } from 'fs';
import { join } from 'path';

function validStateMachineConfig(projectRoot: string) {
  return {
    workflow: {
      name: 'Test SM',
      mode: 'state-machine',
      supervisor: { enabled: true, agent: 'default-supervisor' },
      states: [
        {
          name: 'Init',
          isInitial: true,
          isFinal: false,
          steps: [{ name: 'Step 1', agent: 'developer', task: 'Start' }],
          transitions: [
            { to: 'Done', condition: { verdict: 'pass' }, priority: 100 },
            { to: 'Done', condition: { verdict: 'conditional_pass' }, priority: 90 },
            { to: 'Done', condition: { verdict: 'fail' }, priority: 80 },
          ],
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
  test('valid state-machine config passes validation', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const result = validateWorkflowDraft(validStateMachineConfig(tmpDir));
    expect(result.ok).toBe(true);
    expect(result.normalized).not.toBeNull();
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('empty projectRoot is an error', () => {
    const result = validateWorkflowDraft(validStateMachineConfig(''));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.severity === 'error' && i.path.includes('projectRoot'))).toBe(true);
  });

  test('relative projectRoot is an error', () => {
    const result = validateWorkflowDraft(validStateMachineConfig('relative/path'));
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('绝对路径'))).toBe(true);
  });

  test('nonexistent projectRoot is an error', () => {
    const result = validateWorkflowDraft(validStateMachineConfig('/nonexistent/path/abc123'));
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

  test('state-machine spec revision on complete defaults off and can be enabled per state', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[0] = {
      ...config.workflow.states[0],
      enableSpecRevisionOnComplete: true,
    } as any;
    const result = validateWorkflowDraft(config);

    expect(result.ok).toBe(true);
    const states = (result.normalized as any).workflow.states;
    expect(states[0].enableSpecRevisionOnComplete).toBe(true);
    expect(states[1].enableSpecRevisionOnComplete).toBe(false);
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
    const config = validStateMachineConfig(tmpDir);
    delete (config.workflow as any).supervisor;
    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(true); // warning, not error
    expect(result.issues.some((i) => i.severity === 'warning')).toBe(true);
  });

  test('state steps cannot use the configured supervisor agent', () => {
    const config = validStateMachineConfig('{project_root}');
    (config.workflow as any).supervisor = { enabled: true, agent: 'chief-supervisor' };
    config.workflow.states[1].steps[0].agent = 'chief-supervisor';

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => (
      i.severity === 'error'
      && i.code === 'supervisor_step_agent'
      && i.path.join('.') === 'workflow.states.1.steps.0.agent'
    ))).toBe(true);
  });

  test('portable mode allows placeholder projectRoot and unresolved agents', () => {
    const config = validStateMachineConfig('{project_root}');
    config.workflow.name = 'Portable Workflow';
    config.workflow.supervisor = { enabled: true, agent: 'external-supervisor' };
    config.workflow.states[0].steps[0].agent = 'external-agent';

    const result = validateWorkflowDraft(config, { mode: 'portable' });
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('state-machine allows multiple advanced rules for the same verdict', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    (config.workflow.states[0].transitions as any[]).push(
      {
        to: 'Done',
        condition: { verdict: 'pass', issueTypes: ['test'] },
        priority: 50,
      },
      {
        to: 'Done',
        condition: { verdict: 'pass', severities: ['major'] },
        priority: 40,
      }
    );

    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('state-machine rejects multiple fallback rules for the same verdict', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'test-'));
    const config = validStateMachineConfig(tmpDir);
    config.workflow.states[0].transitions.push({
      to: 'Done',
      condition: { verdict: 'pass' },
      priority: 60,
    });

    const result = validateWorkflowDraft(config);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('多条兜底转移'))).toBe(true);
  });

  test('state-machine accepts subworkflow steps without agent and task', () => {
    const config = validStateMachineConfig('{project_root}');
    (config.workflow.states[0].steps as any[]) = [{
      name: 'Run child workflow',
      type: 'subworkflow',
      workflow: 'child.yaml',
    }];

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(true);
    expect(result.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('preRuntime state-machine agent steps without type remain valid', () => {
    const config = validStateMachineConfig('{project_root}');
    delete (config.workflow.states[0].steps[0] as any).type;

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(true);
    expect(result.normalized?.workflow.states[0].steps[0]).toMatchObject({
      name: 'Step 1',
      agent: 'developer',
      task: 'Start',
    });
  });

  test('state-machine rejects unknown step types with a field-level error', () => {
    const config = validStateMachineConfig('{project_root}');
    (config.workflow.states[0].steps[0] as any).type = 'nested-workflow';

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => (
      issue.path.join('.') === 'workflow.states.0.steps.0.type'
      && issue.severity === 'error'
    ))).toBe(true);
  });

  test('state-machine rejects unsafe subworkflow config references', () => {
    const config = validStateMachineConfig('{project_root}');
    (config.workflow.states[0].steps as any[]) = [{
      name: 'Run child workflow',
      type: 'subworkflow',
      workflow: '../child.yaml',
    }];

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('不能越过 workflow 配置目录'))).toBe(true);
  });

  test('state-machine only accepts shared subworkflow workspace conflict policy', () => {
    const config = validStateMachineConfig('{project_root}');
    (config.workflow.states[0].steps as any[]) = [{
      name: 'Run child workflow',
      type: 'subworkflow',
      workflow: 'child.yaml',
      runtime: {
        workspaceConflictPolicy: 'isolated-copy',
      },
    }];

    const result = validateWorkflowDraft(config, { mode: 'portable' });

    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path.join('.').includes('workspaceConflictPolicy'))).toBe(true);
  });
});

describe('validateAgentDraft', () => {
  test('valid agent draft passes validation', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'red',
      activeEngine: '',
      engineModels: {},
      capabilities: ['code'],
      systemPrompt: 'You are a test agent.',
    });
    expect(result.ok).toBe(true);
  });

  test('agent draft accepts skills as agent-level runtime configuration', () => {
    const result = validateAgentDraft({
      name: 'test-agent',
      team: 'red',
      activeEngine: '',
      engineModels: {},
      capabilities: ['code'],
      systemPrompt: 'You are a test agent.',
      skills: ['aceharness-spec-coding', 'vitest'],
    });

    expect(result.ok).toBe(true);
    expect(result.normalized?.skills).toEqual(['aceharness-spec-coding', 'vitest']);
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
      team: 'red',
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
      team: 'red',
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
    expect(draft.team).toBe('red');
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
