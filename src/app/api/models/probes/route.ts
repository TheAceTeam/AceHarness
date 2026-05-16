import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { createModelProbe, listModelProbes } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function readHistoryLimit(value: string | null): number | undefined {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const refreshDue = isTruthy(searchParams.get('refresh'));
    const forceRunAll = isTruthy(searchParams.get('force'));
    if ((refreshDue || forceRunAll) && auth.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可触发探针刷新' }, { status: 403 });
    }
    const data = await listModelProbes({
      refreshDue,
      forceRunAll,
      historyLimit: readHistoryLimit(searchParams.get('historyLimit')),
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load model probes' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json().catch(() => ({}));
    const probe = await createModelProbe(body || {});
    return NextResponse.json({ success: true, probe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create model probe' },
      { status: 400 },
    );
  }
}
