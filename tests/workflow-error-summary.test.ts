import { describe, expect, test } from 'vitest';
import {
  formatWorkflowFailureReason,
  formatWorkflowFailureReasonWithStepLogs,
  isLiveTextTruncated,
} from '@/lib/workflow/error-summary';

describe('workflow error summary', () => {
  test('uses the final streamed chunk and removes stream markers', () => {
    const raw = [
      '引擎异常，已停止工作流：',
      '<!-- timestamp: 2026-08-04T02:47:14.626Z -->',
      '先读取项目规范并检查源码。',
      '<!-- chunk-boundary -->',
      '<!-- timestamp: 2026-08-04T02:54:07.458Z -->',
      'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    ].join('\n');

    expect(formatWorkflowFailureReason(raw)).toBe(
      '引擎异常，已停止工作流：unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE","message":"Insufficient account balance"}',
    );
  });

  test('keeps ordinary errors readable', () => {
    expect(formatWorkflowFailureReason('模型 API 不可用')).toBe('模型 API 不可用');
  });

  test('keeps both ends of an unusually long provider error', () => {
    const raw = `引擎异常，已停止工作流：${'a'.repeat(1200)}TAIL-ERROR`;
    const summary = formatWorkflowFailureReason(raw, 300);

    expect(summary.length).toBeLessThanOrEqual(300);
    expect(summary).toContain('引擎异常，已停止工作流：');
    expect(summary).toContain('TAIL-ERROR');
    expect(summary).toContain('错误内容过长');
  });

  test('recognizes compact live status text that lost its tail', () => {
    expect(isLiveTextTruncated('前面的错误\n\n[已截断 100 字，完整内容请查看实时输出或运行详情]')).toBe(true);
    expect(isLiveTextTruncated('完整错误')).toBe(false);
  });

  test('adds the latest failed step error when the status only has a recovery gate', () => {
    expect(formatWorkflowFailureReasonWithStepLogs(
      '状态 "核心翻译" 存在失败步骤，必须先从失败断点恢复并重试：核心翻译-词法语法分析器',
      ['核心翻译-词法语法分析器'],
      [
        {
          stepName: '核心翻译-词法语法分析器',
          status: 'failed',
          error: '步骤执行超时：已超过配置上限 30 分钟。',
        },
      ],
    )).toContain('步骤执行超时：已超过配置上限 30 分钟。');
  });
});
