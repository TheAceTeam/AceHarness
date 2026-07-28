import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { processManager } from '@/lib/core/process-manager';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { listRuns, listRunsByConfig } from '@/lib/run/store';
import { loadRunState, saveRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { existsSync } from 'fs';

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

function addText(set: Set<string>, value: unknown): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed) set.add(trimmed);
}

function collectRuntimeSessionIdsFromState(state: PersistedRunState | null | undefined, target: Set<string>): void {
  if (!state) return;
  addText(target, state.supervisorSessionId);
  for (const sessionId of Object.values(state.attachedAgentSessions || {})) addText(target, sessionId);
  for (const agent of state.agents || []) addText(target, agent.sessionId);
  for (const log of state.stepLogs || []) addText(target, log.sessionId);
  for (const question of state.humanQuestions || []) addText(target, question.supervisorSessionId);
  addText(target, state.pendingCheckpoint?.humanQuestion?.supervisorSessionId);
}

function collectLiveRuntimeSessionIds(runId: string, target: Set<string>): void {
  for (const proc of processManager.getAllProcesses()) {
    if (proc.runId === runId) addText(target, proc.sessionId);
  }
}

function collectAcpRecordIds(runtimeSessionIds: string[]): string[] {
  const recordIds = new Set<string>();
  for (const sessionId of runtimeSessionIds) addText(recordIds, sessionId);

  const dbPath = getWorkspaceDataFile('runtime-agent.sqlite');
  if (!existsSync(dbPath)) return Array.from(recordIds);

  let db: ReturnType<typeof openRuntimeSqliteDatabase> | null = null;
  try {
    db = openRuntimeSqliteDatabase(dbPath);
    const store = new RuntimeSqliteStore(db);
    for (const sessionId of runtimeSessionIds) {
      const binding = store.getPrimaryBinding(sessionId);
      addText(recordIds, binding?.externalRecordId);
      addText(recordIds, binding?.externalSessionId);
      const raw = binding?.raw as any;
      const handle = raw && typeof raw === 'object' && raw.handle && typeof raw.handle === 'object'
        ? raw.handle
        : raw;
      addText(recordIds, handle?.acpxRecordId);
      addText(recordIds, handle?.recordId);
      addText(recordIds, handle?.sessionKey);
      addText(recordIds, handle?.backendSessionId);
      addText(recordIds, handle?.sessionId);
    }
  } catch {
    // Runtime DB lookup is best-effort. The runtime session id itself remains as the fallback
    // record id because persistent ACP sessions normally use sessionKey as the record id.
  } finally {
    try { db?.close(); } catch {}
  }

  return Array.from(recordIds);
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const { configFile, runId } = body as { configFile?: string; runId?: string };
    const touchedRunIds = new Set<string>();
    const steps: StopStep[] = [{ id: 'request', label: '接收停止请求', status: 'success' }];
    const cleanupErrors: string[] = [];
    let managerStopResult: any = null;
    // Agent sweeps are scoped to the runs actually being stopped: runId -> runtimeSessionId ->
    // acpxRecordId, with workspace as a secondary guard. `hydrateLargeOutputs: false` because only
    // metadata is needed and hydrating a large run state costs hundreds of ms on this path.
    const sweepWorkspacePaths = new Set<string>();
    const sweepRunIds = new Set<string>();
    const sweepRuntimeSessionIds = new Set<string>();
    const addSweepScope = async (id: string | undefined) => {
      if (!id) return;
      sweepRunIds.add(id);
      collectLiveRuntimeSessionIds(id, sweepRuntimeSessionIds);
      const state = await loadRunState(id, { hydrateLargeOutputs: false });
      const path = state?.workingDirectory;
      if (path) sweepWorkspacePaths.add(path);
      collectRuntimeSessionIdsFromState(state, sweepRuntimeSessionIds);
    };

    if (runId) {
      await addSweepScope(runId);
      const manager = findActiveManagerByRunId(runId);
      if (manager) {
        managerStopResult = await runTimedStep(steps, 'manager-stop', '停止运行实例', async () => {
          const result = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (result === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return result;
        });
        cleanupErrors.push(...(Array.isArray(managerStopResult?.cleanupErrors) ? managerStopResult.cleanupErrors : []));
      }
      await addSweepScope(runId);
      await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
        const state = await markRunStopped(runId, cleanupErrors.length ? `用户手动停止（清理异常: ${cleanupErrors.join('; ')}）` : '用户手动停止');
        if (state) touchedRunIds.add(runId);
      });
    } else if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        await addSweepScope(activeRunId);
        managerStopResult = await runTimedStep(steps, 'manager-stop', '停止运行实例', async () => {
          const result = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (result === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return result;
        });
        cleanupErrors.push(...(Array.isArray(managerStopResult?.cleanupErrors) ? managerStopResult.cleanupErrors : []));
        await addSweepScope(activeRunId);
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
        await addSweepScope(activeRunId);
        const result = await runTimedStep(steps, `manager-stop-${activeRunId || touchedRunIds.size}`, `停止运行实例${activeRunId ? ` ${activeRunId}` : ''}`, async () => {
          const stopResult = await withTimeout(Promise.resolve((manager as any).stop?.()), STOP_TIMEOUT_MS);
          if (stopResult === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
          return stopResult;
        });
        cleanupErrors.push(...(Array.isArray((result as any)?.cleanupErrors) ? (result as any).cleanupErrors : []));
        await addSweepScope(activeRunId);
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
      await addSweepScope(run.id);
    }

    // Fail closed: sweep only the workspaces and ACP records we resolved. A stop that cannot
    // resolve both must not widen into a workspace-wide or machine-wide sweep that takes down
    // agents of unrelated runs.
    const workspacePaths = Array.from(sweepWorkspacePaths);
    const runIds = Array.from(sweepRunIds);
    const acpxRecordIds = collectAcpRecordIds(Array.from(sweepRuntimeSessionIds));
    const sweepAgentProcesses = workspacePaths.length > 0 && acpxRecordIds.length > 0;
    const { killed, pids, agentRootsMatched, registeredKilled } = await runTimedStep(steps, 'process-cleanup', '清理残留进程',
      () => processManager.killAllSystem({ sweepAgentProcesses, workspacePaths, acpxRecordIds, runIds }));
    if (workspacePaths.length === 0) {
      steps.push({
        id: 'agent-sweep-scope',
        label: '跳过 agent 进程清理（未能解析出待停止 run 的工作目录，避免误伤其他 run）',
        status: 'skipped',
      });
    } else if (acpxRecordIds.length === 0) {
      steps.push({
        id: 'agent-sweep-session-scope',
        label: '跳过 agent 进程清理（未能解析出待停止 run 的 ACP 会话，避免按目录误伤其他 run）',
        status: 'skipped',
      });
    } else if (agentRootsMatched === 0) {
      // Not an error, but nothing was reaped — show it instead of reporting plain success.
      steps.push({
        id: 'agent-sweep-empty',
        label: `未匹配到 agent 进程（已按 ${acpxRecordIds.length} 个 ACP 会话和工作目录过滤）`,
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
