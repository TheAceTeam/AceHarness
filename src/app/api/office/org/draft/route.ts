import { NextRequest, NextResponse } from 'next/server';
import { createOfficeOrgDraft } from '@/lib/office/org-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const draft = await createOfficeOrgDraft({
      requirement: typeof body?.requirement === 'string' ? body.requirement : undefined,
      plan: body?.plan,
      nodes: Array.isArray(body?.nodes) ? body.nodes : undefined,
      edges: Array.isArray(body?.edges) ? body.edges : undefined,
      gaps: Array.isArray(body?.gaps) ? body.gaps : undefined,
      mode: body?.mode,
      clarificationAnswers: body?.clarificationAnswers,
      model: typeof body?.model === 'string' ? body.model : undefined,
    });
    return NextResponse.json({ success: true, draft });
  } catch (error: any) {
    return NextResponse.json(
      { error: '生成组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
