import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import {
  creationSessionSchema,
  type CreationSession,
  type SpecCodingDocument,
  type SpecCodingPhase,
  type SpecCodingProgressStatus,
  type SpecCodingTask,
  type StateMachineWorkflowConfig,
} from '@/lib/core/schemas';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { readMasterSpec, getSpecRootDir, hasPersistedSpec } from '@/lib/spec/persistence';
import { deriveLightweightTasklistDirectory } from '@/lib/workflow/lightweight';

const CREATION_SESSIONS_DIR = getWorkspaceDataFile('workflow-creation-sessions');
const creationSessionWriteQueues = new Map<string, Promise<void>>();

const TASK_NUMBER_PATTERN = /^(([A-Za-z]+\d+(?:\.\d+)*|\d+(?:\.\d+)*)\b)\s+(.+)$/;

export interface TasksMarkdownFormatValidation {
  ok: boolean;
  errors: string[];
  issues: TasksMarkdownValidationIssue[];
  taskCount: number;
  numberedTaskCount: number;
}

export interface TasksMarkdownValidationIssue {
  code: 'missing_task_list' | 'missing_stable_id' | 'invalid_indent' | 'empty_task_id' | 'duplicate_task_id';
  lineNumber: number | null;
  lineContent?: string;
  taskId?: string;
  message: string;
  suggestion?: string;
}

function isSyntheticTaskId(id?: string | null): boolean {
  return typeof id === 'string' && /^task-\d+$/.test(id);
}

function sessionPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(CREATION_SESSIONS_DIR, `${safeId}.yaml`);
}

async function runExclusiveCreationSessionWrite<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = creationSessionWriteQueues.get(filePath) || Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolveCurrent) => {
    releaseCurrent = resolveCurrent;
  });
  const queued = previous.catch(() => {}).then(() => current);
  creationSessionWriteQueues.set(filePath, queued);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    releaseCurrent();
    if (creationSessionWriteQueues.get(filePath) === queued) {
      creationSessionWriteQueues.delete(filePath);
    }
  }
}

async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, filePath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function ensureDir(): Promise<void> {
  if (!existsSync(CREATION_SESSIONS_DIR)) {
    await mkdir(CREATION_SESSIONS_DIR, { recursive: true });
  }
}

const GENERIC_TASK_SECTION_TITLES = new Set([
  '执行规则',
  '需求与范围确认',
  '设计确认',
  '实现任务',
  'SpecCoding 同步',
  '验证',
  '收口',
]);

function stripSpecCodingTaskComment(input: string): string {
  return input.replace(/\s*<!--\s*spec-coding-task:[\s\S]*?-->\s*$/g, '').trim();
}

function parseTaskComment(line: string): { id?: string; status?: SpecCodingProgressStatus; phaseId?: string } {
  const comment = line.match(/<!--\s*spec-coding-task:([^\s>]+)([^>]*)-->/);
  if (!comment) return {};
  const meta = comment[2] || '';
  const status = meta.match(/\bstatus:(pending|in-progress|completed|blocked)\b/)?.[1] as SpecCodingProgressStatus | undefined;
  const phaseId = meta.match(/\bphase:([^\s>]+)\b/)?.[1];

  return {
    id: comment[1],
    status,
    phaseId,
  };
}

function getTaskStatusFromCheckbox(marker: string): SpecCodingProgressStatus {
  if (marker.toLowerCase() === 'x') return 'completed';
  if (marker === '-') return 'in-progress';
  if (marker === '!') return 'blocked';
  return 'pending';
}

function cleanTaskSectionTitle(raw: string): string {
  return raw
    .replace(/^#+\s*/, '')
    .replace(/^\d+(?:\.\d+)*\.\s*/, '')
    .trim();
}

function inferTaskPhaseId(input: {
  sectionTitle?: string;
  sectionIndex?: number;
  taskTitle: string;
  phases: Array<Pick<SpecCodingPhase, 'id' | 'title'>>;
}): string | undefined {
  const sectionTitle = input.sectionTitle ? cleanTaskSectionTitle(input.sectionTitle) : '';
  if (sectionTitle && !GENERIC_TASK_SECTION_TITLES.has(sectionTitle)) {
    const byTitle = input.phases.find((phase) => sectionTitle === phase.title || sectionTitle.includes(phase.title) || phase.title.includes(sectionTitle));
    if (byTitle) return byTitle.id;
    if (input.sectionIndex && input.phases[input.sectionIndex - 1]) {
      return input.phases[input.sectionIndex - 1].id;
    }
  }

  const byTaskTitle = input.phases.find((phase) => input.taskTitle.includes(phase.title));
  return byTaskTitle?.id;
}

function parseSpecCodingTasksFromMarkdown(
  markdown: string,
  phases: Array<Pick<SpecCodingPhase, 'id' | 'title' | 'ownerAgents'>>
): SpecCodingTask[] {
  const lines = markdown.split(/\r?\n/);

  // 解析单行 checkbox：返回缩进层级、状态、标题、ID
  function parseCheckboxLine(line: string) {
    const match = line.match(/^(\s*)-\s+\[([ xX!-])\](\*?)\s+(.+?)\s*$/);
    if (!match) return null;
    const indent = match[1].length;
    const level = Math.floor(indent / 2); // 0=顶层, 1=子任务, 2=子子任务
    const marker = match[2];
    const rawTitle = stripSpecCodingTaskComment(match[4]);
    const numbered = rawTitle.match(TASK_NUMBER_PATTERN);
    const id = numbered?.[1] || null;
    const title = (numbered?.[3] || rawTitle).trim();
    return { level, marker, id, title, indent };
  }

  // 从详情行中提取需求引用：_需求：1.1, 1.2_
  function extractRequirements(detailLines: string[]): string[] {
    const reqs: string[] = [];
    for (const line of detailLines) {
      const match = line.match(/_需求[：:]\s*(.+?)_/);
      if (match) {
        reqs.push(...match[1].split(/[,，]\s*/).map((s) => s.trim()).filter(Boolean));
      }
    }
    return reqs;
  }

  // 收集当前 checkbox 之后的非 checkbox 详情行
  function collectDetailLines(startIndex: number, minIndent: number): string[] {
    const details: string[] = [];
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s+/.test(line)) break;
      if (/^\s*-\s+\[([ xX!-])\]/.test(line)) break;
      // 空行或缩进大于当前 checkbox 的行都算详情
      if (line.trim() === '' || (line.match(/^(\s*)/)?.[1].length || 0) >= minIndent) {
        details.push(line);
      } else {
        break;
      }
    }
    return details;
  }

  // 第一遍：收集所有 checkbox 节点（扁平列表，带 level）
  interface RawNode {
    level: number;
    id: string;
    title: string;
    status: SpecCodingProgressStatus;
    requirements: string[];
    detail?: string;
    lineIndex: number;
    sectionTitle: string;
    sectionIndex?: number;
  }

  const rawNodes: RawNode[] = [];
  let currentSectionTitle = '';
  let currentSectionIndex: number | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentSectionTitle = heading[1].trim();
      const indexMatch = currentSectionTitle.match(/^(\d+)(?:\.|\s)/);
      currentSectionIndex = indexMatch ? Number(indexMatch[1]) : undefined;
      continue;
    }

    const parsed = parseCheckboxLine(line);
    if (!parsed) continue;

    const commentMeta = parseTaskComment(line);
    const detailLines = collectDetailLines(lineIndex + 1, parsed.indent + 2);
    const requirements = extractRequirements(detailLines);
    // 过滤掉需求引用行，剩余作为 detail
    const detailText = detailLines
      .filter((l) => !/_需求[：:]/.test(l))
      .join('\n').trim() || undefined;

    const id = parsed.id && isSyntheticTaskId(commentMeta.id)
      ? parsed.id
      : (commentMeta.id || parsed.id || `task-${lineIndex + 1}`);

    rawNodes.push({
      level: parsed.level,
      id,
      title: parsed.title,
      status: commentMeta.status || getTaskStatusFromCheckbox(parsed.marker),
      requirements,
      detail: detailText,
      lineIndex,
      sectionTitle: currentSectionTitle,
      sectionIndex: currentSectionIndex,
    });
  }

  // 第二遍：根据 level 构建树形结构
  function buildTree(nodes: RawNode[]): SpecCodingTask[] {
    const roots: SpecCodingTask[] = [];
    // 栈：[task, level]
    const stack: Array<{ task: SpecCodingTask; level: number }> = [];

    for (const node of nodes) {
      const phaseId = inferTaskPhaseId({
        sectionTitle: node.sectionTitle,
        sectionIndex: node.sectionIndex,
        taskTitle: node.title,
        phases,
      });
      const ownerAgents = phaseId
        ? phases.find((phase) => phase.id === phaseId)?.ownerAgents || []
        : [];

      const task: SpecCodingTask = {
        id: node.id,
        title: node.title,
        detail: node.detail,
        status: node.status,
        requirements: node.requirements,
        children: [],
        phaseId,
        ownerAgents,
      };

      // 弹出栈中 level >= 当前 level 的节点
      while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
        stack.pop();
      }

      if (stack.length === 0) {
        roots.push(task);
      } else {
        stack[stack.length - 1].task.children.push(task);
      }

      stack.push({ task, level: node.level });
    }

    return roots;
  }

  return buildTree(rawNodes);
}

export function validateTasksMarkdownFormat(markdown: string): TasksMarkdownFormatValidation {
  const lines = markdown.split(/\r?\n/);
  const errors: string[] = [];
  const issues: TasksMarkdownValidationIssue[] = [];
  const taskIds = new Map<string, number>();
  let taskCount = 0;
  let numberedTaskCount = 0;

  const pushIssue = (issue: TasksMarkdownValidationIssue) => {
    errors.push(issue.message);
    issues.push(issue);
  };

  lines.forEach((line, index) => {
    const match = line.match(/^(\s*)-\s+\[([ xX!-])\](\*?)\s+(.+?)\s*$/);
    if (!match) return;

    taskCount += 1;
    const indent = match[1].length;
    const rawTitle = stripSpecCodingTaskComment(match[4]);
    const numbered = rawTitle.match(TASK_NUMBER_PATTERN);
    if (!numbered) {
      pushIssue({
        code: 'missing_stable_id',
        lineNumber: index + 1,
        lineContent: line.trim(),
        message: `第 ${index + 1} 行任务缺少稳定编号；请使用如 "T1.1 xxx" 或 "1.1 xxx" 的格式。`,
        suggestion: '在 checkbox 后先写稳定编号，再写任务标题，例如 `- [ ] T1.1 定义接口`。',
      });
      return;
    }
    numberedTaskCount += 1;

    if (indent % 2 !== 0) {
      pushIssue({
        code: 'invalid_indent',
        lineNumber: index + 1,
        lineContent: line,
        taskId: numbered[1]?.trim() || undefined,
        message: `第 ${index + 1} 行任务缩进不合法；请使用 2 个空格的层级缩进。`,
        suggestion: '把这一行前导空格调整为 0、2、4、6 这类 2 的倍数。',
      });
    }

    const taskId = numbered[1]?.trim();
    if (!taskId) {
      pushIssue({
        code: 'empty_task_id',
        lineNumber: index + 1,
        lineContent: line.trim(),
        message: `第 ${index + 1} 行任务编号为空。`,
        suggestion: '把任务标题改成 `- [ ] T1.1 任务内容` 这样的形式。',
      });
      return;
    }
    if (taskIds.has(taskId)) {
      const firstLine = taskIds.get(taskId);
      pushIssue({
        code: 'duplicate_task_id',
        lineNumber: index + 1,
        lineContent: line.trim(),
        taskId,
        message: `任务编号 "${taskId}" 重复；每个任务必须使用唯一编号。`,
        suggestion: firstLine
          ? `把这一行或第 ${firstLine} 行的编号改成新的唯一编号。`
          : '把重复任务改成新的唯一编号。',
      });
      return;
    }
    taskIds.set(taskId, index + 1);
  });

  if (taskCount === 0) {
    pushIssue({
      code: 'missing_task_list',
      lineNumber: null,
      message: 'tasks.md 中没有识别到任务列表；请至少提供一条 checkbox 任务。',
      suggestion: '至少添加一行 `- [ ] T1.1 任务标题`。',
    });
  }

  return {
    ok: errors.length === 0,
    errors,
    issues,
    taskCount,
    numberedTaskCount,
  };
}

function assignTaskPhasesByCheckpointBoundaries(
  tasks: SpecCodingTask[],
  phases: Array<Pick<SpecCodingPhase, 'id' | 'title' | 'ownerAgents'>>
): SpecCodingTask[] {
  if (tasks.length === 0 || phases.length === 0) return tasks;

  function allHavePhase(list: SpecCodingTask[]): boolean {
    return list.every((t) => t.phaseId && (t.children.length === 0 || allHavePhase(t.children)));
  }

  if (allHavePhase(tasks)) {
    function enrichOwners(list: SpecCodingTask[]): SpecCodingTask[] {
      return list.map((task) => ({
        ...task,
        ownerAgents: task.phaseId
          ? phases.find((phase) => phase.id === task.phaseId)?.ownerAgents || task.ownerAgents || []
          : task.ownerAgents || [],
        children: enrichOwners(task.children),
      }));
    }
    return enrichOwners(tasks);
  }

  let phaseIndex = 0;
  function assignPhases(list: SpecCodingTask[], parentPhaseId?: string): SpecCodingTask[] {
    return list.map((task) => {
      const inferredPhase = task.phaseId
        ? phases.find((phase) => phase.id === task.phaseId) || phases[phaseIndex]
        : parentPhaseId
          ? phases.find((phase) => phase.id === parentPhaseId) || phases[phaseIndex]
          : phases[phaseIndex];
      const assignedPhaseId = task.phaseId || parentPhaseId || inferredPhase?.id;
      const nextTask: SpecCodingTask = {
        ...task,
        phaseId: assignedPhaseId,
        ownerAgents: task.ownerAgents?.length ? task.ownerAgents : (inferredPhase?.ownerAgents || []),
        children: assignPhases(task.children, assignedPhaseId),
      };
      if (/^CP\d+\b/i.test(task.title) && phaseIndex < phases.length - 1) {
        phaseIndex += 1;
      }
      return nextTask;
    });
  }

  return assignPhases(tasks);
}

function mergeRebuiltSpecCodingWithExisting(
  existing: SpecCodingDocument,
  rebuilt: SpecCodingDocument,
  input?: {
    status?: SpecCodingDocument['status'];
  }
): SpecCodingDocument {
  const nextStatus = input?.status || existing.status || rebuilt.status;
  const merged: SpecCodingDocument = {
    ...rebuilt,
    id: existing.id,
    version: existing.version,
    status: nextStatus,
    title: existing.title || rebuilt.title,
    workflowName: existing.workflowName || rebuilt.workflowName,
    summary: existing.summary || rebuilt.summary,
    goals: existing.goals?.length ? existing.goals : rebuilt.goals,
    nonGoals: existing.nonGoals?.length ? existing.nonGoals : rebuilt.nonGoals,
    constraints: existing.constraints?.length ? existing.constraints : rebuilt.constraints,
    requirements: existing.requirements?.length ? existing.requirements : rebuilt.requirements,
    progress: {
      ...rebuilt.progress,
      overallStatus: existing.progress?.overallStatus || rebuilt.progress.overallStatus,
      completedPhaseIds: existing.progress?.completedPhaseIds || rebuilt.progress.completedPhaseIds,
      activePhaseId: existing.progress?.activePhaseId || rebuilt.progress.activePhaseId,
      summary: existing.progress?.summary || rebuilt.progress.summary,
    },
    revisions: existing.revisions?.length ? existing.revisions : rebuilt.revisions,
    artifacts: {
      requirements: existing.artifacts?.requirements?.trim() || rebuilt.artifacts.requirements,
      design: existing.artifacts?.design?.trim() || rebuilt.artifacts.design,
      tasks: existing.artifacts?.tasks?.trim() || rebuilt.artifacts.tasks,
    },
    createdAt: existing.createdAt || rebuilt.createdAt,
    updatedAt: new Date().toISOString(),
    confirmedAt: nextStatus === 'confirmed'
      ? (existing.confirmedAt || rebuilt.confirmedAt || new Date().toISOString())
      : existing.confirmedAt || rebuilt.confirmedAt,
  };

  return normalizeSpecCodingDocument(merged);
}

/** Flatten a tree of tasks into a flat list for ID-based lookup */
function flattenTasks(tasks: SpecCodingTask[]): SpecCodingTask[] {
  const result: SpecCodingTask[] = [];
  function walk(list: SpecCodingTask[]) {
    for (const task of list) {
      result.push(task);
      if (task.children.length > 0) walk(task.children);
    }
  }
  walk(tasks);
  return result;
}

function updateTasksMarkdownStatus(markdown: string, tasks: SpecCodingTask[]): string {
  if (!markdown.trim() || tasks.length === 0) return markdown;
  const flat = flattenTasks(tasks);
  const byId = new Map(flat.map((task) => [task.id, task]));
  const lines = markdown.split(/\r?\n/);

  return lines.map((line, lineIndex) => {
    const taskLine = line.match(/^(\s*-\s+\[)([ xX!-])(\]\s+)(.+?)\s*$/);
    if (!taskLine) return line;

    const commentMeta = parseTaskComment(line);
    const body = stripSpecCodingTaskComment(taskLine[4]);
    const numbered = body.match(TASK_NUMBER_PATTERN);
    const parsedId = numbered?.[1];
    const id = parsedId && isSyntheticTaskId(commentMeta.id)
      ? parsedId
      : (commentMeta.id || parsedId || `task-${lineIndex + 1}`);
    const task = byId.get(id);
    if (!task) return line;

    const checked = task.status === 'completed' ? 'x' : task.status === 'in-progress' ? '-' : task.status === 'blocked' ? '!' : ' ';
    const phaseMeta = task.phaseId ? ` phase:${task.phaseId}` : '';
    return `${taskLine[1]}${checked}${taskLine[3]}${body} <!-- spec-coding-task:${task.id} status:${task.status}${phaseMeta} -->`;
  }).join('\n');
}

function normalizeSpecCodingArtifactMarkdown(input: string): string {
  const trimmed = input.trim();
  const escapedNewlines = (trimmed.match(/\\n/g) || []).length;
  const realNewlines = (trimmed.match(/\n/g) || []).length;

  if (escapedNewlines >= 2 && escapedNewlines > realNewlines * 2) {
    return trimmed
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t');
  }

  return trimmed;
}

function normalizeSpecCodingArtifacts(specCoding: SpecCodingDocument): SpecCodingDocument['artifacts'] {
  return {
    requirements: normalizeSpecCodingArtifactMarkdown(specCoding.artifacts?.requirements || ''),
    design: normalizeSpecCodingArtifactMarkdown(specCoding.artifacts?.design || ''),
    tasks: normalizeSpecCodingArtifactMarkdown(specCoding.artifacts?.tasks || ''),
  };
}

export function normalizeSpecCodingDocument(specCoding: SpecCodingDocument): SpecCodingDocument {
  const artifacts = normalizeSpecCodingArtifacts(specCoding);
  const parsedTasks = parseSpecCodingTasksFromMarkdown(artifacts.tasks || '', specCoding.phases);
  if (parsedTasks.length === 0) {
    return {
      ...specCoding,
      artifacts,
      tasks: specCoding.tasks || [],
    };
  }

  const existingFlat = flattenTasks(specCoding.tasks || []);
  const existingById = new Map(existingFlat.map((task) => [task.id, task]));
  const phaseStatusById = new Map((specCoding.phases || []).map((phase) => [phase.id, phase.status]));

  function mergeTaskTree(taskList: SpecCodingTask[]): SpecCodingTask[] {
    return taskList.map((task): SpecCodingTask => {
      const existing = existingById.get(task.id);
      const mergedPhaseId = task.phaseId || existing?.phaseId;
      const ownerAgents = task.ownerAgents?.length
        ? task.ownerAgents
        : mergedPhaseId
          ? specCoding.phases.find((phase) => phase.id === mergedPhaseId)?.ownerAgents || existing?.ownerAgents || []
          : existing?.ownerAgents || [];
      const phaseStatus = mergedPhaseId ? phaseStatusById.get(mergedPhaseId) : undefined;

      const mergedChildren = mergeTaskTree(task.children);

      if (!existing) {
        const base = { ...task, phaseId: mergedPhaseId, ownerAgents, children: mergedChildren };
        return phaseStatus === 'completed' ? { ...base, status: 'completed' } : base;
      }
      const statusFromMarkdown = task.status ?? 'pending';
      let status: SpecCodingProgressStatus = statusFromMarkdown === 'pending' && existing.status !== 'pending'
        ? existing.status ?? 'pending'
        : statusFromMarkdown;
      if (phaseStatus === 'completed') {
        status = 'completed';
      } else if (phaseStatus === 'pending' && status === 'in-progress') {
        status = existing.status === 'completed' ? 'completed' : 'pending';
      } else if (phaseStatus === 'blocked' && status === 'pending') {
        status = existing.status === 'completed' ? existing.status : 'blocked';
      }
      return {
        ...task,
        phaseId: mergedPhaseId,
        ownerAgents,
        status,
        children: mergedChildren,
        updatedAt: existing.updatedAt,
        updatedBy: existing.updatedBy,
        validation: existing.validation,
      };
    });
  }

  const tasks = mergeTaskTree(assignTaskPhasesByCheckpointBoundaries(parsedTasks, specCoding.phases));

  return {
    ...specCoding,
    tasks,
    artifacts: {
      ...artifacts,
      tasks: updateTasksMarkdownStatus(artifacts.tasks || '', tasks),
    },
  };
}

export function updateSpecCodingTaskStatuses(
  specCoding: SpecCodingDocument,
  input: {
    updates: Array<{
      id: string;
      status: SpecCodingProgressStatus;
      validation?: string;
    }>;
    updatedBy?: string;
  }
): SpecCodingDocument {
  const normalized = normalizeSpecCodingDocument(specCoding);
  if (input.updates.length === 0 || normalized.tasks.length === 0) return normalized;

  const updateById = new Map(input.updates.map((update) => [update.id, update]));
  const nowIso = new Date().toISOString();

  function applyUpdates(taskList: SpecCodingTask[]): SpecCodingTask[] {
    return taskList.map((task) => {
      const update = updateById.get(task.id);
      const updatedChildren = applyUpdates(task.children);
      if (!update) return { ...task, children: updatedChildren };
      return {
        ...task,
        status: update.status,
        updatedAt: nowIso,
        updatedBy: input.updatedBy || task.updatedBy,
        validation: update.validation || task.validation,
        children: updatedChildren,
      };
    });
  }

  const tasks = applyUpdates(normalized.tasks);

  return {
    ...normalized,
    tasks,
    updatedAt: nowIso,
    artifacts: {
      ...normalized.artifacts,
      tasks: updateTasksMarkdownStatus(normalized.artifacts?.tasks || '', tasks),
    },
  };
}

function updateTasksForPhaseStatus(
  specCoding: SpecCodingDocument,
  input: {
    phaseId?: string;
    status: SpecCodingProgressStatus;
    updatedBy?: string;
    validation?: string;
  }
): SpecCodingDocument {
  const normalized = normalizeSpecCodingDocument(specCoding);
  if (!input.phaseId || normalized.tasks.length === 0) return normalized;

  const nowIso = new Date().toISOString();

  function applyPhaseStatus(taskList: SpecCodingTask[]): SpecCodingTask[] {
    return taskList.map((task) => {
      const updatedChildren = applyPhaseStatus(task.children);
      if (task.phaseId !== input.phaseId) return { ...task, children: updatedChildren };
      return {
        ...task,
        status: input.status,
        updatedAt: nowIso,
        updatedBy: input.updatedBy || task.updatedBy,
        validation: input.validation || task.validation,
        children: updatedChildren,
      };
    });
  }

  const tasks = applyPhaseStatus(normalized.tasks);

  return {
    ...normalized,
    tasks,
    artifacts: {
      ...normalized.artifacts,
      tasks: updateTasksMarkdownStatus(normalized.artifacts?.tasks || '', tasks),
    },
  };
}

function buildRequirementLines(requirements?: string, description?: string) {
  const raw = [requirements || '', description || '']
    .join('\n')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const unique = [...new Set(raw)];
  return unique.map((line, index) => ({
    id: `req-${index + 1}`,
    title: line.length > 48 ? `${line.slice(0, 48)}...` : line,
    detail: line,
    category: index === 0 ? 'goal' as const : 'context' as const,
  }));
}

function deriveSpecCodingStructure(config: StateMachineWorkflowConfig | Record<string, any>) {
  const workflow = (config as any)?.workflow || {};
  const phases = Array.isArray(workflow.states)
    ? workflow.states.map((state: any, index: number) => ({
      id: `state-${index + 1}`,
      title: state.name || `状态 ${index + 1}`,
      objective: state.description || state.steps?.map((step: any) => step.task).filter(Boolean).join('；') || '',
      ownerAgents: [...new Set((state.steps || []).map((step: any) => step.agent).filter(Boolean))],
      status: 'pending' as const,
    }))
    : [];

  const agentNames = [...new Set(phases.flatMap((phase: { ownerAgents: string[] }) => phase.ownerAgents))] as string[];
  const assignments = agentNames.map((agent: string) => ({
    agent,
    responsibility: `负责 ${phases.filter((phase: { ownerAgents: string[] }) => phase.ownerAgents.includes(agent)).map((phase: { title: string }) => phase.title).join('、') || '相关设计与执行'}`,
    phaseIds: phases
      .filter((phase: { ownerAgents: string[] }) => phase.ownerAgents.includes(agent))
      .map((phase: { id: string }) => phase.id),
  }));

  const checkpoints: Array<{ id: string; title: string; phaseId?: string; status: 'pending' }> = [];

  return { phases, assignments, checkpoints };
}

function buildSpecCodingArtifacts(input: {
  workflowName: string;
  description?: string;
  requirements?: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  config: StateMachineWorkflowConfig | Record<string, any>;
  phases: Array<{ id: string; title: string; objective?: string; ownerAgents: string[] }>;
  assignments: Array<{ agent: string; responsibility: string; phaseIds: string[] }>;
}) {
  const workflow = (input.config as any)?.workflow || {};
  const normalizedRequirements = (input.requirements || '').trim();
  const normalizedDescription = (input.description || '').trim();
  const goalSummary = normalizedRequirements || normalizedDescription || `${input.workflowName} 的需求澄清`;

  const plannedPhases = input.phases.length > 0
    ? input.phases
    : [{
        id: 'phase-1',
        title: '需求澄清',
        objective: '补齐目标、约束、验收标准和执行角色。',
        ownerAgents: [] as string[],
      }];

  const reqSections = plannedPhases.map((phase, index) => {
    const reqId = `R${index + 1}`;
    const ownerText = phase.ownerAgents.length ? phase.ownerAgents.join('、') : '相关 Agent';
    const objective = phase.objective || `完成 ${phase.title} 对应目标`;
    return [
      `### 需求 ${reqId}：${phase.title}`,
      '',
      `**能力边界：** ${objective}`,
      '',
      `**证据来源：** workflow config 中的状态 ${phase.title}${phase.ownerAgents.length ? `，负责人 ${phase.ownerAgents.join('、')}` : ''}；具体代码文件需在执行任务中继续勘探。`,
      '',
      `**用户故事：** 作为${ownerText}，我希望${phase.title}有明确输入、执行动作、交付物和验收方式，以便后续 workflow 能按同一基线执行。`,
      '',
      '#### 验收标准',
      `1. WHEN ${phase.title}对应状态启动 THEN 系统向负责 Agent 提供当前目标、依赖、需求追踪和可验证交付物。`,
      `2. WHEN ${phase.title}执行中出现范围、依赖或验收冲突 THEN Agent 必须记录阻塞原因并请求修订，不得扩大范围自行处理。`,
      `3. WHEN ${phase.title}完成 THEN 对应 tasks.md 任务有验证证据，并能追溯到 ${reqId}。`,
    ].join('\n');
  }).join('\n\n');

  const requirements = [
    `# 需求文档：${input.workflowName}`,
    '',
    '## 简介',
    goalSummary,
    '',
    '## 输入解读',
    '',
    `- **用户目标：** ${goalSummary}`,
    `- **硬性要求：** 围绕 ${input.workflowName} 的 workflow 配置和用户输入，先形成可审查、可执行、可验证的 SpecCoding 基线。`,
    '- **非目标边界：** 不在创建态计划中直接修改业务代码，不引入用户未要求的新功能范围。',
    '- **成功判定：** requirements/design/tasks 能明确说明代码证据、需求边界、设计契约、任务目标和验证方式。',
    '',
    '## 代码证据',
    '',
    '| 证据 | 文件/函数/接口 | 说明 | 影响的需求 |',
    '| --- | --- | --- | --- |',
    `| E1 | workflow config: ${input.workflowName} | 当前 workflow 定义了 ${plannedPhases.length} 个状态，是能力拆分和任务边界的主要来源。 | ${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')} |`,
    `| E2 | workingDirectory: ${input.workingDirectory} | 后续代码勘探、实现和验证必须在该工作目录上下文中执行。 | ${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')} |`,
    '| E3 | 待勘探: 相关源码、测试、配置入口 | 具体实现前必须定位真实文件/函数/测试，不能只按抽象阶段执行。 | R1 |',
    '',
    '## 能力拆分',
    '',
    ...plannedPhases.map((phase, index) => `- **C${index + 1} ${phase.title}**: ${phase.objective || `完成 ${phase.title} 对应能力。`}`),
    '',
    '## 术语表',
    `- **工作目录**: ${input.workingDirectory}`,
    `- **工作区模式**: ${input.workspaceMode === 'isolated-copy' ? '隔离副本' : '原地执行'}`,
    '- **执行模式**: 状态机',
    '- **SpecCoding 制品**: requirements.md、design.md、tasks.md 三份互相追踪的计划制品。',
    '- **验证证据**: 能证明任务完成且符合验收标准的测试、构建、审查记录或人工确认。',
    '',
    '## 需求',
    '',
    reqSections,
    '',
    '## 非目标',
    '',
    '- 不在创建态计划中直接修改业务代码。',
    '- 不引入未在需求、设计或用户输入中出现的新功能范围。',
    '',
    '## 待确认项',
    '',
    '- 若后续实现发现需求边界、兼容策略或验证方式不一致，必须先修订 SpecCoding 制品再继续执行。',
  ].join('\n');

  const phaseNodes = plannedPhases
    .map((phase, index) => `    P${index + 1}[${phase.title}]`)
    .join('\n');
  const phaseEdges = plannedPhases
    .slice(1)
    .map((phase, index) => `    P${index + 1} --> P${index + 2}`)
    .join('\n');
  const taskRows = plannedPhases.map((phase, index) => {
    const reqId = `R${index + 1}`;
    const decisionId = index === 0 ? 'D1' : 'D2';
    return [
      `- [ ] T${index + 1} ${phase.title}${phase.ownerAgents.length ? `（负责人：${phase.ownerAgents.join('、')}）` : ''}`,
      `  - [ ] T${index + 1}.1 明确 ${phase.title} 的输入、依赖和交付物`,
      `    - 需求追踪：${reqId}`,
      `    - 设计追踪：${decisionId}`,
      '    - 目标文件：workflow config、requirements.md、design.md、tasks.md；待勘探真实源码/测试入口',
      '    - 动作：检查当前 workflow 配置、用户需求和上游阶段输出，列出本阶段执行边界。',
      '    - 交付：阶段输入/输出说明和未确认风险。',
      '    - 验证：确认没有未解决的阻塞项后再进入执行子任务。',
      `  - [ ] T${index + 1}.2 执行 ${phase.title} 并沉淀验证证据`,
      `    - 需求追踪：${reqId}`,
      `    - 设计追踪：${decisionId}`,
      '    - 目标文件：待勘探: 与本阶段能力相关的源码、配置、测试文件',
      '    - 动作：按 requirements.md 的验收标准完成实现、审查或配置调整。',
      '    - 交付：代码/配置/文档变更以及对应验证结果。',
      '    - 验证：运行相关检查或人工审查，并记录结果。',
    ].join('\n');
  }).join('\n\n');

  const design = [
    `# 设计文档：${input.workflowName}`,
    '',
    '## 概述',
    '使用状态机 workflow 作为执行载体，requirements.md 定义行为边界，design.md 定义实现组织方式，tasks.md 提供可执行任务和验证闭环。',
    '',
    '## 当前实现分析',
    '',
    '| 路径/模块 | 当前行为 | 目标行为 | 差异/风险 | 关联需求 |',
    '| --- | --- | --- | --- | --- |',
    `| workflow config: ${input.workflowName} | 已有 ${plannedPhases.length} 个状态配置。 | 转化为可追踪的 R/D/T 执行基线。 | 状态说明可能不足以直接执行，需要在任务中补代码勘探。 | ${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')} |`,
    `| workingDirectory: ${input.workingDirectory} | 是后续代码勘探和验证的执行上下文。 | 所有实现任务必须绑定真实文件/函数/测试或明确待勘探目标。 | 若跳过代码勘探，任务会退化为泛泛描述。 | ${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')} |`,
    '',
    '## 架构',
    '',
    '```mermaid',
    'flowchart TD',
    '    User[用户需求] --> Spec[SpecCoding 制品]',
    '    Spec --> Req[requirements.md]',
    '    Spec --> Design[design.md]',
    '    Spec --> Tasks[tasks.md]',
    '    Tasks --> Workflow[Workflow 执行]',
    phaseNodes,
    plannedPhases.length > 0 ? '    Workflow --> P1' : '',
    phaseEdges,
    '```',
    '',
    '## 组件与接口',
    '',
    '### SpecCoding 计划层',
    '',
    '**职责：** 保存 requirements/design/tasks 的源文本，并提供任务状态、版本修订和快照记录。',
    '',
    '**输入契约：** workflow 配置、用户需求、工作目录、创建态/运行态 SpecCoding 文档。',
    '',
    '**输出契约：** 可审查的 requirements/design/tasks，结构化任务投影和 revision snapshots。',
    '',
    '**失败契约：** 若计划制品缺少需求追踪、设计追踪、验证方式或仍是空泛内容，保存/确认应失败并返回质量问题。',
    '',
    '**接口：**',
    '',
    '```text',
    'saveCreationSession(specCoding) -> persisted creation session',
    'normalizeSpecCodingDocument(specCoding) -> parsed task projection',
    '```',
    '',
    '### Workflow 执行层',
    '',
    '**职责：** 按 tasks.md 的任务边界调度 Agent，并把验证证据和状态回写到运行态 SpecCoding。',
    '',
    '**输入契约：** 已确认的 SpecCoding 制品、workflow step、任务绑定、运行目录和 agent 配置。',
    '',
    '**输出契约：** Agent 执行结果、验证证据、任务状态和必要的 spec revision。',
    '',
    '**失败契约：** 任务阻塞时记录阻塞原因，不得静默扩大范围或跳过 SpecCoding 修订。',
    '',
    '**接口：**',
    '',
    '```text',
    'compileStepTaskBindings(config, specCoding) -> binding validation',
    'updateSpecCodingTaskStatuses(updates) -> synchronized task markdown',
    '```',
    '',
    '## 数据模型',
    '',
    '- **SpecCodingDocument**: 创建态/运行态计划对象，包含 summary、goals、requirements、phases、tasks、revisions 和 artifacts。',
    '- **SpecCodingArtifact**: requirements/design/tasks 三份 markdown 源文本，是人工审查和 AI 修订的主要对象。',
    '- **SpecCodingTask**: 从 tasks.md checkbox 解析出的结构化任务，保留状态、phaseId、ownerAgents、验证记录和 task comment。',
    '- **StepTaskBinding**: workflow step 与 tasks.md 任务、需求、制品之间的追踪关系。',
    '',
    '## 数据流',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant User as 用户',
    '  participant Spec as SpecCoding',
    '  participant Workflow as Workflow',
    '  participant Agent as Agent',
    '  User->>Spec: 确认 requirements/design/tasks',
    '  Spec->>Workflow: 提供任务绑定和阶段边界',
    '  Workflow->>Agent: 分配最小可执行任务',
    '  Agent-->>Workflow: 返回实现与验证证据',
    '  Workflow-->>Spec: 更新任务状态和修订记录',
    '```',
    '',
    '## 错误与边界矩阵',
    '',
    '| 场景 | 触发条件 | 期望结果 | 处理位置 | 验证方式 | 关联需求 |',
    '| --- | --- | --- | --- | --- | --- |',
    `| 计划制品过粗 | requirements/design/tasks 只有格式，没有代码证据、任务目标或验证方式 | 返回质量问题或要求修订，不进入确认态 | SpecCoding 保存/确认流程 | spec artifact quality tests / 人工审查 | ${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')} |`,
    '| 实现中发现需求漂移 | Agent 执行时发现代码事实与 spec 不一致 | 先修订 requirements/design/tasks，再继续执行 | Workflow 执行层 / Supervisor | 修订记录和任务状态回写 | R1 |',
    '',
    '## 关键决策',
    '',
    '| 编号 | 决策 | 选择 | 理由 | 替代方案 |',
    '| --- | --- | --- | --- | --- |',
    '| D1 | 执行模式 | 状态机 | 当前需求适合通过状态流转与 verdict 驱动来组织执行 | 不直接用自由对话执行，避免缺少任务追踪 |',
    '| D2 | 规划优先 | 先确认阶段目标、需求追踪和验证方式 | 降低后续协作偏差并支持回归审查 | 不先写代码，避免需求漂移 |',
    '| D3 | 任务绑定 | tasks.md 任务作为 workflow step 的主要执行边界 | 让 Agent 输出能回写到 SpecCoding 状态 | 不用纯文本说明替代结构化任务 |',
    '',
    '## 测试方案',
    '',
    '- 单元测试：校验 tasks.md checkbox、任务编号、需求追踪和重复 ID。',
    '- 集成测试：确认创建态 session 保存、修订、确认和 workflow 绑定校验正常。',
    '- 回归测试：确认 requirements/design/tasks 的编号、task comment 和 artifact snapshots 在修订后保留。',
    '- 人工验收：审查每个任务是否有明确动作、交付物和验证方式。',
    '',
    '## 风险与缓解',
    '',
    '- 需求拆解过粗 -> 通过 R 编号、能力拆分和 WHEN/THEN 场景约束需求质量。',
    '- 任务无法执行 -> 每个 T 子任务必须写明动作、交付、验证和 R/D 追踪。',
    '- AI 修订误删绑定 -> 保存前校验 tasks.md 格式和 task comment，必要时人工 diff 审查。',
  ].join('\n');

  const tasks = [
    `# 实现计划：${input.workflowName}`,
    '',
    '## 概述',
    `按 ${plannedPhases.map((_, index) => `R${index + 1}`).join('、')} 的验收标准推进，先确认边界，再执行任务，最后沉淀验证证据。`,
    '',
    '## 执行前证据清单',
    '',
    `- workflow config: ${input.workflowName} 提供阶段、负责人和初始任务边界。`,
    `- workingDirectory: ${input.workingDirectory} 是后续代码勘探和验证命令的执行上下文。`,
    '- 待勘探：每个实现任务开始前必须定位真实文件/函数/测试，不能只按抽象阶段描述执行。',
    '',
    '## 任务',
    '',
    taskRows,
    '',
    '- [ ] T999 最终检查点 - 汇总验证证据和剩余风险',
    `  - 需求追踪：${plannedPhases.map((_, index) => `R${index + 1}`).join(', ')}`,
    '  - 设计追踪：D1, D2, D3',
    '  - 目标文件：测试输出、验证记录、SpecCoding 修订记录',
    '  - 动作：汇总所有已完成任务的验证证据、未解决风险和后续建议。',
    '  - 交付：最终检查点记录。',
    '  - 验证：确认所有非阻塞任务已完成或明确记录阻塞原因。',
  ].join('\n');

  return { requirements, design, tasks };
}

export function buildSpecCodingFromWorkflowConfig(input: {
  workflowName: string;
  description?: string;
  requirements?: string;
  filename: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  workingDirectory: string;
  config: StateMachineWorkflowConfig | Record<string, any>;
}): SpecCodingDocument {
  const nowIso = new Date().toISOString();
  const { phases, assignments, checkpoints } = deriveSpecCodingStructure(input.config);

  const requirements = buildRequirementLines(input.requirements, input.description);
  const summary = input.description?.trim() || input.requirements?.trim() || `${input.workflowName} 的创建期设计草案`;
  const artifacts = buildSpecCodingArtifacts({
    workflowName: input.workflowName,
    description: input.description,
    requirements: input.requirements,
    workingDirectory: input.workingDirectory,
    workspaceMode: input.workspaceMode,
    config: input.config,
    phases,
    assignments,
  });

  const specCoding: SpecCodingDocument = {
    id: randomUUID(),
    version: 1,
    status: 'draft',
    title: `${input.workflowName} SpecCoding`,
    workflowName: input.workflowName,
    summary,
    goals: input.requirements?.trim() ? [input.requirements.trim()] : [input.workflowName],
    nonGoals: [],
    constraints: [
      `工作目录: ${input.workingDirectory}`,
      `工作区模式: ${input.workspaceMode}`,
    ],
    requirements,
    phases,
    assignments,
    checkpoints,
    tasks: [],
    progress: {
      overallStatus: 'pending',
      completedPhaseIds: [],
      activePhaseId: phases[0]?.id,
      summary: '创建态草案已生成，等待确认或修订。',
    },
    revisions: [
      {
        id: randomUUID(),
        version: 1,
        summary: '初始创建期草案生成',
        createdAt: nowIso,
      },
    ],
    artifacts,
    linkedConfigFilename: input.filename,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return normalizeSpecCodingDocument(specCoding);
}

export function buildCreationSession(input: {
  chatSessionId?: string;
  homeChatSessionId?: string;
  createdBy?: string;
  status?: CreationSession['status'];
  specCodingStatus?: SpecCodingDocument['status'];
  filename: string;
  workflowName: string;
  mode: 'state-machine' | 'lightweight';
  referenceWorkflow?: string;
  planningEngine?: string;
  planningModel?: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  description?: string;
  requirements?: string;
  lightweight?: {
    agent?: string;
    task?: string;
    skills?: string[];
    tasklistDirectory?: string;
  };
  clarification?: CreationSession['clarification'];
  stageSessions?: CreationSession['stageSessions'];
  uiState?: CreationSession['uiState'];
  config: StateMachineWorkflowConfig | Record<string, any>;
  specCoding?: SpecCodingDocument;
  persistMode?: 'none' | 'repository';
  specRoot?: string;
}): CreationSession {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const workflow = (input.config as any)?.workflow || {};
  const specCoding = input.specCoding ?? buildSpecCodingFromWorkflowConfig({
    workflowName: input.workflowName,
    description: input.description,
    requirements: input.requirements,
    filename: input.filename,
    workspaceMode: input.workspaceMode,
    workingDirectory: input.workingDirectory,
    config: input.config,
  });
  const generatedConfigSummary: CreationSession['generatedConfigSummary'] = {
    mode: 'state-machine' as const,
    stateCount: Array.isArray(workflow.states) ? workflow.states.length : 0,
    agentNames: [...new Set(
      (Array.isArray(workflow.states)
        ? workflow.states.flatMap((state: any) => (state.steps || []).map((step: any) => step.agent))
        : [])
        .filter(Boolean)
    )] as string[],
  };
  const workflowDraftSummary: CreationSession['workflowDraftSummary'] = {
    mode: generatedConfigSummary.mode,
    nodes: specCoding.phases.map((phase) => ({
      name: phase.title,
      detail: phase.objective || '来自当前已确认的计划阶段目标',
      ownerAgents: phase.ownerAgents || [],
    })),
    assignments: specCoding.assignments.map((assignment) => ({
      agent: assignment.agent,
      responsibility: assignment.responsibility,
    })),
    sourceSummary: '当前草案已整理出节点拆分、职责分工与执行重点，可继续确认后续编排细节。',
  };
  const initialSnapshot = {
    version: specCoding.version,
    summary: specCoding.summary || '初始 SpecCoding 草案',
    createdAt: specCoding.updatedAt || nowIso,
    createdBy: specCoding.revisions.at(-1)?.createdBy,
    artifacts: {
      requirements: specCoding.artifacts?.requirements || '',
      design: specCoding.artifacts?.design || '',
      tasks: specCoding.artifacts?.tasks || '',
    },
  };

  const lightweight = input.mode === 'lightweight' && input.lightweight
    ? {
        ...input.lightweight,
        skills: input.lightweight.skills || [],
        tasklistDirectory: deriveLightweightTasklistDirectory(input.filename),
      }
    : undefined;

  return {
    id: randomUUID(),
    chatSessionId: input.chatSessionId,
    homeChatSessionId: input.homeChatSessionId,
    createdBy: input.createdBy,
    status: input.status || 'config-generated',
    workflowName: input.workflowName,
    filename: input.filename,
    mode: input.mode,
    referenceWorkflow: input.referenceWorkflow,
    planningEngine: input.planningEngine,
    planningModel: input.planningModel,
    workingDirectory: input.workingDirectory,
    workspaceMode: input.workspaceMode,
    description: input.description,
    requirements: input.requirements,
    lightweight,
    clarification: input.clarification,
    stageSessions: input.stageSessions,
    uiState: input.uiState,
    specCoding: (() => {
      const specCodingStatus = input.specCodingStatus || specCoding.status;
      return {
        ...specCoding,
        status: specCodingStatus,
        persistMode: input.persistMode || specCoding.persistMode,
        specRoot: input.specRoot || specCoding.specRoot,
        confirmedAt: specCodingStatus === 'confirmed' ? (specCoding.confirmedAt || nowIso) : specCoding.confirmedAt,
        updatedAt: nowIso,
      };
    })(),
    generatedConfigSummary,
    workflowDraftSummary,
    artifactSnapshots: [initialSnapshot],
    createdAt: now,
    updatedAt: now,
  };
}

function syncCreationSessionArtifactSnapshots(session: CreationSession): CreationSession {
  const snapshots = [...(session.artifactSnapshots || [])];
  const nextSnapshot = {
    version: session.specCoding.version,
    summary: session.specCoding.summary || 'SpecCoding 已更新',
    createdAt: session.specCoding.updatedAt || new Date(session.updatedAt).toISOString(),
    createdBy: session.specCoding.revisions.at(-1)?.createdBy,
    artifacts: {
      requirements: session.specCoding.artifacts?.requirements || '',
      design: session.specCoding.artifacts?.design || '',
      tasks: session.specCoding.artifacts?.tasks || '',
    },
  };

  const existingIndex = snapshots.findIndex((item) => item.version === nextSnapshot.version);
  if (existingIndex >= 0) {
    snapshots[existingIndex] = nextSnapshot;
  } else {
    snapshots.push(nextSnapshot);
  }

  snapshots.sort((a, b) => a.version - b.version);
  return {
    ...session,
    artifactSnapshots: snapshots,
  };
}

export async function saveCreationSession(session: CreationSession): Promise<void> {
  await ensureDir();
  const normalized = creationSessionSchema.parse(syncCreationSessionArtifactSnapshots({
    ...session,
    specCoding: normalizeSpecCodingDocument(session.specCoding),
  }));
  const filePath = sessionPath(normalized.id);
  await runExclusiveCreationSessionWrite(filePath, async () => {
    await atomicWriteUtf8(filePath, stringify(normalized));
  });
}

function parseCreationSessionContent(content: string): { value: unknown; repairedContent?: string } {
  try {
    return { value: parse(content) };
  } catch (error) {
    const repaired = content.replace(/(?:\r?\n[0-9]{6,}\s*)+$/u, '\n');
    if (repaired === content) throw error;
    return { value: parse(repaired), repairedContent: repaired };
  }
}

function normalizeLoadedCreationSession(value: unknown): CreationSession {
  const parsed = creationSessionSchema.parse(value);
  return syncCreationSessionArtifactSnapshots({
    ...parsed,
    specCoding: normalizeSpecCodingDocument(parsed.specCoding),
  } as CreationSession);
}

export async function loadCreationSession(id: string): Promise<CreationSession | null> {
  const filePath = sessionPath(id);
  if (!existsSync(filePath)) return null;
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parseCreationSessionContent(content);
    const session = normalizeLoadedCreationSession(parsed.value);
    if (parsed.repairedContent) {
      await runExclusiveCreationSessionWrite(filePath, async () => {
        await atomicWriteUtf8(filePath, stringify(session));
      });
    }
    return session;
  } catch (err) {
    console.error(`[spec-coding-store] loadCreationSession(${id}) file exists but parse failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

export async function listCreationSessions(filter?: { chatSessionId?: string; createdBy?: string }): Promise<CreationSession[]> {
  await ensureDir();
  const files = await readdir(CREATION_SESSIONS_DIR);
  const sessions: CreationSession[] = [];
  for (const file of files) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const filePath = resolve(CREATION_SESSIONS_DIR, file);
      const content = await readFile(filePath, 'utf-8');
      const parsed = parseCreationSessionContent(content);
      const session = normalizeLoadedCreationSession(parsed.value);
      if (parsed.repairedContent) {
        await runExclusiveCreationSessionWrite(filePath, async () => {
          await atomicWriteUtf8(filePath, stringify(session));
        });
      }
      if (filter?.chatSessionId && session.chatSessionId !== filter.chatSessionId && session.homeChatSessionId !== filter.chatSessionId) continue;
      if (filter?.createdBy && session.createdBy && session.createdBy !== filter.createdBy) continue;
      sessions.push(session);
    } catch {
      // skip broken records
    }
  }
  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  return sessions;
}

export async function loadLatestCreationSessionByFilename(filename: string): Promise<CreationSession | null> {
  const sessions = await listCreationSessions();
  return sessions.find((session) => session.filename === filename) || null;
}

export function cloneCreationSessionForWorkflow(
  session: CreationSession,
  input: {
    filename: string;
    workflowName?: string;
    createdBy?: string;
    config?: StateMachineWorkflowConfig | Record<string, any>;
  }
): CreationSession {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const specCoding = normalizeSpecCodingDocument({
    ...JSON.parse(JSON.stringify(session.specCoding)),
    id: randomUUID(),
    title: session.specCoding.title || input.workflowName || session.workflowName,
    workflowName: input.workflowName || session.specCoding.workflowName || session.workflowName,
    linkedConfigFilename: input.filename,
    updatedAt: nowIso,
  });
  const generatedConfigSummary = input.config
    ? {
        mode: 'state-machine' as const,
        stateCount: Array.isArray((input.config as any)?.workflow?.states) ? (input.config as any).workflow.states.length : 0,
        agentNames: [...new Set(
          (Array.isArray((input.config as any)?.workflow?.states)
            ? (input.config as any).workflow.states.flatMap((state: any) => (state.steps || []).map((step: any) => step.agent))
            : [])
            .filter(Boolean)
        )] as string[],
      }
    : session.generatedConfigSummary;

  return creationSessionSchema.parse({
    ...JSON.parse(JSON.stringify(session)),
    id: randomUUID(),
    chatSessionId: undefined,
    homeChatSessionId: undefined,
    createdBy: input.createdBy || session.createdBy,
    status: session.status === 'archived' ? 'config-generated' : session.status,
    workflowName: input.workflowName || session.workflowName,
    filename: input.filename,
    specCoding,
    generatedConfigSummary,
    artifactSnapshots: [],
    bindingValidation: undefined,
    createdAt: now,
    updatedAt: now,
  });
}

export async function updateCreationSession(id: string, patch: Partial<CreationSession>): Promise<CreationSession | null> {
  const filePath = sessionPath(id);
  if (!existsSync(filePath)) return null;
  return runExclusiveCreationSessionWrite(filePath, async () => {
    let existing: CreationSession;
    try {
      const content = await readFile(filePath, 'utf-8');
      existing = normalizeLoadedCreationSession(parseCreationSessionContent(content).value);
    } catch (err) {
      console.error(`[spec-coding-store] updateCreationSession(${id}) file exists but parse failed:`, err instanceof Error ? err.message : err);
      return null;
    }

    const mergedSpecCoding = patch.specCoding
      ? {
          ...existing.specCoding,
          ...patch.specCoding,
          progress: patch.specCoding.progress
            ? {
                ...existing.specCoding.progress,
                ...patch.specCoding.progress,
              }
            : existing.specCoding.progress,
          artifacts: patch.specCoding.artifacts
            ? {
                ...existing.specCoding.artifacts,
                ...patch.specCoding.artifacts,
              }
            : existing.specCoding.artifacts,
        }
      : existing.specCoding;
    const nextMode = patch.mode || existing.mode;
    const nextFilename = patch.filename || existing.filename;
    const incomingLightweight = patch.lightweight
      ? { ...existing.lightweight, ...patch.lightweight }
      : existing.lightweight;
    const lightweight = nextMode === 'lightweight' && incomingLightweight
      ? {
          ...incomingLightweight,
          skills: incomingLightweight.skills || [],
          tasklistDirectory: deriveLightweightTasklistDirectory(nextFilename),
        }
      : undefined;

    const next = creationSessionSchema.parse({
      ...existing,
      ...patch,
      lightweight,
      specCoding: mergedSpecCoding,
      id: existing.id,
      updatedAt: Date.now(),
    });
    const synced = creationSessionSchema.parse(syncCreationSessionArtifactSnapshots({
      ...next,
      specCoding: normalizeSpecCodingDocument(next.specCoding),
    }));
    await atomicWriteUtf8(filePath, stringify(synced));
    return synced;
  });
}

export async function deleteCreationSession(id: string): Promise<boolean> {
  const existing = await loadCreationSession(id);
  if (!existing) return false;
  await unlink(sessionPath(id));
  return true;
}

function extractRevisionSummary(reviewContent: string, fallback: string): string {
  const normalized = reviewContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*'));
  return (normalized || fallback).slice(0, 160);
}

export function appendSpecCodingRevision(
  specCoding: SpecCodingDocument,
  input: {
    summary: string;
    createdBy?: string;
    status?: SpecCodingDocument['status'];
    progressSummary?: string;
  }
): SpecCodingDocument {
  const nowIso = new Date().toISOString();
  const revisionVersion = specCoding.version + 1;
  const summary = input.summary.trim().slice(0, 200) || 'SpecCoding 已更新';

  return {
    ...specCoding,
    version: revisionVersion,
    status: input.status || specCoding.status,
    summary,
    updatedAt: nowIso,
    progress: input.progressSummary ? {
      ...specCoding.progress,
      summary: input.progressSummary,
    } : specCoding.progress,
    revisions: [
      ...specCoding.revisions,
      {
        id: randomUUID(),
        version: revisionVersion,
        summary,
        createdAt: nowIso,
        createdBy: input.createdBy,
      },
    ],
  };
}

function applyPhaseProgress(
  specCoding: SpecCodingDocument,
  options: {
    stateName: string;
    nextState?: string;
    type: 'state-review' | 'checkpoint-advice';
    verdict?: 'pass' | 'conditional_pass' | 'fail';
  }
): SpecCodingDocument {
  const phases = specCoding.phases.map((phase) => ({ ...phase }));
  const checkpoints = specCoding.checkpoints.map((checkpoint) => ({ ...checkpoint }));
  const currentIndex = phases.findIndex((phase) => phase.title === options.stateName);
  const nextIndex = options.nextState ? phases.findIndex((phase) => phase.title === options.nextState) : -1;

  if (currentIndex >= 0) {
    const currentPhase = phases[currentIndex];
    if (options.type === 'checkpoint-advice') {
      currentPhase.status = options.verdict === 'fail' ? 'blocked' : 'in-progress';
    } else if (options.nextState && options.nextState !== options.stateName) {
      currentPhase.status = 'completed';
    } else {
      currentPhase.status = options.verdict === 'fail' ? 'blocked' : 'in-progress';
    }

    checkpoints.forEach((checkpoint) => {
      if (checkpoint.phaseId === currentPhase.id && options.type === 'checkpoint-advice') {
        checkpoint.status = options.verdict === 'fail' ? 'blocked' : 'in-progress';
      }
    });
  }

  if (nextIndex >= 0) {
    phases[nextIndex].status = 'in-progress';
  }

  const completedPhaseIds = phases.filter((phase) => phase.status === 'completed').map((phase) => phase.id);
  const activePhase = phases.find((phase) => phase.status === 'in-progress');
  const blockedPhase = phases.find((phase) => phase.status === 'blocked');
  const overallStatus: SpecCodingProgressStatus =
    blockedPhase ? 'blocked' :
      activePhase ? 'in-progress' :
        completedPhaseIds.length === phases.length && phases.length > 0 ? 'completed' : 'pending';

  let nextSpecCoding: SpecCodingDocument = {
    ...specCoding,
    phases,
    checkpoints,
    progress: {
      overallStatus,
      completedPhaseIds,
      activePhaseId: activePhase?.id,
      summary: blockedPhase
        ? `阶段 ${blockedPhase.title} 被标记为阻塞，等待进一步处理。`
        : activePhase
          ? `当前推进到阶段 ${activePhase.title}。`
          : completedPhaseIds.length === phases.length && phases.length > 0
            ? '所有阶段已完成。'
            : specCoding.progress.summary,
    },
  };

  if (currentIndex >= 0) {
    nextSpecCoding = updateTasksForPhaseStatus(nextSpecCoding, {
      phaseId: phases[currentIndex].id,
      status: phases[currentIndex].status,
      updatedBy: 'supervisor',
    });
  }
  if (nextIndex >= 0) {
    nextSpecCoding = updateTasksForPhaseStatus(nextSpecCoding, {
      phaseId: phases[nextIndex].id,
      status: 'in-progress',
      updatedBy: 'supervisor',
    });
  }

  return nextSpecCoding;
}

export async function appendSupervisorSpecCodingRevisionByFilename(input: {
  filename: string;
  stateName: string;
  nextState?: string;
  type: 'state-review' | 'checkpoint-advice';
  reviewContent: string;
  supervisorAgent: string;
  verdict?: 'pass' | 'conditional_pass' | 'fail';
}): Promise<CreationSession | null> {
  const session = await loadLatestCreationSessionByFilename(input.filename);
  if (!session) return null;

  const nowIso = new Date().toISOString();
  const revisionVersion = session.specCoding.version + 1;
  const typeLabel = input.type === 'state-review' ? '阶段审阅' : '检查点建议';
  const summary = extractRevisionSummary(
    input.reviewContent,
    `${input.supervisorAgent} 对 ${input.stateName} 进行了 ${typeLabel}`
  );

  let nextSpecCoding = applyPhaseProgress(session.specCoding, {
    stateName: input.stateName,
    nextState: input.nextState,
    type: input.type,
    verdict: input.verdict,
  });

  nextSpecCoding = {
    ...nextSpecCoding,
    version: revisionVersion,
    status: nextSpecCoding.progress.overallStatus === 'completed' ? 'completed' : 'in-progress',
    summary,
    updatedAt: nowIso,
    revisions: [
      ...nextSpecCoding.revisions,
      {
        id: randomUUID(),
        version: revisionVersion,
        summary: `${typeLabel}: ${summary}`,
        createdAt: nowIso,
        createdBy: input.supervisorAgent,
      },
    ],
  };

  return updateCreationSession(session.id, {
    specCoding: nextSpecCoding,
  });
}

export function cloneSpecCodingForRun(
  specCoding: SpecCodingDocument,
  input: { runId: string; filename: string }
): SpecCodingDocument {
  const nowIso = new Date().toISOString();
  return normalizeSpecCodingDocument({
    ...JSON.parse(JSON.stringify(specCoding)),
    id: randomUUID(),
    status: specCoding.status === 'completed' ? 'in-progress' : specCoding.status,
    linkedConfigFilename: input.filename,
    persistMode: specCoding.persistMode,
    specRoot: specCoding.specRoot,
    updatedAt: nowIso,
    progress: {
      ...specCoding.progress,
      overallStatus: specCoding.progress.overallStatus === 'completed' ? 'in-progress' : specCoding.progress.overallStatus,
      summary: `Run ${input.runId} 已从创建态基线派生独立 SpecCoding 快照。`,
    },
  });
}

export function rebuildSpecCodingPreservingArtifacts(input: {
  existing: SpecCodingDocument;
  workflowName: string;
  description?: string;
  requirements?: string;
  filename: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  workingDirectory: string;
  config: StateMachineWorkflowConfig | Record<string, any>;
  status?: SpecCodingDocument['status'];
}): SpecCodingDocument {
  const rebuilt = buildSpecCodingFromWorkflowConfig({
    workflowName: input.workflowName,
    description: input.description,
    requirements: input.requirements,
    filename: input.filename,
    workspaceMode: input.workspaceMode,
    workingDirectory: input.workingDirectory,
    config: input.config,
  });
  return mergeRebuiltSpecCodingWithExisting(input.existing, rebuilt, {
    status: input.status,
  });
}

export function markSpecCodingStateStatus(
  specCoding: SpecCodingDocument,
  input: {
    stateName: string;
    status: SpecCodingPhase['status'];
    summary?: string;
  }
): SpecCodingDocument {
  const phases = specCoding.phases.map((phase) => ({ ...phase }));
  const targetIndex = phases.findIndex((phase) => phase.title === input.stateName);
  if (targetIndex < 0) return specCoding;

  phases[targetIndex].status = input.status;
  const completedPhaseIds = phases.filter((phase) => phase.status === 'completed').map((phase) => phase.id);
  const activePhase = phases.find((phase) => phase.status === 'in-progress');
  const blockedPhase = phases.find((phase) => phase.status === 'blocked');
  const overallStatus: SpecCodingProgressStatus =
    blockedPhase ? 'blocked' :
      activePhase ? 'in-progress' :
        completedPhaseIds.length === phases.length && phases.length > 0 ? 'completed' : 'pending';

  let nextSpecCoding: SpecCodingDocument = {
    ...specCoding,
    phases,
    status: overallStatus === 'completed' ? 'completed' : 'in-progress',
    updatedAt: new Date().toISOString(),
    progress: {
      overallStatus,
      completedPhaseIds,
      activePhaseId: activePhase?.id,
      summary: input.summary || specCoding.progress.summary,
    },
  };

  nextSpecCoding = updateTasksForPhaseStatus(nextSpecCoding, {
    phaseId: phases[targetIndex].id,
    status: input.status,
    validation: input.summary,
  });

  return nextSpecCoding;
}

export function appendSupervisorSpecCodingRevision(
  specCoding: SpecCodingDocument,
  input: {
    stateName: string;
    nextState?: string;
    type: 'state-review' | 'checkpoint-advice';
    reviewContent: string;
    supervisorAgent: string;
    verdict?: 'pass' | 'conditional_pass' | 'fail';
  }
): SpecCodingDocument {
  const typeLabel = input.type === 'state-review' ? '阶段审阅' : '检查点建议';
  const summary = extractRevisionSummary(
    input.reviewContent,
    `${input.supervisorAgent} 对 ${input.stateName} 进行了 ${typeLabel}`
  );

  return appendSpecCodingRevision(specCoding, {
    summary: `${typeLabel}: ${summary}`,
    createdBy: input.supervisorAgent,
    status: specCoding.progress.overallStatus === 'completed' ? 'completed' : specCoding.status,
  });
}

/**
 * 从持久化 master spec 加载为 CreationSession。
 * 如果 master spec 不存在，返回 null。
 */
export async function loadMasterSpecAsCreationSession(
  workingDirectory: string,
  configFilename: string,
  specRoot?: string,
): Promise<CreationSession | null> {
  const specRootDir = getSpecRootDir(workingDirectory, specRoot);
  if (!hasPersistedSpec(specRootDir)) return null;

  const masterSpec = await readMasterSpec(specRootDir);
  if (!masterSpec) return null;

  return buildCreationSession({
    filename: configFilename,
    workflowName: masterSpec.workflowName || configFilename.replace(/\.ya?ml$/i, ''),
    mode: 'state-machine',
    workingDirectory,
    workspaceMode: 'in-place',
    config: { workflow: { mode: 'state-machine', states: masterSpec.phases.map((p) => ({ name: p.title })) } },
    specCoding: {
      ...masterSpec,
      persistMode: 'repository',
      specRoot: specRootDir,
      linkedConfigFilename: configFilename,
    },
    persistMode: 'repository',
    specRoot: specRootDir,
  });
}
