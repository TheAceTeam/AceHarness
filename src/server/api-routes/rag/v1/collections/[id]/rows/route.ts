import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { deleteRagRows, emptyRagKnowledgeBase, listRagRowsPage } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const page = Number(requestUrl(request).searchParams.get('page') || 0);
    const pageSize = Number(requestUrl(request).searchParams.get('pageSize') || 50);
    const documentId = requestUrl(request).searchParams.get('sourceId') || undefined;
    const result = await listRagRowsPage({
      knowledgeBaseId: id,
      page: Number.isFinite(page) ? page : 0,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
      documentId,
    });
    return jsonOk(result);
  } catch (error: any) {
    return jsonError(errorMessage(error) || '读取向量行失败', 500);
  }
}

export async function DELETE(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    if (body?.all === true) {
      await emptyRagKnowledgeBase(id);
      return jsonOk({ success: true });
    }
    const rowIds = Array.isArray(body?.rowIds) ? body.rowIds.filter((item: unknown) => typeof item === 'string') : [];
    await deleteRagRows({ knowledgeBaseId: id, rowIds });
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除向量行失败', 400);
  }
}
