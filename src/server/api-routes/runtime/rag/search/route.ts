import { searchRagKnowledgeBase } from '@/lib/rag/store';
import { requireRuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';
import { appendRuntimeDatabaseAudit } from '@/lib/runtime/database-audit';
import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { readRuntimeJsonBody, runtimeRagError } from '@/server/api-route-runtime/runtime-database-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireRuntimeDatabaseGrant(request);
  if ('error' in auth) return jsonError(auth.error, auth.status);
  const startedAt = Date.now();
  const skillName = request.headers.get('x-aceharness-skill-name') || undefined;
  let target = '';
  try {
    const grant = auth.grant;
    if (!grant.rag?.enabled || !grant.rag.allowAgentQuery) {
      return jsonError('RAG_DISABLED', 403);
    }
    const body = await readRuntimeJsonBody(request);
    target = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    const query = typeof body?.query === 'string' ? body.query.trim() : '';
    if (!query) return jsonError('RAG_QUERY_EMPTY', 400);
    if (!target || !grant.rag.knowledgeBases.includes(target)) {
      return jsonError('RAG_KB_NOT_ALLOWED', 403);
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
    return jsonOk({ results });
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
    return runtimeRagError('RAG_SEARCH_FAILED', 500, error);
  }
}
