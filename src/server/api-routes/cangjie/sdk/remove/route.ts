import { requireAdmin } from '@/lib/auth/middleware';
import { removeSdk } from '@/lib/cangjie/sdk-manager';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    await removeSdk(body.version, body.channel);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '删除 SDK 失败', 500);
  }
}
