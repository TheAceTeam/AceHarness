import { describe, expect, test } from 'vitest';
import { compactRuntimeOutputPreview } from '@/lib/run/output-compaction';

describe('run output compaction', () => {
  test('keeps short output unchanged', () => {
    const result = compactRuntimeOutputPreview('short output', 100);
    expect(result).toEqual({
      output: 'short output',
      outputBytes: Buffer.byteLength('short output', 'utf-8'),
      truncated: false,
    });
  });

  test('truncates large runtime output and preserves byte count', () => {
    const output = 'A'.repeat(200);
    const result = compactRuntimeOutputPreview(output, 50);
    expect(result.output).toContain('A'.repeat(50));
    expect(result.output).toContain('已截断');
    expect(result.outputBytes).toBe(Buffer.byteLength(output, 'utf-8'));
    expect(result.truncated).toBe(true);
  });
});
