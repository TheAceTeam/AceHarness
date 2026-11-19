import { describe, expect, it } from 'vitest';
import { stateMachineStateSchema, type StateMachineState, type StateTransition } from '@/lib/core/schemas';
import { validateCanvasTopology } from '@/lib/workflow/state-machine-canvas';
import { canvasStateContents, insertDesignStep, moveCanvasGroup, moveCanvasStep } from '@/lib/workflow/state-machine-design';

function routes(pass: string, retry: string, fail: string): StateTransition[] {
  return [
    { to: pass, condition: { verdict: 'pass' }, priority: 10 },
    { to: retry, condition: { verdict: 'conditional_pass' }, priority: 20 },
    { to: fail, condition: { verdict: 'fail' }, priority: 30 },
  ];
}

function state(name: string, overrides: Partial<StateMachineState> = {}): StateMachineState {
  return {
    name,
    isInitial: false,
    isFinal: false,
    steps: [{ name: '执行', agent: 'builder', task: '完成当前阶段' }],
    transitions: [],
    ...overrides,
  };
}

describe('canvas topology validation', () => {
  it('allows retries and back edges when an exit is reachable', () => {
    expect(validateCanvasTopology([
      state('实现', { isInitial: true, transitions: routes('验收', '实现', '实现') }),
      state('验收', { transitions: routes('交付', '验收', '实现') }),
      state('交付', { isFinal: true, steps: [] }),
    ])).toEqual([]);
  });

  it('reports a reachable dead-end cycle and a disconnected state', () => {
    const issues = validateCanvasTopology([
      state('实现', { isInitial: true, transitions: routes('交付', '实现', '返工') }),
      state('返工', { transitions: routes('返工', '返工', '返工') }),
      state('交付', { isFinal: true }),
      state('游离状态', { transitions: routes('交付', '游离状态', '游离状态') }),
    ]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ stateIndex: 1, message: '返工 · 没有路径到达终止状态' }),
      expect.objectContaining({ stateIndex: 3, message: '游离状态 · 从初始状态不可达' }),
    ]));
  });

  it('locates the dangling transition and invalid parallel step', () => {
    const issues = validateCanvasTopology([
      state('实现', {
        isInitial: true,
        transitions: routes('交付', '实现', '缺失'),
        steps: [{ name: '执行', agent: 'builder', task: '执行', parallelGroup: 'incomplete' }],
      }),
      state('交付', { isFinal: true }),
    ]);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ stateIndex: 0, transitionIndex: 2, message: '实现 · 连线目标不存在：缺失' }),
      expect.objectContaining({ stateIndex: 0, stepIndex: 0, message: '实现 · 并发组至少需要两个步骤' }),
    ]));
  });

  it('keeps a dropped attack step as an empty draft in a locked review state', () => {
    const draft = insertDesignStep(state('对抗', {
      reviewPolicy: { mode: 'adversarial', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '' },
      steps: [
        { name: '防守', agent: 'builder', task: '实现', role: 'defender' },
        { name: '裁判', agent: 'judge', task: '裁决', role: 'judge' },
      ],
    }), { name: '攻击步骤', type: 'agent', role: 'attacker', agent: '', task: '' });
    expect(draft.steps[1]).toMatchObject({ name: '攻击步骤', role: 'attacker', agent: '', task: '' });
    expect(draft.steps[2].role).toBe('judge');
  });

  it('preserves an independent frame position when parsing saved state config', () => {
    const positions = { parallel: { x: 190, y: 120 } };
    const parsed = stateMachineStateSchema.parse(state('实现', { parallelGroupPositions: positions }));
    expect(parsed.parallelGroupPositions).toEqual(positions);
  });

  it('preserves an empty nested frame and accepts its first dropped step', () => {
    const draft = state('实现', {
      parallelGroups: [{ id: 'parallel', name: '并发组', joinPolicy: { mode: 'all' } }],
    });
    expect(canvasStateContents(draft).find((group) => group.id === 'parallel')?.steps).toEqual([]);
    const saved = stateMachineStateSchema.parse(draft);
    const added = insertDesignStep(saved, { name: '分支', agent: '', task: '' }, 'parallel');
    expect(added.steps.at(-1)?.concurrency).toMatchObject({ groupId: 'parallel', joinPolicy: { mode: 'all' } });
    expect(validateCanvasTopology([draft])).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: '实现 · 并发组至少需要两个步骤' }),
    ]));
  });

  it('moves a step into and out of a nested frame without losing its identity', () => {
    const draft = state('实现', {
      parallelGroups: [{ id: 'parallel', name: '并发组' }],
      steps: [{ id: 'moving', name: '可移动', agent: 'builder', task: '执行' }],
    });
    const grouped = moveCanvasStep([draft], 0, 0, 0, 'parallel');
    expect(grouped[0].steps).toHaveLength(1);
    expect(grouped[0].steps[0]).toMatchObject({ id: 'moving', parallelGroup: 'parallel' });
    const ungrouped = moveCanvasStep(grouped, 0, 0, 0);
    expect(ungrouped[0].steps).toHaveLength(1);
    expect(ungrouped[0].steps[0].id).toBe('moving');
    expect(ungrouped[0].steps[0].parallelGroup).toBeUndefined();
    expect(ungrouped[0].parallelGroups).toEqual(draft.parallelGroups);
  });
});


describe('canvas step placement', () => {
  const steps = () => ['a', 'b', 'c'].map((name) => ({ id: name, name, agent: 'builder', task: name }));
  it('reorders serial steps upward and downward using original insertion indices', () => {
    const original = [state('实现', { steps: steps() })];
    const down = moveCanvasStep(original, 0, 0, 0, undefined, 3);
    expect(down[0].steps.map((step) => step.id)).toEqual(['b', 'c', 'a']);
    expect(moveCanvasStep(down, 0, 2, 0, undefined, 0)[0].steps.map((step) => step.id)).toEqual(['a', 'b', 'c']);
    expect(moveCanvasStep(original, 0, 1, 0, undefined, 2)).toBe(original);
  });
  it('reorders members without splitting their group or losing branch policy', () => {
    const original = [state('实现', { steps: steps().map((step) => ({ ...step, parallelGroup: 'g', concurrency: { groupId: 'g', branchId: step.id, joinPolicy: { mode: 'all' as const } } })) })];
    const next = moveCanvasStep(original, 0, 2, 0, 'g', 0);
    expect(next[0].steps.map((step) => step.id)).toEqual(['c', 'a', 'b']);
    expect(next[0].steps[0].concurrency).toEqual(original[0].steps[2].concurrency);
  });
  it('moves defenders into and out of an empty group before managed review stages', () => {
    const original = [state('实现', {
      reviewPolicy: { mode: 'adversarial', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '' },
      parallelGroups: [{ id: 'g', name: '并发组' }],
      steps: [
        ...steps().map((step) => ({ ...step, role: 'defender' as const, agentInstanceId: step.id + '-instance' })),
        { name: '攻击', agent: 'reviewer', task: '审查', role: 'attacker', provenance: { origin: 'review-policy' } },
        { name: '裁判', agent: 'judge', task: '裁决', role: 'judge', provenance: { origin: 'review-policy' } },
      ],
    })];
    const inserted = insertDesignStep(original[0], { name: '新增分支', role: 'defender', agent: 'builder', task: '执行' }, 'g');
    expect(inserted.steps.map((step) => step.name)).toEqual(['a', 'b', 'c', '新增分支', '攻击', '裁判']);
    expect(inserted.steps[3].parallelGroup).toBe('g');
    const grouped = moveCanvasStep(original, 0, 0, 0, 'g', 3);
    expect(grouped[0].steps.map((step) => step.name)).toEqual(['b', 'c', 'a', '攻击', '裁判']);
    expect(grouped[0].steps[2].parallelGroup).toBe('g');
    const ungrouped = moveCanvasStep(grouped, 0, 2, 0, undefined, 0);
    expect(ungrouped[0].steps[0]).toMatchObject({ id: 'a', agentInstanceId: 'a-instance' });
    expect(ungrouped[0].steps[0].parallelGroup).toBeUndefined();
    expect(moveCanvasStep(original, 0, 0, 0, undefined, 5)[0].steps.at(-1)?.name).toBe('a');
    expect(moveCanvasStep(original, 0, 3, 0, 'g')[0].steps.find(step => step.name === '攻击')?.parallelGroup).toBe('g');
  });
  it('moves a legacy step without an id across states and preserves the chosen insertion position', () => {
    const original = [state('来源'), state('目标', { steps: steps() })];
    const next = moveCanvasStep(original, 0, 0, 1, undefined, 1);
    expect(next[0].steps).toEqual([]);
    expect(next[1].steps.map((step) => step.name)).toEqual(['a', '执行', 'b', 'c']);
  });
  it('rejects serial insertion that would split an existing group and rejects scripts inside groups', () => {
    const original = [state('实现', { steps: [
      { ...steps()[0], parallelGroup: 'g' }, { ...steps()[1], parallelGroup: 'g' }, steps()[2],
      { name: '脚本', agent: '', task: '', type: 'script', script: { interpreter: 'python', source: 'print(1)', timeoutMs: 1000, onFailure: { action: 'stop' } } },
    ] })];
    expect(moveCanvasStep(original, 0, 2, 0, undefined, 1)).toBe(original);
    expect(moveCanvasStep(original, 0, 3, 0, 'g')).toBe(original);
  });
});


describe('manual canvas drag slots', () => {
  const reviewPolicy: StateMachineState['reviewPolicy'] = { mode: 'standard', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '' };
  const step = (name: string, group?: string) => ({ id: name, name, agent: 'builder', task: name, role: 'defender' as const, parallelGroup: group });
  it('moves role steps across locked states and resolves duplicate names', () => {
    const original = [state('来源', { reviewPolicy, steps: [step('开发'), step('测试')] }), state('目标', { reviewPolicy, steps: [step('开发')] })];
    const moved = moveCanvasStep(original, 0, 0, 1, undefined, 0);
    expect(moved[0].steps.map(step => step.name)).toEqual(['测试']);
    expect(moved[1].steps.map(step => step.name)).toEqual(['开发 2', '开发']);
    expect(moved[1].steps[0].id).toBe('开发');
  });
  it('respects explicit insertion slots for newly dropped steps in a locked state', () => {
    const original = state('开发', { reviewPolicy, steps: [step('a'), step('b')] });
    expect(insertDesignStep(original, step('新步骤'), undefined, 0).steps.map(step => step.name)).toEqual(['新步骤', 'a', 'b']);
    expect(insertDesignStep(original, step('新步骤'), undefined, 1).steps.map(step => step.name)).toEqual(['a', '新步骤', 'b']);
  });
  it('persists and fills an empty parallel group between two serial steps', () => {
    const original = stateMachineStateSchema.parse(state('开发', { steps: [step('a'), step('b')], parallelGroups: [{ id: 'g', name: '并发组', insertBefore: 1 }] }));
    expect(canvasStateContents(original).map(group => group.id || group.steps[0].step.name)).toEqual(['a', 'g', 'b']);
    expect(insertDesignStep(original, step('分支'), 'g').steps.map(step => step.name)).toEqual(['a', '分支', 'b']);
  });
  it('reorders a whole group and moves its members across locked states as one unit', () => {
    const original = [state('来源', { reviewPolicy, steps: [step('a'), step('x', 'g'), step('y', 'g'), step('b')], parallelGroups: [{ id: 'g', name: '检查', joinPolicy: { mode: 'all' } }] }), state('目标', { reviewPolicy, steps: [step('c'), step('d')] })];
    const reordered = moveCanvasGroup(original, 0, 'g', 0, 0);
    expect(reordered[0].steps.map(step => step.name)).toEqual(['x', 'y', 'a', 'b']);
    const moved = moveCanvasGroup(reordered, 0, 'g', 1, 1);
    expect(moved[0].steps.map(step => step.name)).toEqual(['a', 'b']);
    expect(moved[0].parallelGroups).toEqual([]);
    expect(moved[1].steps.map(step => step.name)).toEqual(['c', 'x', 'y', 'd']);
    expect(moved[1].parallelGroups?.[0]).toMatchObject({ id: 'g', name: '检查', joinPolicy: { mode: 'all' } });
  });
  it('moves an empty group across states and preserves its insertion slot', () => {
    const original = [state('来源', { steps: [step('a')], parallelGroups: [{ id: 'g', name: '并发组', insertBefore: 0 }] }), state('目标', { steps: [step('b')] })];
    const moved = moveCanvasGroup(original, 0, 'g', 1, 0);
    expect(canvasStateContents(moved[0]).map(group => group.id)).toEqual([undefined]);
    expect(canvasStateContents(moved[1]).map(group => group.id || group.steps[0].step.name)).toEqual(['g', 'b']);
    expect(insertDesignStep(moved[1], step('分支'), 'g').steps.map(step => step.name)).toEqual(['分支', 'b']);
  });
  it('keeps both groups intact when moving across states with colliding group ids', () => {
    const original = [state('来源', { steps: [step('x', 'g'), step('y', 'g')] }), state('目标', { steps: [step('a', 'g'), step('b', 'g')] })];
    const moved = moveCanvasGroup(original, 0, 'g', 1, 2);
    const contents = canvasStateContents(moved[1]);
    expect(contents).toHaveLength(2);
    expect(contents[1].id).not.toBe('g');
    expect(contents[1].steps.map(({ step }) => step.name)).toEqual(['x', 'y']);
  });
});


describe('ordinary agent grouping', () => {
  it('groups plain and legacy-role business steps in a locked standard state', () => {
    const original = state('业务开发', {
      reviewPolicy: { mode: 'standard', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '' },
      parallelGroups: [{ id: 'g', name: '并发组', insertBefore: 0 }],
      steps: [
        { name: '普通步骤', agent: 'builder', task: '开发' },
        { name: '业务检查', agent: 'checker', task: '检查', role: 'attacker' },
        { name: '业务总结', agent: 'builder', task: '总结', role: 'judge' },
      ],
    });
    let current = [original];
    for (const name of ['普通步骤', '业务检查', '业务总结']) {
      current = moveCanvasStep(current, 0, current[0].steps.findIndex(step => step.name === name), 0, 'g');
      expect(current[0].steps.find(step => step.name === name)?.parallelGroup).toBe('g');
    }
    expect(canvasStateContents(current[0])).toHaveLength(1);
    expect(canvasStateContents(current[0])[0].steps).toHaveLength(3);
  });
  it('reports adversarial ordering problems through validation after a manual draft edit', () => {
    const draft = state('评审', { reviewPolicy: { mode: 'adversarial', source: 'user', locked: true, confidence: 'high', riskSignals: [], rationale: '' },
      steps: [{ name: '执行', agent: 'builder', task: '执行', role: 'defender' }, { name: '审查', agent: 'reviewer', task: '审查', role: 'attacker', parallelGroup: 'g' }, { name: '裁决', agent: 'judge', task: '裁决', role: 'judge', parallelGroup: 'g' }] });
    expect(validateCanvasTopology([draft])).toEqual(expect.arrayContaining([expect.objectContaining({message:'评审 · 对抗编排须先执行防守步骤，再串行执行攻击与裁判步骤'})]));
  });
});
