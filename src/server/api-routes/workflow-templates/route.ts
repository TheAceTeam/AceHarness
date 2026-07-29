import { requireAuth } from '@/lib/auth/middleware';
import { listWorkflowTemplates, getWorkflowTemplate, WorkflowTemplateError } from '@/lib/workflow-template/registry';
import { saveWorkflowAsTemplate } from '@/lib/workflow-template/operations';
import { workflowTemplateSourceSchema } from '@/lib/workflow-template/types';
import { errorMessage, jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';

function templateErrorResponse(error: unknown): Response {
  if (error instanceof WorkflowTemplateError) {
    return jsonOk({ error: error.message, code: error.code, details: error.details }, { status: error.status });
  }
  return jsonOk({ error: '模板服务异常', code: 'WORKFLOW_TEMPLATE_INTERNAL_ERROR', message: errorMessage(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const url = requestUrl(request);
    const source = url.searchParams.get('source');
    const id = url.searchParams.get('id');
    const version = url.searchParams.get('version');
    if (source || id || version) {
      const sourceResult = workflowTemplateSourceSchema.safeParse(source);
      if (!sourceResult.success || !id || !version) {
        return jsonOk({
          error: '查询模板详情必须同时提供 source、id 和 version',
          code: 'WORKFLOW_TEMPLATE_QUERY_INVALID',
        }, { status: 400 });
      }
      const template = await getWorkflowTemplate(
        { source: sourceResult.data, id, version },
        { userId: auth.id, role: auth.role },
      );
      return jsonOk({ template });
    }

    const result = await listWorkflowTemplates({ userId: auth.id, role: auth.role });
    const keyword = (url.searchParams.get('keyword') || '').trim().toLocaleLowerCase('zh-CN');
    const category = (url.searchParams.get('category') || '').trim();
    const mode = (url.searchParams.get('mode') || '').trim();
    const sourceFilter = (url.searchParams.get('sourceFilter') || '').trim();
    const templates = result.templates.filter((template) => {
      if (category && template.category !== category) return false;
      if (mode && template.mode !== mode) return false;
      if (sourceFilter && template.source !== sourceFilter) return false;
      if (!keyword) return true;
      return [template.name, template.description, template.id, ...template.tags]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword));
    });
    return jsonOk({
      templates,
      categories: Array.from(new Set(result.templates.map((template) => template.category))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
      issues: auth.role === 'admin' ? result.issues : [],
    });
  } catch (error) {
    return templateErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const body = await readJsonBody(request, {});
    const template = await saveWorkflowAsTemplate(body as any, { userId: auth.id, role: auth.role });
    return jsonOk({ success: true, template }, { status: 201 });
  } catch (error) {
    return templateErrorResponse(error);
  }
}
