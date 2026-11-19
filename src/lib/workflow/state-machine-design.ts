import type { StateMachineState, WorkflowStep } from '@/lib/core/schemas';

export function createDesignState(
  states: StateMachineState[],
  protocolAdopted: boolean,
): StateMachineState {
  const names = new Set(states.map((state) => state.name));
  let number = states.length + 1;
  while (names.has(`状态${number}`)) number++;
  return {
    id: crypto.randomUUID(),
    name: `状态${number}`,
    description: '',
    steps: [],
    transitions: [],
    isInitial: states.length === 0,
    isFinal: false,
    maxSelfTransitions: 3,
    ...(protocolAdopted ? {
      reviewPolicy: {
        mode: 'standard',
        source: 'default',
        locked: false,
        confidence: 'medium',
        riskSignals: [],
        rationale: '手工新增状态默认采用标准模式，可在状态详情中调整。',
      },
    } : {}),
  };
}

export function renameStateAndReferences(
  states: StateMachineState[],
  previousName: string,
  nextName: string,
): StateMachineState[] {
  if (previousName === nextName) return states;
  return states.map((state) => ({
    ...state,
    name: state.name === previousName ? nextName : state.name,
    steps: state.steps?.map((step) => {
      const script = step.script;
      return script?.onFailure?.action === 'transition' && script.onFailure.target === previousName
        ? { ...step, script: { ...script, onFailure: { action: 'transition', target: nextName } } }
        : step;
    }) ?? state.steps,
    transitions: (state.transitions || []).map((transition) => (
      transition.to === previousName
        ? { ...transition, to: nextName }
        : transition
    )),
  }));
}

type StepGroup = {
  id?: string;
  startIndex: number;
  steps: Array<{ step: WorkflowStep; index: number }>;
};

export function isReviewStructureStep(step: WorkflowStep | undefined): boolean {
  return Boolean(step && (
    step.role
    || step.provenance?.origin === 'review-policy'
    || step.provenance?.managedRole === 'standard-closer'
  ));
}

export const getStepParallelGroup = (step?: WorkflowStep) => step?.parallelGroup || step?.concurrency?.groupId || '';

const slugifyId = (value: string, fallback: string) => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
};

export const makeParallelGroupId = (stateName: string, startIndex: number) =>
  slugifyId(`parallel-${stateName}-${startIndex + 1}`, `parallel-${startIndex + 1}`);

const makeBranchId = (step: WorkflowStep, index: number) =>
  slugifyId(step.name || step.agent || `branch-${index + 1}`, `branch-${index + 1}`);

export const withParallelGroup = (step: WorkflowStep, groupId: string, index: number): WorkflowStep => ({
  ...step,
  parallelGroup: groupId,
  concurrency: {
    ...(step.concurrency || {}),
    groupId,
    branchId: step.concurrency?.branchId || makeBranchId(step, index),
    joinPolicy: step.concurrency?.joinPolicy || { mode: 'all' },
  },
});

export const withoutParallelGroup = (step: WorkflowStep): WorkflowStep => {
  const nextConcurrency = { ...(step.concurrency || {}) } as any;
  delete nextConcurrency.groupId;
  delete nextConcurrency.branchId;
  delete nextConcurrency.joinPolicy;
  return {
    ...step,
    parallelGroup: undefined,
    concurrency: Object.keys(nextConcurrency).length ? nextConcurrency : undefined,
    agentInstanceId: undefined,
    channelIds: undefined,
  };
};

export function buildWorkflowStepFromEditData(data: any, existingStep?: WorkflowStep | null): WorkflowStep {
  if (data.type === 'script') {
    const next: WorkflowStep = { ...(existingStep || {}), name: data.name, type: 'script', agent: '', task: '', script: data.script,
      specTaskBinding: data.specTaskBinding ?? existingStep?.specTaskBinding };
    for (const key of ['role','agentInstanceId','channelIds','parallelGroup','concurrency','workflow','subworkflow','inputs','runtime','constraints','enableReviewPanel','preCommands','skills','mcpServers','ragKnowledgeBases'] as const) delete (next as any)[key];
    return next;
  }

  const normalizedConstraints = Array.isArray(data.constraints)
    ? data.constraints.filter((c: string) => typeof c === 'string' && c.trim())
    : typeof data.constraints === 'string'
      ? data.constraints.split('\n').filter((c: string) => c.trim())
      : undefined;
  const normalizedSkills: string[] | undefined = Array.isArray(data.skills)
    ? Array.from(new Set<string>(
        data.skills
          .filter((skill: unknown): skill is string => typeof skill === 'string')
          .map((skill: string) => skill.trim())
          .filter(Boolean),
      ))
    : undefined;
  const newStep: WorkflowStep = data.type === 'subworkflow'
    ? {
        ...(existingStep || {}),
        name: data.name,
        type: 'subworkflow',
        workflow: data.workflow,
        subworkflow: data.subworkflow,
        inputs: data.inputs,
        role: data.role ?? existingStep?.role,
        parallelGroup: data.parallelGroup,
        concurrency: data.concurrency,
        agentInstanceId: data.agentInstanceId ?? existingStep?.agentInstanceId,
        channelIds: data.channelIds,
        specTaskBinding: data.specTaskBinding,
      } as WorkflowStep
    : ({
        ...(existingStep || {}),
        ...(data.type === 'agent' ? { type: 'agent' as const } : {}),
        name: data.name,
        agent: data.agent,
        task: data.task,
        role: data.role ?? existingStep?.role,
        constraints: normalizedConstraints,
        enableReviewPanel: data.enableReviewPanel,
        parallelGroup: data.parallelGroup,
        concurrency: data.concurrency,
        agentInstanceId: data.agentInstanceId ?? existingStep?.agentInstanceId,
        channelIds: data.channelIds,
        specTaskBinding: data.specTaskBinding,
        ...(normalizedSkills !== undefined ? { skills: normalizedSkills } : {}),
      } as WorkflowStep);
  delete newStep.script;
  if (data.type === 'agent') {
    delete newStep.workflow;
    delete newStep.subworkflow;
    delete newStep.inputs;
  }
  if (data.type === 'subworkflow') {
    delete (newStep as any).agent;
    delete (newStep as any).task;
    delete (newStep as any).constraints;
    delete (newStep as any).enableReviewPanel;
    delete (newStep as any).preCommands;
    delete (newStep as any).skills;
  }
  if (data.type !== 'subworkflow' && Array.isArray(data.preCommands) && data.preCommands.length > 0) {
    newStep.preCommands = data.preCommands;
  } else if (data.type !== 'subworkflow' && Array.isArray(existingStep?.preCommands) && existingStep.preCommands.length > 0) {
    newStep.preCommands = existingStep.preCommands;
  }
  return newStep;
}

export function insertDesignStep(state: StateMachineState, step: WorkflowStep, groupId?: string, insertBefore?: number): StateMachineState {
  const next = { ...step, id: crypto.randomUUID(), provenance: { origin: 'user' as const } };
  if (step.type !== 'script' && state.reviewPolicy?.locked && state.reviewPolicy.mode === 'adversarial') {
    next.role ||= 'defender';
    next.agentInstanceId = crypto.randomUUID();
    const groupId = getStepParallelGroup(next);
    if (groupId) {
      next.concurrency = { ...next.concurrency, groupId, joinPolicy: { mode: 'all' } };
    }
  }
  const steps = [...state.steps];
  const tailIndex = state.reviewPolicy?.locked
    ? state.reviewPolicy.mode === 'standard'
      ? steps.findIndex((item) => item.provenance?.managedRole === 'standard-closer')
      : next.role === 'judge' ? -1 : steps.findIndex((item) => (
        item.role === 'judge' || (next.role !== 'attacker' && item.role === 'attacker')
      ))
    : -1;
  const member = groupId ? [...steps].reverse().find((item) => getStepParallelGroup(item) === groupId) : undefined;
  const group = state.parallelGroups?.find((item) => item.id === groupId);
  if ((member || group) && groupId && step.type !== 'script') {
    const members = steps.map((item, index) => ({ item, index })).filter(({ item }) => getStepParallelGroup(item) === groupId);
    const first = members[0]?.index;
    const last = members.at(-1)?.index;
    const insertion = insertBefore ?? (last === undefined ? group?.insertBefore ?? (tailIndex < 0 ? steps.length : tailIndex) : last + 1);
    const index = (first === undefined ? insertion : Math.max(first, Math.min(last! + 1, insertion))) - 1;
    const grouped = withParallelGroup(next, groupId, index + 1);
    const policy = member?.concurrency?.joinPolicy || group?.joinPolicy;
    if (policy && grouped.concurrency) grouped.concurrency.joinPolicy = policy;
    return spliceCanvasSteps(state, index + 1, 0, grouped);
  }
  const insertion = insertBefore ?? (tailIndex < 0 ? steps.length : tailIndex);
  return spliceCanvasSteps(state, insertion, 0, next);
}

export const buildStepGroups = (steps: WorkflowStep[]): StepGroup[] => {
  const groups: StepGroup[] = [];
  steps.forEach((step, index) => {
    const groupId = getStepParallelGroup(step);
    const last = groups[groups.length - 1];
    if (groupId && last?.id === groupId) {
      last.steps.push({ step, index });
      return;
    }
    groups.push({ id: groupId || undefined, startIndex: index, steps: [{ step, index }] });
  });
  return groups;
};

/** Keep empty group insertion slots aligned with edits to the flat execution steps. */
function spliceCanvasSteps(state: StateMachineState, start: number, deleteCount: number, ...added: WorkflowStep[]): StateMachineState {
  const steps = [...state.steps];
  steps.splice(start, deleteCount, ...added);
  return {
    ...state, steps,
    parallelGroups: state.parallelGroups?.map((group) => group.insertBefore === undefined ? group : {
      ...group, insertBefore: group.insertBefore < start ? group.insertBefore
        : Math.max(start, group.insertBefore - deleteCount) + added.length,
    }),
  };
}

export function canvasStateContents(state: StateMachineState): StepGroup[] {
  const contents = buildStepGroups(state.steps);
  const existing = new Set(contents.map((group) => group.id));
  for (const group of state.parallelGroups || []) {
    if (existing.has(group.id)) continue;
    contents.push({ id: group.id, startIndex: Math.min(state.steps.length, group.insertBefore ?? state.steps.length), steps: [] });
    existing.add(group.id);
  }
  return contents.sort((a, b) => a.startIndex - b.startIndex || Number(a.steps.length > 0) - Number(b.steps.length > 0));
}

function availableStepName(name: string, steps: WorkflowStep[]) {
  let candidate = name;
  let suffix = 2;
  while (steps.some((step) => step.name === candidate)) candidate = name + ' ' + suffix++;
  return candidate;
}

/** insertBefore uses target indices before removing the dragged source. Manual edits are never gated by the AI review lock. */
export function moveCanvasStep(
  states: StateMachineState[], sourceIndex: number, stepIndex: number, targetIndex: number, groupId?: string,
  insertBefore?: number,
): StateMachineState[] {
  const source = states[sourceIndex];
  const target = states[targetIndex];
  const step = source?.steps[stepIndex];
  if (!source || !target || !step) return states;
  const sameState = sourceIndex === targetIndex;
  const sameGroup = getStepParallelGroup(step) === (groupId || '');
  if (groupId && step.type === 'script') return states;
  const targetGroup = groupId ? canvasStateContents(target).find((group) => group.id === groupId) : undefined;
  if (groupId && !targetGroup) return states;
  const remaining = spliceCanvasSteps(source, stepIndex, 1);
  const destination = sameState ? remaining : target;
  let insertion = insertBefore ?? targetGroup?.startIndex ?? target.steps.length;
  if (insertBefore === undefined && targetGroup?.steps.length) insertion = targetGroup.steps.at(-1)!.index + 1;
  if (sameState && stepIndex < insertion) insertion--;
  insertion = Math.max(0, Math.min(destination.steps.length, insertion));
  const moved = groupId ? withParallelGroup(step, groupId, stepIndex) : {
    ...withoutParallelGroup(step), agentInstanceId: step.agentInstanceId, channelIds: step.channelIds,
  };
  if (!sameState) moved.name = availableStepName(step.name, destination.steps);
  if (groupId) {
    const members = destination.steps.map((item, index) => ({ item, index })).filter(({ item }) => getStepParallelGroup(item) === groupId);
    const first = members[0];
    const last = members.at(-1);
    if (first && last) insertion = Math.max(first.index, Math.min(last.index + 1, insertion));
    const policy = last?.item.concurrency?.joinPolicy || destination.parallelGroups?.find((group) => group.id === groupId)?.joinPolicy;
    if (policy && moved.concurrency) moved.concurrency.joinPolicy = policy;
  }
  const leftGroup = getStepParallelGroup(destination.steps[insertion - 1]);
  if (leftGroup && leftGroup === getStepParallelGroup(destination.steps[insertion]) && leftGroup !== (groupId || '')) return states;
  if (sameState && sameGroup && insertion === stepIndex) return states;
  const nextTarget = spliceCanvasSteps(destination, insertion, 0, moved);
  return states.map((state, index) => index === targetIndex ? nextTarget : index === sourceIndex ? remaining : state);
}

export function moveCanvasGroup(
  states: StateMachineState[], sourceIndex: number, groupId: string, targetIndex: number, insertBefore?: number,
): StateMachineState[] {
  const source = states[sourceIndex];
  const target = states[targetIndex];
  const group = source && canvasStateContents(source).find((group) => group.id === groupId);
  if (!source || !target || !group) return states;
  const sameState = sourceIndex === targetIndex;
  const removed = source.steps.flatMap((step, index) => getStepParallelGroup(step) === groupId ? [index] : []);
  const originalInsertion = insertBefore ?? target.steps.length;
  if (sameState && removed.length && originalInsertion >= removed[0] && originalInsertion <= removed.at(-1)! + 1) return states;
  let remaining = source;
  for (const index of [...removed].reverse()) remaining = spliceCanvasSteps(remaining, index, 1);
  remaining = { ...remaining, parallelGroups: remaining.parallelGroups?.filter((item) => item.id !== groupId) };
  const destination = sameState ? remaining : target;
  const insertion = Math.max(0, Math.min(destination.steps.length, originalInsertion - (sameState ? removed.filter((index) => index < originalInsertion).length : 0)));
  const leftGroup = getStepParallelGroup(destination.steps[insertion - 1]);
  if (leftGroup && leftGroup === getStepParallelGroup(destination.steps[insertion])) return states;
  const existingIds = new Set(canvasStateContents(destination).map((group) => group.id));
  const nextId = existingIds.has(groupId) ? 'parallel-' + crypto.randomUUID() : groupId;
  const metadata = source.parallelGroups?.find((item) => item.id === groupId);
  const added: WorkflowStep[] = [];
  for (const { step } of group.steps) {
    const name = availableStepName(step.name, [...destination.steps, ...added]);
    added.push({ ...withParallelGroup(step, nextId, insertion + added.length), name });
  }
  const nextTarget = spliceCanvasSteps(destination, insertion, 0, ...added);
  nextTarget.parallelGroups = [...(nextTarget.parallelGroups || []), {
    ...metadata, id: nextId, name: metadata?.name || '并发组', insertBefore: insertion,
  }];
  return states.map((state, index) => index === targetIndex ? nextTarget : index === sourceIndex ? remaining : state);
}
