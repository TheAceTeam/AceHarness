import { describe, expect, test } from 'vitest';

import { buildFinalRawContent } from '@/contexts/ChatContext';
import { parseActions } from '@/lib/chat/actions';
import { extractAceProcessBlocks } from '@/lib/chat/ai-process-blocks';
import { formatAceFileChangesResult, formatAceToolCall, formatAceToolResult } from '@/lib/chat/ace-process-formatters';

describe('chat stream assembly', () => {
  test('completes a trailing ACP result chunk from done when delta stops mid-json', () => {
    const streamed = [
      'All three PRs are compatible.',
      '',
      '<!-- chunk-boundary -->',
      '',
      '{"isCompatible": true, "reason": "align build.py and docs with existing envsetup behavior.", "uuid": "compat_req_1779419820757_05ce3214b82d4',
    ].join('\n');
    const doneResult = [
      '<!-- chunk-boundary -->',
      '',
      '{"isCompatible": true, "reason": "align build.py and docs with existing envsetup behavior.", "uuid": "compat_req_1779419820757_05ce3214b82d4","sessionId":"ses_1"}',
    ].join('\n');

    expect(buildFinalRawContent(streamed, streamed, doneResult)).toBe(
      `${streamed}","sessionId":"ses_1"}`
    );
  });

  test('extends the raw stream when done returns the full final message', () => {
    expect(buildFinalRawContent('Hello wor', 'Hello wor', 'Hello world')).toBe('Hello world');
  });

  test('recovers the full ACP done result when the connected stream only saw the suffix', () => {
    const streamedSuffix = '{"files": ["ace.js"]}';
    const doneResult = [
      '<ace-process>{"kind":"tool-call","toolName":"read","toolId":"tool-1"}</ace-process>',
      '',
      '<ace-process>{"kind":"tool-result","toolName":"read","output":"ace.js","toolId":"tool-1"}</ace-process>',
      '',
      '<!-- chunk-boundary -->',
      '',
      streamedSuffix,
    ].join('\n');

    expect(buildFinalRawContent(streamedSuffix, streamedSuffix, doneResult)).toBe(doneResult);
  });

  test('single file change formatter should keep tool-result as the top-level ace-process kind', () => {
    const streamedProcessBlock = formatAceFileChangesResult({
      changes: [
        {
          filePath: '/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md',
          kind: 'update',
        },
      ],
      fallbackToolName: 'edit',
      fallbackTitle: '文件变更',
    });

    expect(streamedProcessBlock).toContain('"kind":"tool-result"');
  });

  test('omits read file content while keeping a completed tool-result block with path', () => {
    const raw = formatAceToolResult({
      toolName: 'read',
      title: '📖 读取文件',
      rawOutput: {
        filePath: 'C:\\Users\\Shawn\\Desktop\\App\\specs\\FEATURE-RIDER-ORDER-HALL.yaml',
        content: 'UC-10-OPEN-RECEIVING-SETTINGS -> entry/src/test/cangjie/RiderOrderHallSpecTest.cj\n'.repeat(5000),
      },
    });
    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].kind).toBe('tool-result');
    expect(raw).toContain('FEATURE-RIDER-ORDER-HALL.yaml');
    expect(raw).not.toContain('UC-10-OPEN-RECEIVING-SETTINGS');
    expect(raw.length).toBeLessThan(5000);
  });

  test('omits ACPX read formatted_output from conversation payload', () => {
    const raw = formatAceToolResult({
      toolName: 'read',
      title: '📖 读取文件',
      rawOutput: {
        formatted_output: '# Werewolf Tabletalk\n\n- `SKILL.md`\n- `references/speech-templates.md`',
        exit_code: 0,
      },
      toolId: 'call_skill_read',
    });
    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].kind).toBe('tool-result');
    expect(raw).not.toContain('Werewolf Tabletalk');
    expect(raw).not.toContain('speech-templates.md');
    expect(raw).toContain('"exitCode":0');
    expect(raw).toContain('"toolId":"call_skill_read"');
  });

  test('omits write file content from tool calls', () => {
    const raw = formatAceToolCall({
      toolName: 'write',
      rawInput: {
        filePath: 'notes.md',
        content: [
          { type: 'text', text: '第一段' },
          { type: 'text', text: '第二段' },
        ],
      },
    });

    expect(raw).not.toContain('[object Object]');
    expect(raw).toContain('notes.md');
    expect(raw).not.toContain('第一段');
    expect(raw).not.toContain('第二段');
  });

  test('reproduces malformed nested ace-process leakage when final assistant text replays a broken file-change block', () => {
    const streamedProcessBlock = '<ace-process>{"kind":"update","toolName":"edit","title":"📝 文件变更","changes":[{"toolName":"edit","title":"📝 文件变更","filePath":"/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md","kind":"update"}],"output":"","filePath":"/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md","body":""}</ace-process>';
    const streamedVisibleText = '我会加一个目标 SDK 导入视图与 manifest 新章节，并同步接口草案。';
    const malformedReplayBlock = '<ace-process>{"kind":"update","toolName":"edit","title":"文件变更","changes":[{"toolName":"edit","title":"文件变更","filePath":"/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md","kind":"update"}],"output":"","filePath":"/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md","body":""}</ace-process>';
    const doneResult = [
      streamedVisibleText,
      malformedReplayBlock,
      '正式设计文档已经补上新章节，我还需要同步镜像文档。',
    ].join('\n');

    const merged = buildFinalRawContent(
      `${streamedProcessBlock}\n${streamedVisibleText}`,
      streamedVisibleText,
      doneResult,
    );
    const parsed = parseActions(merged);

    expect(merged).toContain('<ace-process>{"kind":"update"');
    expect(parsed.text).toContain('<ace-process>{"kind":"update"');
    expect(parsed.text).toContain('正式设计文档已经补上新章节');
  });
});
