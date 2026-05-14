import { describe, expect, test, vi } from 'vitest';
import { WorkflowManager } from '@/lib/workflow/manager';

describe('workflow-manager result protocol', () => {
  test('parseStepVerdict accepts bare json verdict objects', () => {
    const manager = Object.create(WorkflowManager.prototype) as WorkflowManager & {
      parseBugCount: (output: string) => number;
    };
    manager.parseBugCount = vi.fn(() => 0);

    expect(manager.parseStepVerdict('{"verdict":"pass","remaining_issues":2,"summary":"done"}')).toEqual({
      verdict: 'pass',
      remainingIssues: 2,
      summary: 'done',
    });
  });
});
