import { NextRequest, NextResponse } from 'next/server';
import { searchRagKnowledgeBase } from '@/lib/rag/store';
import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  let target = '';
  try {
    const grant = auth.grant;
    if (!grant.rag?.enabled || !grant.rag.allowAgentQuery) {
      return NextResponse.json({ error: 'RAG_DISABLED' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    target = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) return NextResponse.json({ error: 'RAG_QUERY_EMPTY' }, { status: 400 });
    if (!target || !grant.rag.knowledgeBases.includes(target)) {
      return NextResponse.json({ error: 'RAG_KB_NOT_ALLOWED' }, { status: 403 });
    }
    const topK = Math.max(1, Math.min(Number(body?.topK || grant.rag.topK || 8), 50));
    const results = await searchRagKnowledgeBase({ knowledgeBaseId: target, query, topK });
    await appendRuntimeDatabaseAudit({
      grant,
      skillName,
      capability: 'rag',
      operation: 'search',
      target,
      status: 'success',
      durationMs: Date.now() - startedAt,
      inputSummary: { queryPreview: query.slice(0, 120), topK },
      outputSummary: { resultCount: results.length },
    });
    return NextResponse.json({ results });
  } catch (error: any) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'rag',
      operation: 'search',
      target,
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error?.message || 'RAG_SEARCH_FAILED',
    }).catch(() => null);
    return NextResponse.json({ error: 'RAG_SEARCH_FAILED' }, { status: 500 });
  }
}
