import { describe, expect, test } from 'vitest';
import { compactStepConclusion } from '@/lib/state-machine/utils';

describe('compactStepConclusion', () => {
  test('塞爆标签的超长结论截到上限并保留头部', () => {
    const stuffed = `<step-conclusion>\nHEAD-MARKER\n${'y'.repeat(300_000)}\nTAIL-MARKER\n</step-conclusion>`;
    const result = compactStepConclusion(stuffed);
    expect(result.length).toBeLessThan(4100);
    expect(result).toContain('HEAD-MARKER');
    expect(result).not.toContain('TAIL-MARKER');
    expect(result).toContain('...(结论过长已截断)');
  });

  test('正常长度的标签结论原样返回', () => {
    const conclusion = '## 结果 / 裁决\n- 修复完成，裁决 pass。';
    expect(compactStepConclusion(`<step-conclusion>\n${conclusion}\n</step-conclusion>`)).toBe(conclusion);
  });
});
