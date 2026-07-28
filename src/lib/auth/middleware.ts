/**
 * 认证中间件
 * 从 request header 提取 token → 查 userId → 返回用户信息或 401
 */

import { validateToken, getUserById, toPublicUser, type PublicUser } from '@/lib/core/user-store';

export const AUTH_COOKIE_NAME = 'ace_auth_token';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') || req.headers.get('authorization') || '';
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) return bearer;

  const cookie = req.headers.get('Cookie') || req.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === AUTH_COOKIE_NAME) {
      const value = rawValue.join('=').trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

export function getAuthToken(req: Request): string | null {
  return extractToken(req);
}

/**
 * Require any authenticated user. Returns user info or a 401 response.
 */
export async function requireAuth(req: Request): Promise<AuthenticatedUser | Response> {
  const token = extractToken(req);
  if (!token) {
    return Response.json({ error: '未登录或登录已过期' }, { status: 401 });
  }
  const info = validateToken(token);
  if (!info) {
    return Response.json({ error: '未登录或登录已过期' }, { status: 401 });
  }
  const user = await getUserById(info.userId);
  if (!user) {
    return Response.json({ error: '用户不存在' }, { status: 401 });
  }
  if (user.status === 'pending') {
    return Response.json({ error: '账号等待管理员审核' }, { status: 403 });
  }
  if (user.status === 'rejected') {
    return Response.json({ error: '账号注册申请未通过' }, { status: 403 });
  }
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    personalDir: user.personalDir,
    avatar: user.avatar,
  };
}

/**
 * Require admin role. Returns user info or a 401/403 response.
 */
export async function requireAdmin(req: Request): Promise<AuthenticatedUser | Response> {
  const result = await requireAuth(req);
  if (result instanceof Response) return result;
  if (result.role !== 'admin') {
    return Response.json({ error: '需要管理员权限' }, { status: 403 });
  }
  return result;
}
