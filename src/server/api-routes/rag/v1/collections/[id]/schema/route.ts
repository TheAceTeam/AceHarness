import { requireAuth } from '@/lib/auth/middleware';
import { getRagDatabaseStats, getRagTableSchema } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const [schema, stats] = await Promise.all([
      getRagTableSchema(id),
      getRagDatabaseStats(id),
    ]);
    if (!schema) return jsonError('RAG collection 不存在', 404);
    return jsonOk({ schema, stats });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '读取 schema 失败', 500);
  }
}
