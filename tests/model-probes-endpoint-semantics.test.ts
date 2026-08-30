import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

describe('model probe endpoint semantics', () => {
  test('uses catalog API endpoints instead of provider IDs for provider-qualified routes', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
      const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
      const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
      const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
      try {
        upsertModelCatalogEntry(db, {
          id: 'boft-deepseek/deepseek-v4-flash',
          displayName: 'DeepSeek V4 Flash',
          metadata: { endpoints: ['deepseek'] },
        });
        upsertModelProvider(db, {
          id: 'boft-deepseek',
          kind: 'custom',
          displayName: 'BOFT DeepSeek',
        });
        upsertModelRoute(db, {
          id: 'route-deepseek-flash',
          modelId: 'boft-deepseek/deepseek-v4-flash',
          agentId: 'deepseek-harness',
          providerId: 'boft-deepseek',
          providerModel: 'deepseek-v4-flash',
          isDefault: true,
        });
      } finally {
        db.close();
      }

      const { createModelProbe } = await import('@/lib/models/probes');
      const probe = await createModelProbe({
        modelRouteId: 'route-deepseek-flash',
        name: 'DeepSeek probe',
      });

      expect(probe).toMatchObject({
        modelRouteId: 'route-deepseek-flash',
        engine: 'deepseek-harness',
        model: 'deepseek-v4-flash',
        endpoints: ['deepseek'],
      });
    });
  });
});
