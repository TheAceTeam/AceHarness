import { describe, expect, test } from 'vitest';
import { parseActions, isSafeAction, RISK_MAP } from '@/lib/chat-actions';
import type { ActionBlock } from '@/lib/chat-actions';

describe('parseActions', () => {
  test('extracts action blocks from markdown and removes them from visible text', () => {
    const markdown = [
      'Here is my analysis of your workflow.',
      '',
      '```action',
      '{"type": "config.create", "params": {"filename": "test.yaml"}, "description": "Create test config"}',
      '```',
      '',
      'The config has been created successfully.',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('config.create');
    expect(result.actions[0].params).toEqual({ filename: 'test.yaml' });
    expect(result.actions[0].description).toBe('Create test config');

    // Action block should be removed from visible text
    expect(result.text).toContain('Here is my analysis');
    expect(result.text).toContain('The config has been created');
    expect(result.text).not.toContain('config.create');
    expect(result.text).not.toContain('```action');
  });

  test('extracts multiple action blocks in order', () => {
    const markdown = [
      '```action',
      '{"type": "agent.create", "params": {"name": "dev"}, "description": "Create developer agent"}',
      '```',
      '',
      'Some text between actions.',
      '',
      '```action',
      '{"type": "workflow.start", "params": {"config": "main.yaml"}, "description": "Start workflow"}',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('agent.create');
    expect(result.actions[1].type).toBe('workflow.start');
    expect(result.text).toContain('Some text between actions.');
  });

  test('extracts card blocks from <result> sections', () => {
    const markdown = [
      'Here is the result:',
      '',
      '<result>',
      '```card',
      '{"header": {"title": "My Workflow", "status": "running"}, "blocks": [{"type": "text", "content": "Workflow details"}]}',
      '```',
      '</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].header.title).toBe('My Workflow');
    expect(result.cards[0].blocks).toHaveLength(1);
    // Card should be removed from visible text
    expect(result.text).not.toContain('```card');
    expect(result.text).toContain('Here is the result');
  });

  test('handles markdown with no action or card blocks', () => {
    const markdown = 'Just a regular message with **bold** and `code` formatting.';

    const result = parseActions(markdown);

    expect(result.actions).toEqual([]);
    expect(result.cards).toEqual([]);
    expect(result.text).toBe(markdown);
  });

  test('handles malformed action JSON gracefully without crashing', () => {
    const markdown = [
      'Some text',
      '',
      '```action',
      '{invalid json here',
      '```',
      '',
      'More text after.',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toEqual([]);
    // Malformed block should remain in text since it wasn't parsed
    expect(result.text).toContain('Some text');
    expect(result.text).toContain('More text after.');
  });

  test('action block with params object preserves nested params', () => {
    const markdown = [
      '```action',
      '{"type": "config.update", "params": {"filename": "wf.yaml", "changes": {"name": "Updated"}}, "description": "Update config"}',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].params).toEqual({ filename: 'wf.yaml', changes: { name: 'Updated' } });
  });

  test('action block without params defaults to empty object', () => {
    const markdown = [
      '```action',
      '{"type": "workflow.list", "description": "List all workflows"}',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].params).toEqual({});
  });
});

describe('isSafeAction', () => {
  test('read-only actions are safe', () => {
    const safeActions = ['config.list', 'config.get', 'workflow.list', 'workflow.status', 'agent.list', 'run.list', 'run.get'];

    for (const type of safeActions) {
      if (RISK_MAP[type as keyof typeof RISK_MAP] === 'safe') {
        expect(isSafeAction({ type: type as any, params: {}, description: 'test' })).toBe(true);
      }
    }
  });

  test('destructive actions are not safe', () => {
    const destructiveActions: ActionBlock[] = [
      { type: 'config.delete', params: {}, description: 'Delete config' },
      { type: 'agent.delete', params: {}, description: 'Delete agent' },
      { type: 'run.delete', params: {}, description: 'Delete run' },
    ];

    for (const action of destructiveActions) {
      expect(isSafeAction(action)).toBe(false);
    }
  });

  test('mutating actions are not safe', () => {
    const mutatingActions: ActionBlock[] = [
      { type: 'config.create', params: {}, description: 'Create config' },
      { type: 'config.update', params: {}, description: 'Update config' },
      { type: 'workflow.start', params: {}, description: 'Start workflow' },
    ];

    for (const action of mutatingActions) {
      expect(isSafeAction(action)).toBe(false);
    }
  });
});
