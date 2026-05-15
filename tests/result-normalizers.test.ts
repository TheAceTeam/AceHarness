import { describe, expect, test } from 'vitest';
import {
  extractPlanDraftResult,
  getStructuredResultStreamPreview,
} from '@/lib/ai/result-normalizers';

describe('result normalizers', () => {
  test('previews streamed plan_draft result JSON and preserves final parsed result', () => {
    const payload = {
      kind: 'plan_draft',
      payload: {
        summary: '批量删除工作流对话',
        goals: ['支持分组多选', '避免误删运行中会话'],
        nonGoals: ['不删除运行产物'],
        constraints: ['沿用 Radix Checkbox'],
        clarification: {
          summary: '需求已确认',
          knownFacts: ['工作流分组内会话需要批量删除'],
          missingFields: [],
          questions: [],
        },
        artifacts: {
          requirements: [
            '# requirements.md',
            '',
            '- WHEN 用户选择工作流分组 THEN 系统应批量选中组内会话',
          ].join('\n'),
          design: [
            '# design.md',
            '',
            '~~~mermaid',
            'flowchart TD',
            '  A[选择] --> B[确认]',
            '~~~',
          ].join('\n'),
          tasks: [
            '# tasks.md',
            '',
            '- [ ] T1.1 接入分组选择',
          ].join('\n'),
        },
      },
    };
    const resultBody = JSON.stringify(payload, null, 2);
    const streamed = `正在生成正式计划。\n<result>\n${resultBody.slice(0, resultBody.indexOf('T1.1') + 4)}`;
    const preview = getStructuredResultStreamPreview(streamed);

    expect(preview.kind).toBe('plan_draft');
    expect(preview.complete).toBe(false);
    expect(preview.text).toContain('正在生成正式计划。');
    expect(preview.text).toContain('## 计划摘要');
    expect(preview.text).toContain('批量删除工作流对话');
    expect(preview.text).toContain('# requirements.md');
    expect(preview.text).toContain('```mermaid');
    expect(preview.text).not.toContain('<result>');
    expect(preview.text).not.toContain('"kind"');

    const finalContent = `正在生成正式计划。\n<result>\n${resultBody}\n</result>`;
    const finalPreview = getStructuredResultStreamPreview(finalContent);
    expect(finalPreview.complete).toBe(true);
    expect(finalPreview.text).toContain('- [ ] T1.1 接入分组选择');

    const parsed = extractPlanDraftResult(finalContent);
    expect(parsed).toMatchObject({
      type: 'plan_draft',
      summary: '批量删除工作流对话',
      goals: ['支持分组多选', '避免误删运行中会话'],
      artifacts: {
        requirements: payload.payload.artifacts.requirements,
        design: payload.payload.artifacts.design,
        tasks: payload.payload.artifacts.tasks,
      },
    });
  });

  test('previews workflow_draft and does not leak unknown raw result JSON', () => {
    const workflow = [
      '<result>',
      JSON.stringify({
        kind: 'workflow_draft',
        payload: {
          filename: 'cleanup.yaml',
          summary: '清理历史会话工作流',
          config: {
            workflow: {
              name: 'cleanup',
              phases: [{ name: 'Delete', steps: [{ name: 'Batch', agent: 'developer', task: 'delete sessions' }] }],
            },
          },
        },
      }),
    ].join('\n');
    const preview = getStructuredResultStreamPreview(workflow);
    expect(preview.kind).toBe('workflow_draft');
    expect(preview.text).toContain('清理历史会话工作流');
    expect(preview.text).toContain('目标文件：`cleanup.yaml`');
    expect(preview.text).not.toContain('"workflow"');

    const unknown = '<result>{"kind":"home_sidebar","payload":{"activeTab":"workflow"}}</result>';
    const unknownPreview = getStructuredResultStreamPreview(unknown);
    expect(unknownPreview.kind).toBe('home_sidebar');
    expect(unknownPreview.hasResult).toBe(true);
    expect(unknownPreview.text).toBe('');
  });
});
