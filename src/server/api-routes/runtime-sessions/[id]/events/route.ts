import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { requestUrl } from '@/server/api-route-runtime/request-utils';
import {
  authorizeRuntimeSessionAccess,
  parseRuntimeCursor,
  parseRuntimeLimit,
  runtimeError,
  runtimeErrorFromUnknown,
  runtimeEventsResponse,
} from '../../_shared';

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

    const cursorSeq = parseRuntimeCursor(url.searchParams.get('cursor'), id);
    if (cursorSeq instanceof Response) return cursorSeq;

    const rawAfterSeq = url.searchParams.get('afterSeq') ?? request.headers.get('last-event-id') ?? '0';
    const afterSeq = cursorSeq ?? Number(rawAfterSeq || 0);
    if (!Number.isInteger(afterSeq) || afterSeq < 0) {
      return runtimeError('VALIDATION_FAILED', 'afterSeq must be a non-negative integer', 422);
    }

    const page = await service.readEvents({
      runtimeSessionId: id,
      afterSeq,
      limit,
    });

    return Response.json(runtimeEventsResponse(id, page.events, page.nextSeq || afterSeq));
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
