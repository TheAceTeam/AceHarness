import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { getRagDatabaseStats, getRagTableSchema, listRagChunks, listRagDocuments, listRagImportJobs } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const knowledgeBaseId = request.nextUrl.searchParams.get('knowledgeBaseId') || '';
    if (!knowledgeBaseId) {
      return NextResponse.json({ error: '缺少知识库 ID' }, { status: 400 });
    }
    const limit = Number(request.nextUrl.searchParams.get('limit') || 80);
    const [documents, chunks, importJobs] = await Promise.all([
      listRagDocuments(knowledgeBaseId),
      listRagChunks(knowledgeBaseId, Number.isFinite(limit) ? limit : 80),
      listRagImportJobs(knowledgeBaseId),
    ]);
    const stats = await getRagDatabaseStats(knowledgeBaseId);
    const schema = await getRagTableSchema(knowledgeBaseId);
    return NextResponse.json({ documents, chunks, importJobs, stats, schema });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '读取知识库详情失败' }, { status: 400 });
  }
}
