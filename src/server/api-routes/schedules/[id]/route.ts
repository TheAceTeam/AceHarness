import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';
import { assertScheduleWorkflowConfig } from '@/lib/core/schedule-validation';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { ensureSchedulerInitialized } from '@/server/api-route-runtime/scheduler-runtime';

export async function GET(_req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(_req);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const { id } = await params;
    const job = scheduler.getJob(id);
    if (!job) return jsonError('Job not found', 404);
    return jsonOk({ job });
  } catch (err) {
    return jsonError(errorMessage(err) || '获取定时任务失败', 500);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const { id } = await params;
    const body = await readJsonBody<Record<string, any>>(req, {});
    if (body?.configFile) {
      await assertScheduleWorkflowConfig(body.configFile);
    }
    const job = await scheduler.updateJob(id, body);
    return jsonOk({ job });
  } catch (err) {
    return jsonError(errorMessage(err) || '更新定时任务失败', 400);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(_req);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const { id } = await params;
    await scheduler.deleteJob(id);
    return jsonOk({ success: true });
  } catch (err) {
    return jsonError(errorMessage(err) || '删除定时任务失败', 400);
  }
}
