import { NextRequest, NextResponse } from 'next/server';
import { listRunsByConfig } from '@/lib/run/store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { isProcessAlive, loadRunState, saveRunState } from '@/lib/run/state-persistence';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ config: string }> }
) {
  try {
    const config = (await params).config;
    const configFile = decodeURIComponent(config);
    const runs = await listRunsByConfig(configFile);
    const shouldRepair = request.nextUrl.searchParams.get('repair') === '1';
    if (!shouldRepair) {
      return NextResponse.json({ runs });
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

    return NextResponse.json({ runs });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
