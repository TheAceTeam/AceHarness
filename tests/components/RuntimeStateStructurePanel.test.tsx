// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import RuntimeStateStructurePanel from '@/components/workflow/RuntimeStateStructurePanel';

describe('RuntimeStateStructurePanel', () => {
  test('shows the effective states, live steps and verdict transitions', () => {
    render(
      <RuntimeStateStructurePanel
        states={[
          {
            name: '执行与对抗',
            isInitial: true,
            isFinal: false,
            reviewPolicy: { mode: 'adversarial', source: 'ai', locked: false, confidence: 'high', rationale: '本次运行需要独立审查。' },
            steps: [
              { name: '执行任务', agent: 'analyst', role: 'defender' },
              { name: '对抗审查', agent: 'reviewer', role: 'attacker' },
              { name: '独立裁决', agent: 'judge', role: 'judge' },
            ],
            transitions: [
              { to: '完成', condition: { verdict: 'pass' } },
              { to: '执行与对抗', condition: { verdict: 'conditional_pass' } },
            ],
          },
          {
            name: '标准验收',
            isInitial: false,
            isFinal: false,
            reviewPolicy: { mode: 'standard', source: 'ai', locked: false, confidence: 'high', rationale: '普通验收即可覆盖。' },
            steps: [{ name: '验收任务', agent: 'analyst' }],
            transitions: [{ to: '完成', condition: { verdict: 'pass' } }],
          },
          { name: '完成', isInitial: false, isFinal: true, steps: [], transitions: [] },
        ] as any}
        currentState="执行与对抗"
        currentStep="执行与对抗-独立裁决"
        activeSteps={['执行与对抗-独立裁决']}
        completedSteps={['执行与对抗-执行任务', '执行与对抗-对抗审查']}
        stateHistory={[{ from: '执行与对抗', to: '执行与对抗', verdict: 'conditional_pass' }]}
        workflowStatus="running"
      />,
    );

    expect(screen.getByTestId('runtime-state-structure-panel')).toBeInTheDocument();
    expect(screen.getAllByText('执行与对抗').length).toBeGreaterThan(0);
    expect(screen.getByText('执行任务')).toBeInTheDocument();
    expect(screen.getByText('独立裁决')).toBeInTheDocument();
    expect(screen.getByText('pass')).toBeInTheDocument();
    expect(screen.getByText('conditional_pass')).toBeInTheDocument();
    expect(screen.getByText('已触发 1 次')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /执行与对抗/ })).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('button', { name: /执行与对抗/ })).toHaveClass('bg-blue-500');
    const adversarialStateButton = screen.getByRole('button', { name: /执行与对抗/ });
    const standardStateButton = screen.getByRole('button', { name: /标准验收/ });
    const terminalStateButton = screen.getByRole('button', { name: /完成/ });
    expect(within(adversarialStateButton).getByLabelText('执行与对抗：对抗模式')).toHaveAttribute('data-review-mode', 'adversarial');
    expect(within(standardStateButton).getByLabelText('标准验收：标准模式')).toHaveAttribute('data-review-mode', 'standard');
    expect(within(terminalStateButton).getByLabelText('完成：终止模式')).toHaveAttribute('data-review-mode', 'terminal');
    expect(screen.getByText('执行任务').closest('[data-step-tone]')).toHaveAttribute('data-step-tone', 'defender');
    expect(screen.getByText('对抗审查').closest('[data-step-tone]')).toHaveAttribute('data-step-tone', 'attacker');
    expect(screen.getByText('独立裁决').closest('[data-step-tone]')).toHaveAttribute('data-step-tone', 'judge');
    expect(screen.getByText('已触发 1 次').closest('[data-triggered]')).toHaveAttribute('data-triggered', 'true');
  });

  test('shows the current retry instead of a historical judge failure', () => {
    render(
      <RuntimeStateStructurePanel
        states={[
          {
            name: '代码实现',
            isInitial: true,
            isFinal: false,
            reviewPolicy: { mode: 'adversarial', source: 'ai', locked: false, confidence: 'high', rationale: '需要对抗审查。' },
            steps: [
              { name: '实现功能', agent: 'developer', role: 'defender' },
              { name: '修正实现', agent: 'code-judge', role: 'defender' },
              { name: '对抗审查', agent: 'architect', role: 'attacker' },
              { name: '独立裁决', agent: 'architect', role: 'judge' },
            ],
            transitions: [{ to: '代码实现', condition: { verdict: 'conditional_pass' } }],
          },
        ] as any}
        currentState="代码实现"
        currentStep="代码实现-对抗审查"
        activeSteps={['代码实现-对抗审查']}
        completedSteps={['代码实现-实现功能', '代码实现-修正实现', '代码实现-独立裁决']}
        failedSteps={['代码实现-独立裁决']}
        stateHistory={[{ from: '代码实现', to: '代码实现', verdict: 'conditional_pass' }]}
        workflowStatus="running"
      />,
    );

    const stateButton = screen.getByRole('button', { name: /代码实现/ });
    const attackerCard = screen.getByText('对抗审查').closest('[data-runtime-status]');
    const judgeCard = screen.getByText('独立裁决').closest('[data-runtime-status]');
    expect(stateButton).toHaveAttribute('data-runtime-status', 'running');
    expect(attackerCard).toHaveAttribute('data-runtime-status', 'running');
    expect(judgeCard).toHaveAttribute('data-runtime-status', 'pending');
  });

  test('keeps the current failed step red when the run really failed', () => {
    render(
      <RuntimeStateStructurePanel
        states={[
          {
            name: '代码实现',
            isInitial: true,
            isFinal: false,
            reviewPolicy: { mode: 'adversarial', source: 'ai', locked: false, confidence: 'high', rationale: '需要对抗审查。' },
            steps: [
              { name: '对抗审查', agent: 'architect', role: 'attacker' },
              { name: '独立裁决', agent: 'architect', role: 'judge' },
            ],
            transitions: [],
          },
        ] as any}
        currentState="代码实现"
        currentStep="代码实现-独立裁决"
        completedSteps={['代码实现-独立裁决']}
        failedSteps={['代码实现-独立裁决']}
        workflowStatus="failed"
      />,
    );

    const stateButton = screen.getByRole('button', { name: /代码实现/ });
    const judgeCard = screen.getByText('独立裁决').closest('[data-runtime-status]');
    expect(stateButton).toHaveAttribute('data-runtime-status', 'failed');
    expect(judgeCard).toHaveAttribute('data-runtime-status', 'failed');
  });
});
