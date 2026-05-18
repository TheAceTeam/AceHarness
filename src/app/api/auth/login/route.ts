import { NextRequest, NextResponse } from 'next/server';
import { login } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/login - Login
 */
export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: '邮箱和密码不能为空' }, { status: 400 });
    }

    const result = await login(email, password);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 401 });
    }

    return NextResponse.json({
      token: result.token,
      user: result.user,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '登录失败' }, { status: 500 });
  }
}
