import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getWorkflowEventStore } from '@/lib/workflow/event-store';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const runId = request.nextUrl.searchParams.get('runId') || '';
  if (!runId) {
    return NextResponse.json({ error: '缺少 runId 参数' }, { status: 400 });
  }

  const runState = await loadRunState(runId);
  if (runState && !canAccessRunState(auth, runState)) {
    return NextResponse.json({ error: '无权访问该工作流事件日志' }, { status: 403 });
  }

  const afterSeq = Number(request.nextUrl.searchParams.get('afterSeq') || 0);
  const limit = Number(request.nextUrl.searchParams.get('limit') || 500);
  const events = await getWorkflowEventStore().read(runId, {
    afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
    limit: Number.isFinite(limit) ? limit : 500,
  });

  return NextResponse.json({
    runId,
    events,
    nextSeq: events.length > 0 ? events[events.length - 1].seq : afterSeq,
  });
}
