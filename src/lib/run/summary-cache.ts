import { existsSync } from 'fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';
import type { PersistedRunState } from '@/lib/run/state-persistence';

const RUNS_DIR = getWorkspaceRunsDir();
const SUMMARY_CACHE_FILE = 'summary.json';
const SUMMARY_CACHE_VERSION = 1;

export interface RunSummaryTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface RunSummaryAgentUsage {
  calls: number;
  cost: number;
}

export interface RunSummaryCache {
  version: typeof SUMMARY_CACHE_VERSION;
  id: string;
  runId: string;
  configFile: string;
  configName: string;
  startTime: string;
  endTime: string | null;
  status: string;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  tokenUsage: RunSummaryTokenUsage;
  totalTokens: number;
  cost: number;
  ownerId: string;
  ownerName: string;
  agentUsage: Record<string, RunSummaryAgentUsage>;
  source: 'state' | 'final-review' | 'record';
  updatedAt: string;
}

function runDir(runId: string): string {
  return resolve(RUNS_DIR, runId);
}

function stateFilePath(runId: string): string {
  return resolve(runDir(runId), 'state.yaml');
}

export function runSummaryCachePath(runId: string): string {
  return resolve(runDir(runId), SUMMARY_CACHE_FILE);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function emptyTokenUsage(): RunSummaryTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
  };
}

function readTokenUsage(source: any): RunSummaryTokenUsage {
  const usage = source?.tokenUsage || source || {};
  return {
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
    cacheCreationInputTokens: numberOrZero(usage.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrZero(usage.cacheReadInputTokens),
  };
}

function addUsage(target: RunSummaryTokenUsage, usage: RunSummaryTokenUsage): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.cacheReadInputTokens += usage.cacheReadInputTokens;
}

function totalTokens(usage: RunSummaryTokenUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

function getRunTokenUsage(state: any): { usage: RunSummaryTokenUsage; cost: number } {
  const usage = emptyTokenUsage();
  let cost = 0;

  if (Array.isArray(state?.stepLogs) && state.stepLogs.length > 0) {
    for (const log of state.stepLogs) {
      addUsage(usage, readTokenUsage(log));
      cost += numberOrZero(log?.costUsd);
    }
    return { usage, cost };
  }

  if (Array.isArray(state?.agents)) {
    for (const agent of state.agents) {
      addUsage(usage, readTokenUsage(agent));
      cost += numberOrZero(agent?.costUsd);
    }
  }

  return { usage, cost };
}

function getAgentUsage(state: any): Record<string, RunSummaryAgentUsage> {
  const agentUsage: Record<string, RunSummaryAgentUsage> = {};

  if (Array.isArray(state?.stepLogs)) {
    for (const log of state.stepLogs) {
      const agent = stringValue(log?.agent);
      if (!agent) continue;
      if (!agentUsage[agent]) agentUsage[agent] = { calls: 0, cost: 0 };
      agentUsage[agent].calls += 1;
      agentUsage[agent].cost += numberOrZero(log?.costUsd);
    }
  }

  if (Array.isArray(state?.agents)) {
    for (const agentState of state.agents) {
      const agent = stringValue(agentState?.name);
      if (!agent) continue;
      if (!agentUsage[agent]) agentUsage[agent] = { calls: 0, cost: 0 };
      if (agentUsage[agent].calls === 0) {
        agentUsage[agent].calls = numberOrZero(agentState?.completedTasks);
        agentUsage[agent].cost = numberOrZero(agentState?.costUsd);
      }
    }
  }

  return agentUsage;
}

function normalizeSummary(input: any): RunSummaryCache | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const runId = stringValue(input.runId) || stringValue(input.id);
  const configFile = stringValue(input.configFile);
  if (!runId || !configFile) return null;
  const tokenUsage = {
    ...emptyTokenUsage(),
    ...(input.tokenUsage && typeof input.tokenUsage === 'object' ? input.tokenUsage : {}),
  };
  const normalizedUsage = {
    inputTokens: numberOrZero(tokenUsage.inputTokens),
    outputTokens: numberOrZero(tokenUsage.outputTokens),
    cacheCreationInputTokens: numberOrZero(tokenUsage.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrZero(tokenUsage.cacheReadInputTokens),
  };
  return {
    version: SUMMARY_CACHE_VERSION,
    id: runId,
    runId,
    configFile,
    configName: stringValue(input.configName) || configFile,
    startTime: stringValue(input.startTime),
    endTime: stringValue(input.endTime) || null,
    status: stringValue(input.status) || 'unknown',
    currentPhase: stringValue(input.currentPhase) || null,
    totalSteps: numberOrZero(input.totalSteps),
    completedSteps: numberOrZero(input.completedSteps),
    failedSteps: numberOrZero(input.failedSteps),
    tokenUsage: normalizedUsage,
    totalTokens: numberOrZero(input.totalTokens) || totalTokens(normalizedUsage),
    cost: numberOrZero(input.cost),
    ownerId: stringValue(input.ownerId),
    ownerName: stringValue(input.ownerName),
    agentUsage: normalizeAgentUsage(input.agentUsage),
    source: input.source === 'final-review' || input.source === 'record' ? input.source : 'state',
    updatedAt: stringValue(input.updatedAt) || new Date(0).toISOString(),
  };
}

function normalizeAgentUsage(input: unknown): Record<string, RunSummaryAgentUsage> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const result: Record<string, RunSummaryAgentUsage> = {};
  for (const [agent, value] of Object.entries(input)) {
    if (!agent || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    result[agent] = {
      calls: numberOrZero((value as any).calls),
      cost: numberOrZero((value as any).cost),
    };
  }
  return result;
}

function isValidRunState(state: any): state is PersistedRunState {
  return !!state && typeof state === 'object' && !Array.isArray(state) && !!state.runId && !!state.configFile;
}

export function buildRunSummaryCacheFromState(state: PersistedRunState): RunSummaryCache | null {
  if (!isValidRunState(state)) return null;
  const { usage, cost } = getRunTokenUsage(state);
  const completedSteps = Array.isArray(state.completedSteps) ? state.completedSteps.length : 0;
  const failedSteps = Array.isArray(state.failedSteps) ? state.failedSteps.length : 0;
  const ownerId = stringValue(state.runOwnerId) || stringValue(state.createdBy);
  const ownerName = stringValue(state.runOwnerName) || stringValue(state.createdByName);
  return {
    version: SUMMARY_CACHE_VERSION,
    id: state.runId,
    runId: state.runId,
    configFile: state.configFile,
    configName: stringValue(state.workflowName) || state.configFile,
    startTime: stringValue(state.startTime),
    endTime: stringValue(state.endTime) || null,
    status: stringValue(state.status) || 'unknown',
    currentPhase: stringValue(state.currentPhase) || stringValue(state.currentState) || null,
    totalSteps: completedSteps + failedSteps,
    completedSteps,
    failedSteps,
    tokenUsage: usage,
    totalTokens: totalTokens(usage),
    cost,
    ownerId,
    ownerName,
    agentUsage: getAgentUsage(state),
    source: 'state',
    updatedAt: new Date().toISOString(),
  };
}

export function buildRunSummaryCacheFromRecord(record: {
  id: string;
  configFile: string;
  configName?: string;
  startTime?: string;
  endTime?: string | null;
  status?: string;
  currentPhase?: string | null;
  totalSteps?: number;
  completedSteps?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  totalTokens?: number;
}): RunSummaryCache | null {
  const runId = stringValue(record.id);
  const configFile = stringValue(record.configFile);
  if (!runId || !configFile) return null;
  const usage = {
    inputTokens: numberOrZero(record.inputTokens),
    outputTokens: numberOrZero(record.outputTokens),
    cacheCreationInputTokens: numberOrZero(record.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrZero(record.cacheReadInputTokens),
  };
  const completedSteps = numberOrZero(record.completedSteps);
  const totalSteps = numberOrZero(record.totalSteps);
  return {
    version: SUMMARY_CACHE_VERSION,
    id: runId,
    runId,
    configFile,
    configName: stringValue(record.configName) || configFile,
    startTime: stringValue(record.startTime),
    endTime: stringValue(record.endTime) || null,
    status: stringValue(record.status) || 'preparing',
    currentPhase: stringValue(record.currentPhase) || null,
    totalSteps,
    completedSteps,
    failedSteps: Math.max(0, totalSteps - completedSteps),
    tokenUsage: usage,
    totalTokens: numberOrZero(record.totalTokens) || totalTokens(usage),
    cost: 0,
    ownerId: '',
    ownerName: '',
    agentUsage: {},
    source: 'record',
    updatedAt: new Date().toISOString(),
  };
}

export async function saveRunSummaryCache(summary: RunSummaryCache): Promise<void> {
  const dir = runDir(summary.runId);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const target = runSummaryCachePath(summary.runId);
  const temp = resolve(dir, `${SUMMARY_CACHE_FILE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await writeFile(temp, `${JSON.stringify(summary, null, 2)}\n`, 'utf-8');
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function loadRunSummaryCache(runId: string): Promise<RunSummaryCache | null> {
  try {
    const raw = await readFile(runSummaryCachePath(runId), 'utf-8');
    return normalizeSummary(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function isSummaryCacheFresh(runId: string): Promise<boolean> {
  try {
    const [summaryStat, stateStat] = await Promise.all([
      stat(runSummaryCachePath(runId)),
      stat(stateFilePath(runId)).catch(() => null),
    ]);
    return !stateStat || summaryStat.mtimeMs >= stateStat.mtimeMs;
  } catch {
    return false;
  }
}

async function recoverRunSummaryFromFinalReview(runId: string): Promise<RunSummaryCache | null> {
  try {
    const reviewFile = resolve(runDir(runId), 'final-review.yaml');
    if (!existsSync(reviewFile)) return null;
    const review = parse(await readFile(reviewFile, 'utf-8'));
    const reviewRunId = stringValue(review?.runId) || runId;
    const configFile = stringValue(review?.configFile);
    if (!reviewRunId || !configFile) return null;
    const outputsPath = resolve(runDir(runId), 'outputs');
    const outputFiles = existsSync(outputsPath)
      ? (await readdir(outputsPath)).filter((file) => /\.(md|txt)$/.test(file) && !/^\d{4}-/.test(file))
      : [];
    return {
      version: SUMMARY_CACHE_VERSION,
      id: reviewRunId,
      runId: reviewRunId,
      configFile,
      configName: stringValue(review?.workflowName) || configFile,
      startTime: stringValue(review?.generatedAt) || new Date(0).toISOString(),
      endTime: stringValue(review?.generatedAt) || null,
      status: stringValue(review?.status) || 'completed',
      currentPhase: stringValue(review?.status) === 'completed' ? '完成' : null,
      totalSteps: outputFiles.length,
      completedSteps: outputFiles.length,
      failedSteps: 0,
      tokenUsage: emptyTokenUsage(),
      totalTokens: 0,
      cost: 0,
      ownerId: '',
      ownerName: '',
      agentUsage: {},
      source: 'final-review',
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

async function migrateRunSummaryFromState(runId: string): Promise<RunSummaryCache | null> {
  try {
    const content = await readFile(stateFilePath(runId), 'utf-8');
    const state = parse(content);
    const summary = buildRunSummaryCacheFromState(state);
    if (!summary) return null;
    await saveRunSummaryCache(summary);
    return summary;
  } catch {
    return null;
  }
}

export async function ensureRunSummaryCache(runId: string): Promise<RunSummaryCache | null> {
  const cached = await loadRunSummaryCache(runId);
  if (cached && await isSummaryCacheFresh(runId)) {
    return cached;
  }

  const migrated = await migrateRunSummaryFromState(runId);
  if (migrated) return migrated;

  const recovered = await recoverRunSummaryFromFinalReview(runId);
  if (recovered) {
    await saveRunSummaryCache(recovered).catch(() => {});
    return recovered;
  }

  return cached;
}

export async function listRunSummaryCaches(): Promise<RunSummaryCache[]> {
  if (!existsSync(RUNS_DIR)) return [];
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const summaries = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ensureRunSummaryCache(entry.name))
  );
  return summaries.filter(Boolean) as RunSummaryCache[];
}
