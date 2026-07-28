import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveRuntimePort } from '@/lib/core/runtime-network';

describe('CSIHarness port selection', () => {
  test('uses CSIHARNESS_PORT before PORT and saved settings', () => {
    expect(resolveRuntimePort({ CSIHARNESS_PORT: '4100', PORT: '4200' }, 4300)).toBe(4100);
  });

  test('uses PORT before saved settings', () => {
    expect(resolveRuntimePort({ PORT: '4200' }, 4300)).toBe(4200);
  });

  test('uses saved settings and then the CSIHarness default', () => {
    expect(resolveRuntimePort({}, 4300)).toBe(4300);
    expect(resolveRuntimePort({}, undefined)).toBe(3001);
  });

  test('does not read ACE_PORT', () => {
    expect(resolveRuntimePort({ ACE_PORT: '9999' }, undefined)).toBe(3001);
  });

  test('rejects invalid environment ports instead of silently selecting another product port', () => {
    expect(() => resolveRuntimePort({ CSIHARNESS_PORT: '0' }, 4300)).toThrow(/CSIHARNESS_PORT/);
    expect(() => resolveRuntimePort({ PORT: 'abc' }, 4300)).toThrow(/PORT/);
  });

  test('production start and smoke scripts give CSIHARNESS_PORT priority over PORT', async () => {
    const projectRoot = path.resolve(__dirname, '..');
    for (const relativePath of [
      'scripts/start-tanstack-start.mjs',
      'scripts/smoke-global-npm-start.mjs',
    ]) {
      const source = await readFile(path.join(projectRoot, relativePath), 'utf8');
      const csiPort = source.indexOf('process.env.CSIHARNESS_PORT');
      const genericPort = source.indexOf('process.env.PORT', csiPort);
      expect(csiPort, `${relativePath} must read CSIHARNESS_PORT`).toBeGreaterThanOrEqual(0);
      expect(genericPort, `${relativePath} must use PORT only as fallback`).toBeGreaterThan(csiPort);
      expect(source).toContain('port < 1 || port > 65535');
    }
  });
});
