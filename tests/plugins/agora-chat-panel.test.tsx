// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AgoraChatPanel } from '@/components/collaboration/agora/AgoraChatPanel';
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
  let content: string;
  if (message.includes('输出收束总结')) {
    content = '共识：先做状态归一。\n分歧：是否先上投票。\n风险：体验和架构互相牵制。\n下一步：先重构议场状态。';
  } else if (message.includes('议场正在就议题')) {
    content = '方案A\n理由：优先保守推进。';
  } else if (message.includes('@Agent-Beta')) {
    content = `${agentName} 我先给观点，并请 @Agent-Beta 补充实现风险。`;
  } else {
    content = `${agentName} 的回复：我支持先做结构重建。`;
  }
  return {
    status: 'done' as const,
    content,
    rawContent: content,
  };
});

function createEmptyRoom(): CollaborationRoomState {
  return {
    topic: '',
    selectedAgents: [],
    mode: 'group-chat',
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
      <AgoraChatPanel
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
  await user.click(screen.getByRole('button', { name: '新增嘉宾' }));
  const input = await screen.findByPlaceholderText('例如：一辩架构师');
  await user.clear(input);
  await user.type(input, name);
  await user.click(screen.getByRole('button', { name: '添加嘉宾' }));
}

describe('built-in agora chat panel', () => {
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

  test('QuickActions does not expose agora as a plugin action', () => {
    const onAction = vi.fn();
    render(<QuickActions onAction={onAction} />);
    expect(screen.queryByText('议场')).toBeNull();
  });

  test('QuickActionsBar does not show agora as a plugin action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<QuickActionsBar onAction={onAction} />);

    await user.click(screen.getByRole('button', { name: /快捷操作/ }));
    expect(screen.queryByRole('button', { name: /议场/ })).toBeNull();
  });

  test('setup phase creates a product-style agora workspace', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('heading', { name: '创建议题' })).toBeInTheDocument();
    expect(screen.getByText('议场嘉宾')).toBeInTheDocument();
    expect(screen.getByText('暂无嘉宾')).toBeInTheDocument();
    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重构议场为产品级');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    expect(await screen.findByText('重构议场为产品级')).toBeInTheDocument();
    expect(screen.getByText('2 嘉宾')).toBeInTheDocument();
    expect(mockToast).toHaveBeenCalledWith('success', '议场已创建');
  });

  test('temporary participant is added into the left list and auto-selected', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: '新增嘉宾' }));
    const nameInput = await screen.findByPlaceholderText('例如：一辩架构师');
    await user.clear(nameInput);
    await user.type(nameInput, '反方架构师');
    const dialog = screen.getByRole('dialog', { name: '新增议场嘉宾' });
    await user.click(within(dialog).getAllByRole('combobox')[0]);
    await user.click(await screen.findByText('自定义嘉宾'));
    await user.type(
      await screen.findByPlaceholderText(/描述这个嘉宾的立场、关注点和表达方式/),
      '反方辩手，专门从风险和反例出发质疑方案。'
    );
    await user.click(screen.getByRole('button', { name: '添加嘉宾' }));

    expect(screen.getAllByText('反方架构师').length).toBeGreaterThan(0);

    await addMember(user, 'Agent-Alpha');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '临时参与者测试');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    expect(await screen.findByText('临时参与者测试')).toBeInTheDocument();
    expect(screen.getByText('2 嘉宾')).toBeInTheDocument();
  });

  test('sending a facilitated round runs agent replies and summary', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重构议场为产品级');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「重构议场为产品级」里发言/);
    await user.type(textarea, '@Agent-Alpha 先说你对架构的判断');
    await user.click(screen.getByRole('button', { name: '发送' }));

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
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    await user.click(await screen.findByRole('button', { name: '@Agent-Alpha' }));
    const textarea = screen.getByPlaceholderText(/在「测试 mention」里发言/) as HTMLTextAreaElement;
    expect(textarea.value).toContain('@Agent-Alpha');
  });

  test('vote dialog collects results and closes the active vote', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '测试投票');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    await user.click(screen.getAllByRole('button', { name: '发起投票' })[0]);
    await user.type(screen.getByPlaceholderText(/例如：议场第一优先级/), '先做哪一步？');
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
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重置议题');
    await user.click(screen.getByRole('button', { name: '创建议场' }));
    await user.click(await screen.findByRole('button', { name: '重置议题' }));

    expect(screen.getByRole('heading', { name: '创建议题' })).toBeInTheDocument();
    expect(screen.getByText('暂无嘉宾')).toBeInTheDocument();
  });
});
