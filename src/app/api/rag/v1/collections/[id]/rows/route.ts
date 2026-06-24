import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagRows, emptyRagKnowledgeBase, listRagRowsPage } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const page = Number(request.nextUrl.searchParams.get('page') || 0);
    const pageSize = Number(request.nextUrl.searchParams.get('pageSize') || 50);
    const documentId = request.nextUrl.searchParams.get('sourceId') || undefined;
    const result = await listRagRowsPage({
      knowledgeBaseId: id,
      page: Number.isFinite(page) ? page : 0,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      documentId,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取向量行失败' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    if (body?.all === true) {
      await emptyRagKnowledgeBase(id);
      return NextResponse.json({ success: true });
    }
    const rowIds = Array.isArray(body?.rowIds) ? body.rowIds.filter((item: unknown) => typeof item === 'string') : [];
    await deleteRagRows({ knowledgeBaseId: id, rowIds });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '删除向量行失败' }, { status: 400 });
  }
}
