import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/middleware';
import { activateSdk, deactivateSdk } from '@/lib/cangjie/sdk-manager';

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    if (body.deactivate) {
      await deactivateSdk();
      return NextResponse.json({ success: true });
    }
    await activateSdk(body.version, body.channel);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '操作失败' }, { status: 500 });
  }
}
