import { wrapAceProcessBlock } from '@/lib/chat/ai-process-blocks';

/** Normalize reasoning into the shared transcript process block. */
export function formatAceReasoning(text: string): string {
  const value = String(text || '');
  if (!value) return '';
  // Some ACP adapters already emit the shared process envelope. Keeping this
  // helper idempotent avoids nested reasoning blocks when normalizing streams.
  if (value.includes('<ace-process>')) return value;
  return wrapAceProcessBlock('reasoning', {}, value);
}
