import { beforeEach, describe, expect, test, vi } from 'vitest';

const resolveRuntimeModelRoute = vi.hoisted(() => vi.fn());

vi.mock('@/lib/runtime-agent/models/model-routes-api', () => ({
  resolveRuntimeModelRoute,
}));

import {
  isFatalWorkflowRuntimeError,
  projectWorkflowRuntimeEvent,
  resolveWorkflowModelRouteId,
  type WorkflowRuntimeProjectionState,
} from '@/lib/workflow/runtime-facade';
import { ACE_CHUNK_BOUNDARY } from '@/lib/chat/ai-process-blocks';

function runtimeEvent(type: string, text = ''): any {
  return {
    id: `${type}-${text}`,
    sessionId: 'session-1',
    traceId: 'trace-1',
    seq: 1,
    type,
    payload: text ? { text } : {},
    redacted: true,
    createdAt: new Date(0).toISOString(),
  };
}

describe('workflow runtime model selection', () => {
  beforeEach(() => {
    resolveRuntimeModelRoute.mockReset();
  });

  test('uses an active route resolved from the configured agent and model', () => {
    resolveRuntimeModelRoute
      .mockImplementationOnce(() => { throw new Error('not a route id'); })
      .mockReturnValueOnce({
        modelRouteId: 'opencode__boft-ai-gpt-5-5__openai',
        agentId: 'opencode',
      });

    expect(resolveWorkflowModelRouteId('opencode', 'boft-ai/gpt-5.5'))
      .toBe('opencode__boft-ai-gpt-5-5__openai');
  });

  test('reports a concise actionable error when the workflow model is not configured', () => {
    resolveRuntimeModelRoute
      .mockImplementationOnce(() => { throw new Error('not a route id'); })
      .mockReturnValueOnce(null);

    let thrown: unknown;
    try {
      resolveWorkflowModelRouteId('opencode', 'gpt-5.5');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      code: 'MODEL_ROUTE_NOT_FOUND',
      message: '未找到可用的模型配置。\n引擎：OpenCode\n模型：gpt-5.5\n请在模型管理中添加该模型，或修改工作流的模型设置。',
      fatal: true,
    });
    expect(isFatalWorkflowRuntimeError(thrown)).toBe(true);
  });
});

describe('workflow runtime stream projection', () => {
  test('keeps token deltas together and separates messages around tool calls', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    expect(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第一'), state)?.content).toBe('第一');
    expect(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '段'), state)?.content).toBe('段');
    expect(projectWorkflowRuntimeEvent(runtimeEvent('thought.delta', '思考'), state)?.content).toBe('思考');
    expect(projectWorkflowRuntimeEvent(runtimeEvent('tool.updated', 'read completed'), state)?.type).toBe('tool');
    expect(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第二段'), state)?.content)
      .toBe(`${ACE_CHUNK_BOUNDARY}<!-- timestamp: 1970-01-01T00:00:00.000Z -->\n第二段`);
    expect(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '继续'), state)?.content).toBe('继续');
  });

  test('does not create empty chunks for tools before the first message', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    projectWorkflowRuntimeEvent(runtimeEvent('tool.updated', 'read completed'), state);
    expect(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第一段'), state)?.content).toBe('第一段');
  });
});
