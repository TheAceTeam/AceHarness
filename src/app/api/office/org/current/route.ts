import { NextResponse } from 'next/server';
import { getCurrentOfficeOrg } from '@/lib/office/org-store';

export async function GET() {
  try {
    const org = await getCurrentOfficeOrg();
    return NextResponse.json({ org });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取当前组织失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
