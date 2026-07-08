import { requireAdmin } from '@/lib/auth/middleware';
import { runModelProbes } from '@/lib/models/probes';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<{ ids?: unknown[]; dueOnly?: boolean; force?: boolean }>(request, {});
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((value: unknown) => String(value || '').trim()).filter(Boolean)
      : undefined;
    const result = await runModelProbes({
      ids,
      dueOnly: body?.dueOnly === true,
      force: body?.force === true,
    });
    return jsonOk({
      success: true,
      executed: result.executed,
      skipped: result.skipped,
      ...result.data,
    });
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to run model probes', 500);
  }
}
