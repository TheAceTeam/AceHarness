import { requestUrl, jsonOk } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';

export const dynamic = 'force-dynamic';

const TEXT_PREVIEW_LIMIT = 4000;

function compactText(value: unknown, limit = TEXT_PREVIEW_LIMIT) {
  if (typeof value !== 'string') return value;
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n\n[已截断 ${value.length - limit} 字]`;
}

function compactStepLog(log: any) {
  if (!log) return log;
  return {
    ...log,
    output: compactText(log.output),
    error: compactText(log.error, 2000),
    childSummary: compactText(log.childSummary, 1600),
  };
}

function readPaging(request: Request) {
  const offset = Number(requestUrl(request).searchParams.get('offset') || 0);
  const limit = Number(requestUrl(request).searchParams.get('limit') || 100);
  return {
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100,
  };
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const runId = requestUrl(request).searchParams.get('runId') || '';
  if (!runId) {
    return jsonOk({ error: '缺少 runId 参数' }, { status: 400 });
  }

  const runState = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!runState) {
    return jsonOk({ error: '运行记录不存在' }, { status: 404 });
  }
  if (!canAccessRunState(auth, runState)) {
    return jsonOk({ error: '无权访问该工作流步骤日志' }, { status: 403 });
  }

  const { offset, limit } = readPaging(request);
  const allItems = Array.isArray(runState.stepLogs) ? runState.stepLogs : [];
  const items = allItems.slice(offset, offset + limit).map(compactStepLog);

  return jsonOk({
    runId,
    items,
    pagination: {
      offset,
      limit,
      total: allItems.length,
      nextOffset: offset + items.length < allItems.length ? offset + items.length : null,
    },
  });
}
