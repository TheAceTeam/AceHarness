export type LightweightTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'skipped' | 'unknown';
export type LightweightExecutionMode = 'serial' | 'parallel' | null;

export interface LightweightTaskEvidence {
  id?: unknown;
  title?: unknown;
  name?: unknown;
  owner?: unknown;
  ownerAgent?: unknown;
  agent?: unknown;
  dependencies?: unknown;
  dependsOn?: unknown;
  parallelGroup?: unknown;
  groupId?: unknown;
  executionMode?: unknown;
  status?: unknown;
  completed?: unknown;
  progress?: unknown;
}

export interface LightweightAgentEvidence {
  name?: unknown;
  status?: unknown;
  currentTask?: unknown;
  summary?: unknown;
  sessionId?: unknown;
  source?: unknown;
}

export interface LightweightTaskBoardInput {
  workflow?: {
    profile?: unknown;
    primaryAgent?: unknown;
    states?: Array<{ steps?: Array<{ agent?: unknown }> }>;
  } | null;
  run?: {
    profile?: unknown;
    primaryAgent?: unknown;
    agents?: unknown;
    runtimeAgents?: unknown;
    agentActivity?: unknown;
    toolEvents?: unknown;
    activeSteps?: unknown;
    completedSteps?: unknown;
    failedSteps?: unknown;
  } | null;
  tasklist?: unknown;
}

export interface LightweightTaskBoardAgent {
  name: string;
  status: string | null;
  currentTask: string | null;
  summary: string | null;
  sessionId: string | null;
  source: 'runtime-agent' | 'runtime-activity' | 'runtime-tool' | 'workflow-primary';
}

export interface LightweightTaskBoardTask {
  id: string;
  title: string;
  owner: string | null;
  dependencies: string[];
  parallelGroup: string | null;
  executionMode: LightweightExecutionMode;
  status: LightweightTaskStatus;
  progressPercent: number | null;
}

export interface LightweightTaskBoardModel {
  isLightweight: boolean;
  primaryAgent: LightweightTaskBoardAgent | null;
  childAgents: LightweightTaskBoardAgent[];
  tasks: LightweightTaskBoardTask[];
  progressPercent: number | null;
  taskEvidenceAvailable: boolean;
  progressEvidenceAvailable: boolean;
  emptyReason: 'not-lightweight' | 'no-task-evidence' | 'no-progress-evidence' | null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(text).filter(Boolean)));
  }
  const normalized = text(value);
  return normalized
    ? Array.from(new Set(normalized.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)))
    : [];
}

function clampPercent(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(100, numeric));
}

function normalizeStatus(value: unknown, completed?: unknown): LightweightTaskStatus {
  if (completed === true) return 'completed';
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['done', 'complete', 'completed', 'success', 'passed'].includes(normalized)) return 'completed';
  if (['running', 'in_progress', 'inprogress', 'active', 'executing'].includes(normalized)) return 'running';
  if (['failed', 'error'].includes(normalized)) return 'failed';
  if (['blocked', 'waiting'].includes(normalized)) return 'blocked';
  if (['skipped', 'cancelled', 'canceled'].includes(normalized)) return 'skipped';
  if (['pending', 'queued', 'todo', 'not_started'].includes(normalized)) return 'pending';
  return 'unknown';
}

function normalizeExecutionMode(value: unknown, parallelGroup: string | null): LightweightExecutionMode {
  const normalized = text(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (['parallel', 'concurrent'].includes(normalized)) return 'parallel';
  if (['serial', 'sequential'].includes(normalized)) return 'serial';
  return parallelGroup ? 'parallel' : null;
}

function asRecordList(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
}

function taskEntries(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return asRecordList(value);
  if (!value || typeof value !== 'object') return [];
  const source = value as Record<string, unknown>;
  return asRecordList(source.tasks || source.items || source.entries);
}

type RuntimeAgentEntry = {
  value: Record<string, unknown>;
  source: LightweightTaskBoardAgent['source'];
  explicitRuntime: boolean;
};

function runtimeAgentEntries(run: LightweightTaskBoardInput['run']): RuntimeAgentEntry[] {
  const agents = asRecordList(run?.runtimeAgents || run?.agents)
    .map((value) => ({
      value,
      source: 'runtime-agent' as const,
      explicitRuntime: Array.isArray(run?.runtimeAgents),
    }));
  const activity = asRecordList(run?.agentActivity)
    .map((value) => ({ value, source: 'runtime-activity' as const, explicitRuntime: true }));
  const toolActivity = runtimeToolActivityEntries(run?.toolEvents)
    .map((value) => ({ value, source: 'runtime-tool' as const, explicitRuntime: true }));
  return [...agents, ...activity, ...toolActivity];
}

function runtimeToolActivityEntries(value: unknown): Array<Record<string, unknown>> {
  const tools = asRecordList(value)
    .filter((tool) => firstText(tool.toolName, tool.name) === 'subagent-dispatch' || firstText(tool.toolName, tool.name) === 'subagent-wait');
  const activities: Array<Record<string, unknown>> = [];
  let nextChildIndex = 1;

  tools.forEach((tool, index) => {
    if (firstText(tool.toolName, tool.name) !== 'subagent-dispatch') return;
    const input = isRecord(tool.input) ? tool.input : {};
    const count = positiveInteger(input.childAgentCount) || 1;
    const followingWait = tools.slice(index + 1).find((candidate) => firstText(candidate.toolName, candidate.name) === 'subagent-wait');
    const status = subagentActivityStatus(text(tool.status), followingWait ? text(followingWait.status) : '');
    const task = firstText(input.description, input.name);
    const explicitName = firstText(input.agent);
    for (let childIndex = 0; childIndex < count; childIndex += 1) {
      const ordinal = nextChildIndex++;
      activities.push({
        name: explicitName
          ? (count === 1 ? explicitName : `${explicitName} ${childIndex + 1}`)
          : `子 Agent ${ordinal}`,
        status,
        currentTask: task || null,
        summary: input.model
          ? [text(input.model), text(input.reasoningEffort)].filter(Boolean).join(' · ')
          : null,
      });
    }
  });
  return activities;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function subagentActivityStatus(dispatchStatus: string, waitStatus: string): string {
  if (dispatchStatus === 'failed') return '启动失败';
  if (waitStatus === 'running') return '执行中';
  if (waitStatus === 'failed') return '等待失败';
  if (waitStatus === 'completed') return '已返回';
  return dispatchStatus === 'running' ? '启动中' : '已启动';
}

function hasAgentEvidence(value: Record<string, unknown>, explicitRuntime: boolean): boolean {
  if (explicitRuntime) return true;
  const sessionId = firstText(value.sessionId, value.runtimeSessionId);
  const currentTask = firstText(value.currentTask, value.task, value.stepName);
  const summary = text(value.summary);
  const result = firstText(value.result, value.output, value.lastOutput);
  const status = text(value.status).toLowerCase();
  const hasNonIdleStatus = Boolean(status)
    && ['running', 'active', 'executing', 'completed', 'failed', 'error', 'blocked', 'stopped', 'cancelled', 'canceled'].includes(status);
  return Boolean(sessionId || currentTask || summary || result || hasNonIdleStatus);
}

function toAgent(
  value: Record<string, unknown>,
  source: LightweightTaskBoardAgent['source'],
  explicitRuntime = false,
): LightweightTaskBoardAgent | null {
  const name = firstText(value.name, value.agent, value.agentName, value.runtimeAgentName);
  if (!name || name === 'default-supervisor' || !hasAgentEvidence(value, explicitRuntime)) return null;
  return {
    name,
    status: text(value.status) || null,
    currentTask: firstText(value.currentTask, value.task, value.stepName) || null,
    summary: text(value.summary) || null,
    sessionId: firstText(value.sessionId, value.runtimeSessionId) || null,
    source,
  };
}

function resolvePrimaryAgent(input: LightweightTaskBoardInput, entries: RuntimeAgentEntry[]): LightweightTaskBoardAgent | null {
  const workflowPrimary = firstText(
    input.workflow?.primaryAgent,
    input.workflow?.states?.[0]?.steps?.[0]?.agent,
    input.run?.primaryAgent,
  );
  if (!workflowPrimary) return null;

  for (const entry of entries) {
    const agent = toAgent(entry.value, entry.source, entry.explicitRuntime);
    if (agent?.name === workflowPrimary) return agent;
  }
  return {
    name: workflowPrimary,
    status: null,
    currentTask: null,
    summary: null,
    sessionId: null,
    source: 'workflow-primary',
  };
}

function runtimeStatusForTask(task: Record<string, unknown>, run: LightweightTaskBoardInput['run']): LightweightTaskStatus {
  const explicit = normalizeStatus(task.status, task.completed);
  if (explicit !== 'unknown') return explicit;
  const key = firstText(task.id, task.title, task.name);
  const completed = toStringList(run?.completedSteps);
  const failed = toStringList(run?.failedSteps);
  const active = toStringList(run?.activeSteps);
  if (key && completed.includes(key)) return 'completed';
  if (key && failed.includes(key)) return 'failed';
  if (key && active.includes(key)) return 'running';
  return 'unknown';
}

function taskBoardTasks(input: LightweightTaskBoardInput): LightweightTaskBoardTask[] {
  return taskEntries(input.tasklist).flatMap((entry, index) => {
    const title = firstText(entry.title, entry.name, entry.description);
    if (!title) return [];
    const id = firstText(entry.id, entry.key) || `evidence-${index + 1}`;
    const parallelGroup = firstText(entry.parallelGroup, entry.groupId) || null;
    const status = runtimeStatusForTask(entry, input.run);
    return [{
      id,
      title,
      owner: firstText(entry.owner, entry.ownerAgent, entry.agent) || null,
      dependencies: toStringList(entry.dependencies ?? entry.dependsOn),
      parallelGroup,
      executionMode: normalizeExecutionMode(entry.executionMode, parallelGroup),
      status,
      progressPercent: clampPercent(entry.progress) ?? (status === 'completed' ? 100 : null),
    }];
  });
}

function calculateProgress(tasks: LightweightTaskBoardTask[]): number | null {
  if (!tasks.length) return null;
  const explicit = tasks.filter((task) => task.progressPercent !== null);
  if (explicit.length > 0) {
    const values = tasks.map((task) => {
      if (task.progressPercent !== null) return task.progressPercent;
      if (task.status === 'completed' || task.status === 'skipped') return 100;
      if (task.status !== 'unknown') return 0;
      return null;
    });
    if (values.every((value): value is number => value !== null)) {
      return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  const knownStatuses = tasks.filter((task) => task.status !== 'unknown');
  if (knownStatuses.length !== tasks.length) return null;
  return Math.round((tasks.filter((task) => task.status === 'completed' || task.status === 'skipped').length / tasks.length) * 100);
}

export function adaptLightweightTaskBoardEvidence(input: LightweightTaskBoardInput): LightweightTaskBoardModel {
  const profiles = [text(input.workflow?.profile), text(input.run?.profile)].filter(Boolean);
  const isLightweight = profiles.length > 0 && profiles.every((profile) => profile === 'lightweight');
  if (!isLightweight) {
    return {
      isLightweight: false,
      primaryAgent: null,
      childAgents: [],
      tasks: [],
      progressPercent: null,
      taskEvidenceAvailable: false,
      progressEvidenceAvailable: false,
      emptyReason: 'not-lightweight',
    };
  }

  const entries = runtimeAgentEntries(input.run);
  const primaryAgent = resolvePrimaryAgent(input, entries);
  const childAgents: LightweightTaskBoardAgent[] = [];
  const seen = new Set<string>(primaryAgent ? [primaryAgent.name] : []);
  for (const entry of entries) {
    const agent = toAgent(entry.value, entry.source, entry.explicitRuntime);
    if (!agent || seen.has(agent.name)) continue;
    seen.add(agent.name);
    childAgents.push(agent);
  }

  const tasks = taskBoardTasks(input);
  const progressPercent = calculateProgress(tasks);
  return {
    isLightweight: true,
    primaryAgent,
    childAgents,
    tasks,
    progressPercent,
    taskEvidenceAvailable: tasks.length > 0,
    progressEvidenceAvailable: progressPercent !== null,
    emptyReason: tasks.length === 0 ? 'no-task-evidence' : progressPercent === null ? 'no-progress-evidence' : null,
  };
}
