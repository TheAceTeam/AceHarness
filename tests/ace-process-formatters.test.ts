import { describe, expect, test } from 'vitest';
import { extractAceProcessBlocks } from '@/lib/chat/ai-process-blocks';
import { formatAceRuntimeToolEvent, formatAceToolCall, formatAceToolResult, getAceToolTitle, resolveAceToolName } from '@/lib/chat/ace-process-formatters';

describe('ace process tool formatters', () => {
  test('recognizes context compression tool payloads', () => {
    const toolName = resolveAceToolName('other', {
      topic: 'SpecLang input context loading',
      content: [
        {
          startId: 'm0001',
          endId: 'm0004',
          summary: 'Loaded skills and input documents.',
        },
      ],
    });

    expect(toolName).toBe('context-compression');
    expect(getAceToolTitle(toolName)).toBe('上下文压缩');
  });

  test('does not expose file mutation post-validation output as edit result body', () => {
    const raw = formatAceToolResult({
      toolName: 'edit',
      title: '编辑文件',
      rawOutput: {
        filePath: 'C:\\Users\\Shawn\\Desktop\\speclang\\docs\\speclang-rider-task-hall.yaml',
        output: [
          'Wrote file successfully.',
          'Validity STATUS: FAIL FINDING: Pseudocode references unknown ui_element_id UI-DELIVERY-CARD.',
          'SUMMARY: 203 failures, 0 warnings. [BLOCK: fix mechanical violations before AI review]',
        ].join('\n'),
      },
      toolId: 'call_6dc316398fd64749b9b5f0bf',
    });
    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].kind).toBe('tool-result');
    expect(raw).toContain('speclang-rider-task-hall.yaml');
    expect(raw).toContain('call_6dc316398fd64749b9b5f0bf');
    expect(raw).not.toContain('Validity STATUS');
    expect(raw).not.toContain('SUMMARY: 203 failures');
  });

  test('does not embed file read content in tool results', () => {
    const raw = formatAceToolResult({
      toolName: 'read',
      title: '读取文件',
      rawOutput: {
        filePath: 'C:\\Users\\Shawn\\Desktop\\speclang\\需求.md',
        content: '这里是很长的文件正文，不应该进入会话。',
      },
      toolId: 'call_read_file',
    });
    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(raw).toContain('需求.md');
    expect(raw).toContain('call_read_file');
    expect(raw).not.toContain('这里是很长的文件正文');
  });

  test('does not embed file write content in tool calls', () => {
    const raw = formatAceToolCall({
      toolName: 'write',
      rawInput: {
        filePath: 'C:\\Users\\Shawn\\Desktop\\speclang\\docs\\speclang.yaml',
        content: 'feature_context:\n  title: should not be embedded',
      },
      toolId: 'call_write_file',
    });
    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(raw).toContain('speclang.yaml');
    expect(raw).toContain('call_write_file');
    expect(raw).not.toContain('feature_context');
  });

  test('serializes runtime tool lifecycle events for complete agent transcripts', () => {
    const started = formatAceRuntimeToolEvent({
      id: 'tool-read-1',
      toolName: 'read',
      title: '读取文件',
      status: 'running',
      input: { filePath: 'README.md' },
    });
    const completed = formatAceRuntimeToolEvent({
      id: 'tool-read-1',
      toolName: 'read',
      title: '读取文件',
      status: 'completed',
      result: { filePath: 'README.md', output: 'ignored file body' },
    });
    const parsed = extractAceProcessBlocks(`${started}\n${completed}`);

    expect(parsed.blocks.map((block) => block.kind)).toEqual(['tool-call', 'tool-result']);
    expect(`${started}\n${completed}`).toContain('tool-read-1');
    expect(`${started}\n${completed}`).not.toContain('ignored file body');
  });
});
