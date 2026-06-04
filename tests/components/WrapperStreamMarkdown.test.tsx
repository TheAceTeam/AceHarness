// @vitest-environment jsdom
import React from 'react';
import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ChatMessage from '@/components/chat/ChatMessage';
import { normalizeAssistantDisplay, parseActions } from '@/lib/chat/actions';
import { extractAceProcessBlocks, mergeAceSubtaskChunks, mergeFinalRawStreamContent, wrapAceProcessBlock } from '@/lib/chat/ai-process-blocks';
import { sendPromptWithOpenCodeHttp } from '@/lib/engines/opencode-http-adapter';
import { normalizeEngineOutput } from '@/lib/engines/engine-output';
import type { EngineStreamEvent } from '@/lib/engines/engine-interface';
import { createStreamingDisplayCapability } from '@/lib/sidebar-plugins/capabilities/streaming-display';
import { extractSpecCodingRevisionCommand } from '@/lib/spec/coding-revision-protocol';
import { extractStructuredResult } from '@/lib/ai/result-channel';
import { extractPlanDraftResult } from '@/lib/ai/result-normalizers';
import {
  WORKFLOW_CLARIFICATION_QUESTION_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  applyWorkflowCreationItem,
  assembleClarificationForm,
  createEmptyWorkflowCreationState,
  extractWorkflowCreationItemResult,
} from '@/lib/ai/workflow-creation-items';
import { applyAiSpecCodingDraft } from '@/lib/ai/draft-utils';
import { buildCreationSession } from '@/lib/spec/coding-store';
import { creationSessionSchema, specCodingDocumentSchema } from '@/lib/core/schemas';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatAceFileChangesResult, formatAceToolCall, formatAceToolResult } from '@/lib/chat/ace-process-formatters';
import {
  REAL_OPENCODE_CONNECTED_REPLAY,
  REAL_OPENCODE_DONE_RESULT,
  REAL_OPENCODE_RESULT_TAIL_DELTAS,
  REAL_OPENCODE_SPLIT_THINKING_TRANSCRIPT,
} from '../fixtures/real-engine-events';

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

function renderWrapperStream(
  events: Array<{ type: 'text' | 'thought'; content: string }>,
  options: { isStreaming?: boolean } = {},
) {
  let rawContent = '';
  let textContent = '';
  for (const event of events) {
    rawContent += event.content;
    if (event.type === 'text') {
      textContent += event.content;
    }
  }

  const visible = extractAceProcessBlocks(rawContent || textContent).cleanText;
  return render(
    <ChatMessage
      message={{
        id: 'stream-1',
        role: 'assistant',
        content: visible,
        rawContent,
      }}
      isStreaming={options.isStreaming}
      onConfirmAction={() => {}}
      onRejectAction={() => {}}
      onUndoAction={() => {}}
      onRetryAction={() => {}}
    />
  );
}

async function openAllDetails(container: HTMLElement) {
  for (let pass = 0; pass < 5; pass++) {
    const detailsNodes = Array.from(container.querySelectorAll('details:not([open])'));
    for (const details of detailsNodes) {
      (details as HTMLDetailsElement).open = true;
      fireEvent(details, new Event('toggle'));
    }
    const collapsibleTriggers = Array.from(container.querySelectorAll('button[aria-expanded="false"]'));
    if (!detailsNodes.length && !collapsibleTriggers.length) break;
    for (const trigger of collapsibleTriggers) {
      fireEvent.click(trigger);
    }
    await Promise.resolve();
  }
  await Promise.resolve();
}

function getRenderedText() {
  return document.body.textContent || '';
}

function expectNoProtocolLeak(container: HTMLElement) {
  const text = container.textContent || '';
  const html = container.innerHTML;
  expect(text.includes('<ace-process>')).toBe(false);
  expect(text.includes('</ace-process>')).toBe(false);
  expect(text.includes('<think>')).toBe(false);
  expect(text.includes('</think>')).toBe(false);
  expect(html.includes('&lt;ace-process&gt;')).toBe(false);
  expect(html.includes('&lt;/ace-process&gt;')).toBe(false);
  expect(html.includes('&lt;think&gt;')).toBe(false);
  expect(html.includes('&lt;/think&gt;')).toBe(false);
}

function getProcessUiSummary(container: HTMLElement) {
  return {
    reasoning: container.querySelectorAll('[data-testid="ace-reasoning"]').length,
    tools: Array.from(container.querySelectorAll('[data-testid="ace-tool-card"]')).map((node) => node.getAttribute('data-tool-name') || ''),
    subtasks: container.querySelectorAll('[data-testid="ace-subtask-card"]').length,
  };
}

function getToolCards(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid="ace-tool-card"]')).map((card) => {
    const trigger = card.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
    return {
      node: card as HTMLElement,
      toolId: card.getAttribute('data-tool-id') || '',
      toolName: card.getAttribute('data-tool-name') || '',
      state: card.getAttribute('data-tool-state') || '',
      expanded: trigger?.getAttribute('aria-expanded') === 'true',
      text: (card.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
}

function getSubtaskCards(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-testid="ace-subtask-card"]')).map((card) => {
    const trigger = card.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
    return {
      node: card as HTMLElement,
      toolId: card.getAttribute('data-tool-id') || '',
      sessionId: card.getAttribute('data-session-id') || '',
      state: card.getAttribute('data-subtask-state') || '',
      expanded: trigger?.getAttribute('aria-expanded') === 'true',
      text: (card.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  });
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
  const rawChunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (typeof event?.content !== 'string') return;
    rawChunks.push(event.content);
    if (event?.type === 'text') chunks.push(event.content);
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
    rawContent: rawChunks.join(''),
    view: renderMessage(content, { rawContent: rawChunks.join('') }),
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
  const rawChunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (typeof event?.content !== 'string') return;
    rawChunks.push(event.content);
    if (event?.type === 'text') chunks.push(event.content);
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
    rawContent: rawChunks.join(''),
    view: renderMessage(content, { rawContent: rawChunks.join('') }),
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
      async recoverLatestAssistantMessage() { return ''; }
      async sendPrompt() {
        await scenario(this);
        return { stopReason: 'end_turn', usage: null };
      }
      cancelSession() {}
    }

    return {
      ACPEngine: MockACPEngine,
      buildAcpProcessReuseKey: vi.fn((config: unknown) => JSON.stringify(config ?? {})),
      logAcpTiming: vi.fn(),
    };
  });

  const mod = await importer();
  const WrapperCtor = mod[exportName];
  const wrapper = new WrapperCtor();
  const chunks: string[] = [];
  const rawChunks: string[] = [];
  wrapper.on('stream', (event: any) => {
    if (typeof event?.content !== 'string') return;
    rawChunks.push(event.content);
    if (event?.type === 'text') chunks.push(event.content);
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
    rawContent: rawChunks.join(''),
    view: renderMessage(content, { rawContent: rawChunks.join('') }),
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

  test('claude-code hides sdk thinking token accounting messages', async () => {
    const { content, rawContent, view } = await buildClaudeRenderedMessage([
      {
        type: 'system',
        subtype: 'thinking_tokens',
        message: 'thinking_tokens: 1024',
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'thinking_delta',
            thinking: 'First thought. ',
          },
        },
      },
      {
        type: 'system',
        subtype: 'usage',
        message: '[SDK] thinking_tokens',
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'thinking_delta',
            thinking: 'Second thought.',
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
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

    expect(content).toBe('Done.');
    expect(rawContent.includes('[SDK] thinking_tokens')).toBe(false);
    expect(rawContent.includes('thinking_tokens: 1024')).toBe(false);
    await openAllDetails(view.container);
    expect(view.container.querySelectorAll('[data-testid="ace-reasoning"]')).toHaveLength(1);
    const reasoningText = view.container.querySelector('[data-testid="ace-reasoning-content"]')?.textContent || '';
    expect(reasoningText).toContain('First thought.');
    expect(reasoningText).toContain('Second thought.');
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

  test('codex wrapper workflow clarification item stays hidden while streaming and parses after completion', async () => {
    const finalContent = [
      '先补几个关键问题。',
      '<result>',
      '{kind:"workflow_clarification_question",data:{id:"target_outcome",label:"目标结果",question:"主要给谁用，这会影响角色和验收口径？",selectionMode:"single",options:[{id:"dev",label:"开发者",description:"面向研发",recommended:true},{id:"ops",label:"运维",description:"面向运维"}],placeholder:"默认面向开发者。",required:true}}',
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

    const parsed = extractStructuredResult(content, (value: any): value is any => value?.kind === WORKFLOW_CLARIFICATION_QUESTION_KIND);
    expect(parsed).toMatchObject({
      kind: WORKFLOW_CLARIFICATION_QUESTION_KIND,
      data: {
        id: 'target_outcome',
        label: '目标结果',
      },
    });
    const item = extractWorkflowCreationItemResult(content, WORKFLOW_CLARIFICATION_QUESTION_KIND);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    const creationState = applyWorkflowCreationItem(createEmptyWorkflowCreationState(), item.result);
    const clarificationForm = assembleClarificationForm(creationState);
    expect(clarificationForm.questions[0]).toMatchObject({
      id: 'target_outcome',
      label: '目标结果',
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

  test('acp wrapper workflow outline item parses after streaming completes', async () => {
    const finalContent = [
      '这是 workflow 状态轮廓。',
      '<result>',
      '{kind:"workflow_state_outline",data:{states:[{name:"需求确认",description:"确认范围"},{name:"实现验证",description:"实现和测试"},{name:"完成",description:"汇总交付",isFinal:true}]}}',
      '</result>',
    ].join('\n');

    expect(normalizeAssistantDisplay(finalContent, true).visibleText).toBe('这是 workflow 状态轮廓。');

    const { content } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('agent-message', finalContent);
      },
    );

    const parsed = extractStructuredResult(content, (value: any): value is any => value?.kind === WORKFLOW_STATE_OUTLINE_KIND);
    expect(parsed).toEqual({
      kind: WORKFLOW_STATE_OUTLINE_KIND,
      data: {
        states: [
          { name: '需求确认', description: '确认范围' },
          { name: '实现验证', description: '实现和测试' },
          { name: '完成', description: '汇总交付', isFinal: true },
        ],
      },
    });
    const item = extractWorkflowCreationItemResult(content, WORKFLOW_STATE_OUTLINE_KIND);
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    const creationState = applyWorkflowCreationItem(createEmptyWorkflowCreationState(), item.result);
    expect(creationState.workflow.outline.map((state) => state.name)).toEqual(['需求确认', '实现验证', '完成']);
    expect(normalizeAssistantDisplay(content, false)).toEqual({
      visibleText: '这是 workflow 状态轮廓。',
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

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('cat output.log')).toBe(true);
      expect(pageText.includes('line 1')).toBe(true);
      expect(pageText.includes('line 20')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });

  test('cursor preserves structured task result objects', async () => {
    vi.resetModules();
    vi.doMock('@/lib/engines/acp-engine', () => {
      class MockACPEngine extends EventEmitter {
        async start() {}
        async stop() {}
        async createSession() { return 'session-1'; }
        async resumeSession(sessionId: string) { return sessionId; }
        async setModel() {}
        async sendPrompt() {
          this.emit('tool-call-update', {
            id: 'task-1',
            status: 'completed',
            title: 'task',
            kind: 'task',
            rawOutput: {
              sessionId: 'cursor-task-7',
              resultText: 'Cursor task completed',
              output: 'Cursor task completed',
            },
          });
          return 'end_turn';
        }
        cancelSession() {}
      }

      return {
        ACPEngine: MockACPEngine,
        buildAcpProcessReuseKey: vi.fn((config: unknown) => JSON.stringify(config ?? {})),
        logAcpTiming: vi.fn(),
      };
    });

    const { CursorEngineWrapper } = await import('@/lib/engines/cursor-wrapper');
    const wrapper = new CursorEngineWrapper();
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

    expect(content.includes('"kind":"subtask-result"')).toBe(true);
    expect(content.includes('"sessionId":"cursor-task-7"')).toBe(true);
    expect(content.includes('"resultText":"Cursor task completed"')).toBe(true);
  });

  test('kiro renders structured todos read search and file changes without wrapper-authored prose', async () => {
    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/kiro-cli-wrapper'),
      'KiroCliEngineWrapper',
      async (engine) => {
        engine.emit('tool-call-update', {
          id: 'tool-1',
          status: 'completed',
          title: 'grep',
          rawInput: { pattern: 'TODO', path: 'src' },
          rawOutput: {
            items: [
              {
                Json: {
                  tasks: [
                    { id: '1', description: 'first task', completed: false },
                    { id: '2', task_description: 'second task', completed: true },
                  ],
                },
              },
              { Json: { content: 'export const x = 1;', path: 'src/a.ts' } },
              { Json: { numMatches: 2, numFiles: 1, results: [{ file: 'src/a.ts', count: 2 }] } },
              { Json: { modified_files: ['src/a.ts', 'src/b.ts'] } },
            ],
          },
        });
      },
    );

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('first task')).toBe(true);
      expect(pageText.includes('second task')).toBe(true);
      expect(pageText.includes('export const x = 1;')).toBe(true);
      expect(pageText.includes('src/a.ts')).toBe(true);
      expect(pageText.includes('src/b.ts')).toBe(true);
      expect(pageText.includes('找到 2 个匹配')).toBe(true);
      expect(pageText.includes('📋 任务列表')).toBe(true);
    });
  });

  test('codex classifies common windows commands into read grep and ls tool cards', async () => {
    const { view } = await buildCodexRenderedMessage([
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'Get-ChildItem -Force',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'Get-ChildItem -Force',
          aggregated_output: 'Directory: C:\\work',
          exit_code: 0,
        },
      },
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'Select-String -Path src\\*.ts -Pattern "TODO"',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'Select-String -Path src\\*.ts -Pattern "TODO"',
          aggregated_output: 'src\\a.ts:1: TODO',
          exit_code: 0,
        },
      },
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'Get-Content README.md',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'Get-Content README.md',
          aggregated_output: '# Title',
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

    expect(screen.getAllByText(/📂 列出目录/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/🔍 搜索内容/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/📖 读取文件/).length).toBeGreaterThan(0);
    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('Get-ChildItem -Force')).toBe(true);
      expect(pageText.includes('Select-String -Path src\\*.ts -Pattern "TODO"')).toBe(true);
      expect(pageText.includes('Get-Content README.md')).toBe(true);
      expect(pageText.includes('Done.')).toBe(true);
    });
  });

  test('shared ACP wrapper renders task, todo, webfetch, websearch, and patch-edit tool states', async () => {
    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'task-1',
          title: 'task',
          rawInput: {
            description: 'Inspect routing layer',
            prompt: 'Read the stream route and report how process blocks flow to ChatMessage.',
            subagent_type: 'explorer',
          },
        });
        engine.emit('tool-call-update', {
          id: 'task-1',
          status: 'completed',
          title: 'task',
          rawInput: {
            description: 'Inspect routing layer',
            prompt: 'Read the stream route and report how process blocks flow to ChatMessage.',
            subagent_type: 'explorer',
          },
          rawOutput: {
            sessionId: 'task-1-session',
            resultText: 'Raw content now stays structured through ace-process.',
          },
        });

        engine.emit('tool-call', {
          id: 'todo-1',
          title: 'todowrite',
          rawInput: {
            todos: [
              { content: 'Wire wrapper protocol', status: 'completed' },
              { content: 'Add DOM coverage', status: 'in_progress' },
            ],
          },
        });

        engine.emit('tool-call', {
          id: 'webfetch-1',
          title: 'webfetch',
          rawInput: {
            url: 'https://example.com/spec',
          },
        });

        engine.emit('tool-call', {
          id: 'websearch-1',
          title: 'websearch',
          rawInput: {
            query: 'ace process rendering',
          },
        });

        engine.emit('tool-call', {
          id: 'patch-1',
          title: 'patch',
          rawInput: {
            filePath: 'src/demo.ts',
            oldString: 'const before = 1;',
            newString: 'const after = 2;',
          },
        });
        engine.emit('tool-call-update', {
          id: 'patch-1',
          status: 'completed',
          title: 'patch',
          rawInput: {
            filePath: 'src/demo.ts',
            oldString: 'const before = 1;',
            newString: 'const after = 2;',
          },
          rawOutput: {
            output: 'Patch applied successfully.',
          },
        });

        engine.emit('agent-message', 'All wrapper process events rendered.');
      },
    );

    await openAllDetails(view.container);

    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('Inspect routing layer')).toBe(true);
      expect(pageText.includes('Read the stream route and report how process blocks flow to ChatMessage.')).toBe(true);
      expect(pageText.includes('Raw content now stays structured through ace-process.')).toBe(true);
      expect(pageText.includes('会话: task-1-session')).toBe(true);
      expect(pageText.includes('Wire wrapper protocol')).toBe(true);
      expect(pageText.includes('Add DOM coverage')).toBe(true);
      expect(pageText.includes('https://example.com/spec')).toBe(true);
      expect(pageText.includes('ace process rendering')).toBe(true);
      expect(pageText.includes('src/demo.ts')).toBe(true);
      expect(pageText.includes('const before = 1;')).toBe(true);
      expect(pageText.includes('const after = 2;')).toBe(true);
      expect(pageText.includes('Patch applied successfully.')).toBe(true);
      expect(pageText.includes('All wrapper process events rendered.')).toBe(true);
    });
  });

  test('opencode todowrite completed raw JSON output stays a task list without leaking a code block', async () => {
    const rawTodoOutput = JSON.stringify([
      {
        content: '探索 jinja 源项目结构，了解需实现的模块',
        status: 'completed',
        priority: 'high',
      },
      {
        content: '检查目标目录 opencode_glm5.1_ace_new',
        status: 'in_progress',
        priority: 'high',
      },
      {
        content: '设计工作流并输出 workflow_draft + home_sidebar',
        status: 'pending',
        priority: 'high',
      },
    ], null, 2);

    const todos = [
      { content: '探索 jinja 源项目结构，了解需实现的模块', status: 'completed', priority: 'high' },
      { content: '检查目标目录 opencode_glm5.1_ace_new', status: 'in_progress', priority: 'high' },
      { content: '设计工作流并输出 workflow_draft + home_sidebar', status: 'pending', priority: 'high' },
    ];

    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'todo-opencode-1',
          title: 'todowrite',
          rawInput: { todos },
        });
        engine.emit('tool-call-update', {
          id: 'todo-opencode-1',
          status: 'completed',
          title: 'todowrite',
          rawInput: { todos },
          rawOutput: `\`\`\`text\n${rawTodoOutput}\n\`\`\``,
        });
      },
    );

    await openAllDetails(view.container);

    expect(view.container.querySelectorAll('[data-testid="ace-todo-queue"]').length).toBe(1);
    expect(screen.getByText('探索 jinja 源项目结构，了解需实现的模块')).toBeInTheDocument();
    expect(screen.getByText('检查目标目录 opencode_glm5.1_ace_new')).toBeInTheDocument();
    expect(screen.getByText('设计工作流并输出 workflow_draft + home_sidebar')).toBeInTheDocument();
    expect(view.container.textContent || '').not.toContain('"priority": "high"');
    expect(view.container.textContent || '').not.toContain('"content": "探索 jinja 源项目结构');
  });

  test('opencode independent subagent task starts render as siblings instead of nested process cards', async () => {
    const { view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'task-1',
          title: 'task',
          rawInput: {
            description: '探索 jinja 源项目结构',
            prompt: 'Explore the jinja source tree and summarize the modules.',
            subagent_type: 'explore',
          },
        });
        engine.emit('tool-call', {
          id: 'task-2',
          title: 'task',
          rawInput: {
            description: '检查目标目录结构',
            prompt: 'Inspect the target directory and list relevant files.',
            subagent_type: 'explore',
          },
        });
        engine.emit('tool-call', {
          id: 'task-3',
          title: 'task',
          rawInput: {
            description: '检查已有工作流和Agent',
            prompt: 'List existing workflow configs and agent configs.',
            subagent_type: 'explore',
          },
        });
        engine.emit('agent-message', 'Subagent tasks started.');
      },
    );

    await openAllDetails(view.container);

    const subtaskCards = getSubtaskCards(view.container);
    expect(subtaskCards).toHaveLength(3);
    expect(subtaskCards[0].text).toContain('探索 jinja 源项目结构');
    expect(subtaskCards[1].text).toContain('检查目标目录结构');
    expect(subtaskCards[2].text).toContain('检查已有工作流和Agent');
    expect(subtaskCards[0].text).not.toContain('检查目标目录结构');
    expect(subtaskCards[0].text).not.toContain('检查已有工作流和Agent');
    expect(subtaskCards[1].text).not.toContain('检查已有工作流和Agent');
  });

  test('claude-code routes scalar tool results through the shared formatter path', async () => {
    const { content, view } = await buildClaudeRenderedMessage([
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
            partial_json: '{"command":"echo scalar"}',
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
        tool_use_result: 'scalar output',
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

    expect(content.includes('"kind":"tool-result"')).toBe(true);
    expect(content.includes('"output":"scalar output"')).toBe(true);

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('echo scalar')).toBe(true);
      expect(pageText.includes('scalar output')).toBe(true);
    });
  });

  test('claude-code preserves structured tool-result objects for shared formatting', async () => {
    const { content, view } = await buildClaudeRenderedMessage([
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
            partial_json: '{"command":"exit 17"}',
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
          output: 'failed',
          exitCode: 17,
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

    expect(content.includes('"exitCode":17')).toBe(true);

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('exit 17')).toBe(true);
      expect(pageText.includes('failed')).toBe(true);
    });
  });

  test('shared ACP wrapper preserves structured rawOutput and converts XML file payloads into ace blocks', async () => {
    const { content, view } = await buildAcpRenderedMessage(
      () => import('@/lib/engines/opencode-wrapper'),
      'OpenCodeEngineWrapper',
      async (engine) => {
        engine.emit('tool-call', {
          id: 'grep-1',
          title: 'grep',
          rawInput: {
            pattern: 'TODO',
            path: 'src',
          },
        });
        engine.emit('tool-call-update', {
          id: 'grep-1',
          status: 'completed',
          title: 'grep',
          rawInput: {
            pattern: 'TODO',
            path: 'src',
          },
          rawOutput: {
            totalMatches: 12,
            totalFiles: 3,
            truncated: true,
          },
        });

        engine.emit('tool-call', {
          id: 'read-1',
          title: 'read',
          rawInput: {
            filePath: 'src/demo.ts',
          },
        });
        engine.emit('tool-call-update', {
          id: 'read-1',
          status: 'completed',
          title: 'read',
          rawInput: {
            filePath: 'src/demo.ts',
          },
          rawOutput: {
            filePath: 'src/demo.ts',
            content: 'export const demo = 1;',
          },
        });
      },
    );

    expect(content.includes('"totalMatches":12')).toBe(false);
    expect(content.includes('"kind":"tool-result"')).toBe(true);
    expect(content.includes('"content":"export const demo = 1;"')).toBe(true);
    expect(content.includes('<details><summary>📄 src/demo.ts')).toBe(false);

    await openAllDetails(view.container);
    await waitFor(() => {
      const pageText = getRenderedText();
      expect(pageText.includes('找到 12 个匹配，3 个文件 (已截断)')).toBe(true);
      expect(pageText.includes('src/demo.ts')).toBe(true);
      expect(pageText.includes('export const demo = 1;')).toBe(true);
    });
  });

  test('opencode http adapter preserves structured task result session ids', async () => {
    const emitted: EngineStreamEvent[] = [];
    const stream = {
      async *[Symbol.asyncIterator]() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        yield {
          type: 'message.part.updated',
          properties: {
            sessionID: 'session-1',
            part: {
              id: 'task-1',
              type: 'tool',
              tool: 'task',
              state: {
                status: 'completed',
                output: {
                  sessionId: 'subtask-9',
                  resultText: 'Structured task result',
                },
              },
            },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield {
          type: 'session.idle',
          properties: {
            sessionID: 'session-1',
          },
        };
      },
    };
    const output = await sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: vi.fn(async () => ({
            stream,
          })),
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => ({ data: {} })),
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: 'test',
      emit: (event) => emitted.push(event),
    });

    expect(output).toBe('');
    const textEvents = emitted.filter((event) => event.type === 'text').map((event) => event.content).join('');
    expect(textEvents.includes('"kind":"subtask-start"')).toBe(true);
    expect(textEvents.includes('"kind":"subtask-result"')).toBe(true);
    expect(textEvents.includes('"sessionId":"subtask-9"')).toBe(true);
    expect(textEvents.includes('"resultText":"Structured task result"')).toBe(true);
  });

  test('opencode http adapter ignores resumed-session replay events before prompt acceptance', async () => {
    const emitted: EngineStreamEvent[] = [];
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'message.part.delta',
          properties: {
            sessionID: 'session-1',
            partID: 'old-text-1',
            field: 'text',
            delta: REAL_OPENCODE_CONNECTED_REPLAY.replayDelta,
          },
        };
        yield {
          type: 'message.part.delta',
          properties: {
            sessionID: 'session-1',
            partID: 'new-text-1',
            field: 'text',
            delta: '新的回答',
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 40));
        yield {
          type: 'session.idle',
          properties: {
            sessionID: 'session-1',
          },
        };
      },
    };

    const output = await sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: vi.fn(async () => ({
            stream,
          })),
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { data: {} };
          }),
          messages: vi.fn(async () => ({
            data: [
              {
                info: { role: 'assistant' },
                parts: [
                  { id: 'new-text-1', type: 'text', text: '新的回答' },
                ],
              },
            ],
          })),
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: 'test',
      emit: (event) => emitted.push(event),
    });

    expect(output).toBe('新的回答');
    const visibleText = emitted.filter((event) => event.type === 'text').map((event) => event.content).join('');
    expect(visibleText).toContain('新的回答');
    expect(visibleText).not.toContain(REAL_OPENCODE_CONNECTED_REPLAY.replayDelta);
  });

  test('opencode http adapter does not leak unknown reasoning deltas into visible text', async () => {
    const emitted: EngineStreamEvent[] = [];
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'message.part.delta',
          properties: {
            sessionID: 'session-1',
            partID: 'reasoning-1',
            field: 'text',
            delta: 'The',
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 450));
        yield {
          type: 'session.idle',
          properties: {
            sessionID: 'session-1',
          },
        };
      },
    };

    let pollCount = 0;
    const messagesMock = vi.fn(async () => {
      pollCount += 1;
      if (pollCount === 1) {
        return { data: [] };
      }
      return {
        data: [
          {
            info: { role: 'assistant' },
            parts: [
              {
                id: 'reasoning-1',
                type: 'reasoning',
                text: 'The user just wants to list workflow configs. I can inspect the config directory.',
              },
              {
                id: 'answer-1',
                type: 'text',
                text: '当前共有 4 个工作流配置。',
              },
            ],
          },
        ],
      };
    });

    const output = await sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: vi.fn(async () => ({
            stream,
          })),
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { data: {} };
          }),
          messages: messagesMock,
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: '列出所有工作流配置',
      emit: (event) => emitted.push(event),
    });

    expect(output).toBe('当前共有 4 个工作流配置。');
    const visibleText = emitted.filter((event) => event.type === 'text').map((event) => event.content).join('');
    const thoughtText = emitted.filter((event) => event.type === 'thought').map((event) => event.content).join('');
    expect(visibleText).toContain('当前共有 4 个工作流配置。');
    expect(visibleText).not.toContain('The user just wants to list workflow configs');
    expect(thoughtText).toContain('The user just wants to list workflow configs');
  });

  test('opencode http adapter preserves text-part order so chat-context keeps the structured result', async () => {
    const emitted: EngineStreamEvent[] = [];
    const prefix = 'LONG_JSON_BEGIN\n<result>';
    const body = '{"kind":"card","payload":{"header":{"title":"Long JSON Stream Probe","status":"ok"},"blocks":[{"type":"text","content":"Alpha block text for stream ordering."}]}}</result>';
    const finalOutput = `${prefix}${body}`;
    let messagePollCount = 0;
    const messagesMock = vi.fn(async () => {
      messagePollCount += 1;
      if (messagePollCount <= 2) {
        return { data: [] };
      }
      return {
        data: [
          {
            info: { role: 'assistant' },
            parts: [
              { id: 'prefix-1', type: 'text', text: prefix },
              { id: 'body-1', type: 'text', text: body },
            ],
          },
        ],
      };
    });
    const stream = {
      async *[Symbol.asyncIterator]() {
        await new Promise((resolve) => setTimeout(resolve, 150));
        yield {
          type: 'message.part.updated',
          properties: {
            sessionID: 'session-1',
            part: {
              id: 'body-1',
              type: 'text',
              text: body,
            },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield {
          type: 'message.part.updated',
          properties: {
            sessionID: 'session-1',
            part: {
              id: 'prefix-1',
              type: 'text',
              text: prefix,
            },
          },
        };
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield {
          type: 'session.idle',
          properties: {
            sessionID: 'session-1',
          },
        };
      },
    };

    const output = await sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: vi.fn(async () => ({
            stream,
          })),
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return { data: {} };
          }),
          messages: messagesMock,
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: 'emit a long card result',
      emit: (event) => emitted.push(event),
    });

    const accumulatedText = emitted
      .filter((event) => event.type === 'text')
      .map((event) => event.content)
      .join('');

    const appendStreamChunk = (previous: string, next: string): string => {
      const base = String(previous || '');
      const chunk = String(next || '');
      if (!chunk) return base;
      if (!base) return chunk;
      if (chunk === base) return base;
      if (chunk.startsWith(base)) return chunk;
      return `${base}${chunk}`;
    };

    const buildFinalRawContent = (
      accumulatedRawStream: string,
      accumulatedVisibleContent: string,
      doneResult: string,
    ): string => {
      const raw = String(accumulatedRawStream || '');
      const visible = String(accumulatedVisibleContent || '');
      const result = String(doneResult || '');

      if (!raw) return result || visible;
      if (!result) return raw;

      const parsedRawText = String(parseActions(raw).text || '').trim();
      const trimmedResult = result.trim();
      const trimmedVisible = visible.trim();

      if (!trimmedResult) return raw;
      if (!parsedRawText) return appendStreamChunk(raw, result);

      if (
        trimmedResult === parsedRawText
        || parsedRawText.endsWith(trimmedResult)
        || trimmedResult.endsWith(parsedRawText)
      ) {
        return raw;
      }

      if (trimmedVisible && result.startsWith(visible)) {
        return appendStreamChunk(raw, result.slice(visible.length));
      }

      return raw;
    };

    const replayedRawContent = buildFinalRawContent(accumulatedText, accumulatedText, output);
    const parsedOutput = parseActions(output);
    const parsedReplayed = parseActions(replayedRawContent);

    expect(output).toBe(finalOutput);
    expect(accumulatedText).toBe(output);
    expect(parsedOutput.cards).toHaveLength(1);
    expect(parsedOutput.text).toBe('LONG_JSON_BEGIN');
    expect(parsedReplayed.cards).toHaveLength(1);
    expect(parsedReplayed.text).toBe('LONG_JSON_BEGIN');
  });

  test('ace-process stream renders reasoning, subtask, tool result, and code blocks through ai-elements', async () => {
    const view = renderWrapperStream([
      {
        type: 'thought',
        content: wrapAceProcessBlock('reasoning', {}, 'Need to inspect the config and patch the wrapper output.'),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-start',
          {
            title: 'Inspect workspace',
            description: 'Inspect workspace',
            agent: 'explorer',
            prompt: 'Read the wrapper files and summarize the process events.',
          },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-result',
          { sessionId: 'subagent-7', resultText: 'Found the tool and reasoning hooks.' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'bash', title: '💻 执行命令', command: 'git diff --stat' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'bash', title: '💻 执行命令', output: 'const changedFiles = 3;\n', exitCode: 0 },
          '',
        ),
      },
      {
        type: 'text',
        content: '\nDone.\n',
      },
    ]);

    await openAllDetails(view.container);

    expect(screen.getByText(/已思考/)).toBeInTheDocument();
    expect(screen.getAllByText('Inspect workspace').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Agent: explorer')).toBeInTheDocument();
    expect(screen.getByText('会话: subagent-7')).toBeInTheDocument();
    expect(screen.getAllByText(/执行命令/).length).toBeGreaterThan(0);
    expect(screen.getByText('const changedFiles = 3;')).toBeInTheDocument();
    expect(screen.getByText('Done.')).toBeInTheDocument();
  });

  test('skill tool renders as a formatted document instead of raw protocol text', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          {
            toolId: 'tool-skill-1',
            toolName: 'skill',
            title: '🔧 skill',
            input: { name: 'cangjie-lang-features' },
          },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          {
            toolId: 'tool-skill-1',
            toolName: 'skill',
            title: '🔧 skill',
            output: [
              '<skill_content name="cangjie-lang-features">',
              '# Skill: cangjie-lang-features',
              '# 仓颉编程语言特性目录',
              '> 请按需查阅相关文档',
              '- [基本概念](./basic_concepts/README.md): 语言核心概念',
              '</skill_content>',
            ].join('\n'),
          },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    const text = view.container.textContent || '';
    expect(screen.getAllByText('技能文档').length).toBeGreaterThan(0);
    expect(text).toContain('cangjie-lang-features');
    expect(text).toContain('仓颉编程语言特性目录');
    expect(text).toContain('基本概念');
    expect(text).not.toContain('<skill_content');
    expect(text).not.toContain('# Skill: cangjie-lang-features');
    expect(text).not.toContain('"name": "cangjie-lang-features"');
  });

  test('read tool for SKILL.md is rendered as a skill document', async () => {
    const raw = [
      formatAceToolCall({
        toolName: 'read',
        toolId: 'read-skill-1',
        rawInput: { filePath: '/repo/skills/workflow-helper/SKILL.md' },
      }),
      formatAceToolResult({
        toolName: 'read',
        toolId: 'read-skill-1',
        rawOutput: {
          filePath: '/repo/skills/workflow-helper/SKILL.md',
          content: '# Workflow Helper\n\nUse this when designing workflows.',
        },
      }),
    ].join('\n');

    const parsed = extractAceProcessBlocks(raw);
    expect(parsed.blocks).toHaveLength(2);
    for (const block of parsed.blocks) {
      if (block.meta.kind === 'tool-call' || block.meta.kind === 'tool-result') {
        expect(block.meta.toolName).toBe('skill');
      }
    }

    const view = renderWrapperStream([{ type: 'text', content: raw }]);
    await openAllDetails(view.container);

    const text = view.container.textContent || '';
    expect(screen.getAllByText('技能文档').length).toBeGreaterThan(0);
    expect(text).toContain('workflow-helper');
    expect(text).toContain('Workflow Helper');
    expect(text).toContain('designing workflows');
  });

  test('shell command reading SKILL.md is rendered as a skill document', async () => {
    const command = '/bin/bash -lc "sed -n \'1,220p\' /root/.aceharness/skills/aceharness-workflow-creator/SKILL.md"';
    const raw = [
      formatAceToolCall({
        toolName: 'read',
        toolId: 'shell-skill-1',
        rawInput: { command },
      }),
      formatAceToolResult({
        toolName: 'read',
        toolId: 'shell-skill-1',
        rawOutput: {
          command,
          output: '# Workflow Creator\n\nUse this when creating workflows.',
          exitCode: 0,
        },
      }),
    ].join('\n');

    const parsed = extractAceProcessBlocks(raw);
    expect(parsed.blocks).toHaveLength(2);
    for (const block of parsed.blocks) {
      if (block.meta.kind === 'tool-call' || block.meta.kind === 'tool-result') {
        expect(block.meta.toolName).toBe('skill');
      }
    }

    const view = renderWrapperStream([{ type: 'text', content: raw }]);
    await openAllDetails(view.container);

    const text = view.container.textContent || '';
    expect(screen.getAllByText('技能文档').length).toBeGreaterThan(0);
    expect(text).toContain('aceharness-workflow-creator');
    expect(text).toContain('Workflow Creator');
    expect(text).toContain('creating workflows');
  });

  test('ace-process stream groups consecutive tool cards into a task container', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-call', { toolId: 'tool-1', toolName: 'glob', title: '🔍 搜索文件', pattern: '**/*.ts', path: 'src' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-result', { toolId: 'tool-1', toolName: 'glob', title: '🔍 搜索文件', output: 'src/a.ts\nsrc/b.ts' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-call', { toolId: 'tool-2', toolName: 'read', title: '📖 读取文件', filePath: 'src/a.ts' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-result', { toolId: 'tool-2', toolName: 'read', title: '📖 读取文件', output: '<path>src/a.ts</path>\n<content>\nconst a = 1;\n</content>' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-call', { toolId: 'tool-3', toolName: 'bash', title: '💻 执行命令', command: 'git status --short' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-result', { toolId: 'tool-3', toolName: 'bash', title: '💻 执行命令', output: 'M src/a.ts\n', exitCode: 0 }, ''),
      },
    ]);

    await openAllDetails(view.container);

    expect(screen.getByText('工具调用已完成')).toBeInTheDocument();
    expect(screen.getByText('3 个步骤')).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-testid="ace-tool-group"]').length).toBe(1);
    expect(view.container.querySelectorAll('[data-testid="ace-tool-card"]').length).toBe(3);
  });

  test('todo tool output renders through queue component', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          {
            toolName: 'todo',
            title: '📋 任务列表',
            todos: [
              { content: 'Wire wrapper protocol', status: 'completed', description: 'shared formatter path' },
              { content: 'Add DOM coverage', status: 'pending' },
            ],
          },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    expect(view.container.querySelectorAll('[data-testid="ace-todo-queue"]').length).toBe(1);
    expect(screen.getByText('Wire wrapper protocol')).toBeInTheDocument();
    expect(screen.getByText('Add DOM coverage')).toBeInTheDocument();
  });

  test('language-aware code blocks render as artifact panels and cangjie blocks expose run action', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          {
            toolId: 'read-cj-1',
            toolName: 'read',
            title: '📖 读取文件',
            filePath: 'demo.cj',
            output: '<path>demo.cj</path>\n<content>\nmain() {\n  println(\"hi\")\n}\n</content>',
          },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    expect(view.container.querySelectorAll('[data-language="cangjie"]').length).toBeGreaterThan(0);
    expect(screen.getByTitle('运行仓颉代码')).toBeInTheDocument();
    expect(screen.getByText('cangjie')).toBeInTheDocument();
  });

  test('ansi terminal output renders without leaking raw escape sequences', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'ls', title: '📂 列出目录', command: 'Get-ChildItem -Force' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          {
            toolName: 'ls',
            title: '📂 列出目录',
            output: '\u001b[32;1mMode \u001b[0m\u001b[32;1mName\u001b[0m\n' +
              'd---- \u001b[44;1m.config\u001b[0m\n' +
              '-a--- engine.json\n',
          },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    const terminalContent = view.container.querySelector('[data-testid="ace-terminal-content"]');
    expect(terminalContent).toBeTruthy();
    expect((terminalContent?.textContent || '').replace(/\s+/g, ' ').trim()).toBe('Mode Name d---- .config -a--- engine.json');
    expect(screen.queryByText('[32;1m')).not.toBeInTheDocument();
    expect(view.container.textContent || '').not.toContain('\u001b[32;1m');
  });

  test('ace-process stream keeps running states visible while streaming', () => {
    renderWrapperStream(
      [
        {
          type: 'thought',
          content: wrapAceProcessBlock('reasoning', {}, 'Still evaluating the next tool call.'),
        },
        {
          type: 'text',
          content: wrapAceProcessBlock(
            'subtask-start',
            {
              title: 'Delegate docs scan',
              description: 'Delegate docs scan',
              agent: 'worker',
            },
            '',
          ),
        },
        {
          type: 'text',
          content: wrapAceProcessBlock(
            'tool-call',
            { toolName: 'read', title: '📖 读取文件', filePath: 'README.md' },
            '',
          ),
        },
      ],
      { isStreaming: true },
    );

    expect(screen.getAllByText('思考中...').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Running').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Delegate docs scan').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/读取文件/)).toBeInTheDocument();
  });

  test('ace-process pairs tool results by toolId in the rendered DOM without cross-wiring cards', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', toolId: 'read-1', title: '📖 读取文件', filePath: 'a.ts' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', toolId: 'read-2', title: '📖 读取文件', filePath: 'b.ts' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'read', toolId: 'read-2', title: '📖 读取文件', filePath: 'b.ts', content: 'export const b = 2;' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'read', toolId: 'read-1', title: '📖 读取文件', filePath: 'a.ts', content: 'export const a = 1;' },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);
    const summary = getProcessUiSummary(view.container);
    expect(summary.reasoning).toBe(0);
    expect(summary.tools).toEqual(['read', 'read']);
    expect(summary.subtasks).toBe(0);
    const cards = getToolCards(view.container);
    expect(cards).toHaveLength(2);

    const cardA = cards.find((card) => card.toolId === 'read-1');
    const cardB = cards.find((card) => card.toolId === 'read-2');
    expect(cardA).toBeTruthy();
    expect(cardB).toBeTruthy();

    const cardADom = cardA!.node;
    const cardBDom = cardB!.node;
    expect(within(cardADom).getAllByText('a.ts').length).toBeGreaterThanOrEqual(1);
    expect(cardADom.textContent || '').toContain('export const a = 1;');
    expect(within(cardADom).queryByText('b.ts')).toBeNull();
    expect(within(cardADom).queryByText(/export const b = 2;/)).toBeNull();

    expect(within(cardBDom).getAllByText('b.ts').length).toBeGreaterThanOrEqual(1);
    expect(cardBDom.textContent || '').toContain('export const b = 2;');
    expect(within(cardBDom).queryByText('a.ts')).toBeNull();
    expect(within(cardBDom).queryByText(/export const a = 1;/)).toBeNull();
  });

  test('ace-process deduplicates repeated no-toolId calls and binds results back by fingerprint or unique pending tool', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', title: '📖 读取文件', filePath: 'workflow.yaml' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', title: '📖 读取文件', filePath: 'workflow.yaml' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'read', title: '📖 读取文件', output: '<path>workflow.yaml</path>\n<content>\nname: demo\n</content>' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'glob', title: '🔍 搜索文件', pattern: '**/*.yaml', path: 'configs', include: '' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'glob', title: '🔍 搜索文件', pattern: '**/*.yaml', path: 'configs', include: '' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'glob', title: '🔍 搜索文件', output: 'configs/workflow.yaml' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'bash', title: '💻 执行命令', command: 'git status --short' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'bash', title: '💻 执行命令', command: 'git status --short' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'bash', title: '💻 执行命令', output: 'M src/a.ts\n', exitCode: 0 },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    const cards = getToolCards(view.container);
    expect(cards).toHaveLength(3);

    const readCards = cards.filter((card) => card.toolName === 'read');
    const globCards = cards.filter((card) => card.toolName === 'glob');
    const bashCards = cards.filter((card) => card.toolName === 'bash');
    expect(readCards).toHaveLength(1);
    expect(globCards).toHaveLength(1);
    expect(bashCards).toHaveLength(1);

    const readCard = readCards[0].node;
    const globCard = globCards[0].node;
    const bashCard = bashCards[0].node;

    expect(readCard.getAttribute('data-tool-state')).toBe('output-available');
    expect(globCard.getAttribute('data-tool-state')).toBe('output-available');
    expect(bashCard.getAttribute('data-tool-state')).toBe('output-available');

    expect(within(readCard).getAllByText('workflow.yaml').length).toBeGreaterThanOrEqual(1);
    expect(within(readCard).getByText('name: demo')).toBeInTheDocument();

    expect(within(globCard).getByText('pattern: **/*.yaml')).toBeInTheDocument();
    expect(within(globCard).getByText('path')).toBeInTheDocument();
    expect(within(globCard).getByText('configs')).toBeInTheDocument();
    expect(within(globCard).getByText('configs/workflow.yaml')).toBeInTheDocument();

    expect(within(bashCard).getAllByText('git status --short').length).toBe(1);
    expect(within(bashCard).getByText('M src/a.ts')).toBeInTheDocument();

    const triggers = Array.from(view.container.querySelectorAll('button[aria-expanded]')) as HTMLButtonElement[];
    const runningLabels = triggers.filter((button) => button.textContent === 'Running');
    expect(runningLabels).toHaveLength(0);
  });

  test('powershell tool card does not repeat the same command in summary and details', async () => {
    const command = '"C:\\\\Program Files\\\\PowerShell\\\\7\\\\pwsh.exe" -Command "@\' {\\\"header\\\":{\\\"title\\\":\\\"工作流配置总览\\\"}} \'@ | node validate-card.mjs"';
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolId: 'pwsh-1', toolName: 'powershell', title: '🖥️ 执行命令', command },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolId: 'pwsh-1', toolName: 'powershell', title: '🖥️ 执行命令', output: 'VALID ✓', exitCode: 0 },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    const cards = getToolCards(view.container);
    const powershellCards = cards.filter((card) => card.toolName === 'powershell');
    expect(powershellCards).toHaveLength(1);

    const powershellCard = powershellCards[0].node;
    expect(within(powershellCard).getAllByText(command).length).toBe(1);
    expect(within(powershellCard).getByText('VALID ✓')).toBeInTheDocument();
  });

  test('ace-process binds read results using <path> from content and merges subtask result into the only pending subtask', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', title: '📖 读取文件', content: '<path>C:/repo/README.md</path>' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'read', title: '📖 读取文件', content: '<path>C:/repo/README.md</path>\n<content>\n# Demo\n</content>' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-start',
          { title: 'Inspect docs', description: 'Inspect docs', agent: 'worker', prompt: 'Check README rendering.' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-result',
          { resultText: 'README renders through the shared chat pipeline.' },
          '',
        ),
      },
    ]);

    await openAllDetails(view.container);

    const toolCards = getToolCards(view.container);
    expect(toolCards).toHaveLength(1);
    const readCard = toolCards[0].node;
    expect(readCard.getAttribute('data-tool-state')).toBe('output-available');
    expect(within(readCard).getAllByText('C:/repo/README.md').length).toBeGreaterThanOrEqual(1);
    expect(within(readCard).getByText('# Demo')).toBeInTheDocument();

    const subtaskCards = getSubtaskCards(view.container);
    expect(subtaskCards).toHaveLength(1);
    expect(subtaskCards[0].node.getAttribute('data-subtask-state')).toBe('output-available');
    expect(within(subtaskCards[0].node).getAllByText('Inspect docs').length).toBeGreaterThanOrEqual(1);
    expect(within(subtaskCards[0].node).getByText('README renders through the shared chat pipeline.')).toBeInTheDocument();
  });

  test('ace-process renders subtask titles with robot prefix and keeps internal messages inside the subtask card', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-start',
          { title: 'Find workflow config files', description: 'Find workflow config files', agent: 'worker', prompt: 'Find config files.', toolId: 'task-find-config' },
          '',
        ),
      },
      {
        type: 'text',
        content: '\nChecking configs/workflows first.\n',
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolId: 'nested-glob', toolName: 'glob', title: '🔍 搜索文件', pattern: '*.yaml', path: 'configs' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolId: 'nested-glob', toolName: 'glob', title: '🔍 搜索文件', output: 'configs/workflows/demo.yaml' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-result',
          { toolId: 'task-find-config', resultText: 'Found workflow config files.' },
          '',
        ),
      },
      {
        type: 'text',
        content: '\nBack in the parent assistant message.\n',
      },
    ]);

    await openAllDetails(view.container);

    const subtaskCards = getSubtaskCards(view.container);
    expect(subtaskCards).toHaveLength(1);
    expect(subtaskCards[0].text).toContain('🤖 Find workflow config files');
    expect(within(subtaskCards[0].node).getByText('Checking configs/workflows first.')).toBeInTheDocument();
    expect(subtaskCards[0].text).toContain('configs/workflows/demo.yaml');
    expect(within(subtaskCards[0].node).getByText('Found workflow config files.')).toBeInTheDocument();

    expect(screen.getByText('Back in the parent assistant message.')).toBeInTheDocument();
    expectNoProtocolLeak(view.container);
  });

  test('ace-process chunk merging keeps subtask stream chunks together for Workbench-style rendering', () => {
    const chunks = mergeAceSubtaskChunks([
      wrapAceProcessBlock(
        'subtask-start',
        { title: 'Find workflow config files', description: 'Find workflow config files', toolId: 'task-find-config' },
        '',
      ),
      'Checking configs/workflows first.',
      wrapAceProcessBlock(
        'subtask-result',
        { toolId: 'task-find-config', resultText: 'Found workflow config files.' },
        '',
      ),
      'Parent message continues.',
    ]);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toContain('Find workflow config files');
    expect(chunks[0]).toContain('Checking configs/workflows first.');
    expect(chunks[0]).toContain('Found workflow config files.');
    expect(chunks[1]).toBe('Parent message continues.');
  });

  test('streaming assistant bubble does not leak action json text', () => {
    const actionJson = '```json\n{"type":"config.list","params":{},"description":"列出当前可用的工作流配置，便于按名称、模式和用途整理"}\n```';
    const view = render(
      <ChatMessage
        message={{
          id: 'stream-action-only',
          role: 'assistant',
          content: '',
          rawContent: actionJson,
        }}
        isStreaming
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(view.container.textContent || '').not.toContain('"type":"config.list"');
    expect(view.container.textContent || '').not.toContain('"description":"列出当前可用的工作流配置');
    expect(view.container.textContent || '').toContain('思考中...');
  });

  test('plan tool result renders entries instead of raw text-fenced json', async () => {
    const planPayload = {
      entries: [
        { content: '确认 plan 工具输出形态', status: 'completed', priority: 'medium' },
        { content: '从 plan 渲染源头修复', status: 'pending', priority: 'high' },
      ],
    };
    const content = [
      wrapAceProcessBlock('tool-call', { toolName: 'plan', title: 'Plan' }, ''),
      formatAceToolResult({
        toolName: 'plan',
        title: 'Plan',
        rawOutput: {
          output: [
            '```text',
            JSON.stringify(planPayload),
            '```',
          ].join('\n'),
        },
      }),
    ].join('\n');

    const view = renderMessage(content, { rawContent: content });
    await openAllDetails(view.container);

    expect(view.container.querySelector('[data-testid="ace-tool-card"]')?.getAttribute('data-tool-name')).toBe('plan');
    expect(view.container.textContent || '').toContain('确认 plan 工具输出形态');
    expect(view.container.textContent || '').toContain('从 plan 渲染源头修复');
    expect(view.container.textContent || '').not.toContain('"entries"');
    expect(view.container.textContent || '').not.toContain('"priority"');
  });

  test('tool group collapses after streaming completes and ls path preview shows label', async () => {
    const content = [
      wrapAceProcessBlock('tool-call', { toolName: 'ls', title: '📂 列出目录', path: '.' }, ''),
      wrapAceProcessBlock('tool-result', { toolName: 'ls', title: '📂 列出目录', output: 'file-a\nfile-b', exitCode: 0 }, ''),
      wrapAceProcessBlock('tool-call', { toolName: 'read', title: '📖 读取文件', filePath: 'README.md' }, ''),
      wrapAceProcessBlock('tool-result', { toolName: 'read', title: '📖 读取文件', content: '# Title' }, ''),
    ].join('\n');

    const view = render(
      <ChatMessage
        message={{
          id: 'tool-group-close',
          role: 'assistant',
          content: extractAceProcessBlocks(content).cleanText,
          rawContent: content,
        }}
        isStreaming
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );
    await openAllDetails(view.container);

    expect(view.container.textContent || '').toContain('path');
    expect(view.container.textContent || '').toContain('README.md');

    view.rerender(
      <ChatMessage
        message={{
          id: 'tool-group-close',
          role: 'assistant',
          content: extractAceProcessBlocks(content).cleanText,
          rawContent: content,
        }}
        isStreaming={false}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );
    const group = view.container.querySelector('[data-testid="ace-tool-group"]');
    expect(group?.getAttribute('data-state')).toBe('closed');
  });

  test('bash results without toolId fall back to the earliest pending bash call', async () => {
    const view = renderWrapperStream([
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-call', { toolName: 'bash', title: '💻 执行命令', command: 'cmd-one' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-call', { toolName: 'bash', title: '💻 执行命令', command: 'cmd-two' }, ''),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock('tool-result', { toolName: 'bash', title: '💻 执行命令', output: 'first-output', exitCode: 0 }, ''),
      },
    ], { isStreaming: true });

    await openAllDetails(view.container);
    const toolCards = getToolCards(view.container);
    expect(toolCards).toHaveLength(2);
    expect(toolCards[0].node.getAttribute('data-tool-state')).toBe('output-available');
    expect(toolCards[1].node.getAttribute('data-tool-state')).toBe('input-available');
    expect(within(toolCards[0].node).getAllByText('cmd-one').length).toBeGreaterThanOrEqual(1);
    expect(within(toolCards[0].node).getByText('first-output')).toBeInTheDocument();
    expect(within(toolCards[1].node).getAllByText('cmd-two').length).toBeGreaterThanOrEqual(1);
  });

  test('ace-process reasoning stays collapsed by default and subtask results bind to the correct DOM card', async () => {
    const view = renderWrapperStream([
      {
        type: 'thought',
        content: wrapAceProcessBlock('reasoning', {}, 'Structured thinking content stays in reasoning UI.'),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          { toolName: 'read', title: '📖 读取文件', filePath: 'README.md' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          { toolName: 'read', title: '📖 读取文件', filePath: 'README.md', content: '# Title' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-start',
          { title: 'Inspect wrapper flow', description: 'Inspect wrapper flow', agent: 'worker', prompt: 'Trace the stream pipeline.', toolId: 'task-17' },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'subtask-result',
          { toolId: 'task-17', sessionId: 'task-17', resultText: 'The UI consumes only ace-process JSON blocks.' },
          '',
        ),
      },
      {
        type: 'text',
        content: '\nVisible assistant text.\n',
      },
    ]);

    const summary = getProcessUiSummary(view.container);
    expect(summary.reasoning).toBeGreaterThanOrEqual(1);
    expect(summary.tools).toContain('read');
    expect(summary.subtasks).toBeGreaterThanOrEqual(1);
    const reasoning = view.container.querySelector('[data-testid="ace-reasoning"]');
    expect(reasoning).toBeTruthy();
    const reasoningTrigger = reasoning?.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
    expect(reasoningTrigger?.getAttribute('aria-expanded')).toBe('false');
    expect(within(reasoning as HTMLElement).getByText(/已思考/)).toBeInTheDocument();

    await openAllDetails(view.container);

    const subtaskCards = getSubtaskCards(view.container);
    expect(subtaskCards).toHaveLength(1);
    expect(subtaskCards[0].toolId).toBe('task-17');
    expect(subtaskCards[0].sessionId).toBe('task-17');
    expect(within(subtaskCards[0].node).getByText('会话: task-17')).toBeInTheDocument();
    expect(within(subtaskCards[0].node).getByText(/The UI consumes only ace-process JSON blocks\./)).toBeInTheDocument();

    const toolCards = getToolCards(view.container);
    expect(toolCards).toHaveLength(1);
    const readCard = toolCards[0];
    expect(readCard.toolName).toBe('read');
    expect(readCard.text).toContain('README.md');
    expect(readCard.text).toContain('# Title');

    expect(screen.getByText('Visible assistant text.')).toBeInTheDocument();
    expectNoProtocolLeak(view.container);
  });

  test('assistant timeline interleaves text and tool cards in DOM order and keeps read file path visible', async () => {
    const view = renderWrapperStream([
      {
        type: 'thought',
        content: wrapAceProcessBlock('reasoning', {}, '先确认有哪些文件。'),
      },
      {
        type: 'text',
        content: '先看配置文件。',
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-call',
          {
            toolName: 'read',
            title: '📖 读取文件',
            filePath: 'C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow.yaml',
          },
          '',
        ),
      },
      {
        type: 'text',
        content: wrapAceProcessBlock(
          'tool-result',
          {
            toolName: 'read',
            title: '📖 读取文件',
            output: '<path>C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow.yaml</path>\n<type>file</type>\n<content>\n1: name: demo\n</content>',
          },
          '',
        ),
      },
      {
        type: 'text',
        content: '然后总结配置用途。',
      },
    ]);

    const reasoning = screen.getByTestId('ace-reasoning');
    const leadingText = screen.getByText('先看配置文件。');
    const trailingText = screen.getByText('然后总结配置用途。');
    const toolCardsBeforeOpen = Array.from(view.container.querySelectorAll('[data-testid="ace-tool-card"]')) as HTMLElement[];
    const toolCard = toolCardsBeforeOpen[0] || null;

    expect(reasoning).toBeTruthy();
    expect(toolCard).toBeTruthy();

    const docPosReasoningToText = reasoning.compareDocumentPosition(leadingText);
    const docPosTextToCard = leadingText.compareDocumentPosition(toolCard as HTMLElement);
    const docPosCardToTrailing = (toolCard as HTMLElement).compareDocumentPosition(trailingText);

    expect(Boolean(docPosReasoningToText & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(docPosTextToCard & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(docPosCardToTrailing & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);

    await openAllDetails(view.container);
    const toolCards = Array.from(view.container.querySelectorAll('[data-testid="ace-tool-card"]')) as HTMLElement[];
    expect(toolCards).toHaveLength(1);
    expect(toolCards[0].textContent || '').toContain('C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow.yaml');
    expect(toolCards[0].textContent || '').toContain('1: name: demo');
    expectNoProtocolLeak(view.container);
  });

  test('empty streaming assistant bubble keeps showing 思考中 while the message is streaming', () => {
    const view = render(
      <ChatMessage
        message={{
          id: 'empty-stream',
          role: 'assistant',
          content: '',
          rawContent: '',
        }}
        isStreaming
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(view.container.textContent || '').toContain('思考中...');
  });

  test('initial empty streaming assistant bubble shows 思考中 before process blocks arrive', () => {
    const view = render(
      <ChatMessage
        message={{
          id: 'initial-stream',
          role: 'assistant',
          content: '',
          rawContent: '',
        }}
        isStreaming
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(view.container.textContent || '').toContain('思考中...');
  });

  test('streaming display preserves prior tool DOM when a later thought-only patch arrives', async () => {
    const messageId = 'stream-msg-1';
    const messages = new Map<string, any>();
    const capability = createStreamingDisplayCapability(
      () => {},
      async (_sessionId, message) => {
        messages.set(message.id, { ...message });
      },
      async (_sessionId, targetId, patch) => {
        const previous = messages.get(targetId) || { id: targetId, role: 'assistant', content: '', rawContent: '' };
        messages.set(targetId, { ...previous, ...patch });
      },
      () => 'session-1',
    );

    capability.appendMessage({
      id: messageId,
      role: 'assistant',
      content: '',
      rawContent: wrapAceProcessBlock(
        'tool-call',
        { toolName: 'read', toolId: 'read-live', title: '📖 读取文件', filePath: 'workflow.yaml' },
        '',
      ) + wrapAceProcessBlock(
        'tool-result',
        { toolName: 'read', toolId: 'read-live', title: '📖 读取文件', filePath: 'workflow.yaml', content: 'name: workflow-demo' },
        '',
      ),
    });

    capability.updateMessage(messageId, {
      content: '',
      rawContent: wrapAceProcessBlock('reasoning', {}, 'I should inspect the workflow file before summarizing it.'),
    });

    const stored = messages.get(messageId);
    const visible = extractAceProcessBlocks(stored.rawContent).cleanText;
    const view = render(
      <ChatMessage
        message={{
          id: messageId,
          role: 'assistant',
          content: visible,
          rawContent: stored.rawContent,
        }}
        isStreaming
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    const reasoning = view.container.querySelector('[data-testid="ace-reasoning"]');
    expect(reasoning).toBeTruthy();
    const reasoningTrigger = reasoning?.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
    expect(reasoningTrigger?.getAttribute('aria-expanded')).toBe('true');

    const cards = getToolCards(view.container);
    expect(cards).toHaveLength(1);
    expect(cards[0].toolId).toBe('read-live');

    await openAllDetails(view.container);
    expect(within(cards[0].node).getAllByText('workflow.yaml').length).toBeGreaterThanOrEqual(1);
    expect(within(cards[0].node).getByText('name')).toBeInTheDocument();
    expect(within(cards[0].node).getByText('workflow-demo')).toBeInTheDocument();
    expectNoProtocolLeak(view.container);
  });

  test('streaming reasoning auto-opens and closes after streaming ends', async () => {
    vi.useFakeTimers();
    try {
      const rawContent = wrapAceProcessBlock('reasoning', {}, '先确认一下现在的上下文。');
      const view = render(
        <ChatMessage
          message={{
            id: 'auto-close-reasoning',
            role: 'assistant',
            content: '',
            rawContent,
          }}
          isStreaming
          onConfirmAction={() => {}}
          onRejectAction={() => {}}
          onUndoAction={() => {}}
          onRetryAction={() => {}}
        />
      );

      const reasoning = view.container.querySelector('[data-testid="ace-reasoning"]');
      expect(reasoning).toBeTruthy();
      const reasoningTrigger = reasoning?.querySelector('button[aria-expanded]') as HTMLButtonElement | null;
      expect(reasoningTrigger?.getAttribute('aria-expanded')).toBe('true');

      view.rerender(
        <ChatMessage
          message={{
            id: 'auto-close-reasoning',
            role: 'assistant',
            content: '',
            rawContent,
          }}
          isStreaming={false}
          onConfirmAction={() => {}}
          onRejectAction={() => {}}
          onUndoAction={() => {}}
          onRetryAction={() => {}}
        />
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });

      expect(reasoningTrigger?.getAttribute('aria-expanded')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  test('realistic thinking-delta-done transcript keeps tool cards and final answer in the final chat DOM', async () => {
    const messageId = 'stream-msg-real';
    const messages = new Map<string, any>();
    const capability = createStreamingDisplayCapability(
      () => {},
      async (_sessionId, message) => {
        messages.set(message.id, { ...message });
      },
      async (_sessionId, targetId, patch) => {
        const previous = messages.get(targetId) || { id: targetId, role: 'assistant', content: '', rawContent: '' };
        messages.set(targetId, { ...previous, ...patch });
      },
      () => 'session-1',
    );

    capability.appendMessage({ id: messageId, role: 'assistant', content: '', rawContent: '' });

    const transcript = [
      { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, 'The user wants me to list available workflow configurations and organize them by name, mode, and purpose.') },
      { type: 'delta', content: wrapAceProcessBlock('tool-call', { toolName: 'glob', title: '🔍 搜索文件', pattern: '**/*.yaml', path: 'C:\\Users\\Shawn\\Desktop\\ACEHarness', include: '' }, '') },
      { type: 'delta', content: wrapAceProcessBlock('tool-call', { toolName: 'glob', title: '🔍 搜索文件', pattern: '**/*.yaml', path: 'C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness', include: '' }, '') },
      { type: 'delta', content: wrapAceProcessBlock('tool-result', { toolName: 'glob', title: '🔍 搜索文件', output: 'C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow-20260517-1605-37hl.yaml' }, '') },
      { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, 'I found 3 workflow config files. Let me read them to understand their purpose, mode, etc.') },
      { type: 'delta', content: wrapAceProcessBlock('tool-call', { toolName: 'read', title: '📖 读取文件', filePath: 'C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow-20260517-1605-37hl.yaml' }, '') },
      { type: 'delta', content: wrapAceProcessBlock('tool-result', { toolName: 'read', title: '📖 读取文件', output: '<path>C:\\Users\\Shawn\\AppData\\Roaming\\ACEHarness\\configs\\workflow-20260517-1605-37hl.yaml</path>\n<type>file</type>\n<content>\n1: workflow:\n2:   name: markit-dsl-redesign\n3:   mode: phase-based\n</content>' }, '') },
      { type: 'delta', content: '当前共有 **3** 个工作流配置：\n\n| 文件名 | 名称 | 模式 | 用途 |\n|---|---|---|---|\n| `workflow-20260517-1605-37hl.yaml` | `markit-dsl-redesign` | phase-based | Markit DSL 重新设计 |\n' },
      { type: 'thinking', content: wrapAceProcessBlock('reasoning', {}, 'The user is asking the same question again. Let me repeat the concise answer.') },
      { type: 'delta', content: '均为 `in-place` 模式，启用 `default-supervisor` 监督。' },
    ] as const;

    let visible = '';
    for (const event of transcript) {
      visible += event.type === 'delta' ? event.content : '';
      capability.updateMessage(messageId, {
        content: visible,
        rawContent: event.content,
      });
    }

    capability.updateMessage(messageId, {
      content: '当前共有 **3** 个工作流配置：\n\n| 文件名 | 名称 | 模式 | 用途 |\n|---|---|---|---|\n| `workflow-20260517-1605-37hl.yaml` | `markit-dsl-redesign` | phase-based | Markit DSL 重新设计 |\n\n均为 `in-place` 模式，启用 `default-supervisor` 监督。',
      rawContent: '当前共有 **3** 个工作流配置：\n\n| 文件名 | 名称 | 模式 | 用途 |\n|---|---|---|---|\n| `workflow-20260517-1605-37hl.yaml` | `markit-dsl-redesign` | phase-based | Markit DSL 重新设计 |\n\n均为 `in-place` 模式，启用 `default-supervisor` 监督。',
    });
    capability.end(messageId);

    const stored = messages.get(messageId);
    const finalView = render(
      <ChatMessage
        message={{
          id: messageId,
          role: 'assistant',
          content: stored.content,
          rawContent: stored.rawContent,
        }}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    const reasoning = finalView.container.querySelector('[data-testid="ace-reasoning"]');
    expect(reasoning).toBeTruthy();
    expect((reasoning?.querySelector('button[aria-expanded]') as HTMLButtonElement | null)?.getAttribute('aria-expanded')).toBe('false');

    await openAllDetails(finalView.container);
    const toolCards = getToolCards(finalView.container);
    expect(toolCards.length).toBeGreaterThanOrEqual(3);
    expect(toolCards.some((card) => card.text.includes('**/*.yaml') && card.text.includes('C:\\Users\\Shawn\\Desktop\\ACEHarness'))).toBe(true);
    expect(toolCards.some((card) => card.text.includes('markit-dsl-redesign'))).toBe(true);
    expect(finalView.container.textContent || '').toContain('当前共有 3 个工作流配置');
    expect(finalView.container.textContent || '').toContain('default-supervisor');
    expectNoProtocolLeak(finalView.container);
  });

  test('word-split thinking transcript keeps one reasoning block and the final answer text', async () => {
    const rawChunks = [
      wrapAceProcessBlock('reasoning', {}, ' I'),
      wrapAceProcessBlock('reasoning', {}, ' should'),
      wrapAceProcessBlock('reasoning', {}, ' respond'),
      wrapAceProcessBlock('reasoning', {}, ' conc'),
      wrapAceProcessBlock('reasoning', {}, 'is'),
      wrapAceProcessBlock('reasoning', {}, 'ely'),
      wrapAceProcessBlock('reasoning', {}, '.'),
      '你好',
      '！',
      '有什么',
      '可以',
      '帮',
      '你的',
      '？',
    ];

    const rawContent = rawChunks.join('');
    const view = render(
      <ChatMessage
        message={{
          id: 'word-split-thinking-final',
          role: 'assistant',
          content: '你好！有什么可以帮你的？',
          rawContent,
        }}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    const reasoningBlocks = view.container.querySelectorAll('[data-testid="ace-reasoning"]');
    expect(reasoningBlocks).toHaveLength(1);
    await openAllDetails(view.container);
    expect(view.container.textContent || '').toContain('I should respond concisely.');
    expect(view.container.textContent || '').toContain('你好！有什么可以帮你的？');
    expectNoProtocolLeak(view.container);
  });

  test('real opencode split thinking transcript stays grouped into one reasoning block', async () => {
    const rawContent = REAL_OPENCODE_SPLIT_THINKING_TRANSCRIPT
      .map((event) => event.content)
      .join('');
    const view = render(
      <ChatMessage
        message={{
          id: 'real-opencode-split-thinking',
          role: 'assistant',
          content: 'There are a lot of agents.',
          rawContent,
        }}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(view.container.querySelectorAll('[data-testid="ace-reasoning"]')).toHaveLength(1);
    await openAllDetails(view.container);
    expect(view.container.textContent || '').toContain('There are a lot of agents.');
    const reasoning = view.container.querySelector('[data-testid="ace-reasoning"]');
    expect((reasoning?.querySelector('[data-testid="ace-reasoning-content"]')?.textContent) || '').toContain('Let me group them by category to make it more readable');
    expectNoProtocolLeak(view.container);
  });

  test('real opencode done result keeps the structured card payload extractable without result-tail junk', () => {
    const leakedTail = REAL_OPENCODE_RESULT_TAIL_DELTAS.map((event) => event.content).join('');
    const duplicatedInnerTail = leakedTail.replace(/\r?\n?<\/result>$/u, '');
    const corruptedResult = REAL_OPENCODE_DONE_RESULT.replace('</result>', `${duplicatedInnerTail}</result>`);
    const normalizedResult = normalizeEngineOutput(corruptedResult);
    const parsed = extractStructuredResult(normalizedResult, (value): value is { kind: string; payload?: any } => {
      return !!value && typeof value === 'object' && value.kind === 'card';
    });

    expect(parsed?.kind).toBe('card');
    expect(parsed?.payload?.header?.title).toBe('Agent 配置列表');
    expect(corruptedResult).not.toBe(normalizedResult);
    expect(normalizedResult).toBe(REAL_OPENCODE_DONE_RESULT);
  });

  test('literal <result> mention in prose stays visible in chat message', () => {
    const content = '卡片结构已经整理完，我在补上时间格式和汇总指标后做最终校验。接下来会输出符合系统协议的 `<result>` 卡片，而不是直接用代码块包裹 JSON。';
    const view = render(
      <ChatMessage
        message={{
          id: 'literal-result-mention',
          role: 'assistant',
          content,
          rawContent: content,
        }}
        onConfirmAction={() => {}}
        onRejectAction={() => {}}
        onUndoAction={() => {}}
        onRetryAction={() => {}}
      />
    );

    expect(view.container.textContent || '').toContain('<result> 卡片');
    expect(view.container.textContent || '').toContain('而不是直接用代码块包裹 JSON');
  });

  test('claude thinking and tool streams render through ai-elements without leaking ace-process', async () => {
    const { view } = await buildClaudeRenderedMessage([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: {
            type: 'thinking_delta',
            thinking: 'Check the wrapper output before responding.',
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_start',
          index: 1,
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
          index: 1,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"command":"pwd"}',
          },
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_stop',
          index: 1,
        },
      },
      {
        type: 'user',
        parent_tool_use_id: 'tool-1',
        tool_use_result: {
          output: '/workspace',
          exitCode: 0,
        },
      },
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 2,
          delta: {
            type: 'text_delta',
            text: 'Claude finished.',
          },
        },
      },
      {
        type: 'result',
        subtype: 'success',
        result: 'Claude finished.',
        session_id: 'session-1',
      },
    ]);

    await openAllDetails(view.container);
    const summary = getProcessUiSummary(view.container);
    expect(summary.reasoning).toBeGreaterThanOrEqual(1);
    expect(summary.tools).toContain('bash');
    expect(screen.getByText(/已思考|思考中\.\.\./)).toBeInTheDocument();
    expect(getRenderedText().includes('/workspace')).toBe(true);
    expectNoProtocolLeak(view.container);
  });

  test('codex reasoning and command streams render through ai-elements without leaking ace-process', async () => {
    const { view } = await buildCodexRenderedMessage([
      {
        type: 'item.updated',
        item: {
          type: 'reasoning',
          text: 'Inspect the file read output before replying.',
        },
      },
      {
        type: 'item.started',
        item: {
          type: 'command_execution',
          command: 'Get-Content README.md',
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'command_execution',
          command: 'Get-Content README.md',
          aggregated_output: '# Title',
          exit_code: 0,
        },
      },
      {
        type: 'item.completed',
        item: {
          type: 'agent_message',
          text: 'Codex finished.',
        },
      },
      { type: 'turn.completed' },
    ]);

    await openAllDetails(view.container);
    const summary = getProcessUiSummary(view.container);
    expect(summary.reasoning).toBeGreaterThanOrEqual(1);
    expect(summary.tools).toContain('read');
    expect(screen.getByText(/已思考|思考中\.\.\./)).toBeInTheDocument();
    expect(screen.getByText('Codex finished.')).toBeInTheDocument();
    expectNoProtocolLeak(view.container);
  });

  test.each([
    {
      label: 'OpenCode ACP',
      importer: () => import('@/lib/engines/opencode-wrapper'),
      exportName: 'OpenCodeEngineWrapper',
    },
    {
      label: 'Cursor ACP',
      importer: () => import('@/lib/engines/cursor-wrapper'),
      exportName: 'CursorEngineWrapper',
    },
    {
      label: 'Kiro ACP',
      importer: () => import('@/lib/engines/kiro-cli-wrapper'),
      exportName: 'KiroCliEngineWrapper',
    },
  ])('$label thought/task/tool streams render through ai-elements without leaking ace-process', async ({ importer, exportName }) => {
    const { view } = await buildAcpRenderedMessage(importer, exportName, async (engine) => {
      engine.emit('agent-thought', { type: 'text', text: 'Inspect wrapper events before returning output.' });
      engine.emit('tool-call', {
        id: 'task-1',
        title: 'task',
        kind: 'task',
        rawInput: {
          description: 'Inspect process blocks',
          prompt: 'Trace the process block rendering pipeline.',
          agent: 'worker',
        },
      });
      engine.emit('tool-call-update', {
        id: 'task-1',
        status: 'completed',
        title: 'task',
        kind: 'task',
        rawInput: {
          description: 'Inspect process blocks',
          prompt: 'Trace the process block rendering pipeline.',
          agent: 'worker',
        },
        rawOutput: {
          sessionId: 'task-42',
          resultText: 'Process blocks render via ai-elements.',
        },
      });
      engine.emit('tool-call-update', {
        id: 'read-1',
        status: 'completed',
        title: 'read',
        kind: 'read',
        rawInput: {
          filePath: 'README.md',
        },
        rawOutput: {
          filePath: 'README.md',
          content: '# Title',
        },
      });
      engine.emit('agent-message', 'ACP wrapper finished.');
    });

    await openAllDetails(view.container);
    const summary = getProcessUiSummary(view.container);
    expect(summary.reasoning).toBeGreaterThanOrEqual(1);
    expect(summary.tools).toContain('read');
    expect(summary.subtasks).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/已思考|思考中\.\.\./)).toBeInTheDocument();
    expect(screen.getByText('ACP wrapper finished.')).toBeInTheDocument();
    expectNoProtocolLeak(view.container);
  });

  test('ace-process extraction normalizes typed payloads', () => {
    const raw = [
      wrapAceProcessBlock('reasoning', {}, 'Inspect wrappers'),
      wrapAceProcessBlock('tool-call', { toolName: 'websearch', title: '🔎 搜索网页', query: 'ace-process schema' }, ''),
      wrapAceProcessBlock('tool-result', { toolName: 'websearch', title: '🔎 搜索网页', output: 'Found 3 results' }, ''),
      wrapAceProcessBlock('subtask-start', { title: 'Check codex wrapper', description: 'Check codex wrapper', agent: 'worker' }, ''),
      wrapAceProcessBlock('subtask-result', { sessionId: 'task-9', resultText: 'Codex is using the shared schema.' }, ''),
      'Visible text',
    ].join('\n');

    const parsed = extractAceProcessBlocks(raw);
    const kinds = parsed.blocks.map((block) => block.kind);

    expect(kinds).toEqual([
      'reasoning',
      'tool-call',
      'tool-result',
      'subtask-start',
      'subtask-result',
    ]);
    expect(parsed.blocks[1].meta.kind).toBe('tool-call');
    if (parsed.blocks[1].meta.kind === 'tool-call') {
      expect(parsed.blocks[1].meta.query).toBe('ace-process schema');
    }
    expect(parsed.cleanText).toContain('Visible text');
    expect(parsed.cleanText).not.toContain('<think>');
  });

  test('ace-process extraction survives literal closing tags inside tool output strings', () => {
    const embeddedSource = `const sample = '<ace-process>{"kind":"tool-result","output":"<result>{\\"kind\\":\\"plan_draft\\",\\"payload\\":{\\"summary\\":\\"模板示例\\"}}</result>"}</ace-process>';`;
    const raw = [
      wrapAceProcessBlock('tool-result', { toolName: 'read', title: '📖 读取文件', output: embeddedSource }, ''),
      'Visible text',
    ].join('\n');

    const parsed = extractAceProcessBlocks(raw);

    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].kind).toBe('tool-result');
    if (parsed.blocks[0].meta.kind === 'tool-result') {
      expect(parsed.blocks[0].meta.output).toContain(`</ace-process>'`);
      expect(parsed.blocks[0].meta.output).toContain('<result>');
    }
    expect(parsed.cleanText).toContain('Visible text');
    expect(parsed.cleanText).not.toContain('<ace-process>');
  });

  test('shared ace tool formatter repairs Windows mojibake in tool results', () => {
    const raw = formatAceToolResult({
      toolName: 'read',
      title: '📖 读取文件',
      rawOutput: {
        content: 'descriptionZH: ACEHarness 瑙勮寖缂栫爜鎶€鑳姐€傚皢绮楅渶姹傝浆鍖栦负缁撴瀯鍖栫殑闇€姹傛枃妗ｃ€佽璁℃枃妗ｅ拰瀹炵幇璁″垝銆�',
      },
    });

    const parsed = extractAceProcessBlocks(raw);
    const block = parsed.blocks[0];
    expect(block.kind).toBe('tool-result');
    if (block.meta.kind === 'tool-result') {
      expect(block.meta.content).toContain('规范编码');
      expect(block.meta.content).toContain('需求文档');
      expect(block.meta.content).not.toContain('瑙勮');
    }
  });

  test('single file-change ace blocks stay renderable as tool-result cards without leaking raw protocol', async () => {
    const raw = [
      '先更新兼容编译设计文档。',
      formatAceFileChangesResult({
        changes: [
          {
            filePath: '/root/wjw/docs/compat-compile-mode/cangjie-compatible-compilation-design.md',
            kind: 'update',
          },
        ],
        fallbackToolName: 'edit',
        fallbackTitle: '文件变更',
      }),
      '接着同步镜像章节。',
    ].join('\n');

    const view = renderMessage(raw, { rawContent: raw });

    await openAllDetails(view.container);
    const toolCards = getToolCards(view.container);
    expect(toolCards.some((card) => card.toolName === 'edit')).toBe(true);
    expect(view.container.textContent || '').toContain('先更新兼容编译设计文档。');
    expect(view.container.textContent || '').toContain('接着同步镜像章节。');
    expectNoProtocolLeak(view.container);
  });

  test('mergeFinalRawStreamContent keeps streamed reasoning when final rawOutput omits it', () => {
    const streamed = [
      wrapAceProcessBlock('reasoning', {}, '先确认一下边界条件。'),
      '<result>{"kind":"agora_result","payload":{"type":"speech","content":"最终发言","mentions":[]}}</result>',
    ].join('\n\n');
    const rawOutput = '<result>{"kind":"agora_result","payload":{"type":"speech","content":"最终发言","mentions":[]}}</result>';

    const merged = mergeFinalRawStreamContent(streamed, rawOutput);
    const parsed = extractAceProcessBlocks(merged);

    expect(parsed.blocks.some((block) => block.kind === 'reasoning' && block.body.includes('先确认一下边界条件'))).toBe(true);
    expect(merged).toContain('<result>{"kind":"agora_result"');
  });
});
