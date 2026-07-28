import { validateToken, getUserById, toPublicUser, removeToken } from '@/lib/core/user-store';
import { AUTH_COOKIE_NAME, getAuthToken } from '@/lib/auth/middleware';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

function clearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

/**
 * GET /api/auth/me - Get current authenticated user
 */
export async function GET(request: Request) {
  const token = getAuthToken(request);

  if (!token) {
    return jsonError('未登录或登录已过期', 401);
  }

  const info = validateToken(token);
  if (!info) {
    return jsonError('未登录或登录已过期', 401);
  }

  const user = await getUserById(info.userId);
  if (!user) {
    return jsonError('用户不存在', 401);
  }

  return jsonOk({ user: toPublicUser(user) });
}

/**
 * DELETE /api/auth/logout - Logout
 */
export async function DELETE(request: Request) {
  const token = getAuthToken(request);
  if (token) {
    removeToken(token);
  }
  const response = jsonOk({ success: true });
  response.headers.set('Set-Cookie', clearAuthCookie());
  return response;
}
