import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { getWorkflowPreflightPlan, runWorkflowPreflight } from '@/lib/workflow/preflight';

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<any>(request, {});
    const configFile = String(body?.configFile || '').trim();
    if (!configFile) {
      return jsonOk({ error: '缺少配置文件参数' }, { status: 400 });
    }
    const workingDirectory = typeof body?.workingDirectory === 'string' ? body.workingDirectory.trim() : undefined;

    const result = await runWorkflowPreflight(configFile, user.personalDir || '', workingDirectory);
    return jsonOk(result);
  } catch (error: any) {
    return jsonOk(
      { error: error?.message || '执行 preflight 失败' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const body = await readJsonBody<any>(request, {});
    const configFile = String(body?.configFile || '').trim();
    if (!configFile) {
      return jsonOk({ error: '缺少配置文件参数' }, { status: 400 });
    }
    const workingDirectory = typeof body?.workingDirectory === 'string' ? body.workingDirectory.trim() : undefined;

    const result = await getWorkflowPreflightPlan(configFile, user.personalDir || '', workingDirectory);
    return jsonOk(result);
  } catch (error: any) {
    return jsonOk(
      { error: error?.message || '获取 preflight 预览失败' },
      { status: 500 }
    );
  }
}
