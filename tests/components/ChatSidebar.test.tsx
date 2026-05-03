// @vitest-environment jsdom
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockCreateSession = vi.fn(() => 'new-session-id');
const mockDeleteSession = vi.fn();
const mockRenameSession = vi.fn();
const mockSetActiveSessionId = vi.fn();

const mockSessions = [
  { id: 'sess-1', title: 'Session One', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 5 },
  { id: 'sess-2', title: 'Session Two', model: 'claude-sonnet-4-20250514', createdAt: Date.now(), updatedAt: Date.now(), messageCount: 3 },
];

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => ({
    sessions: mockSessions,
    activeSession: mockSessions[0],
    activeSessionId: 'sess-1',
    setActiveSessionId: mockSetActiveSessionId,
    createSession: mockCreateSession,
    deleteSession: mockDeleteSession,
    renameSession: mockRenameSession,
    skillSettings: {},
    discoveredSkills: [],
    toggleSkill: vi.fn(),
  }),
}));

vi.mock('@/lib/agent-conversations', () => ({
  buildWorkflowConversationDirectory: vi.fn().mockReturnValue([]),
  getConversationSessionStatusLabel: vi.fn().mockReturnValue(''),
}));

vi.mock('@/components/chat/ChatMessage', () => ({
  RobotLogo: ({ size }: any) => <div data-testid="robot-logo" style={{ width: size, height: size }} />,
}));

import ChatSidebar from '@/components/chat/ChatSidebar';

describe('ChatSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders session list', () => {
    render(<ChatSidebar />);

    // Session titles appear in both active area and list
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

  test('click on active session title enters rename mode', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    // Click the active session title to enter rename mode
    const sessionTitle = screen.getAllByText('Session One').find(
      el => el.getAttribute('title') === '点击修改标题'
    );
    expect(sessionTitle).toBeTruthy();
    await user.click(sessionTitle!);

    // Should show an input for renaming
    await waitFor(() => {
      const input = screen.getByDisplayValue('Session One');
      expect(input).toBeTruthy();
    });
  });

  test('rename confirms on Enter', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    // Click to enter rename mode
    const sessionTitle = screen.getAllByText('Session One').find(
      el => el.getAttribute('title') === '点击修改标题'
    );
    await user.click(sessionTitle!);

    // Find the input and rename
    const input = await screen.findByDisplayValue('Session One');
    await user.clear(input);
    await user.type(input, 'Renamed Session');
    await user.keyboard('{Enter}');

    expect(mockRenameSession).toHaveBeenCalledWith('sess-1', 'Renamed Session');
  });

  test('rename cancels on Escape', async () => {
    const user = userEvent.setup();
    render(<ChatSidebar />);

    const sessionTitle = screen.getAllByText('Session One').find(
      el => el.getAttribute('title') === '点击修改标题'
    );
    await user.click(sessionTitle!);

    const input = await screen.findByDisplayValue('Session One');
    await user.clear(input);
    await user.type(input, 'Should Not Save');
    await user.keyboard('{Escape}');

    expect(mockRenameSession).not.toHaveBeenCalled();
  });
});
