import { describe, expect, test } from 'vitest';
import {
  executeChatRuntimeWithContextRecovery,
  type ChatRuntimeEngine,
  type ChatRuntimeEngineOptions,
} from '@/lib/chat/chat-engine-runtime';

function createEngine(results: Array<{ success: boolean; output: string; error?: string }>): ChatRuntimeEngine & { calls: number } {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    execute: async () => {
      const result = results[Math.min(calls, results.length - 1)]!;
      calls += 1;
      return result;
    },
    cancel: () => undefined,
    isAvailable: async () => true,
    getName: () => 'test-engine',
    on: () => undefined,
    off: () => undefined,
  };
}

const options: ChatRuntimeEngineOptions = {
  agent: 'chat',
  step: 'chat',
  prompt: 'hello',
  systemPrompt: '',
  model: 'volcengine/GLM-5.2',
  workingDirectory: '/tmp',
};

describe('executeChatRuntimeWithContextRecovery', () => {
  test('retries a provider rate-limit result without discarding the session', async () => {
    const engine = createEngine([
      {
        success: false,
        output: '',
        error: 'Internal error: Error from provider (Console): Rate limit exceeded. Please try again later.',
      },
      { success: true, output: 'recovered answer' },
    ]);
    const retries: Array<{ attempt: number; maxAttempts: number; delayMs: number; error: string }> = [];

    const result = await executeChatRuntimeWithContextRecovery(engine, options, {
      providerRateLimit: {
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        onRetry: (event) => { retries.push(event); },
      },
    });

    expect(result).toMatchObject({ success: true, output: 'recovered answer' });
    expect(engine.calls).toBe(2);
    expect(retries).toEqual([{
      attempt: 1,
      maxAttempts: 1,
      delayMs: 0,
      error: expect.stringContaining('Rate limit exceeded'),
    }]);
  });
});
