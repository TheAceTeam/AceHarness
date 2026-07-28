import { describe, expect, test } from 'vitest';
import {
  CSI_PACKAGE_NAME,
  buildNpmPackageSpec,
  normalizeUpdateTarget,
  parseNpmVersionOutput,
} from '@/lib/core/self-update';

describe('self update helpers', () => {
  test('normalizes empty and shorthand npm dist-tags', () => {
    expect(normalizeUpdateTarget()).toBe('latest');
    expect(normalizeUpdateTarget('')).toBe('latest');
    expect(normalizeUpdateTarget('@beta')).toBe('beta');
    expect(normalizeUpdateTarget(' release ')).toBe('release');
  });

  test('builds CSIHarness package specs from versions and tags', () => {
    expect(buildNpmPackageSpec(CSI_PACKAGE_NAME, '')).toBe(`${CSI_PACKAGE_NAME}@latest`);
    expect(buildNpmPackageSpec(CSI_PACKAGE_NAME, 'beta')).toBe(`${CSI_PACKAGE_NAME}@beta`);
    expect(buildNpmPackageSpec(CSI_PACKAGE_NAME, '1.0.0-beta.66')).toBe(`${CSI_PACKAGE_NAME}@1.0.0-beta.66`);
    expect(buildNpmPackageSpec(CSI_PACKAGE_NAME, `${CSI_PACKAGE_NAME}@release`)).toBe(`${CSI_PACKAGE_NAME}@release`);
  });

  test('rejects unrelated package specs as update targets', () => {
    expect(() => buildNpmPackageSpec(CSI_PACKAGE_NAME, '@other/pkg@latest')).toThrow(/version or dist-tag/);
    expect(() => buildNpmPackageSpec(CSI_PACKAGE_NAME, `${CSI_PACKAGE_NAME}@`)).toThrow(/version or dist-tag/);
    expect(() => buildNpmPackageSpec(CSI_PACKAGE_NAME, 'bad target')).toThrow(/version or dist-tag/);
  });

  test('parses npm version output from json and plain text', () => {
    expect(parseNpmVersionOutput('"1.0.0-beta.66"\n')).toBe('1.0.0-beta.66');
    expect(parseNpmVersionOutput('1.0.0-beta.67\n')).toBe('1.0.0-beta.67');
    expect(parseNpmVersionOutput('noise\n"1.0.0-beta.68"\n')).toBe('1.0.0-beta.68');
  });
});
