import { describe, expect, test } from 'vitest';
import {
  attachWorkflowTaskInputFieldLabels,
  formatWorkflowTaskInputForPrompt,
  getMissingRequiredWorkflowTaskInputFields,
  getWorkflowTaskInputFieldValue,
  getWorkflowTaskInputTitle,
  hasWorkflowTaskInput,
  normalizeWorkflowTaskInput,
  resolveWorkflowTaskInputFields,
  setWorkflowTaskInputFieldValue,
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
      title: '完成接口兼容性评估',
      issueUrl: 'https://example.test/docs/api',
      targetBranch: 'dev',
      acceptanceCriteria: '测试通过',
      description: '评估兼容风险和交付边界',
    });

    expect(prompt).toContain('## 本次任务输入');
    expect(prompt).toContain('这些内容只约束当前 run');
    expect(prompt).toContain('- 任务名称: 完成接口兼容性评估');
    expect(prompt).toContain('- 参考资料 / 链接: https://example.test/docs/api');
    expect(prompt).toContain('- 目标分支: dev');
    expect(prompt).toContain('测试通过');
    expect(prompt).toContain('评估兼容风险和交付边界');
  });

  test('resolves configurable task input fields', () => {
    const fields = resolveWorkflowTaskInputFields({
      fields: [
        { id: 'title', label: '评审对象', required: true },
        { id: 'reviewFocus', label: '评审重点', type: 'textarea' },
        { id: 'bad id', label: '无效' },
        { id: 'reviewFocus', label: '重复' },
      ],
    });

    expect(fields).toEqual([
      { id: 'title', label: '评审对象', type: 'text', required: true, placeholder: undefined, description: undefined },
      { id: 'reviewFocus', label: '评审重点', type: 'textarea', required: false, placeholder: undefined, description: undefined },
      { id: 'badid', label: '无效', type: 'text', required: false, placeholder: undefined, description: undefined },
    ]);
  });

  test('reports only configured required fields that are absent from one run input', () => {
    const fields = resolveWorkflowTaskInputFields({
      fields: [
        { id: 'title', label: '本次缺陷标题', required: true },
        { id: 'description', label: '本次缺陷说明', type: 'textarea', required: true },
        { id: 'issueUrl', label: '问题单 / PR 链接', type: 'url' },
      ],
    });

    expect(getMissingRequiredWorkflowTaskInputFields({ title: '修复登录失败' }, fields))
      .toMatchObject([{ id: 'description', label: '本次缺陷说明' }]);
    expect(getMissingRequiredWorkflowTaskInputFields({
      title: '修复登录失败',
      description: '稳定复现后修复并回归验证',
    }, fields)).toEqual([]);
  });

  test('formats custom task input fields for agent prompt', () => {
    const fields = resolveWorkflowTaskInputFields({
      fields: [
        { id: 'title', label: '评审对象', required: true },
        { id: 'reviewFocus', label: '评审重点', type: 'textarea' },
      ],
    });
    const input = attachWorkflowTaskInputFieldLabels(
      setWorkflowTaskInputFieldValue(
        { title: '登录方案' },
        'reviewFocus',
        '检查权限边界\n检查回滚方案',
      ),
      fields,
    );

    expect(getWorkflowTaskInputFieldValue(input, 'reviewFocus')).toBe('检查权限边界\n检查回滚方案');
    const prompt = formatWorkflowTaskInputForPrompt(input, fields);
    expect(prompt).toContain('- 评审对象: 登录方案');
    expect(prompt).toContain('- 评审重点:');
    expect(prompt).toContain('检查权限边界\n检查回滚方案');
  });
});
