import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow/registry';
import { processManager } from '@/lib/core/process-manager';
import { listRuns, listRunsByConfig } from '@/lib/run/store';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { configFile } = body as { configFile?: string };
    const touchedRunIds = new Set<string>();

    if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const runId = manager.getStatus().runId as string | undefined;
        await manager.stop();
        if (runId) touchedRunIds.add(runId);
      }
    } else {
      // Stop all running workflows
      const running = workflowRegistry.getRunningManagers();
      for (const { manager } of running) {
        const runId = manager.getStatus().runId as string | undefined;
        await manager.stop();
        if (runId) touchedRunIds.add(runId);
      }
    }

    const { killed } = await processManager.killAllSystem();

    // Fallback: if there is no active manager but run records are still marked
    // as running/preparing, force them to stopped so History view is consistent.
    const candidateRuns = configFile
      ? await listRunsByConfig(configFile)
      : await listRuns();
    for (const run of candidateRuns) {
      if (run.status !== 'running' && run.status !== 'preparing') continue;
      if (touchedRunIds.has(run.id)) continue;
      const state = await loadRunState(run.id);
      if (!state) continue;
      state.status = 'stopped';
      state.statusReason = '用户手动停止（无活跃内存实例，已执行兜底终止）';
      state.endTime = state.endTime || new Date().toISOString();
      state.processes = [];
      await saveRunState(state);
      touchedRunIds.add(run.id);
    }

    return NextResponse.json({
      success: true,
      message: killed > 0 ? `工作流已停止，清理了 ${killed} 个残留进程` : '工作流已停止',
      runIds: Array.from(touchedRunIds),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
