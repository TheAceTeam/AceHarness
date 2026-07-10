import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { processManager } from '@/lib/core/process-manager';
import { listRuns, listRunsByConfig } from '@/lib/run/store';
import { loadRunState, saveRunState, type PersistedRunState } from '@/lib/run/state-persistence';

const MANAGER_STOP_TIMEOUT_MS = 5000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function markRunStopped(runId: string, reason: string): Promise<PersistedRunState | null> {
  const state = await loadRunState(runId);
  if (!state) return null;
  state.status = 'stopped';
  state.statusReason = reason;
  state.endTime = state.endTime || new Date().toISOString();
  state.currentStep = '';
  state.activeSteps = [];
  state.activeConcurrencyGroups = [];
  state.processes = [];
  await saveRunState(state);
  return state;
}

function findActiveManagerByRunId(runId: string) {
  return workflowRegistry
    .getRunningManagers()
    .map((entry) => entry.manager)
    .find((manager) => manager.getStatus().runId === runId) || null;
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { configFile, runId } = body as { configFile?: string; runId?: string };
    const touchedRunIds = new Set<string>();
    const timedOutRunIds = new Set<string>();

    if (runId) {
      const state = await markRunStopped(runId, '用户手动停止');
      if (state) touchedRunIds.add(runId);
    }

    if (runId) {
      const manager = findActiveManagerByRunId(runId);
      if (manager) {
        const stopped = await withTimeout(manager.stop().catch(() => null), MANAGER_STOP_TIMEOUT_MS);
        if (stopped === null) timedOutRunIds.add(runId);
      }
    } else if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        if (activeRunId) {
          await markRunStopped(activeRunId, '用户手动停止');
          touchedRunIds.add(activeRunId);
        }
        const stopped = await withTimeout(manager.stop().catch(() => null), MANAGER_STOP_TIMEOUT_MS);
        if (stopped === null && activeRunId) timedOutRunIds.add(activeRunId);
      }
    } else {
      // Stop all running workflows
      const running = workflowRegistry.getRunningManagers();
      for (const { manager } of running) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        if (activeRunId) {
          await markRunStopped(activeRunId, '用户手动停止');
          touchedRunIds.add(activeRunId);
        }
        const stopped = await withTimeout(manager.stop().catch(() => null), MANAGER_STOP_TIMEOUT_MS);
        if (stopped === null && activeRunId) timedOutRunIds.add(activeRunId);
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
      await markRunStopped(run.id, '用户手动停止（无活跃内存实例，已执行兜底终止）');
      touchedRunIds.add(run.id);
    }

    for (const runId of touchedRunIds) {
      await markRunStopped(
        runId,
        timedOutRunIds.has(runId)
          ? '用户手动停止（内存停止超时，已强制落盘）'
          : '用户手动停止'
      );
    }

    return jsonOk({
      success: true,
      message: timedOutRunIds.size > 0
        ? `工作流已标记停止，${timedOutRunIds.size} 个内存实例仍在后台清理`
        : killed > 0
          ? `工作流已停止，清理了 ${killed} 个残留进程`
          : '工作流已停止',
      runIds: Array.from(touchedRunIds),
      timedOutRunIds: Array.from(timedOutRunIds),
    });
  } catch (error: any) {
    return jsonOk(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
