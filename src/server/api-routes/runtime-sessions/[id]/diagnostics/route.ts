import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import {
  authorizeRuntimeSessionAccess,
  runtimeErrorFromUnknown,
  runtimeEventToRow,
  sanitizeRuntimePayload,
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

    const bundle = await service.readDiagnostics({
      runtimeSessionId: id,
      eventLimit: 1000,
      traceLimit: 1000,
    });

    return Response.json({
      diagnostics: {
        session: bundle.session,
        events: bundle.events.map(runtimeEventToRow),
        traces: bundle.traces.map((trace) => ({
          ...trace,
          payload: sanitizeRuntimePayload(trace.payload),
          redacted: true,
        })),
        bindings: bundle.bindings.map((binding) => ({
          id: binding.id,
          runtimeSessionId: binding.runtimeSessionId,
          runtime: binding.runtime,
          role: binding.role,
          generation: binding.generation,
          raw: sanitizeRuntimePayload(binding.raw),
          rawRedacted: true,
          externalIdsRedacted: true,
          createdAt: binding.createdAt,
          updatedAt: binding.updatedAt,
        })),
        redacted: true,
      },
    });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
