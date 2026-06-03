import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { parse, stringify } from 'yaml';
import { ZipFile } from 'yazl';
import unzipper from 'unzipper';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

interface AuthResult {
  token: string;
  user: { id: string };
}

async function createAuthToken(role: 'admin' | 'user' = 'user'): Promise<AuthResult> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `archive-${suffix}`,
    email: `archive-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role,
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

function workflowConfig(projectRoot: string, name: string) {
  return {
    workflow: {
      name,
      phases: [
        {
          name: 'Build',
          steps: [
            { name: 'Implement', agent: 'developer', task: 'Implement the requested change' },
          ],
        },
      ],
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Ship the workflow archive feature',
    },
  };
}

function portableWorkflowConfig(name: string) {
  return {
    workflow: {
      name,
      phases: [
        {
          name: 'Portable Phase',
          steps: [
            { name: 'Portable Step', agent: 'external-agent', task: 'Run outside this workspace' },
          ],
        },
      ],
      supervisor: { enabled: true, agent: 'external-supervisor' },
    },
    context: {
      projectRoot: '{project_root}',
      workspaceMode: 'in-place',
    },
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

describe('/api/configs/archive', () => {
  test('exports selected workflow YAML files as a zip', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(path.join(configsDir, 'nested'), { recursive: true });
        await writeFile(path.join(configsDir, 'alpha.yaml'), stringify(workflowConfig(workspace, 'Alpha')), 'utf8');
        await writeFile(path.join(configsDir, 'nested', 'beta.yaml'), stringify(workflowConfig(workspace, 'Beta')), 'utf8');

        const { PUT } = await import('@/app/api/configs/archive/route');
        const response = await PUT(makeRequest('/api/configs/archive', {
          method: 'PUT',
          token,
          json: { workflows: ['alpha.yaml', 'nested/beta.yaml'] },
        }));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('application/zip');
        expect(response.headers.get('content-disposition')).toContain('workflows-export.zip');

        const zipBuffer = Buffer.from(await response.arrayBuffer());
        await expect(listZipEntryPaths(zipBuffer)).resolves.toEqual([
          'alpha.yaml',
          'nested/beta.yaml',
        ]);
      });
    });
  });

  test('returns 404 when exporting a missing workflow', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { PUT } = await import('@/app/api/configs/archive/route');
      const response = await PUT(makeRequest('/api/configs/archive', {
        method: 'PUT',
        token,
        json: { workflows: ['missing.yaml'] },
      }));

      expect(response.status).toBe(404);
      const body = await responseJson<any>(response);
      expect(body.error).toContain('missing.yaml');
    });
  });

  test('exports structurally valid portable workflows without runtime-specific checks', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const { token } = await createAuthToken();
      const configsDir = path.join(aceHome, 'configs');
      await mkdir(configsDir, { recursive: true });
      await writeFile(
        path.join(configsDir, 'portable.yaml'),
        stringify(portableWorkflowConfig('Portable Workflow')),
        'utf8',
      );

      const { PUT } = await import('@/app/api/configs/archive/route');
      const response = await PUT(makeRequest('/api/configs/archive', {
        method: 'PUT',
        token,
        json: { workflows: ['portable.yaml'] },
      }));

      expect(response.status).toBe(200);
      const zipBuffer = Buffer.from(await response.arrayBuffer());
      await expect(listZipEntryPaths(zipBuffer)).resolves.toEqual(['portable.yaml']);
    });
  });

  test('exports workflow SpecCoding as archive sidecar YAML', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(configsDir, { recursive: true });
        const config = workflowConfig(workspace, 'Spec Export');
        await writeFile(path.join(configsDir, 'spec-export.yaml'), stringify(config), 'utf8');

        const { buildCreationSession, saveCreationSession } = await import('@/lib/spec/coding-store');
        const session = buildCreationSession({
          chatSessionId: 'chat-export',
          createdBy: user.id,
          filename: 'spec-export.yaml',
          workflowName: 'Spec Export',
          mode: 'phase-based',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          requirements: 'Export the SpecCoding sidecar',
          config,
        });
        session.specCoding.artifacts.requirements = '# Requirements\n\nPreserve this exported spec.';
        await saveCreationSession(session);

        const { PUT } = await import('@/app/api/configs/archive/route');
        const response = await PUT(makeRequest('/api/configs/archive', {
          method: 'PUT',
          token,
          json: { workflows: ['spec-export.yaml'] },
        }));

        expect(response.status).toBe(200);
        const zipBuffer = Buffer.from(await response.arrayBuffer());
        await expect(listZipEntryPaths(zipBuffer)).resolves.toEqual([
          'spec-coding/spec-export.yaml',
          'spec-export.yaml',
        ]);

        const sidecar = parse(await readZipEntry(zipBuffer, 'spec-coding/spec-export.yaml'));
        expect(sidecar.filename).toBe('spec-export.yaml');
        expect(sidecar.specCoding.linkedConfigFilename).toBe('spec-export.yaml');
        expect(sidecar.specCoding.artifacts.requirements).toContain('Preserve this exported spec');
      });
    });
  });

  test('imports workflow YAML files from a zip and records private metadata', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const archive = await createZip({
          'imported.yaml': stringify(workflowConfig(workspace, 'Imported')),
          'folder/nested.yaml': stringify(workflowConfig(workspace, 'Nested Imported')),
        });
        const formData = new FormData();
        formData.append('file', new File([new Uint8Array(archive)], 'workflows.zip', { type: 'application/zip' }));

        const { POST } = await import('@/app/api/configs/archive/route');
        const response = await POST(makeRequest('/api/configs/archive', {
          method: 'POST',
          token,
          body: formData,
        }));

        expect(response.status).toBe(200);
        const body = await responseJson<any>(response);
        expect(body.imported.sort()).toEqual(['folder/nested.yaml', 'imported.yaml']);

        const imported = parse(await readFile(path.join(aceHome, 'configs', 'imported.yaml'), 'utf8'));
        const nested = parse(await readFile(path.join(aceHome, 'configs', 'folder', 'nested.yaml'), 'utf8'));
        expect(imported.workflow.name).toBe('Imported');
        expect(nested.workflow.name).toBe('Nested Imported');

        const meta = JSON.parse(await readFile(path.join(aceHome, 'configs', '.metadata.json'), 'utf8'));
        expect(meta['imported.yaml'].createdBy).toBe(user.id);
        expect(meta['imported.yaml'].visibility).toBe('private');
      });
    });
  });

  test('rejects zip files without valid workflow YAML', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const archive = await createZip({ 'notes.txt': 'no workflow here' });
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array(archive)], 'workflows.zip', { type: 'application/zip' }));

      const { POST } = await import('@/app/api/configs/archive/route');
      const response = await POST(makeRequest('/api/configs/archive', {
        method: 'POST',
        token,
        body: formData,
      }));

      expect(response.status).toBe(400);
      const body = await responseJson<any>(response);
      expect(body.error).toContain('未找到');
    });
  });

  test('imports structurally valid portable workflows', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      const { token } = await createAuthToken();
      const archive = await createZip({
        'portable.yaml': stringify(portableWorkflowConfig('Portable Import')),
      });
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array(archive)], 'workflows.zip', { type: 'application/zip' }));

      const { POST } = await import('@/app/api/configs/archive/route');
      const response = await POST(makeRequest('/api/configs/archive', {
        method: 'POST',
        token,
        body: formData,
      }));

      expect(response.status).toBe(200);
      const body = await responseJson<any>(response);
      expect(body.imported).toEqual(['portable.yaml']);

      const imported = parse(await readFile(path.join(aceHome, 'configs', 'portable.yaml'), 'utf8'));
      expect(imported.context.projectRoot).toBe('{project_root}');
    });
  });

  test('imports workflow SpecCoding sidecar and binds it to imported workflow filename', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const config = workflowConfig(workspace, 'Spec Import');
        const { buildCreationSession, loadLatestCreationSessionByFilename } = await import('@/lib/spec/coding-store');
        const archivedSession = buildCreationSession({
          chatSessionId: 'chat-import-source',
          createdBy: 'source-user',
          filename: 'spec-import.yaml',
          workflowName: 'Spec Import',
          mode: 'phase-based',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          requirements: 'Import the SpecCoding sidecar',
          config,
        });
        archivedSession.specCoding.artifacts.tasks = '# Tasks\n\n- [ ] Preserve imported task notes';

        const archive = await createZip({
          'spec-import.yaml': stringify(config),
          'spec-coding/spec-import.yaml': stringify(archivedSession),
        });
        const formData = new FormData();
        formData.append('file', new File([new Uint8Array(archive)], 'workflows.zip', { type: 'application/zip' }));

        const { POST } = await import('@/app/api/configs/archive/route');
        const response = await POST(makeRequest('/api/configs/archive', {
          method: 'POST',
          token,
          body: formData,
        }));

        expect(response.status).toBe(200);
        const body = await responseJson<any>(response);
        expect(body.imported).toEqual(['spec-import.yaml']);

        const restored = await loadLatestCreationSessionByFilename('spec-import.yaml');
        expect(restored).toBeTruthy();
        expect(restored!.id).not.toBe(archivedSession.id);
        expect(restored!.createdBy).toBe(user.id);
        expect(restored!.filename).toBe('spec-import.yaml');
        expect(restored!.specCoding.linkedConfigFilename).toBe('spec-import.yaml');
        expect(restored!.specCoding.artifacts.tasks).toContain('Preserve imported task notes');

        const imported = parse(await readFile(path.join(aceHome, 'configs', 'spec-import.yaml'), 'utf8'));
        expect(imported.workflow.name).toBe('Spec Import');
      });
    });
  });
});
