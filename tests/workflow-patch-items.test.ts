import { describe, expect, test } from 'vitest';
import {
  extractWorkflowPatchItemResult,
  validateWorkflowPatchItem,
  WORKFLOW_PATCH_ITEM_KIND,
} from '@/lib/ai/workflow-patch-items';

describe('workflow patch item protocol', () => {
  test('extracts the design-optimization patch after unrelated result blocks', () => {
    const content = [
      '<result>{"kind":"plan_draft","payload":{"summary":"先整理计划"}}</result>',
      '<result>{"kind":"workflow_patch_item","data":{"filename":"feature.yaml","summary":"优化实现步骤","scope":"step","workflowMode":"state-machine","patch":{"step":{"name":"实现","agent":"developer","task":"补充边界条件与验证"}}}}</result>',
    ].join('\n');

    const extracted = extractWorkflowPatchItemResult(content);

    expect(extracted.ok).toBe(true);
    if (!extracted.ok) return;
    expect(extracted.result.kind).toBe(WORKFLOW_PATCH_ITEM_KIND);
    expect(extracted.result.data).toMatchObject({
      filename: 'feature.yaml',
      scope: 'step',
      workflowMode: 'state-machine',
      patch: {
        step: {
          name: '实现',
          agent: 'developer',
        },
      },
    });
  });

  test('reports the patch fields that violate the state-machine-only contract', () => {
    const result = validateWorkflowPatchItem({
      kind: WORKFLOW_PATCH_ITEM_KIND,
      data: {
        scope: 'phase',
        workflowMode: 'invalid-mode',
        patch: [],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('data.scope');
    expect(result.errors.join('\n')).toContain('data.workflowMode');
    expect(result.errors.join('\n')).toContain('data.patch');
  });
});
