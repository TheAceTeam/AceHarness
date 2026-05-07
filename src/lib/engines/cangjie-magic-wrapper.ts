/**
 * CangjieMagic Engine Wrapper
 *
 * Wraps CangjieMagicEngine to implement the Engine interface,
 * following the same pattern as KiroCliEngineWrapper.
 */

import { EventEmitter } from 'events';
import { CangjieMagicEngine } from './cangjie-magic';
import { detectCangjieHome, isCjpmAvailable, buildCangjieSpawnEnv } from '../cangjie-env';
import { loadEnvVars, buildEnvObject } from '../env-manager';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';

const DEFAULT_COMMAND = 'cjpm run --name magic.examples.mcp_server';

const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

/**
 * Resolve CANGJIE_MAGIC_PATH from env-vars.yaml > process.env.
 */
async function resolveMagicPath(): Promise<string | null> {
  try {
    const vars = await loadEnvVars();
    const envObj = buildEnvObject(vars);
    if (envObj.CANGJIE_MAGIC_PATH) return envObj.CANGJIE_MAGIC_PATH;
  } catch { /* ignore */ }
  return process.env.CANGJIE_MAGIC_PATH || null;
}

export class CangjieMagicEngineWrapper extends EventEmitter implements Engine {
  private engine: CangjieMagicEngine | null = null;

  getName(): string {
    return 'cangjie-magic';
  }

  async isAvailable(): Promise<boolean> {
    const home = await detectCangjieHome();
    if (!home) return false;
    const magicPath = await resolveMagicPath();
    if (!magicPath) return false;

    try {
      const env = await buildCangjieSpawnEnv(home);
      return isCjpmAvailable(env);
    } catch {
      return false;
    }
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    try {
      const magicPath = await resolveMagicPath();
      if (!magicPath) {
        throw new Error('CANGJIE_MAGIC_PATH not configured. Please set it in env vars.');
      }

      // Create engine instance
      this.engine = new CangjieMagicEngine({
        projectDir: magicPath,
        command: DEFAULT_COMMAND,
      });

      // Forward events
      this.engine.on('log', (msg: string) => {
        this.emit('stream', { type: 'log', content: msg } as EngineStreamEvent);
      });
      this.engine.on('error', (err: Error) => {
        this.emit('stream', { type: 'error', content: err.message } as EngineStreamEvent);
      });

      // Start MCP server
      await this.engine.start();

      // List tools for logging
      const tools = this.engine.getTools();
      this.emit('stream', {
        type: 'tool',
        content: `🔧 CangjieMagic tools: ${tools.map(t => t.name).join(', ')}`,
        metadata: { tools },
      } as EngineStreamEvent);

      // Send prompt
      const output = await this.engine.chat(options.prompt);

      // Emit text output
      this.emit('stream', { type: 'text', content: output } as EngineStreamEvent);

      return {
        success: true,
        output,
        stopReason: 'end_turn',
        metadata: ZERO_USAGE_METADATA,
      };
    } catch (error: any) {
      console.error(`[CangjieMagicWrapper] execute() error:`, error.message || error);
      return {
        success: false,
        output: '',
        error: error.message || String(error),
        metadata: ZERO_USAGE_METADATA,
      };
    } finally {
      // Clean up — CangjieMagic engine is stateless per execution
      if (this.engine) {
        this.engine.stop();
        this.engine = null;
      }
    }
  }

  cancel(): void {
    if (this.engine) {
      this.engine.stop();
      this.engine = null;
    }
  }
}
