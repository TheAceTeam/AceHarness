import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { getWorkspaceDataDir, getWorkspaceDataFile } from '@/lib/core/app-paths';

const SNAPSHOT_FILE = getWorkspaceDataFile('notebook-snapshots.json');
const MAX_SNAPSHOTS_PER_DOC = 50;

export type NotebookSnapshotSource = 'manual' | 'auto' | 'system';

export interface NotebookSnapshot {
  id: string;
  scope: 'personal' | 'global';
  ownerId: string;
  file: string;
  content: string;
  contentSize: number;
  contentHash: string;
  createdAt: number;
  createdBy: string;
  createdByName: string;
  source: NotebookSnapshotSource;
}

export interface NotebookSnapshotSummary {
  id: string;
  scope: 'personal' | 'global';
  ownerId: string;
  file: string;
  contentSize: number;
  createdAt: number;
  createdBy: string;
  createdByName: string;
  source: NotebookSnapshotSource;
}

let writeLock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  return prev.then(fn).finally(() => release!());
}

function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  return String(hash);
}

async function saveSnapshots(items: NotebookSnapshot[]): Promise<void> {
  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(SNAPSHOT_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

async function loadSnapshots(): Promise<NotebookSnapshot[]> {
  if (!existsSync(SNAPSHOT_FILE)) return [];
  try {
    const content = await readFile(SNAPSHOT_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === 'string' && typeof item.file === 'string');
  } catch {
    return [];
  }
}

function toSummary(snapshot: NotebookSnapshot): NotebookSnapshotSummary {
  const { content, contentHash, ...rest } = snapshot;
  return rest;
}

export async function listNotebookSnapshots(input: {
  scope: 'personal' | 'global';
  ownerId: string;
  file: string;
}): Promise<NotebookSnapshotSummary[]> {
  const all = await loadSnapshots();
  return all
    .filter((item) => item.scope === input.scope && item.ownerId === input.ownerId && item.file === input.file)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toSummary);
}

export async function createNotebookSnapshot(input: {
  scope: 'personal' | 'global';
  ownerId: string;
  file: string;
  content: string;
  createdBy: string;
  createdByName: string;
  source: NotebookSnapshotSource;
}): Promise<{ created: boolean; snapshot: NotebookSnapshotSummary }> {
  return withLock(async () => {
    const all = await loadSnapshots();
    const docItems = all
      .filter((item) => item.scope === input.scope && item.ownerId === input.ownerId && item.file === input.file)
      .sort((a, b) => b.createdAt - a.createdAt);

    const contentHash = hashContent(input.content || '');
    const latest = docItems[0];
    if (latest && latest.contentHash === contentHash) {
      return { created: false, snapshot: toSummary(latest) };
    }

    const snapshot: NotebookSnapshot = {
      id: randomUUID(),
      scope: input.scope,
      ownerId: input.ownerId,
      file: input.file,
      content: input.content,
      contentSize: new TextEncoder().encode(input.content).length,
      contentHash,
      createdAt: Date.now(),
      createdBy: input.createdBy,
      createdByName: input.createdByName,
      source: input.source,
    };

    const next = [snapshot, ...all];

    // Keep at most MAX_SNAPSHOTS_PER_DOC for each doc
    const grouped = new Map<string, NotebookSnapshot[]>();
    for (const item of next) {
      const key = `${item.scope}::${item.ownerId}::${item.file}`;
      const bucket = grouped.get(key) || [];
      if (bucket.length < MAX_SNAPSHOTS_PER_DOC) {
        bucket.push(item);
        grouped.set(key, bucket);
      }
    }

    const compacted: NotebookSnapshot[] = [];
    for (const bucket of grouped.values()) {
      compacted.push(...bucket);
    }

    await saveSnapshots(compacted);
    return { created: true, snapshot: toSummary(snapshot) };
  });
}

export async function getNotebookSnapshotContent(input: {
  scope: 'personal' | 'global';
  ownerId: string;
  file: string;
  snapshotId: string;
}): Promise<NotebookSnapshot | null> {
  const all = await loadSnapshots();
  return all.find((item) => (
    item.scope === input.scope
    && item.ownerId === input.ownerId
    && item.file === input.file
    && item.id === input.snapshotId
  )) || null;
}
