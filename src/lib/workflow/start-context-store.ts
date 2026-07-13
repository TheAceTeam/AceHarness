import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { existsSync } from 'fs';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

export type WorkflowStartContextDefaults = {
  globalContext: string;
  phaseContexts: Record<string, string>;
  workingDirectory?: string;
  updatedAt?: string;
};

type StoreShape = Record<string, WorkflowStartContextDefaults>;

const STORE_PATH = getWorkspaceDataFile('workflow-start-contexts.json');

function normalizeStartContextDefaults(input: unknown): WorkflowStartContextDefaults {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const rawPhaseContexts = value.phaseContexts && typeof value.phaseContexts === 'object'
    ? value.phaseContexts as Record<string, unknown>
    : {};
  const phaseContexts = Object.fromEntries(
    Object.entries(rawPhaseContexts)
      .map(([key, item]) => [key.trim(), typeof item === 'string' ? item : String(item ?? '')])
      .filter(([key]) => key.length > 0),
  );
  const workingDirectory = typeof value.workingDirectory === 'string'
    ? value.workingDirectory.trim()
    : '';
  return {
    globalContext: typeof value.globalContext === 'string' ? value.globalContext : '',
    phaseContexts,
    ...(workingDirectory ? { workingDirectory } : {}),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : undefined,
  };
}

async function readStore(): Promise<StoreShape> {
  if (!existsSync(STORE_PATH)) return {};
  try {
    const parsed = JSON.parse(await readFile(STORE_PATH, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as StoreShape : {};
  } catch {
    return {};
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), 'utf-8');
}

export async function getWorkflowStartContextDefaults(configFile: string): Promise<WorkflowStartContextDefaults> {
  const key = String(configFile || '').trim();
  if (!key) return { globalContext: '', phaseContexts: {} };
  const store = await readStore();
  return normalizeStartContextDefaults(store[key]);
}

export async function setWorkflowStartContextDefaults(
  configFile: string,
  defaults: WorkflowStartContextDefaults,
): Promise<WorkflowStartContextDefaults> {
  const key = String(configFile || '').trim();
  if (!key) throw new Error('缺少 configFile');
  const store = await readStore();
  const normalized = {
    ...normalizeStartContextDefaults(defaults),
    updatedAt: new Date().toISOString(),
  };
  store[key] = normalized;
  await writeStore(store);
  return normalized;
}
