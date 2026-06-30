// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, test, vi } from 'vitest';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import StateMachineExecutionView from '@/components/StateMachineExecutionView';

vi.mock('@/components/Markdown', () => ({
  default: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/StateMachineRuntimePanel', () => ({
  default: () => <div data-testid="runtime-panel" />,
  formatStateName: (name: string) => name,
}));

vi.mock('@/components/StateMachineDiagram', () => ({
  default: () => <div data-testid="state-diagram" />,
}));

vi.mock('@/components/AgentFormationDiagram', () => ({
  default: () => <div data-testid="formation-diagram" />,
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
  BarChart: ({ children }: any) => <div>{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  PieChart: ({ children }: any) => <div>{children}</div>,
  Pie: ({ children }: any) => <div>{children}</div>,
  Cell: () => <div />,
}));

afterEach(() => cleanup());

describe('subworkflow UI coverage', () => {
  test('HumanQuestionCard renders child workflow breadcrumb', () => {
    render(
      <HumanQuestionCard
        collapsible={false}
        question={{
          id: 'q-1',
          runId: 'run-child',
          configFile: 'child.yaml',
          parentRunId: 'run-parent',
          rootRunId: 'run-parent',
          workflowPath: [
            { runId: 'run-parent', configFile: 'parent.yaml', workflowName: 'Parent', stateName: 'Build', stepName: 'Run child' },
            { runId: 'run-child', configFile: 'child.yaml', workflowName: 'Child', stateName: 'Review', stepName: 'Ask human' },
          ],
          status: 'unanswered',
          kind: 'approval',
          title: 'Need human input',
          message: 'Please confirm',
          createdAt: '2026-01-01T00:00:00.000Z',
          requiresWorkflowPause: true,
          answerSchema: { type: 'single-choice', required: true, options: [{ label: 'Approve', value: 'approve' }] },
        } as any}
      />
    );

    expect(screen.getByText('子工作流')).toBeInTheDocument();
    expect(screen.getByTitle('Parent / Build / Run child')).toBeInTheDocument();
    expect(screen.getByTitle('Child / Review / Ask human')).toBeInTheDocument();
  });

  test('StateMachineExecutionView renders child run card and opens embedded detail action', async () => {
    const onOpen = vi.fn();
    render(
      <StateMachineExecutionView
        states={[{ name: 'Build', steps: [], transitions: [] } as any]}
        currentState="Build"
        stateHistory={[]}
        issueTracker={[]}
        transitionCount={0}
        maxTransitions={10}
        status="running"
        subworkflowSummary={{ total: 1, active: 1, failed: 0, waitingHuman: 0, completed: 0 }}
        subworkflowRuns={[{
          runId: 'run-child',
          configFile: 'child.yaml',
          parentStateName: 'Build',
          parentStepName: 'Run child',
          status: 'running',
          summary: 'Child is working',
        }]}
        onOpenSubworkflowRun={onOpen}
      />
    );

    expect(screen.getByText('子工作流运行态')).toBeInTheDocument();
    expect(screen.getByText('Run child')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '查看子流程' }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-child' }));
  });
});

