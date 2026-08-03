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
      specTaskBinding: { taskIds: ['T1.1'], requirementIds: [], artifactKeys: [] },
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
        metadata={{
          workflowName: '任务清单工作流',
          workspace: 'C:/workspace/demo',
        }}
      />,
    );

    expect(screen.getByText('轻量工作流设计')).toBeInTheDocument();
    expect(screen.queryByText('任务清单目录（只读）')).not.toBeInTheDocument();
    expect(screen.queryByText('docs/tasklists/tasklist-flow')).not.toBeInTheDocument();
    expect(screen.queryByText(LIGHTWEIGHT_TASKLIST_SKILL)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('步骤 Skills')).not.toBeInTheDocument();
    expect(screen.queryByText('状态转移规则')).not.toBeInTheDocument();
    expect(screen.queryByText('添加状态')).not.toBeInTheDocument();
    expect(hasLightweightWorkflowTopology(states)).toBe(true);
  });

  test('does not offer the system Supervisor as a lightweight execution Agent', () => {
    render(
      <LightweightWorkflowDesignPanel
        states={createStates()}
        onStatesChange={vi.fn()}
        availableAgents={[
          { name: 'default-supervisor', roleType: 'supervisor', catalogVisibility: 'system' },
          { name: 'developer', description: '实现任务' },
        ]}
      />,
    );

    const selector = screen.getByLabelText('执行 Agent') as HTMLSelectElement;
    const optionValues = Array.from(selector.options, (option) => option.value);
    expect(optionValues).toContain('developer');
    expect(optionValues).not.toContain('default-supervisor');
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
        />
      );
    }

    render(
      <StatefulPanel />,
    );

    fireEvent.change(screen.getByLabelText('执行 Agent'), { target: { value: 'tester' } });
    fireEvent.change(screen.getByLabelText('完整目标'), { target: { value: '更新后的任务' } });
    expect(screen.queryByLabelText('步骤 Skills')).not.toBeInTheDocument();

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
    expect(nextStates[0].steps[0].skills).toEqual([LIGHTWEIGHT_TASKLIST_SKILL]);
    expect(nextStates[0].steps[0].specTaskBinding).toBeUndefined();
  });
});
