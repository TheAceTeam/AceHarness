import { describe, expect, test } from 'vitest';
import {
  AI_WORKFLOW_CREATOR_ACTION,
  AI_WORKFLOW_CREATOR_COMPAT_ACTION,
  AI_WORKFLOW_CREATOR_COMPAT_STARTER_ACTION,
  AI_WORKFLOW_CREATOR_STARTER_ACTION,
  CODESPEC_WORKFLOW_CREATOR_ACTION,
  CODESPEC_WORKFLOW_CREATOR_REQUIREMENTS,
  isAiWorkflowCreatorAction,
  isAiWorkflowCreatorStarterAction,
  isCodespecWorkflowCreatorAction,
  looksLikeAiWorkflowCreationRequest,
  shouldOpenAiWorkflowCreatorFromConversation,
} from '@/lib/chat/workflow-creator-entry';

describe('AI workflow creator entry protocol', () => {
  test('uses the new action and starter action IDs', () => {
    expect(AI_WORKFLOW_CREATOR_ACTION).toBe('__HOME_ACTION__:create_workflow');
    expect(AI_WORKFLOW_CREATOR_STARTER_ACTION).toBe('create_workflow');
    expect(isAiWorkflowCreatorAction(AI_WORKFLOW_CREATOR_ACTION)).toBe(true);
    expect(isAiWorkflowCreatorStarterAction(AI_WORKFLOW_CREATOR_STARTER_ACTION)).toBe(true);
  });

  test('keeps the previous AI-prefixed action as a compatibility alias', () => {
    expect(AI_WORKFLOW_CREATOR_COMPAT_ACTION).toBe('__HOME_ACTION__:ai-workflow-creator');
    expect(AI_WORKFLOW_CREATOR_COMPAT_STARTER_ACTION).toBe('ai-workflow-creator');
    expect(isAiWorkflowCreatorAction(AI_WORKFLOW_CREATOR_COMPAT_ACTION)).toBe(true);
    expect(isAiWorkflowCreatorStarterAction(AI_WORKFLOW_CREATOR_COMPAT_STARTER_ACTION)).toBe(true);
  });

  test('routes the Codespec workflow action into the workflow creator', () => {
    expect(CODESPEC_WORKFLOW_CREATOR_ACTION).toBe('__HOME_ACTION__:create_workflow_from_codespec');
    expect(isCodespecWorkflowCreatorAction(CODESPEC_WORKFLOW_CREATOR_ACTION)).toBe(true);
    expect(CODESPEC_WORKFLOW_CREATOR_REQUIREMENTS).toContain('Codespec');
    expect(isCodespecWorkflowCreatorAction('根据仓库下codespec文档需求创建工作流')).toBe(false);
  });

  test('recognizes an explicit ordinary homepage creation request', () => {
    expect(looksLikeAiWorkflowCreationRequest('我想创建一个状态机工作流，工作目录是 C:/workspace/demo')).toBe(true);
    expect(looksLikeAiWorkflowCreationRequest('请帮我设计一个 workflow')).toBe(true);
  });

  test('does not hijack read-only or explicitly negated conversation', () => {
    expect(looksLikeAiWorkflowCreationRequest('请列出当前工作流')).toBe(false);
    expect(looksLikeAiWorkflowCreationRequest('不要创建工作流，只帮我分析现有配置')).toBe(false);
    expect(looksLikeAiWorkflowCreationRequest('查看工作流运行状态')).toBe(false);
  });

  test('ordinary homepage conversation opens the same creator only in an idle creator session', () => {
    const request = '我想创建一个状态机工作流，目标是完成模块验收。';
    expect(shouldOpenAiWorkflowCreatorFromConversation(request, {
      creationAssistantEnabled: true,
      sessionCreationAssistantEnabled: true,
    })).toBe(true);
    expect(shouldOpenAiWorkflowCreatorFromConversation(request, {
      creationAssistantEnabled: false,
    })).toBe(false);
    expect(shouldOpenAiWorkflowCreatorFromConversation(request, {
      hasWorkflowBinding: true,
    })).toBe(false);
  });
});
