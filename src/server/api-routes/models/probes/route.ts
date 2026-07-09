import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { createModelProbe, listModelProbes } from '@/lib/models/probes';
import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { attachModelRouteIdsToProbeResponse, normalizeProbeInputForModelRouteId } from './model-route-probe-dto';

export const dynamic = 'force-dynamic';

function isTruthy(value: string | null): boolean {
  return value === '1' || value === 'true' || value === 'yes';
}

function readHistoryLimit(value: string | null): number | undefined {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const refreshDue = isTruthy(searchParams.get('refresh'));
    const forceRunAll = isTruthy(searchParams.get('force'));
    if ((refreshDue || forceRunAll) && auth.role !== 'admin') {
      return jsonError('仅管理员可触发探针刷新', 403);
    }
    const data = await listModelProbes({
      refreshDue,
      forceRunAll,
      historyLimit: readHistoryLimit(searchParams.get('historyLimit')),
    });
    return jsonOk(attachModelRouteIdsToProbeResponse(data));
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to load model probes', 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const probe = await createModelProbe(normalizeProbeInputForModelRouteId(body || {}));
    return jsonOk(attachModelRouteIdsToProbeResponse({ success: true, probe }));
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to create model probe', 400);
  }
}
