import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { runModelProbes } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : undefined;
    const result = await runModelProbes({
      ids,
      dueOnly: body?.dueOnly === true,
      force: body?.force === true,
    });
    return NextResponse.json({
      success: true,
      executed: result.executed,
      skipped: result.skipped,
      ...result.data,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run model probes' },
      { status: 500 },
    );
  }
}
