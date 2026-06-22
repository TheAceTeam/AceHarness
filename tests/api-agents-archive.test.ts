import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { parse, stringify } from 'yaml';
import { ZipFile } from 'yazl';
import unzipper from 'unzipper';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

function agentConfig(name: string) {
  return {
    name,
    team: 'red',
    roleType: 'normal',
    engineModels: {},
    activeEngine: '',
    capabilities: ['通用协作'],
    systemPrompt: `You are ${name}.`,
  };
}

async function createZip(entries: Record<string, string>): Promise<Buffer> {
  const zipfile = new ZipFile();
  for (const [entryPath, content] of Object.entries(entries)) {
    zipfile.addBuffer(Buffer.from(content), entryPath);
  }
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    zipfile.outputStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    zipfile.outputStream.on('end', resolve);
    zipfile.outputStream.on('error', reject);
  });
  zipfile.end();
  await done;
  return Buffer.concat(chunks);
}

async function listZipEntryPaths(buffer: Buffer): Promise<string[]> {
  const paths: string[] = [];
  const parser = unzipper.Parse();
  parser.on('entry', (entry: { path: string; autodrain: () => void }) => {
    paths.push(entry.path.split(path.sep).join('/'));
    entry.autodrain();
  });
  Readable.from(buffer).pipe(parser);
  await finished(parser);
  return paths.sort();
}

async function readZipEntry(buffer: Buffer, entryPath: string): Promise<string> {
  const directory = await (unzipper as any).Open.buffer(buffer);
  const entry = (directory.files || []).find((item: { path: string }) => item.path.split(path.sep).join('/') === entryPath);
  if (!entry) throw new Error(`Missing zip entry: ${entryPath}`);
  return (await entry.buffer()).toString('utf8');
}

async function loadArchiveRoute() {
  vi.resetModules();
  return import('@/app/api/agents/archive/route');
}

describe('/api/agents/archive', () => {
  test('returns 400 when no agents are selected for export', async () => {
    await withIsolatedAceHome(async () => {
      const { PUT } = await loadArchiveRoute();
      const response = await PUT(makeRequest('/api/agents/archive', {
        method: 'PUT',
        json: { agents: [] },
      }));

      expect(response.status).toBe(400);
      const body = await responseJson<any>(response);
      expect(body.error).toContain('导出');
    });
  });

  test('exports selected agent YAML files as a zip', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { getRuntimeAgentsDirPath } = await import('@/lib/run/runtime-configs');
      const agentsDir = await getRuntimeAgentsDirPath();
      await mkdir(agentsDir, { recursive: true });
      await writeFile(path.join(agentsDir, 'alpha-agent.yaml'), stringify(agentConfig('alpha-agent')), 'utf8');
      await writeFile(path.join(agentsDir, 'beta-agent.yml'), stringify(agentConfig('beta-agent')), 'utf8');

      const { PUT } = await import('@/app/api/agents/archive/route');
      const response = await PUT(makeRequest('/api/agents/archive', {
        method: 'PUT',
        json: { agents: ['alpha-agent', 'beta-agent'] },
      }));

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('application/zip');
      expect(response.headers.get('content-disposition')).toContain('agents-export.zip');

      const zipBuffer = Buffer.from(await response.arrayBuffer());
      await expect(listZipEntryPaths(zipBuffer)).resolves.toEqual([
        'alpha-agent.yaml',
        'beta-agent.yml',
      ]);

      const alpha = parse(await readZipEntry(zipBuffer, 'alpha-agent.yaml'));
      expect(alpha.name).toBe('alpha-agent');
    });
  });

  test('imports agent YAML files from a zip', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const archive = await createZip({
        'imported-agent.yaml': stringify(agentConfig('imported-agent')),
        'nested/another-agent.yml': stringify(agentConfig('another-agent')),
      });
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array(archive)], 'agents.zip', { type: 'application/zip' }));

      const { POST } = await loadArchiveRoute();
      const response = await POST(makeRequest('/api/agents/archive', {
        method: 'POST',
        body: formData,
      }));

      expect(response.status).toBe(200);
      const body = await responseJson<any>(response);
      expect(body.imported.sort()).toEqual(['another-agent', 'imported-agent']);

      const imported = parse(await readFile(path.join(aceHome, 'configs', 'agents', 'imported-agent.yaml'), 'utf8'));
      const nested = parse(await readFile(path.join(aceHome, 'configs', 'agents', 'another-agent.yaml'), 'utf8'));
      expect(imported.name).toBe('imported-agent');
      expect(nested.name).toBe('another-agent');
    });
  });

  test('rejects zip files without agent YAML', async () => {
    await withIsolatedAceHome(async () => {
      const archive = await createZip({ 'notes.txt': 'no agent here' });
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array(archive)], 'agents.zip', { type: 'application/zip' }));

      const { POST } = await loadArchiveRoute();
      const response = await POST(makeRequest('/api/agents/archive', {
        method: 'POST',
        body: formData,
      }));

      expect(response.status).toBe(400);
      const body = await responseJson<any>(response);
      expect(body.error).toContain('未找到');
    });
  });
});
