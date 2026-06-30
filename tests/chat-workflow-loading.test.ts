import { describe, expect, test } from 'vitest';

import {
  buildWorkflowConversationContext,
  isChatAiBusy,
  mergeWorkflowAnswers,
} from '@/components/chat/ChatPageContent';

describe('chat workflow loading guard', () => {
  test('keeps the bottom thinking indicator during workflow clarification gaps', () => {
    const messages = [
      { workflowThinking: false },
      { workflowThinking: false },
    ];

    expect(isChatAiBusy({
      loading: false,
      streamingMessageId: null,
      messages,
      sessionWorkbenchState: {
        lightweightWorkflowDraft: {
          stage: 'clarification',
          busy: true,
        },
      },
    })).toBe(true);
  });

  test('stops the bottom thinking indicator after workflow creation settles', () => {
    expect(isChatAiBusy({
      loading: false,
      streamingMessageId: null,
      messages: [{ workflowThinking: false }],
      sessionWorkbenchState: {
        lightweightWorkflowDraft: {
          stage: 'draft',
          busy: false,
        },
      },
    })).toBe(false);
  });

  test('preserves workflow clarification answer context across draft state merges', () => {
    const answers = mergeWorkflowAnswers(
      { initialRequirements: '分析编译器 unreachable 诊断', clarificationAnswerContext: '目标结果：生成补丁和验证证据' },
      { constraints: '只改诊断模块' },
    );

    expect(answers.initialRequirements).toContain('unreachable');
    expect(answers.clarificationAnswerContext).toContain('生成补丁');
    expect(answers.constraints).toBe('只改诊断模块');
  });

  test('builds workflow creation context from restored conversation messages', () => {
    const context = buildWorkflowConversationContext([
      { role: 'user', content: '/workflow 修复常量传播误报' },
      { role: 'assistant', content: '补充问答已生成。' },
      { role: 'user', content: '已提交补充问答：\n目标结果：补丁、测试和风险说明' },
    ]);

    expect(context).toContain('修复常量传播误报');
    expect(context).toContain('补丁、测试和风险说明');
  });
});
