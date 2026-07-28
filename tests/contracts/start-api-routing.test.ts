import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

const projectRoot = resolve(__dirname, '../..');
const serverApiRoot = resolve(projectRoot, 'src/server/api-routes');

type RouteCandidate = {
  modulePath: string;
  segments: string[];
};

async function listRouteFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listRouteFiles(fullPath));
      continue;
    }
    if (entry.name === 'route.ts') {
      files.push(fullPath);
    }
  }

  return files;
}

function toCandidate(file: string): RouteCandidate {
  const modulePath = `/${relative(projectRoot, file).replace(/\\/g, '/')}`;
  return {
    modulePath,
    segments: relative(serverApiRoot, resolve(file, '..')).replace(/\\/g, '/').split('/').filter(Boolean),
  };
}

function scoreSegments(segments: string[]) {
  return segments.reduce((score, segment) => {
    if (/^\[\.\.\..+\]$/.test(segment)) return score;
    if (/^\[.+\]$/.test(segment)) return score + 1;
    return score + 3;
  }, segments.length);
}

function matchBridgeRoute(candidates: RouteCandidate[], apiPath: string) {
  const pathSegments = apiPath.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  for (const candidate of [...candidates].sort((a, b) => scoreSegments(b.segments) - scoreSegments(a.segments))) {
    let pathIndex = 0;
    let matched = true;
    const params: Record<string, string | string[]> = {};

    for (const segment of candidate.segments) {
      const dynamic = /^\[(.+)\]$/.exec(segment);
      if (!dynamic) {
        if (pathSegments[pathIndex] !== segment) {
          matched = false;
          break;
        }
        pathIndex += 1;
        continue;
      }

      const key = dynamic[1];
      if (key.startsWith('...')) {
        params[key.slice(3)] = pathSegments.slice(pathIndex).map(decodeURIComponent);
        pathIndex = pathSegments.length;
        break;
      }

      const value = pathSegments[pathIndex];
      if (value === undefined) {
        matched = false;
        break;
      }
      params[key] = decodeURIComponent(value);
      pathIndex += 1;
    }

    if (matched && pathIndex === pathSegments.length) {
      return { ...candidate, params };
    }
  }

  return null;
}

describe('Start API routing contract', () => {
  test('native Start API routes cover static and dynamic server handlers', async () => {
    const routeTree = await readFile(resolve(projectRoot, 'src/routeTree.gen.ts'), 'utf8');

    expect(routeTree).toContain("'/api/workflow/status'");
    expect(routeTree).toContain("'/api/run-history'");
    expect(routeTree).toContain("'/api/runs/$id/documents'");
    expect(routeTree).toContain("'/api/$'");
  });

  test('native dynamic Start API routes are generated as dynamic route ids', async () => {
    const routeTree = await readFile(resolve(projectRoot, 'src/routeTree.gen.ts'), 'utf8');

    expect(routeTree).toContain("'/api/runs/$id/documents': typeof ApiRunsIdDocumentsRoute");
    expect(routeTree).toContain("fullPath: '/api/runs/$id/documents'");
  });

  test('catch-all bridge matches dynamic API route modules before falling through to 404', async () => {
    const candidates = (await listRouteFiles(serverApiRoot)).map(toCandidate);

    const match = matchBridgeRoute(candidates, '/api/agents/default-agent/chat/stream');

    expect(match?.modulePath).toBe('/src/server/api-routes/agents/[name]/chat/stream/route.ts');
    expect(match?.params).toEqual({ name: 'default-agent' });
  });

  test('catch-all bridge matches splat API route modules before falling through to 404', async () => {
    const candidates = (await listRouteFiles(serverApiRoot)).map(toCandidate);

    const match = matchBridgeRoute(candidates, '/api/workspace/static/workspace-token/assets/app.js');

    expect(match?.modulePath).toBe('/src/server/api-routes/workspace/static/[workspaceToken]/[...filePath]/route.ts');
    expect(match?.params).toEqual({
      workspaceToken: 'workspace-token',
      filePath: ['assets', 'app.js'],
    });
  });

  test('catch-all bridge prefers exact static route handlers over dynamic siblings', async () => {
    const candidates = (await listRouteFiles(serverApiRoot)).map(toCandidate);

    const match = matchBridgeRoute(candidates, '/api/configs/create');

    expect(match?.modulePath).toBe('/src/server/api-routes/configs/create/route.ts');
    expect(match?.modulePath).not.toBe('/src/server/api-routes/configs/[filename]/route.ts');
  });

  test('Start API routes bind canonical route modules directly without dispatcher wrappers', async () => {
    const workspaceStatic = await readFile(resolve(projectRoot, 'src/routes/api.workspace.static.$workspaceToken.$.ts'), 'utf8');
    const chatStream = await readFile(resolve(projectRoot, 'src/routes/api.chat.stream.ts'), 'utf8');
    const routeFiles = await readdir(resolve(projectRoot, 'src/routes'));

    expect(routeFiles).not.toContain('api-route-dispatcher.ts');
    expect(workspaceStatic).toContain("import { GET as apiRouteGET } from '@/server/api-routes/workspace/static/[workspaceToken]/[...filePath]/route'");
    expect(workspaceStatic).not.toContain('loadApiRouteModule');
    expect(chatStream).toContain("import { GET as apiRouteGET, POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/chat/stream/route'");
    expect(chatStream).not.toContain('loadApiRouteModule');

    for (const file of routeFiles.filter((entry) => entry.startsWith('api.') && entry.endsWith('.ts'))) {
      const source = await readFile(resolve(projectRoot, 'src/routes', file), 'utf8');
      expect(source).not.toContain("import * as apiRouteModule from '@/server/api-routes");
      expect(source).not.toContain('dispatchApi');
      expect(source).not.toContain('route-dispatcher');
      expect(source).not.toContain('@/server/api-route-runtime/request-response');
      expect(source).not.toContain('@/app/api/');
    }
  });
});
