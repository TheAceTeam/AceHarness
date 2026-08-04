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

function runtimeToolEvent(type: string, payload: Record<string, unknown>, toolCallId = 'tool-1'): any {
  return {
    id: `${type}-${toolCallId}`,
    sessionId: 'session-1',
    traceId: 'trace-1',
    seq: 1,
    type,
    payload,
    toolCallId,
    redacted: true,
    createdAt: new Date(0).toISOString(),
  };
}

function projectedContent(event: ReturnType<typeof projectWorkflowRuntimeEvent>): string | undefined {
  return event && event.type !== 'tool' ? event.content : undefined;
}

function projectedTool(event: ReturnType<typeof projectWorkflowRuntimeEvent>) {
  if (!event || event.type !== 'tool') throw new Error('Expected a structured tool projection');
  return event.tool;
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

    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第一'), state)))
      .toBe('<!-- timestamp: 1970-01-01T00:00:00.000Z -->\n第一');
    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '段'), state))).toBe('段');
    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('thought.delta', '思考'), state))).toBe('思考');
    expect(projectedTool(projectWorkflowRuntimeEvent(runtimeToolEvent('tool.started', { name: 'read', input: { filePath: 'README.md' } }), state))).toMatchObject({
      toolName: 'read',
      status: 'running',
    });
    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第二段'), state)))
      .toBe(`${ACE_CHUNK_BOUNDARY}<!-- timestamp: 1970-01-01T00:00:00.000Z -->\n第二段`);
    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '继续'), state))).toBe('继续');
  });

  test('does not create empty chunks for tools before the first message', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    projectWorkflowRuntimeEvent(runtimeEvent('tool.updated', 'read completed'), state);
    expect(projectedContent(projectWorkflowRuntimeEvent(runtimeEvent('message.delta', '第一段'), state)))
      .toBe('<!-- timestamp: 1970-01-01T00:00:00.000Z -->\n第一段');
  });

  test('projects tool status into its structured tool channel', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };
    const command = 'if (-not (Test-Path -LiteralPath "C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\runs\\run-1")) { throw "Missing run directory" }; "ready"';
    expect(projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      text: 'bash (pending)',
      title: 'bash',
      status: 'pending',
      kind: 'execute',
      rawInput: { cwd: 'C:\\Users\\Shawn\\Desktop\\speclang' },
    }), state)).toBeNull();
    const projected = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: command,
      status: 'in_progress',
      kind: 'execute',
      text: `ready\n${command} (in_progress): ${command}`,
      rawInput: { command, cwd: 'C:\\Users\\Shawn\\Desktop\\speclang' },
    }), state);

    const tool = projectedTool(projected);
    expect(tool).toMatchObject({
      status: 'running',
      input: { command },
    });
    expect(JSON.stringify(tool)).not.toContain('(in_progress):');
  });

  test('keeps ACPX formatted command output on the completed tool event', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };
    const command = 'rg -n "TemplateRuntimeError" src';

    projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: command,
      status: 'in_progress',
      kind: 'execute',
      rawInput: { command },
    }, 'tool-search-1'), state);
    const completed = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'tool call',
      status: 'completed',
      formatted_output: 'src/jinja2/exceptions.py:58:class TemplateRuntimeError(TemplateError):',
      exit_code: 0,
    }, 'tool-search-1'), state);

    expect(projectedTool(completed)).toMatchObject({
      id: 'tool-search-1',
      status: 'completed',
      result: {
        stdout: 'src/jinja2/exceptions.py:58:class TemplateRuntimeError(TemplateError):',
        exitCode: 0,
      },
    });
  });

  test('keeps a terminal tool error from the adapter payload', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'missing-command',
      status: 'in_progress',
      kind: 'execute',
      rawInput: { command: 'missing-command' },
    }, 'tool-error-1'), state);
    const failed = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'tool call',
      status: 'failed',
      error: { message: 'command not found' },
      exit_code: 127,
    }, 'tool-error-1'), state);

    expect(projectedTool(failed)).toMatchObject({
      id: 'tool-error-1',
      status: 'failed',
      result: {
        error: 'command not found',
        exitCode: 127,
      },
    });
  });

  test('projects a string result into standard output', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'search',
      status: 'in_progress',
      kind: 'search',
      rawInput: { query: 'TemplateRuntimeError' },
    }, 'tool-string-1'), state);
    const completed = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'tool call',
      status: 'completed',
      rawOutput: 'src/jinja2/exceptions.py:58',
    }, 'tool-string-1'), state);

    expect(projectedTool(completed)).toMatchObject({
      status: 'completed',
      result: { stdout: 'src/jinja2/exceptions.py:58' },
    });
  });

  test('keeps structured command results from every runtime in the tool output channel', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };
    const command = 'find source files';

    projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: command,
      status: 'in_progress',
      kind: 'execute',
      rawInput: { command },
    }, 'tool-structured-1'), state);
    const completed = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'tool call',
      status: 'completed',
      rawOutput: {
        output: {
          matches: ['src/main.cj', 'src/runtime.cj'],
          total: 2,
        },
        exit_code: 0,
      },
    }, 'tool-structured-1'), state);

    expect(projectedTool(completed)).toMatchObject({
      id: 'tool-structured-1',
      status: 'completed',
      result: {
        stdout: expect.stringContaining('src/main.cj'),
        exitCode: 0,
      },
    });
  });

  test('finishes an ACPX file edit from its status event when no tool output arrives', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };
    const fileBody = 'line one\nline two';
    const started = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'Editing files',
      status: 'in_progress',
      kind: 'edit',
      rawInput: {
        filePath: 'docs/dependency-analysis.md',
        changes: [{
          filePath: 'docs/dependency-analysis.md',
          kind: 'add',
          addedLines: 2,
        }],
      },
    }, 'tool-edit-1'), state);
    const completed = projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      title: 'tool call',
      status: 'completed',
      rawOutput: { content: fileBody, filePath: 'docs/dependency-analysis.md' },
    }, 'tool-edit-1'), state);

    expect(projectedTool(started)).toMatchObject({
      id: 'tool-edit-1',
      status: 'running',
      input: {
        filePath: 'docs/dependency-analysis.md',
        changes: [{ filePath: 'docs/dependency-analysis.md', addedLines: 2 }],
      },
    });
    expect(JSON.stringify(projectedTool(started))).not.toContain(fileBody);
    expect(projectedTool(completed)).toMatchObject({
      id: 'tool-edit-1',
      status: 'completed',
      result: {
        filePath: 'docs/dependency-analysis.md',
        changes: [{ filePath: 'docs/dependency-analysis.md', addedLines: 2 }],
      },
    });
    expect(JSON.stringify(projectedTool(completed))).not.toContain(fileBody);
  });

  test('ignores empty pending search tool placeholders', () => {
    const state: WorkflowRuntimeProjectionState = {
      hasMessageText: false,
      toolObservedAfterMessage: false,
    };

    expect(projectWorkflowRuntimeEvent(runtimeToolEvent('tool.updated', {
      text: 'grep (pending)',
      title: 'grep',
      status: 'pending',
      kind: 'search',
      rawInput: {},
    }), state)).toBeNull();
  });
});
