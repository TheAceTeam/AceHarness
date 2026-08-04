import { describe, expect, test } from 'vitest';
import {
  compactWorkflowStatusDeltaForLive,
  compactWorkflowStatusForLive,
} from '@/lib/workflow/live-status';

describe('workflow live status normalization', () => {
  test('clears active runtime fields for completed snapshots', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'completed',
      runId: 'run-001',
      currentPhase: '完成',
      currentStep: '完成-final-step',
      activeSteps: ['完成-final-step'],
      activeConcurrencyGroups: [{ id: 'group-1', status: 'completed' }],
      completedSteps: ['完成-final-step'],
      failedSteps: [],
    }, 'workflow.yaml') as any;

    expect(snapshot.status).toBe('completed');
    expect(snapshot.currentStep).toBeNull();
    expect(snapshot.activeSteps).toEqual([]);
    expect(snapshot.activeConcurrencyGroups).toEqual([]);
  });

  test('clears active runtime fields for completed deltas', () => {
    const delta = compactWorkflowStatusDeltaForLive({
      status: 'completed',
      runId: 'run-001',
      currentPhase: '完成',
      currentStep: '完成-final-step',
      activeSteps: ['完成-final-step'],
      activeConcurrencyGroups: [{ id: 'group-1', status: 'completed' }],
    }, 'workflow.yaml') as any;

    expect(delta.currentStep).toBeNull();
    expect(delta.activeSteps).toEqual([]);
    expect(delta.activeConcurrencyGroups).toEqual([]);
  });

  test('keeps superseded step attempts visible in compact status history', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'running',
      runId: 'run-001',
      currentPhase: '设计',
      currentStep: '设计-review-step',
      activeSteps: ['设计-review-step'],
      activeConcurrencyGroups: [],
      completedSteps: [],
      failedSteps: [],
      stepLogs: [{
        id: 'attempt-1',
        stepName: '设计-review-step',
        agent: 'reviewer',
        status: 'failed',
        error: 'old failure',
        superseded: true,
        supersededAt: '2026-07-30T08:00:00.000Z',
        supersededByStep: '设计-review-step',
      }],
    }, 'workflow.yaml') as any;

    expect(snapshot.stepLogs).toEqual([expect.objectContaining({
      id: 'attempt-1',
      status: 'failed',
      superseded: true,
      supersededAt: '2026-07-30T08:00:00.000Z',
      supersededByStep: '设计-review-step',
    })]);
  });

  test('summarizes streamed engine errors before compacting status', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'failed',
      statusReason: [
        '引擎异常，已停止工作流：',
        '<!-- timestamp: 2026-08-04T02:47:14.626Z -->',
        '前面的执行说明。',
        '<!-- chunk-boundary -->',
        '<!-- timestamp: 2026-08-04T02:54:07.458Z -->',
        'unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE"}',
      ].join('\n'),
    }, 'workflow.yaml') as any;

    expect(snapshot.statusReason).toBe(
      '引擎异常，已停止工作流：unexpected status 403 Forbidden: {"code":"INSUFFICIENT_BALANCE"}',
    );
  });

  test('adds the latest failed step error to a recovery-gate status reason', () => {
    const snapshot = compactWorkflowStatusForLive({
      status: 'failed',
      statusReason: '状态 "核心翻译" 存在失败步骤，必须先从失败断点恢复并重试：核心翻译-词法语法分析器',
      failedSteps: ['核心翻译-词法语法分析器'],
      stepLogs: [
        {
          stepName: '核心翻译-词法语法分析器',
          status: 'failed',
          error: '步骤执行超时：已超过配置上限 30 分钟。',
        },
      ],
    }, 'workflow.yaml') as any;

    expect(snapshot.statusReason).toContain('步骤执行超时：已超过配置上限 30 分钟。');
  });
});
