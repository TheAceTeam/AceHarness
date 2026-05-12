import { NextRequest, NextResponse } from 'next/server';
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { listConfigsWithMeta } from '@/lib/config-metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeAgentsDirPath, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';
import { applyConfigNamesToRuns, buildTokenRankingsForRuns, getSafeTime, readAllRunsSummary } from '@/lib/run-history';

// ── In-memory cache with background refresh ──
let cachedResult: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10_000; // 10s — background refresh interval
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let isRefreshing = false;
const IS_BUILD_PHASE = process.env.NEXT_PHASE === 'phase-production-build';

async function computeDashboardData(userId = '', role: 'admin' | 'user' = 'admin') {
  const [configResult, agentCount, runsResult] = await Promise.all([
    readConfigsSummary(userId, role),
    readAgentCount(),
    readAllRunsSummary(),
  ]);

  const { configs, configNameMap } = configResult;
  const { agentUsage } = runsResult;
  const runs = applyConfigNamesToRuns(runsResult.runs, configNameMap, role);
  const { tokenRankingByUser, tokenRankingByWorkflow } = buildTokenRankingsForRuns(runs);

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
