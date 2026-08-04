import { describe, expect, test } from 'vitest';

import { getStateDiagramRerunStepKey, stateDiagramStepKeyMatches } from '@/components/StateMachineDiagram';

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
