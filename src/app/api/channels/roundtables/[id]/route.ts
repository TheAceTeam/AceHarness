import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { loadRoundtable } from '@/lib/roundtable-store';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const roundtable = await loadRoundtable(id);
  if (!roundtable || roundtable.createdBy !== user.id) {
    return NextResponse.json({ error: '圆桌记录不存在' }, { status: 404 });
  }
  return NextResponse.json({ roundtable });
}
