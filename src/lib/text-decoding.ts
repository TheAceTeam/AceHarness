import { readFileSync } from 'fs';

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

function scoreDecodedText(text: string): number {
  if (!text) return 0;
  const cjk = countMatches(text, /[\u3400-\u9fff]/g);
  const replacement = countMatches(text, /\uFFFD/g);
  const suspicious = countMatches(text, /[ÃÂÅÆÐÑØæçðñ�]/g);
  return cjk * 2 - replacement * 8 - suspicious;
}

export function decodeTextBufferBestEffort(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  if (process.platform !== 'win32') {
    return utf8;
  }

  let gb18030 = '';
  try {
    gb18030 = new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }

  return scoreDecodedText(gb18030) > scoreDecodedText(utf8) ? gb18030 : utf8;
}

export function readTextFileBestEffort(filePath: string): string {
  return decodeTextBufferBestEffort(readFileSync(filePath));
}
