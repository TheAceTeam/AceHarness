import { requireAdmin } from '@/lib/auth/middleware';
import { runModelProbe } from '@/lib/models/probes';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { attachModelRouteIdsToProbeResponse } from '../../model-route-probe-dto';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const body = await readJsonBody<{ force?: boolean }>(request, {});
    const probe = await runModelProbe(id, { force: body?.force === true });
    return jsonOk(attachModelRouteIdsToProbeResponse({ success: true, probe }));
  } catch (error) {
    const message = errorMessage(error) || 'Failed to run model probe';
    return jsonError(message, message.includes('不存在') || message.includes('not found') ? 404 : 500);
  }
}
