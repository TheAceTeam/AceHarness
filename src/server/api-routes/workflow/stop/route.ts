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
    // Agent sweeps are always scoped to the workspaces of the runs actually being stopped, so that
    // stopping one run never touches agents of another. `hydrateLargeOutputs: false` because only
    // one string is needed and hydrating a large run state costs hundreds of ms on this path.
    const sweepWorkspacePaths = new Set<string>();
    const sweepRunIds = new Set<string>();
    const addSweepWorkspace = async (id: string | undefined) => {
      if (!id) return;
      sweepRunIds.add(id);
      const path = (await loadRunState(id, { hydrateLargeOutputs: false }))?.workingDirectory;
      if (path) sweepWorkspacePaths.add(path);
    };

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
      await addSweepWorkspace(runId);
      await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
        const state = await markRunStopped(runId, cleanupErrors.length ? `用户手动停止（清理异常: ${cleanupErrors.join('; ')}）` : '用户手动停止');
        if (state) touchedRunIds.add(runId);
      });
    } else if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        await addSweepWorkspace(activeRunId);
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
        await addSweepWorkspace(activeRunId);
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

    const candidateRuns = runId
      ? []
      : (configFile ? await listRunsByConfig(configFile) : await listRuns());
    for (const run of candidateRuns) {
      if (run.status !== 'running' && run.status !== 'preparing') continue;
      if (touchedRunIds.has(run.id)) continue;
      await addSweepWorkspace(run.id);
    }

    // Fail closed: sweep only the workspaces we resolved. A stop that cannot resolve any — including
    // a stop-all with no live managers — must not widen into a machine-wide sweep that takes down
    // agents of unrelated runs.
    const workspacePaths = Array.from(sweepWorkspacePaths);
    const runIds = Array.from(sweepRunIds);
    const sweepAgentProcesses = workspacePaths.length > 0;
    const { killed, pids, agentRootsMatched, registeredKilled } = await runTimedStep(steps, 'process-cleanup', '清理残留进程',
      () => processManager.killAllSystem({ sweepAgentProcesses, workspacePaths, runIds }));
    if (!sweepAgentProcesses) {
      steps.push({
        id: 'agent-sweep-scope',
        label: '跳过 agent 进程清理（未能解析出待停止 run 的工作目录，避免误伤其他 run）',
        status: 'skipped',
      });
    } else if (agentRootsMatched === 0) {
      // Not an error, but nothing was reaped — show it instead of reporting plain success.
      steps.push({
        id: 'agent-sweep-empty',
        label: `未匹配到 agent 进程（工作目录: ${workspacePaths.join(', ')}）`,
        status: 'skipped',
      });
    }

    // Fallback: if there is no active manager but run records are still marked
    // as running/preparing, force them to stopped so History view is consistent.
    for (const run of candidateRuns) {
      if (run.status !== 'running' && run.status !== 'preparing') continue;
      if (touchedRunIds.has(run.id)) continue;
      const state = await markRunStopped(run.id, '用户手动停止（无活跃内存实例，已执行兜底终止）');
      if (state) touchedRunIds.add(run.id);
    }

    const success = cleanupErrors.length === 0 && steps.every((step) => step.status !== 'failed');
    const totalKilled = killed + registeredKilled;

    return jsonOk({
      success,
      message: success
        ? (totalKilled > 0 ? `工作流已停止，清理了 ${totalKilled} 个残留进程` : '工作流已停止')
        : `工作流停止存在异常: ${cleanupErrors.join('; ') || '未知错误'}`,
      runIds: Array.from(touchedRunIds),
      steps,
      cleanupErrors,
      killed,
      pids,
      registeredKilled,
      managerStopResult,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
