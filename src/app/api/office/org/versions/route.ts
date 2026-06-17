import { NextResponse } from 'next/server';
import { listOfficeOrgVersions } from '@/lib/office/org-store';

export async function GET() {
  try {
    const versions = await listOfficeOrgVersions();
    return NextResponse.json({ versions });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取组织版本失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
