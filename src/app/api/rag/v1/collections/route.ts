import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { listRagKnowledgeBases } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const collections = await listRagKnowledgeBases();
    return NextResponse.json({ collections });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取 RAG collections 失败' }, { status: 500 });
  }
}
