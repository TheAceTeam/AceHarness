import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { getRagDatabaseStats, getRagTableSchema, listRagChunks, listRagDocuments, listRagImportJobs } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const knowledgeBaseId = requestUrl(request).searchParams.get('knowledgeBaseId') || '';
    if (!knowledgeBaseId) {
      return jsonError('缺少知识库 ID', 400);
    }
    const limit = Number(requestUrl(request).searchParams.get('limit') || 80);
    const [documents, chunks, importJobs] = await Promise.all([
      listRagDocuments(knowledgeBaseId),
      listRagChunks(knowledgeBaseId, Number.isFinite(limit) ? limit : 80),
      listRagImportJobs(knowledgeBaseId),
    ]);
    const stats = await getRagDatabaseStats(knowledgeBaseId);
    const schema = await getRagTableSchema(knowledgeBaseId);
    return jsonOk({ documents, chunks, importJobs, stats, schema });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '读取知识库详情失败', 400);
  }
}
