import { beforeEach, describe, expect, test, vi } from 'vitest';

const persistenceMocks = vi.hoisted(() => ({
  loadChatSession: vi.fn(),
  saveChatSession: vi.fn(),
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: persistenceMocks.loadChatSession,
  saveChatSession: persistenceMocks.saveChatSession,
}));

describe('workflow runtime conversation binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    persistenceMocks.saveChatSession.mockResolvedValue(undefined);
  });

  test('creates an ordinary workflow conversation without a collaboration room', async () => {
    persistenceMocks.loadChatSession.mockResolvedValue(null);
    const { ensureWorkflowRuntimeConversation } = await import('@/lib/workflow/runtime-session');

    const result = await ensureWorkflowRuntimeConversation({
      runId: 'run-lightweight-1',
      configFile: 'lightweight.yaml',
      workflowName: 'Lightweight',
      userId: 'user-1',
    });

    const saved = persistenceMocks.saveChatSession.mock.calls[0][0];
    expect(result.sessionId).toBe(saved.id);
    expect(saved.workflowBinding).toBeUndefined();
    expect(saved.conversationMode).toBe('workflow-running');
    expect(saved.sessionWorkbenchState.embeddedWorkflow).toMatchObject({
      runId: 'run-lightweight-1',
      configFile: 'lightweight.yaml',
    });
    expect(saved.sessionWorkbenchState.collaborationRoom).toBeUndefined();
  });

  test('does not attach a workflow run to an existing collaboration conversation', async () => {
    persistenceMocks.loadChatSession.mockResolvedValue({
      id: 'collaboration-session',
      title: 'Collaboration',
      model: 'model',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      sessionWorkbenchState: {
        conversationMode: 'agent-chat',
        collaborationRoom: { topic: 'Existing room' },
      },
    });
    const { ensureWorkflowRuntimeConversation } = await import('@/lib/workflow/runtime-session');

    const result = await ensureWorkflowRuntimeConversation({
      frontendSessionId: 'collaboration-session',
      runId: 'run-lightweight-2',
      configFile: 'lightweight.yaml',
      userId: 'user-1',
    });

    const saved = persistenceMocks.saveChatSession.mock.calls[0][0];
    expect(result.sessionId).not.toBe('collaboration-session');
    expect(saved.sessionWorkbenchState.collaborationRoom).toBeUndefined();
  });

  test('does not overwrite a pending embedded workflow binding for another run', async () => {
    persistenceMocks.loadChatSession.mockResolvedValue({
      id: 'pending-workflow-session',
      title: 'Workflow',
      model: 'model',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      sessionWorkbenchState: {
        conversationMode: 'workflow-running',
        embeddedWorkflow: { runId: 'run-existing', configFile: 'existing.yaml' },
      },
    });
    const { ensureWorkflowRuntimeConversation, bindWorkflowRunToConversation } = await import('@/lib/workflow/runtime-session');

    const replacement = await ensureWorkflowRuntimeConversation({
      frontendSessionId: 'pending-workflow-session',
      runId: 'run-new',
      configFile: 'new.yaml',
      userId: 'user-1',
    });

    expect(replacement.sessionId).not.toBe('pending-workflow-session');
    expect(persistenceMocks.saveChatSession.mock.calls[0][0].sessionWorkbenchState.embeddedWorkflow.runId).toBe('run-new');

    persistenceMocks.saveChatSession.mockClear();
    const bound = await bindWorkflowRunToConversation({
      sessionId: 'pending-workflow-session',
      runId: 'run-new',
      configFile: 'new.yaml',
    });

    expect(bound).toBe(false);
    expect(persistenceMocks.saveChatSession).not.toHaveBeenCalled();
  });

  test('binds a lightweight run only after persisted lightweight metadata is available', async () => {
    persistenceMocks.loadChatSession.mockResolvedValue({
      id: 'ordinary-session',
      title: 'Workflow',
      model: 'model',
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      sessionWorkbenchState: {},
    });
    const { bindWorkflowRunToConversation } = await import('@/lib/workflow/runtime-session');

    const missingMetadata = await bindWorkflowRunToConversation({
      sessionId: 'ordinary-session',
      runId: 'run-lightweight-3',
      configFile: 'lightweight.yaml',
      status: 'preparing',
      requireLightweightMetadata: true,
    });
    expect(missingMetadata).toBe(false);
    expect(persistenceMocks.saveChatSession).not.toHaveBeenCalled();

    const bound = await bindWorkflowRunToConversation({
      sessionId: 'ordinary-session',
      runId: 'run-lightweight-3',
      configFile: 'lightweight.yaml',
      status: 'running',
      supervisorAgent: 'default-supervisor',
      attachedAgentSessions: { 'default-supervisor': 'agent-session-1' },
      requireLightweightMetadata: true,
      lightweight: {
        profile: 'lightweight',
        tasklistDirectory: 'tasks/example',
        workspaceRoot: 'C:/workspace',
        resolvedTasklistDirectory: 'C:/workspace/tasks/example',
        stateName: 'Execute',
        stepName: 'Run tasklist',
        effectiveStepSkills: ['aceharness-tasklist'],
      },
    });

    const saved = persistenceMocks.saveChatSession.mock.calls[0][0];
    expect(bound).toBe(true);
    expect(saved.workflowBinding).toMatchObject({
      runId: 'run-lightweight-3',
      configFile: 'lightweight.yaml',
    });
    expect(saved.sessionWorkbenchState.collaborationRoom).toBeUndefined();
  });

  test('persists a Supervisor review to the workflow Agora without adding it to the main chat transcript', async () => {
    const session = {
      id: 'workflow-review-session',
      title: 'Workflow',
      model: 'model',
      conversationMode: 'workflow-running',
      workflowBinding: {
        runId: 'run-review',
        configFile: 'workflow.yaml',
        createdAt: 1,
        updatedAt: 1,
      },
      sessionWorkbenchState: {
        conversationMode: 'workflow-running',
        embeddedWorkflow: { runId: 'run-review', configFile: 'workflow.yaml' },
      },
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    };
    persistenceMocks.loadChatSession.mockResolvedValue(session);
    const { appendWorkflowSupervisorReviewToAgora, bindWorkflowRunToConversation } = await import('@/lib/workflow/runtime-session');

    await expect(appendWorkflowSupervisorReviewToAgora({
      sessionId: session.id,
      runId: 'run-review',
      configFile: 'workflow.yaml',
      stateName: '实现',
      reviewType: 'state-review',
      content: '当前阶段已完成，进入测试。',
      supervisorAgent: 'default-supervisor',
      timestamp: '2026-07-30T12:00:00.000Z',
      dedupeKey: 'review-1',
    })).resolves.toBe(true);

    const saved = persistenceMocks.saveChatSession.mock.calls[0][0];
    expect(saved.messages).toEqual([]);
    expect(saved.sessionWorkbenchState.collaborationRoom).toMatchObject({
      roomId: 'workflow-review:run-review',
      messages: [expect.objectContaining({
        id: 'review-1',
        speakerType: 'supervisor',
        speakerName: 'default-supervisor',
        content: '当前阶段已完成，进入测试。',
      })],
    });

    persistenceMocks.loadChatSession.mockResolvedValue(saved);
    persistenceMocks.saveChatSession.mockClear();
    await expect(bindWorkflowRunToConversation({
      sessionId: session.id,
      runId: 'run-review',
      configFile: 'workflow.yaml',
      status: 'running',
    })).resolves.toBe(true);
  });
});
