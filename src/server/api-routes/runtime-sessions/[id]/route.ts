import { requireAuth } from '@/lib/auth/middleware';
import { getRuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import { authorizeRuntimeSessionAccess, runtimeErrorFromUnknown } from '../_shared';

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

    const session = await service.getSession(id);
    return Response.json({ session });
  } catch (error) {
    return runtimeErrorFromUnknown(error);
  }
}
