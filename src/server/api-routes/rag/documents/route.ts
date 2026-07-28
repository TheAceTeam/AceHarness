import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagDocument } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const knowledgeBaseId = requestUrl(request).searchParams.get('knowledgeBaseId') || '';
    const documentId = requestUrl(request).searchParams.get('documentId') || '';
    if (!knowledgeBaseId) return jsonError('缺少知识库 ID', 400);
    if (!documentId) return jsonError('缺少来源 ID', 400);
    await deleteRagDocument({ knowledgeBaseId, documentId });
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除来源失败', 400);
  }
}
