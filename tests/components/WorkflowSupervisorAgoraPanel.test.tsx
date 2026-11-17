// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ensureChatroomRoomState } from '@/lib/agora/chatroom-state';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import WorkflowSupervisorAgoraPanel from '@/components/workflow/WorkflowSupervisorAgoraPanel';

type StateUpdater = (previous: SessionWorkbenchState | undefined) => SessionWorkbenchState;

const mocks = vi.hoisted(() => ({
  updateSessionWorkbenchState: vi.fn(),
  appendSessionMessage: vi.fn(),
  setActiveSessionId: vi.fn(),
  setSessionWorkbenchState: vi.fn(),
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => ({
    ...mocks,
    sessions: [],
    sessionsLoading: false,
    activeSessionId: 'ordinary-chat',
    activeSession: { id: 'ordinary-chat' },
  }),
}));

vi.mock('@/components/collaboration/AgoraShell', () => ({
  AgoraShell: ({ activeSessionId, sessionWorkbenchState, setSessionWorkbenchState }: {
    activeSessionId: string;
    sessionWorkbenchState: SessionWorkbenchState;
    setSessionWorkbenchState: (updater: StateUpdater) => void;
  }) => (
    <>
      <span>{activeSessionId}</span>
      <span>{sessionWorkbenchState.collaborationRoom?.topic}</span>
      <button onClick={() => setSessionWorkbenchState((previous) => ({
        ...previous,
        collaborationRoom: { ...ensureChatroomRoomState(previous?.collaborationRoom), topic: '更新后的议题' },
      }))}>更新议题</button>
    </>
  ),
}));

function DashboardWithAgora({ sessionId }: { sessionId: string }) {
  const [chat, setChat] = useState('对话 A');
  const [showAgora, setShowAgora] = useState(true);
  mocks.setActiveSessionId.mockImplementation(setChat);
  return (
    <>
      <button onClick={() => setShowAgora(false)}>返回仪表盘</button>
      <button onClick={() => setChat('对话 B')}>选择对话 B</button>
      <span>当前对话 {chat}</span>
      {showAgora ? <WorkflowSupervisorAgoraPanel sessionId={sessionId} configFile="history.yaml" title="原议题" /> : null}
    </>
  );
}

describe('WorkflowSupervisorAgoraPanel session isolation', () => {
  beforeEach(() => vi.resetAllMocks());

  test('a missing historical Agora session never takes over the dashboard chat', async () => {
    mocks.updateSessionWorkbenchState.mockResolvedValue(null);
    render(<DashboardWithAgora sessionId="missing-agora" />);

    expect(await screen.findByText('当前运行绑定的协作议题不可用。')).toBeInTheDocument();
    expect(screen.getByText('当前对话 对话 A')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择对话 B' }));
    fireEvent.click(screen.getByRole('button', { name: '返回仪表盘' }));
    expect(screen.getByText('当前对话 对话 B')).toBeInTheDocument();
    expect(mocks.setActiveSessionId).not.toHaveBeenCalled();
  });

  test('a valid Agora panel reads and updates its full bound session by ID', async () => {
    let state: SessionWorkbenchState | undefined;
    mocks.updateSessionWorkbenchState.mockImplementation(async (id: string, update: StateUpdater) => {
      state = update(state);
      return { id, sessionWorkbenchState: state };
    });
    render(<DashboardWithAgora sessionId="workflow-agora" />);

    expect(await screen.findByText('原议题')).toBeInTheDocument();
    expect(screen.getByText('workflow-agora')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '选择对话 B' }));
    fireEvent.click(screen.getByRole('button', { name: '更新议题' }));

    await waitFor(() => expect(screen.getByText('更新后的议题')).toBeInTheDocument());
    expect(screen.getByText('当前对话 对话 B')).toBeInTheDocument();
    expect(mocks.updateSessionWorkbenchState.mock.calls.map(([id]) => id)).toEqual(['workflow-agora', 'workflow-agora']);
    expect(mocks.setActiveSessionId).not.toHaveBeenCalled();
    expect(mocks.setSessionWorkbenchState).not.toHaveBeenCalled();
  });
});
