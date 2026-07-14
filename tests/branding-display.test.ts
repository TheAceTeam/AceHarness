import { describe, expect, test } from 'vitest';
import { formatLegacyProductPathForDisplay, PRODUCT_DISPLAY_NAME } from '@/lib/core/branding';

describe('branding display helpers', () => {
  test('uses the requested product display name', () => {
    expect(PRODUCT_DISPLAY_NAME).toBe('CSIHarness Power By ACE/AET');
  });

  test('masks the legacy product directory name without changing path structure', () => {
    expect(formatLegacyProductPathForDisplay('/Users/demo/.aceharness/data/session')).toBe(
      '/Users/demo/.csiharness/data/session'
    );
    expect(formatLegacyProductPathForDisplay('C:\\Users\\demo\\ACEHarness\\data')).toBe(
      'C:\\Users\\demo\\CSIHarness\\data'
    );
  });
});
