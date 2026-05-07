import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile } from './app-paths';

export interface AgentRelationshipEntry {
  agent: string;
  peer: string;
  synergyScore: number;
  runCount: number;
  strengths: string[];
  lastRunId?: string;
  lastConfigFile?: string;
  updatedAt: string;
}

const REL_DIR = getWorkspaceDataFile('agent-relationships');

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function relationshipKey(a: string, b: string): [string, string] {
  return [a, b].sort((x, y) => x.localeCompare(y, 'zh-CN')) as [string, string];
}

function relationshipPath(a: string, b: string): string {
  const [left, right] = relationshipKey(a, b);
  return resolve(REL_DIR, `${sanitize(left)}__${sanitize(right)}.yaml`);
}

async function ensureDir() {
  if (!existsSync(REL_DIR)) {
    await mkdir(REL_DIR, { recursive: true });
  }
}

export async function upsertRelationshipSignal(input: {
  agent: string;
  peer: string;
  deltaScore: number;
  strengths?: string[];
  runId?: string;
  configFile?: string;
}): Promise<void> {
  if (!input.agent || !input.peer || input.agent === input.peer) return;
  await ensureDir();
  const filepath = relationshipPath(input.agent, input.peer);
  let existing: AgentRelationshipEntry | null = null;

  try {
    const raw = await readFile(filepath, 'utf-8');
    existing = parse(raw) as AgentRelationshipEntry;
  } catch {
    existing = null;
  }

  const now = new Date().toISOString();
  const next: AgentRelationshipEntry = {
    agent: relationshipKey(input.agent, input.peer)[0],
    peer: relationshipKey(input.agent, input.peer)[1],
    synergyScore: Math.max(-100, Math.min(100, Math.round((existing?.synergyScore || 0) + input.deltaScore))),
    runCount: (existing?.runCount || 0) + 1,
    strengths: Array.from(new Set([...(existing?.strengths || []), ...(input.strengths || [])])).slice(0, 8),
    lastRunId: input.runId || existing?.lastRunId,
    lastConfigFile: input.configFile || existing?.lastConfigFile,
    updatedAt: now,
  };

  await writeFile(filepath, stringify(next), 'utf-8');
}

export async function listAgentRelationships(agentName: string, limit = 5): Promise<Array<AgentRelationshipEntry & { counterpart: string }>> {
  await ensureDir();
  const files = (await readdir(REL_DIR)).filter((file) => file.endsWith('.yaml'));
  const entries: Array<AgentRelationshipEntry & { counterpart: string }> = [];

  for (const file of files) {
    try {
      const raw = await readFile(resolve(REL_DIR, file), 'utf-8');
      const parsed = parse(raw) as AgentRelationshipEntry;
      if (!parsed?.agent || !parsed?.peer) continue;
      if (parsed.agent !== agentName && parsed.peer !== agentName) continue;
      entries.push({
        ...parsed,
        counterpart: parsed.agent === agentName ? parsed.peer : parsed.agent,
      });
    } catch {
      // ignore malformed relationship file
    }
  }

  return entries
    .sort((a, b) => {
      if (b.synergyScore !== a.synergyScore) return b.synergyScore - a.synergyScore;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .slice(0, Math.max(1, limit));
}

export function buildRelationshipPromptBlock(
  entries: Array<AgentRelationshipEntry & { counterpart: string }>,
  title = '角色协作关系'
): string {
  if (!entries.length) return '';
  return [
    `## ${title}`,
    ...entries.map((entry) => [
      `- ${entry.counterpart}: 协作倾向 ${entry.synergyScore >= 0 ? '+' : ''}${entry.synergyScore}`,
      entry.strengths.length ? `  - 强项: ${entry.strengths.slice(0, 2).join('；')}` : '',
      entry.lastConfigFile ? `  - 最近工作流: ${entry.lastConfigFile}` : '',
    ].filter(Boolean).join('\n')),
  ].join('\n');
}
