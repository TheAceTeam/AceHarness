// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import StateMachineDesignPanel from '@/components/StateMachineDesignPanel';
import type { StateMachineState } from '@/lib/core/schemas';

vi.mock('@/client/query/configs', () => ({
  useWorkflowConfigQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

vi.mock('@/client/query/workflow-mutations', () => ({
  useSaveConfigMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('react-resizable-panels', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDefaultLayout: () => ({ onLayoutChanged: vi.fn() }),
}));

vi.mock('@/components/ui/combobox', () => ({
  ComboboxPortalProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SingleCombobox: ({ value, onValueChange, options = [] }: any) => (
    <select value={value || ''} onChange={(event) => onValueChange(event.target.value)}>
      <option value="">请选择</option>
      {options.map((option: any) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

/**
 * `reviewPolicy.locked` means "AI optimization must not touch this policy". It is
 * not a permission gate on the person editing the workflow. These tests pin that
 * distinction: a locked state stays fully editable by hand, while the review
 * steps the system generated stay protected.
 */
function createStates(): StateMachineState[] {
  return [
    {
      id: 'state-1',
      name: '执行',
      isInitial: true,
      isFinal: false,
      maxSelfTransitions: 3,
      reviewPolicy: {
        mode: 'standard',
        source: 'user',
        locked: true,
        confidence: 'high',
        riskSignals: [],
        rationale: '用户明确选择标准模式。',
      },
      steps: [{
        id: 'step-1',
        type: 'agent' as const,
        name: '执行任务',
        agent: 'developer',
        task: '完成本阶段工作。',
        provenance: { origin: 'user' as const },
      }],
      transitions: [],
    },
    {
      id: 'state-2',
      name: '完成',
      isInitial: false,
      isFinal: true,
      steps: [],
      transitions: [],
    },
  ];
}

function renderPanel(onStatesChange = vi.fn()) {
  const states = createStates();
  render(
    <StateMachineDesignPanel
      states={states}
      onStatesChange={onStatesChange}
      availableAgents={[{ name: 'developer', roleType: 'worker' }]}
      onOptimizeState={vi.fn()}
      protocolAdopted
    />,
  );
  return { states, onStatesChange };
}

describe('StateMachineDesignPanel: a固定的审查模式不限制用户操作', () => {
  test('固定审查模式的状态仍可删除', () => {
    const { onStatesChange } = renderPanel();

    const deleteButtons = screen.getAllByTitle('删除状态');
    expect(deleteButtons[0]).not.toBeDisabled();

    fireEvent.click(deleteButtons[0]);

    // The guard used to live in both the JSX and handleDeleteState, so asserting
    // the button is enabled is not enough — the click must actually remove it.
    expect(onStatesChange).toHaveBeenCalledTimes(1);
    const nextStates = onStatesChange.mock.calls[0][0] as StateMachineState[];
    expect(nextStates.map((state) => state.name)).toEqual(['完成']);
  });

  test('固定审查模式的状态，名称、终止标记和自循环次数仍可编辑', () => {
    renderPanel();

    // 状态基本信息默认折叠，先展开。
    const summary = screen.getAllByText('执行')
      .find((element) => element.tagName === 'SPAN' && element.className.includes('font-semibold'));
    expect(summary).toBeTruthy();
    fireEvent.click(summary!);

    expect(screen.getByDisplayValue('执行')).not.toBeDisabled();
    expect(screen.getByDisplayValue('3')).not.toBeDisabled();

    const finalCheckbox = screen.getByText('终止状态').closest('label')?.querySelector('[role="checkbox"]');
    expect(finalCheckbox).toBeTruthy();
    expect(finalCheckbox).not.toBeDisabled();
  });

  test('锁标识使用图钉而不是挂锁，且文案不含「锁定」', () => {
    renderPanel();

    // 左侧状态列表一处 + 审查模式卡片徽章一处。
    expect(screen.getAllByText('push_pin')).toHaveLength(2);
    expect(screen.queryByText('lock')).toBeNull();
    expect(screen.queryByText(/用户锁定|交还 AI 判断|锁定当前模式/)).toBeNull();
    expect(screen.getByText('已固定')).toBeTruthy();
    // Both AI entry points name what they act on; the mode one is the only route
    // that may touch a pinned policy, so it must stay distinguishable by label.
    expect(screen.getByText('AI 重新评估模式')).toBeTruthy();
    expect(screen.getAllByText('AI 优化状态').length).toBeGreaterThan(0);
  });
});
