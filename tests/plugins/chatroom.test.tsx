// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatroomPanel } from '@/plugins/chatroom/ChatroomPanel';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import type { CollaborationRoomState } from '@/lib/core/home-sidebar-state';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockAgents = [
  { name: 'Agent-Alpha', description: '架构师' },
  { name: 'Agent-Beta', description: '开发者' },
  { name: 'Agent-Gamma', description: '测试工程师' },
];

const mockToast = vi.fn();
const mockCallAgent = vi.fn(async (agentName: string, message: string) => {
  if (message.includes('输出收束总结')) {
    return '共识：先做状态归一。\n分歧：是否先上投票。\n风险：体验和架构互相牵制。\n下一步：先重构 chatroom 状态。';
  }
  if (message.includes('聊天室正在就议题')) {
    return '方案A\n理由：优先保守推进。';
  }
  if (message.includes('@Agent-Beta')) {
    return `${agentName} 我先给观点，并请 @Agent-Beta 补充实现风险。`;
  }
  return `${agentName} 的回复：我支持先做结构重建。`;
});

function createEmptyRoom(): CollaborationRoomState {
  return {
    topic: '',
    selectedAgents: [],
    mode: 'roundtable',
    messages: [],
    rounds: [],
    agentSessions: {},
    chatroom: null,
  };
}

function renderPanel() {
  function Harness() {
    const [room, setRoom] = React.useState<CollaborationRoomState>(createEmptyRoom());
    const updateRoom = React.useCallback((updater: (room: CollaborationRoomState) => CollaborationRoomState) => {
      setRoom((prev) => updater(prev));
    }, []);

    return (
      <ChatroomPanel
        availableAgents={mockAgents}
        room={room}
        updateRoom={updateRoom}
        callAgent={mockCallAgent}
        toast={mockToast}
      />
    );
  }

  return render(<Harness />);
}

async function addMember(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole('button', { name: '新增成员' }));
  const input = await screen.findByPlaceholderText('例如：一辩架构师');
  await user.clear(input);
  await user.type(input, name);
  await user.click(screen.getByRole('button', { name: '添加成员' }));
}

describe('chatroom plugin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.scrollTo = vi.fn();
    if (!Element.prototype.hasPointerCapture) {
      Element.prototype.hasPointerCapture = () => false;
    }
    if (!Element.prototype.setPointerCapture) {
      Element.prototype.setPointerCapture = () => {};
    }
    if (!Element.prototype.releasePointerCapture) {
      Element.prototype.releasePointerCapture = () => {};
    }
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = () => {};
    }
  });

  test('QuickActions shows chatroom action', () => {
    const onAction = vi.fn();
    render(<QuickActions onAction={onAction} />);
    expect(screen.getByText('Agent 剧场')).toBeInTheDocument();
  });

  test('QuickActionsBar shows chatroom in expanded section', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsBar onAction={onAction} />);

    expect(screen.queryByRole('button', { name: /Agent 剧场/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: /快捷操作/ }));
    expect(screen.getByRole('button', { name: /Agent 剧场/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Agent 剧场/ }));
    expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:chatroom');
  });

  test('setup phase creates a product-style chatroom workspace', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByText('安排聊天室成员')).toBeInTheDocument();
    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重构 chatroom 为产品级');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));

    expect(await screen.findByText('重构 chatroom 为产品级')).toBeInTheDocument();
    expect(screen.getByText('2 位成员')).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith('success', 'Agent 剧场已创建');
  });

  test('temporary participant is added into the left list and auto-selected', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: '新增成员' }));
    const nameInput = await screen.findByPlaceholderText('例如：一辩架构师');
    await user.clear(nameInput);
    await user.type(nameInput, '反方架构师');
    const dialog = screen.getByRole('dialog', { name: '新增聊天室成员' });
    await user.click(within(dialog).getAllByRole('combobox')[0]);
    await user.click(await screen.findByText('临时人格'));
    await user.type(
      await screen.findByPlaceholderText(/描述这个成员的立场、关注点和表达方式/),
      '反方辩手，专门从风险和反例出发质疑方案。'
    );
    await user.click(screen.getByRole('button', { name: '添加成员' }));

    expect(screen.getAllByText('反方架构师').length).toBeGreaterThan(0);

    await addMember(user, 'Agent-Alpha');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '临时参与者测试');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));

    expect(await screen.findByText('临时参与者测试')).toBeInTheDocument();
    expect(screen.getByText('2 位成员')).toBeInTheDocument();
  });

  test('sending a facilitated round runs agent replies and summary', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重构 chatroom 为产品级');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));

    const textarea = await screen.findByPlaceholderText(/输入 AI 百灵鸟/);
    await user.type(textarea, '@Agent-Alpha 先说你对架构的判断');
    await user.click(screen.getByRole('button', { name: '发起本轮' }));

    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalled();
      expect(screen.getByText(/先说你对架构的判断/)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(
        mockCallAgent.mock.calls.some(
          ([agentName, message]) => agentName === 'Agent-Alpha' && String(message).includes('输出收束总结')
        )
      ).toBe(true);
    });
  });

  test('mention buttons insert targets into the composer', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '测试 mention');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));

    await user.click(await screen.findByRole('button', { name: '@Agent-Alpha' }));
    const textarea = screen.getByPlaceholderText(/输入 AI 百灵鸟/) as HTMLTextAreaElement;
    expect(textarea.value).toContain('@Agent-Alpha');
  });

  test('vote dialog collects results and closes the active vote', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '测试投票');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));

    await user.click(screen.getByRole('button', { name: '发起投票' }));
    await user.type(screen.getByPlaceholderText(/例如：chatroom 第一优先级/), '先做哪一步？');
    await user.type(screen.getByPlaceholderText(/每行一个选项/), '方案A\n方案B');
    await user.click(screen.getByRole('button', { name: '开始投票' }));

    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalled();
      expect(screen.getByText(/投票结束：?「先做哪一步？」/)).toBeInTheDocument();
      expect(mockToast).toHaveBeenCalledWith('success', '投票完成');
    });
  });

  test('ending room returns to setup mode', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '结束房间');
    await user.click(screen.getByRole('button', { name: '创建聊天室' }));
    await user.click(await screen.findByRole('button', { name: '结束房间' }));

    expect(screen.getByText('安排聊天室成员')).toBeInTheDocument();
  });
});
