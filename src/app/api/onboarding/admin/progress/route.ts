import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { listOnboardingSummary } from '@/lib/core/onboarding-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const rows = await listOnboardingSummary();
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return NextResponse.json({ rows, total: rows.length });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取引导完成情况失败' }, { status: 500 });
  }
}
