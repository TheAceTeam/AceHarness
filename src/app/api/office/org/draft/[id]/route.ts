import { NextRequest, NextResponse } from 'next/server';
import { getOfficeOrgDraft, updateOfficeOrgDraft } from '@/lib/office/org-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await getOfficeOrgDraft(id);
    if (!draft) return NextResponse.json({ error: '组织草案不存在' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取组织草案失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const draft = await updateOfficeOrgDraft(id, {
      requirement: typeof body?.requirement === 'string' ? body.requirement : undefined,
      nodes: Array.isArray(body?.nodes) ? body.nodes : undefined,
      edges: Array.isArray(body?.edges) ? body.edges : undefined,
      gaps: Array.isArray(body?.gaps) ? body.gaps : undefined,
      clarificationAnswers: body?.clarificationAnswers,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json(
      { error: '更新组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
