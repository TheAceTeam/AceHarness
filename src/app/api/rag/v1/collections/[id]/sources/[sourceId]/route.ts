import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagDocument } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string; sourceId: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id, sourceId } = await context.params;
    await deleteRagDocument({ knowledgeBaseId: id, documentId: sourceId });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '删除来源失败' }, { status: 400 });
  }
}
