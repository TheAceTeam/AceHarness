import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { createRagKnowledgeBase, deleteRagKnowledgeBase, listRagKnowledgeBases } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json({ knowledgeBases: await listRagKnowledgeBases() });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取知识库失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const knowledgeBase = await createRagKnowledgeBase({
      name: body?.name,
      description: body?.description,
    });
    return NextResponse.json({ knowledgeBase });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '创建知识库失败' }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const id = request.nextUrl.searchParams.get('id') || '';
    if (!id) return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    await deleteRagKnowledgeBase(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '删除知识库失败' }, { status: 400 });
  }
}
