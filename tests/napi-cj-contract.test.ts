import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');

describe('napi-cj package contract', () => {
  test('local package is generic and private', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve(projectRoot, 'packages/napi-cj/package.json'), 'utf8')
    );

    expect(packageJson.name).toBe('@cangjielang/napi-cj');
    expect(packageJson.private).toBe(true);
    expect(packageJson.main).toBe('dist/index.js');
    expect(packageJson.types).toBe('dist/index.d.ts');
  });

  test('source does not embed ACEHarness engine provider names', async () => {
    const source = await readFile(resolve(projectRoot, 'packages/napi-cj/src/index.ts'), 'utf8');
    expect(source).not.toContain('claude-code');
    expect(source).not.toContain('opencode');
    expect(source).not.toContain('aceharness_cj_engine');
  });
});
