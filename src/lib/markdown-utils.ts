/**
 * Wrap content in a markdown code fence.
 *
 * Strategy:
 * - Choose the safer fence family between backticks and tildes.
 * - Use fence width = maxRunInContent + 1 (at least 3), so inner fences cannot close it.
 * - Sanitize language info string to avoid accidental line breaks/closure issues.
 */
export function fenced(content: string, lang = ''): string {
  const normalized = String(content ?? '').replace(/\r\n?/g, '\n');

  const longestRun = (text: string, ch: '`' | '~'): number => {
    let max = 0;
    let cur = 0;
    for (const c of text) {
      if (c === ch) {
        cur += 1;
        if (cur > max) max = cur;
      } else {
        cur = 0;
      }
    }
    return max;
  };

  const tildeNeed = Math.max(3, longestRun(normalized, '~') + 1);
  const fenceChar = '~';
  const fenceLen = tildeNeed;
  const fence = fenceChar.repeat(fenceLen);

  const safeLang = /^[A-Za-z0-9_+.-]+$/.test(lang) ? lang : '';
  return `${fence}${safeLang}\n${normalized}\n${fence}`;
}

/** 大内容阈值（字符数），超过此值的工具输出将被截断或替换为文件链接 */
const LARGE_CONTENT_CHAR_THRESHOLD = 50_000; // 50KB
const LARGE_CONTENT_LINE_THRESHOLD = 500;

/**
 * 对有文件路径的大内容，返回文件链接而非完整内容。
 * 对无路径的大内容，截断并提示。
 */
export function formatLargeContent(
  content: string,
  opts: { filePath?: string; lang?: string; summaryLabel?: string },
): string {
  const lines = content.split('\n');
  const label = opts.summaryLabel || '查看内容';

  if (content.length <= LARGE_CONTENT_CHAR_THRESHOLD && lines.length <= LARGE_CONTENT_LINE_THRESHOLD) {
    return `\n<details><summary>${label} (${lines.length} 行)</summary>\n\n${fenced(content, opts.lang)}\n\n</details>\n`;
  }

  // 大内容：有文件路径时用链接，否则截断
  if (opts.filePath) {
    return `\n📎 内容较大 (${lines.length} 行, ${(content.length / 1024).toFixed(0)} KB)，点击打开文件查看: [${opts.filePath}](${opts.filePath})\n`;
  }

  const truncated = lines.slice(0, LARGE_CONTENT_LINE_THRESHOLD).join('\n');
  return `\n<details><summary>${label} (前 ${LARGE_CONTENT_LINE_THRESHOLD}/${lines.length} 行)</summary>\n\n${fenced(truncated, opts.lang)}\n\n</details>\n\n> ⚠️ 输出已截断，共 ${lines.length} 行 (${(content.length / 1024).toFixed(0)} KB)\n`;
}
