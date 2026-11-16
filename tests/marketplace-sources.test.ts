import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZipFile } from 'yazl';

const { paths } = vi.hoisted(() => ({ paths: { root: '' } }));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: async () => ({ role: 'admin' }),
  requireAdmin: async () => ({ role: 'admin' }),
}));
vi.mock('@/lib/core/app-paths', () => ({
  getWorkspaceConfigFile: (name: string) => join(paths.root, 'config', name),
  getInstallPath: (...parts: string[]) => join(paths.root, 'install', ...parts),
}));
vi.mock('@/lib/run/runtime-skills', () => ({
  getRuntimeSkillsDirPath: async () => join(paths.root, 'runtime'),
  getSkillsTempPath: (...parts: string[]) => join(paths.root, 'temp', ...parts),
}));

import { getMarketplaceInstallFolder } from '@/constants/marketplace';
import { GET as getSources, POST as addSource, DELETE as removeSource } from '@/server/api-routes/marketplace/sources/route';
import { POST as install } from '@/server/api-routes/marketplace/install/route';
import { POST as search } from '@/server/api-routes/marketplace/search/route';

function request(route: string, body?: object) {
  return new Request('http://localhost/api/marketplace/' + route, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
}

async function packageZip(body: string): Promise<Response> {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(body), 'SKILL.md');
  zip.addBuffer(Buffer.from('package asset'), 'references/example.txt');
  zip.end();
  return new Response(new Uint8Array(await buffer(zip.outputStream)));
}

const matrixRow = {
  id: 'matrix-row',
  name: 'common-skill',
  owner: { account: 'matrix-author' },
};

const catalog = {
  skills: [{ slug: 'common-skill', name: 'Custom skill', version: '1.0.0', downloadUrl: 'latest.zip' }],
};

describe('marketplace sources', () => {
  beforeEach(async () => {
    paths.root = await fs.mkdtemp(join(tmpdir(), 'ace-market-test-'));
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(paths.root, { recursive: true, force: true });
  });

  it('uses only the selected market and its own paging and category', async () => {
    const fetchMock = vi.fn(async (input: string | URL, options?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === 'matrix.openharmony.cn') {
        expect(JSON.parse(String(options?.body))).toMatchObject({ pageNum: 2, pageSize: 12, keyword: 'test', categoryId: 'matrix-category' });
        return Response.json({ code: '20000', data: { count: 17, list: [matrixRow] } });
      }
      expect(url.searchParams.get('page')).toBe('2');
      expect(url.searchParams.get('pageSize')).toBe('12');
      expect(url.searchParams.get('keyword')).toBe('test');
      expect(url.searchParams.get('category')).toBe('ai-agent');
      return Response.json({ code: 0, data: { total: 19, skills: [{ slug: 'common-skill', name: 'Same slug', namespace: { handle: 'an-author' }, tags: null }] } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const matrix = await search(request('search', { source: 'matrix', pageNum: 2, pageSize: 12, keyword: 'test', category: 'matrix-category' }));
    expect(matrix.status).toBe(200);
    expect((await matrix.json()).data).toMatchObject({
      total: 17, totalPages: 2, pageNum: 2, pageSize: 12,
      skills: [{ source: 'matrix', installName: 'common-skill' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const skillhub = await search(request('search', { source: 'skillhub', pageNum: 2, pageSize: 12, keyword: 'test', category: 'ai-agent' }));
    expect(skillhub.status).toBe(200);
    expect((await skillhub.json()).data).toMatchObject({
      total: 19, totalPages: 2, pageNum: 2, pageSize: 12,
      skills: [{ source: 'skillhub', id: 'skillhub:an-author/common-skill', installName: 'common-skill', namespace: 'an-author', tags: [] }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects aggregate requests before contacting any source', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await search(request('search', { source: 'all' }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports the selected market failure without querying a different market', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      expect(new URL(input).hostname).toBe('api.skillhub.cn');
      return new Response(null, { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await search(request('search', { source: 'skillhub' }));
    expect(response.status).toBe(502);
    expect((await response.json()).success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('adds, searches, installs and removes a custom catalog while retaining its skill and a same-name Matrix skill', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(input);
      if (url.pathname.endsWith('latest.zip')) {
        return packageZip('---\nname: common-skill\ndescription: A sample skill\n---\nSample instructions.\n');
      }
      return Response.json(catalog);
    });
    vi.stubGlobal('fetch', fetchMock);
    const created = await addSource(request('sources', { label: 'Custom', url: 'https://example.org/catalog.json', protocol: 'catalog' }));
    expect(created.status).toBe(200);
    const { source } = await created.json();
    const sources = await getSources(request('sources'));
    expect((await sources.json()).sources.map((entry: { id: string }) => entry.id)).toEqual(['matrix', 'skillhub', source.id]);
    const result = await search(request('search', { source: source.id, keyword: 'custom' }));
    expect((await result.json()).data.skills).toMatchObject([{ name: 'Custom skill', source: source.id, version: '1.0.0' }]);

    const matrixFolder = join(paths.root, 'runtime', 'common-skill');
    await fs.mkdir(matrixFolder, { recursive: true });
    await fs.writeFile(join(matrixFolder, 'SKILL.md'), 'Unchanged Matrix content.');

    const installed = await install(request('install', { source: source.id, skillName: 'common-skill', version: '1.0.0' }));
    expect(installed.status).toBe(200);
    const { data } = await installed.json();
    expect(await fs.readFile(join(matrixFolder, 'SKILL.md'), 'utf-8')).toBe('Unchanged Matrix content.');
    expect(await fs.readFile(join(data.runtimePath, 'SKILL.md'), 'utf-8')).toContain('name: ' + getMarketplaceInstallFolder(source.id, 'common-skill'));
    expect(await fs.readFile(join(data.installPath, 'references', 'example.txt'), 'utf-8')).toBe('package asset');

    await removeSource(new Request('http://localhost/api/marketplace/sources?id=' + source.id, { method: 'DELETE' }));
    expect((await search(request('search', { source: source.id }))).status).toBe(404);
    expect(await fs.readFile(join(data.runtimePath, 'references', 'example.txt'), 'utf-8')).toBe('package asset');
  });

  it('downloads the selected SkillHub version and keeps the registry key on the registry host', async () => {
    vi.stubEnv('SKILLHUB_API_KEY', 'test-key');
    const mock = vi.fn(async (input: string | URL, options?: RequestInit) => {
      const url = new URL(input);
      if (url.hostname === 'api.skillhub.cn') {
        expect(url.searchParams.get('slug')).toBe('@an-author/sample');
        expect(url.searchParams.get('version')).toBe('1.0.2');
        expect(new Headers(options?.headers).get('X-API-Key')).toBe('test-key');
        return new Response(null, { status: 302, headers: { Location: 'https://example.org/sample.zip' } });
      }
      expect(new Headers(options?.headers).has('X-API-Key')).toBe(false);
      return packageZip('---\nname: sample\ndescription: A sample skill\n---\n');
    });
    vi.stubGlobal('fetch', mock);
    try {
      const response = await install(request('install', { source: 'skillhub', skillName: 'sample', namespace: 'an-author', version: '1.0.2' }));
      expect(response.status).toBe(200);
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
