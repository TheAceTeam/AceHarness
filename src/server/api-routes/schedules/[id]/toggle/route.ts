import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { ensureSchedulerInitialized } from '@/server/api-route-runtime/scheduler-runtime';

export async function POST(_req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(_req);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const { id } = await params;
    const job = await scheduler.toggleJob(id);
    return jsonOk({ job });
  } catch (err) {
    return jsonError(errorMessage(err) || '切换定时任务状态失败', 400);
  }
}
