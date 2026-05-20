/**
 * Streaming Display Capability Implementation
 *
 * Manages streaming message display in the central chat area.
 */

import type { StreamingDisplayCapability, ChatDisplayMessage } from './types';

function mergeStreamingText(previous: string, next: string): string {
  const prev = String(previous || '');
  const incoming = String(next || '');
  if (!prev) return incoming;
  if (!incoming) return prev;
  if (incoming === prev) return prev;
  if (incoming.startsWith(prev)) return incoming;
  if (prev.endsWith(incoming)) return prev;
  return `${prev}${incoming}`;
}

export function createStreamingDisplayCapability(
  setStreamingMessageId: (id: string | null) => void,
  appendSessionMessage: (sessionId: string, message: any) => Promise<void>,
  updateSessionMessage: (sessionId: string, messageId: string, patch: any) => Promise<void>,
  getSessionId: () => string | null,
): StreamingDisplayCapability {
  const rawContentByMessageId = new Map<string, string>();
  const contentByMessageId = new Map<string, string>();

  return {
    start(messageId: string) {
      setStreamingMessageId(messageId);
    },
    appendMessage(message: ChatDisplayMessage) {
      const sessionId = getSessionId();
      if (!sessionId) return;
      const rawContent = message.rawContent || message.content;
      const visibleContent = message.content || '';
      if (message.id) rawContentByMessageId.set(message.id, rawContent);
      if (message.id) contentByMessageId.set(message.id, visibleContent);
      void appendSessionMessage(sessionId, {
        id: message.id,
        role: message.role,
        content: visibleContent,
        rawContent,
        timestamp: Date.now(),
        engine: message.engine,
        model: message.model,
        cards: message.cards,
      });
    },
    updateMessage(messageId: string, patch: Partial<ChatDisplayMessage>) {
      const sessionId = getSessionId();
      if (!sessionId) return;
      const previousRawContent = rawContentByMessageId.get(messageId) || '';
      const nextRawChunk = patch.rawContent || patch.content || '';
      const mergedRawContent = mergeStreamingText(previousRawContent, nextRawChunk);
      rawContentByMessageId.set(messageId, mergedRawContent);
      const previousVisibleContent = contentByMessageId.get(messageId) || '';
      const mergedVisibleContent = patch.content
        ? mergeStreamingText(previousVisibleContent, patch.content)
        : previousVisibleContent;
      contentByMessageId.set(messageId, mergedVisibleContent);
      void updateSessionMessage(sessionId, messageId, {
        role: patch.role,
        content: mergedVisibleContent,
        rawContent: mergedRawContent,
        engine: patch.engine,
        model: patch.model,
        cards: patch.cards,
      });
    },
    end(messageId: string) {
      rawContentByMessageId.delete(messageId);
      contentByMessageId.delete(messageId);
      setStreamingMessageId(null);
    },
  };
}
