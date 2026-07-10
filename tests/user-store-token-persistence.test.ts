import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ runtimeRoot: '' }));

vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceDataDir: () => join(state.runtimeRoot, 'data'),
  getWorkspaceDataFile: (...segments: string[]) => join(state.runtimeRoot, 'data', ...segments),
}));

describe('user-store login session persistence', () => {
  beforeEach(async () => {
    state.runtimeRoot = await mkdtemp(join(tmpdir(), 'ace-user-store-'));
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(state.runtimeRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  test('restores a token after the server module is reloaded', async () => {
    const firstModule = await import('@/lib/core/user-store');
    firstModule.storeToken('persisted-token', 'user-1');

    const tokenFile = join(state.runtimeRoot, 'data', 'tokens.json');
    const persistedEntries = JSON.parse(await readFile(tokenFile, 'utf8'));
    expect(persistedEntries).toEqual(expect.arrayContaining([
      ['persisted-token', expect.objectContaining({ userId: 'user-1' })],
    ]));

    vi.resetModules();
    const reloadedModule = await import('@/lib/core/user-store');
    expect(reloadedModule.validateToken('persisted-token')).toEqual({ userId: 'user-1' });
  });
});
