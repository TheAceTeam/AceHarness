import { File } from 'node:buffer';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { canCreateFileSymlink, createFileSymlink, withTempWorkspace } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

type TreeNode = { name: string; path: string; type: string; children?: TreeNode[] };
type WorkspaceTreeJson = {
  tree: TreeNode[];
  hasMore?: boolean;
  nextOffset?: number | null;
  offset?: number;
  pageSize?: number;
  totalEntries?: number;
};

async function loadWorkspaceRoutes() {
  const [tree, file, manage, download, upload, workspaceStatic] = await Promise.all([
    import('@/app/api/workspace/tree/route'),
    import('@/app/api/workspace/file/route'),
    import('@/app/api/workspace/manage/route'),
    import('@/app/api/workspace/download/route'),
    import('@/app/api/workspace/upload/route'),
    import('@/app/api/workspace/static/[workspaceToken]/[...filePath]/route'),
  ]);
  return { tree, file, manage, download, upload, workspaceStatic };
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
  test('workspace tree lists safe files and dotfiles while hiding symlinks', async ({ skip }) => {
    if (!(await canCreateFileSymlink())) {
      skip('File symlink creation is not permitted in this environment');
    }

    await withTempWorkspace(async ({ workspace, base }) => {
      await mkdir(path.join(workspace, 'src'), { recursive: true });
      await writeFile(path.join(workspace, 'src', 'app.ts'), 'export const ok = true;');
      await writeFile(path.join(workspace, '.env'), 'SECRET=value');
      await writeFile(path.join(base, 'outside.txt'), 'outside');
      await createFileSymlink(path.join(base, 'outside.txt'), path.join(workspace, 'src', 'outside-link.txt'));

      const { tree } = await loadWorkspaceRoutes();
      const response = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&depth=3`));
      expect(response.status).toBe(200);
      const json = await responseJson<{ tree: TreeNode[] }>(response);
      const entries = flattenTree(json.tree);

      expect(entries.some((entry) => entry.name === 'src' && entry.type === 'directory')).toBe(true);
      expect(entries.some((entry) => entry.path === path.join('src', 'app.ts') && entry.type === 'file')).toBe(true);
      expect(entries.some((entry) => entry.name === '.env' && entry.type === 'file')).toBe(true);
      expect(entries.some((entry) => entry.name === 'outside-link.txt')).toBe(false);
    });
  });

  test('workspace tree pages a single directory breadth-first without silently truncating', async () => {
    await withTempWorkspace(async ({ workspace }) => {
      await mkdir(path.join(workspace, 'z-dir'), { recursive: true });
      await mkdir(path.join(workspace, 'a-dir'), { recursive: true });
      await writeFile(path.join(workspace, 'b-file.txt'), 'b');
      await writeFile(path.join(workspace, 'a-file.txt'), 'a');

      const { tree } = await loadWorkspaceRoutes();
      const first = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&depth=0&limit=2`));
      expect(first.status).toBe(200);
      const firstJson = await responseJson<WorkspaceTreeJson>(first);

      expect(firstJson.tree.map((entry) => entry.name)).toEqual(['a-dir', 'z-dir']);
      expect(firstJson.tree.every((entry) => entry.children === undefined)).toBe(true);
      expect(firstJson.totalEntries).toBe(4);
      expect(firstJson.pageSize).toBe(2);
      expect(firstJson.offset).toBe(0);
      expect(firstJson.hasMore).toBe(true);
      expect(firstJson.nextOffset).toBe(2);

      const second = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&depth=0&limit=2&offset=2`));
      expect(second.status).toBe(200);
      const secondJson = await responseJson<WorkspaceTreeJson>(second);

      expect(secondJson.tree.map((entry) => entry.name)).toEqual(['a-file.txt', 'b-file.txt']);
      expect(secondJson.hasMore).toBe(false);
      expect(secondJson.nextOffset).toBeNull();
    });
  });

  test('workspace tree loads nested directories only when requested as a subtree', async () => {
    await withTempWorkspace(async ({ workspace }) => {
      await mkdir(path.join(workspace, 'src', 'deep'), { recursive: true });
      await writeFile(path.join(workspace, 'src', 'app.ts'), 'export const ok = true;');
      await writeFile(path.join(workspace, 'src', 'deep', 'hidden.ts'), 'export const hidden = true;');

      const { tree } = await loadWorkspaceRoutes();
      const root = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&depth=0&limit=10`));
      expect(root.status).toBe(200);
      const rootJson = await responseJson<WorkspaceTreeJson>(root);
      expect(rootJson.tree).toEqual([
        { name: 'src', path: 'src', type: 'directory' },
      ]);

      const sub = await tree.GET(makeRequest(`/api/workspace/tree?path=${encodeURIComponent(workspace)}&sub=${encodeURIComponent('src')}&depth=0&limit=10`));
      expect(sub.status).toBe(200);
      const subJson = await responseJson<WorkspaceTreeJson>(sub);
      expect(subJson.tree.map((entry) => entry.path)).toEqual(['src/deep', 'src/app.ts']);
      expect(subJson.tree.find((entry) => entry.path === 'src/deep')?.children).toBeUndefined();
      expect(subJson.tree.some((entry) => entry.path === 'src/deep/hidden.ts')).toBe(false);
    });
  });

  test('workspace file route reads, writes, and rejects traversal or symlink escapes', async ({ skip }) => {
    if (!(await canCreateFileSymlink())) {
      skip('File symlink creation is not permitted in this environment');
    }

    await withTempWorkspace(async ({ workspace, base }) => {
      await mkdir(path.join(workspace, 'docs'), { recursive: true });
      await writeFile(path.join(workspace, 'docs', 'note.md'), 'old');
      await writeFile(path.join(base, 'secret.txt'), 'secret');
      await createFileSymlink(path.join(base, 'secret.txt'), path.join(workspace, 'docs', 'secret-link.txt'));

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

  test('workspace download route returns bytes with safe headers and rejects symlink escapes', async ({ skip }) => {
    if (!(await canCreateFileSymlink())) {
      skip('File symlink creation is not permitted in this environment');
    }

    await withTempWorkspace(async ({ workspace, base }) => {
      await writeFile(path.join(workspace, 'report.txt'), 'download me');
      await writeFile(path.join(workspace, '用例报告.txt'), 'utf8 name');
      await writeFile(path.join(base, 'secret.txt'), 'secret');
      await createFileSymlink(path.join(base, 'secret.txt'), path.join(workspace, 'secret-link.txt'));

      const { download } = await loadWorkspaceRoutes();
      const response = await download.GET(makeRequest(`/api/workspace/download?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent('report.txt')}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(response.headers.get('content-disposition')).toBe('attachment; filename="report.txt"; filename*=UTF-8\'\'report.txt');
      await expect(response.text()).resolves.toBe('download me');

      const utf8Response = await download.GET(makeRequest(`/api/workspace/download?workspace=${encodeURIComponent(workspace)}&path=${encodeURIComponent('用例报告.txt')}`));
      expect(utf8Response.status).toBe(200);
      expect(utf8Response.headers.get('content-disposition')).toBe(
        'attachment; filename="____.txt"; filename*=UTF-8\'\'%E7%94%A8%E4%BE%8B%E6%8A%A5%E5%91%8A.txt'
      );
      await expect(utf8Response.text()).resolves.toBe('utf8 name');

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

  test('workspace static route serves html and referenced assets inside the workspace', async () => {
    await withTempWorkspace(async ({ workspace }) => {
      await mkdir(path.join(workspace, 'site', 'assets'), { recursive: true });
      await writeFile(
        path.join(workspace, 'site', 'index.html'),
        '<link href="/site/assets/app.css" rel="stylesheet"><script src="app.js"></script><img src="assets/logo.svg">',
      );
      await writeFile(path.join(workspace, 'site', 'app.js'), 'window.previewLoaded = true;');
      await writeFile(path.join(workspace, 'site', 'assets', 'app.css'), 'body{background:url(/site/assets/logo.svg)}');
      await writeFile(path.join(workspace, 'site', 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');

      const { workspaceStatic } = await loadWorkspaceRoutes();
      const token = Buffer.from(workspace, 'utf8').toString('base64url');
      const html = await workspaceStatic.GET(
        makeRequest(`/api/workspace/static/${token}/site/index.html`),
        { params: Promise.resolve({ workspaceToken: token, filePath: ['site', 'index.html'] }) },
      );
      expect(html.status).toBe(200);
      expect(html.headers.get('content-type')).toContain('text/html');
      expect(await html.text()).toContain(`/api/workspace/static/${encodeURIComponent(token)}/site/assets/app.css`);

      const css = await workspaceStatic.GET(
        makeRequest(`/api/workspace/static/${token}/site/assets/app.css`),
        { params: Promise.resolve({ workspaceToken: token, filePath: ['site', 'assets', 'app.css'] }) },
      );
      expect(css.status).toBe(200);
      expect(css.headers.get('content-type')).toContain('text/css');
      expect(await css.text()).toContain(`/api/workspace/static/${encodeURIComponent(token)}/site/assets/logo.svg`);

      const script = await workspaceStatic.GET(
        makeRequest(`/api/workspace/static/${token}/site/app.js`),
        { params: Promise.resolve({ workspaceToken: token, filePath: ['site', 'app.js'] }) },
      );
      expect(script.status).toBe(200);
      expect(script.headers.get('content-type')).toContain('text/javascript');
      expect(await script.text()).toBe('window.previewLoaded = true;');
    });
  });

  test('workspace static route rejects traversal and symlink escapes', async ({ skip }) => {
    if (!(await canCreateFileSymlink())) {
      skip('File symlink creation is not permitted in this environment');
    }

    await withTempWorkspace(async ({ workspace, base }) => {
      await writeFile(path.join(base, 'secret.html'), 'secret');
      await createFileSymlink(path.join(base, 'secret.html'), path.join(workspace, 'link.html'));
      const { workspaceStatic } = await loadWorkspaceRoutes();
      const token = Buffer.from(workspace, 'utf8').toString('base64url');

      await assertErrorResponse(
        await workspaceStatic.GET(
          makeRequest(`/api/workspace/static/${token}/../secret.html`),
          { params: Promise.resolve({ workspaceToken: token, filePath: ['..', 'secret.html'] }) },
        ),
        400,
      );
      await assertErrorResponse(
        await workspaceStatic.GET(
          makeRequest(`/api/workspace/static/${token}/link.html`),
          { params: Promise.resolve({ workspaceToken: token, filePath: ['link.html'] }) },
        ),
        403,
      );
    });
  });
});
