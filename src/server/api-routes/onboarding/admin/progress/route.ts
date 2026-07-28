import { requireAdmin } from '@/lib/auth/middleware';
import { listOnboardingSummary } from '@/lib/core/onboarding-store';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  try {
    const rows = await listOnboardingSummary();
    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    return jsonOk({ rows, total: rows.length });
  } catch (error: any) {
    return jsonError(errorMessage(error) || '获取引导完成情况失败', 500);
  }
}
