import { randomUUID } from 'crypto';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

const ROUNDTABLE_DIR = getWorkspaceDataFile('roundtables');

export interface RoundtableMessage {
  id: string;
  roundId?: string;
  speakerType: 'human' | 'agent' | 'supervisor' | 'system';
  speakerName: string;
  content: string;
  createdAt: number;
  status: 'pending' | 'done' | 'error';
  error?: string | null;
  engine?: string;
  model?: string;
}

export interface RoundtableRound {
  id: string;
  topic: string;
  participants: string[];
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  summary?: string;
}

export interface RoundtableRecord {
  id: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: 'running' | 'completed' | 'failed';
  topic: string;
  runId?: string;
  configFile?: string;
  supervisorAgent?: string;
  participants: string[];
  agentSessions: Record<string, string>;
  messages: RoundtableMessage[];
  rounds: RoundtableRound[];
}

function roundtablePath(id: string): string {
  return join(ROUNDTABLE_DIR, `${id}.json`);
}

export function createRoundtableMessage(input: Omit<RoundtableMessage, 'id' | 'createdAt'> & Partial<Pick<RoundtableMessage, 'id' | 'createdAt'>>): RoundtableMessage {
  return {
    id: input.id || `rt-msg-${randomUUID()}`,
    createdAt: input.createdAt || Date.now(),
    ...input,
  };
}

export async function saveRoundtable(record: RoundtableRecord): Promise<void> {
  await mkdir(ROUNDTABLE_DIR, { recursive: true });
  await writeFile(roundtablePath(record.id), JSON.stringify(record, null, 2), 'utf-8');
}

export async function loadRoundtable(id: string): Promise<RoundtableRecord | null> {
  try {
    const content = await readFile(roundtablePath(id), 'utf-8');
    return JSON.parse(content) as RoundtableRecord;
  } catch {
    return null;
  }
}

export async function listRoundtables(ownerId?: string): Promise<RoundtableRecord[]> {
  if (!existsSync(ROUNDTABLE_DIR)) return [];
  const entries = await readdir(ROUNDTABLE_DIR);
  const records: RoundtableRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await readFile(join(ROUNDTABLE_DIR, entry), 'utf-8');
      const parsed = JSON.parse(content) as RoundtableRecord;
      if (!ownerId || parsed.createdBy === ownerId) records.push(parsed);
    } catch {
      // ignore malformed files
    }
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}
