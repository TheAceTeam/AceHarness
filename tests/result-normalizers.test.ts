import { describe, expect, test } from 'vitest';
import {
  extractPlanDraftResult,
  extractWorkflowPatchPreview,
} from '@/lib/ai/result-normalizers';

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

  test('extracts workflow_patch result JSON for scoped design optimization', () => {
    const content = [
      '<result>',
      JSON.stringify({
        kind: 'workflow_patch',
        payload: {
          filename: 'cleanup.yaml',
          summary: '优化删除步骤',
          scope: 'step',
          workflowMode: 'phase-based',
          patch: {
            step: {
              name: 'Batch Delete',
              agent: 'developer',
              task: 'delete sessions safely',
            },
          },
        },
      }),
      '</result>',
    ].join('\n');

    const preview = extractWorkflowPatchPreview(content);

    expect(preview).toMatchObject({
      source: 'result-json',
      filename: 'cleanup.yaml',
      summary: '优化删除步骤',
      scope: 'step',
      workflowMode: 'phase-based',
    });
    expect(preview.patch?.step).toMatchObject({
      name: 'Batch Delete',
      agent: 'developer',
    });
  });
});
