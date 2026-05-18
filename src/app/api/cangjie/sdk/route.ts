import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { getSdkOverview } from '@/lib/cangjie/sdk-manager';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const overview = await getSdkOverview();
    return NextResponse.json(overview);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取 SDK 列表失败' }, { status: 500 });
  }
}
