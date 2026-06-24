import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagDocument } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const knowledgeBaseId = request.nextUrl.searchParams.get('knowledgeBaseId') || '';
    const documentId = request.nextUrl.searchParams.get('documentId') || '';
    if (!knowledgeBaseId) return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    if (!documentId) return NextResponse.json({ error: '缺少来源 ID' }, { status: 400 });
    await deleteRagDocument({ knowledgeBaseId, documentId });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '删除来源失败' }, { status: 400 });
  }
}
