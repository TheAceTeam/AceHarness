import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempDir } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('models API route', () => {
  test('keeps deleted bundled models from being restored on refresh', async () => {
    await withTempDir('aceharness-test-install-', async (installRoot) => {
      await withIsolatedAceHome(async (aceHome) => {
        const previousInstallRoot = process.env.CSIHARNESS_INSTALL_ROOT;
        process.env.CSIHARNESS_INSTALL_ROOT = installRoot;

        try {
          const installModelsDir = path.join(installRoot, 'configs', 'models');
          await mkdir(installModelsDir, { recursive: true });
          await writeFile(
            path.join(installModelsDir, 'models.yaml'),
            [
              'models:',
              '  - value: bundled-a',
              '    label: Bundled A',
              '    costMultiplier: 1',
              '    endpoints: []',
              '  - value: bundled-b',
              '    label: Bundled B',
              '    costMultiplier: 1',
              '    endpoints: []',
              '',
            ].join('\n'),
            'utf-8',
          );

          vi.resetModules();
          const { POST } = await import('@/app/api/models/route');
          const saveResponse = await POST(makeRequest('/api/models', {
            json: {
              models: [
                {
                  value: 'bundled-a',
                  label: 'Bundled A',
                  costMultiplier: 1,
                  endpoints: [],
                  engines: [],
                  status: 'active',
                },
              ],
            },
          }));

          expect(saveResponse.status).toBe(200);
          expect((await responseJson<any>(saveResponse)).success).toBe(true);

          const runtimeModelsPath = path.join(aceHome, 'configs', 'models', 'models.yaml');
          const savedConfig = parse(await readFile(runtimeModelsPath, 'utf-8')) as { models?: Array<{ value: string }> };
          expect(savedConfig.models?.map((model) => model.value)).toEqual(['bundled-a']);

          vi.resetModules();
          const { GET } = await import('@/app/api/models/route');
          const reloadResponse = await GET();
          expect(reloadResponse.status).toBe(200);

          const reloadBody = await responseJson<{ models: Array<{ value: string }> }>(reloadResponse);
          expect(reloadBody.models.map((model) => model.value)).toEqual(['bundled-a']);
        } finally {
          if (previousInstallRoot === undefined) delete process.env.CSIHARNESS_INSTALL_ROOT;
          else process.env.CSIHARNESS_INSTALL_ROOT = previousInstallRoot;
        }
      });
    });
  });

  test('replaces a saved model engine list instead of merging deleted engines back', async () => {
    await withTempDir('aceharness-test-install-', async (installRoot) => {
      await withIsolatedAceHome(async (aceHome) => {
        const previousInstallRoot = process.env.CSIHARNESS_INSTALL_ROOT;
        process.env.CSIHARNESS_INSTALL_ROOT = installRoot;

        try {
          const installModelsDir = path.join(installRoot, 'configs', 'models');
          await mkdir(installModelsDir, { recursive: true });
          await writeFile(
            path.join(installModelsDir, 'models.yaml'),
            [
              'models:',
              '  - value: shared-model',
              '    label: Shared Model',
              '    costMultiplier: 1',
              '    endpoints: []',
              '    engines:',
              '      - opencode',
              '      - nga',
              '',
            ].join('\n'),
            'utf-8',
          );

          vi.resetModules();
          const { POST } = await import('@/app/api/models/route');
          const saveResponse = await POST(makeRequest('/api/models', {
            json: {
              models: [
                {
                  value: 'shared-model',
                  label: 'Shared Model',
                  costMultiplier: 1,
                  endpoints: [],
                  engines: ['opencode'],
                  status: 'active',
                },
              ],
            },
          }));

          expect(saveResponse.status).toBe(200);

          const runtimeModelsPath = path.join(aceHome, 'configs', 'models', 'models.yaml');
          const savedConfig = parse(await readFile(runtimeModelsPath, 'utf-8')) as {
            models?: Array<{ value: string; engines?: string[] }>;
          };
          expect(savedConfig.models?.[0]?.engines).toEqual(['opencode']);

          vi.resetModules();
          const { GET } = await import('@/app/api/models/route');
          const reloadResponse = await GET();
          const reloadBody = await responseJson<{ models: Array<{ value: string; engines?: string[] }> }>(reloadResponse);
          expect(reloadBody.models.find((model) => model.value === 'shared-model')?.engines).toEqual(['opencode']);
        } finally {
          if (previousInstallRoot === undefined) delete process.env.CSIHARNESS_INSTALL_ROOT;
          else process.env.CSIHARNESS_INSTALL_ROOT = previousInstallRoot;
        }
      });
    });
  });
});
