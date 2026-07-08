import { login } from '@/lib/core/user-store';
import { AUTH_COOKIE_NAME } from '@/lib/auth/middleware';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

const AUTH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function buildAuthCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`;
}

/**
 * POST /api/auth/login - Login
 */
export async function POST(request: Request) {
  try {
    const { email, password } = await readJsonBody<Record<string, any>>(request, {});

    if (!email || !password) {
      return jsonError('邮箱和密码不能为空', 400);
    }

    const result = await login(email, password);

    if (!result.success) {
      return jsonError(result.error || '登录失败', 401);
    }

    const response = jsonOk({
      token: result.token,
      user: result.user,
    });
    response.headers.set('Set-Cookie', buildAuthCookie(result.token));
    return response;
  } catch (error) {
    return jsonError(errorMessage(error) || '登录失败', 500);
  }
}
