import { requireAuth } from '@/lib/auth/middleware';
import { searchRagKnowledgeBase } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!knowledgeBaseId) return jsonError('缺少知识库 ID', 400);
    if (!query.trim()) return jsonError('缺少搜索内容', 400);

    const results = await searchRagKnowledgeBase({
      knowledgeBaseId,
      query,
      topK: Number(body?.topK || 8),
      userId: auth.id,
    });
    return jsonOk({ results });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '搜索失败', 400);
  }
}
