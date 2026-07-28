import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth/middleware';
import { canAccessConfigMeta, listConfigsWithMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { applyConfigNamesToRuns, buildTokenRankingsForRuns, getSafeTime, readAllRunsSummary } from '@/lib/run/history';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

// ── In-memory cache with background refresh ──
const cachedResults = new Map<string, { result: any; ts: number }>();
const CACHE_TTL = 10_000; // 10s — background refresh interval
let refreshTimer: ReturnType<typeof setInterval> | null = null;
const refreshPromises = new Map<string, Promise<void>>();
const IS_BUILD_PHASE = process.env.NEXT_PHASE === 'phase-production-build';
const DASHBOARD_USER_TOKEN_LIMIT = 8;
const DASHBOARD_WORKFLOW_TOKEN_LIMIT = 10;
const DASHBOARD_RUN_TOKEN_LIMIT = 8;

function getDashboardCacheKey(userId: string, role: 'admin' | 'user'): string {
  return role === 'admin' ? 'admin' : `user:${userId}`;
}

async function computeDashboardData(userId = '', role: 'admin' | 'user' = 'admin') {
  const [configResult, agentCount, runsResult] = await Promise.all([
    readConfigsSummary(userId, role),
    readAgentCount(),
    readAllRunsSummary(),
  ]);

  const { configs, configNameMap } = configResult;
  const { agentUsage } = runsResult;
  const runs = applyConfigNamesToRuns(runsResult.runs, configNameMap, role);
  const tokenRankings = buildTokenRankingsForRuns(runs);

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

  runs.sort((a, b) => getSafeTime(b.startTime) - getSafeTime(a.startTime));
  const recentRuns = runs.slice(0, 5);
  const runTokenUsageRanking = [...runs]
    .sort((a, b) => b.totalTokens - a.totalTokens || getSafeTime(b.startTime) - getSafeTime(a.startTime))
    .slice(0, DASHBOARD_RUN_TOKEN_LIMIT)
    .map((run) => ({
      id: run.id,
      configFile: run.configFile,
      configName: run.configName,
      status: run.status,
      startTime: run.startTime,
      totalTokens: run.totalTokens,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheCreationInputTokens: run.cacheCreationInputTokens,
      cacheReadInputTokens: run.cacheReadInputTokens,
      cost: run.cost,
    }));

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
  const tokenDayTotals: number[] = [0, 0, 0, 0, 0, 0, 0];
  for (const r of runs) {
    const t = getSafeTime(r.startTime);
    if (t >= sevenDaysAgo) {
      const daysAgo = Math.floor((now - t) / (24 * 60 * 60 * 1000));
      if (daysAgo >= 0 && daysAgo < 7) tokenDayTotals[6 - daysAgo] += r.totalTokens || 0;
    }
  }
  const tokenActivityData = tokenDayTotals.map((totalTokens, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { dayOfWeek: d.getDay(), totalTokens };
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
    tokenRankingByUser: tokenRankings.tokenRankingByUser.slice(0, DASHBOARD_USER_TOKEN_LIMIT),
    tokenRankingByWorkflow: tokenRankings.tokenRankingByWorkflow.slice(0, DASHBOARD_WORKFLOW_TOKEN_LIMIT),
    runTokenUsageRanking,
    activityData,
    tokenActivityData,
  };
}

async function refreshCache(userId = '', role: 'admin' | 'user' = 'admin') {
  const key = getDashboardCacheKey(userId, role);
  const inFlight = refreshPromises.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const result = await computeDashboardData(userId, role);
      cachedResults.set(key, { result, ts: Date.now() });
    } catch (e) {
      if (!IS_BUILD_PHASE) {
        console.error('[dashboard cache] refresh failed:', e);
      }
    }
  })().finally(() => {
    refreshPromises.delete(key);
  });

  refreshPromises.set(key, promise);
  return promise;
}

// Start background refresh timer on first import
if (!IS_BUILD_PHASE && !refreshTimer) {
  refreshTimer = setInterval(() => {
    refreshCache('', 'admin').catch(() => {});
  }, CACHE_TTL);
  // Don't block module load — kick off first refresh async
  refreshCache('', 'admin').catch(() => {});
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof Response) return auth;
    const key = getDashboardCacheKey(auth.id, auth.role);
    const cached = cachedResults.get(key);
    const now = Date.now();

    if (cached && now - cached.ts < CACHE_TTL) {
      return jsonOk(cached.result);
    }

    if (cached) {
      refreshCache(auth.id, auth.role).catch(() => {});
      return jsonOk(cached.result);
    }

    const result = await computeDashboardData(auth.id, auth.role);
    cachedResults.set(key, { result, ts: now });
    return jsonOk(result);
  } catch (error: any) {
    return jsonError('Dashboard data load failed', 500, errorMessage(error));
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
        if (!canAccessConfigMeta(meta, userId, role)) {
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
