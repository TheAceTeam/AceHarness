import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req);
    if (user instanceof NextResponse) return user;

    await scheduler.init();
    const { id } = await params;
    const result = await scheduler.triggerNow(id, user, { baseUrl: req.nextUrl.origin });
    if (result.status !== 'started') {
      return NextResponse.json(
        { success: false, ...result, error: result.error || '触发定时任务失败' },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '触发定时任务失败' }, { status: 400 });
  }
}
