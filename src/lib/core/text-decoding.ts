import { readFileSync } from 'fs';
import { isWindows } from '@/lib/core/runtime-platform';

function decodeUtf8Strict(buffer: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length || 0;
}

function scoreDecodedText(text: string): number {
  if (!text) return 0;
  const cjk = countMatches(text, /[\u3400-\u9fff]/g);
  const replacement = countMatches(text, /\uFFFD/g);
  const suspicious = countMatches(text, /[ÃÂÅÆÐÑØæçðñ�銆锛鈥馃猬鉁鏌璇鍒闃]/g);
  const privateUse = countMatches(text, /[\uE000-\uF8FF]/g);
  const mojibakeWords = countMatches(text, /(闂|婢勬竻|璇嗗埆|缂哄彛|瀹煡|鐩爣|鏂囨。|闇€|姹傛)/g);
  return cjk * 2 - replacement * 8 - suspicious * 4 - privateUse * 6 - mojibakeWords * 10;
}

export function decodeTextBufferBestEffort(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  const strictUtf8 = decodeUtf8Strict(buffer);
  if (strictUtf8 != null && !strictUtf8.includes('\uFFFD')) {
    return strictUtf8;
  }

  if (!isWindows()) {
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
