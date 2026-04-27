import { mkdir, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { parse, stringify } from 'yaml';
import { getWorkspaceDataFile, getWorkspaceRunsDir } from './app-paths';
import { existsSync } from 'fs';

export interface AgentScoreCard {
  agent: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
}

export interface WorkflowFinalReview {
  runId: string;
  configFile: string;
  workflowName?: string;
  projectRoot?: string;
  workflowMode?: string;
  supervisorAgent: string;
  status: 'completed' | 'failed' | 'stopped';
  summary: string;
  nextFocus: string[];
  experience: string[];
  scoreCards: AgentScoreCard[];
  agentNames?: string[];
  keywords?: string[];
  generatedAt: string;
}

export interface WorkflowExperienceEntry {
  runId: string;
  configFile: string;
  workflowName?: string;
  projectRoot?: string;
  workflowMode?: string;
  supervisorAgent: string;
  status: 'completed' | 'failed' | 'stopped';
  summary: string;
  experience: string[];
  nextFocus: string[];
  agentNames?: string[];
  keywords?: string[];
  generatedAt: string;
}

export async function saveWorkflowFinalReview(review: WorkflowFinalReview): Promise<void> {
  const runDir = resolve(getWorkspaceRunsDir(), review.runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(resolve(runDir, 'final-review.yaml'), stringify(review), 'utf-8');

  const markdown = [
    `# Workflow Final Review`,
    '',
    `- Run ID: ${review.runId}`,
    `- Config: ${review.configFile}`,
    `- Supervisor: ${review.supervisorAgent}`,
    `- Status: ${review.status}`,
    `- Generated At: ${review.generatedAt}`,
    '',
    '## Summary',
    review.summary,
    '',
    '## Agent Scores',
    ...review.scoreCards.map((card) => `- ${card.agent}: ${card.score}\n  - strengths: ${card.strengths.join(' / ') || '无'}\n  - weaknesses: ${card.weaknesses.join(' / ') || '无'}`),
    '',
    '## Next Focus',
    ...review.nextFocus.map((item) => `- ${item}`),
    '',
    '## Experience',
    ...review.experience.map((item) => `- ${item}`),
    '',
  ].join('\n');
  await writeFile(resolve(runDir, 'final-review.md'), markdown, 'utf-8');
}

export async function appendWorkflowExperience(review: WorkflowFinalReview): Promise<void> {
  const dir = getWorkspaceDataFile('experience-library');
  await mkdir(dir, { recursive: true });
  const safeRunId = review.runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const entry = {
    runId: review.runId,
    configFile: review.configFile,
    workflowName: review.workflowName,
    projectRoot: review.projectRoot,
    workflowMode: review.workflowMode,
    supervisorAgent: review.supervisorAgent,
    status: review.status,
    summary: review.summary,
    experience: review.experience,
    nextFocus: review.nextFocus,
    agentNames: review.agentNames,
    keywords: review.keywords,
    generatedAt: review.generatedAt,
  };

  await writeFile(resolve(dir, `${safeRunId}.yaml`), stringify(entry), 'utf-8');
  await writeFile(
    resolve(dir, `${safeRunId}.md`),
    ['# Workflow Experience', '', `- Run ID: ${review.runId}`, `- Config: ${review.configFile}`, '', '## Summary', review.summary, '', '## Experience', ...review.experience.map((item) => `- ${item}`)].join('\n'),
    'utf-8'
  );
}

export async function loadWorkflowFinalReview(runId: string): Promise<WorkflowFinalReview | null> {
  try {
    const runDir = resolve(getWorkspaceRunsDir(), runId);
    const content = await readFile(resolve(runDir, 'final-review.yaml'), 'utf-8');
    return parse(content) as WorkflowFinalReview;
  } catch {
    return null;
  }
}

export async function listWorkflowExperiences(options?: {
  configFile?: string;
  limit?: number;
}): Promise<WorkflowExperienceEntry[]> {
  const dir = getWorkspaceDataFile('experience-library');
  if (!existsSync(dir)) return [];

  const { readdir } = await import('fs/promises');
  const files = (await readdir(dir)).filter((file) => file.endsWith('.yaml'));
  const entries: WorkflowExperienceEntry[] = [];

  for (const file of files) {
    try {
      const content = await readFile(resolve(dir, file), 'utf-8');
      const parsed = parse(content) as WorkflowExperienceEntry;
      if (!parsed?.runId || !parsed?.configFile) continue;
      if (options?.configFile && parsed.configFile !== options.configFile) continue;
      entries.push({
        runId: parsed.runId,
        configFile: parsed.configFile,
        workflowName: typeof parsed.workflowName === 'string' ? parsed.workflowName : undefined,
        projectRoot: typeof parsed.projectRoot === 'string' ? parsed.projectRoot : undefined,
        workflowMode: typeof parsed.workflowMode === 'string' ? parsed.workflowMode : undefined,
        supervisorAgent: parsed.supervisorAgent,
        status: parsed.status,
        summary: parsed.summary,
        experience: Array.isArray(parsed.experience) ? parsed.experience : [],
        nextFocus: Array.isArray(parsed.nextFocus) ? parsed.nextFocus : [],
        agentNames: Array.isArray(parsed.agentNames) ? parsed.agentNames.filter((item: unknown) => typeof item === 'string') : [],
        keywords: Array.isArray(parsed.keywords) ? parsed.keywords.filter((item: unknown) => typeof item === 'string') : [],
        generatedAt: parsed.generatedAt,
      });
    } catch {
      // ignore malformed entry
    }
  }

  entries.sort((a, b) => {
    const at = new Date(a.generatedAt || 0).getTime();
    const bt = new Date(b.generatedAt || 0).getTime();
    return bt - at;
  });

  return entries.slice(0, Math.max(1, options?.limit || 5));
}

function tokenize(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]{1,8}/g) || [])
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function basenameOf(input?: string): string {
  if (!input) return '';
  const normalized = input.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || '';
}

function collectEntrySearchText(entry: WorkflowExperienceEntry): string {
  return [
    entry.configFile,
    basenameOf(entry.configFile),
    entry.workflowName,
    entry.projectRoot,
    basenameOf(entry.projectRoot),
    entry.workflowMode,
    entry.summary,
    ...entry.experience,
    ...entry.nextFocus,
    ...(entry.agentNames || []),
    ...(entry.keywords || []),
  ].filter(Boolean).join('\n');
}

export async function findRelevantWorkflowExperiences(options: {
  configFile?: string;
  workflowName?: string;
  requirements?: string;
  projectRoot?: string;
  agentName?: string;
  limit?: number;
  excludeRunId?: string;
}): Promise<WorkflowExperienceEntry[]> {
  const entries = await listWorkflowExperiences({ limit: 200 }).catch(() => []);
  if (entries.length === 0) return [];

  const queryTokens = new Set([
    ...tokenize(options.workflowName || ''),
    ...tokenize(options.requirements || ''),
    ...tokenize(options.projectRoot || ''),
    ...tokenize(basenameOf(options.projectRoot)),
    ...tokenize(options.agentName || ''),
    ...tokenize(options.configFile || ''),
    ...tokenize(basenameOf(options.configFile)),
  ]);

  const scored = entries
    .filter((entry) => !options.excludeRunId || entry.runId !== options.excludeRunId)
    .map((entry) => {
      let score = 0;
      if (options.configFile && entry.configFile === options.configFile) score += 120;
      if (options.workflowName && entry.workflowName && entry.workflowName === options.workflowName) score += 80;
      if (options.projectRoot && entry.projectRoot && entry.projectRoot === options.projectRoot) score += 60;
      if (options.agentName) {
        if (entry.supervisorAgent === options.agentName) score += 40;
        if ((entry.agentNames || []).includes(options.agentName)) score += 30;
      }

      const entryTokens = new Set(tokenize(collectEntrySearchText(entry)));
      for (const token of queryTokens) {
        if (entryTokens.has(token)) score += token.length >= 4 ? 8 : 4;
      }
      if (score <= 0 && queryTokens.size > 0) return null;
      return { entry, score };
    })
    .filter((item): item is { entry: WorkflowExperienceEntry; score: number } => Boolean(item))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(b.entry.generatedAt || 0).getTime() - new Date(a.entry.generatedAt || 0).getTime();
    });

  return scored.slice(0, Math.max(1, options.limit || 5)).map((item) => item.entry);
}

export function buildWorkflowExperiencePromptBlock(
  entries: WorkflowExperienceEntry[],
  title = '相关历史经验'
): string {
  if (!entries.length) return '';
  return [
    `## ${title}`,
    ...entries.map((entry) => [
      `- [${entry.status}] ${entry.workflowName || basenameOf(entry.configFile) || entry.configFile}`,
      `  - 总结: ${entry.summary}`,
      ...entry.experience.slice(0, 2).map((item) => `  - 经验: ${item}`),
      ...entry.nextFocus.slice(0, 1).map((item) => `  - 后续重点: ${item}`),
    ].join('\n')),
  ].join('\n');
}
