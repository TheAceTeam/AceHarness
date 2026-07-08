import { requireAdmin, requireAuth } from '@/lib/auth/middleware';
import { getSdkOverview } from '@/lib/cangjie/sdk-manager';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const overview = await getSdkOverview();
    return jsonOk(overview);
  } catch (error: any) {
    return jsonError(errorMessage(error) || '获取 SDK 列表失败', 500);
  }
}
