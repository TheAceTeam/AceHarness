import { NextRequest, NextResponse } from 'next/server';
import { getRagDatabaseStats, listRagKnowledgeBases } from '@/lib/rag/store';
import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  try {
    const grant = auth.grant;
    if (!grant.rag?.enabled || !grant.rag.allowAgentQuery) {
      return NextResponse.json({ error: 'RAG_DISABLED' }, { status: 403 });
    }
    const allowed = new Set(grant.rag.knowledgeBases);
    const all = await listRagKnowledgeBases();
    const knowledgeBases = await Promise.all(all.filter((kb) => allowed.has(kb.id)).map(async (kb) => {
      const stats = await getRagDatabaseStats(kb.id).catch(() => null);
      return {
        id: kb.id,
        name: kb.name,
        description: kb.description,
        documentCount: 0,
        chunkCount: stats?.rowCount ?? 0,
        embeddingModel: stats?.embeddingModel,
      };
    }));
    await appendRuntimeDatabaseAudit({
      grant,
      skillName,
      capability: 'rag',
      operation: 'list',
      target: '*',
      status: 'success',
      durationMs: Date.now() - startedAt,
      outputSummary: { knowledgeBaseCount: knowledgeBases.length },
    });
    return NextResponse.json({ knowledgeBases });
  } catch (error: any) {
    await appendRuntimeDatabaseAudit({
      grant: auth.grant,
      skillName,
      capability: 'rag',
      operation: 'list',
      target: '*',
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: error?.message || 'RAG_LIST_FAILED',
    }).catch(() => null);
    return NextResponse.json({ error: 'RAG_LIST_FAILED' }, { status: 500 });
  }
}
