import { listRuns, createRun } from '@/lib/run/store';
import type { RunRecord } from '@/lib/run/store';
import { formatTimestamp } from '@/lib/core/utils';
import { requireAuth } from '@/lib/auth/middleware';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request) {
  const user = await requireAuth(request);
  try {
    const allRuns = await listRuns();
    // Admin sees all, user sees public + own
    let runs = allRuns;
    if (!(user instanceof Response) && user.role !== 'admin') {
      runs = allRuns.filter((r: any) =>
        r.visibility !== 'private' || r.createdBy === user.id
      );
    }
    return jsonOk({ runs });
  } catch (error: any) {
    return jsonOk(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  try {
    const body = await readJsonBody<any>(request, {});
    const record: RunRecord = {
      id: `run-${formatTimestamp()}`,
      configFile: body.configFile,
      configName: body.configName || body.configFile,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'running',
      currentPhase: null,
      totalSteps: body.totalSteps || 0,
      completedSteps: 0,
    };
    // Add createdBy if authenticated
    if (!(user instanceof Response)) {
      (record as any).createdBy = user.id;
    }
    await createRun(record);
    return jsonOk({ success: true, id: record.id });
  } catch (error: any) {
    return jsonOk(
      { error: '创建运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
