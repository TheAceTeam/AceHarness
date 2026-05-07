import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '..');
const packageJson = JSON.parse(await readFile(resolve(projectRoot, 'package.json'), 'utf8'));
const npmIgnore = await readFile(resolve(projectRoot, '.npmignore'), 'utf8');

async function projectPathExists(relativePath: string): Promise<boolean> {
  try {
    await access(resolve(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe('package contract', () => {
  test('package exposes the intended global install entrypoints', async () => {
    expect(packageJson.name).toBe('@cangjielang/aceharness');
    expect(packageJson.main).toBe('server.js');
    expect(packageJson.bin?.ace).toBe('./bin/ace.js');

    await expect(projectPathExists(packageJson.main)).resolves.toBe(true);
    await expect(projectPathExists(packageJson.bin.ace)).resolves.toBe(true);
  });

  test('package files include runtime assets required by the CLI and app', () => {
    const files = new Set(packageJson.files);
    const requiredRuntimeEntries = [
      'bin',
      'dist',
      'server.js',
      'public',
      'skills',
      'configs',
      'messages',
    ];

    for (const entry of requiredRuntimeEntries) {
      expect(files.has(entry), `package files must include ${entry}`).toBe(true);
    }
  });

  test('package files do not publish local mutable runtime state', () => {
    const files = new Set(packageJson.files);
    const forbiddenEntries = ['node_modules', 'data', 'runs', 'logs', 'cache'];

    for (const entry of forbiddenEntries) {
      expect(files.has(entry), `package files must not include ${entry}`).toBe(false);
    }
  });

  test('.npmignore excludes build caches and local runtime state from publish output', () => {
    const ignored = new Set(npmIgnore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const requiredIgnores = [
      '.next/cache',
      '.next/dev',
      '.next/trace',
      '.next/diagnostics',
      '.next/types',
      'data',
      'runs',
      'logs',
      'cache',
    ];

    for (const entry of requiredIgnores) {
      expect(ignored.has(entry), `.npmignore must exclude ${entry}`).toBe(true);
    }
  });
});
