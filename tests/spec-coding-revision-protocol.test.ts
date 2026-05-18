import { describe, expect, test } from 'vitest';
import {
  extractSpecCodingRevisionCommand,
  stripSpecCodingRevisionCommand,
} from '@/lib/spec/coding-revision-protocol';

describe('spec-coding revision protocol', () => {
  test('extracts revision command from result channel kind payload', () => {
    const markdown = [
      '先分析当前任务。',
      '<result>',
      '{"kind":"spec_coding_revision","payload":{"apply":true,"summary":"刷新任务拆分","affectedArtifacts":["tasks.md"],"impact":["拆分更细"]}}',
      '</result>',
    ].join('\n');

    expect(extractSpecCodingRevisionCommand(markdown)).toEqual({
      type: 'spec-coding-revision',
      apply: true,
      summary: '刷新任务拆分',
      affectedArtifacts: ['tasks.md'],
      impact: ['拆分更细'],
    });
  });

  test('strips revision command from visible output while preserving other result blocks', () => {
    const markdown = [
      '结论如下。',
      '<result>',
      '{"kind":"spec_coding_revision","payload":{"apply":true,"summary":"刷新任务拆分","affectedArtifacts":["tasks.md"],"impact":["拆分更细"]}}',
      '</result>',
      '<result>',
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}',
      '</result>',
    ].join('\n');

    expect(stripSpecCodingRevisionCommand(markdown)).toBe([
      '结论如下。',
      '',
      '<result>',
      '{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}',
      '</result>',
    ].join('\n'));
  });
});
