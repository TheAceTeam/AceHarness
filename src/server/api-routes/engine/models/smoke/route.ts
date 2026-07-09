import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

const DEFAULT_MODELS = ['default', 'best', 'sonnet', 'opus', 'haiku', 'opusplan'];

/**
 * Migration-only smoke route. New model metadata and routing should use
 * /api/models plus runtime model routes and /api/models/probes. No old-architecture
 * wrapper smoke execution is performed here.
 */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const requestedModels = Array.isArray(body?.models) ? body.models : DEFAULT_MODELS;
    const models = requestedModels
      .map((item: unknown) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 10);

    if (models.length === 0) {
      return jsonError('models is required', 400);
    }

    const results = models.map((model) => ({
      model,
      ok: false,
      error: 'Pre-runtime engine smoke tests have moved to runtime model probes.',
      durationMs: 0,
      skipped: true,
    }));

    return jsonOk({
      engine: '',
      migrationOnly: true,
      canonicalRoute: '/api/models/probes',
      source: 'migration-only-empty-compat',
      results,
    });
  } catch (error) {
    return jsonError(errorMessage(error), 500);
  }
}
