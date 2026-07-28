import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import {
  authorizeRuntimeSessionAccess,
  eventStreamResponse,
  parseRequiredString,
  runtimeError,
  runtimeErrorFromUnknown,
  runtimeInterruptPolicies,
  runtimeStreamModes,
} from '../../_shared';

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
    const input = parseRequiredString(body.input);
    const interruptPolicy = parseRequiredString(body.interruptPolicy);
    const urlStream = requestUrl(request).searchParams.get('stream');
    const bodyStream = parseRequiredString(body.stream);
    const stream = (urlStream || bodyStream || 'none') as 'sse' | 'ndjson' | 'none';

    if (!requestId || !input) {
      return runtimeError('VALIDATION_FAILED', 'requestId and input are required', 422);
    }
    if (interruptPolicy && !runtimeInterruptPolicies.has(interruptPolicy as any)) {
      return runtimeError('VALIDATION_FAILED', 'interruptPolicy is invalid', 422);
    }
    if (!runtimeStreamModes.has(stream)) {
      return runtimeError('VALIDATION_FAILED', 'stream must be sse, ndjson, or none', 422);
    }

    const result = await service.createTurn({
      runtimeSessionId: id,
      requestId,
      input,
      interruptPolicy: interruptPolicy as any,
      metadata: typeof body.metadata === 'object' && body.metadata !== null ? body.metadata as Record<string, unknown> : undefined,
    });

    if (stream === 'sse' || stream === 'ndjson') {
      return eventStreamResponse(result.events ?? emptyRuntimeEvents(), stream, { turn: result.turn });
    }

    return Response.json(
      { turn: result.turn },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}

async function* emptyRuntimeEvents() {
  // No-op iterable for idempotent turn hits or placeholder services.
}
