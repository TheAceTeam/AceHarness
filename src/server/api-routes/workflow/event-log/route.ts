import { requestUrl, jsonOk } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { getWorkflowEventStore } from '@/lib/workflow/event-store';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { compactWorkflowEventPayloadForLive } from '@/lib/workflow/live-status';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const runId = requestUrl(request).searchParams.get('runId') || '';
  if (!runId) {
    return jsonOk({ error: '缺少 runId 参数' }, { status: 400 });
  }

  const runState = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (runState && !canAccessRunState(auth, runState)) {
    return jsonOk({ error: '无权访问该工作流事件日志' }, { status: 403 });
  }

  const afterSeq = Number(requestUrl(request).searchParams.get('afterSeq') || 0);
  const limit = Number(requestUrl(request).searchParams.get('limit') || 500);
  const events = await getWorkflowEventStore().read(runId, {
    afterSeq: Number.isFinite(afterSeq) ? afterSeq : 0,
    limit: Number.isFinite(limit) ? limit : 500,
  });
  const compactEvents = events.map((event: any) => ({
    ...event,
    data: compactWorkflowEventPayloadForLive(event.data ?? event.payload),
    payload: compactWorkflowEventPayloadForLive(event.payload ?? event.data),
  }));

  return jsonOk({
    runId,
    events: compactEvents,
    nextSeq: compactEvents.length > 0 ? compactEvents[compactEvents.length - 1].seq : afterSeq,
  });
}
