import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withTempDir } from './helpers/module-helpers';
import {
  assertSafeRuntimeTargets,
  ensureRuntimeHomeInitialized,
  RUNTIME_MARKER,
} from '@/lib/core/runtime-home';

describe('CSIHarness runtime home ownership', () => {
  test('initializes a new or empty runtime root with a product marker', async () => {
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const newRoot = path.join(base, 'new-home');
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: newRoot, knownAceRoots: [] })).resolves.toBe(newRoot);
      expect(JSON.parse(await readFile(path.join(newRoot, '.csiharness-root.json'), 'utf8'))).toEqual(RUNTIME_MARKER);

      const emptyRoot = path.join(base, 'empty-home');
      await mkdir(emptyRoot);
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: emptyRoot, knownAceRoots: [] })).resolves.toBe(emptyRoot);
      expect(JSON.parse(await readFile(path.join(emptyRoot, '.csiharness-root.json'), 'utf8'))).toEqual(RUNTIME_MARKER);
    });
  });

  test('reuses valid roots and rejects non-empty or mismatched roots', async () => {
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const validRoot = path.join(base, 'valid');
      await ensureRuntimeHomeInitialized({ runtimeRoot: validRoot, knownAceRoots: [] });
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: validRoot, knownAceRoots: [] })).resolves.toBe(validRoot);

      const occupiedRoot = path.join(base, 'occupied');
      await mkdir(occupiedRoot);
      await writeFile(path.join(occupiedRoot, 'business.txt'), 'keep');
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: occupiedRoot, knownAceRoots: [] })).rejects.toThrow(/non-empty.*marker/i);

      const wrongRoot = path.join(base, 'wrong-marker');
      await mkdir(wrongRoot);
      await writeFile(path.join(wrongRoot, '.csiharness-root.json'), JSON.stringify({ product: 'ACEHarness' }));
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: wrongRoot, knownAceRoots: [] })).rejects.toThrow(/marker/i);
    });
  });

  test('never takes ownership of a known ACEHarness root or its descendants', async () => {
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const legacyRoot = path.join(base, '.aceharness');
      const nested = path.join(legacyRoot, 'csi');
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: legacyRoot, knownAceRoots: [legacyRoot] })).rejects.toThrow(/ACEHarness/i);
      await expect(ensureRuntimeHomeInitialized({ runtimeRoot: nested, knownAceRoots: [legacyRoot] })).rejects.toThrow(/ACEHarness/i);
    });
  });

  test('rejects a runtime root whose existing ancestor symlink enters an ACEHarness root', async () => {
    if (process.platform === 'win32') return;
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const legacyRoot = path.join(base, '.aceharness');
      const linkedParent = path.join(base, 'linked-parent');
      await mkdir(legacyRoot);
      await symlink(legacyRoot, linkedParent);

      await expect(ensureRuntimeHomeInitialized({
        runtimeRoot: path.join(linkedParent, 'csi-child'),
        knownAceRoots: [legacyRoot],
      })).rejects.toThrow(/ACEHarness/i);
    });
  });

  test('accepts only reset targets that stay inside a marked canonical root', async () => {
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const root = path.join(base, 'runtime');
      await ensureRuntimeHomeInitialized({ runtimeRoot: root, knownAceRoots: [] });
      const safe = path.join(root, 'data', 'users.json');
      await expect(assertSafeRuntimeTargets(root, [safe])).resolves.toEqual([safe]);
      await expect(assertSafeRuntimeTargets(root, [root])).rejects.toThrow(/runtime root/i);
      await expect(assertSafeRuntimeTargets(root, [path.join(base, 'outside')])).rejects.toThrow(/outside/i);
    });
  });

  test('rejects reset targets that escape through a directory symlink', async () => {
    if (process.platform === 'win32') return;
    await withTempDir('csiharness-runtime-home-', async (base) => {
      const root = path.join(base, 'runtime');
      const outside = path.join(base, 'outside');
      await ensureRuntimeHomeInitialized({ runtimeRoot: root, knownAceRoots: [] });
      await mkdir(outside);
      await symlink(outside, path.join(root, 'linked-outside'));
      await expect(assertSafeRuntimeTargets(root, [path.join(root, 'linked-outside', 'file.json')])).rejects.toThrow(/outside/i);
    });
  });
});
