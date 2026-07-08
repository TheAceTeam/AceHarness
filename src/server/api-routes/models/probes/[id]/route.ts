import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { deleteModelProbe, getModelProbe, updateModelProbe } from '@/lib/models/probes';

export const dynamic = 'force-dynamic';

function readHistoryLimit(value: string | null): number | undefined {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const probe = await getModelProbe(id, readHistoryLimit(requestUrl(request).searchParams.get('historyLimit')));
    if (!probe) {
      return jsonError('Probe not found', 404);
    }
    return jsonOk({ probe });
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to load model probe', 500);
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const body = await readJsonBody(request, {});
    const probe = await updateModelProbe(id, body || {});
    return jsonOk({ success: true, probe });
  } catch (error) {
    const message = errorMessage(error) || 'Failed to update model probe';
    return jsonError(message, message.includes('不存在') || message.includes('not found') ? 404 : 400);
  }
}

export async function DELETE(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const success = await deleteModelProbe(id);
    if (!success) {
      return jsonError('Probe not found', 404);
    }
    return jsonOk({ success: true });
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to delete model probe', 500);
  }
}
