import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { changePassword } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/password - Change password (requires currentPassword + newPassword)
 */
export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '当前密码和新密码不能为空' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密码至少6个字符' }, { status: 400 });
    }
    await changePassword(user.id, currentPassword, newPassword);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '修改密码失败' }, { status: 400 });
  }
}
