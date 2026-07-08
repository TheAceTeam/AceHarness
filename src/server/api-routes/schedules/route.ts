import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';
import { assertScheduleWorkflowConfig } from '@/lib/core/schedule-validation';
import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { ensureSchedulerInitialized } from '@/server/api-route-runtime/scheduler-runtime';

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    return jsonOk({ jobs: scheduler.listJobs() });
  } catch (err) {
    return jsonError(errorMessage(err) || '获取定时任务列表失败', 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    if (user instanceof Response) return user;

    await ensureSchedulerInitialized();
    const body = await readJsonBody<any>(request, {});
    await assertScheduleWorkflowConfig(body?.configFile);
    const job = await scheduler.createJob({
      ...body,
      createdBy: user.id,
      createdByName: user.username,
    });
    return jsonOk({ job });
  } catch (err) {
    return jsonError(errorMessage(err) || '创建定时任务失败', 400);
  }
}
