import { describe, expect, test } from 'vitest';
import { formatLegacyProductPathForDisplay } from '@/lib/core/branding';

describe('branding display helpers', () => {
  test('masks the legacy product directory name without changing path structure', () => {
    expect(formatLegacyProductPathForDisplay('/Users/demo/.aceharness/data/session')).toBe(
      '/Users/demo/.csiharness/data/session'
    );
    expect(formatLegacyProductPathForDisplay('C:\\Users\\demo\\ACEHarness\\data')).toBe(
      'C:\\Users\\demo\\CSIHarness\\data'
    );
  });
});
