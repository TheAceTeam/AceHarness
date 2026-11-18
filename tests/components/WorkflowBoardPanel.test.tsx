// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowBoardPanel } from '@/client/pages/workbench/WorkflowBoardPanel';
import type { WorkflowBoardTile } from '@/lib/workspace/workflow-board-layout';

vi.mock('@/client/pages/workbench/WorkflowBoardDiagram', () => ({
  WorkflowBoardDiagram: ({ code }: { code: string }) => <pre>{code}</pre>,
}));

vi.mock('@/client/pages/workbench/WorkflowBoardGrid', () => ({
  BOARD_DRAG_TYPE: 'application/x-ace-workflow-board',
  WorkflowBoardGrid: ({ tiles, children }: { tiles: WorkflowBoardTile[]; children: (tile: WorkflowBoardTile) => ReactNode }) => (
    <div>{tiles.map((tile) => <div key={tile.id}>{children(tile)}</div>)}</div>
  ),
}));

const documents = [
  { filename: 'modules.md', title: '模块图', diagram: 'mindmap\n  root(原内容)' },
  { filename: 'engineering.md', title: '架构图', diagram: 'flowchart LR\n  A-->B' },
];

function makeProps() {
  return {
    boards: documents, loading: false, error: false, onRefresh: vi.fn(), layout: null,
    onSave: vi.fn(async () => {}),
  };
}

describe('WorkflowBoardPanel', () => {
  it('requests refresh, disables duplicate clicks, and shows updated documents', () => {
    const props = makeProps();
    const panel = render(<WorkflowBoardPanel {...props} refreshing={false} />);
    const button = screen.getByRole('button', { name: '刷新看板' });
    fireEvent.click(button);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    panel.rerender(<WorkflowBoardPanel {...props} refreshing />);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
    panel.rerender(<WorkflowBoardPanel {...props} boards={[{
      ...documents[0], title: '更新后的模块图', diagram: 'mindmap\n  root(新内容)',
    }, documents[1]]} refreshing={false} />);
    expect(screen.getByRole('heading', { name: '更新后的模块图' })).toBeInTheDocument();
    expect(screen.getByText(/新内容/)).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it('creates a page and saves a full-width group of Markdown documents', async () => {
    const props = makeProps();
    render(<WorkflowBoardPanel {...props} refreshing={false} />);
    fireEvent.click(screen.getByRole('button', { name: '添加看板页' }));
    fireEvent.change(screen.getByLabelText('页名'), { target: { value: '天气交付' } });
    for (const doc of documents) fireEvent.click(screen.getByRole('button', { name: doc.title }));
    for (const doc of documents) fireEvent.click(screen.getByRole('checkbox', { name: '选中 ' + doc.title }));
    fireEvent.click(screen.getByRole('button', { name: '组合选中卡片' }));
    const group = screen.getByRole('heading', { name: '组合 · 2 张图' }).closest('article')!;
    fireEvent.keyDown(within(group).getByRole('button', { name: '组合 · 2 张图 卡片操作' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: '占满一行' }));
    fireEvent.click(screen.getByRole('button', { name: '保存布局' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({
      version: 1,
      pages: expect.arrayContaining([expect.objectContaining({
        title: '天气交付',
        tiles: [expect.objectContaining({ x: 0, w: 12, files: ['modules.md', 'engineering.md'] })],
      })]),
    })));
  });
});
