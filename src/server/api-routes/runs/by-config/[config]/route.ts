import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { listRunsByConfig } from '@/lib/run/store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { isProcessAlive, loadRunState, saveRunState } from '@/lib/run/state-persistence';

export async function GET(
  request: Request,
  { params }: { params: { config: string } | Promise<{ config: string }> }
) {
  try {
    const config = (await params).config;
    const configFile = decodeURIComponent(config);
    const runs = await listRunsByConfig(configFile);
    const shouldRepair = requestUrl(request).searchParams.get('repair') === '1';
    if (!shouldRepair) {
      return jsonOk({ runs });
    }

    // Repair stale "running/preparing" runs in history:
    // if run is not active in memory and has no alive processes, mark it stopped.
    const activeRunIds = new Set(
      workflowRegistry
        .getRunningManagers()
        .filter((entry) => entry.configFile === configFile)
        .map((entry) => entry.manager.getStatus().runId)
        .filter(Boolean) as string[]
    );

    for (const run of runs) {
      if (run.status !== 'running' && run.status !== 'preparing') continue;
      if (activeRunIds.has(run.id)) continue;

      const state = await loadRunState(run.id);
      if (!state) continue;
      const hasAlive = (state.processes || []).some((p) => isProcessAlive(p.pid));

      if (!hasAlive) {
        state.status = 'stopped';
        state.statusReason = state.statusReason || '历史查询自动纠偏：未检测到活跃进程';
        state.endTime = state.endTime || new Date().toISOString();
        state.processes = [];
        await saveRunState(state);
        run.status = 'stopped';
      }
    }

    return jsonOk({ runs });
  } catch (error: any) {
    return jsonOk(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
