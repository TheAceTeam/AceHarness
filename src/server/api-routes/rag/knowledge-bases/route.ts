import { errorMessage, jsonError, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { createRagKnowledgeBase, deleteRagKnowledgeBase, listRagKnowledgeBases } from '@/lib/rag/store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    return jsonOk({ knowledgeBases: await listRagKnowledgeBases() });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '读取知识库失败', 500);
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const knowledgeBase = await createRagKnowledgeBase({
      name: body?.name,
      description: body?.description,
    });
    return jsonOk({ knowledgeBase });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '创建知识库失败', 400);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const id = requestUrl(request).searchParams.get('id') || '';
    if (!id) return jsonError('缺少知识库 ID', 400);
    await deleteRagKnowledgeBase(id);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除知识库失败', 400);
  }
}
