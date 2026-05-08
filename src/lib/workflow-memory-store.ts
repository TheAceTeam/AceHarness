import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from './app-paths';

export type MemoryScope = 'role' | 'project' | 'workflow' | 'chat';
export type MemoryKind = 'summary' | 'experience' | 'review' | 'decision' | 'quality' | 'session';

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  key: string;
  kind: MemoryKind;
  title: string;
  content: string;
  source: string;
  runId?: string;
  configFile?: string;
  agent?: string;
  tags?: string[];
  createdAt: string;
}

interface MemoryBucket {
  scope: MemoryScope;
  key: string;
  updatedAt: string;
  entries: MemoryEntry[];
}

const MEMORY_ROOT = getWorkspaceDataFile('memory-layers');

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'default';
}

function bucketPath(scope: MemoryScope, key: string): string {
  return resolve(MEMORY_ROOT, scope, `${sanitizeKey(key)}.yaml`);
}

async function ensureScopeDir(scope: MemoryScope): Promise<void> {
  const dir = resolve(MEMORY_ROOT, scope);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function loadBucket(scope: MemoryScope, key: string): Promise<MemoryBucket> {
  await ensureScopeDir(scope);
  const filepath = bucketPath(scope, key);
  if (!existsSync(filepath)) {
    return {
      scope,
      key,
      updatedAt: new Date().toISOString(),
      entries: [],
    };
  }

  try {
    const raw = await readFile(filepath, 'utf-8');
    const parsed = parse(raw) as MemoryBucket | null;
    return {
      scope,
      key,
      updatedAt: parsed?.updatedAt || new Date().toISOString(),
      entries: Array.isArray(parsed?.entries) ? parsed!.entries : [],
    };
  } catch {
    return {
      scope,
      key,
      updatedAt: new Date().toISOString(),
      entries: [],
    };
  }
}

async function saveBucket(bucket: MemoryBucket): Promise<void> {
  await ensureScopeDir(bucket.scope);
  await writeFile(bucketPath(bucket.scope, bucket.key), stringify(bucket), 'utf-8');
}

export async function appendMemoryEntries(
  entries: Array<Omit<MemoryEntry, 'id' | 'createdAt'> & { id?: string; createdAt?: string }>
): Promise<void> {
  const grouped = new Map<string, MemoryEntry[]>();

  for (const rawEntry of entries) {
    if (!rawEntry.scope || !rawEntry.key || !rawEntry.title || !rawEntry.content) continue;
    const entry: MemoryEntry = {
      ...rawEntry,
      id: rawEntry.id || `${rawEntry.scope}-${sanitizeKey(rawEntry.key)}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: rawEntry.createdAt || new Date().toISOString(),
      tags: Array.isArray(rawEntry.tags) ? rawEntry.tags.filter(Boolean) : [],
    };
    const bucketKey = `${entry.scope}::${entry.key}`;
    const list = grouped.get(bucketKey) || [];
    list.push(entry);
    grouped.set(bucketKey, list);
  }

  for (const [bucketKey, bucketEntries] of grouped.entries()) {
    const [scope, key] = bucketKey.split('::') as [MemoryScope, string];
    const bucket = await loadBucket(scope, key);
    bucket.entries = [...bucket.entries, ...bucketEntries]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 60);
    bucket.updatedAt = new Date().toISOString();
    await saveBucket(bucket);
  }
}

export async function listMemoryEntries(options: {
  scope: MemoryScope;
  key: string;
  limit?: number;
}): Promise<MemoryEntry[]> {
  const bucket = await loadBucket(options.scope, options.key);
  return bucket.entries
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.max(1, options.limit || 5));
}

export async function listScopeMemories(options: {
  scope: MemoryScope;
  limit?: number;
}): Promise<Array<{ key: string; updatedAt: string; entries: MemoryEntry[] }>> {
  const dir = resolve(MEMORY_ROOT, options.scope);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.yaml'));
  const buckets: Array<{ key: string; updatedAt: string; entries: MemoryEntry[] }> = [];

  for (const file of files) {
    try {
      const raw = await readFile(resolve(dir, file), 'utf-8');
      const parsed = parse(raw) as MemoryBucket | null;
      if (!parsed?.key) continue;
      buckets.push({
        key: parsed.key,
        updatedAt: parsed.updatedAt || '',
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      });
    } catch {
      // ignore malformed bucket
    }
  }

  buckets.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());
  return buckets.slice(0, Math.max(1, options.limit || 10));
}

export function buildMemoryPromptBlock(
  title: string,
  entries: MemoryEntry[],
  options?: { maxItems?: number }
): string {
  const list = entries.slice(0, Math.max(1, options?.maxItems || 3));
  if (!list.length) return '';
  return [
    `## ${title}`,
    ...list.map((entry) => [
      `- ${entry.title}`,
      `  - 类型: ${entry.kind}`,
      `  - 来源: ${entry.source}`,
      `  - 内容: ${entry.content}`,
    ].join('\n')),
  ].join('\n');
}
