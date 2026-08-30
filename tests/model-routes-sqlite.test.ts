import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { ensureModelRouteSchema } from '@/lib/runtime-agent/models/model-route-schema';
import {
  importModelRoutes,
  resolveModelRoute,
  upsertModelCatalogEntry,
  upsertModelProvider,
  upsertModelRoute,
} from '@/lib/runtime-agent/models/model-routes';
import {
  exportModelRoutesYamlSeed,
  importModelRoutesYamlSeed,
  parseModelRoutesYamlSeed,
} from '@/lib/runtime-agent/models/models-yaml-seed';

function makeDb(): RuntimeSqliteDatabase {
  const db = openRuntimeSqliteDatabase(':memory:');
  ensureModelRouteSchema(db);
  return db;
}

function seedBasicCatalog(db: RuntimeSqliteDatabase): void {
  upsertModelCatalogEntry(db, {
    id: 'gpt-5.3-codex',
    displayName: 'GPT 5.3 Codex',
    now: '2026-07-09T00:00:00.000Z',
  });
  upsertModelProvider(db, {
    id: 'openai',
    kind: 'openai',
    displayName: 'OpenAI',
    now: '2026-07-09T00:00:00.000Z',
  });
}

describe('model routes sqlite migration', () => {
  test('creates model route tables and default route partial unique index', () => {
    const db = makeDb();
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_catalog'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'model_discovery_cache'").get()).toBeTruthy();
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_model_routes_one_default_per_agent_model'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  test('rejects multiple active defaults for the same agent and model', () => {
    const db = makeDb();
    try {
      seedBasicCatalog(db);
      upsertModelRoute(db, {
        id: 'route-a',
        modelId: 'gpt-5.3-codex',
        agentId: 'codex',
        providerId: 'openai',
        providerModel: 'gpt-5.3-codex',
        isDefault: true,
        now: '2026-07-09T00:00:00.000Z',
      });

      expect(() => upsertModelRoute(db, {
        id: 'route-b',
        modelId: 'gpt-5.3-codex',
        agentId: 'codex',
        providerId: 'openai',
        providerModel: 'gpt-5.3-codex-fast',
        isDefault: true,
        now: '2026-07-09T00:00:00.000Z',
      })).toThrow();
    } finally {
      db.close();
    }
  });

  test('resolves explicit modelRouteId without old engine or model option inputs', () => {
    const db = makeDb();
    try {
      seedBasicCatalog(db);
      upsertModelRoute(db, {
        id: 'route-codex-gpt',
        modelId: 'gpt-5.3-codex',
        agentId: 'codex',
        providerId: 'openai',
        providerModel: 'gpt-5.3-codex',
        configOptions: { reasoning: 'medium' },
        capabilities: { streaming: true, toolCalls: true },
        isDefault: true,
        now: '2026-07-09T00:00:00.000Z',
      });

      expect(resolveModelRoute(db, { modelRouteId: 'route-codex-gpt' })).toMatchObject({
        modelRouteId: 'route-codex-gpt',
        modelId: 'gpt-5.3-codex',
        agentId: 'codex',
        providerModel: 'gpt-5.3-codex',
        configOptions: { reasoning: 'medium' },
      });
    } finally {
      db.close();
    }
  });

  test('resolves deterministic fallback by default, priority, verifiedAt, and id', () => {
    const db = makeDb();
    try {
      seedBasicCatalog(db);
      importModelRoutes(db, {
        catalog: [],
        routes: [
          {
            id: 'route-z',
            modelId: 'gpt-5.3-codex',
            agentId: 'codex',
            providerModel: 'z',
            priority: 10,
            verifiedAt: '2026-07-08T00:00:00.000Z',
          },
          {
            id: 'route-a',
            modelId: 'gpt-5.3-codex',
            agentId: 'codex',
            providerModel: 'a',
            priority: 10,
            verifiedAt: '2026-07-08T00:00:00.000Z',
          },
          {
            id: 'route-newer',
            modelId: 'gpt-5.3-codex',
            agentId: 'codex',
            providerModel: 'newer',
            priority: 10,
            verifiedAt: '2026-07-09T00:00:00.000Z',
          },
          {
            id: 'route-default',
            modelId: 'gpt-5.3-codex',
            agentId: 'codex',
            providerModel: 'default',
            priority: 100,
            isDefault: true,
          },
        ],
      });

      expect(resolveModelRoute(db, { agentId: 'codex', modelId: 'gpt-5.3-codex' }).modelRouteId)
        .toBe('route-default');

      db.prepare("UPDATE model_routes SET is_default = 0 WHERE id = 'route-default'").run();
      expect(resolveModelRoute(db, { agentId: 'codex', modelId: 'gpt-5.3-codex' }).modelRouteId)
        .toBe('route-newer');

      db.prepare("UPDATE model_routes SET verified_at = '2026-07-08T00:00:00.000Z' WHERE id = 'route-newer'").run();
      expect(resolveModelRoute(db, { agentId: 'codex', modelId: 'gpt-5.3-codex' }).modelRouteId)
        .toBe('route-a');
    } finally {
      db.close();
    }
  });

  test('imports preRuntime models yaml as seed data using agentId and modelRouteId', () => {
    const yaml = `
models:
  - value: gpt-5.3-codex[reasoning=medium,fast=false]
    label: GPT 5.3 Codex
    costMultiplier: 0.05
    endpoints:
      - openai
    engines:
      - codex
      - claude-code
`;
    const parsed = parseModelRoutesYamlSeed(yaml, '2026-07-09T00:00:00.000Z');
    expect(parsed.catalog[0]).toMatchObject({
      id: 'gpt-5.3-codex[reasoning=medium,fast=false]',
      displayName: 'GPT 5.3 Codex',
    });
    expect(parsed.routes.map((route) => route.agentId).sort()).toEqual(['claude', 'codex']);
    expect(parsed.routes[0]).toMatchObject({
      providerId: 'openai',
      providerModel: 'gpt-5.3-codex',
      configOptions: { reasoning: 'medium', fast: false },
    });

    const db = makeDb();
    try {
      const result = importModelRoutesYamlSeed(db, yaml, '2026-07-09T00:00:00.000Z');
      expect(result).toMatchObject({ catalogCount: 1, providerCount: 1, routeCount: 2 });
      expect(resolveModelRoute(db, {
        modelRouteId: 'codex__gpt-5-3-codex-reasoning-medium-fast-false__openai',
      })).toMatchObject({
        agentId: 'codex',
        providerModel: 'gpt-5.3-codex',
      });
    } finally {
      db.close();
    }
  });

  test('keeps advertised bracket model ids without key-value options intact', () => {
    const yaml = `
models:
  - value: gpt-5.5[low]
    label: GPT 5.5 Low
    endpoints:
      - openai
    engines:
      - codex
`;
    const parsed = parseModelRoutesYamlSeed(yaml, '2026-07-09T00:00:00.000Z');
    expect(parsed.catalog[0]).toMatchObject({
      id: 'gpt-5.5[low]',
      displayName: 'GPT 5.5 Low',
    });
    expect(parsed.routes[0]).toMatchObject({
      modelId: 'gpt-5.5[low]',
      agentId: 'codex',
      providerId: 'openai',
      providerModel: 'gpt-5.5[low]',
      configOptions: {},
    });
  });

  test('keeps provider-qualified catalog ids while routing the bare provider model', () => {
    const yaml = `
models:
  - value: boft-deepseek/deepseek-v4-flash
    label: DeepSeek V4 Flash
    endpoints:
      - deepseek
    engines:
      - deepseek-harness
`;
    const parsed = parseModelRoutesYamlSeed(yaml, '2026-07-09T00:00:00.000Z');
    expect(parsed.catalog[0]).toMatchObject({
      id: 'boft-deepseek/deepseek-v4-flash',
      metadata: { endpoints: ['deepseek'] },
    });
    expect(parsed.routes[0]).toMatchObject({
      modelId: 'boft-deepseek/deepseek-v4-flash',
      providerId: 'boft-deepseek',
      providerModel: 'deepseek-v4-flash',
      agentId: 'deepseek-harness',
    });
  });

  test('preserves an explicitly empty endpoint list during migration', () => {
    const yaml = `
models:
  - value: deepseek-chat
    label: DeepSeek Chat
    endpoints: []
    engines:
      - deepseek-harness
`;
    const parsed = parseModelRoutesYamlSeed(yaml, '2026-07-09T00:00:00.000Z');
    expect(parsed.catalog[0]?.metadata).toMatchObject({ endpoints: [] });
    expect(parsed.routes).toEqual([expect.objectContaining({
      modelId: 'deepseek-chat',
      agentId: 'deepseek-harness',
      providerId: undefined,
      providerModel: 'deepseek-chat',
    })]);
  });

  test('bundled default model catalog is empty until users import available models', async () => {
    const source = await readFile(path.join(process.cwd(), 'configs', 'models', 'models.yaml'), 'utf-8');
    const parsed = parseModelRoutesYamlSeed(source, '2026-07-09T00:00:00.000Z');
    expect(parsed.catalog).toEqual([]);
    expect(parsed.providers).toEqual([]);
    expect(parsed.routes).toEqual([]);
  });

  test('exports model routes yaml without preRuntime engine fields', () => {
    const db = makeDb();
    try {
      seedBasicCatalog(db);
      upsertModelRoute(db, {
        id: 'route-codex-gpt',
        modelId: 'gpt-5.3-codex',
        agentId: 'codex',
        providerId: 'openai',
        providerModel: 'gpt-5.3-codex',
        isDefault: true,
        now: '2026-07-09T00:00:00.000Z',
      });

      const exported = exportModelRoutesYamlSeed(db);
      expect(exported).toContain('modelRouteId: route-codex-gpt');
      expect(exported).toContain('agentId: codex');
      expect(exported).not.toContain('engines:');
    } finally {
      db.close();
    }
  });
});
