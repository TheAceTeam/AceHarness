import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import { listConfigsWithMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';

const RUNS_DIR = getWorkspaceRunsDir();

// ── In-memory cache with background refresh ──
let cachedResult: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10_000; // 10s — background refresh interval
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;
const IS_BUILD_PHASE = process.env.NEXT_PHASE === 'phase-production-build';

function getSafeTime(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

async function computeDashboardData(userId = '', role: 'admin' | 'user' = 'admin') {
  const [configResult, agentCount, runsResult] = await Promise.all([
    readConfigsSummary(userId, role),
    readAgentCount(),
    readAllRunsSummary(),
  ]);

  const { configs, configNameMap } = configResult;
  const { runs, agentUsage, tokenRankingByUser, tokenRankingByWorkflow } = runsResult;

  const totalRuns = runs.length;
  const completed = runs.filter(r => r.status === 'completed').length;
  const successRate = totalRuns > 0 ? Math.round((completed / totalRuns) * 100) : 0;
  const runningRuns = runs.filter(r => r.status === 'running');
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
  const weeklyRuns = runs.filter(r => getSafeTime(r.startTime) >= sevenDaysAgo).length;
  const totalTokenUsage = runs.reduce((sum, r) => sum + r.totalTokens, 0);
  const weeklyTokenUsage = runs.reduce((sum, r) => {
    return getSafeTime(r.startTime) >= sevenDaysAgo ? sum + r.totalTokens : sum;
  }, 0);

  let totalDuration = 0;
  let durationCount = 0;
  for (const r of runs) {
    const startTime = getSafeTime(r.startTime);
    const endTime = getSafeTime(r.endTime);
    if (startTime > 0 && endTime > 0) {
      totalDuration += endTime - startTime;
      durationCount++;
    }
  }
  const avgDuration = durationCount > 0 ? Math.round(totalDuration / durationCount / 1000 / 60) : 0;

  for (const r of runs) {
    r.configName = configNameMap[r.configFile] || r.configFile;
  }

  runs.sort((a, b) => getSafeTime(b.startTime) - getSafeTime(a.startTime));
  const recentRuns = runs.slice(0, 5);

  // Weekly activity
  const dayCounts: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const r of runs) {
    const t = getSafeTime(r.startTime);
    if (t >= sevenDaysAgo) {
      const daysAgo = Math.floor((now - t) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo < 7) dayCounts[6 - daysAgo]++;
    }
  }
  const activityData = dayCounts.map((count, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { dayOfWeek: d.getDay(), runs: count };
  });

  const topAgents = Object.entries(agentUsage)
    .map(([name, data]) => ({ name, calls: data.calls, cost: Math.round(data.cost * 10000) / 10000 }))
    .sort((a, b) => b.calls - a.calls)
    .slice(0, 10);

  return {
    stats: {
      totalRuns, successRate, avgDuration,
      activeWorkflows: configs.length,
      weeklyRuns,
      totalTokenUsage,
      weeklyTokenUsage,
      totalAgents: agentCount,
      runningProcesses: runningRuns.length,
    },
    configs,
    recentRuns,
    runningRuns: runningRuns.map(r => ({
      id: r.id, configFile: r.configFile, configName: r.configName,
      startTime: r.startTime, status: r.status, currentPhase: r.currentPhase,
    })),
    agentUsageData: topAgents,
    tokenRankingByUser,
    tokenRankingByWorkflow,
    activityData,
  };
}

async function refreshCache() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    cachedResult = await computeDashboardData();
    cacheTimestamp = Date.now();
  } catch (e) {
    if (!IS_BUILD_PHASE) {
      console.error('[dashboard cache] refresh failed:', e);
    }
  } finally {
    isRefreshing = false;
  }
}

// Start background refresh timer on first import
if (!IS_BUILD_PHASE && !refreshTimer) {
  refreshTimer = setInterval(() => {
    refreshCache().catch(() => {});
  }, CACHE_TTL);
  // Don't block module load — kick off first refresh async
  refreshCache().catch(() => {});
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;
    const result = await computeDashboardData(auth.id, auth.role);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Dashboard data load failed', message: error.message },
      { status: 500 }
    );
  }
}

// ── Data readers (unchanged logic, parallel I/O) ──

async function readConfigsSummary(userId: string, role: 'admin' | 'user') {
  const configNameMap: Record<string, string> = {};
  const configs: any[] = [];
  await ensureRuntimeConfigsSeeded();
  const CONFIGS_DIR = await getRuntimeConfigsDirPath();
  const metaMap = await listConfigsWithMeta('workflow');
  try {
    const entries = await readdir(CONFIGS_DIR, { withFileTypes: true });
    const yamlFiles = entries.filter(e => e.isFile() && (e.name.endsWith('.yaml') || e.name.endsWith('.yml')));
    const results = await Promise.all(
      yamlFiles.map(async (entry) => {
        const meta = metaMap[entry.name];
        if (meta?.visibility === 'private' && meta.createdBy && meta.createdBy !== userId && role !== 'admin') {
          return null;
        }
        try {
          const content = await readFile(resolve(CONFIGS_DIR, entry.name), 'utf-8');
          const config = parse(content);
          const name = config?.workflow?.name || entry.name;
          configNameMap[entry.name] = name;
          const mode = config?.workflow?.mode || 'phase-based';
          const items = mode === 'state-machine' ? config?.workflow?.states : config?.workflow?.phases;
          return {
            filename: entry.name, name,
            description: config?.workflow?.description || '', mode,
            phaseCount: items?.length || 0,
            stepCount: items?.reduce((s: number, p: any) => s + (p.steps?.length || 0), 0) || 0,
          };
        } catch {
          configNameMap[entry.name] = entry.name;
          return { filename: entry.name, name: entry.name, description: '(解析失败)', mode: 'phase-based', phaseCount: 0, stepCount: 0 };
        }
      })
    );
    configs.push(...results.filter(Boolean));
  } catch {}
  return { configs, configNameMap };
}

async function readAgentCount(): Promise<number> {
  try {
    const AGENTS_DIR = await getRuntimeAgentsDirPath();
    const files = await readdir(AGENTS_DIR);
    return files.filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).length;
  } catch { return 0; }
}

interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

interface TokenRankingItem extends TokenUsageSummary {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  cost: number;
}

interface RunSummary extends TokenUsageSummary {
  id: string; configFile: string; configName: string;
  startTime: string; endTime: string | null; status: string;
  currentPhase: string | null; totalSteps: number; completedSteps: number;
  totalTokens: number; cost: number; ownerName: string;
}

function isValidRunState(state: any): state is {
  runId?: string;
  configFile?: string;
  startTime?: string;
  endTime?: string | null;
  status?: string;
  currentPhase?: string | null;
  completedSteps?: any[];
  failedSteps?: any[];
  stepLogs?: any[];
} {
  return !!state && typeof state === 'object' && !Array.isArray(state);
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readTokenUsage(source: any): TokenUsageSummary {
  const usage = source?.tokenUsage || source || {};
  return {
    inputTokens: numberOrZero(usage.inputTokens),
    outputTokens: numberOrZero(usage.outputTokens),
    cacheCreationInputTokens: numberOrZero(usage.cacheCreationInputTokens),
    cacheReadInputTokens: numberOrZero(usage.cacheReadInputTokens),
  };
}

function addUsage(target: TokenUsageSummary, usage: TokenUsageSummary): void {
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.cacheReadInputTokens += usage.cacheReadInputTokens;
}

function totalTokens(usage: TokenUsageSummary): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheCreationInputTokens + usage.cacheReadInputTokens;
}

function emptyRankingItem(name: string, configFile?: string): TokenRankingItem {
  return {
    name,
    configFile,
    runs: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cost: 0,
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function finalizeRanking(items: Record<string, TokenRankingItem>): TokenRankingItem[] {
  return Object.values(items)
    .map(item => ({ ...item, cost: roundMoney(item.cost) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs)
    .slice(0, 10);
}

function getRunOwnerName(state: any): string {
  return state?.runOwnerName || state?.createdByName || state?.createdBy || state?.runOwnerId || '未知用户';
}

function getRunTokenUsage(state: any): { usage: TokenUsageSummary; cost: number } {
  const usage: TokenUsageSummary = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  let cost = 0;

  if (Array.isArray(state?.stepLogs) && state.stepLogs.length > 0) {
    for (const log of state.stepLogs) {
      addUsage(usage, readTokenUsage(log));
      cost += numberOrZero(log?.costUsd);
    }
    return { usage, cost };
  }

  if (Array.isArray(state?.agents)) {
    for (const ag of state.agents) {
      addUsage(usage, readTokenUsage(ag));
      cost += numberOrZero(ag?.costUsd);
    }
  }

  return { usage, cost };
}

async function readAllRunsSummary() {
  const runs: RunSummary[] = [];
  const agentUsage: Record<string, { calls: number; cost: number }> = {};
  const tokenRankingByUserMap: Record<string, TokenRankingItem> = {};
  const tokenRankingByWorkflowMap: Record<string, TokenRankingItem> = {};
  if (!existsSync(RUNS_DIR)) {
    return {
      runs,
      agentUsage,
      tokenRankingByUser: [],
      tokenRankingByWorkflow: [],
    };
  }

  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const dirs = entries.filter(e => e.isDirectory() && !e.name.startsWith('.'));

  // Read all state.yaml in parallel
  const results = await Promise.all(
    dirs.map(async (entry) => {
      const stateFile = resolve(RUNS_DIR, entry.name, 'state.yaml');
      if (!existsSync(stateFile)) return null;
      try {
        const content = await readFile(stateFile, 'utf-8');
        const state = parse(content);
        if (!isValidRunState(state)) return null;
        return { dirName: entry.name, state };
      } catch { return null; }
    })
  );

  const valid = results.filter(Boolean) as { dirName: string; state: NonNullable<ReturnType<typeof parse>> }[];
  valid.sort((a, b) => getSafeTime(b.state.startTime) - getSafeTime(a.state.startTime));

  for (const { state } of valid) {
    const { usage, cost } = getRunTokenUsage(state);
    const runTotalTokens = totalTokens(usage);
    const ownerName = getRunOwnerName(state);
    const configFile = state.configFile || '';
    const workflowKey = configFile || '(unknown)';

    runs.push({
      id: state.runId || '', configFile, configName: configFile,
      startTime: state.startTime || '', endTime: state.endTime || null, status: state.status || 'unknown',
      currentPhase: state.currentPhase || null,
      totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
      completedSteps: state.completedSteps?.length || 0,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      totalTokens: runTotalTokens,
      cost,
      ownerName,
    });

    if (!tokenRankingByUserMap[ownerName]) tokenRankingByUserMap[ownerName] = emptyRankingItem(ownerName);
    tokenRankingByUserMap[ownerName].runs += 1;
    tokenRankingByUserMap[ownerName].totalTokens += runTotalTokens;
    tokenRankingByUserMap[ownerName].cost += cost;
    addUsage(tokenRankingByUserMap[ownerName], usage);

    if (!tokenRankingByWorkflowMap[workflowKey]) tokenRankingByWorkflowMap[workflowKey] = emptyRankingItem(configFile || '未知工作流', configFile);
    tokenRankingByWorkflowMap[workflowKey].runs += 1;
    tokenRankingByWorkflowMap[workflowKey].totalTokens += runTotalTokens;
    tokenRankingByWorkflowMap[workflowKey].cost += cost;
    addUsage(tokenRankingByWorkflowMap[workflowKey], usage);
  }

  // Agent usage from recent 50
  for (const { state } of valid.slice(0, 50)) {
    if (state.stepLogs) {
      for (const log of state.stepLogs) {
        if (!log.agent) continue;
        if (!agentUsage[log.agent]) agentUsage[log.agent] = { calls: 0, cost: 0 };
        agentUsage[log.agent].calls += 1;
        agentUsage[log.agent].cost += log.costUsd || 0;
      }
    }
    if (state.agents) {
      for (const ag of state.agents) {
        if (!ag.name) continue;
        if (!agentUsage[ag.name]) agentUsage[ag.name] = { calls: 0, cost: 0 };
        if (agentUsage[ag.name].calls === 0) {
          agentUsage[ag.name].calls = ag.completedTasks || 0;
          agentUsage[ag.name].cost = ag.costUsd || 0;
        }
      }
    }
  }

  return {
    runs,
    agentUsage,
    tokenRankingByUser: finalizeRanking(tokenRankingByUserMap),
    tokenRankingByWorkflow: finalizeRanking(tokenRankingByWorkflowMap),
  };
}
