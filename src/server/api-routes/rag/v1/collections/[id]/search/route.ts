import { requireAuth } from '@/lib/auth/middleware';
import { searchRagKnowledgeBase } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const query = typeof body?.query === 'string' ? body.query : '';
    if (!query.trim()) return jsonError('缺少搜索内容', 400);
    const results = await searchRagKnowledgeBase({
      knowledgeBaseId: id,
      query,
      topK: Number(body?.topK || 8),
      userId: auth.id,
    });
    return jsonOk({ results });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '搜索失败', 500);
  }
}
