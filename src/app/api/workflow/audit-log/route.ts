import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { readWorkflowAuditEvents } from '@/lib/workflow/audit-log';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const runId = request.nextUrl.searchParams.get('runId') || '';
  if (!runId) {
    return NextResponse.json({ error: '缺少 runId 参数' }, { status: 400 });
  }

  const runState = await loadRunState(runId);
  if (!runState) {
    return NextResponse.json({ error: `找不到运行记录: ${runId}` }, { status: 404 });
  }
  if (!canAccessRunState(auth, runState)) {
    return NextResponse.json({ error: '无权访问该工作流审计日志' }, { status: 403 });
  }

  const limit = Number(request.nextUrl.searchParams.get('limit') || 500);
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 500, 2000));
  const events = await readWorkflowAuditEvents(runId, { limit: safeLimit });
  return NextResponse.json({ runId, events });
}
