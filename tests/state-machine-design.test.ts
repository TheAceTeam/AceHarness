import { describe, expect, test } from 'vitest';
import type { StateMachineState } from '@/lib/core/schemas';
import { renameStateAndReferences } from '@/lib/workflow/state-machine-design';

describe('state machine design updates', () => {
  test('renames a state and every transition targeting it', () => {
    const states = [
      {
        name: '输入质检',
        steps: [{ name: 'check', agent: 'architect', task: 'check input' }],
        transitions: [
          { to: '输入质检', condition: { verdict: 'conditional_pass' }, priority: 100 },
          { to: 'DT设计', condition: { verdict: 'pass' }, priority: 100 },
        ],
        isInitial: true,
        isFinal: false,
      },
      {
        name: 'DT设计',
        steps: [{ name: 'design', agent: 'architect', task: 'design' }],
        transitions: [
          { to: '输入质检', condition: { verdict: 'fail' }, priority: 100 },
        ],
        isInitial: false,
        isFinal: false,
      },
    ] as StateMachineState[];

    const renamed = renameStateAndReferences(states, '输入质检', '输入质检1');

    expect(renamed[0].name).toBe('输入质检1');
    expect(renamed[0].transitions.map((transition) => transition.to)).toEqual(['输入质检1', 'DT设计']);
    expect(renamed[1].transitions[0].to).toBe('输入质检1');
    expect(states[0].name).toBe('输入质检');
  });
});
