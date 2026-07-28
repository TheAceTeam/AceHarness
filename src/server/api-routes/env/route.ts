import { loadEnvVars, saveEnvVars } from '@/lib/core/env-manager';
import { requireAuth } from '@/lib/auth/middleware';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  const scope = new URL(request.url).searchParams.get('scope') || 'system';
  if (scope === 'user') {
    const vars = await loadEnvVars({ scope: 'user', userId: auth.id });
    return jsonOk({ vars, scope: 'user' });
  }
  if (scope === 'merged') {
    const vars = await loadEnvVars({ scope: 'merged', userId: auth.id });
    return jsonOk({ vars, scope: 'merged' });
  }
  const vars = await loadEnvVars({ scope: 'system' });
  return jsonOk({ vars, scope: 'system' });
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const scope = body.scope === 'user' ? 'user' : 'system';
    if (scope === 'system' && auth.role !== 'admin') {
      return jsonError('仅管理员可修改全局环境变量', 403);
    }
    await saveEnvVars(body.vars || [], scope === 'user' ? { scope: 'user', userId: auth.id } : { scope: 'system' });
    return jsonOk({ success: true, scope });
  } catch (error: any) {
    return jsonError(errorMessage(error), 500);
  }
}
