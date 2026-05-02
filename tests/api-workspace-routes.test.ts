import { File } from 'node:buffer';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { withTempWorkspace } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

type TreeNode = { name: string; path: string; type: string; children?: TreeNode[] };

async function loadWorkspaceRoutes() {
  const [tree, file, manage, download, upload] = await Promise.all([
    import('@/app/api/workspace/tree/route'),
    import('@/app/api/workspace/file/route'),
    import('@/app/api/workspace/manage/route'),
    import('@/app/api/workspace/download/route'),
    import('@/app/api/workspace/upload/route'),
  ]);
  return { tree, file, manage, download, upload };
}

function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const entries: TreeNode[] = [];
  for (const node of nodes) {
    entries.push(node);
    if (node.children) entries.push(...flattenTree(node.children));
  }
  return entries;
}

describe('workspace API routes', () => {
  test('workspace tree lists safe files while hiding dotfiles and symlinks', async () => {
    await withTempWorkspace(async ({ workspace, base }) => {
      await mkdir(path.join(workspace, 'src'), { recursive: true });
      await writeFile(path.join(workspace, 'src', 'app.ts'), 'export const ok = true;');
      await writeFile(path.join(workspace, '.env'), 'SECRET=value');
      await writeFile(path.join(base, 'outside.txt'), 'outside');
      await symlink(path.join(base, 'outside.txt'), path.join(workspace, 'src', 'outside-link.txt'));

      const { tree } = await loadWorkspaceRoutes();
      const response = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&depth=3`));
      expect(response.status).toBe(200);
      const json = await responseJson<{ tree: TreeNode[] }>(response);
      const entries = flattenTree(json.tree);

      expect(entries.some((entry) => entry.name === 'src' && entry.type === 'directory')).toBe(true);
      expect(entries.some((entry) => entry.path === path.join('src', 'app.ts') && entry.type === 'file')).toBe(true);
      expect(entries.some((entry) => entry.name === '.env')).toBe(false);
      expect(entries.some((entry) => entry.name === 'outside-link.txt')).toBe(false);
    });
  });

  test('workspace file route reads, writes, and rejects traversal or symlink escapes', async () => {
    await withTempWorkspace(async ({ workspace, base }) => {
      await mkdir(path.join(workspace, 'docs'), { recursive: true });
      await writeFile(path.join(workspace, 'docs', 'note.md'), 'old');
      await writeFile(path.join(base, 'secret.txt'), 'secret');
      await symlink(path.join(base, 'secret.txt'), path.join(workspace, 'docs', 'secret-link.txt'));

      const { file } = await loadWorkspaceRoutes();

      const readResponse = await file.GET(makeRequest(`/api/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent('docs/note.md')}`));
      expect(readResponse.status).toBe(200);
      expect(await responseJson(readResponse)).toEqual({ content: 'old', size: 3, path: 'docs/note.md' });

      const writeResponse = await file.PUT(makeRequest('/api/workspace/file', {
        method: 'PUT',
        json: { workspace, file: 'docs/note.md', content: 'new content' },
      }));
      expect(writeResponse.status).toBe(200);
      expect((await responseJson<{ success: boolean }>(writeResponse)).success).toBe(true);
      await expect(readFile(path.join(workspace, 'docs', 'note.md'), 'utf8')).resolves.toBe('new content');

      await assertErrorResponse(
        await file.GET(makeRequest(`/api/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent('../secret.txt')}`)),
        400
      );
      await assertErrorResponse(
        await file.GET(makeRequest(`/api/workspace/file?workspace=${encodeURIComponent(workspace)}&file=${encodeURIComponent('docs/secret-link.txt')}`)),
        403
      );
    });
  });

  test('workspace manage route mutates only safe paths and rejects root deletes', async () => {
    await withTempWorkspace(async ({ workspace }) => {
      const { manage } = await loadWorkspaceRoutes();

      let response = await manage.POST(makeRequest('/api/workspace/manage', {
        json: { workspace, action: 'create-file', path: 'src/a.txt', content: 'alpha' },
      }));
      expect(response.status).toBe(200);
      await expect(readFile(path.join(workspace, 'src', 'a.txt'), 'utf8')).resolves.toBe('alpha');

      response = await manage.POST(makeRequest('/api/workspace/manage', {
        json: { workspace, action: 'rename', oldPath: 'src/a.txt', newPath: 'src/b.txt' },
      }));
      expect(response.status).toBe(200);
      await expect(readFile(path.join(workspace, 'src', 'b.txt'), 'utf8')).resolves.toBe('alpha');

      response = await manage.POST(makeRequest('/api/workspace/manage', {
        json: { workspace, action: 'delete', path: 'src/b.txt' },
      }));
      expect(response.status).toBe(200);
      await expect(readFile(path.join(workspace, 'src', 'b.txt'), 'utf8')).rejects.toThrow(/ENOENT/);

      await assertErrorResponse(
        await manage.POST(makeRequest('/api/workspace/manage', {
          json: { workspace, action: 'create-file', path: '../escape.txt', content: 'no' },
        })),
        400
      );
      await assertErrorResponse(
        await manage.POST(makeRequest('/api/workspace/manage', {
          json: { workspace, action: 'delete', path: '' },
        })),
        400
      );
    });
  });

  test('workspace download route returns bytes with safe headers and rejects symlink escapes', async () => {
    await withTempWorkspace(async ({ workspace, base }) => {
      await writeFile(path.join(workspace, 'report.txt'), 'download me');
      await writeFile(path.join(base, 'secret.txt'), 'secret');
      await symlink(path.join(base, 'secret.txt'), path.join(workspace, 'secret-link.txt'));

      const { download } = await loadWorkspaceRoutes();
      const response = await download.GET(makeRequest(`/api/workspace/download?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent('report.txt')}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="report.txt"');
      await expect(response.text()).resolves.toBe('download me');

      await assertErrorResponse(
        await download.GET(makeRequest(`/api/workspace/download?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent('secret-link.txt')}`)),
        403
      );
    });
  });

  test('workspace upload route saves multipart files and rejects unsafe relative paths', async () => {
    await withTempWorkspace(async ({ workspace }) => {
      const { upload } = await loadWorkspaceRoutes();
      const formData = new FormData();
      formData.set('workspace', workspace);
      formData.set('targetPath', 'uploads');
      formData.set('conflict', 'error');
      formData.append('files', new File(['hello'], 'hello.txt', { type: 'text/plain' }) as unknown as Blob);

      let response = await upload.POST(makeRequest('/api/workspace/upload', { method: 'POST', body: formData }));
      expect(response.status).toBe(200);
      const json = await responseJson<{ success: boolean; count: number }>(response);
      expect(json.success).toBe(true);
      expect(json.count).toBe(1);
      await expect(readFile(path.join(workspace, 'uploads', 'hello.txt'), 'utf8')).resolves.toBe('hello');

      const unsafe = new FormData();
      unsafe.set('workspace', workspace);
      unsafe.set('relativePaths', JSON.stringify(['../escape.txt']));
      unsafe.append('files', new File(['bad'], 'bad.txt', { type: 'text/plain' }) as unknown as Blob);
      await assertErrorResponse(await upload.POST(makeRequest('/api/workspace/upload', { method: 'POST', body: unsafe })), 400);

      await assertErrorResponse(
        await upload.POST(makeRequest('/api/workspace/upload', { method: 'POST', json: { workspace } })),
        400
      );
    });
  });
});
