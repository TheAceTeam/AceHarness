import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { importRagBundle, importRagSampleKnowledgeBase } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json();
    if (body?.sample === true || body?.mode === 'sample') {
      const job = await importRagSampleKnowledgeBase({ knowledgeBaseId: id, userId: auth.id });
      return NextResponse.json({ job });
    }
    const bundle = body?.bundle || body;
    const job = await importRagBundle({ knowledgeBaseId: id, bundle, userId: auth.id });
    return NextResponse.json({ job });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '导入失败' }, { status: 400 });
  }
}
