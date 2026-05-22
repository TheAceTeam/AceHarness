import iconv from 'iconv-lite';
import { isWindows } from '@/lib/core/runtime-platform';

const COMMON_CJK_CHARS = '的一是不了在人有我他这为之大来以个中上们到说国和地也子时道出而要于就下得可你年生自会那后能对着事其里所去行过家学用同于然作方成者多日都三小军无么经法当起与好看天分还进面开心';
const COMMON_PUNCT = '，。！？；：（）《》、';
const MOJIBAKE_MARKERS = /[銆锛鈥馃猬鉁鏌璇鍒闃]/g;
const STRONG_GARBLED_PATTERNS = /(瑙勮|缂栫|鎶€|鍐呭|鏂囨。|璇存槑|闇€|姹傛|鍒涘缓|璁″垝|鐩綍|spec\.md)/;
const WINDOWS_ENCODINGS = ['gbk', 'cp936', 'gb18030'] as const;

function scoreText(text: string): number {
  if (!text) return 0;
  let score = 0;
  for (const char of text) {
    if (COMMON_CJK_CHARS.includes(char)) score += 3;
    if (COMMON_PUNCT.includes(char)) score += 2;
    if ((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z')) score += 1;
  }
  score -= (text.match(/\uFFFD/g)?.length || 0) * 6;
  score -= (text.match(/[\uE000-\uF8FF]/g)?.length || 0) * 5;
  score -= (text.match(MOJIBAKE_MARKERS)?.length || 0) * 2;
  return score;
}

export function repairWindowsMojibake(text: string): string {
  if (!isWindows() || !text) {
    return text;
  }

  let best = text;
  let bestScore = scoreText(text);
  for (const encoding of WINDOWS_ENCODINGS) {
    try {
      const candidate = iconv.decode(iconv.encode(text, encoding), 'utf8');
      const score = scoreText(candidate);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    } catch {
      // Keep trying other Windows encodings.
    }
  }

  if (!best || best === text) {
    return text;
  }

  if (STRONG_GARBLED_PATTERNS.test(text)) {
    return best;
  }

  return bestScore > scoreText(text) + 4 ? best : text;
}
