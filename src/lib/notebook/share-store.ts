import { createHash, randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { NotebookScope } from '@/lib/notebook/manager';
import { getWorkspaceDataFile, getWorkspaceDataDir } from '@/lib/core/app-paths';

const SHARES_FILE = getWorkspaceDataFile('notebook-shares.json');

export type NotebookSharePermission = 'read' | 'write';

export interface NotebookShare {
  token: string;
  scope: NotebookScope;
  path: string;
  absolutePath: string;
  permission: NotebookSharePermission;
  createdBy: string;
  createdAt: number;
}

let lock: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = lock;
  let release!: () => void;
  lock = new Promise<void>((r) => { release = r; });
  return prev.then(fn).finally(() => release());
}

async function loadShares(): Promise<NotebookShare[]> {
  if (!existsSync(SHARES_FILE)) return [];
  try {
    const raw = await readFile(SHARES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveShares(shares: NotebookShare[]): Promise<void> {
  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(SHARES_FILE, JSON.stringify(shares, null, 2), 'utf-8');
}

function buildToken(absolutePath: string): string {
  const salt = randomBytes(12).toString('hex');
  const digest = createHash('sha256')
    .update(`${absolutePath}:${salt}:${Date.now()}:${randomBytes(8).toString('hex')}`)
    .digest('hex');
  return digest.slice(0, 40);
}

export async function createNotebookShare(input: {
  scope: NotebookScope;
  path: string;
  absolutePath: string;
  permission: NotebookSharePermission;
  createdBy: string;
}): Promise<NotebookShare> {
  return withLock(async () => {
    const shares = await loadShares();
    const share: NotebookShare = {
      token: buildToken(input.absolutePath),
      scope: input.scope,
      path: input.path,
      absolutePath: input.absolutePath,
      permission: input.permission,
      createdBy: input.createdBy,
      createdAt: Date.now(),
    };
    shares.push(share);
    await saveShares(shares);
    return share;
  });
}

export async function getNotebookShare(token: string): Promise<NotebookShare | null> {
  const shares = await loadShares();
  return shares.find((item) => item.token === token) || null;
}
