// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ChatMessage from '@/components/chat/ChatMessage';
import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import { extractSpecCodingRevisionCommand } from '@/lib/spec/coding-revision-protocol';
import { extractStructuredResult } from '@/lib/ai/result-channel';
import {
  extractClarificationFormResult,
  extractPlanDraftResult,
  extractWorkflowDraftPreview,
} from '@/lib/ai/result-normalizers';
import { applyAiSpecCodingDraft } from '@/lib/ai/draft-utils';
import { validateWorkflowDraft } from '@/lib/core/creator-validation';
import { buildCreationSession } from '@/lib/spec/coding-store';
import { creationSessionSchema, specCodingDocumentSchema } from '@/lib/core/schemas';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createAsyncIterable<T>(items: T[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function renderMessage(content: string, extraMessage: Record<string, any> = {}) {
  return render(
    <ChatMessage
      message={{ id: 'm1', role: 'assistant', content, ...extraMessage }}
      onConfirmAction={() => {}}
      onRejectAction={() => {}}
      onUndoAction={() => {}}
      onRetryAction={() => {}}
    />
  );
}

function renderWerewolfMessage(view: { mode: 'god' | 'night'; viewer?: string }) {
  return render(
    <ChatMessage
      message={{
        id: 'ww1',
        role: 'assistant',
        content: '狼人夜间讨论：今晚落刀预言家。',
        rawContent: '狼人夜间讨论：今晚落刀预言家。',
        cards: [{
          type: 'werewolf_speech',
          speakerName: '不动声色的谋略高手',
          speakerType: 'agent',
          actionLabel: '狼人内部会议',
          visibility: 'werewolves',
          audience: ['不动声色的谋略高手'],
          colorIndex: 1,
        }],
      }}
      werewolfView={view}
      onConfirmAction={() => {}}
      onRejectAction={() => {}}
      onUndoAction={() => {}}
      onRetryAction={() => {}}
    />
  );
}

async function openAllDetails(container: HTMLElement) {
  const detailsNodes = Array.from(container.querySelectorAll('details'));
  for (const details of detailsNodes) {
    (details as HTMLDetailsElement).open = true;
    fireEvent(details, new Event('toggle'));
  }
  await waitFor(() => {
    expect(container.querySelectorAll('details').length).toBe(detailsNodes.length);
  });
}

function getRenderedText() {
  return document.body.textContent || '';
}

function workflowConfig(projectRoot: string) {
  return {
    workflow: {
      name: 'AI Result Workflow',
      phases: [
        {
          name: 'Implement',
          steps: [
            {
              name: 'Code',
              agent: 'developer',
              task: 'Implement the requested change',
            },
          ],
        },
      ],
      supervisor: { enabled: true, agent: 'default-supervisor' },
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Cover AI result parsing',
    },
  };
}

function baseSpecCoding(projectRoot: string) {
  return buildCreationSession({
    filename: 'ai-result-workflow.yaml',
    workflowName: 'AI Result Workflow',
    mode: 'phase-based',
    workingDirectory: projectRoot,
    workspaceMode: 'in-place',
    requirements: 'Cover AI result parsing',
    config: workflowConfig(projectRoot),
  }).specCoding;
}

async function buildCodexRenderedMessage(events: any[]) {
  vi.resetModules();
  vi.doMock('@/lib/core/command-exists', () => ({
    findCommand: vi.fn(() => '/usr/local/bin/codex'),
    commandExists: vi.fn(() => true),
    getCommonCliSearchPaths: vi.fn(() => []),
  }));
  vi.doMock('@openai/codex-sdk', () => ({
    Codex: class MockCodex {
      startThread() {
        return {
          id: 'thread-1',
          runStreamed: async () => ({
            events: createAsyncIterable(events),
          }),
        };
      }
      resumeThread() {
        return this.startThread();
      }
    },
  }));

  const { CodexEngineWrapper } = await import('@/lib/engines/codex-wrapper');
  const wrapper = new CodexEngineWrapper();
  const chunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (event?.type === 'text' && typeof event.content === 'string') {
      chunks.push(event.content);
    }
  });

  const result = await wrapper.execute({
    prompt: 'test',
    workingDirectory: process.cwd(),
  } as any);

  expect(result.success).toBe(true);
  const content = chunks.join('');
  expect(content).toBe(result.output);

  return {
    content,
    view: renderMessage(content),
  };
}

async function buildClaudeRenderedMessage(messages: any[]) {
  vi.resetModules();
  vi.doMock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(() => createAsyncIterable(messages)),
  }));

  const { ClaudeCodeEngineWrapper } = await import('@/lib/engines/claude-code-wrapper');
  const wrapper = new ClaudeCodeEngineWrapper();
  const chunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (event?.type === 'text' && typeof event.content === 'string') {
      chunks.push(event.content);
    }
  });

  const result = await wrapper.execute({
    prompt: 'test',
    workingDirectory: process.cwd(),
  } as any);

  expect(result.success).toBe(true);
  const content = chunks.join('');
  expect(content).toBe(result.output);

  return {
    content,
    view: renderMessage(content),
  };
}

async function buildAcpRenderedMessage(
  importer: () => Promise<any>,
  exportName: string,
  scenario: (engine: EventEmitter) => void | Promise<void>,
) {
  vi.resetModules();
  vi.doMock('@/lib/engines/acp-engine', () => {
    class MockACPEngine extends EventEmitter {
      async start() {}
      async stop() {}
      async createSession() { return 'session-1'; }
      async resumeSession(sessionId: string) { return sessionId; }
      async setModel() {}
      async sendPrompt() {
        await scenario(this);
        return 'end_turn';
      }
      cancelSession() {}
    }

    return {
      ACPEngine: MockACPEngine,
      logAcpTiming: vi.fn(),
    };
  });

  const mod = await importer();
  const WrapperCtor = mod[exportName];
  const wrapper = new WrapperCtor();
  const chunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (event?.type === 'text' && typeof event.content === 'string') {
      chunks.push(event.content);
    }
  });

  const result = await wrapper.execute({
    prompt: 'test',
    workingDirectory: process.cwd(),
  } as any);

  expect(result.success).toBe(true);
  const content = chunks.join('');
  expect(content).toBe(result.output);

  return {
    content,
    view: renderMessage(content),
  };
}

describe('Wrapper stream markdown rendering', () => {
  test('werewolf history re-renders hidden night actions when switching view', () => {
    const { rerender } = renderWerewolfMessage({ mode: 'night' });
    expect(screen.getByText(/当前视角不可见/)).toBeInTheDocument();
    expect(screen.queryByText(/今晚落刀预言家/)).toBeNull();
    expect(screen.queryByText('不动声色的谋略高手')).toBeNull();
    expect(screen.queryByText('狼人内部会议')).toBeNull();
    expect(screen.queryByText('狼队可见')).toBeNull();
    expect(screen.getByText('隐藏行动')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('不动声色的谋略高手');

    rerender(
      <ChatMessage
        message={{
          id: 'ww1',
          role: 'assistant',
          content: '狼人夜间讨论：今晚落刀预言家。',
          rawContent: '狼人夜间讨论：今晚落刀预言家。',
          cards: [{
            type: 'werewolf_speech',
            speakerName: '不动声色的谋略高手',
            speakerType: 'agent',
            actionLabel: '狼人内部会议',
            visibility: 'werewolves',
            audience: ['不动声色的谋略高手'],
            colorIndex: 1,
          }],
        }}
        werewolfView={{ mode: 'god' }}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(screen.getByText(/今晚落刀预言家/)).toBeInTheDocument();
    expect(screen.queryByText(/当前视角不可见/)).toBeNull();
  });

  test('codex renders command details, short output, and assistant text', async () => {
    const { view } = await buildCodexRenderedMessage([
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'printf "ok"\nprintf "done"',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          aggregated_output: 'ok\ndone',
          exit_code: 0,
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'Done.',
        },
      },
      { type: 'turn.completed' },
    ]);

    expect(screen.getAllByText(/💻 执行命令/).length).toBeGreaterThan(0);
    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('printf "ok"')).toBe(true);
      expect(pageText.includes('ok')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });

  test('codex renders bare result card output without leaking raw json', async () => {
    const { content } = await buildCodexRenderedMessage([
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: [
            '这是总结。',
            '<result>',
            '{"kind":"card","payload":{"header":{"title":"运行摘要"},"blocks":[{"type":"text","content":"已完成"}]}}',
            '</result>',
          ].join('\n'),
        },
      },
      { type: 'turn.completed' },
    ]);

    const parsed = parseActions(content);
    expect(parsed.text).toBe('这是总结。');
    expect(parsed.cards).toHaveLength(1);
    const view = renderMessage(parsed.text, { cards: parsed.cards });
    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('这是总结。')).toBe(true);
      expect(pageText.includes('运行摘要')).toBe(true);
      expect(pageText.includes('已完成')).toBe(true);
    });
  });

  test('codex malformed home_sidebar result is repaired and parsed through parseActions', async () => {
    const { content } = await buildCodexRenderedMessage([
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: [
            '我来打开工作流面板。',
            '<result>',
            '{kind:"home_sidebar",payload:{mode:"active",tabs:["workflow"],activeTab:"workflow",intent:"create-workflow",stage:"spec-draft",summary:"创建工作流",shouldOpenModal:true}}',
            '</result>',
          ].join('\n'),
        },
      },
      { type: 'turn.completed' },
    ]);

    const parsed = parseActions(content);
    expect(parsed.text).toBe('我来打开工作流面板。');
    expect(parsed.sidebarHints).toHaveLength(1);
    expect(parsed.sidebarHints[0]).toMatchObject({
      mode: 'active',
      tabs: ['workflow'],
      activeTab: 'workflow',
      intent: 'create-workflow',
      stage: 'spec-draft',
      summary: '创建工作流',
      shouldOpenModal: true,
    });
  });

  test('claude-code renders tool block, tool result, and final assistant text', async () => {
    const { view } = await buildClaudeRenderedMessage([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: 'tool-1',
            name: 'bash',
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"command":"printf \\"ok\\""}',
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: 0,
        },
      },
      {
        type: 'user',
        parent_tool_use_id: 'tool-1',
        tool_use_result: {
          stdout: 'ok',
          exit_code: 0,
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 1,
          delta: {
            type: 'text_delta',
            text: 'Done.',
          },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done.',
        session_id: 'session-1',
      },
    ]);

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('printf "ok"')).toBe(true);
      expect(pageText.includes('ok')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });

  test('claude wrapper malformed spec revision result is repaired and parsed', async () => {
    const { content } = await buildClaudeRenderedMessage([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: [
              '建议刷新 Spec Coding。',
              '<result>',
              '{kind:"spec_coding_revision",payload:{apply:true,summary:"刷新任务拆分",affectedArtifacts:["tasks.md"],impact:["拆分更细"]}}',
              '</result>',
            ].join('\n'),
          },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done.',
        session_id: 'session-1',
      },
    ]);

    expect(extractSpecCodingRevisionCommand(content)).toEqual({
      type: 'spec-coding-revision',
      apply: true,
      summary: '刷新任务拆分',
      affectedArtifacts: ['tasks.md'],
      impact: ['拆分更细'],
    });
  });

  test('codex wrapper clarification form result stays hidden while streaming and parses after completion', async () => {
    const finalContent = [
      '先补几个关键问题。',
      '<result>',
      '{kind:"clarification_form",payload:{summary:"需要确认边界",knownFacts:["已提供目录"],missingFields:["目标用户"],questions:[{id:"q1",label:"目标用户",question:"主要给谁用？",selectionMode:"single",options:[{id:"dev",label:"开发者",description:"面向研发",recommended:true}]}]}}',
      '</result>',
    ].join('\n');

    const streamingView = normalizeAssistantDisplay(finalContent, true);
    expect(streamingView).toEqual({
      visibleText: '先补几个关键问题。',
      hasMachineResult: true,
      hasSidebarHint: false,
    });

    const { content } = await buildCodexRenderedMessage([
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: finalContent,
        },
      },
      { type: 'turn.completed' },
    ]);

    const parsed = extractStructuredResult(content, (value: any): value is any => value?.kind === 'clarification_form');
    expect(parsed).toMatchObject({
      kind: 'clarification_form',
      payload: {
        summary: '需要确认边界',
        knownFacts: ['已提供目录'],
        missingFields: ['目标用户'],
      },
    });
    expect(parsed?.payload?.questions).toHaveLength(1);
    const clarificationForm = extractClarificationFormResult(content);
    expect(clarificationForm).toMatchObject({
      type: 'clarification_form',
      summary: '需要确认边界',
      knownFacts: ['已提供目录'],
      missingFields: ['目标用户'],
    });
    expect(clarificationForm?.questions).toHaveLength(1);

    const projectRoot = mkdtempSync(join(tmpdir(), 'ace-ai-result-'));
    const session = buildCreationSession({
      filename: 'ai-result-workflow.yaml',
      workflowName: 'AI Result Workflow',
      mode: 'phase-based',
      workingDirectory: projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Cover AI result parsing',
      config: workflowConfig(projectRoot),
      uiState: {
        formStep: 2,
        planningStage: 'awaiting-answers',
        clarificationForm: clarificationForm!,
        clarificationAnswers: {},
      },
    });
    expect(creationSessionSchema.parse(session).uiState?.clarificationForm?.type).toBe('clarification_form');
    expect(normalizeAssistantDisplay(content, false)).toEqual({
      visibleText: '先补几个关键问题。',
      hasMachineResult: true,
      hasSidebarHint: false,
    });
  });

  test('claude wrapper plan draft result parses after streaming completes', async () => {
    const finalContent = [
      '下面是计划草案。',
      '<result>',
      '{kind:"plan_draft",payload:{summary:"实现首页历史查询",goals:["支持分页"],nonGoals:["不改运行引擎"],constraints:["保持现有风格"],clarification:{summary:"需求已明确",knownFacts:["需要管理员筛选"],missingFields:[],questions:[]},artifacts:{requirements:"# requirements",design:"# design",tasks:"# tasks"}}}',
      '</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(finalContent, true).visibleText).toBe('下面是计划草案。');

    const { content } = await buildClaudeRenderedMessage([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'text_delta',
            text: finalContent,
          },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Done.',
        session_id: 'session-1',
      },
    ]);

    const parsed = extractStructuredResult(content, (value: any): value is any => value?.kind === 'plan_draft');
    expect(parsed).toMatchObject({
      kind: 'plan_draft',
      payload: {
        summary: '实现首页历史查询',
        goals: ['支持分页'],
        nonGoals: ['不改运行引擎'],
        constraints: ['保持现有风格'],
      },
    });
    expect(parsed?.payload?.artifacts).toMatchObject({
      requirements: '# requirements',
      design: '# design',
      tasks: '# tasks',
    });
    const planDraft = extractPlanDraftResult(content);
    expect(planDraft).toMatchObject({
      type: 'plan_draft',
      summary: '实现首页历史查询',
      goals: ['支持分页'],
      nonGoals: ['不改运行引擎'],
      constraints: ['保持现有风格'],
    });

    const specCoding = applyAiSpecCodingDraft(baseSpecCoding(process.cwd()), planDraft);
    expect(specCodingDocumentSchema.parse(specCoding).artifacts).toMatchObject({
      requirements: '# requirements',
      design: '# design',
      tasks: '# tasks',
    });
  });

  test('acp wrapper workflow draft result parses after streaming completes', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'ace-ai-result-'));
    const finalContent = [
      '这是 workflow 草案。',
      '<result>',
      `{kind:"workflow_draft",payload:{filename:"history.yaml",summary:"历史查询工作流",config:{workflow:{name:"history-query",phases:[{name:"Implement",steps:[{name:"Code",agent:"developer",task:"Implement"}]}],supervisor:{enabled:true,agent:"default-supervisor"}},context:{projectRoot:${JSON.stringify(projectRoot)},workspaceMode:"in-place"}}}}`,
      '</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(finalContent, true).visibleText).toBe('这是 workflow 草案。');

    const { content } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('agent-message', finalContent);
      },
    );

    const parsed = extractStructuredResult(content, (value: any): value is any => value?.kind === 'workflow_draft');
    expect(parsed).toEqual({
      kind: 'workflow_draft',
      payload: {
        filename: 'history.yaml',
          summary: '历史查询工作流',
          config: {
          workflow: {
            name: 'history-query',
            phases: [{ name: 'Implement', steps: [{ name: 'Code', agent: 'developer', task: 'Implement' }] }],
            supervisor: { enabled: true, agent: 'default-supervisor' },
          },
          context: { projectRoot, workspaceMode: 'in-place' },
        },
      },
    });
    const preview = extractWorkflowDraftPreview(content, 'fallback.yaml');
    expect(preview).toMatchObject({
      source: 'result-json',
      filename: 'history.yaml',
      summary: '历史查询工作流',
    });
    expect(preview.config).toMatchObject({
      workflow: { name: 'history-query' },
      context: { projectRoot, workspaceMode: 'in-place' },
    });
    expect(validateWorkflowDraft(preview.config).ok).toBe(true);
    expect(normalizeAssistantDisplay(content, false)).toEqual({
      visibleText: '这是 workflow 草案。',
      hasMachineResult: true,
      hasSidebarHint: false,
    });
  });

  test('acp wrappers render shared tool/output contract through opencode', async () => {
    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'tool-1',
          title: 'bash',
          rawInput: {
            command: 'printf "ok"',
          },
        });
        engine.emit('tool-call-update', {
          id: 'tool-1',
          status: 'completed',
          rawInput: {
            command: 'printf "ok"',
          },
          rawOutput: {
            output: 'ok',
            exit: 0,
          },
        });
        engine.emit('agent-message', 'Done.');
      },
    );

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('printf "ok"')).toBe(true);
      expect(pageText.includes('ok')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });

  test('cursor renders buffered tool result with the same markdown contract', async () => {
    const longOutput = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n');
    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/cursor-wrapper'),
      'CursorEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'tool-1',
          title: 'Terminal',
          kind: 'shell',
          rawInput: {},
        });
        engine.emit('permission', {
          toolCall: {
            toolCallId: 'tool-1',
            title: 'cat output.log',
            kind: 'shell',
          },
        });
        engine.emit('tool-call-update', {
          id: 'tool-1',
          status: 'completed',
          title: 'Terminal',
          kind: 'shell',
          rawInput: {
            command: 'cat output.log',
          },
          rawOutput: {
            output: longOutput,
            exit: 0,
          },
        });
        engine.emit('agent-message', 'Done.');
      },
    );

    expect(screen.getByText(/查看输出 \(20 行\)/)).toBeTruthy();
    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('cat output.log')).toBe(true);
      expect(pageText.includes('line 1')).toBe(true);
      expect(pageText.includes('line 20')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });
});
