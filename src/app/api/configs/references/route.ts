import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { findWorkflowReferences, normalizeWorkflowReference } from '@/lib/workflow/references';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const target = normalizeWorkflowReference(request.nextUrl.searchParams.get('configFile'));
    if (!target) {
      return NextResponse.json({ error: 'configFile 不能为空' }, { status: 400 });
    }
    const references = await findWorkflowReferences(target, { id: auth.id, role: auth.role });

    return NextResponse.json({
      configFile: target,
      referenceCount: references.reduce((sum, item) => sum + item.refs.length, 0),
      workflowCount: references.length,
      references,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '查询工作流引用失败', message: error?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
