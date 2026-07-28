import type { ChatSession } from '@/contexts/ChatContext';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';

function clonePlainValue<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createForkedCollaborationWorkbenchState(source: SessionWorkbenchState): SessionWorkbenchState {
  const cloned = clonePlainValue(source);
  const room = cloned.collaborationRoom;
  if (!room) return cloned;
  const chatroom = room.chatroom ? {
    ...room.chatroom,
    settings: {
      ...room.chatroom.settings,
      workspacePath: '',
    },
  } : room.chatroom;
  const nextState = {
    ...cloned,
    chatWorkspace: cloned.chatWorkspace ? {
      ...cloned.chatWorkspace,
      workingDirectory: '',
      autoCreated: false,
      gitBaselineReady: false,
      updatedAt: Date.now(),
    } : cloned.chatWorkspace,
    collaborationRoom: {
      ...room,
      agentSessions: {},
      chatroom,
    },
  } as SessionWorkbenchState & Record<string, unknown>;
  delete nextState.runtimeSessionId;
  delete nextState.runtime;
  return nextState;
}

export function buildForkSessionOptions(activeSession: Pick<ChatSession, 'title' | 'agentBinding' | 'sessionWorkbenchState' | 'messages'>) {
  const sourceState = activeSession.sessionWorkbenchState;
  const sessionWorkbenchState = sourceState ? (() => {
    const { chatWorkspace: _chatWorkspace, ...stateRest } = sourceState;
    const nextState: SessionWorkbenchState = { ...stateRest };
    if (sourceState.collaborationRoom) {
      const { agentSessions: _agentSessions, ...roomRest } = sourceState.collaborationRoom;
      nextState.collaborationRoom = roomRest;
    }
    return nextState;
  })() : undefined;

  return {
    title: `${activeSession.title || '对话'} 分支`,
    agentBinding: activeSession.agentBinding,
    sessionWorkbenchState,
    messages: activeSession.messages.map((message) => {
      const { id: _id, timestamp: _timestamp, ...rest } = message;
      return rest;
    }),
  };
}
