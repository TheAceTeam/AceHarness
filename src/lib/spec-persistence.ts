import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import type { SpecCodingDocument } from '@/lib/schemas';
import { normalizeSpecCodingDocument } from '@/lib/spec-coding-store';

export interface ChecklistQuestion {
  id: string;
  text: string;
  answered: boolean;
}

export interface PersistedSpecMetadata {
  version: number;
  revisions: SpecCodingDocument['revisions'];
  updatedAt?: string;
}

export type PersistedSpecFileClassification =
  | { kind: 'master'; specRootDir: string; artifact: 'spec'; targetDir: string }
  | {
      kind: 'delta';
      specRootDir: string;
      workflowName: string;
      runId: string;
      artifact: 'requirements' | 'design' | 'tasks';
      targetDir: string;
    };

export interface PersistedSpecRevisionInput {
  summary: string;
  createdBy?: string;
}

const SPEC_METADATA_FILE = 'spec.meta.yaml';
/**
 * 解析 specRoot 路径。如果 specRoot 是绝对路径则直接使用，否则相对于 workingDirectory。
 */
export function getSpecRootDir(workingDirectory: string, specRoot?: string): string {
  if (!specRoot) return resolve(workingDirectory, '.spec');
  if (isAbsolute(specRoot)) return specRoot;
  return resolve(workingDirectory, specRoot);
}

/**
 * 生成 delta 目录名：<workflowName>-<runId>
 */
export function deltaDirName(workflowName: string, runId: string): string {
  const safeName = workflowName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  const safeRunId = runId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safeName}-${safeRunId}`;
}

/**
 * 确保 spec 目录结构存在（包括 specs/ 子目录）。
 */
export async function ensureSpecDirStructure(specRootDir: string): Promise<void> {
  const specsDir = resolve(specRootDir, 'specs');
  if (!existsSync(specsDir)) {
    await mkdir(specsDir, { recursive: true });
  }
}

/**
 * 检查持久化 spec 是否存在（spec.md 存在即视为存在）。
 */
export function hasPersistedSpec(specRootDir: string): boolean {
  return existsSync(specRootDir) && existsSync(resolve(specRootDir, 'spec.md'));
}

/**
 * 读取 master spec.md，返回一个 SpecCodingDocument（artifacts.spec = spec.md 内容）。
 */
export async function readMasterSpec(specRootDir: string): Promise<SpecCodingDocument | null> {
  if (!hasPersistedSpec(specRootDir)) return null;

  const specContent = await safeReadFile(resolve(specRootDir, 'spec.md'));
  const metadata = await readSpecMetadata(resolve(specRootDir, SPEC_METADATA_FILE));

  const now = new Date().toISOString();
  return normalizeSpecCodingDocument({
    id: `master-${Date.now().toString(36)}`,
    version: metadata.version,
    status: 'confirmed',
    title: 'Master Spec',
    workflowName: '',
    summary: '',
    goals: [],
    nonGoals: [],
    constraints: [],
    requirements: [],
    phases: [],
    assignments: [],
    checkpoints: [],
    tasks: [],
    progress: {
      overallStatus: 'in-progress',
      completedPhaseIds: [],
      activePhaseId: undefined,
      summary: '',
    },
    revisions: metadata.revisions,
    artifacts: { requirements: specContent, design: '', tasks: '' },
    persistMode: 'repository',
    specRoot: specRootDir,
    createdAt: now,
    updatedAt: metadata.updatedAt || now,
  });
}

/**
 * 将 SpecCodingDocument 的 artifacts 写入 master spec.md。
 * spec.md 内容 = artifacts.requirements（即 spec 全文）。
 */
export async function writeMasterSpec(specRootDir: string, specCoding: SpecCodingDocument): Promise<void> {
  await ensureSpecDirStructure(specRootDir);
  const content = specCoding.artifacts?.requirements || specCoding.summary || '# 规格文档\n\n> 暂无内容。\n';
  await writeFile(resolve(specRootDir, 'spec.md'), content, 'utf-8');
  await writeSpecMetadata(resolve(specRootDir, SPEC_METADATA_FILE), {
    version: specCoding.version,
    revisions: specCoding.revisions,
    updatedAt: specCoding.updatedAt,
  });
}

/**
 * 读取某次运行的 delta 目录（specs/<workflowName>-<runId>/）。
 */
export async function readDeltaSpec(
  specRootDir: string,
  workflowName: string,
  runId: string,
): Promise<SpecCodingDocument | null> {
  const deltaDir = resolve(specRootDir, 'specs', deltaDirName(workflowName, runId));
  if (!existsSync(deltaDir)) return null;

  const requirements = await safeReadFile(resolve(deltaDir, 'requirements.md'));
  const design = await safeReadFile(resolve(deltaDir, 'design.md'));
  const tasks = await safeReadFile(resolve(deltaDir, 'tasks.md'));
  const metadata = await readSpecMetadata(resolve(deltaDir, SPEC_METADATA_FILE));

  const now = new Date().toISOString();
  return normalizeSpecCodingDocument({
    id: `delta-${runId}`,
    version: metadata.version,
    status: 'in-progress',
    title: `Delta - ${workflowName} - ${runId}`,
    workflowName,
    summary: '',
    goals: [],
    nonGoals: [],
    constraints: [],
    requirements: [],
    phases: [],
    assignments: [],
    checkpoints: [],
    tasks: [],
    progress: {
      overallStatus: 'in-progress',
      completedPhaseIds: [],
      activePhaseId: undefined,
      summary: '',
    },
    revisions: metadata.revisions,
    artifacts: { requirements, design, tasks },
    persistMode: 'repository',
    specRoot: specRootDir,
    createdAt: now,
    updatedAt: metadata.updatedAt || now,
  });
}

/**
 * 写入 delta spec 到 specs/<workflowName>-<runId>/ 目录。
 */
export async function writeDeltaSpec(
  specRootDir: string,
  workflowName: string,
  runId: string,
  specCoding: SpecCodingDocument,
): Promise<void> {
  const deltaDir = resolve(specRootDir, 'specs', deltaDirName(workflowName, runId));
  if (!existsSync(deltaDir)) {
    await mkdir(deltaDir, { recursive: true });
  }

  const { requirements, design, tasks } = specCoding.artifacts;

  await Promise.all([
    writeFile(resolve(deltaDir, 'requirements.md'), requirements || '', 'utf-8'),
    writeFile(resolve(deltaDir, 'design.md'), design || '', 'utf-8'),
    writeFile(resolve(deltaDir, 'tasks.md'), tasks || '', 'utf-8'),
    writeSpecMetadata(resolve(deltaDir, SPEC_METADATA_FILE), {
      version: specCoding.version,
      revisions: specCoding.revisions,
      updatedAt: specCoding.updatedAt,
    }),
  ]);
}

/**
 * 结构合并 delta 到 master spec.md。
 *
 * spec.md 内容按 `## ` 二级标题分章节。
 * 合并策略：
 * - delta 的 requirements 章节按标题匹配更新/追加到 master
 * - delta 的 design 章节整体覆盖 master 对应章节
 * - delta 的 tasks 按顶层任务 id 匹配更新/追加
 */
export async function buildStructuralMergedMasterSpec(
  specRootDir: string,
  workflowName: string,
  runId: string,
): Promise<string | null> {
  const deltaDir = resolve(specRootDir, 'specs', deltaDirName(workflowName, runId));
  if (!existsSync(deltaDir)) return null;

  const deltaRequirements = await safeReadFile(resolve(deltaDir, 'requirements.md'));
  const deltaDesign = await safeReadFile(resolve(deltaDir, 'design.md'));
  const deltaTasks = await safeReadFile(resolve(deltaDir, 'tasks.md'));

  if (!deltaRequirements && !deltaDesign && !deltaTasks) return null;

  const masterSpec = await safeReadFile(resolve(specRootDir, 'spec.md'));

  // 解析 master spec 的章节
  const masterSections = splitByH2(masterSpec);
  const merged = new Map(masterSections);

  // 合并 delta requirements → 更新/追加 master 的需求相关章节
  if (deltaRequirements) {
    const deltaReqSections = splitByH2(deltaRequirements);
    for (const [heading, content] of deltaReqSections) {
      if (heading && !merged.has(heading)) {
        merged.set(heading, content);
      } else if (heading && merged.has(heading)) {
        // 按需求标题结构合并
        merged.set(heading, mergeRequirementsSection(merged.get(heading)!, content));
      }
    }
  }

  // 合并 delta design → 覆盖 master 的设计章节
  if (deltaDesign) {
    const deltaDesignSections = splitByH2(deltaDesign);
    for (const [heading, content] of deltaDesignSections) {
      if (heading) merged.set(heading, content);
    }
  }

  // 合并 delta tasks → 按任务 id 结构合并
  if (deltaTasks) {
    const deltaTaskSections = splitByH2(deltaTasks);
    for (const [heading, content] of deltaTaskSections) {
      if (heading && merged.has(heading)) {
        merged.set(heading, mergeTasksSection(merged.get(heading)!, content));
      } else if (heading) {
        merged.set(heading, content);
      }
    }
  }

  // 重建 spec.md：保持原始章节顺序，追加新增章节
  const orderedHeadings = [...masterSections.keys()];
  const newHeadings = [...merged.keys()].filter((h) => !orderedHeadings.includes(h));

  const parts: string[] = [];
  for (const heading of [...orderedHeadings, ...newHeadings]) {
    const content = merged.get(heading);
    if (content === undefined) continue;
    if (heading === '') {
      parts.push(content);
    } else {
      parts.push(`## ${heading}\n\n${content}`);
    }
  }

  return parts.join('\n\n').trim() + '\n';
}

export async function applyMergedMasterSpec(
  specRootDir: string,
  mergedContent: string,
  revisionSummary: string,
  createdBy?: string,
): Promise<void> {
  await ensureSpecDirStructure(specRootDir);
  await writeFile(resolve(specRootDir, 'spec.md'), mergedContent, 'utf-8');
  await appendPersistedSpecRevision(specRootDir, { summary: revisionSummary, createdBy });
}

export async function mergeDeltaToMaster(
  specRootDir: string,
  workflowName: string,
  runId: string,
): Promise<boolean> {
  const mergedContent = await buildStructuralMergedMasterSpec(specRootDir, workflowName, runId);
  if (!mergedContent) return false;
  await applyMergedMasterSpec(specRootDir, mergedContent, `合入 Delta Spec：${workflowName}-${runId}`, 'system');
  return true;
}

/**
 * 读取 checklist.md 并解析为问题列表。
 */
export async function readChecklist(specRootDir: string): Promise<ChecklistQuestion[]> {
  const checklistPath = resolve(specRootDir, 'checklist.md');
  if (!existsSync(checklistPath)) return [];

  const content = await safeReadFile(checklistPath);
  if (!content) return [];

  const questions: ChecklistQuestion[] = [];
  let questionIndex = 0;

  for (const line of content.split('\n')) {
    const match = line.match(/^- \[([ xX])\]\s+(.+)$/);
    if (match) {
      questionIndex++;
      questions.push({
        id: `q-${questionIndex}`,
        text: match[2].trim(),
        answered: match[1].toLowerCase() === 'x',
      });
    }
  }

  return questions;
}

/**
 * 写入 checklist.md。
 */
export async function writeChecklist(specRootDir: string, questions: ChecklistQuestion[]): Promise<void> {
  await ensureSpecDirStructure(specRootDir);
  const lines = [
    '# 问题清单',
    '',
    '> 以下问题在每次工作流运行的人工审批/supervisor 审查时必须提出。',
    '',
    ...questions.map((q) => `- [${q.answered ? 'x' : ' '}] ${q.text}`),
    '',
  ];
  await writeFile(resolve(specRootDir, 'checklist.md'), lines.join('\n'), 'utf-8');
}

/**
 * 列出 specRoot/specs/ 下所有 delta 目录名称。
 */
export async function listDeltaDirs(specRootDir: string): Promise<string[]> {
  const specsDir = resolve(specRootDir, 'specs');
  if (!existsSync(specsDir)) return [];
  const entries = await readdir(specsDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

// ---- 内部工具函数 ----

export async function readSpecMetadata(metaPath: string): Promise<PersistedSpecMetadata> {
  try {
    const content = await readFile(metaPath, 'utf-8');
    const parsed = parse(content) as Partial<PersistedSpecMetadata> | null;
    return normalizeSpecMetadata(parsed);
  } catch {
    return normalizeSpecMetadata(null);
  }
}

export async function writeSpecMetadata(metaPath: string, metadata: PersistedSpecMetadata): Promise<void> {
  const normalized = normalizeSpecMetadata(metadata);
  await mkdir(dirname(metaPath), { recursive: true });
  await writeFile(metaPath, stringify(normalized), 'utf-8');
}

export async function appendPersistedSpecRevision(
  targetDir: string,
  input: PersistedSpecRevisionInput,
): Promise<PersistedSpecMetadata> {
  const metaPath = resolve(targetDir, SPEC_METADATA_FILE);
  const metadata = await readSpecMetadata(metaPath);
  const now = new Date().toISOString();
  const version = metadata.version + 1;
  const summary = input.summary.trim().slice(0, 200) || 'SpecCoding 已更新';
  const next: PersistedSpecMetadata = {
    version,
    updatedAt: now,
    revisions: [
      ...metadata.revisions,
      {
        id: randomUUID(),
        version,
        summary,
        createdAt: now,
        createdBy: input.createdBy,
      },
    ],
  };
  await writeSpecMetadata(metaPath, next);
  return next;
}

export function classifyPersistedSpecFile(workspace: string, file: string): PersistedSpecFileClassification | null {
  const specRootDir = getSpecRootDir(workspace);
  const fullPath = resolve(workspace, file);
  const specRootRelative = relative(specRootDir, fullPath);
  if (specRootRelative.startsWith('..') || isAbsolute(specRootRelative)) return null;

  if (specRootRelative === 'spec.md') {
    return { kind: 'master', specRootDir, artifact: 'spec', targetDir: specRootDir };
  }

  const parts = specRootRelative.split(sep);
  if (parts.length !== 3 || parts[0] !== 'specs') return null;

  const artifactByFilename: Record<string, 'requirements' | 'design' | 'tasks' | undefined> = {
    'requirements.md': 'requirements',
    'design.md': 'design',
    'tasks.md': 'tasks',
  };
  const artifact = artifactByFilename[parts[2]];
  if (!artifact) return null;

  const deltaName = parts[1];
  const runSeparatorIndex = deltaName.lastIndexOf('-run-');
  const workflowName = runSeparatorIndex > 0 ? deltaName.slice(0, runSeparatorIndex) : deltaName;
  const runId = runSeparatorIndex > 0 ? deltaName.slice(runSeparatorIndex + 1) : deltaName;
  return {
    kind: 'delta',
    specRootDir,
    workflowName,
    runId,
    artifact,
    targetDir: resolve(specRootDir, 'specs', deltaName),
  };
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return '';
  }
}

function normalizeSpecMetadata(metadata: Partial<PersistedSpecMetadata> | null | undefined): PersistedSpecMetadata {
  const revisions = Array.isArray(metadata?.revisions) ? metadata.revisions : [];
  const maxRevisionVersion = revisions.reduce((max, revision) => Math.max(max, revision.version || 0), 0);
  const version = typeof metadata?.version === 'number' && metadata.version > 0
    ? metadata.version
    : Math.max(1, maxRevisionVersion);
  return {
    version,
    revisions,
    updatedAt: typeof metadata?.updatedAt === 'string' ? metadata.updatedAt : undefined,
  };
}

/**
 * 按 `## ` 二级标题拆分 markdown，返回 [heading, content] 对。
 * 第一个 `## ` 之前的内容 heading 为空字符串。
 */
function splitByH2(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split('\n');
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)$/);
    if (h2Match) {
      sections.set(currentHeading, currentLines.join('\n').trim());
      currentHeading = h2Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  sections.set(currentHeading, currentLines.join('\n').trim());

  return sections;
}

/**
 * 按 `### 需求 N` 子标题结构合并两个需求章节内容。
 */
function mergeRequirementsSection(master: string, delta: string): string {
  const masterSubs = splitByH3(master);
  const deltaSubs = splitByH3(delta);

  const merged = new Map(masterSubs);
  for (const [heading, content] of deltaSubs) {
    if (heading) merged.set(heading, content);
  }

  // 保持顺序
  const ordered = [...masterSubs.keys()];
  const newOnes = [...merged.keys()].filter((h) => !ordered.includes(h));

  const parts: string[] = [];
  for (const heading of [...ordered, ...newOnes]) {
    const content = merged.get(heading);
    if (content === undefined) continue;
    if (heading === '') {
      parts.push(content);
    } else {
      parts.push(`### ${heading}\n\n${content}`);
    }
  }
  return parts.join('\n\n').trim();
}

/**
 * 按 `- [ ] N.` 顶层任务结构合并两个 tasks 章节内容。
 */
function mergeTasksSection(master: string, delta: string): string {
  const masterTasks = splitTopLevelTasks(master);
  const deltaTasks = splitTopLevelTasks(delta);

  const merged = new Map(masterTasks.map((t) => [t.id, t]));
  for (const task of deltaTasks) {
    if (task.id) merged.set(task.id, task);
  }

  // 保持顺序
  const ordered = masterTasks.map((t) => t.id);
  const newIds = deltaTasks.map((t) => t.id).filter((id) => !ordered.includes(id));

  // 保留 header（非任务行）
  const headerLines = master.split('\n').filter((line) => !line.match(/^\s*-\s*\[[ xX-]\]/));
  const parts: string[] = headerLines.length > 0 ? [headerLines.join('\n').trim()] : [];

  for (const id of [...ordered, ...newIds]) {
    const task = merged.get(id);
    if (task) parts.push(task.content);
  }

  return parts.filter(Boolean).join('\n\n').trim();
}

/**
 * 按 `### ` 三级标题拆分。
 */
function splitByH3(markdown: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split('\n');
  let currentHeading = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const h3Match = line.match(/^###\s+(.+)$/);
    if (h3Match) {
      sections.set(currentHeading, currentLines.join('\n').trim());
      currentHeading = h3Match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  sections.set(currentHeading, currentLines.join('\n').trim());

  return sections;
}

interface TaskBlock {
  id: string;
  content: string;
}

/**
 * 按顶层 `- [ ] N.` 任务拆分 tasks markdown。
 */
function splitTopLevelTasks(markdown: string): TaskBlock[] {
  const tasks: TaskBlock[] = [];
  const lines = markdown.split('\n');
  let currentId = '';
  let currentLines: string[] = [];

  for (const line of lines) {
    const taskMatch = line.match(/^-\s*\[[ xX-]\]\s+(\d+)\./);
    if (taskMatch) {
      if (currentLines.length > 0) {
        tasks.push({ id: currentId, content: currentLines.join('\n').trim() });
      }
      currentId = taskMatch[1];
      currentLines = [line];
    } else if (currentLines.length > 0) {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    tasks.push({ id: currentId, content: currentLines.join('\n').trim() });
  }

  return tasks;
}
