// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import LightweightWorkflowDesignPanel, {
  hasLightweightWorkflowTopology,
} from '@/components/LightweightWorkflowDesignPanel';
import type { StateMachineState } from '@/lib/core/schemas';
import { LIGHTWEIGHT_TASKLIST_SKILL } from '@/lib/workflow/lightweight';

const apiMocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
}));

vi.mock('@/lib/core/api', () => ({
  configApi: apiMocks,
}));

vi.mock('@/components/ui/combobox', () => ({
  SingleCombobox: ({ value, onValueChange, options = [] }: any) => (
    <select
      aria-label="执行 Agent"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">请选择</option>
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
  MultiCombobox: ({ value = [], onValueChange, options = [] }: any) => (
    <select
      aria-label="步骤 Skills"
      multiple
      value={value}
      onChange={(event) => onValueChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
    >
      {options.map((option: any) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));

function createStates(): StateMachineState[] {
  return [{
    name: '执行',
    isInitial: true,
    isFinal: true,
    transitions: [],
    steps: [{
      type: 'agent' as const,
      name: '执行任务',
      agent: 'developer',
      task: '完成任务清单中的工作。',
      skills: [LIGHTWEIGHT_TASKLIST_SKILL, 'review-skill'],
    }],
  }];
}

describe('LightweightWorkflowDesignPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('keeps the fixed topology and required skill out of the editable surface', () => {
    const states = createStates();
    const onStatesChange = vi.fn();
    render(
      <LightweightWorkflowDesignPanel
        states={states}
        onStatesChange={onStatesChange}
        availableAgents={[{ name: 'developer', description: '实现任务' }]}
        availableSkills={[
          { name: LIGHTWEIGHT_TASKLIST_SKILL, description: 'required' },
          { name: 'review-skill', description: '审查' },
        ]}
        metadata={{
          workflowName: '任务清单工作流',
          workspace: 'C:/workspace/demo',
          tasklistDirectory: 'docs/tasklists/tasklist-flow',
        }}
      />,
    );

    expect(screen.getByText('轻量工作流设计')).toBeInTheDocument();
    expect(screen.getByText('docs/tasklists/tasklist-flow')).toBeInTheDocument();
    expect(screen.queryByText(LIGHTWEIGHT_TASKLIST_SKILL)).not.toBeInTheDocument();
    expect(screen.queryByText('状态转移规则')).not.toBeInTheDocument();
    expect(screen.queryByText('添加状态')).not.toBeInTheDocument();
    expect(hasLightweightWorkflowTopology(states)).toBe(true);
  });

  test('normalizes edits without allowing topology or required-skill removal', () => {
    const onStatesChange = vi.fn();
    function StatefulPanel() {
      const [states, setStates] = React.useState(createStates());
      return (
        <LightweightWorkflowDesignPanel
          states={states}
          onStatesChange={(nextStates) => {
            onStatesChange(nextStates);
            setStates(nextStates);
          }}
          availableAgents={[{ name: 'developer' }, { name: 'tester' }]}
          availableSkills={[{ name: 'review-skill', description: '审查' }]}
          metadata={{ tasklistDirectory: 'docs/tasklists/tasklist-flow' }}
        />
      );
    }

    render(
      <StatefulPanel />,
    );

    fireEvent.change(screen.getByLabelText('执行 Agent'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByLabelText('执行任务'), { target: { value: '更新后的任务' } });
    const skills = screen.getByLabelText('步骤 Skills') as HTMLSelectElement;
    const reviewSkill = Array.from(skills.options).find((option) => option.value === 'review-skill');
    if (!reviewSkill) throw new Error('Missing review-skill option');
    reviewSkill.selected = true;
    fireEvent.change(skills);

    const nextStates = onStatesChange.mock.calls.at(-1)?.[0];
    expect(nextStates).toHaveLength(1);
    expect(nextStates[0]).toMatchObject({
      isInitial: true,
      isFinal: true,
      transitions: [],
    });
    expect(nextStates[0].steps).toHaveLength(1);
    expect(nextStates[0].steps[0]).toMatchObject({
      type: 'agent',
      agent: 'tester',
      task: '更新后的任务',
    });
    expect(nextStates[0].steps[0].skills).toEqual([LIGHTWEIGHT_TASKLIST_SKILL, 'review-skill']);
  });
});
