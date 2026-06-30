import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import {
  loadRunState,
  saveRunState,
  type PersistedRunState,
  type PersistedSubworkflowRunRef,
} from '@/lib/run/state-persistence';
import { pruneWorkflowAuditLog } from '@/lib/workflow/audit-log';

export interface WorkflowRetentionOptions {
  detachedMaxAgeMs?: number;
  auditMaxEvents?: number;
  auditMaxAgeMs?: number;
  dryRun?: boolean;
  now?: Date;
}

export interface WorkflowRetentionResult {
  scannedRuns: number;
  updatedRuns: number;
  abandonedDetachedChildren: Array<{
    parentRunId: string;
    childRunId: string;
    configFile: string;
    detachedAt?: string;
  }>;
  auditLogs: Array<{
    runId: string;
    before: number;
    after: number;
    pruned: number;
  }>;
}

function refAgeTimestamp(ref: PersistedSubworkflowRunRef): string | undefined {
  return ref.endedAt || ref.startedAt;
}

function isExpiredDetached(ref: PersistedSubworkflowRunRef, maxAgeMs: number, now: Date): boolean {
  if (ref.status !== 'detached') return false;
  const timestamp = refAgeTimestamp(ref);
  if (!timestamp) return false;
  const time = new Date(timestamp).getTime();
  return Number.isFinite(time) && now.getTime() - time >= maxAgeMs;
}

async function listRunIds(): Promise<string[]> {
  const runsDir = getWorkspaceRunsDir();
  if (!existsSync(runsDir)) return [];
  const entries = await readdir(runsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(resolve(runsDir, name, 'state.yaml')));
}

export async function applyWorkflowRunRetention(options: WorkflowRetentionOptions = {}): Promise<WorkflowRetentionResult> {
  const now = options.now || new Date();
  const dryRun = options.dryRun !== false;
  const detachedMaxAgeMs = Math.max(1, options.detachedMaxAgeMs || 7 * 24 * 60 * 60 * 1000);
  const runIds = await listRunIds();
  const result: WorkflowRetentionResult = {
    scannedRuns: 0,
    updatedRuns: 0,
    abandonedDetachedChildren: [],
    auditLogs: [],
  };

  for (const runId of runIds) {
    const state = await loadRunState(runId);
    if (!state) continue;
    result.scannedRuns += 1;
    let changed = false;
    const subworkflowRuns = (state.subworkflowRuns || []).map((ref) => {
      if (!isExpiredDetached(ref, detachedMaxAgeMs, now)) return ref;
      result.abandonedDetachedChildren.push({
        parentRunId: state.runId,
        childRunId: ref.runId,
        configFile: ref.configFile,
        detachedAt: refAgeTimestamp(ref),
      });
      changed = true;
      return {
        ...ref,
        status: 'abandoned' as const,
        endedAt: ref.endedAt || now.toISOString(),
        error: ref.error || 'Detached child run exceeded retention window and was marked abandoned.',
      };
    });
    if (changed && !dryRun) {
      await saveRunState({ ...state, subworkflowRuns } as PersistedRunState);
      result.updatedRuns += 1;
    } else if (changed) {
      result.updatedRuns += 1;
    }

    if ((options.auditMaxEvents || options.auditMaxAgeMs) && !dryRun) {
      result.auditLogs.push(await pruneWorkflowAuditLog(runId, {
        maxEvents: options.auditMaxEvents,
        maxAgeMs: options.auditMaxAgeMs,
        now,
      }));
    }
  }

  return result;
}
