import { normalizeStructuredResultBlocks } from '../ai/result-channel';

export function normalizeEngineOutput(output: string): string {
  return normalizeStructuredResultBlocks(String(output ?? '')).trim();
}

export function normalizeEngineChunk(content: string, hasExistingOutput: boolean): string {
  const text = String(content ?? '');
  if (!text) return '';
  return hasExistingOutput ? text : text.replace(/^\s+/, '');
}
