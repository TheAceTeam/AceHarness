import { requireAuth } from '@/lib/auth/middleware';
import { listRagKnowledgeBases } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const collections = await listRagKnowledgeBases();
    return jsonOk({ collections });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '读取 RAG collections 失败', 500);
  }
}
