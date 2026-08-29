import { describe, expect, test } from 'vitest';

import {
  getStateDiagramReviewMode,
  getStateDiagramRerunStepKey,
  getStateDiagramStepSemantics,
  stateDiagramStepKeyMatches,
} from '@/components/StateMachineDiagram';

describe('stateDiagramStepKeyMatches', () => {
  test.each([
    ['实现功能', '设计', '实现功能'],
    ['设计-实现功能', '设计', '实现功能'],
    ['state:设计#实现功能', '设计', '实现功能'],
    ['实现功能-迭代2', '设计', '实现功能'],
    ['设计-实现功能-迭代2', '设计', '实现功能'],
    ['并发:设计:group-1-设计-实现功能', '设计', '实现功能'],
  ])('matches runtime step key %s', (key, stateName, stepName) => {
    expect(stateDiagramStepKeyMatches(key, stateName, stepName)).toBe(true);
  });

  test('does not match unrelated steps', () => {
    expect(stateDiagramStepKeyMatches('设计-测试验证', '设计', '实现功能')).toBe(false);
  });

  test('builds the canonical state-machine rerun step key', () => {
    expect(getStateDiagramRerunStepKey('设计', '实现功能')).toBe('设计-实现功能');
  });
});

describe('state diagram run semantics', () => {
  test('shows the effective review mode from the run snapshot', () => {
    expect(getStateDiagramReviewMode({
      isFinal: false,
      reviewPolicy: {
        mode: 'adversarial',
        source: 'ai',
        locked: false,
        confidence: 'high',
        riskSignals: [],
        rationale: '需要独立挑战。',
      },
    })).toMatchObject({ mode: 'adversarial', label: '本次对抗' });

    expect(getStateDiagramReviewMode({
      isFinal: false,
      reviewPolicy: {
        mode: 'standard',
        source: 'user',
        locked: true,
        confidence: 'high',
        riskSignals: [],
        rationale: '本次关闭对抗。',
      },
    })).toMatchObject({ mode: 'standard', label: '本次标准' });
  });

  test('does not describe reusable configuration as the current run', () => {
    expect(getStateDiagramReviewMode({
      isFinal: false,
      reviewPolicy: {
        mode: 'adversarial',
        source: 'user',
        locked: true,
        confidence: 'high',
        riskSignals: [],
        rationale: '配置基线。',
      },
    }, 'configuration')).toMatchObject({ mode: 'adversarial', label: '配置对抗' });
  });

  test.each([
    ['defender', '执行方'],
    ['attacker', '挑战方'],
    ['judge', '裁决方'],
  ] as const)('shows %s as an isolated adversarial role', (role, label) => {
    expect(getStateDiagramStepSemantics({
      role,
      agentInstanceId: `review-instance-${role}`,
    })).toMatchObject({ kind: role, label, isolated: true });
  });

  test('does not infer adversarial execution from a legacy step name', () => {
    expect(getStateDiagramStepSemantics({
      role: undefined,
      agentInstanceId: undefined,
      provenance: { origin: 'user' },
    })).toEqual({
      kind: 'ordinary',
      label: '标准步骤',
      description: '不承担对抗角色的普通执行或验证步骤',
      isolated: false,
      instanceId: '',
    });
  });

  test('identifies a converted judge as the standard closer', () => {
    expect(getStateDiagramStepSemantics({
      role: undefined,
      agentInstanceId: undefined,
      provenance: { origin: 'user', managedRole: 'standard-closer' },
    })).toMatchObject({ kind: 'standard-closer', label: '标准收口', isolated: false });
  });
});
