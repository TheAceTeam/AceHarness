import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { formatValidationIssuesForResponse, validateWorkflowDraft } from '@/lib/core/creator-validation';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { assertSubworkflowDependenciesForConfig, resolveWorkflowConfigDependencyGraph } from '@/lib/workflow/subworkflow-config';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;

    const body = await readJsonBody<Record<string, any>>(request, {});
    let config = body?.config;
    const filename = typeof body?.filename === 'string' ? body.filename.trim() : '';

    if (!config && filename) {
      const filepath = await getRuntimeWorkflowConfigPath(filename);
      config = parse(await readFile(filepath, 'utf-8'));
    }

    if (!config || typeof config !== 'object') {
      return jsonError('缺少 workflow 配置对象或 filename', 400);
    }

    const validation = validateWorkflowDraft(config);
    if (validation.ok && config?.workflow?.mode === 'state-machine') {
      try {
        if (filename) {
          await resolveWorkflowConfigDependencyGraph(filename);
        } else {
          await assertSubworkflowDependenciesForConfig(config);
        }
      } catch (error: any) {
        validation.issues.push({
          severity: 'error',
          path: ['workflow', 'subworkflow'],
          message: error?.message || '子工作流依赖校验失败',
          code: 'subworkflow_dependency',
        });
      }
    }
    return jsonOk({
      success: true,
      validation: {
        ...formatValidationIssuesForResponse(validation),
        ok: !validation.issues.some((issue) => issue.severity === 'error'),
        normalized: validation.normalized,
      },
    });
  } catch (error: any) {
    return jsonError('工作流校验失败', 500, errorMessage(error) || '未知错误');
  }
}
