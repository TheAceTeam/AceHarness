import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { EngineOptions } from '@/lib/engines/engine-interface';

const acpMockState = vi.hoisted(() => ({
  instances: [] as Array<any>,
  createCalls: [] as string[],
  resumeCalls: [] as string[],
  setModelCalls: [] as string[],
  sendPrompts: [] as string[],
  nextSessionId: 1,
  onSendPrompt: null as null | ((engine: any, prompt: string) => Promise<{ stopReason: string; usage: null }>),
}));

vi.mock('@/lib/engines/acp-engine', async () => {
  const { EventEmitter } = await import('node:events');

  class MockACPEngine extends EventEmitter {
    process: Record<string, unknown> | null = null;
    sessionId: string | null = null;

    constructor(public readonly config: any) {
      super();
      acpMockState.instances.push(this);
    }

    async start(): Promise<void> {
      this.process = { pid: acpMockState.instances.length };
    }

    stop(): void {
      this.process = null;
    }

    async createSession(): Promise<string> {
      const sessionId = `session-${acpMockState.nextSessionId++}`;
      this.sessionId = sessionId;
      acpMockState.createCalls.push(sessionId);
      return sessionId;
    }

    async resumeSession(sessionId: string): Promise<string> {
      this.sessionId = sessionId;
      acpMockState.resumeCalls.push(sessionId);
      return sessionId;
    }

    async sendPrompt(prompt: string): Promise<{ stopReason: string; usage: null }> {
      acpMockState.sendPrompts.push(prompt);
      if (acpMockState.onSendPrompt) {
        return acpMockState.onSendPrompt(this, prompt);
      }
      this.emit('agent-message', { text: prompt.includes('second') ? 'second reply' : 'first reply' });
      return { stopReason: 'end_turn', usage: null };
    }

    async setModel(modelId: string): Promise<void> {
      acpMockState.setModelCalls.push(modelId);
    }

    cancelSession(): void {}
  }

  return {
    ACPEngine: MockACPEngine,
    buildAcpProcessReuseKey: (config: any) =>
      JSON.stringify({
        engineType: config.engineType,
        command: config.command,
        workingDirectory: config.workingDirectory,
        args: config.args || [],
        env: config.env || {},
        diagnosticLogging: Boolean(config.diagnosticLogging),
      }),
    logAcpTiming: vi.fn(),
  };
});

const BASE_OPTIONS: EngineOptions = {
  agent: 'test-agent',
  step: 'test-step',
  prompt: 'test prompt',
  systemPrompt: 'test system prompt',
  model: 'test-model',
  workingDirectory: process.cwd(),
};

describe('ACPWrapperBase shared runner', () => {
  beforeEach(() => {
    acpMockState.instances.length = 0;
    acpMockState.createCalls.length = 0;
    acpMockState.resumeCalls.length = 0;
    acpMockState.setModelCalls.length = 0;
    acpMockState.sendPrompts.length = 0;
    acpMockState.nextSessionId = 1;
    acpMockState.onSendPrompt = null;
  });

  afterEach(async () => {
    const { ACPWrapperBase } = await import('@/lib/engines/acp-wrapper-base');
    ACPWrapperBase.shutdownSharedRunners();
  });

  test('reuses one ACP process across different wrapper instances and sessions', async () => {
    const { ACPWrapperBase } = await import('@/lib/engines/acp-wrapper-base');

    class TestAcpWrapper extends ACPWrapperBase {
      getName(): string {
        return 'test-acp';
      }

      protected getACPConfig(options: EngineOptions) {
        return {
          engineType: 'kiro-cli' as const,
          command: 'test-acp',
          workingDirectory: options.workingDirectory,
          args: [],
        };
      }

      async isAvailable(): Promise<boolean> {
        return true;
      }
    }

    const first = new TestAcpWrapper();
    const second = new TestAcpWrapper();

    const firstResult = await first.execute({
      ...BASE_OPTIONS,
      prompt: 'first prompt',
    });
    const secondResult = await second.execute({
      ...BASE_OPTIONS,
      prompt: 'second prompt',
      sessionId: 'session-existing',
    });

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(acpMockState.instances).toHaveLength(1);
    expect(acpMockState.createCalls).toHaveLength(1);
    expect(acpMockState.resumeCalls).toEqual(['session-existing']);
    expect(firstResult.output).toContain('first reply');
    expect(secondResult.output).toContain('second reply');
    ACPWrapperBase.shutdownSharedRunners();
  });

  test('serializes shared ACP execution and keeps stream listeners isolated', async () => {
    const { ACPWrapperBase } = await import('@/lib/engines/acp-wrapper-base');

    class TestAcpWrapper extends ACPWrapperBase {
      getName(): string {
        return 'test-acp';
      }

      protected getACPConfig(options: EngineOptions) {
        return {
          engineType: 'kiro-cli' as const,
          command: 'test-acp',
          workingDirectory: options.workingDirectory,
          args: [],
        };
      }

      async isAvailable(): Promise<boolean> {
        return true;
      }
    }

    let releaseFirst: (() => void) | null = null;
    let notifyFirstStarted: (() => void) | null = null;
    const firstStarted = new Promise<void>((resolve) => {
      notifyFirstStarted = resolve;
    });

    acpMockState.onSendPrompt = (engine, prompt) => {
      if (prompt.includes('first prompt')) {
        engine.emit('agent-message', { text: 'first chunk' });
        notifyFirstStarted?.();
        return new Promise((resolve) => {
          releaseFirst = () => {
            engine.emit('agent-message', { text: ' first done' });
            resolve({ stopReason: 'end_turn', usage: null });
          };
        });
      }

      engine.emit('agent-message', { text: 'second chunk' });
      return Promise.resolve({ stopReason: 'end_turn', usage: null });
    };

    const first = new TestAcpWrapper();
    const second = new TestAcpWrapper();
    const firstChunks: string[] = [];
    const secondChunks: string[] = [];

    first.on('stream', (event) => {
      if (event.type === 'text') firstChunks.push(event.content);
    });
    second.on('stream', (event) => {
      if (event.type === 'text') secondChunks.push(event.content);
    });

    const firstPromise = first.execute({
      ...BASE_OPTIONS,
      prompt: 'first prompt',
    });
    await firstStarted;

    const secondPromise = second.execute({
      ...BASE_OPTIONS,
      prompt: 'second prompt',
      sessionId: 'session-b',
    });

    await Promise.resolve();
    expect(acpMockState.sendPrompts).toHaveLength(1);
    expect(secondChunks).toEqual([]);

    const release = releaseFirst as (() => void) | null;
    release?.();

    const [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    expect(firstResult.output).toContain('first chunk');
    expect(secondResult.output).toContain('second chunk');
    expect(firstChunks.join('')).toContain('first chunk');
    expect(secondChunks.join('')).toBe('second chunk');
    ACPWrapperBase.shutdownSharedRunners();
  });
});
