// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuickActions, { QuickActionsBar } from '@/components/chat/QuickActions';
import { getAgoraTopicExtensionActions } from '@/lib/agora/extensions';
import { getWerewolfLabBoard, TEMP_WEREWOLF_SUPERVISOR } from '@/plugins/werewolf/agents';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

function MockWrapper({ children }: { children: React.ReactNode }) {
  return <div data-testid="mock-wrapper">{children}</div>;
}

describe('multi-agent werewolf lab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('QuickActions does not expose the AI werewolf lab action', async () => {
    const onAction = vi.fn();
    render(
      <MockWrapper>
        <QuickActions onAction={onAction} />
      </MockWrapper>
    );

    expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
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

  test('QuickActionsBar keeps werewolf extension out of expanded home actions', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <MockWrapper>
        <QuickActionsBar onAction={onAction} />
      </MockWrapper>
    );

    expect(screen.getByRole('button', { name: /创建工作流/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /创建 Agent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /快捷操作/ }));

    expect(screen.queryByRole('button', { name: /创建狼人杀/ })).toBeNull();
    expect(onAction).not.toHaveBeenCalled();
  });

  test('werewolf is reachable through the agora extension topic flow', () => {
    const actions = getAgoraTopicExtensionActions();
    const werewolfAction = actions.find((action) => action.id === 'create-werewolf');

    expect(werewolfAction).toBeTruthy();
    expect(werewolfAction?.label).toBe('创建狼人杀');

    const topic = werewolfAction!.createTopic();
    const room = topic.sessionWorkbenchState.collaborationRoom;

    expect(topic.title).toBe('AI 狼人杀');
    expect(room?.chatroom?.status).toBe('running');
    expect(room?.chatroom?.topic).toBe('AI 狼人杀');
    expect(room?.werewolf?.enabled).toBe(true);
    expect(room?.werewolf?.boardName).toBe('预女猎');
    expect(room?.selectedAgents).toContain(TEMP_WEREWOLF_SUPERVISOR.name);
    expect(room?.chatroom?.participants).not.toContain(TEMP_WEREWOLF_SUPERVISOR.name);
    expect(room?.chatroom?.participantRoster).toHaveLength(getWerewolfLabBoard().playerCount);
    expect(room?.chatroom?.participantRoster?.every((guest) => guest.sourceType === 'custom')).toBe(true);
    expect(room?.chatroom?.temporaryAgents).toHaveLength(getWerewolfLabBoard().playerCount);
    expect(room?.werewolf?.players).toHaveLength(getWerewolfLabBoard().playerCount);
    expect(room?.werewolf?.players.some((player) => player.role === 'seer')).toBe(true);
  });
});
