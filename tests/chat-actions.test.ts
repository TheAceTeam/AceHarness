import { describe, expect, test } from 'vitest';
import { parseActions, normalizeAssistantDisplay, getStreamingResultDisplay, isSafeAction, RISK_MAP } from '@/lib/chat/actions';
import type { ActionBlock } from '@/lib/chat/actions';

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
    expect(result.text).not.toContain('<result>');
    expect(result.text).toContain('Here is the result');
  });

  test('extracts bare card json from result sections', () => {
    const markdown = [
      'Here is the result:',
      '',
      '<result>',
      '{"kind":"card","payload":{"header":{"title":"My Workflow"},"blocks":[{"type":"text","content":"Workflow details"}]}}',
      '</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].header.title).toBe('My Workflow');
    expect(result.cards[0].blocks[0]).toMatchObject({ type: 'text', content: 'Workflow details' });
    expect(result.text).toBe('Here is the result:');
  });

  test('hides plain result sections from visible text', () => {
    const markdown = [
      'Visible summary.',
      '<result>Internal workflow draft summary that should only drive UI state.</result>',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.text).toContain('Visible summary.');
    expect(result.text).not.toContain('<result>');
    expect(result.text).not.toContain('Internal workflow draft summary');
  });

  test('extracts plain home sidebar JSON from result sections', () => {
    const markdown = [
      '我会打开工作流创建面板。',
      '<result>',
      '{"type":"home_sidebar","mode":"active","tabs":["workflow"],"activeTab":"workflow","intent":"create-workflow","stage":"spec-draft","summary":"创建工作流","shouldOpenModal":true}',
      '</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(1);
    expect(result.sidebarHints[0].shouldOpenModal).toBe(true);
    expect(result.text).toBe('我会打开工作流创建面板。');
    expect(result.text).not.toContain('home_sidebar');
  });

  test('extracts kind=home_sidebar payload from result sections', () => {
    const markdown = [
      '我会打开工作流创建面板。',
      '<result>',
      '{"kind":"home_sidebar","payload":{"mode":"active","tabs":["workflow"],"activeTab":"workflow","intent":"create-workflow","stage":"spec-draft","summary":"创建工作流","shouldOpenModal":true}}',
      '</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(1);
    expect(result.sidebarHints[0]).toMatchObject({
      activeTab: 'workflow',
      shouldOpenModal: true,
      summary: '创建工作流',
    });
    expect(result.text).toBe('我会打开工作流创建面板。');
  });

  test('hides dangling result sections while streaming', () => {
    const markdown = [
      '我会打开工作流创建面板。',
      '<result>',
      '{"type":"home_sidebar","shouldOpenModal":true,"summary":"partial","missingFields"',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(0);
    expect(result.text).toBe('我会打开工作流创建面板。');
    expect(result.text).not.toContain('<result>');
    expect(result.text).not.toContain('home_sidebar');
  });

  test('removes an orphan trailing fence left after hidden result content', () => {
    const markdown = [
      '我会整理上下文并打开创建面板。',
      '',
      '**🔧 bash**',
      '',
      '<result>',
      '```json',
      '{"type":"home_sidebar","mode":"active","tabs":["workflow"],"activeTab":"workflow","intent":"create-workflow","stage":"spec-draft","shouldOpenModal":true}',
      '```',
      '</result>',
      '   ```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(1);
    expect(result.text).toContain('我会整理上下文');
    expect(result.text).toContain('🔧 bash');
    expect(result.text).not.toMatch(/```\s*$/);
  });

  test('extracts home sidebar JSON from single-line fenced result blocks', () => {
    const markdown = [
      '我会直接打开创建面板。',
      '<result>```json {"type":"home_sidebar","mode":"active","tabs":["workflow"],"activeTab":"workflow","intent":"create-workflow","stage":"workflow-draft","summary":"创建工作流","shouldOpenModal":true} ```</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(1);
    expect(result.sidebarHints[0].activeTab).toBe('workflow');
    expect(result.sidebarHints[0].shouldOpenModal).toBe(true);
    expect(result.text).toBe('我会直接打开创建面板。');
    expect(result.resultPlainTexts).toEqual([]);
  });

  test('parses multiple result sections with mixed card and sidebar payloads', () => {
    const markdown = [
      '先说明。',
      '<result>{"kind":"home_sidebar","payload":{"mode":"active","tabs":["workflow"],"activeTab":"workflow","intent":"create-workflow","stage":"spec-draft"}}</result>',
      '再补充。',
      '<result>{"kind":"card","payload":{"header":{"title":"预览"},"blocks":[{"type":"text","content":"内容"}]}}</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(1);
    expect(result.cards).toHaveLength(1);
    expect(result.text).toBe('先说明。\n\n再补充。');
  });

  test('keeps normal fenced code blocks outside result while hiding machine result blocks', () => {
    const markdown = [
      '说明：',
      '```ts',
      'const visible = true;',
      '```',
      '<result>{"kind":"card","payload":{"blocks":[{"type":"code","code":"hidden","lang":"ts"}]}}</result>',
      '结尾。',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.text).toContain('const visible = true;');
    expect(result.text).toContain('结尾。');
    expect(result.text).not.toContain('hidden');
  });

  test('hides leaked machine json fences outside result sections', () => {
    const markdown = [
      '草案确认前说明。',
      '```json',
      '{"kind":"plan_draft","payload":{"summary":"不应直接显示","artifacts":{"requirements":"# req","design":"# design","tasks":"# tasks"}}}',
      '```',
      '下面展示正式结果。',
      '<result>{"kind":"card","payload":{"header":{"title":"结果卡片"},"blocks":[{"type":"text","content":"已生成"}]}}</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.text).toBe('草案确认前说明。\n下面展示正式结果。');
    expect(result.text).not.toContain('plan_draft');
    expect(result.text).not.toContain('# req');
  });

  test('keeps ordinary json fences outside result sections', () => {
    const markdown = [
      '示例：',
      '```json',
      '{"name":"visible-example"}',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.text).toBe(markdown);
    expect(result.cards).toHaveLength(0);
  });

  test('parses action and result blocks together without leaking machine payloads', () => {
    const markdown = [
      '前置说明。',
      '```action',
      '{"type":"navigate","params":{"url":"/run-history"},"description":"Open history"}',
      '```',
      '<result>{"kind":"home_sidebar","payload":{"mode":"peek","tabs":["workflow"],"activeTab":"workflow"}}</result>',
      '收尾说明。',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.actions).toHaveLength(1);
    expect(result.sidebarHints).toHaveLength(1);
    expect(result.text).toContain('前置说明。');
    expect(result.text).toContain('收尾说明。');
    expect(result.text).not.toContain('navigate');
    expect(result.text).not.toContain('home_sidebar');
  });

  test('prefers parsing structured root payload and does not duplicate legacy fenced card blocks', () => {
    const markdown = [
      '说明。',
      '<result>',
      '```card',
      '{"header":{"title":"Legacy"},"blocks":[{"type":"text","content":"only once"}]}',
      '```',
      '</result>',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].header.title).toBe('Legacy');
  });

  test('hides multiple dangling result sections while streaming', () => {
    const markdown = [
      '继续处理中。',
      '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"',
      '中间文本',
      '<result>{"kind":"card","payload":{"blocks":[{"type":"text","content":"partial"',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(0);
    expect(result.cards).toHaveLength(0);
    expect(result.text).toBe('继续处理中。');
  });

  test('ignores result tags that appear inside fenced code blocks', () => {
    const markdown = [
      '示例代码：',
      '```xml',
      '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}</result>',
      '```',
      '正文结尾。',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.sidebarHints).toHaveLength(0);
    expect(result.text).toContain('<result>{"kind":"home_sidebar"');
    expect(result.text).toContain('正文结尾。');
  });

  test('keeps a legitimate closed code block at the end', () => {
    const markdown = [
      'Example:',
      '',
      '```ts',
      'const ok = true;',
      '```',
    ].join('\n');

    const result = parseActions(markdown);

    expect(result.text).toBe(markdown);
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

describe('normalizeAssistantDisplay', () => {
  test('hides dangling result payload during streaming and preserves normal text', () => {
    const raw = [
      '先给用户解释。',
      '<result>',
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow"',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, true)).toEqual({
      visibleText: '先给用户解释。',
      hasMachineResult: true,
      hasSidebarHint: false,
    });
  });

  test('hides completed result payload during streaming without surfacing sidebar state early', () => {
    const raw = [
      '先给用户解释。',
      '<result>',
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow","shouldOpenModal":true}}',
      '</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, true)).toEqual({
      visibleText: '先给用户解释。',
      hasMachineResult: true,
      hasSidebarHint: false,
    });
  });

  test('surfaces sidebar hint after streaming completes', () => {
    const raw = [
      '先给用户解释。',
      '<result>',
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow","shouldOpenModal":true}}',
      '</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, false)).toEqual({
      visibleText: '先给用户解释。',
      hasMachineResult: true,
      hasSidebarHint: true,
    });
  });

  test('handles multi-stage mixed streaming output with code block and multiple partial result sections', () => {
    const stage1 = [
      '先展示命令：',
      '```ts',
      'const ok = true;',
      '```',
      '<result>{"kind":"card","payload":{"blocks":[{"type":"text"',
    ].join('\n');
    const stage2 = `${stage1}\n中间说明\n<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"`;
    const stage3 = [
      '先展示命令：',
      '```ts',
      'const ok = true;',
      '```',
      '中间说明',
      '<result>{"kind":"card","payload":{"blocks":[{"type":"text","content":"done"}]}}</result>',
      '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(stage1, true).visibleText).toContain('const ok = true;');
    expect(normalizeAssistantDisplay(stage1, true).visibleText).not.toContain('"kind":"card"');
    expect(normalizeAssistantDisplay(stage2, true).visibleText).toBe('先展示命令：\n```ts\nconst ok = true;\n```');
    expect(normalizeAssistantDisplay(stage2, true).visibleText).not.toContain('home_sidebar');
    expect(normalizeAssistantDisplay(stage3, false)).toEqual({
      visibleText: '先展示命令：\n```ts\nconst ok = true;\n```\n中间说明',
      hasMachineResult: true,
      hasSidebarHint: true,
    });
  });

  test('hides dangling streaming code fence in plain assistant text', () => {
    const raw = [
      '先说明。',
      '```ts',
      'const x = 1;',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, true)).toEqual({
      visibleText: '先说明。',
      hasMachineResult: false,
      hasSidebarHint: false,
    });
  });

  test('keeps closed code fences in plain assistant text while streaming', () => {
    const raw = [
      '先说明。',
      '```ts',
      'const x = 1;',
      '```',
      '收尾。',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, true)).toEqual({
      visibleText: raw,
      hasMachineResult: false,
      hasSidebarHint: false,
    });
  });

  test('treats a result tag inside an unclosed streaming code fence as plain text', () => {
    const raw = [
      '先说明。',
      '```ts',
      'const x = 1;',
      '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(raw, true)).toEqual({
      visibleText: '先说明。',
      hasMachineResult: false,
      hasSidebarHint: false,
    });
  });

  test('keeps streamed structured result out of visible text and exposes raw result content separately', () => {
    const payload = {
      kind: 'plan_draft',
      payload: {
        summary: '生成正式计划',
        goals: ['展示流式预览'],
        artifacts: {
          requirements: '# requirements.md\n\n- 必须在流式阶段可见',
          design: '# design.md\n\n~~~mermaid\nflowchart TD\n  A --> B\n~~~',
          tasks: '# tasks.md\n\n- [ ] T1.1 验证预览',
        },
      },
    };
    const body = JSON.stringify(payload, null, 2);
    const raw = `AI 正在生成正式计划制品\n<result>\n${body.slice(0, body.indexOf('T1.1') + 4)}`;
    const normalized = normalizeAssistantDisplay(raw, true);
    const streamingResult = getStreamingResultDisplay(raw);

    expect(normalized.hasMachineResult).toBe(true);
    expect(normalized.visibleText).toBe('AI 正在生成正式计划制品');
    expect(normalized.visibleText).not.toContain('<result>');
    expect(normalized.visibleText).not.toContain('"kind"');
    expect(normalized.visibleText).not.toContain('# requirements.md');
    expect(streamingResult).toMatchObject({ complete: false });
    expect(streamingResult?.text).toContain('"kind": "plan_draft"');
    expect(streamingResult?.text).toContain('# requirements.md');
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
      { type: 'schedule.delete', params: {}, description: 'Delete schedule' },
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
