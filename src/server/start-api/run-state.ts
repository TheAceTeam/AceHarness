import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { requireStartAuth } from './auth';

export async function loadAuthorizedRunState(request: Request, runId: string) {
  const auth = await requireStartAuth(request);
  if (auth instanceof Response) return auth;
  if (!runId) return Response.json({ error: '缺少 runId 参数' }, { status: 400 });
  const runState = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!runState) return Response.json({ error: '运行记录不存在' }, { status: 404 });
  if (!canAccessRunState(auth, runState)) {
    return Response.json({ error: '无权访问该工作流运行记录' }, { status: 403 });
  }
  return { auth, runState };
}

export function readRuntimePaging(url: URL) {
  const offset = Number(url.searchParams.get('offset') || 0);
  const limit = Number(url.searchParams.get('limit') || 100);
  return {
    offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 500) : 100,
  };
}

export function paginateRuntimeItems<T>(items: Array<T>, offset: number, limit: number) {
  const pageItems = items.slice(offset, offset + limit);
  return {
    items: pageItems,
    pagination: {
      offset,
      limit,
      total: items.length,
      nextOffset: offset + pageItems.length < items.length ? offset + pageItems.length : null,
    },
  };
}
