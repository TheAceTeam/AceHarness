import { describe, expect, test, vi } from 'vitest';

const resolveRuntimeModelRoute = vi.hoisted(() => vi.fn());
const listRuntimeModelsFromSqlite = vi.hoisted(() => vi.fn(() => ({ routes: [] })));

vi.mock('@/lib/runtime-agent/models/model-routes-api', () => ({
  resolveRuntimeModelRoute,
  listRuntimeModelsFromSqlite,
}));

import { normalizeProbeInputForModelRouteId } from '@/server/api-routes/models/probes/model-route-probe-dto';

describe('model route probe DTO', () => {
  test('uses catalog endpoints instead of a custom provider id', () => {
    resolveRuntimeModelRoute.mockReturnValue({
      modelRouteId: 'route-boft',
      agentId: 'deepseek-harness',
      providerId: 'boft-deepseek',
      providerModel: 'deepseek-v4-flash',
      endpoints: ['deepseek'],
    });

    expect(normalizeProbeInputForModelRouteId({ modelRouteId: 'route-boft' })).toMatchObject({
      engine: 'deepseek-harness',
      model: 'deepseek-v4-flash',
      endpoints: ['deepseek'],
    });
  });

  test('retains legacy API provider fallback for old routes', () => {
    resolveRuntimeModelRoute.mockReturnValue({
      modelRouteId: 'route-openai',
      agentId: 'codex',
      providerId: 'openai',
      providerModel: 'gpt-5.5',
    });

    expect(normalizeProbeInputForModelRouteId({ modelRouteId: 'route-openai' }).endpoints)
      .toEqual(['openai']);
  });
});
