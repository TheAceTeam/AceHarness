import { EventEmitter } from 'events';
import {
  openCangjieNativeLibrary,
  type CangjieNativeLibrary,
  type NativeDataCallResult,
  type NativeFrame,
} from '@cangjielang/napi-cj';
import type {
  Engine,
  EngineContextCompactOptions,
  EngineContextCompactResult,
  EngineOptions,
  EngineResult,
  EngineStreamEvent,
} from './engine-interface';
import type { EngineDriver, EngineType } from './engine-selection';
import {
  getCangjieEngineRuntimeAvailability,
  inferDriverForEffectiveEngine,
  resolveCangjieEngineLibrarySpec,
  type CangjieRuntimeConfig,
} from './cangjie-runtime-config';

const FRAME_KIND_TO_EVENT_TYPE: Record<number, EngineStreamEvent['type']> = {
  1: 'session',
  2: 'text',
  3: 'tool',
  4: 'thought',
  5: 'error',
  6: 'log',
};

function parseJsonObject(value?: string): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function bufferToString(value?: Buffer): string {
  return value ? value.toString('utf8') : '';
}

export class CangjieRuntimeEngineWrapper extends EventEmitter implements Engine {
  private library: CangjieNativeLibrary | null = null;
  private currentRequestId: string | null = null;

  constructor(
    private readonly effectiveEngine: EngineType,
    private readonly runtimeConfig?: CangjieRuntimeConfig | null,
  ) {
    super();
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    const library = this.getLibrary();
    const requestId = options.runId || `cj-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.currentRequestId = requestId;

    try {
      const result = await library.callData({
        requestId,
        domain: 'engine',
        operation: 'execute',
        optionsJson: JSON.stringify({
          engine: this.getLogicalEngineName(),
          effectiveEngine: this.effectiveEngine,
          driver: inferDriverForEffectiveEngine(this.effectiveEngine),
          model: options.model,
          workingDirectory: options.workingDirectory,
          timeoutMs: options.timeoutMs,
          sessionId: options.sessionId,
          forceNewSession: options.forceNewSession,
          diagnosticLogging: options.diagnosticLogging,
          allowedTools: options.allowedTools,
          mcpServers: options.mcpServers,
          agents: options.agents,
          frontendSessionId: options.frontendSessionId,
        }),
        inputs: {
          prompt: options.prompt,
          systemPrompt: options.systemPrompt,
        },
        onFrame: (frame) => this.emitNativeFrame(frame),
      });
      return this.convertResult(result);
    } finally {
      this.currentRequestId = null;
    }
  }

  async compactContext(_options: EngineContextCompactOptions): Promise<EngineContextCompactResult | null> {
    return null;
  }

  cancel(): void {
    const requestId = this.currentRequestId;
    if (!requestId || !this.library) return;
    void this.library.callControl({
      domain: 'engine',
      operation: 'cancel',
      payloadJson: JSON.stringify({ requestId }),
    }).catch(() => undefined);
  }

  async isAvailable(): Promise<boolean> {
    return getCangjieEngineRuntimeAvailability(this.runtimeConfig).available;
  }

  getName(): string {
    return this.effectiveEngine;
  }

  dispose(): void {
    if (this.library) {
      this.library.dispose();
      this.library = null;
    }
  }

  cleanup(): void {
    this.dispose();
  }

  private getLibrary(): CangjieNativeLibrary {
    if (!this.library) {
      this.library = openCangjieNativeLibrary(resolveCangjieEngineLibrarySpec(this.runtimeConfig));
    }
    return this.library;
  }

  private getLogicalEngineName(): string {
    if (this.effectiveEngine === 'claude-code-acp') return 'claude-code';
    if (this.effectiveEngine === 'opencode-sdk') return 'opencode';
    if (this.effectiveEngine === 'nga-sdk') return 'nga';
    if (this.effectiveEngine === 'codegenie-sdk') return 'codegenie';
    return this.effectiveEngine;
  }

  private emitNativeFrame(frame: NativeFrame): void {
    const metadata = typeof frame.metadata === 'object' && frame.metadata !== null
      ? frame.metadata as Record<string, any>
      : {};
    const eventType = metadata.type || FRAME_KIND_TO_EVENT_TYPE[frame.kind] || 'text';
    this.emit('stream', {
      type: eventType,
      content: frame.payload.toString('utf8'),
      metadata,
    } satisfies EngineStreamEvent);
  }

  private convertResult(result: NativeDataCallResult): EngineResult {
    const resultJson = parseJsonObject(result.resultJson);
    const errorJson = parseJsonObject(result.errorJson);
    const output = typeof resultJson.output === 'string'
      ? resultJson.output
      : bufferToString(result.output);
    return {
      success: result.status === 0 && resultJson.success !== false,
      output,
      error: typeof resultJson.error === 'string' ? resultJson.error : errorJson.message,
      sessionId: typeof resultJson.sessionId === 'string' ? resultJson.sessionId : resultJson.session_id,
      stopReason: resultJson.stopReason || resultJson.stop_reason,
      metadata: resultJson.metadata && typeof resultJson.metadata === 'object'
        ? resultJson.metadata
        : resultJson,
    };
  }
}
