import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { deleteModelProbe, getModelProbe, updateModelProbe } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

function readHistoryLimit(value: string | null): number | undefined {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const probe = await getModelProbe(id, readHistoryLimit(request.nextUrl.searchParams.get('historyLimit')));
    if (!probe) {
      return NextResponse.json({ error: 'Probe not found' }, { status: 404 });
    }
    return NextResponse.json({ probe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load model probe' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const probe = await updateModelProbe(id, body || {});
    return NextResponse.json({ success: true, probe });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update model probe';
    return NextResponse.json(
      { error: message },
      { status: message.includes('不存在') || message.includes('not found') ? 404 : 400 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const success = await deleteModelProbe(id);
    if (!success) {
      return NextResponse.json({ error: 'Probe not found' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete model probe' },
      { status: 500 },
    );
  }
}
