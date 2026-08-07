// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import WorkflowModeSelector from '@/components/WorkflowModeSelector';

describe('WorkflowModeSelector AI entry', () => {
  test('selects AI guided creation as an exclusive mode', () => {
    function Harness() {
      const [value, setValue] = useState<'lightweight' | 'state-machine' | 'ai-guided'>('state-machine');
      return <WorkflowModeSelector value={value} onChange={setValue} />;
    }

    render(<Harness />);

    expect(screen.getByRole('radio', { name: '轻量工作流' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '状态机' })).toBeInTheDocument();
    expect(screen.queryByText('阶段模式')).not.toBeInTheDocument();
    expect(screen.queryByText('线性流程')).not.toBeInTheDocument();
    const entry = screen.getByRole('radio', { name: 'AI 引导创建工作流' });
    expect(entry).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('AI 引导创建', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('描述需求，AI 整理最佳实践', { exact: true })).toBeInTheDocument();

    fireEvent.click(entry);
    expect(entry).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '轻量工作流' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: '状态机' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('AI 会先收集需求，同次判断最终应生成轻量工作流还是状态机，再展示可确认、可编辑的草案；ai-guided 本身不会写入工作流 YAML。')).toBeInTheDocument();
  });
});
