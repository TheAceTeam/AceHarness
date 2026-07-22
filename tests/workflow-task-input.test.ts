import { describe, expect, test } from 'vitest';
import {
  formatWorkflowTaskInputForPrompt,
  getWorkflowTaskInputTitle,
  hasWorkflowTaskInput,
  normalizeWorkflowTaskInput,
} from '@/lib/workflow/task-input';

describe('workflow task input', () => {
  test('normalizes only supported non-empty string fields', () => {
    expect(normalizeWorkflowTaskInput({
      title: '  Fix issue  ',
      issueUrl: ' https://example.test/issues/1 ',
      targetBranch: '',
      acceptanceCriteria: 42,
      unexpected: 'ignored',
    })).toEqual({
      title: 'Fix issue',
      issueUrl: 'https://example.test/issues/1',
    });
  });

  test('falls back to issue url and description when no title exists', () => {
    expect(getWorkflowTaskInputTitle({ issueUrl: 'https://example.test/issues/2' })).toBe('https://example.test/issues/2');
    expect(getWorkflowTaskInputTitle({ description: '\nFirst useful line\nSecond line' })).toBe('First useful line');
    expect(hasWorkflowTaskInput({})).toBe(false);
  });

  test('formats task input for agent prompt', () => {
    const prompt = formatWorkflowTaskInputForPrompt({
      title: '修复 Issue',
      issueUrl: 'https://example.test/issues/3',
      targetBranch: 'dev',
      acceptanceCriteria: '测试通过',
      description: '复现步骤和期望行为',
    });

    expect(prompt).toContain('## 本次任务输入');
    expect(prompt).toContain('这些内容只约束当前 run');
    expect(prompt).toContain('- 任务标题: 修复 Issue');
    expect(prompt).toContain('- Issue 链接: https://example.test/issues/3');
    expect(prompt).toContain('- 目标分支: dev');
    expect(prompt).toContain('测试通过');
    expect(prompt).toContain('复现步骤和期望行为');
  });
});
