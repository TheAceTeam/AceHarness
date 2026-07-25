import { requireAuth } from '@/lib/auth/middleware';
import { recordMemoryV2CutoverEvent } from '@/lib/memory-v2-cutover/telemetry';
import { jsonError } from '@/server/api-route-runtime/request-utils';

const RETIRED_MESSAGE = 'The legacy Agent-memory API is retired. Memory V2 does not import, expose, edit, or clear legacy memory.';

async function retiredLegacyMemoryRoute(request: Request): Promise<Response> {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  recordMemoryV2CutoverEvent('legacyRouteRetirements');
  return jsonError(RETIRED_MESSAGE, 410);
}

export const GET = retiredLegacyMemoryRoute;
export const POST = retiredLegacyMemoryRoute;
export const PUT = retiredLegacyMemoryRoute;
export const DELETE = retiredLegacyMemoryRoute;
