import { NextRequest, NextResponse } from 'next/server';
import { applyOfficeOrgDraft } from '@/lib/office/org-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await applyOfficeOrgDraft({
      draftId: typeof body?.draftId === 'string' ? body.draftId : undefined,
      org: body?.org,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { error: '应用组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
