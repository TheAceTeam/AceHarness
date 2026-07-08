import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { findWorkflowReferences, normalizeWorkflowReference } from '@/lib/workflow/references';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const target = normalizeWorkflowReference(requestUrl(request).searchParams.get('configFile'));
    if (!target) {
      return jsonError('configFile 不能为空', 400);
    }
    const references = await findWorkflowReferences(target, { id: auth.id, role: auth.role });

    return jsonOk({
      configFile: target,
      referenceCount: references.reduce((sum, item) => sum + item.refs.length, 0),
      workflowCount: references.length,
      references,
    });
  } catch (error: any) {
    return jsonError('查询工作流引用失败', 500, errorMessage(error) || 'unknown error');
  }
}
