import { describe, expect, test } from 'vitest';
import * as WorkbenchClient from '@/client/pages/workbench/WorkbenchClient';

describe('lightweight workbench overview observability', () => {
  test('reports compact token consumption only when token evidence exists', () => {
    expect(WorkbenchClient.buildLightweightTokenConsumptionMetric({
      hasData: true,
      total: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadInputTokens: 50,
      },
    })).toMatchObject({
      status: '已记录',
      value: '1,250',
      available: true,
      details: [
        '输入 1,000 · 输出 200',
        '缓存命中 50 / 5%',
      ],
    });

    expect(WorkbenchClient.buildLightweightTokenConsumptionMetric({
      hasData: false,
      total: {
        inputTokens: 0,
        outputTokens: 0,
      },
    })).toMatchObject({
      status: '未记录',
      value: '不可用',
      available: false,
    });
  });

  test('uses the shared live phase and step location during preparation', () => {
    expect(WorkbenchClient.formatWorkflowLocation('准备阶段', '同步 Skills')).toBe('准备阶段 / 同步 Skills');
    expect(WorkbenchClient.formatWorkflowLocation('核心翻译', '核心翻译-词法语法分析器')).toBe('核心翻译 / 词法语法分析器');
    expect(WorkbenchClient.formatWorkflowLocation('准备阶段', null)).toBe('准备阶段');
  });
});
