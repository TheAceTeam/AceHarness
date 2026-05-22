import { NextResponse } from 'next/server';
import { getEngineAvailabilityCacheTtlMs, getEngineAvailabilityReport, isEngineAvailable, resolveEffectiveEngine } from '@/lib/engines/engine-factory';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const engineType = searchParams.get('engine');
    const forceRefresh = searchParams.get('refresh') === '1';
    const cacheTtlMs = await getEngineAvailabilityCacheTtlMs(forceRefresh);

    if (!engineType) {
      return NextResponse.json({ error: 'Engine type is required' }, { status: 400 });
    }

    const driver = searchParams.get('driver');
    if (driver === 'sdk' || driver === 'stdio') {
      const effectiveEngine = resolveEffectiveEngine(engineType, driver) || engineType;
      const available = await isEngineAvailable(effectiveEngine as any, { forceRefresh });

      return NextResponse.json({
        engine: engineType,
        driver,
        effectiveEngine,
        available,
        cacheTtlMs,
      });
    }

    const report = await getEngineAvailabilityReport(engineType, { forceRefresh });

    return NextResponse.json({
      ...report,
      cacheTtlMs,
    });
  } catch (error) {
    console.error('Failed to check engine availability:', error);
    return NextResponse.json({
      error: 'Failed to check engine availability',
      available: false
    }, { status: 500 });
  }
}
