// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockCreateSession = vi.fn(() => 'new-session-id');
const mockDeleteSession = vi.fn();
const mockRenameSession = vi.fn();
const mockSetActiveSessionId = vi.fn();
const mockToggleSkill = vi.fn();
const mockSetSkillsEnabled = vi.fn();

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

import ChatSidebar from '@/components/chat/ChatSidebar';

describe('ChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessions = [
      { id: 'sess-1', title: 'Session One', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 5 },
      { id: 'sess-2', title: 'Session Two', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 3 },
    ];
    mockLoading = false;
    mockActiveStreamingSessionIds = [];
    mockSkillSettings = {};
    mockDiscoveredSkills = [];
  });

  test('renders session list', () => {
    render(<ChatSidebar />);

    expect(screen.queryByText('当前会话')).toBeNull();
    expect(screen.getAllByText('Session One').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Session Two').length).toBeGreaterThan(0);
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

  test('separates workflow run sessions from normal and creation sessions', async () => {
    const user = userEvent.setup();
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
    ];

    render(<ChatSidebar />);

    expect(screen.getByText('Plain Chat')).toBeTruthy();
    expect(screen.queryByText('Create Workflow')).toBeNull();
    expect(screen.queryByText('Run Workflow')).toBeNull();

    await user.click(screen.getByRole('button', { name: /工作流/ }));

    expect(screen.queryByText('Run Workflow')).toBeNull();
    expect(screen.queryByText('Plain Chat')).toBeNull();
    await user.click(screen.getByRole('button', { name: /非运行中/ }));
    expect(screen.getByText('Draft Workflow')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Draft Workflow/ }));
    expect(screen.getByText('工作流设计')).toBeTruthy();

    expect(screen.getAllByText('workflow-run.yaml').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: /workflow-run.yaml/ }));
    expect(screen.getByText('运行会话')).toBeTruthy();
  });

  test('filters sessions within each tab', async () => {
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

    await user.click(screen.getByRole('button', { name: /工作流/ }));
    await user.type(screen.getByPlaceholderText('筛选工作流会话...'), 'docs');

    expect(screen.getByText('Docs Workflow')).toBeTruthy();
    expect(screen.queryByText('Release Workflow')).toBeNull();
  });

  test('bulk deletes selected chat sessions', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    expect(screen.queryByLabelText('选择 Session One')).toBeNull();

    await user.click(screen.getByRole('button', { name: '对话管理' }));
    await user.click(screen.getByLabelText('选择 Session One'));
    await user.click(screen.getByLabelText('选择 Session Two'));
    await user.click(screen.getByRole('button', { name: /删除/ }));

    expect(screen.getByText('将删除选中的 2 个对话，删除后无法恢复。')).toBeTruthy();
    expect(mockDeleteSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '删除' }));

    expect(mockDeleteSession).toHaveBeenCalledWith('sess-1');
    expect(mockDeleteSession).toHaveBeenCalledWith('sess-2');
  });

  test('marks the active loading session as streaming', () => {
    mockActiveStreamingSessionIds = ['sess-1'];

    render(<ChatSidebar />);

    expect(screen.getByText('生成中')).toBeTruthy();
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
