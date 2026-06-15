import { NextResponse } from 'next/server';
import { restoreOfficeOrgVersion } from '@/lib/office/org-store';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await restoreOfficeOrgVersion(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: '恢复组织版本失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
