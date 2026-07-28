import { EventEmitter } from 'node:events';

export interface MockEngineOptions {
  agent?: string;
  step?: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  workingDirectory?: string;
  allowedTools?: string[];
  timeoutMs?: number;
  sessionId?: string;
  appendSystemPrompt?: boolean;
}

export interface MockEngineResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  stopReason?: string;
  metadata?: Record<string, unknown>;
}

export interface MockEngineStreamEvent {
  type: 'text' | 'thought' | 'error' | 'tool';
  content: string;
}

export interface MockEngineLike {
  execute(options: MockEngineOptions): Promise<MockEngineResult>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: MockEngineStreamEvent) => void): this;
  off(event: 'stream', listener: (event: MockEngineStreamEvent) => void): this;
}

export interface MockEngineCall {
  options: MockEngineOptions;
  timestamp: number;
}

/**
 * Reusable mock engine for testing workflow execution, API routes, and state machines.
 *
 * Usage:
 *   const engine = new MockEngine({ success: true, output: 'done' });
 *   // or inject custom logic:
 *   const engine = new MockEngine();
 *   engine.executeImpl = async (opts) => ({ success: true, output: `echo: ${opts.prompt}` });
 */
export class MockEngine extends EventEmitter implements MockEngineLike {
  private available = true;
  private name = 'mock-engine';

  /** Configurable return value for execute() */
  executeResult: MockEngineResult = {
    success: true,
    output: 'mock output',
  };

  /** Optional callback for custom execute logic (overrides executeResult) */
  executeImpl?: (options: MockEngineOptions) => Promise<MockEngineResult>;

  /** History of all execute() calls */
  calls: MockEngineCall[] = [];

  /** Number of cancel() calls */
  cancelCalls = 0;

  constructor(result?: Partial<MockEngineResult>) {
    super();
    if (result) {
      this.executeResult = { ...this.executeResult, ...result };
    }
  }

  async execute(options: MockEngineOptions): Promise<MockEngineResult> {
    this.calls.push({ options, timestamp: Date.now() });
    if (this.executeImpl) {
      return this.executeImpl(options);
    }
    return { ...this.executeResult };
  }

  cancel(): void {
    this.cancelCalls++;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  getName(): string {
    return this.name;
  }

  // --- Test helpers ---

  setAvailable(value: boolean): void {
    this.available = value;
  }

  setName(name: string): void {
    this.name = name;
  }

  /** Emit a stream text event */
  emitStream(content: string): void {
    this.emit('stream', { type: 'text', content } satisfies MockEngineStreamEvent);
  }

  /** Emit a thought event */
  emitThought(content: string): void {
    this.emit('stream', { type: 'thought', content } satisfies MockEngineStreamEvent);
  }

  /** Emit an error event */
  emitError(content: string): void {
    this.emit('stream', { type: 'error', content } satisfies MockEngineStreamEvent);
  }

  /** Emit a tool-use event */
  emitTool(content: string): void {
    this.emit('stream', { type: 'tool', content } satisfies MockEngineStreamEvent);
  }
}
