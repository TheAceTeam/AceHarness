import { requireAuth } from '@/lib/auth/middleware';
import { listUsers } from '@/lib/core/user-store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const users = await listUsers();
  return jsonOk({
    users: users
      .filter((user) => user.status === 'active' && user.id !== auth.id)
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      })),
  });
}
