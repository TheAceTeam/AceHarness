// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatroomPanel } from '@/plugins/chatroom/ChatroomPanel';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockAgents = [
  { name: 'Agent-Alpha', description: '架构师' },
  { name: 'Agent-Beta', description: '开发者' },
  { name: 'Agent-Gamma', description: '测试工程师' },
];

const mockCallAgent = vi.fn(async (agentName: string, message: string) => {
  return `${agentName} 的回复：这是一个很好的观点，我认为我们应该继续讨论。`;
});

const mockToast = vi.fn();

describe('chatroom plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('QuickActions shows chatroom action', () => {
    const onAction = vi.fn();
    render(<QuickActions onAction={onAction} />);
    expect(screen.getByText('Agent 聊天室')).toBeInTheDocument();
  });

  test('QuickActionsBar shows chatroom in expanded section', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsBar onAction={onAction} />);

    // Not visible initially
    expect(screen.queryByRole('button', { name: /Agent 聊天室/ })).toBeNull();

    // Expand
    await user.click(screen.getByRole('button', { name: /快捷操作/ }));
    expect(screen.getByRole('button', { name: /Agent 聊天室/ })).toBeInTheDocument();

    // Click triggers correct action
    await user.click(screen.getByRole('button', { name: /Agent 聊天室/ }));
    expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:chatroom');
  });

  test('setup phase: select agents and start chatroom', async () => {
    const user = userEvent.setup();
    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Shows setup UI
    expect(screen.getByText('创建 Agent 聊天室')).toBeInTheDocument();
    expect(screen.getByText('Agent-Alpha')).toBeInTheDocument();
    expect(screen.getByText('Agent-Beta')).toBeInTheDocument();
    expect(screen.getByText('Agent-Gamma')).toBeInTheDocument();

    // Select 2 agents
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]); // Alpha
    await user.click(checkboxes[1]); // Beta
    expect(screen.getByText('已选择 2 个 Agent')).toBeInTheDocument();

    // Enter topic
    const topicInput = screen.getByPlaceholderText(/如何设计/);
    await user.type(topicInput, '微服务架构设计');

    // Start chatroom
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // Should transition to chatting phase
    expect(screen.getByText('当前话题')).toBeInTheDocument();
    expect(screen.getByText('微服务架构设计')).toBeInTheDocument();
    expect(screen.getByText('2 人')).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith('success', expect.stringContaining('聊天室已创建'));
  });

  test('chatting phase: send message and get agent responses', async () => {
    const user = userEvent.setup();
    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Setup chatroom
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.type(screen.getByPlaceholderText(/如何设计/), '测试话题');
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // Send a message
    const textarea = screen.getByPlaceholderText(/发送消息/);
    await user.type(textarea, '大家怎么看这个问题？');
    await user.click(screen.getByRole('button', { name: '发送' }));

    // Wait for agent responses (both agents should respond sequentially)
    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalled();
      expect(screen.getByText(/你：/)).toBeInTheDocument();
    });
    await waitFor(() => {
      // At least one agent responded
      expect(screen.getAllByText(/的回复/).length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });

  test('chatting phase: @mention targets specific agent', async () => {
    const user = userEvent.setup();
    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Setup
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.type(screen.getByPlaceholderText(/如何设计/), '测试');
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // Send @mention message
    const textarea = screen.getByPlaceholderText(/发送消息/);
    await user.type(textarea, '@Agent-Alpha 你怎么看？');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      // Only Alpha should respond
      expect(mockCallAgent).toHaveBeenCalledTimes(1);
      expect(mockCallAgent).toHaveBeenCalledWith('Agent-Alpha', expect.any(String));
    });
  });

  test('chatting phase: @mention buttons insert mention', async () => {
    const user = userEvent.setup();
    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Setup
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.type(screen.getByPlaceholderText(/如何设计/), '测试');
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // Click @mention button
    await user.click(screen.getByRole('button', { name: '@Agent-Alpha' }));
    const textarea = screen.getByPlaceholderText(/发送消息/) as HTMLTextAreaElement;
    expect(textarea.value).toContain('@Agent-Alpha');
  });

  test('voting: agents vote on a question', async () => {
    const user = userEvent.setup();
    // Mock agent to return a vote option
    mockCallAgent.mockImplementation(async (name, msg) => {
      if (msg.includes('选项')) return '方案A';
      return `${name} 回复`;
    });

    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Setup
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.type(screen.getByPlaceholderText(/如何设计/), '测试');
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // Mock window.prompt for vote
    const promptMock = vi.spyOn(window, 'prompt');
    promptMock.mockReturnValueOnce('用哪个方案？');
    promptMock.mockReturnValueOnce('方案A, 方案B');

    await user.click(screen.getByRole('button', { name: '发起投票' }));

    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalled();
      expect(screen.getByText(/投票结果/)).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith('success', '投票完成');
    });

    promptMock.mockRestore();
  });

  test('reset: end chatroom returns to setup', async () => {
    const user = userEvent.setup();
    render(<ChatroomPanel availableAgents={mockAgents} callAgent={mockCallAgent} toast={mockToast} />);

    // Setup and start
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);
    await user.type(screen.getByPlaceholderText(/如何设计/), '测试');
    await user.click(screen.getByRole('button', { name: /创建聊天室/ }));

    // End chatroom
    await user.click(screen.getByRole('button', { name: '结束聊天室' }));

    // Back to setup
    expect(screen.getByText('创建 Agent 聊天室')).toBeInTheDocument();
  });
});
