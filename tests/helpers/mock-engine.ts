import { EventEmitter } from 'node:events';
import type {
  Engine,
  EngineOptions,
  EngineResult,
  EngineStreamEvent,
} from '@/lib/engines/engine-interface';

export interface MockEngineCall {
  options: EngineOptions;
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
export class MockEngine extends EventEmitter implements Engine {
  private available = true;
  private name = 'mock-engine';

  /** Configurable return value for execute() */
  executeResult: EngineResult = {
    success: true,
    output: 'mock output',
  };

  /** Optional callback for custom execute logic (overrides executeResult) */
  executeImpl?: (options: EngineOptions) => Promise<EngineResult>;

  /** History of all execute() calls */
  calls: MockEngineCall[] = [];

  /** Number of cancel() calls */
  cancelCalls = 0;

  constructor(result?: Partial<EngineResult>) {
    super();
    if (result) {
      this.executeResult = { ...this.executeResult, ...result };
    }
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
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
    this.emit('stream', { type: 'text', content } satisfies EngineStreamEvent);
  }

  /** Emit a thought event */
  emitThought(content: string): void {
    this.emit('stream', { type: 'thought', content } satisfies EngineStreamEvent);
  }

  /** Emit an error event */
  emitError(content: string): void {
    this.emit('stream', { type: 'error', content } satisfies EngineStreamEvent);
  }

  /** Emit a tool-use event */
  emitTool(content: string): void {
    this.emit('stream', { type: 'tool', content } satisfies EngineStreamEvent);
  }
}
