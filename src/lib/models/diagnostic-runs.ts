import { randomUUID } from 'crypto';
import { runModelDiagnostics } from '@/lib/models/diagnostics';
import type {
  DiagnosticLogEntry,
  ModelDiagnosticsRequest,
  ModelDiagnosticsResponse,
} from '@/lib/models/diagnostic-types';

export type DiagnosticRunLifecycleStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface ModelDiagnosticRunSnapshot {
  id: string;
  request: ModelDiagnosticsRequest;
  status: DiagnosticRunLifecycleStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  logs: DiagnosticLogEntry[];
  result?: ModelDiagnosticsResponse;
  error?: string;
}

export type ModelDiagnosticRunStreamEvent =
  | { type: 'log'; runId: string; log: DiagnosticLogEntry }
  | { type: 'progress'; runId: string; result: ModelDiagnosticsResponse }
  | { type: 'result'; runId: string; result: ModelDiagnosticsResponse }
  | { type: 'error'; runId: string; error: string };

type DiagnosticRunSubscriber = (event: ModelDiagnosticRunStreamEvent) => void;

interface ModelDiagnosticRunRecord extends ModelDiagnosticRunSnapshot {
  subscribers: Set<DiagnosticRunSubscriber>;
  abortController: AbortController;
  cancelRequested?: boolean;
}

interface DiagnosticRunStore {
  runs: Map<string, ModelDiagnosticRunRecord>;
}

const RUN_RETENTION_MS = 2 * 60 * 60 * 1000;
const MAX_FINISHED_RUNS = 30;
const REQUESTED_RUN_ID_RE = /^[a-zA-Z0-9._:-]{8,120}$/;

const globalStore = globalThis as typeof globalThis & {
  __aceModelDiagnosticRuns?: DiagnosticRunStore;
};

const store: DiagnosticRunStore = globalStore.__aceModelDiagnosticRuns || {
  runs: new Map<string, ModelDiagnosticRunRecord>(),
};
globalStore.__aceModelDiagnosticRuns = store;

function nowIso(): string {
  return new Date().toISOString();
}

function createRunId(requestedRunId?: string): string {
  const requested = String(requestedRunId || '').trim();
  if (requested && REQUESTED_RUN_ID_RE.test(requested)) return requested;
  return `diag-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function cloneRequest(input: ModelDiagnosticsRequest): ModelDiagnosticsRequest {
  return {
    engine: input.engine,
    driver: input.driver,
    model: input.model,
    timeoutMs: input.timeoutMs,
    includeEngineDebug: input.includeEngineDebug,
    includeModelScore: input.includeModelScore,
    modelCapabilityIds: Array.isArray(input.modelCapabilityIds) ? [...input.modelCapabilityIds] : undefined,
  };
}

function snapshotRun(run: ModelDiagnosticRunRecord): ModelDiagnosticRunSnapshot {
  return {
    id: run.id,
    request: cloneRequest(run.request),
    status: run.status,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    finishedAt: run.finishedAt,
    logs: [...run.logs],
    result: run.result,
    error: run.error,
  };
}

function notify(run: ModelDiagnosticRunRecord, event: ModelDiagnosticRunStreamEvent) {
  for (const subscriber of [...run.subscribers]) {
    subscriber(event);
  }
}

function cleanupRuns() {
  const cutoff = Date.now() - RUN_RETENTION_MS;
  const finished = [...store.runs.values()]
    .filter((run) => run.status !== 'running')
    .sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt));

  for (const run of finished) {
    if (Date.parse(run.updatedAt) < cutoff || finished.length > MAX_FINISHED_RUNS) {
      store.runs.delete(run.id);
      finished.shift();
    } else {
      break;
    }
  }
}

async function executeDiagnosticRun(run: ModelDiagnosticRunRecord) {
  try {
    const result = await runModelDiagnostics(run.request, {
      signal: run.abortController.signal,
      onLog: (log) => {
        run.logs.push(log);
        run.updatedAt = nowIso();
        notify(run, { type: 'log', runId: run.id, log });
      },
      onProgress: (result) => {
        run.result = result;
        run.updatedAt = nowIso();
        notify(run, { type: 'progress', runId: run.id, result });
      },
    });
    if (run.cancelRequested || run.abortController.signal.aborted) {
      if (run.status === 'running') {
        const message = '诊断任务已停止';
        run.status = 'cancelled';
        run.error = message;
        run.finishedAt = nowIso();
        run.updatedAt = run.finishedAt;
        notify(run, { type: 'error', runId: run.id, error: message });
      }
      return;
    }
    run.status = 'completed';
    run.result = result;
    run.logs = result.logs?.length ? result.logs : run.logs;
    run.finishedAt = nowIso();
    run.updatedAt = run.finishedAt;
    notify(run, { type: 'result', runId: run.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run diagnostics';
    if (run.status !== 'running') return;
    run.status = run.cancelRequested || run.abortController.signal.aborted ? 'cancelled' : 'failed';
    run.error = message;
    run.finishedAt = nowIso();
    run.updatedAt = run.finishedAt;
    notify(run, { type: 'error', runId: run.id, error: message });
  } finally {
    cleanupRuns();
  }
}

export function startModelDiagnosticRun(
  request: ModelDiagnosticsRequest,
  requestedRunId?: string,
): ModelDiagnosticRunSnapshot {
  cleanupRuns();
  const id = createRunId(requestedRunId);
  const existing = store.runs.get(id);
  if (existing) return snapshotRun(existing);

  const timestamp = nowIso();
  const run: ModelDiagnosticRunRecord = {
    id,
    request: cloneRequest(request),
    status: 'running',
    startedAt: timestamp,
    updatedAt: timestamp,
    logs: [],
    subscribers: new Set<DiagnosticRunSubscriber>(),
    abortController: new AbortController(),
  };
  store.runs.set(id, run);
  void executeDiagnosticRun(run);
  return snapshotRun(run);
}

export function cancelModelDiagnosticRun(id: string): ModelDiagnosticRunSnapshot | null {
  const run = store.runs.get(id);
  if (!run) return null;
  if (run.status !== 'running') return snapshotRun(run);
  const message = '诊断任务已停止';
  const finishedAt = nowIso();
  const terminalResult: ModelDiagnosticsResponse = {
    ok: false,
    engine: String(run.request.engine || ''),
    driver: run.request.driver || 'auto',
    model: String(run.request.model || ''),
    startedAt: run.startedAt,
    finishedAt,
    totalDurationMs: Date.now() - Date.parse(run.startedAt),
    logs: run.logs,
    error: message,
  };
  run.cancelRequested = true;
  run.status = 'cancelled';
  run.error = message;
  run.result = terminalResult;
  run.finishedAt = finishedAt;
  run.updatedAt = run.finishedAt;
  try {
    run.abortController.abort();
  } catch {
    // Best-effort cancellation.
  }
  notify(run, { type: 'result', runId: run.id, result: terminalResult });
  cleanupRuns();
  return snapshotRun(run);
}

export function getModelDiagnosticRun(id: string): ModelDiagnosticRunSnapshot | null {
  const run = store.runs.get(id);
  return run ? snapshotRun(run) : null;
}

export function subscribeModelDiagnosticRun(
  id: string,
  subscriber: DiagnosticRunSubscriber,
): (() => void) | null {
  const run = store.runs.get(id);
  if (!run) return null;
  run.subscribers.add(subscriber);
  return () => {
    run.subscribers.delete(subscriber);
  };
}
