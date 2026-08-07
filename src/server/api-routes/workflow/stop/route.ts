import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { workflowRegistry } from '@/lib/workflow/registry';
import { processManager } from '@/lib/core/process-manager';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { listRuns, listRunsByConfig } from '@/lib/run/store';
import { loadRunState, saveRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { existsSync } from 'fs';

// A cooperative manager stop only needs enough time to persist its final snapshot. If the
// runtime does not answer promptly, exact run-scoped process cleanup continues below.
const STOP_TIMEOUT_MS = 3000;
const MAX_STOP_SCOPE_RUNS = 64;
const ACTIVE_PERSISTED_CHILD_RUN_STATUSES = new Set<PersistedRunState['status']>(['preparing', 'running']);

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

async function persistStoppedRunState(state: PersistedRunState, reason: string): Promise<PersistedRunState> {
  const stoppedState: PersistedRunState = {
    ...state,
    status: 'stopped',
    statusReason: reason,
    endTime: state.endTime || new Date().toISOString(),
    currentStep: '',
    activeSteps: [],
    activeConcurrencyGroups: [],
    processes: [],
  };
  await saveRunState(stoppedState);
  return stoppedState;
}

async function markRunStopped(runId: string, reason: string): Promise<PersistedRunState | null> {
  const state = await loadRunState(runId);
  if (!state) return null;
  return persistStoppedRunState(state, reason);
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

function normalizePersistedChildRunId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const runId = value.trim();
  if (
    !runId
    || runId.includes('\0')
    || runId.includes('/')
    || runId.includes('\\')
    || /[<>:"|?*]/.test(runId)
    || runId === '.'
    || runId === '..'
  ) return null;
  return runId;
}

function getKnownChildRunIds(state: PersistedRunState): string[] {
  const children = new Map<string, { excluded: boolean }>();
  const addChild = (value: unknown, status?: unknown) => {
    const runId = normalizePersistedChildRunId(value);
    if (!runId) return;
    const child = children.get(runId) || { excluded: false };
    if (status === 'detached' || status === 'abandoned') child.excluded = true;
    children.set(runId, child);
  };

  for (const runId of state.childRunIds || []) addChild(runId);
  for (const child of state.subworkflowRuns || []) addChild(child?.runId, child?.status);
  addChild(state.activeSubworkflowRunId);

  return Array.from(children)
    .filter(([, child]) => !child.excluded)
    .map(([runId]) => runId);
}

function isActivePersistedChildRun(state: PersistedRunState, expectedRunId: string, parentRunId: string): boolean {
  if (state.runId !== expectedRunId) return false;
  if (!ACTIVE_PERSISTED_CHILD_RUN_STATUSES.has(state.status)) return false;
  const persistedParentRunId = typeof state.parentRunId === 'string' ? state.parentRunId.trim() : '';
  // Legacy child records predate parentRunId. Their parent's explicit persisted reference is the
  // ownership proof in that case; a conflicting parent linkage is never accepted.
  return !persistedParentRunId || persistedParentRunId === parentRunId;
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

type ManagerStopAttempt = {
  result: any;
  error?: string;
};

async function attemptManagerStop(manager: any): Promise<ManagerStopAttempt> {
  try {
    const result = await withTimeout(Promise.resolve(manager?.stop?.()), STOP_TIMEOUT_MS);
    if (result === null) throw new Error(`停止运行实例超过 ${STOP_TIMEOUT_MS}ms`);
    return { result };
  } catch (error) {
    return { result: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runManagerStopStep(
  steps: StopStep[],
  id: string,
  label: string,
  manager: any,
  runId?: string,
): Promise<ManagerStopAttempt> {
  const step: StopStep = { id, label, status: 'running' };
  steps.push(step);
  const startedAt = Date.now();
  const attempt = await attemptManagerStop(manager);
  try {
    if (!attempt.error) {
      const result = attempt.result;
      step.status = 'success';
      return { result };
    }
    throw new Error(attempt.error);
  } catch (error) {
    // Scope collection happens before this call. Do not let a cooperative engine timeout prevent
    // the exact ACP record cleanup that follows.
    const message = error instanceof Error ? error.message : String(error);
    step.status = 'failed';
    console.warn('[workflow/stop] manager stop failed; continuing run-scoped process cleanup', {
      runId: runId || null,
      error: message,
    });
    return { result: null, error: message };
  } finally {
    step.durationMs = Date.now() - startedAt;
  }
}

function appendManagerStopOutcome(cleanupErrors: string[], attempt: ManagerStopAttempt): void {
  if (attempt.error) {
    cleanupErrors.push('停止运行实例未完成');
    return;
  }
  cleanupErrors.push(...(Array.isArray(attempt.result?.cleanupErrors) ? attempt.result.cleanupErrors : []));
}

function collectActiveRuntimeSessionIds(runId: string, target: Set<string>): void {
  const dbPath = getWorkspaceDataFile('runtime-agent.sqlite');
  if (!existsSync(dbPath)) return;

  let db: ReturnType<typeof openRuntimeSqliteDatabase> | null = null;
  try {
    db = openRuntimeSqliteDatabase(dbPath);
    // A running workflow emits request ids as `${runId}:${agent}:${step}:...`. Runtime session
    // bindings are persisted before the ACP turn finishes, unlike run state and process records
    // which may still have no session id while an agent is blocked in a tool call. Restrict this
    // fallback to active turns so a session reused by a later run is never selected from history.
    const rows = db.prepare(`
      SELECT DISTINCT session_id
      FROM runtime_turns
      WHERE status IN ('queued', 'running', 'canceling')
        AND substr(request_id, 1, length(?) + 1) = ? || ':'
    `).all(runId, runId) as Array<{ session_id?: unknown }>;
    for (const row of rows) addText(target, row.session_id);
  } catch (error) {
    console.warn('[workflow/stop] failed to resolve active runtime sessions for ACPX cleanup', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    try { db?.close(); } catch {}
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
    // Agent sweeps are scoped to the requested run and its known active, non-detached descendants:
    // runId -> runtimeSessionId -> acpxRecordId, with workspace as a secondary guard when
    // metadata is available.
    // `hydrateLargeOutputs: false` because only metadata is needed and hydrating a large run state
    // costs hundreds of ms on this path.
    const sweepWorkspacePaths = new Set<string>();
    const sweepRunIds = new Set<string>();
    const sweepRuntimeSessionIds = new Set<string>();
    const visitedSweepRunIds = new Set<string>();
    const sweepScopeRunCounts = new Map<string, number>();
    const sweepScopeCapRoots = new Set<string>();
    const scopedActiveDescendantStates = new Map<string, PersistedRunState>();

    const loadSweepState = async (id: string): Promise<PersistedRunState | null> => {
      try {
        return await loadRunState(id, { hydrateLargeOutputs: false });
      } catch (error) {
        console.warn('[workflow/stop] failed to load persisted run state for cleanup scope', {
          runId: id,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    };

    const collectSweepMetadata = (id: string, state: PersistedRunState | null) => {
      collectLiveRuntimeSessionIds(id, sweepRuntimeSessionIds);
      collectActiveRuntimeSessionIds(id, sweepRuntimeSessionIds);
      const path = state?.workingDirectory;
      if (path) sweepWorkspacePaths.add(path);
      collectRuntimeSessionIdsFromState(state, sweepRuntimeSessionIds);
    };

    const addSweepScope = async (
      id: string | undefined,
      parentRunId?: string,
      rootRunId?: string,
    ): Promise<void> => {
      const scopedRunId = typeof id === 'string' ? id.trim() : '';
      if (!scopedRunId) return;
      const scopeRootRunId = rootRunId || scopedRunId;

      if (visitedSweepRunIds.has(scopedRunId)) {
        // Preserve the existing before/after-manager-stop metadata capture without re-expanding a
        // parent after it has persisted a detached child reference.
        if (!parentRunId) collectSweepMetadata(scopedRunId, await loadSweepState(scopedRunId));
        return;
      }
      if ((sweepScopeRunCounts.get(scopeRootRunId) || 0) >= MAX_STOP_SCOPE_RUNS) {
        if (!sweepScopeCapRoots.has(scopeRootRunId)) {
          sweepScopeCapRoots.add(scopeRootRunId);
          console.warn('[workflow/stop] child cleanup scope reached its bounded run limit', {
            rootRunId: scopeRootRunId,
            maxRuns: MAX_STOP_SCOPE_RUNS,
          });
        }
        return;
      }

      visitedSweepRunIds.add(scopedRunId);
      const state = await loadSweepState(scopedRunId);
      if (parentRunId && (!state || !isActivePersistedChildRun(state, scopedRunId, parentRunId))) {
        console.info('[workflow/stop] excluded persisted child from run-scoped cleanup', {
          parentRunId,
          childRunId: scopedRunId,
          reason: !state
            ? 'missing-state'
            : state.runId !== scopedRunId
              ? 'run-id-mismatch'
              : !ACTIVE_PERSISTED_CHILD_RUN_STATUSES.has(state.status)
                ? 'inactive-state'
                : 'parent-link-mismatch',
        });
        return;
      }

      sweepRunIds.add(scopedRunId);
      sweepScopeRunCounts.set(scopeRootRunId, (sweepScopeRunCounts.get(scopeRootRunId) || 0) + 1);
      if (parentRunId && state) scopedActiveDescendantStates.set(scopedRunId, state);
      collectSweepMetadata(scopedRunId, state);
      if (!state) return;
      for (const childRunId of getKnownChildRunIds(state)) {
        if (childRunId === scopedRunId) continue;
        await addSweepScope(childRunId, scopedRunId, scopeRootRunId);
      }
    };

    if (runId) {
      await addSweepScope(runId);
      const manager = findActiveManagerByRunId(runId);
      if (manager) {
        const attempt = await runManagerStopStep(steps, 'manager-stop', '停止运行实例', manager, runId);
        appendManagerStopOutcome(cleanupErrors, attempt);
      }
      await addSweepScope(runId);
      await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
        const state = await markRunStopped(runId, cleanupErrors.length ? '用户手动停止（部分清理未完成）' : '用户手动停止');
        if (state) touchedRunIds.add(runId);
      });
    } else if (configFile) {
      const manager = workflowRegistry.getRunningManager(configFile);
      if (manager) {
        const activeRunId = manager.getStatus().runId as string | undefined;
        await addSweepScope(activeRunId);
        const attempt = await runManagerStopStep(steps, 'manager-stop', '停止运行实例', manager, activeRunId);
        appendManagerStopOutcome(cleanupErrors, attempt);
        await addSweepScope(activeRunId);
        if (activeRunId) {
          await runTimedStep(steps, 'state-persist', '落盘停止状态', async () => {
            const state = await markRunStopped(activeRunId, cleanupErrors.length ? '用户手动停止（部分清理未完成）' : '用户手动停止');
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
        const attempt = await runManagerStopStep(
          steps,
          `manager-stop-${activeRunId || touchedRunIds.size}`,
          `停止运行实例${activeRunId ? ` ${activeRunId}` : ''}`,
          manager,
          activeRunId,
        );
        appendManagerStopOutcome(cleanupErrors, attempt);
        await addSweepScope(activeRunId);
        if (activeRunId) {
          const state = await markRunStopped(activeRunId, cleanupErrors.length ? '用户手动停止（部分清理未完成）' : '用户手动停止');
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

    // Scope capture proves every entry here belongs to the stopped parent before its manager can
    // close ACPX sessions. Coordinate child managers as a separate best-effort operation, then
    // persist stopped states so a surviving manager/process cannot leave History reporting running.
    await Promise.all(Array.from(scopedActiveDescendantStates.entries()).reverse().map(async ([childRunId, capturedState]) => {
      const childManager = findActiveManagerByRunId(childRunId);
      if (childManager) {
        const attempt = await attemptManagerStop(childManager);
        const childCleanupErrorCount = Array.isArray(attempt.result?.cleanupErrors)
          ? attempt.result.cleanupErrors.length
          : 0;
        if (attempt.error || childCleanupErrorCount > 0) {
          cleanupErrors.push('子工作流停止未完全完成');
          console.warn('[workflow/stop] descendant manager stop reported an error', {
            runId: childRunId,
            error: attempt.error || null,
            cleanupErrorCount: childCleanupErrorCount,
          });
        }
      }

      // Re-read after manager.stop() to preserve its latest run metadata. A transient read failure
      // falls back to the exact state captured above, rather than leaving a proven child running.
      const latestState = await loadSweepState(childRunId);
      const stateToPersist = latestState?.runId === childRunId ? latestState : capturedState;
      try {
        await persistStoppedRunState(stateToPersist, '父工作流停止时终止子工作流');
        touchedRunIds.add(childRunId);
      } catch (error) {
        cleanupErrors.push('子工作流停止状态未落盘');
        console.warn('[workflow/stop] failed to persist descendant stopped state', {
          runId: childRunId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }));

    // Fail closed: run-scoped cleanup requires at least one exact ACP record id. A workspace path
    // remains an additional guard when it is known, but a missing path must not disable a cleanup
    // whose runtime-session chain already proves ownership. There is never a workspace-only or
    // machine-wide ACP sweep here.
    const workspacePaths = Array.from(sweepWorkspacePaths);
    const runIds = Array.from(sweepRunIds);
    const acpxRecordIds = collectAcpRecordIds(Array.from(sweepRuntimeSessionIds));
    const sweepAgentProcesses = acpxRecordIds.length > 0;
    const { killed, agentRootsMatched, registeredKilled } = await runTimedStep(steps, 'process-cleanup', '清理残留进程',
      () => processManager.killAllSystem({ sweepAgentProcesses, workspacePaths, acpxRecordIds, runIds }));
    if (!sweepAgentProcesses) {
      console.warn('[workflow/stop] ACPX cleanup skipped because no run-scoped ACP record was resolved', {
        runCount: runIds.length,
        workspaceCount: workspacePaths.length,
      });
    } else if (agentRootsMatched === 0) {
      console.info('[workflow/stop] ACPX cleanup found no eligible live agent root', {
        runCount: runIds.length,
        workspaceCount: workspacePaths.length,
        recordCount: acpxRecordIds.length,
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

    if (cleanupErrors.length > 0) {
      console.warn('[workflow/stop] workflow cleanup reported errors', {
        runCount: runIds.length,
        errors: cleanupErrors,
      });
    }

    return jsonOk({
      success,
      message: success
        ? (totalKilled > 0 ? `工作流已停止，清理了 ${totalKilled} 个残留进程` : '工作流已停止')
        : '工作流停止未完全完成，请检查运行状态后重试',
      runIds: Array.from(touchedRunIds),
      steps,
      killed,
      registeredKilled,
    });
  } catch (error: any) {
    return jsonOk(
      { error: '停止工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
