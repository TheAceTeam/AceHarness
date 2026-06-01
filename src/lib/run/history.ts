import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';
import { parse } from 'yaml';
import { canAccessConfigMeta, listConfigsWithMeta } from '@/lib/config/metadata';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/run/runtime-configs';
import { listRunSummaryCaches } from '@/lib/run/summary-cache';
import { loadUsers } from '@/lib/core/user-store';

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface TokenRankingItem extends TokenUsageSummary {
  name: string;
  configFile?: string;
  runs: number;
  totalTokens: number;
  cost: number;
}

export interface RunSummary extends TokenUsageSummary {
  id: string;
  configFile: string;
  configName: string;
  startTime: string;
  endTime: string | null;
  status: string;
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
  totalTokens: number;
  cost: number;
  ownerId: string;
  ownerName: string;
}

export type HistoryView = 'runs' | 'token-ranking';
export type TokenRankingDimension = 'workflow' | 'user';
export type RunSortKey = 'name' | 'startTime' | 'totalTokens' | 'cost';
export type TokenRankingSortKey = 'name' | 'totalTokens' | 'runs' | 'cost';
export type SortDirection = 'asc' | 'desc';

export function getSafeTime(value: unknown): number {
  if (typeof value !== 'string' || !value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
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

function finalizeRanking(items: Record<string, TokenRankingItem>, limit?: number): TokenRankingItem[] {
  const sorted = Object.values(items)
    .map((item) => ({ ...item, cost: roundMoney(item.cost) }))
    .sort((a, b) => b.totalTokens - a.totalTokens || b.runs - a.runs);
  return typeof limit === 'number' ? sorted.slice(0, Math.max(0, limit)) : sorted;
}

export function buildTokenRankingsForRuns(
  runs: RunSummary[],
  options: { limit?: number } = {}
): {
  tokenRankingByUser: TokenRankingItem[];
  tokenRankingByWorkflow: TokenRankingItem[];
} {
  const tokenRankingByUserMap: Record<string, TokenRankingItem> = {};
  const tokenRankingByWorkflowMap: Record<string, TokenRankingItem> = {};

  for (const run of runs) {
    const ownerName = run.ownerName || run.ownerId || '未知用户';
    const workflowKey = run.configFile || run.configName || '(unknown)';
    const workflowName = run.configName || run.configFile || '未知工作流';
    const usage: TokenUsageSummary = {
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheCreationInputTokens: run.cacheCreationInputTokens,
      cacheReadInputTokens: run.cacheReadInputTokens,
    };

    if (!tokenRankingByUserMap[ownerName]) {
      tokenRankingByUserMap[ownerName] = emptyRankingItem(ownerName);
    }
    tokenRankingByUserMap[ownerName].runs += 1;
    tokenRankingByUserMap[ownerName].totalTokens += run.totalTokens;
    tokenRankingByUserMap[ownerName].cost += run.cost;
    addUsage(tokenRankingByUserMap[ownerName], usage);

    if (!tokenRankingByWorkflowMap[workflowKey]) {
      tokenRankingByWorkflowMap[workflowKey] = emptyRankingItem(workflowName, run.configFile);
    }
    tokenRankingByWorkflowMap[workflowKey].runs += 1;
    tokenRankingByWorkflowMap[workflowKey].totalTokens += run.totalTokens;
    tokenRankingByWorkflowMap[workflowKey].cost += run.cost;
    addUsage(tokenRankingByWorkflowMap[workflowKey], usage);
  }

  return {
    tokenRankingByUser: finalizeRanking(tokenRankingByUserMap, options.limit),
    tokenRankingByWorkflow: finalizeRanking(tokenRankingByWorkflowMap, options.limit),
  };
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getRunOwnerName(state: any, ownerNameById: Record<string, string>, legacyDefaultOwnerName = ''): string {
  const explicitName = stringValue(state?.runOwnerName) || stringValue(state?.createdByName);
  if (explicitName) return explicitName;

  const ownerId = stringValue(state?.runOwnerId) || stringValue(state?.createdBy);
  if (ownerId && ownerNameById[ownerId]) return ownerNameById[ownerId];

  const legacyOwner = stringValue(state?.createdBy) || stringValue(state?.runOwnerId);
  return legacyOwner || legacyDefaultOwnerName || '未知用户';
}

export async function readAccessibleConfigNameMap(userId: string, role: 'admin' | 'user'): Promise<Record<string, string>> {
  await ensureRuntimeConfigsSeeded();
  const configsDir = await getRuntimeConfigsDirPath();
  const metaMap = await listConfigsWithMeta('workflow');
  const configNameMap: Record<string, string> = {};

  try {
    const entries = await readdir(configsDir, { withFileTypes: true });
    const yamlFiles = entries.filter((entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')));
    const results = await Promise.all(
      yamlFiles.map(async (entry) => {
        const meta = metaMap[entry.name];
        if (!canAccessConfigMeta(meta, userId, role)) {
          return null;
        }
        try {
          const content = await readFile(resolve(configsDir, entry.name), 'utf-8');
          const config = parse(content);
          return {
            filename: entry.name,
            name: typeof config?.workflow?.name === 'string' && config.workflow.name.trim() ? config.workflow.name.trim() : entry.name,
          };
        } catch {
          return { filename: entry.name, name: entry.name };
        }
      })
    );

    for (const item of results) {
      if (item) configNameMap[item.filename] = item.name;
    }
  } catch {}

  return configNameMap;
}

export function applyConfigNamesToRuns(
  runs: RunSummary[],
  configNameMap: Record<string, string>,
  role: 'admin' | 'user'
): RunSummary[] {
  const visibleConfigFiles = new Set(Object.keys(configNameMap));
  return runs
    .filter((run) => role === 'admin' || !run.configFile || visibleConfigFiles.has(run.configFile))
    .map((run) => ({
      ...run,
      configName: configNameMap[run.configFile] || run.configName || run.configFile,
    }));
}

export function sortRuns(runs: RunSummary[], sortKey: RunSortKey, sortDirection: SortDirection): RunSummary[] {
  const direction = sortDirection === 'asc' ? 1 : -1;
  return [...runs].sort((a, b) => {
    if (sortKey === 'name') {
      const nameDiff = a.configName.localeCompare(b.configName, 'zh-CN');
      if (nameDiff !== 0) return nameDiff * direction;
      return (getSafeTime(a.startTime) - getSafeTime(b.startTime)) * direction;
    }

    if (sortKey === 'totalTokens') {
      const tokenDiff = a.totalTokens - b.totalTokens;
      if (tokenDiff !== 0) return tokenDiff * direction;
      return a.configName.localeCompare(b.configName, 'zh-CN') * direction;
    }

    if (sortKey === 'cost') {
      const costDiff = a.cost - b.cost;
      if (costDiff !== 0) return costDiff * direction;
      return a.configName.localeCompare(b.configName, 'zh-CN') * direction;
    }

    const timeDiff = getSafeTime(a.startTime) - getSafeTime(b.startTime);
    if (timeDiff !== 0) return timeDiff * direction;
    return a.configName.localeCompare(b.configName, 'zh-CN') * direction;
  });
}

export function sortTokenRankings(
  items: TokenRankingItem[],
  sortKey: TokenRankingSortKey,
  sortDirection: SortDirection
): TokenRankingItem[] {
  const direction = sortDirection === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    if (sortKey === 'name') {
      const nameDiff = a.name.localeCompare(b.name, 'zh-CN');
      if (nameDiff !== 0) return nameDiff * direction;
      return (a.totalTokens - b.totalTokens) * direction;
    }

    if (sortKey === 'runs') {
      const runsDiff = a.runs - b.runs;
      if (runsDiff !== 0) return runsDiff * direction;
      return (a.totalTokens - b.totalTokens) * direction;
    }

    if (sortKey === 'cost') {
      const costDiff = a.cost - b.cost;
      if (costDiff !== 0) return costDiff * direction;
      return (a.totalTokens - b.totalTokens) * direction;
    }

    const tokenDiff = a.totalTokens - b.totalTokens;
    if (tokenDiff !== 0) return tokenDiff * direction;
    return a.name.localeCompare(b.name, 'zh-CN') * direction;
  });
}

export function paginateRuns<T>(items: T[], page: number, pageSize: number) {
  const safePageSize = Math.max(1, pageSize);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    total,
    totalPages,
    page: safePage,
    pageSize: safePageSize,
  };
}

export async function readAllRunsSummary() {
  const runs: RunSummary[] = [];
  const agentUsage: Record<string, { calls: number; cost: number }> = {};
  const users = await loadUsers().catch(() => []);
  const ownerNameById = Object.fromEntries(users.map((user) => [user.id, user.username]));
  const legacyDefaultOwnerName = users.length === 1 ? users[0]?.username || '' : '';
  const configMetaMap: Record<string, { createdBy?: string }> = await listConfigsWithMeta('workflow').catch(() => ({}));
  const configNameMap: Record<string, string> = await readAccessibleConfigNameMap('', 'admin').catch(() => ({}));

  const summaries = await listRunSummaryCaches();
  summaries.sort((a, b) => getSafeTime(b.startTime) - getSafeTime(a.startTime));

  for (const summary of summaries) {
    const usage = summary.tokenUsage;
    const cost = summary.cost;
    const runTotalTokens = totalTokens(usage);
    const configFile = summary.configFile || '';
    const configMetaOwnerId = stringValue(configMetaMap[configFile]?.createdBy);
    const stateOwnerId = summary.ownerId || '';
    const ownerId = stateOwnerId || configMetaOwnerId;
    const ownerName = getRunOwnerName(
      {
        runOwnerName: summary.ownerName,
        runOwnerId: stateOwnerId || configMetaOwnerId,
        createdBy: stateOwnerId || configMetaOwnerId,
      },
      ownerNameById,
      legacyDefaultOwnerName
    );
    const workflowName = configNameMap[configFile] || configFile || '未知工作流';

    runs.push({
      id: summary.runId || summary.id || '',
      configFile,
      configName: workflowName,
      startTime: summary.startTime || '',
      endTime: summary.endTime || null,
      status: summary.status || 'unknown',
      currentPhase: summary.currentPhase || null,
      totalSteps: summary.totalSteps,
      completedSteps: summary.completedSteps,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
      cacheReadInputTokens: usage.cacheReadInputTokens,
      totalTokens: runTotalTokens,
      cost,
      ownerId,
      ownerName,
    });

  }

  const { tokenRankingByUser, tokenRankingByWorkflow } = buildTokenRankingsForRuns(runs);

  for (const summary of summaries.slice(0, 50)) {
    for (const [agent, usage] of Object.entries(summary.agentUsage)) {
      if (!agentUsage[agent]) agentUsage[agent] = { calls: 0, cost: 0 };
      agentUsage[agent].calls += usage.calls;
      agentUsage[agent].cost += usage.cost;
    }
  }

  return {
    runs,
    agentUsage,
    tokenRankingByUser,
    tokenRankingByWorkflow,
  };
}
