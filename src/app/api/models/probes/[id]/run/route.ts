import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { runModelProbe } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const probe = await runModelProbe(id, { force: body?.force === true });
    return NextResponse.json({ success: true, probe });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run model probe';
    return NextResponse.json(
      { error: message },
      { status: message.includes('不存在') || message.includes('not found') ? 404 : 500 },
    );
  }
}
