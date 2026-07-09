import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { readJsonBody } from '@/server/api-route-runtime/request-utils';
import { parseRequiredString, runtimeError, runtimeErrorFromUnknown, runtimeSessionKinds } from './_shared';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, unknown>>(request, {});
    const agentId = parseRequiredString(body.agentId);
    const cwd = parseRequiredString(body.cwd);
    const kind = parseRequiredString(body.kind);

    if (!agentId || !cwd || !kind || !runtimeSessionKinds.has(kind as any)) {
      return runtimeError('VALIDATION_FAILED', 'agentId, cwd, and valid kind are required', 422);
    }

    const session = await getRuntimeSessionsApiService().createSession({
      agentId,
      cwd,
      kind: kind as any,
      modelRouteId: parseRequiredString(body.modelRouteId) ?? undefined,
      runtimeProfileId: parseRequiredString(body.runtimeProfileId) ?? undefined,
      title: parseRequiredString(body.title) ?? undefined,
      ownerUserId: auth.id,
    });

    return Response.json({ session }, { status: 201 });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
