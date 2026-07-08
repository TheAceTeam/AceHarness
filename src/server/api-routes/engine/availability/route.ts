import { getEngineAvailabilityCacheTtlMs, getEngineAvailabilityReport, isEngineAvailable, resolveEffectiveEngine } from '@/lib/engines/engine-factory';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const engineType = searchParams.get('engine');
    const forceRefresh = searchParams.get('refresh') === '1';
    const cacheTtlMs = await getEngineAvailabilityCacheTtlMs(forceRefresh);

    if (!engineType) {
      return jsonError('Engine type is required', 400);
    }

    const driver = searchParams.get('driver');
    if (driver === 'sdk' || driver === 'stdio') {
      const effectiveEngine = resolveEffectiveEngine(engineType, driver) || engineType;
      const available = await isEngineAvailable(effectiveEngine as any, { forceRefresh });

      return jsonOk({
        engine: engineType,
        driver,
        effectiveEngine,
        available,
        cacheTtlMs,
      });
    }

    const report = await getEngineAvailabilityReport(engineType, { forceRefresh });

    return jsonOk({
      ...report,
      cacheTtlMs,
    });
  } catch (error) {
    console.error('Failed to check engine availability:', error);
    return jsonOk({
      error: 'Failed to check engine availability',
      available: false
    }, { status: 500 });
  }
}
