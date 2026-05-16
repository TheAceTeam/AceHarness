import { describe, expect, test, vi, beforeEach } from 'vitest';
import { sendAsyncRoundtableNotification, buildForceTransitionNotificationMessage } from '@/lib/roundtable/async-notify';
import * as store from '@/lib/roundtable/store';

vi.mock('@/lib/roundtable/store', () => ({
  createRoundtableMessage: vi.fn((input: any) => ({
    id: `msg-${Date.now()}`,
    roundId: input.roundId,
    speakerType: input.speakerType,
    speakerName: input.speakerName,
    content: input.content,
    status: input.status,
    timestamp: Date.now(),
  })),
  saveRoundtable: vi.fn().mockResolvedValue(undefined),
}));

const systemUser = { id: 'system', username: 'system', personalDir: '' } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// buildForceTransitionNotificationMessage
// ---------------------------------------------------------------------------

describe('buildForceTransitionNotificationMessage', () => {
  test('builds basic transition message with from/to states', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'design',
      toState: 'implementation',
    });

    expect(msg).toContain('工作流强制转移通知');
    expect(msg).toContain('"design"');
    expect(msg).toContain('"implementation"');
    expect(msg).toContain('对你的影响');
  });

  test('includes instruction section when provided', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'design',
      toState: 'implementation',
      instruction: '需求已明确，直接开始编码',
    });

    expect(msg).toContain('转移原因');
    expect(msg).toContain('需求已明确，直接开始编码');
  });

  test('includes interrupted conclusion when provided', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'design',
      toState: 'implementation',
      interruptedConclusion: '设计方案已完成 80%',
    });

    expect(msg).toContain('被中断状态的中间结论');
    expect(msg).toContain('设计方案已完成 80%');
  });

  test('includes both instruction and conclusion together', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'design',
      toState: 'implementation',
      instruction: '时间紧急',
      interruptedConclusion: '已完成数据库设计',
    });

    expect(msg).toContain('转移原因');
    expect(msg).toContain('时间紧急');
    expect(msg).toContain('被中断状态的中间结论');
    expect(msg).toContain('已完成数据库设计');
  });

  test('omits instruction section when not provided', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'a',
      toState: 'b',
    });

    expect(msg).not.toContain('## 转移原因');
  });

  test('omits interrupted conclusion section when not provided', () => {
    const msg = buildForceTransitionNotificationMessage({
      fromState: 'a',
      toState: 'b',
    });

    expect(msg).not.toContain('## 被中断状态的中间结论');
  });
});

// ---------------------------------------------------------------------------
// sendAsyncRoundtableNotification
// ---------------------------------------------------------------------------

describe('sendAsyncRoundtableNotification', () => {
  test('creates a completed roundtable record with correct structure', async () => {
    const result = await sendAsyncRoundtableNotification({
      topic: '测试通知',
      message: '这是一条测试消息',
      recipients: ['agent1', 'agent2'],
      createdBy: systemUser,
    });

    expect(result.id).toMatch(/^roundtable-/);
    expect(result.status).toBe('completed');
    expect(result.topic).toBe('测试通知');
    expect(result.participants).toEqual(['agent1', 'agent2']);
    expect(result.createdBy).toBe('system');
    expect(result.messages).toHaveLength(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].status).toBe('completed');
  });

  test('populates run binding fields on the record', async () => {
    const now = Date.now();
    const result = await sendAsyncRoundtableNotification({
      topic: '工作流通知',
      message: '测试消息',
      recipients: ['agent1'],
      createdBy: systemUser,
      runBinding: {
        runId: 'run-123',
        configFile: 'workflow.yaml',
        supervisorAgent: 'supervisor',
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(result.runId).toBe('run-123');
    expect(result.configFile).toBe('workflow.yaml');
    expect(result.supervisorAgent).toBe('supervisor');
  });

  test('falls back to default-supervisor when run binding omits supervisor', async () => {
    const now = Date.now();
    const result = await sendAsyncRoundtableNotification({
      topic: '工作流通知',
      message: '测试消息',
      recipients: ['agent1'],
      createdBy: systemUser,
      runBinding: {
        runId: 'run-123',
        configFile: 'workflow.yaml',
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(result.supervisorAgent).toBe('default-supervisor');
  });

  test('persists roundtable record by default', async () => {
    await sendAsyncRoundtableNotification({
      topic: '测试通知',
      message: '测试消息',
      recipients: ['agent1'],
      createdBy: systemUser,
    });

    expect(store.saveRoundtable).toHaveBeenCalledTimes(1);
  });

  test('skips persistence when persist is false', async () => {
    await sendAsyncRoundtableNotification({
      topic: '测试通知',
      message: '测试消息',
      recipients: ['agent1'],
      createdBy: systemUser,
      persist: false,
    });

    expect(store.saveRoundtable).not.toHaveBeenCalled();
  });

  test('propagates persistence errors', async () => {
    vi.mocked(store.saveRoundtable).mockRejectedValueOnce(new Error('disk full'));

    await expect(
      sendAsyncRoundtableNotification({
        topic: '测试通知',
        message: '测试消息',
        recipients: ['agent1'],
        createdBy: systemUser,
      }),
    ).rejects.toThrow('disk full');
  });

  test('message is created with system speaker metadata', async () => {
    const result = await sendAsyncRoundtableNotification({
      topic: '强制转移通知',
      message: '工作流已强制转移',
      recipients: ['agent1'],
      createdBy: systemUser,
    });

    expect(result.messages[0].speakerType).toBe('system');
    expect(result.messages[0].speakerName).toBe('系统通知');
    expect(result.messages[0].content).toBe('工作流已强制转移');
    expect(result.messages[0].status).toBe('done');
  });

  test('round summary is set to notification-only text', async () => {
    const result = await sendAsyncRoundtableNotification({
      topic: '测试通知',
      message: '测试消息',
      recipients: ['agent1'],
      createdBy: systemUser,
    });

    expect(result.rounds[0].summary).toBe('异步通知已发送，无需回复');
  });

  test('handles empty recipients list', async () => {
    const result = await sendAsyncRoundtableNotification({
      topic: '测试通知',
      message: '测试消息',
      recipients: [],
      createdBy: systemUser,
    });

    expect(result.participants).toEqual([]);
    expect(result.rounds[0].participants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// integration: build message + send notification
// ---------------------------------------------------------------------------

describe('force transition notification end-to-end', () => {
  test('builds message then sends as completed roundtable notification', async () => {
    const message = buildForceTransitionNotificationMessage({
      fromState: 'design',
      toState: 'implementation',
      instruction: '需求变更，需要立即实现',
      interruptedConclusion: '设计文档已完成 60%',
    });

    const now = Date.now();
    const result = await sendAsyncRoundtableNotification({
      topic: '工作流强制转移: design → implementation',
      message,
      recipients: ['designer', 'developer', 'supervisor'],
      createdBy: systemUser,
      runBinding: {
        runId: 'run-456',
        configFile: 'project-workflow.yaml',
        supervisorAgent: 'project-supervisor',
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(result.status).toBe('completed');
    expect(result.topic).toContain('design → implementation');
    expect(result.participants).toEqual(['designer', 'developer', 'supervisor']);
    expect(result.messages[0].content).toContain('需求变更');
    expect(result.messages[0].content).toContain('设计文档已完成 60%');
    expect(result.supervisorAgent).toBe('project-supervisor');
    expect(store.saveRoundtable).toHaveBeenCalledTimes(1);
  });
});
