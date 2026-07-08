import { requireAuth } from '@/lib/auth/middleware';
import { CHANNEL_PROVIDER_PRESETS } from '@/lib/channel/providers';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;
  return jsonOk({ providers: CHANNEL_PROVIDER_PRESETS });
}
