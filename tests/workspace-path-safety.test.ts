import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT,
  WorkspacePathError,
  assertNoSymlinkEscape,
  assertSafeRelativePath,
  isInsidePath,
  resolveCreatableInsideWorkspace,
  resolveExistingInsideWorkspace,
  sanitizeDownloadName,
} from '@/lib/workspace-path-safety';

function expectWorkspacePathError(fn: () => unknown, status?: number): void {
  expect(fn).toThrow(WorkspacePathError);
  try {
    fn();
  } catch (error) {
    if (status !== undefined) expect((error as WorkspacePathError).status).toBe(status);
  }
}

async function expectRejectsWorkspacePathError(fn: () => Promise<unknown>, status?: number): Promise<void> {
  await expect(fn()).rejects.toBeInstanceOf(WorkspacePathError);
  if (status !== undefined) {
    await expect(fn()).rejects.toMatchObject({ status });
  }
}

async function withWorkspace(
  fn: (paths: { base: string; workspace: string; outside: string }) => Promise<void>
): Promise<void> {
  const base = await mkdtemp(path.join(tmpdir(), 'aceharness-path-safety-'));
  const workspace = path.join(base, 'workspace');
  const outside = path.join(base, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  try {
    await fn({ base, workspace: await realpath(workspace), outside: await realpath(outside) });
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

describe('workspace path safety', () => {
  test('assertSafeRelativePath accepts normalized relative paths', () => {
    expect(assertSafeRelativePath('src/file.txt')).toBe(path.join('src', 'file.txt'));
    expect(assertSafeRelativePath(' ./src/file.txt ')).toBe(path.join('src', 'file.txt'));
    expect(assertSafeRelativePath('dir\\nested.txt')).toBe(path.join('dir', 'nested.txt'));
  });

  test('assertSafeRelativePath rejects traversal, absolute, control-character, and oversized paths', () => {
    expectWorkspacePathError(() => assertSafeRelativePath('../secret.txt'));
    expectWorkspacePathError(() => assertSafeRelativePath('safe/../secret.txt'));
    expectWorkspacePathError(() => assertSafeRelativePath('safe/./file.txt'));
    expectWorkspacePathError(() => assertSafeRelativePath('/etc/passwd'));
    expectWorkspacePathError(() => assertSafeRelativePath('C:/Windows/win.ini'));
    expectWorkspacePathError(() => assertSafeRelativePath('\\\\server\\share\\file.txt'));
    expectWorkspacePathError(() => assertSafeRelativePath('safe\u0000file.txt'));
    expectWorkspacePathError(() => assertSafeRelativePath('a'.repeat(WORKSPACE_RELATIVE_PATH_LENGTH_LIMIT + 1)));
  });

  test('isInsidePath distinguishes child paths from sibling-prefix attacks', () => {
    const root = path.resolve('/tmp/ace-workspace');
    expect(isInsidePath(root, root)).toBe(true);
    expect(isInsidePath(root, path.join(root, 'nested/file.txt'))).toBe(true);
    expect(isInsidePath(root, `${root}-evil/file.txt`)).toBe(false);
    expect(isInsidePath(root, path.dirname(root))).toBe(false);
  });

  test('resolveExistingInsideWorkspace resolves normal files and rejects symlink escapes', async () => {
    await withWorkspace(async ({ workspace, outside }) => {
      await mkdir(path.join(workspace, 'src'));
      await writeFile(path.join(workspace, 'src', 'safe.txt'), 'ok');
      await writeFile(path.join(outside, 'secret.txt'), 'secret');
      await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'src', 'escape.txt'));

      await expect(resolveExistingInsideWorkspace(workspace, 'src/safe.txt')).resolves.toBe(await realpath(path.join(workspace, 'src', 'safe.txt')));
      await expectRejectsWorkspacePathError(() => resolveExistingInsideWorkspace(workspace, 'src/escape.txt'), 403);
      await expectRejectsWorkspacePathError(() => resolveExistingInsideWorkspace(workspace, 'src/missing.txt'), 404);
    });
  });

  test('resolveCreatableInsideWorkspace rejects root writes and symlinked parent escapes', async () => {
    await withWorkspace(async ({ workspace, outside }) => {
      await mkdir(path.join(workspace, 'safe'));
      await symlink(outside, path.join(workspace, 'escape-dir'));

      const creatable = await resolveCreatableInsideWorkspace(workspace, 'safe/new.txt');
      expect(creatable.fullPath).toBe(path.join(workspace, 'safe', 'new.txt'));
      expect(creatable.parentPath).toBe(await realpath(path.join(workspace, 'safe')));

      await expectRejectsWorkspacePathError(() => resolveCreatableInsideWorkspace(workspace, ''), 400);
      await expectRejectsWorkspacePathError(() => resolveCreatableInsideWorkspace(workspace, 'missing/new.txt'), 404);
      await expectRejectsWorkspacePathError(() => resolveCreatableInsideWorkspace(workspace, 'escape-dir/new.txt'), 403);
    });
  });

  test('assertNoSymlinkEscape rejects links pointing outside the workspace', async () => {
    await withWorkspace(async ({ workspace, outside }) => {
      await writeFile(path.join(workspace, 'inside.txt'), 'ok');
      await writeFile(path.join(outside, 'outside.txt'), 'secret');
      await symlink(path.join(outside, 'outside.txt'), path.join(workspace, 'outside-link.txt'));

      await expect(assertNoSymlinkEscape(workspace, path.join(workspace, 'inside.txt'))).resolves.toBeUndefined();
      await expectRejectsWorkspacePathError(() => assertNoSymlinkEscape(workspace, path.join(workspace, 'outside-link.txt')), 403);
    });
  });

  test('sanitizeDownloadName removes path components and header/control-character risks', () => {
    expect(sanitizeDownloadName('../report.txt')).toBe('report.txt');
    expect(sanitizeDownloadName('dir/sub/file.txt')).toBe('file.txt');
    expect(sanitizeDownloadName('bad\r\nname".txt')).toBe('bad__name_.txt');
    expect(sanitizeDownloadName('\u0000')).toBe('download');
    expect(sanitizeDownloadName('')).toBe('download');
  });
});
