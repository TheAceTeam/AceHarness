import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(_req);
    if (user instanceof NextResponse) return user;

    await scheduler.init();
    const { id } = await params;
    const job = await scheduler.toggleJob(id);
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '切换定时任务状态失败' }, { status: 400 });
  }
}
