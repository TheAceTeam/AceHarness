import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import { stripAceProcessBlocks } from '@/lib/chat/ai-process-blocks';

export interface ChatPreviewMessageLike {
  role?: 'user' | 'assistant' | 'error' | string;
  content?: string | null;
  rawContent?: string | null;
}

const HUMAN_FEEDBACK_COMMENT_RE = /\n?\s*<!--\s*human-feedback:[\s\S]*?-->\s*\n?/gi;
const CHUNK_BOUNDARY_RE = /<!--\s*chunk-boundary\s*-->/i;

function stripChunkTransportTail(text: string): string {
  const match = CHUNK_BOUNDARY_RE.exec(text);
  if (!match || match.index === undefined) return text;
  return text.slice(0, match.index);
}

function collapsePreviewWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sanitizePreviewSource(source: string | null | undefined, isAssistant: boolean): string {
  let text = String(source || '');
  if (!text) return '';

  if (isAssistant) {
    const normalized = normalizeAssistantDisplay(text, false).visibleText || text;
    text = parseActions(normalized).text || normalized;
  }

  text = stripAceProcessBlocks(text);
  text = text.replace(HUMAN_FEEDBACK_COMMENT_RE, '\n');
  text = stripChunkTransportTail(text);

  return collapsePreviewWhitespace(text);
}

export function extractChatMessagePreview(
  message: ChatPreviewMessageLike | null | undefined,
  options: { maxLength?: number } = {},
): string | undefined {
  if (!message || message.role === 'error') return undefined;

  const maxLength = options.maxLength ?? 100;
  const isAssistant = message.role === 'assistant';
  const candidates = isAssistant
    ? [message.rawContent, message.content]
    : [message.content, message.rawContent];

  for (const candidate of candidates) {
    const preview = sanitizePreviewSource(candidate, isAssistant);
    if (preview) {
      return preview.slice(0, maxLength) || undefined;
    }
  }

  return undefined;
}

export function extractLastChatPreview(
  messages: Array<ChatPreviewMessageLike | null | undefined>,
  options: { maxLength?: number } = {},
): string | undefined {
  for (const message of [...messages].reverse()) {
    const preview = extractChatMessagePreview(message, options);
    if (preview) return preview;
  }
  return undefined;
}
