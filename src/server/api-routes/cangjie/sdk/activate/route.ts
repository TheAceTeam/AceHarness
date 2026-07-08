import { requireAdmin } from '@/lib/auth/middleware';
import { activateSdk, deactivateSdk } from '@/lib/cangjie/sdk-manager';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    if (body.deactivate) {
      await deactivateSdk();
      return jsonOk({ success: true });
    }
    await activateSdk(body.version, body.channel);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '操作失败', 500);
  }
}
