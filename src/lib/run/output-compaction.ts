const DEFAULT_RUNTIME_OUTPUT_PREVIEW_LIMIT = 12000;

export function compactRuntimeOutputPreview(
  output: string,
  limit = DEFAULT_RUNTIME_OUTPUT_PREVIEW_LIMIT
): { output: string; outputBytes: number; truncated: boolean } {
  const text = typeof output === 'string' ? output : '';
  const outputBytes = Buffer.byteLength(text, 'utf-8');
  if (text.length <= limit) {
    return { output: text, outputBytes, truncated: false };
  }
  return {
    output: `${text.slice(0, limit)}\n\n[已截断 ${text.length - limit} 字，完整内容请查看步骤输出或实时流]`,
    outputBytes,
    truncated: true,
  };
}

export function appendRuntimeOutputPreview(
  currentPreview: string,
  delta: string,
  limit = DEFAULT_RUNTIME_OUTPUT_PREVIEW_LIMIT
): { output: string; outputBytes: number; truncated: boolean } {
  const current = typeof currentPreview === 'string' ? currentPreview : '';
  const nextDelta = typeof delta === 'string' ? delta : '';
  return compactRuntimeOutputPreview(`${current}${nextDelta}`, limit);
}
