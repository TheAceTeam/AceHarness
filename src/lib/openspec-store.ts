import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { parse, stringify } from 'yaml';
import {
  creationSessionSchema,
  type CreationSession,
  type OpenSpecDocument,
  type OpenSpecPhase,
  type OpenSpecProgressStatus,
  type OpenSpecTask,
  type WorkflowConfig,
} from '@/lib/schemas';
import { getWorkspaceDataFile } from '@/lib/app-paths';

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
  'OpenSpec 同步',
  '验证',
  '收口',
]);

function stripOpenSpecTaskComment(input: string): string {
  return input.replace(/\s*<!--\s*openspec-task:[\s\S]*?-->\s*$/g, '').trim();
}

function parseTaskComment(line: string): { id?: string; status?: OpenSpecProgressStatus; phaseId?: string } {
  const comment = line.match(/<!--\s*openspec-task:([^\s>]+)([^>]*)-->/);
  if (!comment) return {};
  const meta = comment[2] || '';
  const status = meta.match(/\bstatus:(pending|in-progress|completed|blocked)\b/)?.[1] as OpenSpecProgressStatus | undefined;
  const phaseId = meta.match(/\bphase:([^\s>]+)\b/)?.[1];
  return {
    id: comment[1],
    status,
    phaseId,
  };
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
  phases: Array<Pick<OpenSpecPhase, 'id' | 'title'>>;
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

function parseOpenSpecTasksFromMarkdown(
  markdown: string,
  phases: Array<Pick<OpenSpecPhase, 'id' | 'title' | 'ownerAgents'>>
): OpenSpecTask[] {
  const lines = markdown.split(/\r?\n/);
  const tasks: OpenSpecTask[] = [];
  let currentSectionTitle = '';
  let currentSectionIndex: number | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      currentSectionTitle = heading[1].trim();
      const indexMatch = currentSectionTitle.match(/^(\d+)(?:\.|\s)/);
      currentSectionIndex = indexMatch ? Number(indexMatch[1]) : undefined;
      continue;
    }

    const taskLine = line.match(/^\s*-\s+\[([ xX-])\]\s+(.+?)\s*$/);
    if (!taskLine) continue;

    const commentMeta = parseTaskComment(line);
    const body = stripOpenSpecTaskComment(taskLine[2]);
    const numbered = body.match(/^((?:\d+\.)+\d+|\d+)\s+(.+)$/);
    const id = commentMeta.id || numbered?.[1] || `task-${lineIndex + 1}`;
    const title = (numbered?.[2] || body).trim();
    const detailLines: string[] = [];
    for (let nextIndex = lineIndex + 1; nextIndex < lines.length; nextIndex += 1) {
      const nextLine = lines[nextIndex];
      if (/^##\s+/.test(nextLine)) break;
      if (/^\s*-\s+\[([ xX-])\]\s+(.+?)\s*$/.test(nextLine)) break;
      detailLines.push(nextLine);
    }
    const detail = detailLines.join('\n').trim() || undefined;
    const phaseId = commentMeta.phaseId || inferTaskPhaseId({
      sectionTitle: currentSectionTitle,
      sectionIndex: currentSectionIndex,
      taskTitle: title,
      phases,
    });
    const ownerAgents = phaseId
      ? phases.find((phase) => phase.id === phaseId)?.ownerAgents || []
      : [];

    tasks.push({
      id,
      title,
      detail,
      status: commentMeta.status || (
        taskLine[1].toLowerCase() === 'x'
          ? 'completed'
          : taskLine[1] === '-'
            ? 'in-progress'
            : 'pending'
      ),
      phaseId,
      ownerAgents,
    });
  }

  return tasks;
}

function mergeRebuiltOpenSpecWithExisting(
  existing: OpenSpecDocument,
  rebuilt: OpenSpecDocument,
  input?: {
    status?: OpenSpecDocument['status'];
  }
): OpenSpecDocument {
  const nextStatus = input?.status || existing.status || rebuilt.status;
  const merged: OpenSpecDocument = {
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
      proposal: existing.artifacts?.proposal?.trim() || rebuilt.artifacts.proposal,
      design: existing.artifacts?.design?.trim() || rebuilt.artifacts.design,
      tasks: existing.artifacts?.tasks?.trim() || rebuilt.artifacts.tasks,
      deltaSpec: existing.artifacts?.deltaSpec?.trim() || rebuilt.artifacts.deltaSpec,
    },
    createdAt: existing.createdAt || rebuilt.createdAt,
    updatedAt: new Date().toISOString(),
    confirmedAt: nextStatus === 'confirmed'
      ? (existing.confirmedAt || rebuilt.confirmedAt || new Date().toISOString())
      : existing.confirmedAt || rebuilt.confirmedAt,
  };

  return normalizeOpenSpecDocument(merged);
}

function updateTasksMarkdownStatus(markdown: string, tasks: OpenSpecTask[]): string {
  if (!markdown.trim() || tasks.length === 0) return markdown;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const lines = markdown.split(/\r?\n/);

  return lines.map((line, lineIndex) => {
    const taskLine = line.match(/^(\s*-\s+\[)([ xX-])(\]\s+)(.+?)\s*$/);
    if (!taskLine) return line;

    const commentMeta = parseTaskComment(line);
    const body = stripOpenSpecTaskComment(taskLine[4]);
    const numbered = body.match(/^((?:\d+\.)+\d+|\d+)\s+(.+)$/);
    const id = commentMeta.id || numbered?.[1] || `task-${lineIndex + 1}`;
    const task = byId.get(id);
    if (!task) return line;

    const checked = task.status === 'completed' ? 'x' : task.status === 'in-progress' ? '-' : ' ';
    const phaseMeta = task.phaseId ? ` phase:${task.phaseId}` : '';
    return `${taskLine[1]}${checked}${taskLine[3]}${body} <!-- openspec-task:${task.id} status:${task.status}${phaseMeta} -->`;
  }).join('\n');
}

export function normalizeOpenSpecDocument(openSpec: OpenSpecDocument): OpenSpecDocument {
  const parsedTasks = parseOpenSpecTasksFromMarkdown(openSpec.artifacts?.tasks || '', openSpec.phases);
  if (parsedTasks.length === 0) {
    return {
      ...openSpec,
      tasks: openSpec.tasks || [],
    };
  }

  const existingById = new Map((openSpec.tasks || []).map((task) => [task.id, task]));
  const tasks = parsedTasks.map((task) => {
    const existing = existingById.get(task.id);
    if (!existing) return task;
    const statusFromMarkdown = task.status;
    const status = statusFromMarkdown === 'pending' && existing.status !== 'pending'
      ? existing.status
      : statusFromMarkdown;
    return {
      ...task,
      status,
      updatedAt: existing.updatedAt,
      updatedBy: existing.updatedBy,
      validation: existing.validation,
    };
  });

  return {
    ...openSpec,
    tasks,
    artifacts: {
      ...openSpec.artifacts,
      tasks: updateTasksMarkdownStatus(openSpec.artifacts?.tasks || '', tasks),
    },
  };
}

export function updateOpenSpecTaskStatuses(
  openSpec: OpenSpecDocument,
  input: {
    updates: Array<{
      id: string;
      status: OpenSpecProgressStatus;
      validation?: string;
    }>;
    updatedBy?: string;
  }
): OpenSpecDocument {
  const normalized = normalizeOpenSpecDocument(openSpec);
  if (input.updates.length === 0 || normalized.tasks.length === 0) return normalized;

  const updateById = new Map(input.updates.map((update) => [update.id, update]));
  const nowIso = new Date().toISOString();
  const tasks = normalized.tasks.map((task) => {
    const update = updateById.get(task.id);
    if (!update) return task;
    return {
      ...task,
      status: update.status,
      updatedAt: nowIso,
      updatedBy: input.updatedBy || task.updatedBy,
      validation: update.validation || task.validation,
    };
  });

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
  openSpec: OpenSpecDocument,
  input: {
    phaseId?: string;
    status: OpenSpecProgressStatus;
    updatedBy?: string;
    validation?: string;
  }
): OpenSpecDocument {
  const normalized = normalizeOpenSpecDocument(openSpec);
  if (!input.phaseId || normalized.tasks.length === 0) return normalized;

  const nowIso = new Date().toISOString();
  const tasks = normalized.tasks.map((task) => {
    if (task.phaseId !== input.phaseId) return task;
    return {
      ...task,
      status: input.status,
      updatedAt: nowIso,
      updatedBy: input.updatedBy || task.updatedBy,
      validation: input.validation || task.validation,
    };
  });

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

function deriveOpenSpecStructure(config: WorkflowConfig | Record<string, any>) {
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

function buildOpenSpecArtifacts(input: {
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
  const scopeIncludes = [
    normalizedRequirements ? `围绕「${normalizedRequirements}」生成正式 OpenSpec 制品` : '',
    `在 ${input.workingDirectory} 下规划执行`,
    `使用 ${mode === 'state-machine' ? '状态机' : '阶段式'} workflow 承载后续执行`,
    input.assignments.length ? `规划 ${input.assignments.length} 个 Agent 的职责分工` : '',
  ].filter(Boolean);
  const scopeExcludes = [
    '不包含与当前目标无关的额外能力扩展',
  ];

  const proposal = [
    `# Proposal: ${input.workflowName}`,
    '',
    '## Intent',
    goalSummary,
    '',
    '## Scope',
    '',
    'Includes:',
    ...scopeIncludes.map((line) => `- ${line}`),
    '',
    'Excludes:',
    ...scopeExcludes.map((line) => `- ${line}`),
    '',
    '## Approach',
    '先完成需求澄清、方案设计与任务拆解，形成清晰的协作与执行基线，再推进后续实现。',
  ].join('\n');

  const designDecisions = [
    `### Decision: 使用 ${mode === 'state-machine' ? '状态机' : '阶段式'} workflow 作为执行载体`,
    `原因：当前需求更适合通过 ${mode === 'state-machine' ? '状态流转与 verdict 驱动' : '显式阶段拆分'} 来组织执行。`,
    '',
    '### Decision: 先确认阶段目标与职责边界',
    '原因：先锁定需求、约束、设计与任务，再细化执行编排，能降低后续协作偏差。',
  ].join('\n');
  const affectedAreas = [
    '- 创建态会话与 OpenSpec 制品',
    '- workflow 草案生成',
    '- Agent 分工与 Supervisor 收口',
  ].join('\n');
  const risks = [
    '1. 需求澄清不充分会导致后续 workflow 草案偏差。',
    '2. Agent 分工如果只看名称不看职责，容易形成空泛配置。',
    '3. 参考 workflow 存在时，需要保留骨架同时替换需求语义。',
  ].join('\n');
  const design = [
    `# Design: ${input.workflowName}`,
    '',
    '## Technical Approach',
    '创建阶段先明确目标、边界、关键决策、任务拆分与角色分工，作为后续执行编排与协作对齐的共同依据。',
    '',
    '## Key Decisions',
    '',
    designDecisions,
    '',
    '## Affected Areas',
    affectedAreas,
    '',
    '## Risks And Tradeoffs',
    risks,
  ].join('\n');

  const taskSections = input.phases.length > 0
    ? input.phases.map((phase, index) => {
      const ownerText = phase.ownerAgents.length ? `（负责人：${phase.ownerAgents.join('、')}）` : '';
      return [
        `## ${index + 1}. ${phase.title}${ownerText}`,
        `- [ ] ${index + 1}.1 明确 ${phase.title} 的验收标准`,
        `- [ ] ${index + 1}.2 按 spec 完成 ${phase.title} 的执行内容`,
      ].join('\n');
    }).join('\n\n')
    : '## 1. 需求澄清\n- [ ] 1.1 补齐目标、约束与验收标准\n- [ ] 1.2 明确后续执行阶段与角色分工';
  const tasks = ['# Tasks', '', taskSections].join('\n');

  const deltaRequirements = input.phases.length > 0
    ? input.phases.map((phase) => [
      `### 需求:${phase.title}`,
      `系统 MUST 在执行编排中显式体现「${phase.title}」这一阶段。`,
      '',
      `#### 场景:${phase.title} 纳入执行编排`,
      `- 假如该计划已进入执行编排阶段`,
      `- 当系统组织后续执行流程时`,
      `- 则必须保留名称为「${phase.title}」的阶段或状态`,
      `- 并且将 ${phase.ownerAgents.length ? phase.ownerAgents.join('、') : '对应 Agent'} 的职责绑定到该阶段`,
    ].join('\n')).join('\n\n')
    : [
      '### 需求:计划先于执行编排确认',
      '系统 MUST 在计划确认后再进入后续执行编排。',
      '',
      '#### 场景:先确认计划再推进执行',
      '- 假如用户正在创建 workflow',
      '- 当计划内容还未确认时',
      '- 则系统不能直接跳过到最终执行配置',
      '- 并且必须先展示正式计划制品供用户确认',
    ].join('\n');
  const deltaSpec = [
    `# ${input.workflowName} 增量规范`,
    '',
    '## 新增需求',
    '',
    deltaRequirements,
  ].join('\n');

  return { proposal, design, tasks, deltaSpec };
}

export function buildOpenSpecFromWorkflowConfig(input: {
  workflowName: string;
  description?: string;
  requirements?: string;
  filename: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  workingDirectory: string;
  config: WorkflowConfig | Record<string, any>;
}): OpenSpecDocument {
  const nowIso = new Date().toISOString();
  const { phases, assignments, checkpoints } = deriveOpenSpecStructure(input.config);

  const requirements = buildRequirementLines(input.requirements, input.description);
  const summary = input.description?.trim() || input.requirements?.trim() || `${input.workflowName} 的创建期设计草案`;
  const artifacts = buildOpenSpecArtifacts({
    workflowName: input.workflowName,
    description: input.description,
    requirements: input.requirements,
    workingDirectory: input.workingDirectory,
    workspaceMode: input.workspaceMode,
    config: input.config,
    phases,
    assignments,
  });

  const openSpec: OpenSpecDocument = {
    id: randomUUID(),
    version: 1,
    status: 'draft',
    title: `${input.workflowName} OpenSpec`,
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

  return normalizeOpenSpecDocument(openSpec);
}

export function buildCreationSession(input: {
  chatSessionId?: string;
  createdBy?: string;
  status?: CreationSession['status'];
  openSpecStatus?: OpenSpecDocument['status'];
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
  openSpec?: OpenSpecDocument;
}): CreationSession {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const workflow = (input.config as any)?.workflow || {};
  const openSpec = input.openSpec ?? buildOpenSpecFromWorkflowConfig({
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
    nodes: openSpec.phases.map((phase) => ({
      name: phase.title,
      detail: phase.objective || '来自当前已确认的计划阶段目标',
      ownerAgents: phase.ownerAgents || [],
    })),
    assignments: openSpec.assignments.map((assignment) => ({
      agent: assignment.agent,
      responsibility: assignment.responsibility,
    })),
    sourceSummary: '当前草案已整理出节点拆分、职责分工与执行重点，可继续确认后续编排细节。',
  };
  const initialSnapshot = {
    version: openSpec.version,
    summary: openSpec.summary || '初始 OpenSpec 草案',
    createdAt: openSpec.updatedAt || nowIso,
    createdBy: openSpec.revisions.at(-1)?.createdBy,
    artifacts: {
      proposal: openSpec.artifacts?.proposal || '',
      design: openSpec.artifacts?.design || '',
      tasks: openSpec.artifacts?.tasks || '',
      deltaSpec: openSpec.artifacts?.deltaSpec || '',
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
    openSpec: (() => {
      const openSpecStatus = input.openSpecStatus || openSpec.status;
      return {
        ...openSpec,
        status: openSpecStatus,
        confirmedAt: openSpecStatus === 'confirmed' ? (openSpec.confirmedAt || nowIso) : openSpec.confirmedAt,
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
    version: session.openSpec.version,
    summary: session.openSpec.summary || 'OpenSpec 已更新',
    createdAt: session.openSpec.updatedAt || new Date(session.updatedAt).toISOString(),
    createdBy: session.openSpec.revisions.at(-1)?.createdBy,
    artifacts: {
      proposal: session.openSpec.artifacts?.proposal || '',
      design: session.openSpec.artifacts?.design || '',
      tasks: session.openSpec.artifacts?.tasks || '',
      deltaSpec: session.openSpec.artifacts?.deltaSpec || '',
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
    openSpec: normalizeOpenSpecDocument(session.openSpec),
  }));
  await writeFile(sessionPath(normalized.id), stringify(normalized), 'utf-8');
}

export async function loadCreationSession(id: string): Promise<CreationSession | null> {
  try {
    const content = await readFile(sessionPath(id), 'utf-8');
    const parsed = creationSessionSchema.parse(parse(content));
    return syncCreationSessionArtifactSnapshots({
      ...parsed,
      openSpec: normalizeOpenSpecDocument(parsed.openSpec),
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
        openSpec: normalizeOpenSpecDocument(session.openSpec),
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

export function appendOpenSpecRevision(
  openSpec: OpenSpecDocument,
  input: {
    summary: string;
    createdBy?: string;
    status?: OpenSpecDocument['status'];
    progressSummary?: string;
  }
): OpenSpecDocument {
  const nowIso = new Date().toISOString();
  const revisionVersion = openSpec.version + 1;
  const summary = input.summary.trim().slice(0, 200) || 'OpenSpec 已更新';

  return {
    ...openSpec,
    version: revisionVersion,
    status: input.status || openSpec.status,
    summary,
    updatedAt: nowIso,
    progress: input.progressSummary ? {
      ...openSpec.progress,
      summary: input.progressSummary,
    } : openSpec.progress,
    revisions: [
      ...openSpec.revisions,
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
  openSpec: OpenSpecDocument,
  options: {
    stateName: string;
    nextState?: string;
    type: 'state-review' | 'checkpoint-advice';
    verdict?: 'pass' | 'conditional_pass' | 'fail';
  }
): OpenSpecDocument {
  const phases = openSpec.phases.map((phase) => ({ ...phase }));
  const checkpoints = openSpec.checkpoints.map((checkpoint) => ({ ...checkpoint }));
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
  const overallStatus: OpenSpecProgressStatus =
    blockedPhase ? 'blocked' :
      activePhase ? 'in-progress' :
        completedPhaseIds.length === phases.length && phases.length > 0 ? 'completed' : 'pending';

  let nextOpenSpec: OpenSpecDocument = {
    ...openSpec,
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
            : openSpec.progress.summary,
    },
  };

  if (currentIndex >= 0) {
    nextOpenSpec = updateTasksForPhaseStatus(nextOpenSpec, {
      phaseId: phases[currentIndex].id,
      status: phases[currentIndex].status,
      updatedBy: 'supervisor',
    });
  }
  if (nextIndex >= 0) {
    nextOpenSpec = updateTasksForPhaseStatus(nextOpenSpec, {
      phaseId: phases[nextIndex].id,
      status: 'in-progress',
      updatedBy: 'supervisor',
    });
  }

  return nextOpenSpec;
}

export async function appendSupervisorOpenSpecRevisionByFilename(input: {
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
  const revisionVersion = session.openSpec.version + 1;
  const typeLabel = input.type === 'state-review' ? '阶段审阅' : '检查点建议';
  const summary = extractRevisionSummary(
    input.reviewContent,
    `${input.supervisorAgent} 对 ${input.stateName} 进行了 ${typeLabel}`
  );

  let nextOpenSpec = applyPhaseProgress(session.openSpec, {
    stateName: input.stateName,
    nextState: input.nextState,
    type: input.type,
    verdict: input.verdict,
  });

  nextOpenSpec = {
    ...nextOpenSpec,
    version: revisionVersion,
    status: nextOpenSpec.progress.overallStatus === 'completed' ? 'completed' : 'in-progress',
    summary,
    updatedAt: nowIso,
    revisions: [
      ...nextOpenSpec.revisions,
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
    openSpec: nextOpenSpec,
  });
}

export function cloneOpenSpecForRun(
  openSpec: OpenSpecDocument,
  input: { runId: string; filename: string }
): OpenSpecDocument {
  const nowIso = new Date().toISOString();
  return normalizeOpenSpecDocument({
    ...JSON.parse(JSON.stringify(openSpec)),
    id: randomUUID(),
    status: openSpec.status === 'completed' ? 'in-progress' : openSpec.status,
    linkedConfigFilename: input.filename,
    updatedAt: nowIso,
    progress: {
      ...openSpec.progress,
      overallStatus: openSpec.progress.overallStatus === 'completed' ? 'in-progress' : openSpec.progress.overallStatus,
      summary: `Run ${input.runId} 已从创建态基线派生独立 OpenSpec 快照。`,
    },
  });
}

export function rebuildOpenSpecPreservingArtifacts(input: {
  existing: OpenSpecDocument;
  workflowName: string;
  description?: string;
  requirements?: string;
  filename: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  workingDirectory: string;
  config: WorkflowConfig | Record<string, any>;
  status?: OpenSpecDocument['status'];
}): OpenSpecDocument {
  const rebuilt = buildOpenSpecFromWorkflowConfig({
    workflowName: input.workflowName,
    description: input.description,
    requirements: input.requirements,
    filename: input.filename,
    workspaceMode: input.workspaceMode,
    workingDirectory: input.workingDirectory,
    config: input.config,
  });
  return mergeRebuiltOpenSpecWithExisting(input.existing, rebuilt, {
    status: input.status,
  });
}

export function markOpenSpecStateStatus(
  openSpec: OpenSpecDocument,
  input: {
    stateName: string;
    status: OpenSpecPhase['status'];
    summary?: string;
  }
): OpenSpecDocument {
  const phases = openSpec.phases.map((phase) => ({ ...phase }));
  const targetIndex = phases.findIndex((phase) => phase.title === input.stateName);
  if (targetIndex < 0) return openSpec;

  phases[targetIndex].status = input.status;
  const completedPhaseIds = phases.filter((phase) => phase.status === 'completed').map((phase) => phase.id);
  const activePhase = phases.find((phase) => phase.status === 'in-progress');
  const blockedPhase = phases.find((phase) => phase.status === 'blocked');
  const overallStatus: OpenSpecProgressStatus =
    blockedPhase ? 'blocked' :
      activePhase ? 'in-progress' :
        completedPhaseIds.length === phases.length && phases.length > 0 ? 'completed' : 'pending';

  let nextOpenSpec: OpenSpecDocument = {
    ...openSpec,
    phases,
    status: overallStatus === 'completed' ? 'completed' : 'in-progress',
    updatedAt: new Date().toISOString(),
    progress: {
      overallStatus,
      completedPhaseIds,
      activePhaseId: activePhase?.id,
      summary: input.summary || openSpec.progress.summary,
    },
  };

  nextOpenSpec = updateTasksForPhaseStatus(nextOpenSpec, {
    phaseId: phases[targetIndex].id,
    status: input.status,
    validation: input.summary,
  });

  return nextOpenSpec;
}

export function appendSupervisorOpenSpecRevision(
  openSpec: OpenSpecDocument,
  input: {
    stateName: string;
    nextState?: string;
    type: 'state-review' | 'checkpoint-advice';
    reviewContent: string;
    supervisorAgent: string;
    verdict?: 'pass' | 'conditional_pass' | 'fail';
  }
): OpenSpecDocument {
  const typeLabel = input.type === 'state-review' ? '阶段审阅' : '检查点建议';
  const summary = extractRevisionSummary(
    input.reviewContent,
    `${input.supervisorAgent} 对 ${input.stateName} 进行了 ${typeLabel}`
  );

  return appendOpenSpecRevision(openSpec, {
    summary: `${typeLabel}: ${summary}`,
    createdBy: input.supervisorAgent,
    status: openSpec.progress.overallStatus === 'completed' ? 'completed' : openSpec.status,
  });
}
