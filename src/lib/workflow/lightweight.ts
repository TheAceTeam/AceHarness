export const LIGHTWEIGHT_WORKFLOW_PROFILE = 'lightweight' as const;
export const LIGHTWEIGHT_TASKLIST_SKILL = 'aceharness-tasklist' as const;
export const LIGHTWEIGHT_WORKFLOW_DESCRIPTION = '通过任务清单动态拆分、调度与验收的协作执行。';
export const LIGHTWEIGHT_WORKFLOW_TIMEOUT_MINUTES = 5 * 60;

const DEFAULT_SUPERVISOR_NAME = 'default-supervisor';
const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;

type WorkflowPolicyAgentConfig = {
  name?: string | null;
  roleType?: string | null;
};

function normalizedSkillNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((skill) => typeof skill === 'string' ? skill.trim() : '')
    .filter(Boolean);
}

export function normalizeLightweightTasklistDirectory(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new Error('workflow.lightweight.tasklistDirectory must not be empty');
  }

  const slashPath = raw.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || WINDOWS_DRIVE_PATH.test(slashPath)) {
    throw new Error('workflow.lightweight.tasklistDirectory must be a relative workspace path');
  }

  const segments: string[] = [];
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error('workflow.lightweight.tasklistDirectory must not contain traversal segments');
    }
    segments.push(segment);
  }

  if (segments[0] === '.ace-outputs') {
    throw new Error('workflow.lightweight.tasklistDirectory must not use the legacy .ace-outputs root');
  }

  const normalizedPath = segments.join('/');
  if (!normalizedPath) {
    throw new Error('workflow.lightweight.tasklistDirectory must be a non-root relative workspace directory');
  }

  return normalizedPath;
}

export function deriveLightweightTasklistDirectory(configRelativeFilename: unknown): string {
  const raw = typeof configRelativeFilename === 'string' ? configRelativeFilename.trim() : '';
  if (!raw) {
    throw new Error('config filename must not be empty');
  }

  const slashPath = raw.replace(/\\/g, '/');
  if (slashPath.startsWith('/') || slashPath.startsWith('//') || WINDOWS_DRIVE_PATH.test(slashPath)) {
    throw new Error('config filename must be relative');
  }

  const segments: string[] = [];
  for (const segment of slashPath.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      throw new Error('config filename must not contain traversal segments');
    }
    segments.push(segment);
  }

  const filename = segments.pop();
  if (!filename) {
    throw new Error('config filename must include a filename');
  }

  const extensionIndex = filename.lastIndexOf('.');
  const basename = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  if (!basename) {
    throw new Error('config filename must include a basename');
  }

  return normalizeLightweightTasklistDirectory([
    'docs',
    'tasklists',
    ...segments,
    basename,
  ].join('/'));
}

export function isLightweightWorkflowConfig(config: any): boolean {
  return config?.workflow?.mode === 'state-machine'
    && config?.workflow?.profile === LIGHTWEIGHT_WORKFLOW_PROFILE;
}

export function normalizeLightweightWorkflowConfig<T extends Record<string, any>>(config: T): T {
  if (!isLightweightWorkflowConfig(config) || !config || typeof config !== 'object') {
    return config;
  }

  const hasSupervisor = Boolean(config.workflow)
    && Object.prototype.hasOwnProperty.call(config.workflow, 'supervisor');
  const agentOverrides = config.context?.executionPolicy?.agentOverrides;
  const hasDefaultSupervisorOverride = Boolean(agentOverrides)
    && typeof agentOverrides === 'object'
    && Object.prototype.hasOwnProperty.call(agentOverrides, DEFAULT_SUPERVISOR_NAME);
  const states = Array.isArray(config.workflow?.states) ? config.workflow.states : [];
  const hasSpecTaskBinding = states.some((state: any) => (
    Array.isArray(state?.steps)
    && state.steps.some((step: any) => (
      step
      && typeof step === 'object'
      && Object.prototype.hasOwnProperty.call(step, 'specTaskBinding')
    ))
  ));

  if (!hasSupervisor && !hasDefaultSupervisorOverride && !hasSpecTaskBinding) {
    return config;
  }

  const { supervisor: _supervisor, ...workflowWithoutSupervisor } = config.workflow || {};
  const workflowWithoutSpecTaskBindings = hasSpecTaskBinding
    ? {
        ...workflowWithoutSupervisor,
        states: states.map((state: any) => ({
          ...state,
          steps: Array.isArray(state?.steps)
            ? state.steps.map((step: any) => {
                if (!step || typeof step !== 'object' || !Object.prototype.hasOwnProperty.call(step, 'specTaskBinding')) {
                  return step;
                }
                const { specTaskBinding: _specTaskBinding, ...stepWithoutSpecTaskBinding } = step;
                return stepWithoutSpecTaskBinding;
              })
            : state?.steps,
        })),
      }
    : workflowWithoutSupervisor;
  const nextContext = hasDefaultSupervisorOverride
    ? {
        ...(config.context || {}),
        executionPolicy: {
          ...(config.context?.executionPolicy || {}),
          agentOverrides: Object.fromEntries(
            Object.entries(agentOverrides || {})
              .filter(([name]) => name !== DEFAULT_SUPERVISOR_NAME)
          ),
        },
      }
    : config.context;
  return {
    ...config,
    workflow: workflowWithoutSpecTaskBindings,
    ...(nextContext ? { context: nextContext } : {}),
  } as T;
}

export function resolveWorkflowPolicySupervisorAgentName(
  workflow: any,
  agentConfigs: WorkflowPolicyAgentConfig[] = [],
): string | null {
  if (!workflow || isLightweightWorkflowConfig({ workflow })) {
    return null;
  }

  const supervisorFromWorkflow = typeof workflow?.supervisor?.agent === 'string'
    ? workflow.supervisor.agent.trim()
    : '';
  if (supervisorFromWorkflow) return supervisorFromWorkflow;

  const supervisorFromRoles = agentConfigs.find((agent) => agent?.roleType === 'supervisor')?.name?.trim();
  return supervisorFromRoles || DEFAULT_SUPERVISOR_NAME;
}

export function resolveWorkflowPolicyAgentNames(input: {
  workflow: any;
  agentConfigs?: WorkflowPolicyAgentConfig[];
  supervisorPosition?: 'first' | 'last';
}): string[] {
  const { workflow, agentConfigs = [], supervisorPosition = 'last' } = input;
  if (!workflow) return [];

  const names: string[] = [];
  const seen = new Set<string>();
  const addName = (value?: string | null) => {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    names.push(trimmed);
  };
  const addWorkflowStepAgents = () => {
    for (const node of workflow?.states || []) {
      addName(node?.agent);
      for (const step of node?.steps || []) {
        addName(step?.agent);
      }
    }
  };
  const supervisorName = resolveWorkflowPolicySupervisorAgentName(workflow, agentConfigs);

  if (supervisorPosition === 'first') addName(supervisorName);
  addWorkflowStepAgents();
  if (supervisorPosition !== 'first') addName(supervisorName);

  return names;
}

export function getEffectiveWorkflowStepSkills(input: {
  config: any;
  step?: any;
  roleConfig?: any;
}): string[] {
  const skills = new Set<string>();
  for (const skill of normalizedSkillNames(input.config?.context?.skills)) skills.add(skill);
  for (const skill of normalizedSkillNames(input.roleConfig?.skills)) skills.add(skill);
  for (const skill of normalizedSkillNames(input.step?.skills)) skills.add(skill);
  if (isLightweightWorkflowConfig(input.config)) skills.add(LIGHTWEIGHT_TASKLIST_SKILL);
  return [...skills];
}

export function ensureLightweightWorkflowStepSkill<T extends Record<string, any>>(config: T): T {
  if (!isLightweightWorkflowConfig(config)) return config;

  const states = Array.isArray(config.workflow?.states) ? config.workflow.states : [];
  const state = states[0];
  const step = state && Array.isArray(state.steps) ? state.steps[0] : null;
  if (!step) return config;

  const skills = normalizedSkillNames(step.skills);
  const hasSpecTaskBinding = Object.prototype.hasOwnProperty.call(step, 'specTaskBinding');
  if (skills.includes(LIGHTWEIGHT_TASKLIST_SKILL) && !hasSpecTaskBinding) return config;

  const nextStates = states.map((candidate: any, index: number) => (
    index === 0
      ? {
          ...candidate,
          steps: (candidate.steps || []).map((candidateStep: any, stepIndex: number) => (
            stepIndex === 0
              ? (() => {
                  const { specTaskBinding: _specTaskBinding, ...stepWithoutSpecTaskBinding } = candidateStep;
                  return {
                    ...stepWithoutSpecTaskBinding,
                    skills: skills.includes(LIGHTWEIGHT_TASKLIST_SKILL)
                      ? skills
                      : [...skills, LIGHTWEIGHT_TASKLIST_SKILL],
                  };
                })()
              : candidateStep
          )),
        }
      : candidate
  ));

  return {
    ...config,
    workflow: {
      ...config.workflow,
      states: nextStates,
    },
  };
}
