import { describe, expect, test } from 'vitest';

import { isChatAiBusy } from '@/components/chat/ChatPageContent';

describe('chat loading guard', () => {
  test('keeps the bottom thinking indicator while a regular response is loading', () => {
    expect(isChatAiBusy({
      loading: true,
      streamingMessageId: null,
      messages: [{ workflowThinking: false }],
    })).toBe(true);
  });

  test('stops the bottom thinking indicator when no response is active', () => {
    expect(isChatAiBusy({
      loading: false,
      streamingMessageId: null,
      messages: [{ workflowThinking: false }],
    })).toBe(false);
  });

  test('keeps the bottom thinking indicator for a workflow runtime thinking message', () => {
    expect(isChatAiBusy({
      loading: false,
      streamingMessageId: null,
      messages: [{ workflowThinking: true }],
    })).toBe(true);
  });
});
