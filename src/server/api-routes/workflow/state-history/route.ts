import { requestUrl, jsonOk } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { loadRunState } from '@/lib/run/state-persistence';
import { canAccessRunState } from '@/lib/workflow/run-access';
import { truncateLiveText } from '@/lib/workflow/live-status';

export const dynamic = 'force-dynamic';

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
    return jsonOk({ error: '无权访问该工作流状态历史' }, { status: 403 });
  }

  const { offset, limit } = readPaging(request);
  const allItems = Array.isArray(runState.stateHistory) ? runState.stateHistory : [];
  const items = allItems.slice(offset, offset + limit).map(compactStateHistoryItem);

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

function compactStateHistoryItem(item: any) {
  if (!item) return item;
  return {
    ...item,
    reason: truncateLiveText(item.reason || '', 1600),
    summary: truncateLiveText(item.summary || '', 1600),
    message: truncateLiveText(item.message || '', 1600),
    result: compactRuntimeValue(item.result),
    snapshot: item.snapshot ? '[已省略 snapshot，请按需读取详情]' : item.snapshot,
    issues: Array.isArray(item.issues)
      ? item.issues.slice(0, 20).map((issue: any) => ({
          ...issue,
          description: truncateLiveText(issue?.description || '', 1200),
          evidence: truncateLiveText(issue?.evidence || '', 1200),
          recommendation: truncateLiveText(issue?.recommendation || '', 1200),
        }))
      : item.issues,
  };
}

function compactRuntimeValue(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateLiveText(value, 2000);
  if (typeof value !== 'object') return value;
  if (depth >= 4) return '[已省略深层对象]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => compactRuntimeValue(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (['output', 'stdout', 'stderr', 'fullOutput', 'snapshot'].includes(key)) {
      out[key] = typeof child === 'string' ? truncateLiveText(child, 1200) : '[已省略重字段]';
      continue;
    }
    out[key] = compactRuntimeValue(child, depth + 1);
  }
  return out;
}
