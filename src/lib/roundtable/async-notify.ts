/**
 * 异步圆桌通知机制
 * 用于在工作流强制转移时，向相关 agent 发送通知消息，不阻塞主流程
 */

import { randomUUID } from 'crypto';
import type { AgentChatUserContext } from '@/lib/agent/chat-service';
import type { WorkflowRunBindingLike } from '@/lib/agent/conversations';
import { createRoundtableMessage, saveRoundtable, type RoundtableRecord } from '@/lib/roundtable/store';

export interface AsyncNotifyInput {
  /** 通知主题 */
  topic: string;
  /** 通知内容 */
  message: string;
  /** 接收通知的 agent 列表 */
  recipients: string[];
  /** 用户上下文 */
  createdBy: AgentChatUserContext;
  /** 工作流绑定信息 */
  runBinding?: WorkflowRunBindingLike | null;
  /** 工作流上下文 */
  workflowContext?: Record<string, any> | null;
  /** 工作目录 */
  workingDirectory?: string;
  /** 是否需要持久化圆桌记录（默认 true） */
  persist?: boolean;
}

/**
 * 异步发送圆桌通知
 * 仅创建通知记录，不实际调用 agent（agent 会在下次被调用时通过 workflow context 读取通知）
 * 返回 Promise 但调用方可以不 await
 */
export async function sendAsyncRoundtableNotification(input: AsyncNotifyInput): Promise<RoundtableRecord> {
  const roundId = `notify-${randomUUID()}`;
  const supervisorAgent = input.runBinding?.supervisorAgent || 'default-supervisor';

  // 创建圆桌记录
  const record: RoundtableRecord = {
    id: `roundtable-${randomUUID()}`,
    createdBy: input.createdBy.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'completed', // 通知类型直接标记为完成
    topic: input.topic,
    runId: input.runBinding?.runId,
    configFile: input.runBinding?.configFile,
    supervisorAgent,
    participants: input.recipients,
    agentSessions: {},
    messages: [
      createRoundtableMessage({
        roundId,
        speakerType: 'system',
        speakerName: '系统通知',
        content: input.message,
        status: 'done',
      }),
    ],
    rounds: [{
      id: roundId,
      topic: input.topic,
      participants: input.recipients,
      status: 'completed',
      startedAt: Date.now(),
      completedAt: Date.now(),
      summary: '异步通知已发送，无需回复',
    }],
  };

  try {
    // 持久化圆桌记录（可选）
    if (input.persist !== false) {
      await saveRoundtable(record);
    }

    console.log(`[AsyncNotify] 已创建通知记录: ${record.id}，主题: ${input.topic}，接收者: ${input.recipients.join(', ')}`);
    return record;
  } catch (error: any) {
    console.error('[AsyncNotify] 创建异步通知失败:', error);
    record.status = 'failed';
    record.messages.push(createRoundtableMessage({
      roundId,
      speakerType: 'system',
      speakerName: '系统',
      content: `通知创建失败: ${error?.message || '未知错误'}`,
      status: 'error',
      error: error?.message || '未知错误',
    }));
    throw error;
  }
}

/**
 * 构建强制转移通知消息
 */
export function buildForceTransitionNotificationMessage(input: {
  fromState: string;
  toState: string;
  instruction?: string;
  interruptedConclusion?: string;
}): string {
  const parts = [
    `# 工作流强制转移通知`,
    ``,
    `工作流已由人工操作从状态 **"${input.fromState}"** 强制跳转到 **"${input.toState}"**。`,
    ``,
  ];

  if (input.instruction) {
    parts.push(`## 转移原因`);
    parts.push(input.instruction);
    parts.push(``);
  }

  if (input.interruptedConclusion) {
    parts.push(`## 被中断状态的中间结论`);
    parts.push(input.interruptedConclusion);
    parts.push(``);
  }

  parts.push(`## 对你的影响`);
  parts.push(`- 如果你是被中断的状态 agent：你的执行已被终止，请在下次被调用时根据上述原因调整策略`);
  parts.push(`- 如果你是目标状态 agent：请基于上述转移原因和中间结论开始工作`);
  parts.push(`- 如果你是 supervisor 或其他相关 agent：请知晓此转移，在后续决策中考虑此上下文`);

  return parts.join('\n');
}
