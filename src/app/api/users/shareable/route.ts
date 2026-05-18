import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { listUsers } from '@/lib/core/user-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const users = await listUsers();
  return NextResponse.json({
    users: users
      .filter((user) => user.status === 'active' && user.id !== auth.id)
      .map((user) => ({
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      })),
  });
}
