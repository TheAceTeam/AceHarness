import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { changeEmail } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/email - Change email
 */
export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { newEmail } = await request.json();
    if (!newEmail) {
      return NextResponse.json({ error: '新邮箱不能为空' }, { status: 400 });
    }
    await changeEmail(user.id, newEmail);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '修改邮箱失败' }, { status: 400 });
  }
}
