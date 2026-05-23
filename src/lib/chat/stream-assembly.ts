import { parseActions } from '@/lib/chat/actions';

export function appendStreamChunk(previous: string, next: string): string {
  const base = String(previous || '');
  const chunk = String(next || '');
  if (!chunk) return base;
  if (!base) return chunk;
  if (chunk === base) return base;
  if (chunk.startsWith(base)) return chunk;
  return `${base}${chunk}`;
}

function findSuffixPrefixOverlap(source: string, target: string): number {
  const left = String(source || '');
  const right = String(target || '');
  const maxOverlap = Math.min(left.length, right.length);
  for (let size = maxOverlap; size > 0; size -= 1) {
    if (left.slice(-size) === right.slice(0, size)) {
      return size;
    }
  }
  return 0;
}

export function buildFinalRawContent(
  accumulatedRawStream: string,
  accumulatedVisibleContent: string,
  doneResult: string,
): string {
  const raw = String(accumulatedRawStream || '');
  const visible = String(accumulatedVisibleContent || '');
  const result = String(doneResult || '');

  if (!raw) {
    return result || visible;
  }

  if (!result) {
    return raw;
  }

  if (result === raw || result.trim() === raw.trim()) {
    return raw;
  }

  if (raw && result.endsWith(raw)) {
    return result;
  }

  const parsedRawText = String(parseActions(raw).text || '').trim();
  const trimmedResult = result.trim();
  const trimmedVisible = visible.trim();

  if (!trimmedResult) {
    return raw;
  }

  if (!parsedRawText) {
    return appendStreamChunk(raw, result);
  }

  if (
    trimmedResult === parsedRawText
    || parsedRawText.endsWith(trimmedResult)
  ) {
    return raw;
  }

  if (trimmedVisible && result.startsWith(visible)) {
    return appendStreamChunk(raw, result.slice(visible.length));
  }

  if (visible) {
    const overlapSize = findSuffixPrefixOverlap(visible, result);
    if (overlapSize === visible.length) {
      return appendStreamChunk(raw, result.slice(overlapSize));
    }
    if (overlapSize >= 24) {
      return appendStreamChunk(raw, result.slice(overlapSize));
    }
  }

  return raw;
}
