import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagDocument } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  context: { params: { id: string; sourceId: string } | Promise<{ id: string; sourceId: string }> }
) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id, sourceId } = await context.params;
    await deleteRagDocument({ knowledgeBaseId: id, documentId: sourceId });
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除来源失败', 400);
  }
}
