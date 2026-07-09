import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { requestUrl } from '@/server/api-route-runtime/request-utils';
import { authorizeRuntimeSessionAccess, parseRequiredString, parseRuntimeLimit, runtimeErrorFromUnknown, sanitizeRuntimePayload } from '../../_shared';

export async function GET(
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

    const url = requestUrl(request);
    const limit = parseRuntimeLimit(url.searchParams.get('limit'));
    if (limit instanceof Response) return limit;

    const page = await service.readTraces({
      runtimeSessionId: id,
      limit,
      traceId: parseRequiredString(url.searchParams.get('traceId')) ?? undefined,
      turnId: parseRequiredString(url.searchParams.get('turnId')) ?? undefined,
    });

    return Response.json({
      traces: page.traces.map((trace) => ({
        ...trace,
        payload: sanitizeRuntimePayload(trace.payload),
        redacted: true,
      })),
    });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
