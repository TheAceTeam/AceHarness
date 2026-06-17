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
      revisionPlan: [],
    });
  });

  test('extracts structured revision plan entries', () => {
    const markdown = [
      '<result>',
      JSON.stringify({
        kind: 'spec_coding_revision',
        payload: {
          apply: true,
          summary: '收敛需求和任务',
          affectedArtifacts: ['requirements.md', 'tasks.md'],
          impact: ['R1 修改', 'T2.1 新增'],
          revisionPlan: [
            { artifact: 'requirements', op: 'modify', targetId: 'R1', reason: '验收标准变化' },
            { artifact: 'tasks', op: 'add', targetId: 'T2.1', reason: '新增回归验证' },
            { artifact: 'bad', op: 'modify', targetId: 'X', reason: 'ignore' },
          ],
        },
      }),
      '</result>',
    ].join('\n');

    expect(extractSpecCodingRevisionCommand(markdown)?.revisionPlan).toEqual([
      { artifact: 'requirements', op: 'modify', targetId: 'R1', reason: '验收标准变化' },
      { artifact: 'tasks', op: 'add', targetId: 'T2.1', reason: '新增回归验证' },
    ]);
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
