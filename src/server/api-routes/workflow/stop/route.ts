import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { processManager } from '@/lib/core/process-manager';
import { listRuns, listRunsByConfig } from '@/lib/run/store';
import { loadRunState, saveRunState, type PersistedRunState } from '@/lib/run/state-persistence';

const STOP_TIMEOUT_MS = 8000;

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

type StopStep = {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  detail?: string;
  durationMs?: number;
};

async function runTimedStep<T>(steps: StopStep[], id: string, label: string, action: () => Promise<T>): Promise<T> {
  const step: StopStep = { id, label, status: 'running' };
  steps.push(step);
  const startedAt = Date.now();
  try {
    const result = await action();
    step.status = 'success';
    return result;
  } catch (error) {
    step.status = 'failed';
    step.detail = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    step.durationMs = Date.now() - startedAt;
  }
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
    const steps: StopStep[] = [{ id: 'request', label: '接收停止请求', status: 'success' }];
    const cleanupErrors: string[] = [];
    let managerStopResult: any = null;

    if (runId) {
      const manager = findActiveManagerByRunId(runId);
      if (manager) {
        managerStopResult = await runTimedStep(steps, 'manager-stop', '停止运行实例', async () => {
          const result = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (result === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return result;
        });
        cleanupErrors.push(...(Array.isArray(managerStopResult?.cleanupErrors) ? managerStopResult.cleanupErrors : []));
      }
      await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
        const state = await markRunStopped(runId, cleanupErrors.length ? `用户手动停止（清理异常: ${cleanupErrors.join('; ')}）` : '用户手动停止');
        if (state) touchedRunIds.add(runId);
      });
    } else if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        managerStopResult = await runTimedStep(steps, 'manager-stop', '停止运行实例', async () => {
          const result = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (result === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return result;
        });
        cleanupErrors.push(...(Array.isArray(managerStopResult?.cleanupErrors) ? managerStopResult.cleanupErrors : []));
        if (activeRunId) {
          await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
            const state = await markRunStopped(activeRunId, cleanupErrors.length ? `用户手动停止（清理异常: ${cleanupErrors.join('; ')}）` : '用户手动停止');
            if (state) touchedRunIds.add(activeRunId);
          });
        }
      }
    } else {
      // Stop all running workflows
      const running = workflowRegistry.getRunningManagers();
      for (const { manager } of running) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        const result = await runTimedStep(steps, `manager-stop-${activeRunId || touchedRunIds.size}`, `停止运行实例${activeRunId ? ` ${activeRunId}` : ''}`, async () => {
          const stopResult = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (stopResult === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return stopResult;
        });
        cleanupErrors.push(...(Array.isArray((result as any)?.cleanupErrors) ? (result as any).cleanupErrors : []));
        if (activeRunId) {
          const state = await markRunStopped(activeRunId, cleanupErrors.length ? `用户手动停止（清理异常: ${cleanupErrors.join('; ')}）` : '用户手动停止');
          if (state) touchedRunIds.add(activeRunId);
        }
      }
    }

    const { killed, pids } = await runTimedStep(steps, 'process-cleanup', '清理残留进程', () => processManager.killAllSystem());

    // Fallback: if there is no active manager but run records are still marked
    // as running/preparing, force them to stopped so History view is consistent.
    const candidateRuns = configFile
      ? await listRunsByConfig(configFile)
      : await listRuns();
    for (const run of candidateRuns) {
      if (run.status !== 'running' && run.status !== 'preparing') continue;
      if (touchedRunIds.has(run.id)) continue;
      const state = await markRunStopped(run.id, '用户手动停止（无活跃内存实例，已执行兜底终止）');
      if (state) touchedRunIds.add(run.id);
    }

    const success = cleanupErrors.length === 0 && steps.every((step) => step.status !== 'failed');

    return jsonOk({
      success,
      message: success
        ? (killed > 0 ? `工作流已停止，清理了 ${killed} 个残留进程` : '工作流已停止')
        : `工作流停止存在异常: ${cleanupErrors.join('; ') || '未知错误'}`,
      runIds: Array.from(touchedRunIds),
      steps,
      cleanupErrors,
      killed,
      pids,
      managerStopResult,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
