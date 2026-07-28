import { requireAuth } from '@/lib/auth/middleware';
import { importRagBundle, importRagText } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
    if (!knowledgeBaseId) {
      return jsonError('缺少知识库 ID', 400);
    }

    if (body?.mode === 'bundle') {
      const bundle = typeof body.bundle === 'string' ? JSON.parse(body.bundle) : body.bundle;
      const job = await importRagBundle({ knowledgeBaseId, bundle, userId: auth.id });
      return jsonOk({ job });
    }

    const job = await importRagText({
      knowledgeBaseId,
      title: body?.title,
      content: body?.content,
      sourceType: body?.sourceType,
      userId: auth.id,
    });
    return jsonOk({ job });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '导入失败', 400);
  }
}
