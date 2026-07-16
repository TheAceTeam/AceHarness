import { describe, expect, test } from 'vitest';
import {
  CLI_COMMAND,
  DEFAULT_PORT,
  INSTALL_ROOT_ENV,
  NPM_PACKAGE_NAME,
  PRODUCT_NAME,
  RUNTIME_HOME_ENV,
} from '@/lib/core/product-identity';

describe('CSIHarness product identity', () => {
  test('defines the independent public identity in one place', () => {
    expect(PRODUCT_NAME).toBe('CSIHarness');
    expect(NPM_PACKAGE_NAME).toBe('csiharness');
    expect(CLI_COMMAND).toBe('csiharness');
    expect(DEFAULT_PORT).toBe(3001);
    expect(RUNTIME_HOME_ENV).toBe('CSIHARNESS_HOME');
    expect(INSTALL_ROOT_ENV).toBe('CSIHARNESS_INSTALL_ROOT');
  });
});
