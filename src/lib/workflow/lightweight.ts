export const LIGHTWEIGHT_WORKFLOW_PROFILE = 'lightweight' as const;
export const LIGHTWEIGHT_TASKLIST_SKILL = 'aceharness-tasklist' as const;
export const LIGHTWEIGHT_WORKFLOW_DESCRIPTION = '通过任务清单动态拆分、调度与验收的协作执行。';

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:/;

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
  if (skills.includes(LIGHTWEIGHT_TASKLIST_SKILL)) return config;

  const nextStates = states.map((candidate: any, index: number) => (
    index === 0
      ? {
          ...candidate,
          steps: (candidate.steps || []).map((candidateStep: any, stepIndex: number) => (
            stepIndex === 0
              ? { ...candidateStep, skills: [...skills, LIGHTWEIGHT_TASKLIST_SKILL] }
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
