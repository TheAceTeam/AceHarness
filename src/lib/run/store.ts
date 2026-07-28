import { mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { deleteChatSessionsByWorkflowRun } from '@/lib/chat/persistence';
import {
  buildRunSummaryCacheFromRecord,
  ensureRunSummaryCache,
  listRunSummaryCaches,
  saveRunSummaryCache,
  type RunSummaryCache,
} from '@/lib/run/summary-cache';

const RUNS_DIR = getWorkspaceRunsDir();

export interface RunRecord {
  id: string;
  configFile: string;
  configName: string;
  startTime: string;
  endTime: string | null;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' | 'crashed' | 'pending' | string;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
}

async function ensureRunsDir() {
  if (!existsSync(RUNS_DIR)) {
    await mkdir(RUNS_DIR, { recursive: true });
  }
}

function runRecordFromSummary(summary: RunSummaryCache): RunRecord {
  return {
    id: summary.runId,
    configFile: summary.configFile,
    configName: summary.configName || summary.configFile,
    startTime: summary.startTime,
    endTime: summary.endTime,
    status: summary.status,
    currentPhase: summary.currentPhase,
    totalSteps: summary.totalSteps,
    completedSteps: summary.completedSteps,
    inputTokens: summary.tokenUsage.inputTokens,
    outputTokens: summary.tokenUsage.outputTokens,
    cacheCreationInputTokens: summary.tokenUsage.cacheCreationInputTokens,
    cacheReadInputTokens: summary.tokenUsage.cacheReadInputTokens,
    totalTokens: summary.totalTokens,
  };
}

/**
 * createRun — 只创建目录，state.yaml 由 persistState 写入
 */
export async function createRun(record: RunRecord): Promise<void> {
  await ensureRunsDir();
  const runDir = resolve(RUNS_DIR, record.id);
  if (!existsSync(runDir)) {
    await mkdir(runDir, { recursive: true });
  }
  const summary = buildRunSummaryCacheFromRecord(record);
  if (summary) {
    await saveRunSummaryCache(summary).catch(() => {});
  }
}

/**
 * updateRun — 不再需要，状态全部由 state.yaml 管理
 * 保留空实现以兼容调用方
 */
export async function updateRun(_id: string, _patch: Partial<RunRecord>): Promise<void> {
  // No-op: all state is persisted via state.yaml by workflow-manager.persistState()
}

export async function getRun(id: string): Promise<RunRecord | null> {
  const summary = await ensureRunSummaryCache(id);
  return summary ? runRecordFromSummary(summary) : null;
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureRunsDir();
  const runs = (await listRunSummaryCaches()).map(runRecordFromSummary);

  runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return runs;
}

export async function listRunsByConfig(configFile: string): Promise<RunRecord[]> {
  const runs = (await listRunSummaryCaches())
    .filter((summary) => summary.configFile === configFile)
    .map(runRecordFromSummary);

  runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return runs;
}

export async function deleteRunsByConfig(configFile: string): Promise<{ deletedCount: number; runIds: string[] }> {
  const runs = await listRunsByConfig(configFile);
  const runIds = runs.map((run) => run.id);
  for (const runId of runIds) {
    await deleteRun(runId);
  }
  return { deletedCount: runIds.length, runIds };
}

export async function deleteRun(id: string): Promise<void> {
  const runDir = resolve(RUNS_DIR, id);
  if (existsSync(runDir)) {
    await rm(runDir, { recursive: true, force: true });
  }
  await deleteChatSessionsByWorkflowRun(id).catch((error) => {
    console.warn(`[run-store] failed to delete chat sessions for run ${id}:`, error);
  });
}
