import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { importRagBundle, importRagText } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    if (!knowledgeBaseId) {
      return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    }

    if (body?.mode === 'bundle') {
      const bundle = typeof body.bundle === 'string' ? JSON.parse(body.bundle) : body.bundle;
      const job = await importRagBundle({ knowledgeBaseId, bundle, userId: auth.id });
      return NextResponse.json({ job });
    }

    const job = await importRagText({
      knowledgeBaseId,
      title: body?.title,
      content: body?.content,
      sourceType: body?.sourceType,
      userId: auth.id,
    });
    return NextResponse.json({ job });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '导入失败' }, { status: 400 });
  }
}
