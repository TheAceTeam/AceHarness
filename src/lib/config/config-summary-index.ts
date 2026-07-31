import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { getWorkspaceCacheFile } from '@/lib/core/app-paths';
import { canAccessConfigMeta } from '@/lib/config/metadata';

export type ConfigSortKey = 'name' | 'createdAt';
export type ConfigSortDirection = 'asc' | 'desc';

export type ConfigCandidate = {
  filename: string;
  createdAt: number | string;
};

export type ConfigSummary = {
  filename: string;
  name: string;
  description: string;
  mode: 'state-machine';
  kind: 'lightweight' | 'state-machine';
  profile?: 'lightweight';
  stateCount: number;
  stepCount: number;
  agentCount: number;
  createdAt: number | string;
  visibility: 'private' | 'shared' | 'public';
  sharedWithUserIds: string[];
  ownerName: string;
};

type ConfigSummaryIndexEntry = {
  filename: string;
  mtimeMs: number;
  size: number;
  summary: ConfigSummary | null;
};

type ConfigSummaryIndexFile = {
  version: 2;
  configsDir: string;
  entries: Record<string, ConfigSummaryIndexEntry>;
};

const INDEX_VERSION = 2;
const memoryIndex = new Map<string, ConfigSummaryIndexEntry>();
let diskIndexLoadedFor: string | null = null;
let writeChain: Promise<void> = Promise.resolve();

export function getConfigSummaryIndexPath(): string {
  return getWorkspaceCacheFile('config-summary-index.v1.json');
}

export function readPositiveInt(value: string | null, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getCreatedAtTime(value?: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
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

export async function collectWorkflowConfigCandidates(
  configsDir: string,
  metaMap: Record<string, any>,
  auth: { id: string; role: 'admin' | 'user' },
): Promise<ConfigCandidate[]> {
  const entries = await readdir(configsDir, { withFileTypes: true });
  const candidates: ConfigCandidate[] = [];

  const pushCandidate = async (filename: string) => {
    const meta = metaMap[filename];
    if (!canAccessConfigMeta(meta, auth.id, auth.role)) return;
    const createdAt = meta?.createdAt || (await stat(resolve(configsDir, filename))).birthtimeMs;
    candidates.push({ filename, createdAt });
  };

  for (const entry of entries) {
    if (entry.isFile() && isYamlFile(entry.name)) {
      await pushCandidate(entry.name);
    } else if (entry.isDirectory() && entry.name !== 'agents') {
      try {
        const subEntries = await readdir(resolve(configsDir, entry.name), { withFileTypes: true });
        for (const subEntry of subEntries) {
          if (subEntry.isFile() && isYamlFile(subEntry.name)) {
            await pushCandidate(`${entry.name}/${subEntry.name}`);
          }
        }
      } catch {
        // Ignore directories deleted while scanning.
      }
    }
  }

  return candidates;
}

export async function countRuntimeAgents(configsDir: string): Promise<number> {
  try {
    const agentFiles = await readdir(resolve(configsDir, 'agents'));
    return agentFiles.filter(isYamlFile).length;
  } catch {
    return 0;
  }
}

export async function listIndexedConfigSummaries(input: {
  configsDir: string;
  metaMap: Record<string, any>;
  auth: { id: string; role: 'admin' | 'user' };
  usersById: Map<string, { id: string; username?: string }>;
  agentCount?: number;
}): Promise<{ candidates: ConfigCandidate[]; configs: ConfigSummary[]; indexPath: string }> {
  const { configsDir, metaMap, auth, usersById } = input;
  await loadDiskIndex(configsDir);
  const candidates = await collectWorkflowConfigCandidates(configsDir, metaMap, auth);
  const agentCount = input.agentCount ?? await countRuntimeAgents(configsDir);
  const configs: ConfigSummary[] = [];
  let changed = false;
  const activeKeys = new Set<string>();

  for (const candidate of candidates) {
    const result = await readIndexedConfigSummary(configsDir, candidate, metaMap, usersById, agentCount);
    activeKeys.add(result.key);
    changed ||= result.changed;
    if (result.summary) configs.push(result.summary);
  }

  for (const key of Array.from(memoryIndex.keys())) {
    if (key.startsWith(`${resolve(configsDir)}::`) && !activeKeys.has(key)) {
      memoryIndex.delete(key);
      changed = true;
    }
  }

  if (changed) {
    await persistDiskIndex(configsDir);
  }

  return { candidates, configs, indexPath: getConfigSummaryIndexPath() };
}

async function readIndexedConfigSummary(
  configsDir: string,
  candidate: ConfigCandidate,
  metaMap: Record<string, any>,
  usersById: Map<string, { id: string; username?: string }>,
  agentCount: number,
): Promise<{ key: string; summary: ConfigSummary | null; changed: boolean }> {
  const fullPath = resolve(configsDir, candidate.filename);
  const info = await stat(fullPath);
  const key = indexKey(configsDir, candidate.filename);
  const cached = memoryIndex.get(key);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
    return { key, summary: cached.summary, changed: false };
  }

  let summary: ConfigSummary | null = null;
  try {
    const content = await readFile(fullPath, 'utf-8');
    const config = parse(content);
    const states = config?.workflow?.states;
    if (config?.workflow?.mode === 'state-machine' && Array.isArray(states)) {
      const kind = config.workflow.profile === 'lightweight' ? 'lightweight' : 'state-machine';
      const stateCount = states.length;
      const stepCount = states.reduce((sum: number, state: any) => sum + (state.steps?.length || 0), 0) || 0;
      const meta = metaMap[candidate.filename];
      const owner = meta?.createdBy ? usersById.get(meta.createdBy) : undefined;
      summary = {
        filename: candidate.filename,
        name: config?.workflow?.name || candidate.filename,
        description: config?.workflow?.description || '',
        mode: 'state-machine',
        kind,
        profile: kind === 'lightweight' ? 'lightweight' : undefined,
        stateCount,
        stepCount,
        agentCount,
        createdAt: candidate.createdAt,
        visibility: meta?.visibility || 'private',
        sharedWithUserIds: meta?.sharedWithUserIds || [],
        ownerName: owner?.username || '',
      };
    }
  } catch {
    summary = null;
  }

  memoryIndex.set(key, { filename: candidate.filename, mtimeMs: info.mtimeMs, size: info.size, summary });
  return { key, summary, changed: true };
}

async function loadDiskIndex(configsDir: string): Promise<void> {
  const normalizedDir = resolve(configsDir);
  if (diskIndexLoadedFor === normalizedDir) return;
  memoryIndex.clear();
  diskIndexLoadedFor = normalizedDir;
  try {
    const parsed = JSON.parse(await readFile(getConfigSummaryIndexPath(), 'utf-8')) as ConfigSummaryIndexFile;
    if (parsed?.version !== INDEX_VERSION || resolve(parsed.configsDir || '') !== normalizedDir || !parsed.entries) return;
    for (const [key, entry] of Object.entries(parsed.entries)) {
      if (entry && typeof entry.filename === 'string') memoryIndex.set(key, entry);
    }
  } catch {
    // Missing or corrupt cache is equivalent to an empty index.
  }
}

async function persistDiskIndex(configsDir: string): Promise<void> {
  const indexPath = getConfigSummaryIndexPath();
  const normalizedDir = resolve(configsDir);
  const entries = Object.fromEntries(
    Array.from(memoryIndex.entries()).filter(([key]) => key.startsWith(`${normalizedDir}::`)),
  );
  const payload: ConfigSummaryIndexFile = { version: INDEX_VERSION, configsDir: normalizedDir, entries };

  writeChain = writeChain.then(async () => {
    await mkdir(dirname(indexPath), { recursive: true });
    const tempPath = `${indexPath}.${process.pid}.tmp`;
    await writeFile(tempPath, JSON.stringify(payload), 'utf-8');
    await rename(tempPath, indexPath);
  }).catch(() => {});
  await writeChain;
}

function indexKey(configsDir: string, filename: string): string {
  return `${resolve(configsDir)}::${filename}`;
}

function isYamlFile(filename: string): boolean {
  return filename.endsWith('.yaml') || filename.endsWith('.yml');
}
