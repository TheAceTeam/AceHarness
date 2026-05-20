/**
 * OpenCode SDK Engine Wrapper
 *
 * Uses @opencode-ai/sdk to communicate with OpenCode via HTTP API
 * instead of stdio ACP. One server instance serves all sessions.
 */

import { EventEmitter } from 'events';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { normalizeEngineOutput } from './engine-output';
import { commandExists, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { loadEnvVars, buildEnvObject } from '@/lib/core/env-manager';
import {
  buildFullPrompt,
  getSessionId,
  type OpenCodeHttpClient,
  sendPromptWithOpenCodeHttp,
  ZERO_USAGE_METADATA,
} from './opencode-http-adapter';

/** Singleton server instance shared across all sessions */
let serverInstance: { url: string; close: () => void } | null = null;
let serverStarting: Promise<{ url: string; close: () => void }> | null = null;
let clientInstance: OpenCodeHttpClient | null = null;

async function runtimeImport<T = any>(moduleName: string): Promise<T> {
  try {
    return await Function('moduleName', 'return import(moduleName)')(moduleName) as T;
  } catch (error: any) {
    if (String(error?.message || error).includes('dynamic import callback')) {
      return await import(/* @vite-ignore */ moduleName) as T;
    }
    throw error;
  }
}

function requireClient(): OpenCodeHttpClient {
  if (!clientInstance) {
    throw new Error('[opencode-sdk] client not initialized');
  }
  return clientInstance;
}

async function ensureServer(): Promise<{ client: OpenCodeHttpClient; url: string }> {
  if (clientInstance && serverInstance) {
    return { client: clientInstance, url: serverInstance.url };
  }

  if (serverStarting) {
    const server = await serverStarting;
    return { client: requireClient(), url: server.url };
  }

  serverStarting = (async () => {
    const { createOpencode } = await runtimeImport<typeof import('@opencode-ai/sdk')>('@opencode-ai/sdk');
    console.log('[opencode-sdk] starting HTTP server...');

    // Load user-configured environment variables
    const serverEnv = { ...process.env };
    try {
      const userEnvVars = await loadEnvVars();
      const userEnv = buildEnvObject(userEnvVars);
      Object.assign(serverEnv, userEnv);
    } catch {
      // Ignore env loading errors
    }

    const result = await createOpencode({
      port: 0,
      hostname: '127.0.0.1',
      ...(serverEnv && { env: serverEnv } as any),
    } as any);
    serverInstance = result.server;
    clientInstance = result.client as unknown as OpenCodeHttpClient;
    console.log(`[opencode-sdk] server started at ${result.server.url}`);
    return result.server;
  })();

  const server = await serverStarting;
  serverStarting = null;
  return { client: requireClient(), url: server.url };
}

function parseProviderModel(modelId: string | undefined): { model: { providerID: string; modelID: string }; variant?: string } | null {
  const raw = String(modelId || '').trim();
  if (!raw || !raw.includes('/')) return null;
  const segments = raw.split('/').filter(Boolean);
  const [providerID, ...rest] = segments;
  const knownVariants = new Set(['minimal', 'low', 'medium', 'high', 'max']);
  const maybeVariant = rest.length > 1 ? rest[rest.length - 1] : undefined;
  const variant = maybeVariant && knownVariants.has(maybeVariant) ? maybeVariant : undefined;
  const modelSegments = variant ? rest.slice(0, -1) : rest;
  const modelID = modelSegments.join('/');
  if (!providerID || !modelID) return null;
  return { model: { providerID, modelID }, ...(variant ? { variant } : {}) };
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
      const { client, url } = await ensureServer();

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

      const fullPrompt = buildFullPrompt(options);
      const model = parseProviderModel(options.model);

      console.log(`[opencode-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      const output = await sendPromptWithOpenCodeHttp({
        engineName: 'opencode-sdk',
        client,
        sessionId: this.currentSessionId,
        fullPrompt,
        eventBaseUrl: url,
        promptBodyExtras: {
          ...(model ? { model: model.model } : {}),
          ...(model?.variant ? { variant: model.variant } : {}),
        },
        workingDirectory: options.workingDirectory,
        timeoutMs: options.timeoutMs,
        signal: this.abortController.signal,
        emit: (event) => this.emit('stream', event),
      });
      this.collectedOutput = output;

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

  /** Clean up the shared server (call on app shutdown) */
  static shutdown(): void {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
      clientInstance = null;
    }
  }
}
