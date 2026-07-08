import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { ensureSchedulerInitialized } from '@/server/api-route-runtime/scheduler-runtime';
import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';

export async function POST(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const { id } = await params;
    const result = await scheduler.triggerNow(id, user, { baseUrl: requestUrl(req).origin });
    if (result.status !== 'started') {
      return jsonOk(
        { success: false, ...result, error: result.error || '触发定时任务失败' },
        { status: 502 }
      );
    }
    return jsonOk({ success: true, ...result });
  } catch (err) {
    return jsonError(errorMessage(err) || '触发定时任务失败', 400);
  }
}
