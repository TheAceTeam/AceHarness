import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';
import { seedBundledDirectoryOnce } from '@/lib/core/preset-seeding';

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'csiharness-presets-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('bundled preset seeding', () => {
  test('copies the complete source directory when the target is absent', async () => {
    const root = await tempRoot();
    const source = path.join(root, 'bundled');
    const target = path.join(root, 'runtime', 'configs');
    await mkdir(path.join(source, 'workflows'), { recursive: true });
    await writeFile(path.join(source, 'workflows', 'sample.yaml'), 'name: sample\n');

    await seedBundledDirectoryOnce(source, target);

    expect(await readFile(path.join(target, 'workflows', 'sample.yaml'), 'utf8')).toBe('name: sample\n');
    expect((await stat(target)).isSymbolicLink()).toBe(false);
    expect((await stat(path.join(target, 'workflows', 'sample.yaml'))).isSymbolicLink()).toBe(false);
  });

  test('never overwrites or refills an existing target directory', async () => {
    const root = await tempRoot();
    const source = path.join(root, 'bundled');
    const target = path.join(root, 'runtime', 'skills');
    await mkdir(path.join(source, 'sample'), { recursive: true });
    await writeFile(path.join(source, 'sample', 'SKILL.md'), 'bundled');
    await mkdir(target, { recursive: true });
    await writeFile(path.join(target, 'user.txt'), 'keep');

    await seedBundledDirectoryOnce(source, target);

    expect(await readFile(path.join(target, 'user.txt'), 'utf8')).toBe('keep');
    await expect(readFile(path.join(target, 'sample', 'SKILL.md'), 'utf8')).rejects.toThrow();
  });

  test('seeds again only after the whole target directory is deleted', async () => {
    const root = await tempRoot();
    const source = path.join(root, 'bundled');
    const target = path.join(root, 'runtime', 'configs');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'sample.yaml'), 'v1');
    await seedBundledDirectoryOnce(source, target);
    await rm(path.join(target, 'sample.yaml'));
    await writeFile(path.join(source, 'sample.yaml'), 'v2');

    await seedBundledDirectoryOnce(source, target);
    await expect(readFile(path.join(target, 'sample.yaml'), 'utf8')).rejects.toThrow();

    await rm(target, { recursive: true });
    await seedBundledDirectoryOnce(source, target);
    expect(await readFile(path.join(target, 'sample.yaml'), 'utf8')).toBe('v2');
  });
});
