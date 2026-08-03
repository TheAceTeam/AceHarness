// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { RuntimeToolEventCard, RuntimeToolEventGroup } from '@/components/chat/RuntimeToolEventList';
import { getStableLiveToolGroupIdentity } from '@/client/pages/workbench/live-tool-group-identity';

describe('RuntimeToolEventCard', () => {
  test('keeps the semantic file-tool icon without adding a second generic tool icon', () => {
    const { container } = render(
      <RuntimeToolEventCard
        tool={{
          id: 'read-1',
          toolName: 'read',
          title: '📖 读取文件',
          status: 'completed',
          input: { filePath: 'README.md' },
        }}
      />,
    );

    expect(screen.getByText('📖 读取文件')).toBeInTheDocument();
    expect(container.querySelectorAll('svg.lucide-wrench')).toHaveLength(0);
  });

  test('automatically collapses an unfinished running tool after its display timeout', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <RuntimeToolEventCard
          tool={{
            id: 'command-1',
            toolName: 'powershell',
            title: '💻 执行命令',
            status: 'running',
            input: { command: "Get-Content 'src/jinja2/runtime.py'" },
          }}
        />,
      );
      const card = container.querySelector('[data-tool-id="command-1"]');

      expect(card).toHaveAttribute('data-state', 'open');
      act(() => vi.advanceTimersByTime(10_000));
      expect(card).toHaveAttribute('data-state', 'closed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('closes a completed tool group and does not leave failed cards expanded', () => {
    const { container, rerender } = render(
      <RuntimeToolEventGroup
        events={[
          { id: 'read-1', toolName: 'read', title: '📖 读取文件', status: 'running' },
          { id: 'command-1', toolName: 'powershell', title: '💻 执行命令', status: 'running' },
        ]}
        isStreaming
      />,
    );
    const group = screen.getByTestId('runtime-tool-group');

    expect(group).toHaveAttribute('data-state', 'open');
    rerender(
      <RuntimeToolEventGroup
        events={[
          { id: 'read-1', toolName: 'read', title: '📖 读取文件', status: 'completed' },
          { id: 'command-1', toolName: 'powershell', title: '💻 执行命令', status: 'failed' },
        ]}
      />,
    );

    expect(group).toHaveAttribute('data-state', 'closed');
    expect(container.querySelector('[data-tool-id="command-1"]')).toHaveAttribute('data-state', 'closed');
  });

  test('closes immediately when streaming ends', () => {
    const { rerender } = render(
      <RuntimeToolEventGroup
        events={[{ id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'running' }]}
        isStreaming
      />,
    );
    const group = screen.getByTestId('runtime-tool-group');

    rerender(
      <RuntimeToolEventGroup
        events={[{ id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'running' }]}
      />,
    );

    expect(group).toHaveAttribute('data-state', 'closed');
  });

  test('keeps a streaming tool group open briefly while the next call arrives', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <RuntimeToolEventGroup
          events={[{ id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'running' }]}
          isStreaming
        />,
      );
      const group = screen.getByTestId('runtime-tool-group');

      rerender(
        <RuntimeToolEventGroup
          events={[{ id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'completed' }]}
          isStreaming
        />,
      );
      act(() => vi.advanceTimersByTime(2_999));
      expect(group).toHaveAttribute('data-state', 'open');

      rerender(
        <RuntimeToolEventGroup
          events={[
            { id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'completed' },
            { id: 'read-1', toolName: 'read', title: '读取文件', status: 'running' },
          ]}
          isStreaming
        />,
      );
      // The second running call cancels the first terminal hold before its 3s deadline.
      act(() => vi.advanceTimersByTime(1));
      expect(group).toHaveAttribute('data-state', 'open');

      rerender(
        <RuntimeToolEventGroup
          events={[
            { id: 'command-1', toolName: 'powershell', title: '执行命令', status: 'completed' },
            { id: 'read-1', toolName: 'read', title: '读取文件', status: 'completed' },
          ]}
          isStreaming
        />,
      );
      act(() => vi.advanceTimersByTime(2_999));
      expect(group).toHaveAttribute('data-state', 'open');
      act(() => vi.advanceTimersByTime(1));
      expect(group).toHaveAttribute('data-state', 'closed');
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps a contiguous tool-group identity through completion and append, then starts a new one after a boundary', () => {
    const firstToolIdentity = 'command-1:0';
    const runningGroupKey = getStableLiveToolGroupIdentity(firstToolIdentity);
    const completedGroupKey = getStableLiveToolGroupIdentity(firstToolIdentity);
    const appendedGroupKey = getStableLiveToolGroupIdentity(firstToolIdentity);
    const groupAfterTextBoundary = getStableLiveToolGroupIdentity('read-3:2');

    expect(completedGroupKey).toBe(runningGroupKey);
    expect(appendedGroupKey).toBe(runningGroupKey);
    expect(groupAfterTextBoundary).not.toBe(runningGroupKey);
  });

  test('renders non-file output as standard output and suppresses file bodies', () => {
    const { rerender } = render(
      <RuntimeToolEventCard
        tool={{
          id: 'search-1',
          toolName: 'grep',
          title: '搜索代码',
          status: 'completed',
          input: { query: 'TemplateRuntimeError' },
          result: { stdout: 'src/jinja2/exceptions.py:58' },
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /搜索代码/ }));
    expect(screen.getByText('标准输出')).toBeInTheDocument();
    expect(screen.getByText('src/jinja2/exceptions.py:58')).toBeInTheDocument();

    rerender(
      <RuntimeToolEventCard
        tool={{
          id: 'read-2',
          toolName: 'read',
          title: '读取文件',
          status: 'completed',
          input: { filePath: 'src/runtime.py' },
          result: {
            filePath: 'src/runtime.py',
            stdout: 'secret file contents must stay out of the live tool card',
          },
        }}
      />,
    );

    expect(screen.queryByText('标准输出')).not.toBeInTheDocument();
    expect(screen.queryByText('secret file contents must stay out of the live tool card')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /读取文件/ }));
    expect(screen.getByText('src/runtime.py')).toBeInTheDocument();
  });
});
