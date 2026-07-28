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

    if (!requestId) {
      return runtimeError('VALIDATION_FAILED', 'requestId is required', 422);
    }

    const result = await service.forkSession({
      runtimeSessionId: id,
      requestId,
      atTurnId: parseRequiredString(body.atTurnId) ?? undefined,
      atMessageId: parseRequiredString(body.atMessageId) ?? undefined,
      title: parseRequiredString(body.title) ?? undefined,
    });

    if (result.status === 'failed' && result.error) {
      return runtimeError(result.error.code, result.error.message, result.error.code === 'NOT_FOUND' ? 404 : 500, {
        retryable: result.error.retryable,
        details: result.error.details,
      });
    }
    return Response.json({ fork: result });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
