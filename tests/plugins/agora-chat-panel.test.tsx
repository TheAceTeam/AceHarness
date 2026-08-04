// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { AgoraChatPanel } from '@/components/collaboration/agora/AgoraChatPanel';
import { CollaborationRoomSurface } from '@/components/collaboration/CollaborationRoomSurface';
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
function buildAgoraResultEnvelope(payload: Record<string, unknown>) {
  return `<result>${JSON.stringify({ kind: 'agora_result', payload })}</result>`;
}

function wrapAceProcessBlock(kind: string, payload: Record<string, unknown>, body = '') {
  return `<ace-process>${JSON.stringify({ kind, ...payload, body })}</ace-process>`;
}

const mockCallAgent = vi.fn(async (agentName: string, message: string) => {
  let payload: Record<string, unknown>;
  if (message.includes('输出收束总结')) {
    payload = {
      type: 'summary',
      title: '本轮总结',
      content: '共识：先做状态归一。\n分歧：是否先上投票。\n风险：体验和架构互相牵制。\n下一步：先重构议场状态。',
    };
  } else if (message.includes('议场正在就议题')) {
    payload = {
      type: 'vote',
      content: '方案A\n理由：优先保守推进。',
      choice: '方案A',
      reason: '优先保守推进。',
    };
  } else if (agentName === 'Agent-Alpha' && (message.includes('@Agent-Beta') || message.includes('先说你对架构的判断'))) {
    payload = {
      type: 'speech',
      content: `${agentName} 我先给观点，并请 @Agent-Beta 补充实现风险。`,
      mentions: ['Agent-Beta'],
    };
  } else {
    payload = {
      type: 'speech',
      content: `${agentName} 的回复：我支持先做结构重建。`,
      mentions: [],
    };
  }
  const content = buildAgoraResultEnvelope(payload);
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
  return renderPanelWithCallAgent(mockCallAgent);
}

function renderPanelWithCallAgent(
  callAgent = mockCallAgent,
  options?: {
    currentUser?: {
      username?: string;
      email?: string;
      avatar?: string;
      name?: string;
      nickname?: string;
      displayName?: string;
    } | null;
  }
) {
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
        currentUser={options?.currentUser || null}
        callAgent={callAgent}
        toast={mockToast}
      />
    );
  }

  return renderWithQuery(<Harness />);
}

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {ui}
    </QueryClientProvider>,
  );
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
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/models')) {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/engine/availability')) {
        return new Response(JSON.stringify({ available: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/api/engine')) {
        return new Response(JSON.stringify({ engine: 'codex', driver: 'stdio', defaultModel: '' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
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

  test('sending a user-led round runs only the selected agent replies and summary', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '重构议场为产品级');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「重构议场为产品级」里发言/);
    await user.type(textarea, '@Agent-Alpha 先说你对架构的判断，@Agent-Beta 再补充实现风险');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalledTimes(3);
      expect(screen.getByText(/先说你对架构的判断/)).toBeInTheDocument();
    });

    expect(mockCallAgent.mock.calls.map(([agentName]) => agentName)).toEqual([
      'Agent-Alpha',
      'Agent-Beta',
      'Agent-Alpha',
    ]);
    expect(
      mockCallAgent.mock.calls.some(
        ([agentName, message]) => agentName === 'Agent-Alpha' && String(message).includes('输出收束总结')
      )
    ).toBe(true);
  });

  test('agent mentions can trigger one follow-up guest reply', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '只让一个嘉宾回复');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「只让一个嘉宾回复」里发言/);
    await user.type(textarea, '@Agent-Alpha 先说你对架构的判断');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(mockCallAgent).toHaveBeenCalledTimes(3);
    });

    expect(mockCallAgent.mock.calls.map(([agentName]) => agentName)).toEqual([
      'Agent-Alpha',
      'Agent-Beta',
      'Agent-Alpha',
    ]);
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

  test('mention suggestion menu inserts the selected target into the composer', async () => {
    const user = userEvent.setup();
    renderPanel();

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), '测试 mention 菜单');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「测试 mention 菜单」里发言/) as HTMLTextAreaElement;
    await user.type(textarea, '@A');

    const mentionButtons = await screen.findAllByRole('button', { name: '@Agent-Alpha' });
    expect(mentionButtons.length).toBeGreaterThan(0);
    await user.click(mentionButtons[mentionButtons.length - 1]!);

    expect(textarea.value).toBe('@Agent-Alpha ');
  });

  test('channel composer sends with Enter and keeps Shift+Enter as newline', async () => {
    const user = userEvent.setup();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();
    const onSubmit = vi.fn();

    function Harness() {
      const [draft, setDraft] = React.useState('');
      return (
        <CollaborationRoomSurface
          messages={[]}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={onSubmit}
          submitLabel="发送"
          placeholder="在工作流协作里发言"
          mentionTargets={['Agent-Alpha']}
          onInsertMention={(value) => setDraft((prev) => `${prev}${value}`)}
          inputRef={inputRef}
          bottomRef={bottomRef}
          getSpeakerAvatarSrc={() => ''}
          getInitials={(name) => name.slice(0, 1)}
          getMessageKindLabel={() => '议场发言'}
          variant="channel"
        />
      );
    }

    render(<Harness />);

    const textarea = screen.getByPlaceholderText('在工作流协作里发言') as HTMLTextAreaElement;
    await user.type(textarea, '第一行');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textarea, '第二行');
    expect(textarea.value).toBe('第一行\n第二行');
    expect(onSubmit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test('channel composer shows a dropdown mention menu and inserts the selected target', async () => {
    const user = userEvent.setup();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();

    function Harness() {
      const [draft, setDraft] = React.useState('');
      return (
        <CollaborationRoomSurface
          messages={[]}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={() => {}}
          submitLabel="发送"
          placeholder="在工作流协作里发言"
          mentionTargets={['Agent-Alpha', 'Agent-Beta']}
          onInsertMention={(value) => setDraft((prev) => `${prev}${value}`)}
          inputRef={inputRef}
          bottomRef={bottomRef}
          getSpeakerAvatarSrc={() => ''}
          getInitials={(name) => name.slice(0, 1)}
          getMessageKindLabel={() => '议场发言'}
          variant="channel"
        />
      );
    }

    render(<Harness />);

    const textarea = screen.getByPlaceholderText('在工作流协作里发言') as HTMLTextAreaElement;
    await user.type(textarea, '@A');

    const option = await screen.findByRole('button', { name: '@Agent-Alpha' });
    expect(option).toBeInTheDocument();
    await user.click(option);

    expect(textarea.value).toBe('@Agent-Alpha ');
  });

  test('pending room message renders reasoning and collapsed result-generation panel from raw stream content', async () => {
    const user = userEvent.setup();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();
    const rawContent = [
      wrapAceProcessBlock('reasoning', {}, '我先梳理一下主要风险。'),
      wrapAceProcessBlock('tool-call', { toolName: 'read', title: '📖 读取文件', filePath: 'C:\\demo\\plan.md', toolId: 'tool-read-1' }),
      wrapAceProcessBlock('tool-result', { toolName: 'read', title: '📖 读取文件', output: '1: 风险一\n2: 风险二', toolId: 'tool-read-1' }),
      '<result>{"kind":"agora_result","payload":{"type":"speech","content":"正在整理最终发言',
    ].join('\n\n');

    render(
      <CollaborationRoomSurface
        messages={[{
          id: 'pending-agora-message',
          createdAt: Date.now(),
          speakerType: 'agent',
          speakerName: 'Agent-Alpha',
          content: '发言中',
          rawContent,
          status: 'pending',
        }]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    expect(document.querySelector('[data-testid="ace-reasoning"]')).toBeTruthy();
    expect((document.querySelector('[data-testid="ace-reasoning"] button[aria-expanded]') as HTMLButtonElement | null)?.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('agora-streaming-result-panel')).toBeInTheDocument();
    expect(screen.getByText('Agent-Alpha正在组织最后的发言…')).toBeInTheDocument();
    expect(screen.getByText('展开查看草稿')).toBeInTheDocument();
    expect(screen.queryByText(/正在整理最终发言/)).toBeNull();

    await user.click(screen.getByRole('button', { name: '展开查看草稿' }));
    expect(screen.getByText(/正在整理最终发言/)).toBeInTheDocument();
  });

  test('agora panel uses rawContent envelope for final structured result parsing', async () => {
    const user = userEvent.setup();
    const envelopeOnlyCallAgent = vi.fn(async (agentName: string, message: string) => {
      let payload: Record<string, unknown>;
      if (message.includes('输出收束总结')) {
        payload = {
          type: 'summary',
          title: '本轮总结',
          content: '共识：先做状态归一。\n分歧：是否先上投票。\n风险：体验和架构互相牵制。\n下一步：先重构议场状态。',
        };
      } else {
        payload = {
          type: 'speech',
          content: `${agentName} 的回复：我支持先做结构重建。`,
          mentions: [],
        };
      }
      const rawContent = [
        wrapAceProcessBlock('reasoning', {}, '我先衡量一下约束。'),
        buildAgoraResultEnvelope(payload),
      ].join('\n\n');
      return {
        status: 'done' as const,
        content: String(payload.content || ''),
        rawContent,
      };
    });

    renderPanelWithCallAgent(envelopeOnlyCallAgent);

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), 'rawContent envelope test');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「rawContent envelope test」里发言/);
    await user.type(textarea, '@Agent-Alpha 先说你对架构的判断');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(screen.getByTestId('agora-final-result-content')).toBeInTheDocument();
    });

    expect(document.body.textContent || '').toContain('我支持先做结构重建');
    expect(screen.getByRole('button', { name: '查看完整内容' })).toBeInTheDocument();
    expect(screen.queryByText('我先衡量一下约束。')).toBeNull();

    await user.click(screen.getByRole('button', { name: '查看完整内容' }));
    expect(screen.getByTestId('agora-complete-raw-panel')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="ace-reasoning"]')).toBeTruthy();

    expect(screen.queryByText('回复缺少 <result>...</result>，议场最终发言必须通过结果块输出。')).toBeNull();
  });

  test('sending a new agora message stops an active agent stream first', async () => {
    const user = userEvent.setup();
    const sequence: string[] = [];
    const streamingCallAgent = vi.fn((agentName: string, _message: string, _roundId?: string, _messagePatch?: any, _temporaryRoleConfig?: any, lifecycle?: any) => {
      sequence.push(`call:${agentName}`);
      if (sequence.filter((item) => item.startsWith('call:')).length === 1) {
        return new Promise<any>((resolve) => {
          lifecycle?.onStreamStart?.({
            streamId: 'stream-first',
            runtimeName: agentName,
            stop: vi.fn(async () => {
              sequence.push(`stop:${agentName}`);
              resolve({ status: 'stopped', content: '已停止', rawContent: '' });
            }),
          });
          lifecycle?.onDelta?.('正在思考', '正在思考');
        });
      }
      const content = buildAgoraResultEnvelope({
        type: 'speech',
        content: `${agentName} 的新回复`,
        mentions: [],
      });
      lifecycle?.onStreamStart?.({
        streamId: 'stream-second',
        runtimeName: agentName,
        stop: vi.fn(),
      });
      return Promise.resolve({ status: 'done' as const, content, rawContent: content });
    });

    renderPanelWithCallAgent(streamingCallAgent);

    await addMember(user, 'Agent-Alpha');
    await addMember(user, 'Agent-Beta');
    await user.type(screen.getByPlaceholderText(/例如：是否将上下文工作台升级为正式协作能力/), 'stop before next');
    await user.click(screen.getByRole('button', { name: '创建议场' }));

    const textarea = await screen.findByPlaceholderText(/在「stop before next」里发言/);
    await user.type(textarea, '@Agent-Alpha 第一条');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(streamingCallAgent).toHaveBeenCalledTimes(1));

    await user.type(textarea, '@Agent-Alpha 第二条');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(streamingCallAgent).toHaveBeenCalledTimes(2));
    expect(sequence.slice(0, 3)).toEqual(['call:Agent-Alpha', 'stop:Agent-Alpha', 'call:Agent-Alpha']);
    expect(document.body.textContent || '').toContain('已停止');
    expect(document.body.textContent || '').toContain('Agent-Alpha 的新回复');
  });

  test('completed structured process panel keeps older details available after appending new messages', async () => {
    const user = userEvent.setup();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();
    const firstMessage = {
      id: 'older-agent-message',
      createdAt: Date.now(),
      speakerType: 'agent' as const,
      speakerName: 'Agent-Alpha',
      content: '这是最终发言',
      rawContent: [
        wrapAceProcessBlock('reasoning', {}, '我先把这件事拆一下。'),
        buildAgoraResultEnvelope({ type: 'speech', content: '这是最终发言', mentions: [] }),
      ].join('\n\n'),
      status: 'done' as const,
    };

    const { rerender } = render(
      <CollaborationRoomSurface
        messages={[firstMessage]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    await user.click(screen.getByRole('button', { name: '查看完整内容' }));
    expect(document.querySelector('[data-testid="ace-reasoning"]')).toBeTruthy();

    rerender(
      <CollaborationRoomSurface
        messages={[
          firstMessage,
          {
            id: 'new-human-message',
            createdAt: Date.now() + 1,
            speakerType: 'human',
            speakerName: '你',
            content: '补一条新消息',
            rawContent: '补一条新消息',
            status: 'done',
          },
        ]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    expect(screen.getByTestId('agora-complete-raw-panel')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="ace-reasoning"]')).toBeTruthy();
  });

  test('structured result without extra process details does not render an empty expand panel', () => {
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();

    render(
      <CollaborationRoomSurface
        messages={[{
          id: 'result-only-agent-message',
          createdAt: Date.now(),
          speakerType: 'agent',
          speakerName: 'Agent-Alpha',
          content: '只有最终发言',
          rawContent: `<!-- timestamp: 2026-08-04T02:47:14.626Z -->\n${buildAgoraResultEnvelope({ type: 'speech', content: '只有最终发言', mentions: [] })}`,
          status: 'done',
        }]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    expect(screen.queryByRole('button', { name: '查看完整内容' })).toBeNull();
  });

  test('workflow Agora keeps the extracted speech separate from its complete agent transcript', async () => {
    const user = userEvent.setup();
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();
    const rawContent = [
      '<!-- timestamp: 2026-08-04T02:47:14.626Z -->',
      wrapAceProcessBlock('reasoning', {}, '先核对仓库状态和远端连接。'),
      '<result>{"kind":"workflow_control","payload":{"status":"complete"}}</result>',
    ].join('\n\n');

    render(
      <CollaborationRoomSurface
        messages={[{
          id: 'workflow-review-message',
          createdAt: Date.now(),
          speakerType: 'supervisor',
          speakerName: 'developer',
          content: '远端连接与模板内容已确认一致。',
          rawContent,
          status: 'done',
        }]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    expect(screen.getByText('远端连接与模板内容已确认一致。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看完整内容' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看完整内容' }));
    expect(document.querySelector('[data-testid="ace-reasoning"]')).toBeTruthy();
  });

  test('error messages render the diagnostic content instead of stale raw content', () => {
    const inputRef = React.createRef<HTMLTextAreaElement>();
    const bottomRef = React.createRef<HTMLDivElement>();

    render(
      <CollaborationRoomSurface
        messages={[{
          id: 'diagnostic-error-message',
          createdAt: Date.now(),
          speakerType: 'agent',
          speakerName: 'Agent-Alpha',
          content: '来源：API 提供商响应\n阶段：execution-finalize\n原始错误：HTTP 403 Forbidden',
          rawContent: '旧的部分输出',
          status: 'error',
        }]}
        draft=""
        onDraftChange={() => {}}
        onSubmit={() => {}}
        submitLabel="发送"
        placeholder="在议场发言"
        mentionTargets={[]}
        onInsertMention={() => {}}
        inputRef={inputRef}
        bottomRef={bottomRef}
        getSpeakerAvatarSrc={() => ''}
        getInitials={(name) => name.slice(0, 1)}
        getMessageKindLabel={() => '议场发言'}
      />
    );

    expect(screen.getByText(/来源：API 提供商响应/)).toBeInTheDocument();
    expect(screen.queryByText('旧的部分输出')).toBeNull();
  });

  test('agora panel uses the custom user avatar for older human messages matched by username alias', async () => {
    const runningRoom: CollaborationRoomState = {
      topic: '头像匹配测试',
      selectedAgents: ['Agent-Alpha'],
      mode: 'group-chat',
      messages: [{
        id: 'existing-human-message',
        createdAt: Date.now(),
        speakerType: 'human',
        speakerName: 'zichexuelan',
        content: '这是一条测试消息',
        rawContent: '这是一条测试消息',
        status: 'done',
        chatroom: {
          kind: 'host',
          mode: 'mention-driven',
          mentions: [],
          participants: ['Agent-Alpha'],
        },
      }],
      rounds: [],
      agentSessions: {},
      chatroom: {
        status: 'running',
        topic: '头像匹配测试',
        participants: ['Agent-Alpha'],
        facilitator: undefined,
        rounds: [],
        voteHistory: [],
        summaries: [],
        activeVote: null,
        participantRoster: [{
          id: 'participant-agent-alpha',
          name: 'Agent-Alpha',
          sourceType: 'agent',
          sourceAgent: 'Agent-Alpha',
          runtimeAgentName: 'Agent-Alpha',
          useDefaultModel: true,
          createdAt: Date.now(),
        }],
        temporaryAgents: [],
        settings: {
          responseMode: 'mention-driven',
          maxTurnsPerRound: 2,
          maxRepliesPerAgent: 1,
          autoSummarize: true,
          defaultEngine: '',
          defaultModel: '',
          defaultRuntimeMode: 'inherit',
          agentOverrides: {},
          workspacePath: '',
        },
      },
    };

    function Harness() {
      const [room, setRoom] = React.useState<CollaborationRoomState>(runningRoom);
      const updateRoom = React.useCallback((updater: (room: CollaborationRoomState) => CollaborationRoomState) => {
        setRoom((prev) => updater(prev));
      }, []);

      return (
        <AgoraChatPanel
          availableAgents={mockAgents}
          room={room}
          updateRoom={updateRoom}
          layout="workspace"
          currentUser={{
            username: 'zichexuelan',
            displayName: '子车雪岚',
            avatar: '/uploads/images/custom-user-avatar.png',
          }}
          callAgent={mockCallAgent}
          toast={mockToast}
        />
      );
    }

    renderWithQuery(<Harness />);

    await waitFor(() => {
      const avatars = Array.from(document.querySelectorAll('img')) as HTMLImageElement[];
      expect(avatars.some((avatar) => String(avatar.getAttribute('src') || avatar.src || '').includes('/uploads/images/custom-user-avatar.png'))).toBe(true);
    });
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
