// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import WorkflowModeSelector from '@/components/WorkflowModeSelector';

describe('WorkflowModeSelector AI entry', () => {
  test('renders AI guided creation as a separate action card', () => {
    const onAiGuidedCreate = vi.fn();

    render(
      <WorkflowModeSelector
        value="state-machine"
        onChange={vi.fn()}
        onAiGuidedCreate={onAiGuidedCreate}
      />,
    );

    expect(screen.getByRole('radio', { name: '轻量工作流' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '状态机' })).toBeInTheDocument();
    const entry = screen.getByRole('button', { name: 'AI 引导创建工作流' });
    expect(entry).not.toHaveAttribute('role', 'radio');
    expect(screen.getByText('AI 引导创建', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('描述需求，AI 帮你整理轻量任务清单', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('描述你的需求，AI 会帮你整理为轻量任务清单工作流')).toBeInTheDocument();
    expect(screen.getByText('自然语言描述需求')).toBeInTheDocument();
    expect(screen.getByText('整理目标与验收条件')).toBeInTheDocument();
    expect(screen.getByText('轻量任务清单执行')).toBeInTheDocument();

    fireEvent.click(entry);
    expect(onAiGuidedCreate).toHaveBeenCalledTimes(1);
  });
});
