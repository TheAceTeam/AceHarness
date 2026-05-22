import { describe, expect, test } from 'vitest';
import {
  createWorkflowAgoraWorkbenchState,
  createWorkflowCreationGuest,
  createWorkflowParticipants,
  extractWorkflowParticipantNames,
} from '@/lib/agora/workflow-topic';

describe('workflow agora topic helpers', () => {
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
});
