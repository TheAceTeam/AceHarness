/**
 * 认证中间件
 * 从 request header 提取 token → 查 userId → 返回用户信息或 401
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateToken, getUserById, toPublicUser, type PublicUser } from '@/lib/core/user-store';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  personalDir: string;
  avatar?: string;
}

function extractToken(req: NextRequest): string | null {
  return req.headers.get('Authorization')?.replace('Bearer ', '') || null;
}

/**
 * Require any authenticated user. Returns user info or a 401 response.
 */
export async function requireAuth(req: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const token = extractToken(req);
  if (!token) {
    return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });
  }
  const info = validateToken(token);
  if (!info) {
    return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });
  }
  const user = await getUserById(info.userId);
  if (!user) {
    return NextResponse.json({ error: '用户不存在' }, { status: 401 });
  }
  if (user.status === 'pending') {
    return NextResponse.json({ error: '账号等待管理员审核' }, { status: 403 });
  }
  if (user.status === 'rejected') {
    return NextResponse.json({ error: '账号注册申请未通过' }, { status: 403 });
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
export async function requireAdmin(req: NextRequest): Promise<AuthenticatedUser | NextResponse> {
  const result = await requireAuth(req);
  if (result instanceof NextResponse) return result;
  if (result.role !== 'admin') {
    return NextResponse.json({ error: '需要管理员权限' }, { status: 403 });
  }
  return result;
}
