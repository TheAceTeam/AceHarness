import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  appendWorkflowAgoraMessage,
  createWorkflowAgoraWorkbenchState,
  createWorkflowCreationGuest,
  createWorkflowParticipants,
  extractWorkflowParticipantNames,
} from '@/lib/agora/workflow-topic';

const persistenceMocks = vi.hoisted(() => ({
  loadChatSession: vi.fn(),
  saveChatSession: vi.fn(),
}));

vi.mock('@/lib/chat/persistence', () => ({
  loadChatSession: persistenceMocks.loadChatSession,
  saveChatSession: persistenceMocks.saveChatSession,
}));

describe('workflow agora topic helpers', () => {
  beforeEach(() => {
    persistenceMocks.loadChatSession.mockReset();
    persistenceMocks.saveChatSession.mockReset().mockResolvedValue(undefined);
  });

  test('extracts supervisor and workflow step agents without duplicates', () => {
    const names = extractWorkflowParticipantNames({
      workflow: {
        supervisor: { agent: '架构师' },
        phases: [
          { steps: [{ agent: '工程师' }, { agent: '测试' }] },
          { steps: [{ agent: '工程师' }, { agent: '产品经理' }] },
        ],
      },
    });

    expect(names).toEqual(['架构师', '工程师', '测试', '产品经理']);
  });

  test('creates a running collaboration room for workflow topics', () => {
    const participants = createWorkflowParticipants(['工程师', '测试']);
    const state = createWorkflowAgoraWorkbenchState({
      title: '示例工作流 · 协作议题',
      participants,
      workspacePath: 'C:/tmp/workflow',
    });

    expect(state.collaborationRoom?.chatroom?.status).toBe('running');
    expect(state.collaborationRoom?.chatroom?.topic).toBe('示例工作流 · 协作议题');
    expect(state.collaborationRoom?.chatroom?.participants).toEqual(['工程师', '测试']);
    expect(state.collaborationRoom?.chatroom?.settings.workspacePath).toBe('C:/tmp/workflow');
  });

  test('creates a persistent creation guest with the existing backend session', () => {
    const guest = createWorkflowCreationGuest({
      id: 'creation-1',
      workflowName: '示例工作流',
      planningEngine: 'codex',
      planningModel: 'gpt-5.4',
      requirements: '整理一个协作流程',
      stageSessions: {
        workflowDraft: {
          backendSessionId: 'backend-session-1',
          engine: 'codex',
          model: 'gpt-5.4',
        },
      },
    });

    expect(guest?.participant.name).toBe('创建嘉宾');
    expect(guest?.participant.sourceType).toBe('custom');
    expect(guest?.participant.runtimeAgentName).toBe('workflow-creation-creation-1');
    expect(guest?.participant.engine).toBe('codex');
    expect(guest?.participant.model).toBe('gpt-5.4');
    expect(guest?.agentSessions).toEqual({ 'workflow-creation-creation-1': 'backend-session-1' });
  });

  test('appends spec revision vote events into the agora conversation stream', async () => {
    const session: any = {
      id: 'chat-1',
      title: '示例工作流',
      messages: [],
      sessionWorkbenchState: createWorkflowAgoraWorkbenchState({
        title: '示例工作流 · 协作议题',
        participants: createWorkflowParticipants(['Supervisor', '工程师']),
      }),
      createdAt: 100,
      updatedAt: 100,
    };
    persistenceMocks.loadChatSession.mockResolvedValue(session);

    await appendWorkflowAgoraMessage({
      sessionId: 'chat-1',
      type: 'spec-revision-vote',
      title: '状态完成后 Spec 修订表决',
      body: '是否需要基于本次结论修订 Run Spec Coding？\n参与 Agent: 工程师',
      speakerName: 'Supervisor',
      dedupeKey: 'vote-start-1',
      createdAt: 200,
    });
    await appendWorkflowAgoraMessage({
      sessionId: 'chat-1',
      type: 'spec-revision-vote-result',
      title: 'Spec 修订表决完成：建议修订',
      body: '票数: 修订 1 / 保持 0 / 暂缓 0\nSupervisor 决定应用修订。',
      speakerName: 'Supervisor',
      dedupeKey: 'vote-result-1',
      createdAt: 201,
    });

    const roomMessages = session.sessionWorkbenchState.collaborationRoom.messages;
    expect(roomMessages.map((message: any) => message.chatroom?.kind)).toEqual(['vote', 'vote-result']);
    expect(roomMessages[0].content).toContain('我发起一次 Spec 修订表决');
    expect(roomMessages[1].content).toContain('Spec 修订表决完成：建议修订');
    expect(roomMessages[1].content).toContain('票数: 修订 1 / 保持 0 / 暂缓 0');
    expect(session.messages.map((message: any) => message.cards?.[0]?.actionLabel)).toEqual(['投票', '票决']);
    expect(persistenceMocks.saveChatSession).toHaveBeenCalledTimes(2);
  });

  test('appends human help and parallel manual join prompts with specific agora messages', async () => {
    const session: any = {
      id: 'chat-1',
      title: '示例工作流',
      messages: [],
      sessionWorkbenchState: createWorkflowAgoraWorkbenchState({
        title: '示例工作流 · 协作议题',
        participants: createWorkflowParticipants(['Supervisor', '工程师']),
      }),
      createdAt: 100,
      updatedAt: 100,
    };
    persistenceMocks.loadChatSession.mockResolvedValue(session);

    await appendWorkflowAgoraMessage({
      sessionId: 'chat-1',
      type: 'human-help-question',
      title: '等待人工客服回复：缺少配置',
      body: '请提供 API_KEY。',
      speakerName: 'Supervisor',
      dedupeKey: 'human-help-1',
      createdAt: 200,
    });
    await appendWorkflowAgoraMessage({
      sessionId: 'chat-1',
      type: 'parallel-manual-join-question',
      title: '等待并发人工确认：并发组 group-1',
      body: '请确认是否放行。',
      speakerName: 'Supervisor',
      dedupeKey: 'parallel-manual-1',
      createdAt: 201,
    });

    const roomMessages = session.sessionWorkbenchState.collaborationRoom.messages;
    expect(roomMessages.map((message: any) => message.chatroom?.kind)).toEqual(['system', 'system']);
    expect(roomMessages[0].content).toContain('这边需要人工客服补充信息');
    expect(roomMessages[0].content).toContain('请提供 API_KEY');
    expect(roomMessages[1].content).toContain('并发组已经汇合，需要你确认是否放行');
    expect(roomMessages[1].content).toContain('请确认是否放行');
    expect(session.messages.map((message: any) => message.cards?.[0]?.actionLabel)).toEqual(['工作流', '工作流']);
    expect(persistenceMocks.saveChatSession).toHaveBeenCalledTimes(2);
  });

  test('step complete messages use only step-conclusion content and normalize html', async () => {
    const session: any = {
      id: 'chat-1',
      title: '示例工作流',
      messages: [],
      sessionWorkbenchState: createWorkflowAgoraWorkbenchState({
        title: '示例工作流 · 协作议题',
        participants: createWorkflowParticipants(['Supervisor', '工程师']),
      }),
      createdAt: 100,
      updatedAt: 100,
    };
    persistenceMocks.loadChatSession.mockResolvedValue(session);

    await appendWorkflowAgoraMessage({
      sessionId: 'chat-1',
      type: 'step-complete',
      title: '步骤完成：PRD到SpecLang覆盖审查 / write-only与表面审查',
      body: [
        '这里是完整工具输出，不应该进群聊。',
        '<step-conclusion>',
        '## 结果 / 裁决',
        '- 未发现 write-only 契约缺口。',
        '<h2>下一步所需上下文</h2>',
        '<ul><li>SpecLang：<code>specs/FEATURE.yaml</code></li></ul>',
        '</step-conclusion>',
      ].join('\n'),
      speakerName: '工程师',
      dedupeKey: 'step-conclusion-1',
      createdAt: 200,
    });

    const content = session.sessionWorkbenchState.collaborationRoom.messages[0].content;
    expect(content).toContain('未发现 write-only 契约缺口');
    expect(content).toContain('下一步所需上下文');
    expect(content).toContain('`specs/FEATURE.yaml`');
    expect(content).not.toContain('这里是完整工具输出');
    expect(content).not.toContain('<h2>');
    expect(content).not.toContain('<li>');
  });
});
