import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { createUser, listUsers } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const users = await listUsers();
  return NextResponse.json({ users });
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  try {
    const { username, email, password, question, answer, role, personalDir, avatar } = await request.json();

    if (!username || !email || !password || !question || !answer) {
      return NextResponse.json({ error: '所有字段都不能为空' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
    }

    const user = await createUser({
      username,
      email,
      password,
      question,
      answer,
      role: role || 'user',
      personalDir: personalDir || '',
      avatar,
      createdBy: admin.id,
      approvedBy: admin.id,
      status: 'active',
    });

    return NextResponse.json({ user });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || '创建用户失败' }, { status: 400 });
  }
}
