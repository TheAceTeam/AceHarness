import { workflowStepSchema, type StateMachineState, type StateTransition } from '@/lib/core/schemas';
import { isStrictAdversarialRoleSequence } from '@/lib/workflow/state-review-policy';
import { canvasStateContents } from '@/lib/workflow/state-machine-design';

export const STATE_CARD_WIDTH = 264;
export const STATE_CARD_HEIGHT = 156;
const COLUMN_GAP = 334;
const ROW_GAP = 226;
const COLUMNS_PER_SECTION = 3;

export type CanvasPosition = { x: number; y: number };
export type CanvasVerdict = NonNullable<StateTransition['condition']['verdict']>;
export type CanvasIssue = {
  message: string;
  severity: 'error' | 'warning';
  stateIndex?: number;
  stepIndex?: number;
  transitionIndex?: number;
};

export const CANVAS_VERDICTS = {
  pass: { label: '通过', priority: 10, color: 'var(--canvas-pass)' },
  conditional_pass: { label: '有条件通过', priority: 20, color: 'var(--canvas-conditional)' },
  fail: { label: '失败', priority: 30, color: 'var(--canvas-fail)' },
} satisfies Record<CanvasVerdict, { label: string; priority: number; color: string }>;

export function hasAdvancedTransitionFilters(transition: StateTransition) {
  const condition = transition.condition;
  return Boolean(
    condition?.issueTypes?.length || condition?.severities?.length
    || condition?.minIssueCount !== undefined || condition?.maxIssueCount !== undefined
    || condition?.custom?.trim(),
  );
}

export function canvasFallbackIndex(state: StateMachineState, verdict: CanvasVerdict) {
  return state.transitions.findIndex((edge) => (
    edge.condition?.verdict === verdict && !hasAdvancedTransitionFilters(edge)
  ));
}

export function layoutWorkflowStates(states: StateMachineState[]): Map<string, CanvasPosition> {
  const rowGap = Math.max(ROW_GAP, ...states.map((state) => canvasStateHeight(state) + 90));
  const byName = new Map(states.map((state) => [state.name, state]));
  const layers = new Map<string, number>();
  const queue = states.filter((state) => state.isInitial).map((state) => state.name);
  if (!queue.length && states[0]) queue.push(states[0].name);
  for (const name of queue) layers.set(name, 0);
  for (const name of queue) {
    const nextLayer = layers.get(name)! + 1;
    const transitions = [...(byName.get(name)?.transitions || [])].sort((a, b) => (
      (a.priority ?? 100) - (b.priority ?? 100)
    ));
    for (const { to } of transitions) {
      if (!byName.has(to) || layers.has(to)) continue;
      layers.set(to, nextLayer);
      queue.push(to);
    }
  }
  const positions = new Map<string, CanvasPosition>();
  const rowsInLayer = new Map<number, number>();
  const sectionHeights = new Map<number, number>();
  const lastReachableLayer = Math.max(0, ...layers.values());
  for (const [index, state] of states.filter((item) => !layers.has(item.name)).entries()) {
    layers.set(state.name, lastReachableLayer + 1 + (index % COLUMNS_PER_SECTION));
  }
  const slots = [...layers].map(([name, layer]) => {
    const section = Math.floor(layer / COLUMNS_PER_SECTION);
    const row = rowsInLayer.get(layer) ?? 0;
    rowsInLayer.set(layer, row + 1);
    sectionHeights.set(section, Math.max(sectionHeights.get(section) ?? 0, row + 1));
    return { name, layer, section, row };
  });
  const sectionOffsets = new Map<number, number>();
  let offset = 0;
  for (const [section, height] of sectionHeights) {
    sectionOffsets.set(section, offset);
    offset += height + 0.35;
  }
  for (const { name, layer, section, row } of slots) {
    const column = layer % COLUMNS_PER_SECTION;
    positions.set(name, {
      x: (section % 2 === 0 ? column : COLUMNS_PER_SECTION - 1 - column) * COLUMN_GAP,
      y: (sectionOffsets.get(section)! + row) * rowGap,
    });
  }
  return positions;
}

export function canvasStateHeight(state: StateMachineState): number {
  return Math.max(STATE_CARD_HEIGHT, 82 + canvasStateContents(state).reduce((height, group) => (
    height + (group.id ? 48 + Math.max(1, group.steps.length) * 28 : 28)
  ), 0));
}

export function removeCanvasState(states: StateMachineState[], name: string): StateMachineState[] {
  return states.filter((state) => state.name !== name).map((state) => {
    const transitions = state.transitions.filter((edge) => edge.to !== name);
    return transitions.length === state.transitions.length ? state : { ...state, transitions };
  });
}

export function validateCanvasTopology(states: StateMachineState[], configFile?: string): CanvasIssue[] {
  const issues: CanvasIssue[] = [];
  const add = (message: string, stateIndex?: number, extra: Partial<CanvasIssue> = {}) => {
    issues.push({ message, stateIndex, severity: 'error', ...extra });
  };
  const byName = new Map(states.map((state, index) => [state.name, index]));
  const initial = states.flatMap((state, index) => state.isInitial ? [index] : []);
  const finals = states.flatMap((state, index) => state.isFinal ? [index] : []);
  const outgoing = states.map((): number[] => []);
  const incoming = states.map((): number[] => []);
  if (initial.length !== 1) add('工作流须有且只有一个初始状态。');
  if (!finals.length) add('工作流至少需要一个终止状态。');

  states.forEach((state, stateIndex) => {
    const tag = state.name || `状态 ${stateIndex + 1}`;
    if (!state.name.trim()) add('状态名称不能为空。', stateIndex);
    if (byName.get(state.name) !== stateIndex) add(`状态名称重复 · ${tag}`, stateIndex);
    if (!state.isFinal && state.steps.length === 0) add(`${tag} · 至少需要一个步骤`, stateIndex);
    if (state.isFinal && state.transitions.length) add(`${tag} · 终止状态有出线`, stateIndex, { severity: 'warning' });
    if (!state.isFinal && state.reviewPolicy?.mode === 'adversarial' && !isStrictAdversarialRoleSequence(state)) {
      add(`${tag} · 对抗编排须先执行防守步骤，再串行执行攻击与裁判步骤`, stateIndex);
    }
    const stepNames = new Set<string>();
    const groups = new Map<string, { index: number; quorum?: number }[]>();
    for (const group of state.parallelGroups || []) groups.set(group.id, []);
    state.steps.forEach((step, stepIndex) => {
      const parsed = workflowStepSchema.safeParse(step);
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        add(`${tag} / ${step.name || '未命名步骤'} · ${issue.message}`, stateIndex, { stepIndex });
      }
      if (stepNames.has(step.name)) add(`${tag} · 步骤名称重复：${step.name}`, stateIndex, { stepIndex });
      stepNames.add(step.name);
      const child = step.workflow || step.subworkflow?.configFile;
      if (step.type === 'subworkflow' && configFile && child?.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase() === configFile.toLowerCase()) {
        add(`${tag} / ${step.name} · 子工作流不能引用自身`, stateIndex, { stepIndex });
      }
      if (step.type === 'script') {
        const failure = step.script?.onFailure;
        if (state.reviewPolicy?.mode === 'adversarial') add(`${tag} / ${step.name} · 请将脚本放入独立于对抗的状态`, stateIndex, { stepIndex });
        if (failure?.action === 'transition') {
          const target = byName.get(failure.target);
          if (target === undefined) add(`${tag} / ${step.name} · 失败目标不存在：${failure.target}`, stateIndex, { stepIndex });
          else {
            outgoing[stateIndex].push(target);
            incoming[target].push(stateIndex);
          }
        }
      }
      const id = step.parallelGroup || step.concurrency?.groupId;
      if (!id) return;
      const list = groups.get(id) || [];
      list.push({ index: stepIndex, quorum: step.concurrency?.joinPolicy?.quorum });
      groups.set(id, list);
    });
    groups.forEach((members) => {
      const stepIndex = members[0]?.index;
      if (members.length < 2) add(`${tag} · 并发组至少需要两个步骤`, stateIndex, { stepIndex });
      if (stepIndex !== undefined && members.some((item, offset) => item.index !== stepIndex + offset)) add(`${tag} · 并发组步骤必须相邻`, stateIndex, { stepIndex });
      if (members.some(({ quorum }) => quorum !== undefined && (quorum < 1 || quorum > members.length))) {
        add(`${tag} · 并发组汇合数量超过有效范围`, stateIndex, { stepIndex });
      }
    });
    state.transitions.forEach((transition, transitionIndex) => {
      const target = byName.get(transition.to);
      if (!transition.condition?.verdict && !state.isFinal) add(`${tag} · 连线未设置判定条件`, stateIndex, { transitionIndex });
      if (target === undefined) {
        add(`${tag} · 连线目标不存在：${transition.to || '未设置'}`, stateIndex, { transitionIndex });
        return;
      }
      if (!state.isFinal) {
        outgoing[stateIndex].push(target);
        incoming[target].push(stateIndex);
      }
    });
    if (state.isFinal) return;
    for (const verdict of Object.keys(CANVAS_VERDICTS) as CanvasVerdict[]) {
      const matches = state.transitions.filter((edge) => edge.condition?.verdict === verdict && !hasAdvancedTransitionFilters(edge));
      if (matches.length !== 1) add(`${tag} ·「${CANVAS_VERDICTS[verdict].label}」${matches.length ? '有多条兜底连线' : '缺少兜底连线'}`, stateIndex);
    }
  });

  function traverse(starts: number[], graph: number[][]) {
    const queue = [...starts];
    const seen = new Set(starts);
    for (const index of queue) for (const next of graph[index]) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
    return seen;
  }
  if (initial.length === 1) {
    const reachable = traverse(initial, outgoing);
    const leadsToFinal = traverse(finals, incoming);
    states.forEach((state, index) => {
      if (!reachable.has(index)) add(`${state.name} · 从初始状态不可达`, index);
      else if (finals.length && !leadsToFinal.has(index)) add(`${state.name} · 没有路径到达终止状态`, index);
    });
  }
  return issues;
}
