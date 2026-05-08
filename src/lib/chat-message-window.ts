export interface ChatWindowMessageLike {
  id?: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  cards?: any[];
  actions?: Array<{ status?: string }>;
}

export interface AdaptiveMessageWindowOptions {
  minRecentMessages?: number;
  maxRecentMessages?: number;
  targetWeight?: number;
  streamingMessageId?: string | null;
}

const DEFAULT_OPTIONS = {
  minRecentMessages: 3,
  maxRecentMessages: 20,
  targetWeight: 14,
} as const;

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

export function estimateChatMessageWeight(
  message: ChatWindowMessageLike,
  options?: { isStreaming?: boolean }
): number {
  const content = String(message.rawContent || message.content || '').trim();
  if (!content) return 1;

  let weight = 1;
  const length = content.length;
  if (length > 240) weight += 1;
  if (length > 900) weight += 1;
  if (length > 2200) weight += 1;

  if (countMatches(content, /```/g) >= 2) weight += 2;
  if (countMatches(content, /<result>/gi) >= 1) weight += 1;
  if (countMatches(content, /^\s*[-*+] |\d+\.\s/mg) >= 6) weight += 1;
  if (countMatches(content, /^\s*#{1,6}\s/mg) >= 3) weight += 1;
  if (countMatches(content, /\|.+\|/g) >= 2) weight += 1;
  if ((message.cards?.length || 0) > 0) weight += 2;
  if ((message.actions?.length || 0) > 0) weight += 1;
  if (message.role === 'error') weight += 1;
  if (options?.isStreaming && message.role === 'assistant') weight = Math.max(weight, 4);

  return Math.max(1, Math.min(8, weight));
}

export function computeAdaptiveRecentWindow(
  messages: ChatWindowMessageLike[],
  options?: AdaptiveMessageWindowOptions
): number {
  const resolved = { ...DEFAULT_OPTIONS, ...(options || {}) };
  if (messages.length <= resolved.minRecentMessages) return messages.length;

  let totalWeight = 0;
  let recentCount = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const isStreaming = Boolean(resolved.streamingMessageId && message.id && resolved.streamingMessageId === message.id);
    const weight = estimateChatMessageWeight(message, { isStreaming });
    if (recentCount >= resolved.minRecentMessages && totalWeight + weight > resolved.targetWeight) {
      break;
    }
    totalWeight += weight;
    recentCount += 1;
    if (recentCount >= resolved.maxRecentMessages) {
      break;
    }
  }

  return Math.max(resolved.minRecentMessages, Math.min(messages.length, recentCount));
}
