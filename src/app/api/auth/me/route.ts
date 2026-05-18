import { NextRequest, NextResponse } from 'next/server';
import { validateToken, getUserById, toPublicUser, removeToken } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/me - Get current authenticated user
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');

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

  return NextResponse.json({ user: toPublicUser(user) });
}

/**
 * DELETE /api/auth/logout - Logout
 */
export async function DELETE(request: NextRequest) {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    removeToken(token);
  }
  return NextResponse.json({ success: true });
}
