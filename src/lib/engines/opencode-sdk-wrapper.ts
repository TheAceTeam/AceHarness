/**
 * OpenCode SDK Engine Wrapper
 *
 * Uses @opencode-ai/sdk to communicate with OpenCode via HTTP API
 * instead of stdio ACP. One server instance serves all sessions.
 */

import { EventEmitter } from 'events';
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineOutput } from './engine-output';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';

type TextPart = {
  type: 'text';
  text: string;
};

type Part = TextPart | {
  type: string;
  [key: string]: unknown;
};

type AssistantMessage = {
  parts?: Part[];
};

type SessionCreateResponse = {
  id?: string;
};

type SessionPromptResponse = {
  info?: AssistantMessage;
  parts?: Part[];
};

type OpencodeClient = {
  config?: {
    get(options?: Record<string, never>): Promise<{ data?: unknown; error?: unknown }>;
  };
  session: {
    create(options: {
      body: Record<string, never>;
      query?: { directory: string };
    }): Promise<{ data?: SessionCreateResponse; error?: unknown }>;
    prompt(options: {
      path: { id: string };
      body: { parts: Array<{ type: 'text'; text: string }> };
      query?: { directory: string };
    }): Promise<{ data?: SessionPromptResponse; error?: unknown }>;
  };
};

const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

/** Singleton server instance shared across all sessions */
let serverInstance: { url: string; close: () => void } | null = null;
let serverStarting: Promise<{ url: string; close: () => void }> | null = null;
let clientInstance: OpencodeClient | null = null;

function requireClient(): OpencodeClient {
  if (!clientInstance) {
    throw new Error('[opencode-sdk] client not initialized');
  }
  return clientInstance;
}

async function ensureServer(): Promise<{ client: OpencodeClient; url: string }> {
  if (clientInstance && serverInstance) {
    return { client: clientInstance, url: serverInstance.url };
  }

  if (serverStarting) {
    const server = await serverStarting;
    return { client: requireClient(), url: server.url };
  }

  serverStarting = (async () => {
    const { createOpencode } = await import('@opencode-ai/sdk');
    console.log('[opencode-sdk] starting HTTP server...');
    const result = await createOpencode({
      port: 0,
      hostname: '127.0.0.1',
    });
    serverInstance = result.server;
    clientInstance = result.client as unknown as OpencodeClient;
    console.log(`[opencode-sdk] server started at ${result.server.url}`);
    return result.server;
  })();

  const server = await serverStarting;
  serverStarting = null;
  return { client: requireClient(), url: server.url };
}

export class OpenCodeSdkEngineWrapper extends EventEmitter implements Engine {
  private currentSessionId: string | null = null;
  private collectedOutput = '';
  private abortController: AbortController | null = null;

  getName(): string {
    return 'opencode-sdk';
  }

  async isAvailable(): Promise<boolean> {
    return commandExists('opencode', getCommonCliSearchPaths());
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    const startTime = Date.now();
    this.collectedOutput = '';
    this.abortController = new AbortController();

    try {
      const { client } = await ensureServer();

      // Create or resume session
      if (options.sessionId) {
        this.currentSessionId = options.sessionId;
        console.log(`[opencode-sdk] resuming session: ${this.currentSessionId}`);
      } else {
        console.log('[opencode-sdk] creating new session...');
        const sessionResult = await client.session.create({
          body: {},
          query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
        });
        if (sessionResult.error) {
          throw new Error(`Failed to create session: ${JSON.stringify(sessionResult.error)}`);
        }
        this.currentSessionId = getSessionId(sessionResult.data);
        console.log(`[opencode-sdk] session created: ${this.currentSessionId}`);
      }

      if (!this.currentSessionId) {
        throw new Error('[opencode-sdk] no session ID');
      }
      this.emit('stream', {
        type: 'session',
        content: this.currentSessionId,
      } as EngineStreamEvent);

      // Build prompt with system prompt prepended on first turn
      let fullPrompt = options.prompt;
      if (options.systemPrompt) {
        fullPrompt = `<system>\n${options.systemPrompt}\n</system>\n\n${options.prompt}`;
      }

      // Send prompt and stream response
      console.log(`[opencode-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      const promptResult = await client.session.prompt({
        path: { id: this.currentSessionId },
        body: {
          parts: [
            {
              type: 'text',
              text: fullPrompt,
            },
          ],
        },
        query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
      });

      if (promptResult.error) {
        const errorMsg = typeof promptResult.error === 'string'
          ? promptResult.error
          : JSON.stringify(promptResult.error);
        return {
          success: false,
          output: '',
          error: errorMsg,
          sessionId: this.currentSessionId,
          metadata: ZERO_USAGE_METADATA,
        };
      }

      // Extract output from response
      const data = promptResult.data;
      const output = this.extractOutput(data);
      this.collectedOutput = output;

      // Emit as stream event for UI
      if (output) {
        this.emit('stream', { type: 'text', content: output } as EngineStreamEvent);
      }

      const durationMs = Date.now() - startTime;
      console.log(`[opencode-sdk] prompt completed: sessionId=${this.currentSessionId}, outputLength=${output.length}, duration=${durationMs}ms`);
      return {
        success: true,
        output: normalizeEngineOutput(output),
        sessionId: this.currentSessionId,
        metadata: {
          ...ZERO_USAGE_METADATA,
          duration_ms: durationMs,
        },
      };
    } catch (error: any) {
      const errorMessage = error?.message || 'OpenCode SDK error';
      this.emit('stream', { type: 'error', content: errorMessage } as EngineStreamEvent);
      return {
        success: false,
        output: this.collectedOutput || '',
        error: errorMessage,
        sessionId: this.currentSessionId || undefined,
        metadata: ZERO_USAGE_METADATA,
      };
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private extractOutput(data: SessionPromptResponse | undefined): string {
    if (!data) return '';

    const assistantInfo = data.info as AssistantMessage | undefined;
    if (assistantInfo?.parts?.length) return collectTextFromParts(assistantInfo.parts);
    if (Array.isArray(data.parts)) {
      const text = collectTextFromParts(data.parts);
      if (text) return text;
    }
    return '';
  }

  /** Clean up the shared server (call on app shutdown) */
  static shutdown(): void {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
      clientInstance = null;
    }
  }
}

function getSessionId(session: SessionCreateResponse | undefined): string | null {
  if (!session || typeof session !== 'object' || !('id' in session)) return null;
  return typeof session.id === 'string' ? session.id : null;
}

function collectTextFromParts(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}
