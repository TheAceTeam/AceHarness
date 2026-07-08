import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/auth/middleware';
import { createModelProbe, listModelProbes } from '@/lib/models/probes';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<any>(request, {});
    const probes = Array.isArray(body?.probes) ? body.probes : [];
    if (probes.length === 0) {
      return jsonError('probes is required', 400);
    }

    const created = [];
    const groupId = String(body?.groupId || '').trim() || randomUUID();
    const groupName = String(body?.groupName || '').trim() || 'New Group';
    for (const item of probes) {
      created.push(await createModelProbe({
        ...(item || {}),
        groupId,
        groupName,
      }));
    }

    const data = await listModelProbes();
    return jsonOk({
      success: true,
      createdCount: created.length,
      created,
      ...data,
    });
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to batch create model probes', 400);
  }
}
