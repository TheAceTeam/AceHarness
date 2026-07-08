import { requestUrl, jsonOk } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { readWorkflowAuditEvents } from '@/lib/workflow/audit-log';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const runId = requestUrl(request).searchParams.get('runId') || '';
  if (!runId) {
    return jsonOk({ error: '缺少 runId 参数' }, { status: 400 });
  }

  const runState = await loadRunState(runId);
  if (!runState) {
    return jsonOk({ error: `找不到运行记录: ${runId}` }, { status: 404 });
  }
  if (!canAccessRunState(auth, runState)) {
    return jsonOk({ error: '无权访问该工作流审计日志' }, { status: 403 });
  }

  const limit = Number(requestUrl(request).searchParams.get('limit') || 500);
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 500, 2000));
  const events = await readWorkflowAuditEvents(runId, { limit: safeLimit });
  return jsonOk({ runId, events });
}
