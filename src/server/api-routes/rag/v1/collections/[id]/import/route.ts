import { requireAuth } from '@/lib/auth/middleware';
import { importRagBundle, importRagSampleKnowledgeBase } from '@/lib/rag/store';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: { id: string } | Promise<{ id: string }> }) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { id } = await context.params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    if (body?.sample === true || body?.mode === 'sample') {
      const job = await importRagSampleKnowledgeBase({ knowledgeBaseId: id, userId: auth.id });
      return jsonOk({ job });
    }
    const bundle = body?.bundle || body;
    const job = await importRagBundle({ knowledgeBaseId: id, bundle, userId: auth.id });
    return jsonOk({ job });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '导入失败', 400);
  }
}
