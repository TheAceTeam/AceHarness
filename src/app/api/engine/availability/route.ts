import { NextResponse } from 'next/server';
import { getEngineAvailabilityReport, isEngineAvailable, resolveEffectiveEngine } from '@/lib/engines/engine-factory';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const engineType = searchParams.get('engine');

    if (!engineType) {
      return NextResponse.json({ error: 'Engine type is required' }, { status: 400 });
    }

    const driver = searchParams.get('driver');
    if (driver === 'sdk' || driver === 'stdio') {
      const effectiveEngine = resolveEffectiveEngine(engineType, driver) || engineType;
      const available = await isEngineAvailable(effectiveEngine as any);

      return NextResponse.json({
        engine: engineType,
        driver,
        effectiveEngine,
        available,
      });
    }

    const report = await getEngineAvailabilityReport(engineType);

    return NextResponse.json({
      ...report,
    });
  } catch (error) {
    console.error('Failed to check engine availability:', error);
    return NextResponse.json({
      error: 'Failed to check engine availability',
      available: false
    }, { status: 500 });
  }
}
