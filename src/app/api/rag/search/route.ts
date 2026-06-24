import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { searchRagKnowledgeBase } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!knowledgeBaseId) return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    if (!query.trim()) return NextResponse.json({ error: '缺少搜索内容' }, { status: 400 });

    const results = await searchRagKnowledgeBase({
      knowledgeBaseId,
      query,
      topK: Number(body?.topK || 8),
      userId: auth.id,
    });
    return NextResponse.json({ results });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '搜索失败' }, { status: 400 });
  }
}
