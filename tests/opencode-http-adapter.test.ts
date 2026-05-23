import { describe, expect, test, vi } from 'vitest';
import type { EngineStreamEvent } from '@/lib/engines/engine-interface';
import { sendPromptWithOpenCodeHttp } from '@/lib/engines/opencode-http-adapter';

describe('sendPromptWithOpenCodeHttp regressions', () => {
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
});
