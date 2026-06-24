import { describe, expect, test, vi } from 'vitest';
import type { EngineStreamEvent } from '@/lib/engines/engine-interface';
import {
  discoverOpenCodeModelsFromHttpClient,
  getOpenCodeStreamTimeoutConfig,
  normalizeOpenCodeModelsFromProviderSources,
  resolveOpenCodeModelId,
  sendPromptWithOpenCodeHttp,
} from '@/lib/engines/opencode-http-adapter';

describe('sendPromptWithOpenCodeHttp regressions', () => {
  test('uses a long default total timeout with a separate idle timeout for streaming prompts', () => {
    const originalTotal = process.env.ACE_OPENCODE_STREAM_TIMEOUT_MS;
    const originalIdle = process.env.ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS;
    try {
      delete process.env.ACE_OPENCODE_STREAM_TIMEOUT_MS;
      delete process.env.ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS;

      expect(getOpenCodeStreamTimeoutConfig()).toEqual({
        totalMs: 60 * 60 * 1000,
        idleMs: 10 * 60 * 1000,
      });

      process.env.ACE_OPENCODE_STREAM_TIMEOUT_MS = '7200000';
      process.env.ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS = '900000';
      expect(getOpenCodeStreamTimeoutConfig()).toEqual({
        totalMs: 7_200_000,
        idleMs: 900_000,
      });

      expect(getOpenCodeStreamTimeoutConfig(120_000)).toEqual({
        totalMs: 120_000,
        idleMs: 120_000,
      });
    } finally {
      if (originalTotal === undefined) {
        delete process.env.ACE_OPENCODE_STREAM_TIMEOUT_MS;
      } else {
        process.env.ACE_OPENCODE_STREAM_TIMEOUT_MS = originalTotal;
      }
      if (originalIdle === undefined) {
        delete process.env.ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS;
      } else {
        process.env.ACE_OPENCODE_STREAM_IDLE_TIMEOUT_MS = originalIdle;
      }
    }
  });

  test('normalizes OpenCode provider model responses from new and config shapes', () => {
    expect(normalizeOpenCodeModelsFromProviderSources(
      {
        data: {
          providers: [
            {
              id: 'penguiapigpt',
              name: 'Pengui-gpt',
              models: {
                'gpt-5.3-codex': { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex' },
              },
            },
          ],
        },
      },
      {
        data: {
          provider: {
            penguiapi: {
              name: 'Pengui-Api',
              models: {
                'claude-sonnet-4-5': { name: 'claude-sonnet-4-6' },
              },
            },
          },
        },
      },
    )).toEqual([
      { modelId: 'penguiapigpt/gpt-5.3-codex', name: 'Pengui-gpt/gpt-5.3-codex' },
      { modelId: 'penguiapi/claude-sonnet-4-5', name: 'Pengui-Api/claude-sonnet-4-6' },
    ]);
  });

  test('resolves short OpenCode model names against discovered provider models', () => {
    const models = [
      { modelId: 'siliconflow-cn/Pro/zai-org/GLM-5.1', name: 'SiliconFlow (China)/Pro/zai-org/GLM-5.1' },
      { modelId: 'volcengine/GLM-5.1', name: 'csi.ai/GLM-5.1' },
      { modelId: 'volcengine/GLM-5', name: 'csi.ai/GLM-5' },
    ];

    expect(resolveOpenCodeModelId('glm-5.1', models)).toBe('volcengine/GLM-5.1');
    expect(resolveOpenCodeModelId('volcengine/GLM-5.1', models)).toBe('volcengine/GLM-5.1');
    expect(resolveOpenCodeModelId('missing/model', models)).toBe('');
  });

  test('discovers OpenCode models through SDK HTTP provider APIs before config fallback', async () => {
    const configProviders = vi.fn(async () => ({
      data: {
        providers: [
          {
            id: 'opencode',
            name: 'OpenCode Zen',
            models: {
              'big-pickle': { name: 'Big Pickle' },
            },
          },
        ],
      },
    }));
    const providerList = vi.fn();
    const configGet = vi.fn();

    await expect(discoverOpenCodeModelsFromHttpClient({
      config: {
        providers: configProviders,
        get: configGet,
      },
      provider: {
        list: providerList,
      },
      session: {} as any,
    })).resolves.toEqual([
      { modelId: 'opencode/big-pickle', name: 'OpenCode Zen/Big Pickle' },
    ]);

    expect(configProviders).toHaveBeenCalledTimes(1);
    expect(providerList).not.toHaveBeenCalled();
    expect(configGet).not.toHaveBeenCalled();
  });

  test('returns hydrated assistant output when the SSE stream errors after prompt acceptance', async () => {
    const emitted: EngineStreamEvent[] = [];
    const logs: Array<{ message: string; level?: string }> = [];
    let messageCallCount = 0;

    const messagesMock = vi.fn(async () => {
      messageCallCount += 1;
      if (messageCallCount === 1) {
        return { data: [] };
      }
      return {
        data: [
          {
            info: { role: 'assistant' },
            parts: [
              {
                id: 'answer-1',
                type: 'text',
                text: '{"files":["ace.js"]}',
              },
            ],
          },
        ],
      };
    });

    const subscribeMock = vi.fn(async ({
      signal,
      onSseError,
    }: {
      signal?: AbortSignal;
      onSseError?: (error: unknown) => void;
    }) => {
      setTimeout(() => {
        onSseError?.(new Error('ECONNRESET'));
      }, 40);

      return {
        stream: {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'message.part.updated',
              properties: {
                sessionID: 'session-1',
                part: {
                  id: 'tool-1',
                  type: 'tool',
                  tool: 'glob',
                  state: {
                    status: 'pending',
                    input: {
                      pattern: '*',
                      path: 'C:\\workspace\\bin',
                    },
                  },
                },
              },
            };

            while (!signal?.aborted) {
              await new Promise((resolve) => setTimeout(resolve, 5));
            }
          },
        },
      };
    });

    await expect(sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: subscribeMock,
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => ({ data: {} })),
          messages: messagesMock,
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: '输出 bin 目录文件列表，只输出一个 json',
      emit: (event) => emitted.push(event),
      log: (entry) => logs.push({ message: entry.message, level: entry.level }),
    })).resolves.toBe('{"files":["ace.js"]}');

    const textEvents = emitted
      .filter((event) => event.type === 'text')
      .map((event) => event.content)
      .join('');

    expect(textEvents).toContain('{"files":["ace.js"]}');
    expect(logs.some((entry) => entry.message === 'Raw SSE error')).toBe(false);
    expect(logs.some((entry) => entry.message === 'Streaming prompt recovered from stream error via hydrated output')).toBe(false);
  });

  test('completes from session status polling when OpenCode SSE misses idle with stale pending parts', async () => {
    const emitted: EngineStreamEvent[] = [];
    const messagesMock = vi.fn(async () => ({
      data: [
        {
          info: { role: 'assistant' },
          parts: [
            {
              id: 'answer-1',
              type: 'text',
              text: 'done from status poll',
            },
            {
              id: 'tool-1',
              type: 'tool',
              state: {
                status: 'running',
                input: { command: 'echo done' },
              },
            },
          ],
        },
      ],
    }));

    const subscribeMock = vi.fn(async ({ signal }: { signal?: AbortSignal }) => ({
      stream: {
        async *[Symbol.asyncIterator]() {
          while (!signal?.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 5));
          }
        },
      },
    }));

    await expect(sendPromptWithOpenCodeHttp({
      engineName: 'opencode-http',
      client: {
        event: {
          subscribe: subscribeMock,
        },
        session: {
          create: vi.fn(),
          prompt: vi.fn(async () => ({ data: { parts: [] } })),
          promptAsync: vi.fn(async () => ({ data: {} })),
          status: vi.fn(async () => ({ data: { 'session-1': { type: 'idle' } } })),
          messages: messagesMock,
        },
      } as any,
      sessionId: 'session-1',
      fullPrompt: 'finish',
      emit: (event) => emitted.push(event),
    })).resolves.toBe('done from status poll');

    const textEvents = emitted
      .filter((event) => event.type === 'text')
      .map((event) => event.content)
      .join('');
    expect(textEvents).toContain('done from status poll');
  });
});
