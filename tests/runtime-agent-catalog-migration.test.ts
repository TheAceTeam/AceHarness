import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

describe('runtime Agent catalog migration', () => {
  test('removes retired bundled Agent files while seeding canonical replacements', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const agentsDir = path.join(aceHome, 'configs', 'agents');
      await mkdir(agentsDir, { recursive: true });
      await writeFile(path.join(agentsDir, 'fix-developer.yaml'), 'name: fix-developer\n', 'utf8');
      await writeFile(path.join(agentsDir, 'ceo-founder.yaml'), 'name: ceo-founder\n', 'utf8');

      vi.resetModules();
      const { ensureRuntimeConfigsSeeded } = await import('@/lib/run/runtime-configs');
      await ensureRuntimeConfigsSeeded();

      expect(existsSync(path.join(agentsDir, 'fix-developer.yaml'))).toBe(false);
      expect(existsSync(path.join(agentsDir, 'ceo-founder.yaml'))).toBe(false);
      expect(existsSync(path.join(agentsDir, 'developer.yaml'))).toBe(true);
      expect(existsSync(path.join(agentsDir, 'default-supervisor.yaml'))).toBe(true);
    });
  });
});
