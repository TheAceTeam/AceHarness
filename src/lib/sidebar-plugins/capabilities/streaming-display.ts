/**
 * Streaming Display Capability Implementation
 *
 * Manages streaming message display in the central chat area.
 */

import type { StreamingDisplayCapability, ChatDisplayMessage } from './types';

export function createStreamingDisplayCapability(
  setStreamingMessageId: (id: string | null) => void,
  appendSessionMessage: (sessionId: string, message: any) => Promise<void>,
  updateSessionMessage: (sessionId: string, messageId: string, patch: any) => Promise<void>,
  getSessionId: () => string | null,
): StreamingDisplayCapability {
  return {
    start(messageId: string) {
      setStreamingMessageId(messageId);
    },
    appendMessage(message: ChatDisplayMessage) {
      const sessionId = getSessionId();
      if (!sessionId) return;
      void appendSessionMessage(sessionId, {
        id: message.id,
        role: message.role,
        content: message.content,
        rawContent: message.rawContent || message.content,
        timestamp: Date.now(),
        engine: message.engine,
        model: message.model,
        cards: message.cards,
      });
    },
    updateMessage(messageId: string, patch: Partial<ChatDisplayMessage>) {
      const sessionId = getSessionId();
      if (!sessionId) return;
      void updateSessionMessage(sessionId, messageId, {
        role: patch.role,
        content: patch.content,
        rawContent: patch.rawContent || patch.content,
        engine: patch.engine,
        model: patch.model,
        cards: patch.cards,
      });
    },
    end(messageId: string) {
      setStreamingMessageId(null);
    },
  };
}
