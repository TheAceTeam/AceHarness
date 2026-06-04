import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withTempDir } from './helpers/module-helpers';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    windowsHide: true,
  });
  return stdout.trim();
}

async function loadWorkspaceStore(input: { aceHome: string; skillsDir?: string; linkThrows?: boolean }) {
  process.env.ACE_HOME = input.aceHome;
  vi.resetModules();
  vi.doMock('@/lib/run/runtime-skills', () => ({
    getRuntimeSkillsDirPath: vi.fn().mockResolvedValue(input.skillsDir || path.join(input.aceHome, 'skills')),
  }));

  if (input.linkThrows) {
    vi.doMock('@/lib/core/directory-links', () => ({
      ensureDirectoryLinkSync: vi.fn(() => {
        throw new Error('link unavailable');
      }),
    }));
  }

  return import('@/lib/agora/workspace-store');
}

async function withStore<T>(
  fn: (input: { aceHome: string; skillsDir: string; store: Awaited<ReturnType<typeof loadWorkspaceStore>> }) => Promise<T>,
) {
  return withTempDir('aceharness-agora-store-', async (base) => {
    const aceHome = path.join(base, 'home');
    const skillsDir = path.join(base, 'runtime-skills');
    await mkdir(skillsDir, { recursive: true });
    const store = await loadWorkspaceStore({ aceHome, skillsDir });
    return fn({ aceHome, skillsDir, store });
  });
}

afterEach(() => {
  delete process.env.ACE_HOME;
  vi.doUnmock('@/lib/run/runtime-skills');
  vi.doUnmock('@/lib/core/directory-links');
  vi.restoreAllMocks();
});

describe('agora workspace store', () => {
  test('creates a default runtime workspace with git baseline and skills ignored', async () => {
    await withStore(async ({ aceHome, store }) => {
      const result = await store.ensureAgoraWorkspace({
        sessionId: 'topic/session:1',
        title: '议题一',
      });

      const expectedDir = path.join(aceHome, 'data', 'agora-workspaces', 'topic-session-1');
      expect(result).toEqual({
        workspacePath: expectedDir,
        created: true,
        sourceWorkspace: undefined,
      });
      expect(await readFile(path.join(expectedDir, 'README.md'), 'utf-8')).toContain('# 议题一');
      expect(await readFile(path.join(expectedDir, '.gitignore'), 'utf-8')).toContain('/skills');
      expect(existsSync(path.join(expectedDir, '.git'))).toBe(true);
      expect(await git(expectedDir, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
      expect(await git(expectedDir, ['rev-parse', '--verify', 'HEAD'])).toBeTruthy();
      expect(await git(expectedDir, ['status', '--porcelain'])).toBe('');
    });
  });

  test('links runtime skills into the workspace when directory links are available', async () => {
    await withStore(async ({ skillsDir, store }) => {
      await mkdir(path.join(skillsDir, 'demo-skill'), { recursive: true });
      await writeFile(path.join(skillsDir, 'demo-skill', 'SKILL.md'), 'demo');

      const result = await store.ensureAgoraWorkspace({ sessionId: 'skills-link' });
      const skillsPath = path.join(result.workspacePath, 'skills');

      expect(existsSync(skillsPath)).toBe(true);
      expect(await readFile(path.join(skillsPath, 'demo-skill', 'SKILL.md'), 'utf-8')).toBe('demo');
      expect(await readFile(path.join(result.workspacePath, '.gitignore'), 'utf-8')).toContain('/skills');
      expect(await git(result.workspacePath, ['status', '--porcelain'])).toBe('');
    });
  });

  test('does not copy runtime skills when linking fails', async () => {
    await withTempDir('aceharness-agora-store-', async (base) => {
      const aceHome = path.join(base, 'home');
      const skillsDir = path.join(base, 'runtime-skills');
      await mkdir(path.join(skillsDir, 'fallback-skill'), { recursive: true });
      await writeFile(path.join(skillsDir, 'fallback-skill', 'SKILL.md'), 'fallback');
      const store = await loadWorkspaceStore({ aceHome, skillsDir, linkThrows: true });

      const result = await store.ensureAgoraWorkspace({ sessionId: 'skills-copy' });

      expect(existsSync(path.join(result.workspacePath, 'skills'))).toBe(false);
      expect(await git(result.workspacePath, ['status', '--porcelain'])).toBe('');
    });
  });

  test('does not copy source workspace content into the agora workspace', async () => {
    await withStore(async ({ store }) => {
      await withTempDir('aceharness-agora-source-', async (source) => {
        await mkdir(path.join(source, '.git', 'objects'), { recursive: true });
        await mkdir(path.join(source, 'node_modules', 'dep'), { recursive: true });
        await mkdir(path.join(source, 'src'), { recursive: true });
        await writeFile(path.join(source, 'src', 'app.ts'), 'export const value = 1;\n');
        await writeFile(path.join(source, '.git', 'config'), '[core]\n');
        await writeFile(path.join(source, '.git', 'source-only'), 'should not copy\n');
        await writeFile(path.join(source, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');

        const result = await store.ensureAgoraWorkspace({
          sessionId: 'source-copy',
          sourceWorkspace: source,
          title: 'Source copy',
        });

        expect(existsSync(path.join(result.workspacePath, 'src', 'app.ts'))).toBe(false);
        expect(existsSync(path.join(result.workspacePath, 'node_modules'))).toBe(false);
        expect(existsSync(path.join(result.workspacePath, '.git', 'source-only'))).toBe(false);
        expect(await readFile(path.join(result.workspacePath, 'README.md'), 'utf-8')).toContain('# Source copy');
        expect(await readFile(path.join(result.workspacePath, '.gitignore'), 'utf-8')).toContain('/skills');
        expect(await git(result.workspacePath, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
        expect(await git(result.workspacePath, ['status', '--porcelain'])).toBe('');
      });
    });
  });

  test('reuses in-flight initialization for the same session id', async () => {
    await withStore(async ({ store }) => {
      const results = await Promise.all([
        store.ensureAgoraWorkspace({ sessionId: 'shared-session', title: '并发议题' }),
        store.ensureAgoraWorkspace({ sessionId: 'shared-session', title: '并发议题' }),
        store.ensureAgoraWorkspace({ sessionId: 'shared-session', title: '并发议题' }),
      ]);

      const workspacePath = results[0]?.workspacePath;
      expect(results.every((result) => result.workspacePath === workspacePath)).toBe(true);
      expect(results.some((result) => result.created)).toBe(true);
      expect(await git(workspacePath, ['rev-parse', '--is-inside-work-tree'])).toBe('true');
      expect(await git(workspacePath, ['status', '--porcelain'])).toBe('');
    });
  });
});
