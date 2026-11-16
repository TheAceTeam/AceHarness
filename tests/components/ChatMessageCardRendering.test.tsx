// @vitest-environment jsdom
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ChatMessage from '@/components/chat/ChatMessage';
import { formatAceReasoning } from '@/lib/chat/ace-process-formatters';

const noop = () => {};

function renderAssistantCard(card: any) {
  return render(
    <ChatMessage
      message={{
        id: 'assistant-card',
        role: 'assistant',
        content: '',
        cards: [card],
      }}
      onConfirmAction={noop}
      onRejectAction={noop}
      onUndoAction={noop}
      onRetryAction={noop}
    />
  );
}

describe('ChatMessage card rendering', () => {
  test('shows the adapter tag above the reply and keeps thought text in the reasoning panel', () => {
    const props = {
      onConfirmAction: noop,
      onRejectAction: noop,
      onUndoAction: noop,
      onRetryAction: noop,
    };
    const message = { id: 'claude-reply', role: 'assistant' as const, content: '' };
    const { rerender } = render(
      <ChatMessage
        {...props}
        isStreaming
        message={{ ...message, adapterStatus: { agentName: 'Claude', phase: 'preparing' } }}
      />
    );
    expect(screen.getByText('首次对话，正在准备 Claude 适配器')).toBeInTheDocument();
    expect(screen.queryByText('思考中')).not.toBeInTheDocument();

    rerender(
      <ChatMessage
        {...props}
        message={{
          ...message,
          content: '你好！',
          rawContent: `你好！${formatAceReasoning('内部思考片段')}`,
          adapterStatus: { agentName: 'Claude', phase: 'ready' },
        }}
      />
    );
    const tag = screen.getByText('Claude 适配器已准备完成');
    const response = screen.getByText('你好！');
    expect(tag.compareDocumentPosition(response) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('首次对话，正在准备 Claude 适配器')).not.toBeInTheDocument();
    expect(screen.getByTestId('ace-reasoning')).toBeInTheDocument();
    expect(screen.queryByText('你好！内部思考片段')).not.toBeInTheDocument();
  });

  test('renders shorthand table cards returned by assistant results', () => {
    renderAssistantCard({
      header: {
        title: '本次运行新增 Cangjie 用例分析',
        subtitle: 'run-1780903263120-04c3715e',
      },
      blocks: [
        {
          type: 'table',
          columns: ['项目', '结论'],
          rows: [
            ['运行状态', 'completed'],
            ['主要风险', '无 ASSERT/SCAN，仅验证编译通过'],
          ],
        },
      ],
    });

    const table = screen.getByTestId('universal-card-table');
    expect(within(table).getByText('项目')).toBeInTheDocument();
    expect(within(table).getByText('结论')).toBeInTheDocument();
    expect(within(table).getAllByText('运行状态').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText('completed')).toBeInTheDocument();
    expect(screen.queryByTestId('universal-card-render-fallback')).not.toBeInTheDocument();
  });

  test('keeps the chat page alive when an individual card block throws while rendering', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const preventWindowError = (event: ErrorEvent) => {
      event.preventDefault();
    };
    window.addEventListener('error', preventWindowError);

    try {
      renderAssistantCard({
        header: { title: '坏卡片' },
        blocks: [
          {
            type: 'tabs',
          },
        ],
      });

      expect(screen.getByTestId('universal-card-render-fallback')).toBeInTheDocument();
      expect(screen.getByText('卡片渲染失败，已显示原始数据预览。')).toBeInTheDocument();
    } finally {
      window.removeEventListener('error', preventWindowError);
      consoleError.mockRestore();
    }
  });
});
