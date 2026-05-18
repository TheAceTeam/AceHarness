import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

export interface WerewolfHistoryEntry {
  id: string;
  boardId: string;
  boardName: string;
  result: string;
  summary: string;
  lessons: string[];
  highlights: string[];
  generatedAt: string;
}

function getWerewolfHistoryDir() {
  return getWorkspaceDataFile('werewolf-history');
}

export async function appendWerewolfHistory(entry: WerewolfHistoryEntry): Promise<void> {
  const dir = getWerewolfHistoryDir();
  await mkdir(dir, { recursive: true });
  const safeId = entry.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  await writeFile(resolve(dir, `${safeId}.yaml`), stringify(entry), 'utf-8');
}

export async function listWerewolfHistory(limit = 8): Promise<WerewolfHistoryEntry[]> {
  const dir = getWerewolfHistoryDir();
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((file) => file.endsWith('.yaml'));
  const entries: WerewolfHistoryEntry[] = [];
  for (const file of files) {
    try {
      const content = await readFile(resolve(dir, file), 'utf-8');
      const parsed = parse(content) as WerewolfHistoryEntry;
      if (!parsed?.id || !parsed?.generatedAt) continue;
      entries.push(parsed);
    } catch {
      // ignore malformed files
    }
  }
  return entries
    .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime())
    .slice(0, Math.max(1, limit));
}
