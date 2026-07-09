import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { readJsonBody } from '@/server/api-route-runtime/request-utils';
import { authorizeRuntimeSessionAccess, parseRequiredString, runtimeError, runtimeErrorFromUnknown } from '../../_shared';

export async function POST(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await params;
    const service = getRuntimeSessionsApiService();
    const accessError = await authorizeRuntimeSessionAccess(service, id, auth);
    if (accessError) return accessError;

    const body = await readJsonBody<Record<string, unknown>>(request, {});
    const requestId = parseRequiredString(body.requestId);
    if (!requestId) return runtimeError('VALIDATION_FAILED', 'requestId is required', 422);

    await service.cancelSession({
      runtimeSessionId: id,
      requestId,
      reason: parseRequiredString(body.reason) ?? undefined,
    });

    return Response.json({ ok: true });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
