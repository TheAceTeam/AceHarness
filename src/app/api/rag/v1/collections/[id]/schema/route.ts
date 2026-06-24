import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getRagDatabaseStats, getRagTableSchema } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await context.params;
    const [schema, stats] = await Promise.all([
      getRagTableSchema(id),
      getRagDatabaseStats(id),
    ]);
    if (!schema) return NextResponse.json({ error: 'RAG collection 不存在' }, { status: 404 });
    return NextResponse.json({ schema, stats });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取 schema 失败' }, { status: 500 });
  }
}
