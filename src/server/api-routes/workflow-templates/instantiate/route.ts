import { requireAuth } from '@/lib/auth/middleware';
import { instantiateWorkflowTemplate } from '@/lib/workflow-template/operations';
import { WorkflowTemplateError } from '@/lib/workflow-template/registry';
import { errorMessage, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const body = await readJsonBody(request, {});
    const result = await instantiateWorkflowTemplate(body as any, { userId: auth.id, role: auth.role });
    return jsonOk({
      success: true,
      filename: result.filename,
      templateRef: {
        source: result.template.source,
        id: result.template.id,
        version: result.template.version,
        digest: result.template.digest,
      },
      dependencyReport: result.dependencyReport,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkflowTemplateError) {
      return jsonOk({ error: error.message, code: error.code, details: error.details }, { status: error.status });
    }
    return jsonOk({ error: '模板实例化失败', code: 'WORKFLOW_TEMPLATE_INTERNAL_ERROR', message: errorMessage(error) }, { status: 500 });
  }
}
