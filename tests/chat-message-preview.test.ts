import { describe, expect, test } from 'vitest';

import { extractLastChatPreview } from '@/lib/chat/message-preview';

describe('extractLastChatPreview', () => {
  test('falls back to the latest visible message when the last assistant chunk is transport noise', () => {
    const preview = extractLastChatPreview([
      {
        role: 'user',
        content: '请回复一个json：{"active":false}',
      },
      {
        role: 'assistant',
        content: '<!-- chunk-boundary -->\n{"active":false',
        rawContent: '<!-- chunk-boundary -->\n{"active":false',
      },
    ]);

    expect(preview).toBe('请回复一个json：{"active":false}');
  });

  test('keeps the visible assistant text before a hidden chunk boundary tail', () => {
    const preview = extractLastChatPreview([
      {
        role: 'assistant',
        content: '处理中',
        rawContent: '处理中\n\n<!-- chunk-boundary -->\n\n{"active":false',
      },
    ]);

    expect(preview).toBe('处理中');
  });

  test('preserves a literal <result> mention in normal assistant prose', () => {
    const preview = extractLastChatPreview([
      {
        role: 'assistant',
        content: '接下来会输出 `<result>` 卡片，而不是直接展示 JSON。',
      },
    ]);

    expect(preview).toBe('接下来会输出 `<result>` 卡片，而不是直接展示 JSON。');
  });
});
