import { readdir, readFile, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { parse } from 'yaml';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import { ensureRuntimeConfigsSeeded, getRuntimeConfigsDirPath } from '@/lib/runtime-configs';

const RUNS_DIR = getWorkspaceRunsDir();

export interface RunRecord {
  id: string;
  configFile: string;
  configName: string;
  startTime: string;
  endTime: string | null;
  status: 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' | 'crashed';
  currentPhase: string | null;
  totalSteps: number;
  completedSteps: number;
}

async function ensureRunsDir() {
  if (!existsSync(RUNS_DIR)) {
    await mkdir(RUNS_DIR, { recursive: true });
  }
}

async function getConfigName(configFile: string): Promise<string> {
  try {
    await ensureRuntimeConfigsSeeded();
    const configPath = resolve(await getRuntimeConfigsDirPath(), configFile);
    const content = await readFile(configPath, 'utf-8');
    const config = parse(content);
    return config.workflow?.name || configFile;
  } catch {
    return configFile;
  }
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
}

/**
 * updateRun — 不再需要，状态全部由 state.yaml 管理
 * 保留空实现以兼容调用方
 */
export async function updateRun(_id: string, _patch: Partial<RunRecord>): Promise<void> {
  // No-op: all state is persisted via state.yaml by workflow-manager.persistState()
}

export async function getRun(id: string): Promise<RunRecord | null> {
  try {
    const stateFile = resolve(RUNS_DIR, id, 'state.yaml');
    const content = await readFile(stateFile, 'utf-8');
    const state = parse(content);
    const configName = await getConfigName(state.configFile);
    return {
      id: state.runId,
      configFile: state.configFile,
      configName,
      startTime: state.startTime,
      endTime: state.endTime,
      status: state.status,
      currentPhase: state.currentPhase || null,
      totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
      completedSteps: state.completedSteps?.length || 0,
    };
  } catch {
    return null;
  }
}

export async function listRuns(): Promise<RunRecord[]> {
  await ensureRunsDir();
  const entries = await readdir(RUNS_DIR, { withFileTypes: true });
  const runs: RunRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    try {
      const stateFile = resolve(RUNS_DIR, entry.name, 'state.yaml');
      if (!existsSync(stateFile)) continue;
      const content = await readFile(stateFile, 'utf-8');
      const state = parse(content);
      const configName = await getConfigName(state.configFile);
      runs.push({
        id: state.runId,
        configFile: state.configFile,
        configName,
        startTime: state.startTime,
        endTime: state.endTime,
        status: state.status,
        currentPhase: state.currentPhase || null,
        totalSteps: (state.completedSteps?.length || 0) + (state.failedSteps?.length || 0),
        completedSteps: state.completedSteps?.length || 0,
      });
    } catch { /* skip corrupted */ }
  }

  runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
  return runs;
}

export async function listRunsByConfig(configFile: string): Promise<RunRecord[]> {
  const all = await listRuns();
  return all.filter((r) => r.configFile === configFile);
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
}
