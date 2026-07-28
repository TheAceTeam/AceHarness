import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withTempDir } from './helpers/module-helpers';

afterEach(() => {
  vi.doUnmock('@/lib/core/app-paths');
  vi.resetModules();
});

describe('CSIHarness bundled skill refresh', () => {
  test('refreshes upstream skills without overwriting editable csi presets', async () => {
    await withTempDir('csiharness-runtime-skills-', async (base) => {
      const installRoot = path.join(base, 'install');
      const runtimeRoot = path.join(base, 'runtime');
      const installSkills = path.join(installRoot, 'skills');
      const runtimeSkills = path.join(runtimeRoot, 'skills');

      await mkdir(path.join(installSkills, 'aceharness-rag'), { recursive: true });
      await mkdir(path.join(installSkills, 'csi-code-review'), { recursive: true });
      await mkdir(path.join(runtimeSkills, 'aceharness-rag'), { recursive: true });
      await mkdir(path.join(runtimeSkills, 'csi-code-review'), { recursive: true });

      await writeFile(path.join(installSkills, 'aceharness-rag', 'SKILL.md'), 'upstream-new');
      await writeFile(path.join(installSkills, 'csi-code-review', 'SKILL.md'), 'csi-bundled');
      await writeFile(path.join(runtimeSkills, 'aceharness-rag', 'SKILL.md'), 'upstream-old');
      await writeFile(path.join(runtimeSkills, 'csi-code-review', 'SKILL.md'), 'csi-user-edited');

      vi.resetModules();
      vi.doMock('@/lib/core/app-paths', () => ({
        getInstallPath: (...segments: string[]) => path.join(installRoot, ...segments),
        getWorkspaceRoot: () => runtimeRoot,
        getWorkspaceSkillsDir: () => runtimeSkills,
        getWorkspaceSkillPath: (...segments: string[]) => path.join(runtimeSkills, ...segments),
        getWorkspaceCacheFile: (...segments: string[]) => path.join(runtimeRoot, 'cache', ...segments),
      }));

      const { ensureRuntimeSkillsSeeded } = await import('@/lib/run/runtime-skills');
      await ensureRuntimeSkillsSeeded({ refreshBundledSkills: true });

      await expect(readFile(path.join(runtimeSkills, 'aceharness-rag', 'SKILL.md'), 'utf8'))
        .resolves.toBe('upstream-new');
      await expect(readFile(path.join(runtimeSkills, 'csi-code-review', 'SKILL.md'), 'utf8'))
        .resolves.toBe('csi-user-edited');
    });
  });
});
