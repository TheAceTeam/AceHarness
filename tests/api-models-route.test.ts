import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempDir } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('models API route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('@/lib/auth/middleware');
    vi.doUnmock('@/lib/models/probes');
    vi.doUnmock('@/lib/models/diagnostics-runtime-bridge');
    vi.resetModules();
  });

  test('GET returns SQLite-backed model catalog and route DTOs', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, {
          id: 'gpt-5.3-codex',
          displayName: 'GPT 5.3 Codex',
          metadata: { costMultiplier: 0.05 },
          now: '2026-07-09T00:00:00.000Z',
        });
        upsertModelProvider(db, {
          id: 'openai',
          kind: 'openai',
          displayName: 'OpenAI',
          now: '2026-07-09T00:00:00.000Z',
        });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex',
          isDefault: true,
          now: '2026-07-09T00:00:00.000Z',
        });
      } finally {
        db.close();
      }

      const { GET } = await import('@/server/api-routes/models/route');
      const response = await GET();
      expect(response.status).toBe(200);
      const body = await responseJson<{ models: any[]; routes: any[]; yamlSeed: string }>(response);
      expect(body.models[0]).toMatchObject({
        value: 'gpt-5.3-codex',
        modelRouteId: 'route-codex-gpt',
        agentId: 'codex',
        provider: 'openai',
        providerModel: 'gpt-5.3-codex',
      });
      expect(body.routes).toHaveLength(1);
      expect(body.yamlSeed).toContain('modelRouteId: route-codex-gpt');
    });
  });

  test('engine models route returns ACPX discovered models', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doMock('acpx/runtime', () => ({
        createAgentRegistry: () => ({}),
        createRuntimeStore: () => ({}),
        createAcpRuntime: () => ({
          ensureSession: vi.fn(async () => ({ sessionKey: 'test-session', backend: 'acpx', runtimeSessionName: 'test' })),
          getStatus: vi.fn(async () => ({
            models: {
              availableModelIds: ['gpt-5.5[high]', 'gpt-5.5[high]', 'gpt-5.4[medium]'],
            },
            configOptions: [
              {
                id: 'model',
                type: 'select',
                options: [
                  { value: 'gpt-5.6-sol', label: 'GPT 5.6 Sol' },
                  { value: 'gpt-5.6-terra', label: 'GPT 5.6 Terra' },
                ],
              },
              {
                id: 'reasoning_effort',
                type: 'select',
                label: 'Reasoning effort for model',
                options: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
              },
            ],
          })),
          close: vi.fn(async () => undefined),
        }),
      }));

      const { GET } = await import('@/server/api-routes/engine/models/route');
      const response = await GET(makeRequest('/api/engine/models?engine=codex'));
      expect(response.status).toBe(200);
      const body = await responseJson<{ source: string; models: any[] }>(response);
      expect(body).toMatchObject({
        source: 'acpx',
      });
      expect(body.models.map((model) => model.modelId)).toEqual([
        'gpt-5.5[high]',
        'gpt-5.4[medium]',
        'gpt-5.6-sol',
        'gpt-5.6-terra',
      ]);
    });
  });

  test('DeepSeek model discovery uses ACP directly', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      let runtimeOptions: any;
      let ensureInput: any;
      vi.doMock('acpx/runtime', () => ({
        createAgentRegistry: () => ({}),
        createRuntimeStore: () => ({}),
        createAcpRuntime: (options: any) => {
          runtimeOptions = options;
          return {
            ensureSession: vi.fn(async (input: any) => {
              ensureInput = input;
              return { sessionKey: input.sessionKey, backend: 'acpx', runtimeSessionName: 'test' };
            }),
            getStatus: vi.fn(async () => ({
              models: { availableModelIds: ['deepseek-chat', 'boft-deepseek::deepseek-v4-flash'] },
            })),
            close: vi.fn(async () => undefined),
          };
        },
      }));

      const previousDshHome = process.env.DSH_HOME;
      process.env.DSH_HOME = path.join(aceHome, 'empty-dsh-home');
      try {
        const { GET } = await import('@/server/api-routes/engine/models/route');
        const response = await GET(makeRequest('/api/engine/models?engine=deepseek-harness'));
        expect(response.status).toBe(200);
        expect((await responseJson<{ models: any[] }>(response)).models).toEqual(expect.arrayContaining([
          expect.objectContaining({ modelId: 'deepseek-official/deepseek-chat[off]', endpoints: [] }),
          expect.objectContaining({ modelId: 'deepseek-official/deepseek-chat[high]', endpoints: [] }),
          expect.objectContaining({ modelId: 'deepseek-official/deepseek-chat[max]', endpoints: [] }),
          expect.objectContaining({
            modelId: 'boft-deepseek/deepseek-v4-flash[off]',
            name: 'boft-deepseek/deepseek-v4-flash (off)',
          }),
        ]));
        expect(runtimeOptions).toMatchObject({ cwd: process.cwd() });
        expect(ensureInput).toMatchObject({
          agent: 'deepseek-harness',
        });
        expect(ensureInput.sessionOptions?.env).toMatchObject({
          DSH_HOME: path.join(aceHome, 'empty-dsh-home'),
        });
      } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
      }
    });
  });

  test('DeepSeek model discovery includes models from the configured DSH settings providers', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      const dshHome = path.join(aceHome, 'user-dsh');
      await mkdir(dshHome, { recursive: true });
      await writeFile(path.join(dshHome, 'settings.yaml'), [
        'llm-pi-ai:',
        '  providers:',
        '    boft-deepseek:',
        '      models:',
        '        - id: deepseek-v4-flash',
        '          name: DeepSeek-V4-Flash',
        '        - id: deepseek-v4-pro',
        '          name: DeepSeek-V4-Pro',
        '    boft:',
        '      api: openai-responses',
        '      models:',
        '        - id: gpt-5.6-sol',
      ].join('\n'));
      vi.doMock('acpx/runtime', () => ({
        createAgentRegistry: () => ({}),
        createRuntimeStore: () => ({}),
        createAcpRuntime: () => ({
          ensureSession: vi.fn(async () => ({ sessionKey: 'settings-session', backend: 'acpx', runtimeSessionName: 'test' })),
          getStatus: vi.fn(async () => ({})),
          close: vi.fn(async () => undefined),
        }),
      }));

      const previousDshHome = process.env.DSH_HOME;
      process.env.DSH_HOME = dshHome;
      try {
        const { GET } = await import('@/server/api-routes/engine/models/route');
        const response = await GET(makeRequest('/api/engine/models?engine=deepseek-harness'));
        expect(response.status).toBe(200);
        const models = (await responseJson<{ models: Array<{ modelId: string; source?: string; endpoints?: string[] }> }>(response)).models;
        expect(models).toHaveLength(18);
        expect(models).toEqual(expect.arrayContaining([
          { modelId: 'boft-deepseek/deepseek-v4-flash[off]', name: 'DeepSeek-V4-Flash (off)', source: 'config', endpoints: ['deepseek'] },
          { modelId: 'boft-deepseek/deepseek-v4-flash[high]', name: 'DeepSeek-V4-Flash (high)', source: 'config', endpoints: ['deepseek'] },
          { modelId: 'boft-deepseek/deepseek-v4-flash[max]', name: 'DeepSeek-V4-Flash (max)', source: 'config', endpoints: ['deepseek'] },
          { modelId: 'boft/gpt-5.6-sol[off]', name: 'gpt-5.6-sol (off)', source: 'config', endpoints: ['openai'] },
          { modelId: 'deepseek-official/deepseek-v4-flash[max]', name: 'DeepSeek V4 Flash (max)', source: 'bundle', endpoints: ['deepseek'] },
        ]));
      } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
      }
    });
  });

  test('DeepSeek model discovery expands advertised reasoning efforts into route ids', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      vi.doMock('acpx/runtime', () => ({
        createAgentRegistry: () => ({}),
        createRuntimeStore: () => ({}),
        createAcpRuntime: () => ({
          ensureSession: vi.fn(async () => ({ sessionKey: 'effort-session', backend: 'acpx', runtimeSessionName: 'test' })),
          getStatus: vi.fn(async () => ({
            models: { availableModelIds: ['deepseek-v4-flash'] },
            configOptions: [{
              id: 'effort',
              category: 'thought_level',
              type: 'select',
              options: ['off', 'high', 'max'],
            }],
          })),
          close: vi.fn(async () => undefined),
        }),
      }));
      const previousDshHome = process.env.DSH_HOME;
      process.env.DSH_HOME = path.join(aceHome, 'empty-dsh-home');
      try {
        const { GET } = await import('@/server/api-routes/engine/models/route');
        const response = await GET(makeRequest('/api/engine/models?engine=deepseek-harness'));
        expect(response.status).toBe(200);
        const body = await responseJson<{ models: Array<{ modelId: string }> }>(response);
        expect(body.models.map((model) => model.modelId)).toContainEqual('deepseek-official/deepseek-v4-flash[off]');
        expect(body.models.map((model) => model.modelId)).toContainEqual('deepseek-official/deepseek-v4-flash[high]');
        expect(body.models.map((model) => model.modelId)).toContainEqual('deepseek-official/deepseek-v4-flash[max]');
      } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
      }
    });
  });

  test('DeepSeek model discovery falls back to product default models', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      vi.doMock('acpx/runtime', () => ({
        createAgentRegistry: () => ({}),
        createRuntimeStore: () => ({}),
        createAcpRuntime: () => ({
          ensureSession: vi.fn(async () => ({ sessionKey: 'fallback-session', backend: 'acpx', runtimeSessionName: 'test' })),
          getStatus: vi.fn(async () => ({})),
          close: vi.fn(async () => undefined),
        }),
      }));

      const previousDshHome = process.env.DSH_HOME;
      process.env.DSH_HOME = path.join(aceHome, 'empty-dsh-home');
      try {
        const { GET } = await import('@/server/api-routes/engine/models/route');
        const response = await GET(makeRequest('/api/engine/models?engine=deepseek-harness'));
        expect(response.status).toBe(200);
        const models = (await responseJson<{ models: Array<{ modelId: string; source?: string }> }>(response)).models;
        expect(models).toHaveLength(9);
        expect(models.map((model) => model.modelId)).toEqual([
          'deepseek-official/deepseek-v4-flash[off]',
          'deepseek-official/deepseek-v4-flash[high]',
          'deepseek-official/deepseek-v4-flash[max]',
          'deepseek-official/deepseek-v4-pro[off]',
          'deepseek-official/deepseek-v4-pro[high]',
          'deepseek-official/deepseek-v4-pro[max]',
          'deepseek-official/deepseek-v4-flash-vision-exp[off]',
          'deepseek-official/deepseek-v4-flash-vision-exp[high]',
          'deepseek-official/deepseek-v4-flash-vision-exp[max]',
        ]);
      } finally {
        if (previousDshHome === undefined) delete process.env.DSH_HOME;
        else process.env.DSH_HOME = previousDshHome;
      }
    });
  });

  test('POST imports models into SQLite and exports runtime YAML compatibility seed', async () => {
    await withTempDir('aceharness-test-install-', async (installRoot) => {
      await withIsolatedAceHome(async (aceHome) => {
        const previousInstallRoot = process.env.ACE_INSTALL_ROOT;
        process.env.ACE_INSTALL_ROOT = installRoot;

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
          const { POST } = await import('@/server/api-routes/models/route');
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
          const savedConfig = parse(await readFile(runtimeModelsPath, 'utf-8')) as { catalog?: Array<{ id: string }> };
          expect(savedConfig.catalog?.map((model) => model.id)).toEqual(['bundled-a']);

          vi.resetModules();
          const { GET } = await import('@/server/api-routes/models/route');
          const reloadResponse = await GET();
          expect(reloadResponse.status).toBe(200);

          const reloadBody = await responseJson<{ models: Array<{ value: string; modelRouteId: string | null }> }>(reloadResponse);
          expect(reloadBody.models.map((model) => model.value)).toEqual(['bundled-a']);
          expect(reloadBody.models[0]?.modelRouteId).toBeNull();

          const exported = parse(await readFile(runtimeModelsPath, 'utf-8')) as { catalog?: any[]; routes?: any[] };
          expect(exported.catalog?.map((model) => model.id)).toEqual(['bundled-a']);
          expect(exported.routes).toEqual([]);
        } finally {
          if (previousInstallRoot === undefined) delete process.env.ACE_INSTALL_ROOT;
          else process.env.ACE_INSTALL_ROOT = previousInstallRoot;
        }
      });
    });
  });

  test('SQLite POST replacement does not restore deleted runtime routes from old YAML', async () => {
    await withTempDir('aceharness-test-install-', async (installRoot) => {
      await withIsolatedAceHome(async (aceHome) => {
        const previousInstallRoot = process.env.ACE_INSTALL_ROOT;
        process.env.ACE_INSTALL_ROOT = installRoot;

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
          const { POST } = await import('@/server/api-routes/models/route');
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
            routes?: Array<{ modelId: string; agentId?: string; modelRouteId?: string; providerId?: string }>;
          };
          expect(savedConfig.routes?.map((route) => route.agentId)).toEqual(['opencode']);
          expect(savedConfig.routes?.map((route) => route.providerId)).toEqual([undefined]);

          vi.resetModules();
          const { GET } = await import('@/server/api-routes/models/route');
          const reloadResponse = await GET();
          const reloadBody = await responseJson<{ models: Array<{ value: string; agentId?: string; modelRouteId?: string }> }>(reloadResponse);
          expect(reloadBody.models.map((model) => model.agentId)).toEqual(['opencode']);
          expect(reloadBody.models[0]?.modelRouteId).toContain('opencode__shared-model');
        } finally {
          if (previousInstallRoot === undefined) delete process.env.ACE_INSTALL_ROOT;
          else process.env.ACE_INSTALL_ROOT = previousInstallRoot;
        }
      });
    });
  });

  test('probe route accepts modelRouteId DTO and returns modelRouteId', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const createdInputs: any[] = [];
      vi.doMock('@/lib/auth/middleware', () => ({
        requireAdmin: vi.fn(async () => ({
          id: 'admin',
          username: 'admin',
          email: 'admin@example.test',
          role: 'admin',
          personalDir: '',
        })),
        requireAuth: vi.fn(async () => ({
          id: 'admin',
          username: 'admin',
          email: 'admin@example.test',
          role: 'admin',
          personalDir: '',
        })),
      }));
      vi.doMock('@/lib/models/probes', () => ({
        createModelProbe: vi.fn(async (input: any) => {
          createdInputs.push(input);
          return {
            id: 'probe-1',
            groupId: 'group-1',
            groupName: 'Group',
            name: 'Probe',
            engine: input.engine,
            engineLabel: input.engine,
            model: input.model,
            endpoints: input.endpoints,
            intervalMinutes: 5,
            timeoutMs: 45000,
            enabled: true,
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
            running: false,
            status: 'unknown',
            consecutiveFailures: 0,
            nextRunAt: null,
            latestRun: null,
            availability: { days7: {}, days15: {}, days30: {} },
            averageResponseLatencyMs: null,
            averageAvailabilityCheckMs: null,
            history: [],
          };
        }),
        listModelProbes: vi.fn(async () => ({ probes: [], summary: { total: 0 } })),
      }));

      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex',
          isDefault: true,
        });
      } finally {
        db.close();
      }

      const { POST } = await import('@/server/api-routes/models/probes/route');
      const response = await POST(makeRequest('/api/models/probes', {
        json: { modelRouteId: 'route-codex-gpt', name: 'Probe' },
      }));
      expect(response.status).toBe(200);
      expect(createdInputs[0]).toMatchObject({
        modelRouteId: 'route-codex-gpt',
        engine: 'codex',
        model: 'gpt-5.3-codex',
        endpoints: ['openai'],
      });
      const body = await responseJson<{ probe: any }>(response);
      expect(body.probe.modelRouteId).toBe('route-codex-gpt');
    });
  });

  test('model probe service persists modelRouteId and resolves route display fields', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doUnmock('@/lib/models/probes');
      vi.doUnmock('@/lib/auth/middleware');
      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex-provider',
          isDefault: true,
        });
      } finally {
        db.close();
      }

      const { createModelProbe } = await import('@/lib/models/probes');
      const probe = await createModelProbe({ modelRouteId: 'route-codex-gpt', name: 'Route Probe' });
      expect(probe).toMatchObject({
        modelRouteId: 'route-codex-gpt',
        engine: 'codex',
        model: 'gpt-5.3-codex-provider',
        endpoints: ['openai'],
      });

      const persisted = JSON.parse(await readFile(getWorkspaceDataFile('model-probes.json'), 'utf-8')) as any[];
      expect(persisted[0]).toMatchObject({
        modelRouteId: 'route-codex-gpt',
        engine: 'codex',
        model: 'gpt-5.3-codex-provider',
        endpoints: ['openai'],
      });
    });
  });

  test('model probe query filters by persisted modelRouteId', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doUnmock('@/lib/models/probes');
      vi.doMock('@/lib/auth/middleware', () => ({
        requireAuth: vi.fn(async () => ({
          id: 'admin',
          username: 'admin',
          email: 'admin@example.test',
          role: 'admin',
          personalDir: '',
        })),
      }));

      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelCatalogEntry(db, { id: 'claude-4.2', displayName: 'Claude 4.2' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelProvider(db, { id: 'anthropic', kind: 'anthropic', displayName: 'Anthropic' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex',
        });
        upsertModelRoute(db, {
          id: 'route-claude-sonnet',
          modelId: 'claude-4.2',
          agentId: 'claude-code',
          providerId: 'anthropic',
          providerModel: 'claude-sonnet-4.2',
        });
      } finally {
        db.close();
      }

      const { createModelProbe } = await import('@/lib/models/probes');
      await createModelProbe({ modelRouteId: 'route-codex-gpt', name: 'Codex Probe' });
      await createModelProbe({ modelRouteId: 'route-claude-sonnet', name: 'Claude Probe' });

      const { GET } = await import('@/server/api-routes/models/probes/query/route');
      const response = await GET(makeRequest('/api/models/probes/query?modelRouteId=route-codex-gpt'));
      expect(response.status).toBe(200);
      const body = await responseJson<{ probes: any[]; filters: any }>(response);
      expect(body.filters.modelRouteId).toBe('route-codex-gpt');
      expect(body.probes.map((probe) => probe.modelRouteId)).toEqual(['route-codex-gpt']);
      expect(body.probes[0]?.name).toBe('Codex Probe');
    });
  });

  test('model probe observation updates by modelRouteId before preRuntime engine/model', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doUnmock('@/lib/models/probes');
      vi.doUnmock('@/lib/auth/middleware');
      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex',
        });
      } finally {
        db.close();
      }

      const { createModelProbe, recordModelProbeObservation, listModelProbes } = await import('@/lib/models/probes');
      await createModelProbe({ modelRouteId: 'route-codex-gpt', name: 'Route Probe' });
      const updatedCount = await recordModelProbeObservation({
        modelRouteId: 'route-codex-gpt',
        engine: 'wrong-engine',
        model: 'wrong-model',
        success: true,
        responseLatencyMs: 123,
        source: 'agent-chat',
      });
      expect(updatedCount).toBe(1);

      const data = await listModelProbes();
      expect(data.probes[0]?.latestRun).toMatchObject({
        success: true,
        responseLatencyMs: 123,
        source: 'agent-chat',
        resolvedModel: 'gpt-5.3-codex',
      });
    });
  });

  test('model probe create and update resolve modelRouteId while preRuntime input remains compatible', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doUnmock('@/lib/models/probes');
      vi.doUnmock('@/lib/auth/middleware');
      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelCatalogEntry(db, { id: 'claude-4.2', displayName: 'Claude 4.2' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelProvider(db, { id: 'anthropic', kind: 'anthropic', displayName: 'Anthropic' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex-provider',
        });
        upsertModelRoute(db, {
          id: 'route-claude-sonnet',
          modelId: 'claude-4.2',
          agentId: 'claude-code',
          providerId: 'anthropic',
          providerModel: 'claude-sonnet-4.2',
        });
      } finally {
        db.close();
      }

      const { createModelProbe, updateModelProbe } = await import('@/lib/models/probes');
      const preRuntime = await createModelProbe({ engine: 'preRuntime-engine', model: 'preRuntime-model', name: 'preRuntime Probe' });
      expect(preRuntime).toMatchObject({
        engine: 'preRuntime-engine',
        model: 'preRuntime-model',
      });
      expect(preRuntime.modelRouteId).toBeUndefined();

      const routeBacked = await updateModelProbe(preRuntime.id, { modelRouteId: 'route-codex-gpt' });
      expect(routeBacked).toMatchObject({
        modelRouteId: 'route-codex-gpt',
        engine: 'codex',
        model: 'gpt-5.3-codex-provider',
        endpoints: ['openai'],
      });

      const preRuntimeResolved = await createModelProbe({ engine: 'claude-code', model: 'claude-4.2', name: 'Resolved preRuntime Probe' });
      expect(preRuntimeResolved).toMatchObject({
        modelRouteId: 'route-claude-sonnet',
        engine: 'claude-code',
        model: 'claude-sonnet-4.2',
        endpoints: ['anthropic'],
      });
    });
  });

  test('model probe execution resolves runtime identity from modelRouteId', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      vi.doUnmock('@/lib/models/probes');
      vi.doUnmock('@/lib/auth/middleware');
      const executedModels: any[] = [];
      vi.doMock('@/lib/models/diagnostics-runtime-bridge', async () => {
        const actual = await vi.importActual<any>('@/lib/models/diagnostics-runtime-bridge');
        return {
          ...actual,
          runRuntimeDiagnosticPrompt: vi.fn(async (input: any) => {
            executedModels.push(input.model);
            return {
              success: true,
              output: 'OK',
              metadata: { resolvedModel: input.model },
              events: [{ type: 'text', content: 'OK' }],
            };
          }),
        };
      });

      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' });
        upsertModelProvider(db, { id: 'openai', kind: 'openai', displayName: 'OpenAI' });
        upsertModelRoute(db, {
          id: 'route-codex-gpt',
          modelId: 'gpt-5.3-codex',
          agentId: 'codex',
          providerId: 'openai',
          providerModel: 'gpt-5.3-codex-provider',
        });
      } finally {
        db.close();
      }

      const { createModelProbe, runModelProbe } = await import('@/lib/models/probes');
      const probe = await createModelProbe({
        modelRouteId: 'route-codex-gpt',
        engine: 'wrong-engine',
        model: 'wrong-model',
        name: 'Route Probe',
      });
      const run = await runModelProbe(probe.id, { force: true });
      expect(executedModels).toEqual(['gpt-5.3-codex-provider']);
      expect(run.latestRun?.resolvedModel).toBe('gpt-5.3-codex-provider');
    });
  });
});
