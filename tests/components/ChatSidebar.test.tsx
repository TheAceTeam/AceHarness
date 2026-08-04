// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockCreateSession = vi.fn(() => 'new-session-id');
const mockDeleteSession = vi.fn();
const mockDeleteSessions = vi.fn();
const mockRenameSession = vi.fn();
const mockSetActiveSessionId = vi.fn();
const mockToggleSkill = vi.fn();
const mockSetSkillsEnabled = vi.fn();
const mockListHumanQuestions = vi.fn(async () => ({ questions: [] }));
const mockListRuns = vi.fn(async () => ({ runs: [] as { id: string; status: string }[] }));
const mockGetEventLog = vi.fn(async (_runId?: string, _options?: any) => ({ events: [], nextSeq: 0 }));
const coreApiMocks = vi.hoisted(() => ({
  deleteWorkspace: vi.fn(async (_input: { sessionId: string; workspacePath: string }) => ({ success: true })),
}));

let mockSessions: any[] = [
  { id: 'sess-1', title: 'Session One', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 5 },
  { id: 'sess-2', title: 'Session Two', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 3 },
];
let mockLoading = false;
let mockActiveStreamingSessionIds: string[] = [];
let mockSkillSettings: Record<string, boolean> = {};
let mockDiscoveredSkills: any[] = [];

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => ({
    sessions: mockSessions,
    activeSession: mockSessions[0],
    activeSessionId: 'sess-1',
    setActiveSessionId: mockSetActiveSessionId,
    createSession: mockCreateSession,
    deleteSession: mockDeleteSession,
    deleteSessions: mockDeleteSessions,
    renameSession: mockRenameSession,
    loading: mockLoading,
    activeStreamingSessionIds: mockActiveStreamingSessionIds,
    recentlyCompletedSessionIds: [],
    skillSettings: mockSkillSettings,
    discoveredSkills: mockDiscoveredSkills,
    toggleSkill: mockToggleSkill,
    setSkillsEnabled: mockSetSkillsEnabled,
  }),
}));

vi.mock('@/lib/core/api', () => ({
  agoraApi: {
    deleteWorkspace: coreApiMocks.deleteWorkspace,
  },
  workflowApi: {
    listHumanQuestions: () => mockListHumanQuestions(),
    getEventLog: (runId: string, options?: any) => mockGetEventLog(runId, options),
  },
  runsApi: {
    listAll: () => mockListRuns(),
  },
}));

vi.mock('@/lib/agent/agent-conversations', () => ({
  buildWorkflowConversationDirectory: vi.fn().mockReturnValue([]),
  getConversationSessionStatusLabel: vi.fn().mockReturnValue(''),
  getCreationSessionStatusLabel: vi.fn((status?: string) => {
    const labels: Record<string, string> = {
      draft: '草稿',
      confirmed: '已确认',
      'config-generated': '已生成配置',
      'run-bound': '已绑定运行',
      archived: '已归档',
    };
    return status ? labels[status] || status : '未开始';
  }),
  getWorkbenchSessionKind: vi.fn((session: any) => {
    if (session.workflowBinding) return 'run';
    if (session.creationSession) return 'creation';
    return 'plain';
  }),
}));

vi.mock('@/components/chat/ChatMessage', () => ({
  RobotLogo: ({ size }: any) => <div data-testid="robot-logo" style={{ width: size, height: size }} />,
}));

import ChatSidebar, { readStoredSessionTagFilters, SESSION_TAG_FILTER_STORAGE_KEY } from '@/components/chat/ChatSidebar';

describe('ChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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
    mockSessions = [
      { id: 'sess-1', title: 'Session One', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 5 },
      { id: 'sess-2', title: 'Session Two', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 3 },
    ];
    mockLoading = false;
    mockActiveStreamingSessionIds = [];
    mockSkillSettings = {};
    mockDiscoveredSkills = [];
    mockListHumanQuestions.mockResolvedValue({ questions: [] });
    mockListRuns.mockResolvedValue({ runs: [] });
    mockGetEventLog.mockResolvedValue({ events: [], nextSeq: 0 });
    coreApiMocks.deleteWorkspace.mockResolvedValue({ success: true });
  });

  test('renders session list', () => {
    render(<ChatSidebar />);

    expect(screen.queryByText('当前会话')).toBeNull();
    expect(screen.getAllByText('Session One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Session Two').length).toBeGreaterThan(0);
  });

  test('uses a restrained dark background for the active home session', () => {
    render(<ChatSidebar />);

    const activeRow = screen.getByText('Session One').closest('.home-chat-session-row');
    expect(activeRow).toHaveClass('dark:bg-violet-950/45');
    expect(activeRow).not.toHaveClass('dark:bg-violet-500/12');
  });

  test('create button calls createSession', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    const createButton = screen.getByTitle('新建会话');
    await user.click(createButton);

    expect(mockCreateSession).toHaveBeenCalled();
  });

  test('shows an empty placeholder with create action for empty chat list', async () => {
    const user = userEvent.setup();
    mockSessions = [];

    render(<ChatSidebar />);

    expect(screen.getByText('暂无对话')).toBeTruthy();
    expect(screen.getByText('新建对话，让 AI 帮你继续推进。')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /新建对话/ }));

    expect(mockCreateSession).toHaveBeenCalled();
  });

  test('shows AI-pushed workflow runtime sessions in the unified conversation list', async () => {
    mockSessions = [
      {
        id: 'workflow-hint-1',
        title: 'Workflow Planning Chat',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 2,
        sessionWorkbenchState: {
          homeSidebar: {
            type: 'home_sidebar',
            activeTab: 'commander',
            intent: 'workflow-run',
            stage: 'running',
          },
        },
      },
    ];

    render(<ChatSidebar />);

    expect(screen.getAllByText('Workflow Planning Chat').length).toBeGreaterThan(0);
    expect(screen.getByText('群聊和工作流都会显示在这里')).toBeTruthy();
  });

  test('shows workflow sessions with badges in the unified conversation list', async () => {
    mockSessions = [
      { id: 'plain-1', title: 'Plain Chat', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 1 },
      {
        id: 'creation-1',
        title: 'Create Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 2,
        creationSession: {
          creationSessionId: 'creation-session-1',
          filename: 'workflow-draft.yaml',
          workflowName: 'Draft Workflow',
          status: 'draft',
          specCodingId: 'spec-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      {
        id: 'run-1',
        title: 'Run Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 3,
        workflowBinding: {
          configFile: 'workflow-run.yaml',
          runId: 'run-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      {
        id: 'ready-1',
        title: 'Ready Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 3,
        workflowBinding: {
          configFile: 'ready.yaml',
          runId: 'run-ready-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    ];
    mockListRuns.mockResolvedValue({ runs: [{ id: 'run-1', status: 'running' }, { id: 'run-ready-1', status: 'completed' }] });

    render(<ChatSidebar />);

    expect(screen.getByText('Plain Chat')).toBeTruthy();
    expect(screen.getByText('Create Workflow')).toBeTruthy();
    expect(screen.getByText('workflow-draft.yaml · 草稿')).toBeTruthy();
    expect(screen.getByText('Run Workflow')).toBeTruthy();
    expect(screen.getByText('Ready Workflow')).toBeTruthy();
    expect(screen.getAllByText('ready.yaml').length).toBeGreaterThan(0);
    expect(screen.getAllByText('workflow-run.yaml').length).toBeGreaterThan(0);
    expect(screen.getAllByText('协作议题').length).toBeGreaterThan(0);
  });

  test('shows creation or conversation mode alongside the session status', () => {
    mockSessions = [
      {
        id: 'creation-mode',
        title: 'Creation Mode',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { creationAssistantEnabled: true, creationTag: true },
      },
      {
        id: 'conversation-mode',
        title: 'Conversation Mode',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { creationAssistantEnabled: false },
      },
      {
        id: 'workflow-mode',
        title: 'Workflow Mode',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        workflowBinding: {
          configFile: 'workflow.yaml',
          runId: 'run-mode',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        sessionWorkbenchState: { creationAssistantEnabled: true },
      },
    ];

    render(<ChatSidebar />);

    const rowFor = (title: string) => screen.getAllByText(title)
      .map((node) => node.closest('.home-chat-session-row'))
      .find((row): row is HTMLElement => Boolean(row));
    expect(within(rowFor('Creation Mode')!).getByText('创建')).toBeTruthy();
    expect(within(rowFor('Conversation Mode')!).getByText('对话')).toBeTruthy();
    expect(within(rowFor('Workflow Mode')!).getByText('对话')).toBeTruthy();
    expect(within(rowFor('Workflow Mode')!).getByText('协作议题')).toBeTruthy();
  });

  test('shows workflow run sessions without loaded summary', async () => {
    const user = userEvent.setup();
    mockSessions = [
      {
        id: 'run-1',
        title: 'Run Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        workflowBinding: {
          configFile: 'workflow-run.yaml',
          runId: 'run-1',
          supervisorAgent: 'default-supervisor',
          supervisorSessionId: 'supervisor-1',
          attachedAgentSessions: {},
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    ];
    mockListRuns.mockResolvedValue({ runs: [{ id: 'run-1', status: 'running' }] });

    render(<ChatSidebar />);

    await waitFor(() => {
      expect(screen.getAllByText('workflow-run.yaml').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText('workflow-run.yaml').length).toBeGreaterThan(0);
    expect(screen.getByText('运行中')).toBeTruthy();

    const runBadge = screen.getByText('运行中');
    const row = runBadge.closest('.home-chat-session-row');
    expect(row).toBeTruthy();
    await user.click(row as HTMLElement);
    expect(mockSetActiveSessionId).toHaveBeenCalledWith('run-1');
  });

  test('filters sessions in the unified conversation list', async () => {
    const user = userEvent.setup();
    mockSessions = [
      { id: 'plain-1', title: 'Design Notes', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 1 },
      { id: 'plain-2', title: 'Bug Bash', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 1 },
      {
        id: 'run-1',
        title: 'Release Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 3,
        workflowBinding: {
          configFile: 'release.yaml',
          runId: 'run-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      {
        id: 'run-2',
        title: 'Docs Workflow',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 3,
        workflowBinding: {
          configFile: 'docs.yaml',
          runId: 'run-2',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
    ];

    render(<ChatSidebar />);

    await user.type(screen.getByPlaceholderText('筛选对话...'), 'Design');
    expect(screen.getByText('Design Notes')).toBeTruthy();
    expect(screen.queryByText('Bug Bash')).toBeNull();

    await user.click(screen.getByLabelText('清空筛选'));
    await user.type(screen.getByPlaceholderText('筛选对话...'), 'docs');

    expect(screen.getByText('Docs Workflow')).toBeTruthy();
    expect(screen.queryByText('Release Workflow')).toBeNull();
  });

  test('filters sessions by their sidebar labels', async () => {
    const user = userEvent.setup();
    mockSessions = [
      {
        id: 'topic-1',
        title: 'Workflow Topic',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        workflowBinding: {
          configFile: 'topic.yaml',
          runId: 'topic-run',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        sessionWorkbenchState: {
          collaborationRoom: {
            topic: 'Topic',
            chatroom: { topic: 'Topic' },
          },
        },
      },
      {
        id: 'agora-1',
        title: 'Agora Topic',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { collaborationRoom: { topic: 'Agora' } },
      },
      {
        id: 'workflow-run-1',
        title: 'Workflow Run',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        workflowBinding: {
          configFile: 'workflow.yaml',
          runId: 'workflow-run-1',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      },
      {
        id: 'creation-1',
        title: 'Creation Chat',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { creationAssistantEnabled: false, creationTag: true },
      },
      {
        id: 'plain-1',
        title: 'Plain Chat',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { creationAssistantEnabled: false },
      },
    ];

    render(<ChatSidebar />);

    const toggleTag = async (label: string) => {
      const existingItem = screen.queryByRole('menuitemcheckbox', { name: label });
      if (!existingItem) {
        await user.click(screen.getByRole('button', { name: '按标签筛选对话' }));
      }
      await user.click(await screen.findByRole('menuitemcheckbox', { name: label }));
    };

    await toggleTag('协作议题');
    expect(screen.getByText('Workflow Topic')).toBeTruthy();
    expect(screen.getByText('Workflow Run')).toBeTruthy();
    expect(screen.queryByText('Agora Topic')).toBeNull();

    await toggleTag('议场');
    expect(screen.getByText('Agora Topic')).toBeTruthy();
    expect(screen.getByText('Workflow Topic')).toBeTruthy();
    expect(screen.getByText('Workflow Run')).toBeTruthy();
    expect(screen.queryByText('Creation Chat')).toBeNull();

    await toggleTag('创建');
    expect(screen.getByText('Creation Chat')).toBeTruthy();
    expect(screen.getByText('Agora Topic')).toBeTruthy();

    await toggleTag('普通对话');
    expect(screen.getByText('Plain Chat')).toBeTruthy();
    expect(screen.getByText('Creation Chat')).toBeTruthy();
  });

  test('restores the selected session label filter', async () => {
    const user = userEvent.setup();
    mockSessions = [
      {
        id: 'agora-1',
        title: 'Remembered Agora Topic',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { collaborationRoom: { topic: 'Agora' } },
      },
      {
        id: 'plain-1',
        title: 'Unrelated Plain Chat',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: { creationAssistantEnabled: false },
      },
    ];

    const firstRender = render(<ChatSidebar />);
    await user.click(screen.getByRole('button', { name: '按标签筛选对话' }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: '议场' }));
    expect(window.localStorage.getItem(SESSION_TAG_FILTER_STORAGE_KEY)).toBe('["agora"]');

    firstRender.unmount();
    render(<ChatSidebar />);

    expect(screen.getByRole('button', { name: '按标签筛选对话' })).toHaveTextContent('议场');
    expect(screen.getByText('Remembered Agora Topic')).toBeTruthy();
    expect(screen.queryByText('Unrelated Plain Chat')).toBeNull();
  });

  test('migrates a remembered workflow filter to collaboration topics', () => {
    window.localStorage.setItem(SESSION_TAG_FILTER_STORAGE_KEY, '["workflow"]');

    expect(readStoredSessionTagFilters()).toEqual(['collaboration-topic']);
  });

  test('bulk deletes selected chat sessions', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    expect(screen.queryByLabelText('选择 Session One')).toBeNull();

    await user.click(screen.getByRole('button', { name: '批量管理' }));
    await user.click(screen.getByLabelText('选择 Session One'));
    await user.click(screen.getByLabelText('选择 Session Two'));
    await user.click(screen.getByRole('button', { name: /删除/ }));

    expect(screen.getByText('将删除选中的 2 个对话，删除后无法恢复。')).toBeTruthy();
    expect(mockDeleteSessions).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSessions).toHaveBeenCalledWith(['sess-1', 'sess-2']);
  });

  test('marks the active loading session as streaming', () => {
    mockActiveStreamingSessionIds = ['sess-1'];

    render(<ChatSidebar />);

    expect(screen.getAllByText('Session One').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('进行中')).toBeTruthy();
  });

  test('pins wechat-bound sessions and shows wechat indicators', () => {
    mockSessions = [
      {
        id: 'normal-1',
        title: 'Normal Session',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now() - 1000,
        updatedAt: Date.now(),
        messageCount: 1,
      },
      {
        id: 'wechat-1',
        title: 'WeChat Session',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now() - 2000,
        updatedAt: Date.now() - 5000,
        messageCount: 1,
        sessionWorkbenchState: {
          wechatBinding: {
            integrationId: 'integration-1',
            integrationName: '微信接入',
            bindingId: 'binding-1',
            externalConversationId: 'wechat-conversation-1',
            bindingType: 'agent-chat',
            targetLabel: 'WeChat Session',
            updatedAt: Date.now(),
          },
        },
      },
    ];

    const { container } = render(<ChatSidebar />);

    const titles = Array.from(container.querySelectorAll('.text-sm.font-medium.truncate'))
      .map((node) => node.textContent)
      .filter(Boolean);
    expect(titles.indexOf('WeChat Session')).toBeLessThan(titles.indexOf('Normal Session'));
    expect(screen.getByLabelText('微信绑定会话')).toBeTruthy();
    expect(screen.getByLabelText('已置顶')).toBeTruthy();
  });

  test('row menu enters rename mode', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('重命名 Session One'));

    expect(screen.getByDisplayValue('Session One')).toBeTruthy();
  });

  test('row menu rename dialog stays open after mouse movement', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('重命名 Session One'));
    fireEvent.mouseMove(document.body);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByDisplayValue('Session One')).toBeTruthy();
  });

  test('right click menu enters rename mode', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    fireEvent.contextMenu(screen.getByText('Session One'));
    await user.click(await screen.findByText('重命名'));

    expect(screen.getByDisplayValue('Session One')).toBeTruthy();
  });

  test('row menu rename confirms on Enter', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('重命名 Session One'));

    const input = await screen.findByDisplayValue('Session One');
    await user.clear(input);
    await user.type(input, 'Renamed Session');
    await user.keyboard('{Enter}');

    expect(mockRenameSession).toHaveBeenCalledWith('sess-1', 'Renamed Session');
  });

  test('row menu rename cancels on Escape', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('重命名 Session One'));

    const input = await screen.findByDisplayValue('Session One');
    await user.clear(input);
    await user.type(input, 'Should Not Save');
    await user.keyboard('{Escape}');

    expect(mockRenameSession).not.toHaveBeenCalled();
  });

  test('right click menu delete requires confirmation', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    fireEvent.contextMenu(screen.getByText('Session One'));
    await user.click(await screen.findByText('删除'));

    expect(screen.getByText('确认删除对话')).toBeTruthy();
    expect(mockDeleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
  });

  test('row menu delete requires confirmation', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('删除 Session One'));

    expect(screen.getByText('确认删除对话')).toBeTruthy();
    expect(mockDeleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
  });

  test('can delete the auto-created default workspace with its chat session', async () => {
    const user = userEvent.setup();
    const workspacePath = 'C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\data\\agora-workspaces\\auto-session';
    mockSessions = [
      {
        id: 'auto-session',
        title: 'Auto Workspace',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: {
          chatWorkspace: {
            workingDirectory: workspacePath,
            autoCreated: true,
            updatedAt: Date.now(),
          },
        },
      },
    ];

    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('删除 Auto Workspace'));

    expect(screen.getByText('同时删除系统自动创建的工作目录')).toBeTruthy();
    expect(screen.getByText(workspacePath)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSession).toHaveBeenCalledWith('auto-session');
    await waitFor(() => {
      expect(coreApiMocks.deleteWorkspace).toHaveBeenCalledWith({
        sessionId: 'auto-session',
        workspacePath,
      });
    });
  });

  test('does not offer workspace deletion for manually bound workspaces', async () => {
    const user = userEvent.setup();
    mockSessions = [
      {
        id: 'manual-session',
        title: 'Manual Workspace',
        model: 'claude-sonnet-4-20250514',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: 1,
        sessionWorkbenchState: {
          chatWorkspace: {
            workingDirectory: 'C:\\Users\\Shawn\\Desktop\\project',
            autoCreated: false,
            updatedAt: Date.now(),
          },
        },
      },
    ];

    render(<ChatSidebar />);

    await user.click(screen.getByLabelText('删除 Manual Workspace'));

    expect(screen.queryByText('同时删除系统自动创建的工作目录')).toBeNull();
    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSession).toHaveBeenCalledWith('manual-session');
    expect(coreApiMocks.deleteWorkspace).not.toHaveBeenCalled();
  });

  test('skill manager can select all and clear selectable skills', async () => {
    const user = userEvent.setup();
    mockDiscoveredSkills = [
      { name: 'aceharness-chat-card', label: 'Chat Card', description: '必选卡片' },
      { name: 'aceharness-spec-coding', label: 'Spec Coding', description: '计划生成' },
      { name: 'docx', label: 'DOCX', description: '文档处理', source: 'anthropics' },
    ];
    mockSkillSettings = {
      'aceharness-chat-card': true,
      'aceharness-spec-coding': false,
      docx: true,
    };

    render(<ChatSidebar />);

    await user.click(screen.getByRole('button', { name: /Skills/ }));
    expect(screen.getByText('已启用 2 / 3 个技能')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '全选' }));
    expect(mockSetSkillsEnabled).toHaveBeenCalledWith({
      'aceharness-spec-coding': true,
      docx: true,
      'aceharness-chat-card': true,
    });

    await user.click(screen.getByRole('button', { name: '全部取消' }));
    expect(mockSetSkillsEnabled).toHaveBeenCalledWith({
      'aceharness-spec-coding': false,
      docx: false,
      'aceharness-chat-card': true,
    });
    expect(mockToggleSkill).not.toHaveBeenCalled();
  });
});
