// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import WorkflowSupervisorAgoraPanel from '@/components/workflow/WorkflowSupervisorAgoraPanel';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';

const chatMocks = vi.hoisted(() => ({
  workbenchState: undefined as any,
  useChatValue: undefined as any,
}));

vi.mock('@/components/collaboration/AgoraShell', () => ({
  AgoraShell: ({ chatBanner }: { chatBanner?: React.ReactNode }) => (
    <div data-testid="agora-shell">{chatBanner}</div>
  ),
}));

vi.mock('@/contexts/ChatContext', () => ({
  useChat: () => chatMocks.useChatValue,
}));

function setupChatContext(initialWorkbenchState?: any) {
  chatMocks.workbenchState = initialWorkbenchState || {};
  const setSessionWorkbenchState = vi.fn((next: any) => {
    chatMocks.workbenchState = typeof next === 'function'
      ? next(chatMocks.workbenchState)
      : next;
  });
  chatMocks.useChatValue = {
    activeSessionId: 'workflow-session',
    activeSession: {
      id: 'workflow-session',
      sessionWorkbenchState: initialWorkbenchState || {},
    },
    setActiveSessionId: vi.fn(),
    setSessionWorkbenchState,
    appendSessionMessage: vi.fn(),
  };
  return { setSessionWorkbenchState };
}

describe('WorkflowSupervisorAgoraPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupChatContext();
  });

  test('keeps workflow-resolved engine and model on collaboration participants', async () => {
    const { setSessionWorkbenchState } = setupChatContext();

    render(
      <WorkflowSupervisorAgoraPanel
        sessionId="workflow-session"
        title="Supervisor 协作"
        configFile="workflow.yaml"
        initialGuests={[{
          name: 'tester',
          sourceAgent: 'tester',
          runtimeAgentName: 'tester',
          engine: 'codex',
          model: 'gpt-5.1',
        }]}
      />
    );

    await waitFor(() => expect(setSessionWorkbenchState).toHaveBeenCalled());

    const participant = chatMocks.workbenchState.collaborationRoom.chatroom.participantRoster[0];
    expect(participant).toMatchObject({
      name: 'tester',
      runtimeAgentName: 'tester',
      useDefaultModel: false,
      engine: 'codex',
      model: 'gpt-5.1',
    });
  });

  test('refreshes an existing collaboration roster when workflow runtime changes', async () => {
    const existingChatroom = createInitialChatroomState({
      status: 'running',
      topic: 'Supervisor 协作',
      participants: ['tester'],
      participantRoster: [{
        id: 'workflow-guest-0-tester',
        name: 'tester',
        sourceType: 'agent',
        sourceAgent: 'tester',
        runtimeAgentName: 'tester',
        useDefaultModel: true,
        engine: '',
        model: '',
        createdAt: 1,
      }],
    });
    const { setSessionWorkbenchState } = setupChatContext({
      collaborationRoom: {
        topic: 'Supervisor 协作',
        selectedAgents: ['tester'],
        mode: 'group-chat',
        messages: [],
        rounds: [],
        agentSessions: {},
        chatroom: existingChatroom,
      },
    });

    render(
      <WorkflowSupervisorAgoraPanel
        sessionId="workflow-session"
        title="Supervisor 协作"
        configFile="workflow.yaml"
        initialGuests={[{
          name: 'tester',
          sourceAgent: 'tester',
          runtimeAgentName: 'tester',
          engine: 'claude-code',
          model: 'claude-sonnet-4-20250514',
        }]}
      />
    );

    await waitFor(() => expect(setSessionWorkbenchState).toHaveBeenCalled());

    const participant = chatMocks.workbenchState.collaborationRoom.chatroom.participantRoster[0];
    expect(participant.useDefaultModel).toBe(false);
    expect(participant.engine).toBe('claude-code');
    expect(participant.model).toBe('claude-sonnet-4-20250514');
  });

  test('shows pending human review choices after restoring a non-running workflow status', () => {
    setupChatContext();

    render(
      <WorkflowSupervisorAgoraPanel
        sessionId="workflow-session"
        title="Supervisor 协作"
        configFile="workflow.yaml"
        runId="run-restored"
        workflowStatus="stopped"
        pendingHumanQuestion={{
          id: 'question-1',
          runId: 'run-restored',
          configFile: 'workflow.yaml',
          workflowFrontendSessionId: 'workflow-session',
          kind: 'approval',
          status: 'unanswered',
          title: '请人工审查',
          message: '选择下一步状态',
          currentState: '__human_approval__',
          suggestedNextState: '实施',
          availableStates: ['实施', '回退'],
          requiresWorkflowPause: true,
          createdAt: new Date().toISOString(),
          answerSchema: {
            type: 'approval-transition',
            required: true,
          },
        } as any}
        onSubmitHumanQuestion={vi.fn()}
      />
    );

    expect(screen.getAllByText('选择下一步状态').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /实施/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /回退/ })).toBeTruthy();
  });
});
