import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { updateUser } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/auth/profile - Update own profile (avatar, personalDir)
 */
export async function PUT(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const patch: any = {};
    if (body.avatar !== undefined) patch.avatar = body.avatar;
    if (body.personalDir !== undefined) patch.personalDir = body.personalDir;
    if (body.username !== undefined) patch.username = body.username;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    }

    const updated = await updateUser(user.id, patch);
    return NextResponse.json({ user: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '更新失败' }, { status: 400 });
  }
}
