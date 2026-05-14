// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import HomeCommandSidebar from '@/components/chat/HomeCommandSidebar';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import { getWerewolfLabBoard, TEMP_WEREWOLF_AGENTS, TEMP_WEREWOLF_SUPERVISOR } from '@/plugins/werewolf/agents';

const mockPush = vi.fn();
const mockToast = vi.fn();
const mockSetSessionWorkbenchState = vi.fn();
const mockAppendSessionMessage = vi.fn(async () => {});
const mockAgentChat = vi.fn();
const mockStreamChat = vi.fn();
const mockListAgents = vi.fn(async () => ({ agents: [] as Array<{ name: string; description?: string; status?: string }> }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/components/ConfirmDialog', () => ({
  default: () => null,
}));

vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: vi.fn(async () => true),
    dialogProps: null,
  }),
}));

vi.mock('@/components/NewConfigModal', () => ({
  default: () => null,
}));

vi.mock('@/components/AIAgentCreatorModal', () => ({
  default: () => null,
}));

vi.mock('@/components/workflow/HumanQuestionInbox', () => ({
  default: () => null,
}));

vi.mock('@/components/ui/combobox', () => ({
  SingleCombobox: () => null,
}));

vi.mock('@/lib/core/api', () => ({
  configApi: {
    listAllConfigs: vi.fn(async () => ({ configs: [] })),
  },
  workflowApi: {
    listHumanQuestions: vi.fn(async () => ({ questions: [] })),
    getStatus: vi.fn(async () => ({ status: 'idle' })),
    answerHumanQuestion: vi.fn(async () => ({})),
    preflight: vi.fn(async () => ({ ok: true, checks: [] })),
    start: vi.fn(async () => ({})),
  },
  agentApi: {
    listAgents: () => mockListAgents(),
    chat: (...args: any[]) => mockAgentChat(...args),
    streamChat: (...args: any[]) => mockStreamChat(...args),
    saveAgent: vi.fn(async () => ({})),
    draftAgent: vi.fn(async () => ({ draft: {}, raw: '' })),
  },
}));

function createWerewolfLabState(): SessionWorkbenchState {
  return {
    homeSidebar: {
      type: 'home_sidebar',
      mode: 'active',
      activeTab: 'commander',
      tabs: ['commander'],
      intent: 'supervisor-chat',
      stage: 'running',
      summary: '多Agent能力实验室',
    },
    collaborationRoom: {
      topic: '多Agent能力实验室：AI 狼人杀',
      selectedAgents: [],
      mode: 'roundtable',
      messages: [],
      rounds: [],
      agentSessions: {},
      werewolf: {
        enabled: true,
        phase: 'setup',
        dayNumber: 1,
        players: [],
        eliminated: [],
        votes: [],
        revealedRoles: false,
      },
    },
  };
}

function MockWrapper({ children }: { children: React.ReactNode }) {
  return <div data-testid="mock-wrapper">{children}</div>;
}

function buildMockWerewolfOutput(agentName: string, payload: { message: string }) {
  // Extract first candidate from various prompt formats
  const candidateMatch = payload.message.match(/可投票对象[:：]\s*([^\n\r]+)/)?.[1]
    || payload.message.match(/请只从警上候选人中投票[:：]\s*([^\n\r]+)/)?.[1]
    || payload.message.match(/请在以下可选刀口中投票[:：]\s*([^\n\r]+)/)?.[1]
    || '';
  const firstVoteCandidate = candidateMatch
    .split('、')
    .map((item) => item.replace(/[。．]/g, '').trim())
    .filter(Boolean)[0] || TEMP_WEREWOLF_AGENTS.find((agent) => agent.name !== agentName)?.name || '';
  const isVote = payload.message.includes('可选刀口') || payload.message.includes('可投票对象') || payload.message.includes('警上候选人中投票');
  const isSheriffSpeech = payload.message.includes('警长竞选发言');
  if (isSheriffSpeech) {
    return `${agentName} 我觉得我适合拿警徽，场上形势需要一个稳定的归票位。\n\n<result>{"action":"stay"}</result>`;
  }
  if (isVote) {
    const action = payload.message.includes('可选刀口') ? 'wolf-vote'
      : payload.message.includes('警上候选人中投票') ? 'sheriff-vote'
      : 'day-vote';
    return `${agentName} mock vote speech\n\n<result>{"action":"${action}","target":"${firstVoteCandidate}","reason":"${agentName} mock reason"}</result>`;
  }
  return `${agentName} mock speech @${firstVoteCandidate}`;
}

function createMockAgentStream(output: string, sessionId: string) {
  const listeners = new Map<string, EventListener[]>();
  let doneScheduled = false;
  const scheduleDone = () => {
    if (doneScheduled) return;
    doneScheduled = true;
    window.setTimeout(() => {
      const doneEvent = new MessageEvent('done', {
        data: JSON.stringify({
          output,
          sessionId,
          engine: 'mock-wrapper',
          model: 'mock-agent',
          isError: false,
        }),
      });
      for (const listener of listeners.get('done') || []) {
        listener(doneEvent);
      }
    }, 0);
  };
  const events = {
    onerror: null as EventListener | null,
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const current = listeners.get(type) || [];
      listeners.set(type, [...current, listener]);
      if (type === 'done') scheduleDone();
    }),
    close: vi.fn(),
  };

  return { events };
}

function renderHomeCommandSidebar(state = createWerewolfLabState()) {
  const renderComponent = (
    sessionWorkbenchState: SessionWorkbenchState,
    setSessionWorkbenchState: (next: any) => void,
  ) => (
    <HomeCommandSidebar
      engine="mock-wrapper"
      model="mock-agent"
      onQuickPrompt={vi.fn()}
      activeSessionId="werewolf-session"
      ensureSessionId={() => 'werewolf-session'}
      activeSession={{ id: 'werewolf-session', messages: [] }}
      sessionWorkbenchState={sessionWorkbenchState}
      setSessionWorkbenchState={setSessionWorkbenchState}
      appendSessionMessage={mockAppendSessionMessage}
      sidebarHint={sessionWorkbenchState.homeSidebar || null}
      activeTab="commander"
      availableTabs={['commander']}
      onTabChange={vi.fn()}
      expanded
      onCollapse={vi.fn()}
      onExpand={vi.fn()}
    />
  );

  function Harness() {
    const [sessionWorkbenchState, setSessionWorkbenchState] = React.useState(state);
    const handleSetSessionWorkbenchState = React.useCallback((next: any) => {
      mockSetSessionWorkbenchState(next);
      setSessionWorkbenchState((prev) => (typeof next === 'function' ? next(prev) : next));
    }, []);

    return (
      <MockWrapper>
        {renderComponent(sessionWorkbenchState, handleSetSessionWorkbenchState)}
      </MockWrapper>
    );
  }

  return render(<Harness />);
}

function querySupervisorActionButton(): HTMLButtonElement | null {
  return screen.queryAllByRole('button').find((button) => {
    const label = button.textContent?.trim() || '';
    return /^Supervisor /.test(label) && !label.includes('全流程自动推进');
  }) as HTMLButtonElement | null;
}

describe('multi-agent werewolf lab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgents.mockResolvedValue({ agents: [] });
    mockAgentChat.mockImplementation(async (agentName: string, payload: { message: string }) => {
      return {
        output: buildMockWerewolfOutput(agentName, payload),
        sessionId: `mock-session-${agentName}`,
        engine: 'mock-wrapper',
        model: 'mock-agent',
        isError: false,
      };
    });
    mockStreamChat.mockImplementation(async (agentName: string, payload: { message: string }) => (
      createMockAgentStream(buildMockWerewolfOutput(agentName, payload), `mock-session-${agentName}`)
    ));
    mockAppendSessionMessage.mockResolvedValue(undefined);
  });

  test('QuickActions exposes the AI werewolf lab action', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MockWrapper>
        <QuickActions onAction={onAction} />
      </MockWrapper>
    );

    expect(screen.getByText('多Agent能力实验室')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /AI 狼人杀/ }));

    expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:werewolf_lab');
  });

  test('werewolf boards use one seer and common special-role presets', () => {
    const defaultBoard = getWerewolfLabBoard();
    expect(defaultBoard.name).toBe('预女猎');
    expect(defaultBoard.roleDeck.filter((role) => role === 'seer')).toHaveLength(1);
    expect(defaultBoard.roleDeck).toEqual([
      'werewolf',
      'werewolf',
      'werewolf',
      'seer',
      'witch',
      'hunter',
      'villager',
      'villager',
      'villager',
    ]);
  });

  test('QuickActionsBar keeps AI werewolf under expanded actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MockWrapper>
        <QuickActionsBar onAction={onAction} />
      </MockWrapper>
    );

    expect(screen.getByRole('button', { name: /创建工作流/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建 Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /AI 狼人杀/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /快捷操作/ }));

    await user.click(screen.getByRole('button', { name: /AI 狼人杀/ }));
    expect(onAction).toHaveBeenCalledWith('__HOME_ACTION__:werewolf_lab');
  });

  test('HomeCommandSidebar runs werewolf speech and vote with built-in temporary agents', async () => {
    const user = userEvent.setup();
    mockListAgents.mockResolvedValue({
      agents: [
        { name: 'business-agent-alpha', description: 'real workflow agent', status: 'idle' },
        { name: 'business-agent-beta', description: 'real workflow agent', status: 'idle' },
      ],
    });
    renderHomeCommandSidebar();

    await waitFor(() => {
      expect(screen.getAllByText(TEMP_WEREWOLF_AGENTS[0].name).length).toBeGreaterThan(0);
    expect(screen.getByText(/请选择板子，系统会随机选择参与人格并分配身份/)).toBeInTheDocument();
    });
    expect(screen.queryByText('参与 Agent（临时人格）')).toBeNull();
    expect(screen.queryByRole('button', { name: '全选' })).toBeNull();
    expect(screen.getByText('随机角色')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新随机' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '按 @ 发起圆桌' })).toBeNull();
    expect(screen.queryByText('主持人消息')).toBeNull();
    expect(screen.queryByRole('button', { name: '点名发言' })).toBeNull();
    expect(screen.getByRole('button', { name: '全流程自动推进' })).toBeInTheDocument();
    expect(screen.getByText(/规则：屠边/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '黑夜视角' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上帝视角' })).toBeInTheDocument();
    expect(screen.getByText('选择绑定玩家')).toBeInTheDocument();
    expect(screen.getByDisplayValue('未绑定，只看公开信息')).toBeInTheDocument();
    expect(screen.queryByText('当前对话上下文')).toBeNull();
    expect(screen.queryByText('当前指挥官')).toBeNull();
    expect(screen.queryByText('工作流状态')).toBeNull();
    expect(screen.queryByText('最近汇报')).toBeNull();
    expect(screen.getByText('板子')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /角色图鉴/ }));
    expect(screen.getByRole('heading', { name: '狼人杀角色图鉴' })).toBeInTheDocument();
    expect(screen.getByText('预言家')).toBeInTheDocument();
    expect(screen.getByText('女巫')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '狼人杀角色图鉴' })).toBeNull();
    });
    expect(screen.getByRole('button', { name: '确认角色并开局' })).toBeInTheDocument();
    expect(screen.queryByText(TEMP_WEREWOLF_SUPERVISOR.name)).toBeNull();
    expect(screen.queryByText('最近讨论')).toBeNull();
    expect(screen.queryByText(/还没有对局记录/)).toBeNull();
    expect(screen.queryByText('business-agent-alpha')).toBeNull();
    expect(screen.queryByText('business-agent-beta')).toBeNull();

    await user.click(screen.getByRole('button', { name: '确认角色并开局' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Supervisor 推进第 1 夜/ })).toBeInTheDocument();
      expect(screen.getByText('1 条')).toBeInTheDocument();
    });
    expect(mockAppendSessionMessage).toHaveBeenCalledWith(
      'werewolf-session',
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('本局已完成配置'),
        cards: expect.arrayContaining([expect.objectContaining({ type: 'werewolf_speech' })]),
      })
    );
    expect(screen.getByText('人工介入')).toBeInTheDocument();
    const interventionInput = screen.getByPlaceholderText(/写给 Supervisor 的补充指令/);
    expect(interventionInput).toBeInTheDocument();
    expect(screen.queryByText(/黑夜视角绑定：/)).toBeNull();
    expect(screen.getByText('当前环节')).toBeInTheDocument();
    expect(screen.getByText('正在行动')).toBeInTheDocument();
    expect(screen.getByText('存活情况')).toBeInTheDocument();
    expect(screen.getAllByText(/身份：/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/身份：隐藏/).length).toBeGreaterThan(0);
    const viewerSelect = screen.getByDisplayValue('未绑定，只看公开信息');
    const firstRenderedAgent = TEMP_WEREWOLF_AGENTS.find((agent) => screen.queryAllByText(agent.name).length > 0);
    expect(firstRenderedAgent).toBeTruthy();
    await user.selectOptions(viewerSelect, firstRenderedAgent!.name);
    expect(screen.getByText(/黑夜视角绑定：/)).toBeInTheDocument();
    expect(TEMP_WEREWOLF_AGENTS.some((agent) => screen.queryAllByText(agent.name).length > 0)).toBe(true);
    expect(screen.getAllByText(/身份：/).length).toBeGreaterThan(0);

    await user.type(interventionInput, '@');
    expect(screen.getByText('@ 提示')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@全员' })).toBeInTheDocument();
    const suggestedPlayer = TEMP_WEREWOLF_AGENTS.find((agent) => screen.queryByRole('button', { name: `@${agent.name}` }));
    expect(suggestedPlayer).toBeTruthy();
    await user.click(screen.getByRole('button', { name: `@${suggestedPlayer!.name}` }));
    expect(interventionInput).toHaveValue(`@${suggestedPlayer!.name} `);

    await user.click(screen.getByRole('button', { name: '上帝视角' }));
    expect(screen.getByText(/上帝视角会显示所有身份/)).toBeInTheDocument();
    expect(screen.getAllByText(/身份：(?!隐藏)/).length).toBeGreaterThan(0);
    expect(screen.getByText(/存活 \d+\/\d+：.*\(.+\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Supervisor 推进第 1 夜/ }));

    await user.click(screen.getByRole('button', { name: '上帝视角' }));
    await waitFor(() => {
      expect(mockStreamChat).toHaveBeenCalled();
      expect(mockStreamChat.mock.calls.some(([agentName, payload]) => (
        TEMP_WEREWOLF_AGENTS.some((agent) => agent.name === agentName)
        && payload?.temporaryRoleConfig?.tags?.includes('werewolf-lab')
        && payload?.sessionId === undefined
      ))).toBe(true);
      expect(mockAppendSessionMessage).toHaveBeenCalledWith(
        'werewolf-session',
        expect.objectContaining({
          role: 'assistant',
          cards: expect.arrayContaining([expect.objectContaining({ type: 'werewolf_speech' })]),
        })
      );
      expect(mockAppendSessionMessage).toHaveBeenCalledWith(
        'werewolf-session',
        expect.objectContaining({
          content: expect.stringContaining('女巫首夜可以自救'),
        })
      );
      expect(querySupervisorActionButton()).toBeTruthy();
    });

    const afterNightButton = querySupervisorActionButton();
    expect(afterNightButton).toBeTruthy();
    await user.click(afterNightButton!);

    await waitFor(() => {
      expect(querySupervisorActionButton()).toBeTruthy();
    });

    const sheriffButton = screen.queryByRole('button', { name: 'Supervisor 组织警长竞选' });
    if (sheriffButton) {
      await user.click(sheriffButton);
      await waitFor(() => {
        expect(screen.getByText(/警长投票完成|警长投票结束|警长竞选结束/)).toBeInTheDocument();
        expect(screen.getByText(/警长 \/ 警徽/)).toBeInTheDocument();
      });
    }

    const maybeNextNightButton = screen.queryByRole('button', { name: /Supervisor 推进第 2 夜/ });
    if (maybeNextNightButton) {
      await user.click(maybeNextNightButton);
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: 'Supervisor 组织警长竞选' })
            || screen.queryByRole('button', { name: /Supervisor 推进第 2 天发言/ })
            || screen.queryByRole('button', { name: 'Supervisor 处理猎人技能' })
            || screen.queryByRole('button', { name: 'Supervisor 处理死后遗言' })
        ).toBeTruthy();
      });
    }

    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: 'Supervisor 处理死后遗言' })
          || screen.queryByRole('button', { name: 'Supervisor 处理猎人技能' })
          || screen.queryByRole('button', { name: /Supervisor 推进第 \d+ 天发言/ })
      ).toBeTruthy();
    });

    const lastWordsButton = screen.queryByRole('button', { name: 'Supervisor 处理死后遗言' })
      || screen.queryByRole('button', { name: 'Supervisor 处理猎人技能' });
    if (lastWordsButton) {
      await user.click(lastWordsButton);
    }

    const speechButton = screen.queryByRole('button', { name: /Supervisor 推进第 \d+ 天发言/ });
    if (speechButton) {
      await user.click(speechButton);
    }

    for (let step = 0; step < 6; step += 1) {
      const hasVoteSummary = mockAppendSessionMessage.mock.calls.some((call: any[]) =>
        typeof call[1]?.content === 'string' && call[1].content.includes('投票结果')
      );
      if (hasVoteSummary) break;
      await waitFor(() => {
        expect(querySupervisorActionButton()).toBeTruthy();
      });
      await user.click(querySupervisorActionButton()!);
    }

    await waitFor(() => {
      expect(mockAppendSessionMessage.mock.calls.some((call: any[]) => (
        call[0] === 'werewolf-session'
        && typeof call[1]?.content === 'string'
        && call[1].content.includes('投票结果')
      ))).toBe(true);
    });
    await waitFor(() => {
      // Verify votes were stored via setSessionWorkbenchState calls
      const calls = mockSetSessionWorkbenchState.mock.calls;
      const hasVotes = calls.some((call) => {
        const arg = call[0];
        if (typeof arg === 'function') return false; // can't easily evaluate updater functions
        return (arg?.collaborationRoom?.werewolf?.votes?.length || 0) > 0;
      });
      // If updater functions are used, check the final rendered state has votes
      // by verifying the vote summary message was sent
      expect(hasVotes || mockAppendSessionMessage.mock.calls.some((call: any[]) =>
        typeof call[1]?.content === 'string' && call[1].content.includes('票型统计')
      )).toBe(true);
      expect(mockStreamChat.mock.calls.length).toBeGreaterThan(1);
      expect(mockStreamChat.mock.calls.some(([, payload]) => (
        payload?.frontendSessionId === 'werewolf-session'
        && payload?.temporaryRoleConfig?.tags?.includes('werewolf-lab')
      ))).toBe(true);
    });
  });
});
