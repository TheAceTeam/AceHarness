import { describe, expect, test, vi } from 'vitest';

vi.mock('@/lib/core/runtime-platform', () => ({
  isWindows: () => true,
}));

describe('decodeTextBufferBestEffort', () => {
  test('keeps valid UTF-8 Chinese markdown instead of misdetecting it as GB18030', async () => {
    const { decodeTextBufferBestEffort } = await import('@/lib/core/text-decoding');
    const content = [
      '# 问题澄清 - 识别澄清缺口',
      '',
      '## 1. 审查目标与范围',
      '- 本步骤基于前序归档文件《问题澄清 - 理解问题输入》进行完整性和可分析性审查。',
    ].join('\n');

    const decoded = decodeTextBufferBestEffort(Buffer.from(content, 'utf8'));

    expect(decoded).toContain('问题澄清');
    expect(decoded).toContain('识别澄清缺口');
    expect(decoded).toContain('审查目标与范围');
    expect(decoded).not.toContain('闂');
    expect(decoded).not.toContain('婢勬竻');
  });
});
