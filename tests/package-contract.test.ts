import { access, readFile, stat } from 'node:fs/promises';
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
    expect(packageJson.name).toBe('csiharness');
    expect(packageJson.main).toBe('scripts/start-tanstack-start.mjs');
    expect(packageJson.bin).toEqual({ csiharness: 'bin/csiharness.js' });

    await expect(projectPathExists(packageJson.main)).resolves.toBe(true);
    await expect(projectPathExists(packageJson.bin.csiharness)).resolves.toBe(true);
    await expect(projectPathExists('bin/ace.js')).resolves.toBe(false);

    const binPath = resolve(projectRoot, packageJson.bin.csiharness);
    const [binSource, binStat] = await Promise.all([
      readFile(binPath, 'utf8'),
      stat(binPath),
    ]);
    expect(binSource.startsWith('#!/usr/bin/env node')).toBe(true);
    expect(binSource).toContain('CSIHARNESS_INSTALL_ROOT');
    if (process.platform !== 'win32') expect(binStat.mode & 0o111).not.toBe(0);
  });

  test('package files include runtime assets required by the CLI and app', () => {
    const files = new Set(packageJson.files);
    const requiredRuntimeEntries = [
      'bin',
      'dist',
      'scripts/start-tanstack-start.mjs',
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
    const forbiddenEntries = ['node_modules', 'data', 'runs', 'logs', 'cache', 'server.js'];

    for (const entry of forbiddenEntries) {
      expect(files.has(entry), `package files must not include ${entry}`).toBe(false);
    }
  });

  test('.npmignore excludes build caches and local runtime state from publish output', () => {
    const ignored = new Set(npmIgnore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const requiredIgnores = [
      'data',
      'runs',
      'logs',
      'cache',
    ];
    const forbiddenIgnores = [
      '.next/cache',
      '.next/dev',
      '.next/trace',
      '.next/diagnostics',
      '.next/types',
    ];

    for (const entry of requiredIgnores) {
      expect(ignored.has(entry), `.npmignore must exclude ${entry}`).toBe(true);
    }
    for (const entry of forbiddenIgnores) {
      expect(ignored.has(entry), `.npmignore must not retain preRuntime Next ignore ${entry}`).toBe(false);
    }
  });

  test('published README quick starts use the CSIHarness package, command, and public environment', async () => {
    for (const file of ['README.md', 'README.en.md']) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      const withoutUrls = source.replace(/https?:\/\/[^\s)>]+/g, '');
      expect(withoutUrls).not.toContain('@cangjielang/aceharness');
      expect(withoutUrls).not.toMatch(/^ace(?:\s|$)/m);
      expect(withoutUrls).not.toContain('`ace ');
      expect(withoutUrls).not.toContain('ACE_PORT');
      expect(withoutUrls).not.toContain('ACE_HOME');
      expect(source).toContain('npm install -g csiharness');
      expect(source).toContain('csiharness --help');
      expect(source).toContain('CSIHARNESS_PORT');
      expect(source).toContain('CSIHARNESS_HOME');
      expect(source).not.toContain('raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/');
    }
  });
});
