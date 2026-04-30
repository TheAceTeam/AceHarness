import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
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
  type WorkflowConfig,
} from '@/lib/schemas';
import { getWorkspaceDataFile } from '@/lib/app-paths';
import { readMasterSpec, getSpecRootDir, hasPersistedSpec } from '@/lib/spec-persistence';

const CREATION_SESSIONS_DIR = getWorkspaceDataFile('workflow-creation-sessions');

function sessionPath(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return resolve(CREATION_SESSIONS_DIR, `${safeId}.yaml`);
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
    const match = line.match(/^(\s*)-\s+\[([ xX-])\](\*?)\s+(.+?)\s*$/);
    if (!match) return null;
    const indent = match[1].length;
    const level = Math.floor(indent / 2); // 0=顶层, 1=子任务, 2=子子任务
    const marker = match[2];
    const rawTitle = stripSpecCodingTaskComment(match[4]);
    const numbered = rawTitle.match(/^((?:\d+\.)+\d+|\d+)\s+(.+)$/);
    const id = numbered?.[1] || null;
    const title = (numbered?.[2] || rawTitle).trim();
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
      if (/^\s*-\s+\[([ xX-])\]/.test(line)) break;
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

    const id = commentMeta.id || parsed.id || `task-${lineIndex + 1}`;

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
    const taskLine = line.match(/^(\s*-\s+\[)([ xX-])(\]\s+)(.+?)\s*$/);
    if (!taskLine) return line;

    const commentMeta = parseTaskComment(line);
    const body = stripSpecCodingTaskComment(taskLine[4]);
    const numbered = body.match(/^((?:\d+\.)+\d+|\d+)\s+(.+)$/);
    const id = commentMeta.id || numbered?.[1] || `task-${lineIndex + 1}`;
    const task = byId.get(id);
    if (!task) return line;

    const checked = task.status === 'completed' ? 'x' : task.status === 'in-progress' ? '-' : ' ';
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

function deriveSpecCodingStructure(config: WorkflowConfig | Record<string, any>) {
  const workflow = (config as any)?.workflow || {};
  const phases = Array.isArray(workflow.phases)
    ? workflow.phases.map((phase: any, index: number) => ({
      id: `phase-${index + 1}`,
      title: phase.name || `阶段 ${index + 1}`,
      objective: phase.steps?.map((step: any) => step.task).filter(Boolean).join('；') || '',
      ownerAgents: [...new Set((phase.steps || []).map((step: any) => step.agent).filter(Boolean))],
      status: 'pending' as const,
    }))
    : Array.isArray(workflow.states)
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

  const checkpoints = Array.isArray(workflow.phases)
    ? workflow.phases
      .map((phase: any, index: number) => phase?.checkpoint ? {
        id: `checkpoint-${index + 1}`,
        title: phase.checkpoint.name || `检查点 ${index + 1}`,
        phaseId: phases[index]?.id,
        status: 'pending' as const,
      } : null)
      .filter(Boolean)
    : [];

  return { phases, assignments, checkpoints };
}

function buildSpecCodingArtifacts(input: {
  workflowName: string;
  description?: string;
  requirements?: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  config: WorkflowConfig | Record<string, any>;
  phases: Array<{ id: string; title: string; objective?: string; ownerAgents: string[] }>;
  assignments: Array<{ agent: string; responsibility: string; phaseIds: string[] }>;
}) {
  const workflow = (input.config as any)?.workflow || {};
  const mode = workflow.mode === 'state-machine' ? 'state-machine' : 'phase-based';
  const normalizedRequirements = (input.requirements || '').trim();
  const normalizedDescription = (input.description || '').trim();
  const goalSummary = normalizedRequirements || normalizedDescription || `${input.workflowName} 的需求澄清`;

  // requirements.md — 用户故事 + WHEN/THEN 验收标准
  const reqSections = input.phases.length > 0
    ? input.phases.map((phase, index) => {
      const ownerText = phase.ownerAgents.length ? phase.ownerAgents.join('、') : '相关 Agent';
      return [
        `### 需求 ${index + 1}：${phase.title}`,
        `**用户故事：** 作为${ownerText}，我希望完成${phase.title}，以便推进整体工作流目标。`,
        '',
        '#### 验收标准',
        `1. WHEN ${phase.title}阶段启动 THEN ${ownerText}开始执行对应任务`,
        `2. WHEN ${phase.title}阶段完成 THEN 所有子任务标记为已完成`,
      ].join('\n');
    }).join('\n\n')
    : [
      '### 需求 1：需求澄清',
      '**用户故事：** 作为用户，我希望明确目标和约束，以便后续执行有清晰的基线。',
      '',
      '#### 验收标准',
      '1. WHEN 需求澄清完成 THEN 目标、约束与验收标准已补齐',
      '2. WHEN 需求澄清完成 THEN 后续执行阶段与角色分工已明确',
    ].join('\n');

  const requirements = [
    `# 需求文档：${input.workflowName}`,
    '',
    '## 简介',
    goalSummary,
    '',
    '## 术语表',
    `- **工作目录**: ${input.workingDirectory}`,
    `- **工作区模式**: ${input.workspaceMode === 'isolated-copy' ? '隔离副本' : '原地执行'}`,
    `- **执行模式**: ${mode === 'state-machine' ? '状态机' : '阶段式'}`,
    '',
    '## 需求',
    '',
    reqSections,
  ].join('\n');

  // design.md — 精简版
  const design = [
    `# 设计文档：${input.workflowName}`,
    '',
    '## 概述',
    `使用 ${mode === 'state-machine' ? '状态机' : '阶段式'} workflow 作为执行载体，先锁定需求与设计，再推进实现。`,
    '',
    '## 关键决策',
    '',
    '| 决策 | 选择 | 理由 |',
    '| --- | --- | --- |',
    `| 执行模式 | ${mode === 'state-machine' ? '状态机' : '阶段式'} | 当前需求更适合通过${mode === 'state-machine' ? '状态流转与 verdict 驱动' : '显式阶段拆分'}来组织执行 |`,
    '| 规划优先 | 先确认阶段目标与职责边界 | 降低后续协作偏差 |',
  ].join('\n');

  // tasks.md — 多级嵌套 checkbox
  const taskSections = input.phases.length > 0
    ? input.phases.map((phase, index) => {
      const ownerText = phase.ownerAgents.length ? `（负责人：${phase.ownerAgents.join('、')}）` : '';
      return [
        `- [ ] ${index + 1}. ${phase.title}${ownerText}`,
        `  - [ ] ${index + 1}.1 明确 ${phase.title} 的验收标准`,
        `    - _需求：${index + 1}_`,
        `  - [ ] ${index + 1}.2 按需求完成 ${phase.title} 的执行内容`,
        `    - _需求：${index + 1}_`,
      ].join('\n');
    }).join('\n\n')
    : [
      '- [ ] 1. 需求澄清',
      '  - [ ] 1.1 补齐目标、约束与验收标准',
      '    - _需求：1_',
      '  - [ ] 1.2 明确后续执行阶段与角色分工',
      '    - _需求：1_',
    ].join('\n');
  const tasks = [
    `# 实现计划：${input.workflowName}`,
    '',
    '## 概述',
    '先完成需求澄清、方案设计与任务拆解，形成清晰的协作与执行基线，再推进后续实现。',
    '',
    '## 任务',
    '',
    taskSections,
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
  config: WorkflowConfig | Record<string, any>;
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
  createdBy?: string;
  status?: CreationSession['status'];
  specCodingStatus?: SpecCodingDocument['status'];
  filename: string;
  workflowName: string;
  mode: 'phase-based' | 'state-machine' | 'ai-guided';
  referenceWorkflow?: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  description?: string;
  requirements?: string;
  clarification?: CreationSession['clarification'];
  uiState?: CreationSession['uiState'];
  config: WorkflowConfig | Record<string, any>;
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
    mode: workflow.mode === 'state-machine' ? 'state-machine' as const : 'phase-based' as const,
    phaseCount: Array.isArray(workflow.phases) ? workflow.phases.length : 0,
    stateCount: Array.isArray(workflow.states) ? workflow.states.length : 0,
    agentNames: [...new Set(
      (Array.isArray(workflow.phases)
        ? workflow.phases.flatMap((phase: any) => (phase.steps || []).map((step: any) => step.agent))
        : Array.isArray(workflow.states)
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

  return {
    id: randomUUID(),
    chatSessionId: input.chatSessionId,
    createdBy: input.createdBy,
    status: input.status || 'config-generated',
    workflowName: input.workflowName,
    filename: input.filename,
    mode: input.mode,
    referenceWorkflow: input.referenceWorkflow,
    workingDirectory: input.workingDirectory,
    workspaceMode: input.workspaceMode,
    description: input.description,
    requirements: input.requirements,
    clarification: input.clarification,
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
  await writeFile(sessionPath(normalized.id), stringify(normalized), 'utf-8');
}

export async function loadCreationSession(id: string): Promise<CreationSession | null> {
  try {
    const content = await readFile(sessionPath(id), 'utf-8');
    const parsed = creationSessionSchema.parse(parse(content));
    return syncCreationSessionArtifactSnapshots({
      ...parsed,
      specCoding: normalizeSpecCodingDocument(parsed.specCoding),
    } as CreationSession);
  } catch {
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
      const content = await readFile(resolve(CREATION_SESSIONS_DIR, file), 'utf-8');
      const session = creationSessionSchema.parse(parse(content));
      if (filter?.chatSessionId && session.chatSessionId !== filter.chatSessionId) continue;
      if (filter?.createdBy && session.createdBy && session.createdBy !== filter.createdBy) continue;
      sessions.push(syncCreationSessionArtifactSnapshots({
        ...session,
        specCoding: normalizeSpecCodingDocument(session.specCoding),
      } as CreationSession));
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

export async function updateCreationSession(id: string, patch: Partial<CreationSession>): Promise<CreationSession | null> {
  const existing = await loadCreationSession(id);
  if (!existing) return null;
  const next = creationSessionSchema.parse({
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: Date.now(),
  });
  const synced = syncCreationSessionArtifactSnapshots(next);
  await saveCreationSession(synced);
  return synced;
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
  config: WorkflowConfig | Record<string, any>;
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
