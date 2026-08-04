import { describe, expect, test, vi } from 'vitest';
import type { ChatRuntimeEngine, ChatRuntimeStreamEvent } from '@/lib/chat/chat-engine-runtime';
import type { AiMemoryContinuityIdentity } from '@/lib/agent/ai-memory-session';
import type { MemoryV2ConsumerManifestResult } from '@/lib/memory-v2-cutover/consumer-context';
import type { MemoryRequestContext } from '@/lib/memory-v2';
import type { RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';

const { createMemoryService, prepareAiMemoryEngineTurn } = vi.hoisted(() => ({
  createMemoryService: vi.fn(() => ({ close: vi.fn() })),
  prepareAiMemoryEngineTurn: vi.fn(() => ({
    manifest: { promptBlock: 'memory manifest' },
    buildPromptBlock: () => 'memory prompt',
    assertRequiredReadsAcknowledged: vi.fn(),
    parseFallback: () => ({ calls: [], visibleText: 'visible answer' }),
    executeFallback: () => ({ calls: [], toolResults: [], visibleText: 'visible answer' }),
    collectHandoffEligibleProposalReferences: () => [],
    nativeTools: [],
    executeNativeTool: vi.fn(),
    getRequiredReadGate: vi.fn(),
  })),
}));

vi.mock('@/lib/memory-v2', () => ({ createMemoryService }));
vi.mock('@/lib/agent/ai-memory-protocol', () => ({ prepareAiMemoryEngineTurn }));

import { AiMemoryV2EngineAdapter } from '@/lib/agent/ai-memory-engine-adapter';

describe('AiMemoryV2EngineAdapter stream filtering', () => {
  test('suppresses private text and thought while forwarding structured tool events', async () => {
    let emit: ((event: ChatRuntimeStreamEvent) => void) | undefined;
    const inner: ChatRuntimeEngine = {
      execute: vi.fn(async () => ({ success: true, output: 'answer' })),
      cancel: vi.fn(),
      isAvailable: vi.fn(async () => true),
      getName: vi.fn(() => 'test'),
      on: vi.fn((_event, listener) => { emit = listener; }),
      off: vi.fn(),
    };
    const received: ChatRuntimeStreamEvent[] = [];
    const requestContext: MemoryRequestContext = {
      ownerUserId: 'user-1',
      workspaceId: 'workspace-1',
      actor: 'system',
    };
    const continuity: AiMemoryContinuityIdentity = {
      kind: 'frontend-session',
      frontendSessionId: 'session-1',
    };
    const memoryV2: MemoryV2ConsumerManifestResult = {
      status: { enabled: true, ready: true },
      manifest: null,
      promptBlock: '',
    };
    const adapter = new AiMemoryV2EngineAdapter(
      inner,
      () => true,
      {
        requestContext,
        continuity,
        sourceEventId: 'event-1',
        queryText: 'query',
      },
      memoryV2,
    );

    adapter.on('stream', (event) => received.push(event));
    await adapter.execute({
      agent: 'test',
      step: 'step',
      prompt: 'prompt',
      systemPrompt: '',
      model: 'model',
      workingDirectory: '.',
    });

    emit?.({ type: 'text', content: 'private control text' });
    emit?.({ type: 'thought', content: 'private thought' });
    const tool: RuntimeToolEvent = {
      id: 'tool-1',
      toolName: 'read',
      title: 'Read file',
      status: 'running',
      input: { filePath: 'README.md' },
    };
    const toolEvent: ChatRuntimeStreamEvent = {
      type: 'tool',
      tool,
    };
    emit?.(toolEvent);

    expect(received).toEqual([toolEvent]);
  });
});
