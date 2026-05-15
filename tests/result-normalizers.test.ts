import { describe, expect, test } from 'vitest';
import { extractPlanDraftResult, extractWorkflowDraftPreview } from '@/lib/ai/result-normalizers';

describe('result normalizers', () => {
  test('extracts plan_draft result JSON without relying on stream preview rendering', () => {
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
          requirements: '# requirements.md\n\n- WHEN 用户选择工作流分组 THEN 系统应批量选中组内会话',
          design: '# design.md\n\n~~~mermaid\nflowchart TD\n  A[选择] --> B[确认]\n~~~',
          tasks: '# tasks.md\n\n- [ ] T1.1 接入分组选择',
        },
      },
    };
    const finalContent = `正在生成正式计划。\n<result>\n${JSON.stringify(payload, null, 2)}\n</result>`;

    const parsed = extractPlanDraftResult(finalContent);

    expect(parsed).toMatchObject({
      type: 'plan_draft',
      summary: '批量删除工作流对话',
      goals: ['支持分组多选', '避免误删运行中会话'],
      artifacts: payload.payload.artifacts,
    });
  });

  test('extracts workflow_draft result JSON for final preview state', () => {
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
      '</result>',
    ].join('\n');

    const preview = extractWorkflowDraftPreview(workflow);

    expect(preview).toMatchObject({
      source: 'result-json',
      filename: 'cleanup.yaml',
      summary: '清理历史会话工作流',
    });
    expect(preview.config).toMatchObject({
      workflow: { name: 'cleanup' },
    });
  });
});
