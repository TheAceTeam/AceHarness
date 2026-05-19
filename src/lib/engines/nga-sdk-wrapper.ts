/**
 * NGA SDK Engine Wrapper
 *
 * Uses NGA/ngagent's OpenCode-compatible HTTP API through @opencode-ai/sdk.
 * It can connect to ACE_NGA_SDK_BASE_URL or start `ngagent serve` / `nga serve`
 * and then reuse the common OpenCode HTTP streaming adapter.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { normalizeEngineOutput } from './engine-output';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { loadEnvVars, buildEnvObject } from '@/lib/core/env-manager';
import { isWindows } from '@/lib/core/runtime-platform';
import {
  buildFullPrompt,
  formatError,
  getSessionId,
  type OpenCodeHttpClient,
  sendPromptWithOpenCodeHttp,
  ZERO_USAGE_METADATA,
} from './opencode-http-adapter';

type ManagedServer = {
  url: string;
  close: () => void;
};

let clientInstance: OpenCodeHttpClient | null = null;
let clientBaseUrl: string | null = null;
let managedServer: ManagedServer | null = null;
let serverStarting: Promise<ManagedServer> | null = null;
let shutdownHooksInstalled = false;

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

function getBaseUrl(): string {
  return String(process.env.ACE_NGA_SDK_BASE_URL || '').trim().replace(/\/+$/, '');
}

function getNgaCommand(): string {
  const configured = String(process.env.ACE_NGA_SDK_COMMAND || process.env.ACE_NGA_BIN || '').trim();
  if (configured) return configured;
  const searchPaths = getCommonCliSearchPaths();
  return findCommand('ngagent', searchPaths) || findCommand('nga', searchPaths) || 'nga';
}

function getTimeoutMs(): number {
  const raw = Number.parseInt(String(process.env.ACE_NGA_SDK_TIMEOUT_MS || '').trim(), 10);
  if (!Number.isFinite(raw)) return 10_000;
  return Math.min(120_000, Math.max(1_000, raw));
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  const shutdown = () => {
    NgaSdkEngineWrapper.shutdown();
  };
  process.once('exit', shutdown);
  process.once('SIGINT', () => {
    shutdown();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    shutdown();
    process.exit(143);
  });
}

async function ensureManagedServer(): Promise<ManagedServer> {
  if (managedServer) return managedServer;
  if (serverStarting) return serverStarting;

  serverStarting = startManagedServer()
    .then((server) => {
      managedServer = server;
      return server;
    })
    .finally(() => {
      serverStarting = null;
    });

  return serverStarting;
}

async function startManagedServer(): Promise<ManagedServer> {
  const command = getNgaCommand();
  const args = ['serve', '--hostname=127.0.0.1', '--port=0'];
  const timeoutMs = getTimeoutMs();
  const startedAt = Date.now();
  let logTail = '';

  console.log(`[nga-sdk] starting managed NGA server: ${command} ${args.join(' ')}`);

  const spawnEnv = { ...process.env };
  try {
    const userEnvVars = await loadEnvVars();
    Object.assign(spawnEnv, buildEnvObject(userEnvVars));
  } catch {
    // ignore env loading errors
  }

  return await new Promise<ManagedServer>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: spawnEnv,
      shell: isWindows(),
      windowsHide: true,
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('error', onError);
      child.off('exit', onExit);
      fn();
    };

    const closeChild = () => {
      try {
        if (!child.killed) child.kill();
      } catch {
        // ignore shutdown failures
      }
    };

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      logTail = (logTail + text).slice(-4000);
      const match = text.match(/(?:nga|ngagent|opencode|codeagent) server listening on (https?:\/\/[^\s]+)/i)
        || logTail.match(/(?:nga|ngagent|opencode|codeagent) server listening on (https?:\/\/[^\s]+)/i);
      if (!match?.[1]) return;
      const url = match[1].replace(/\/+$/, '');
      finish(() => {
        installShutdownHooks();
        console.log(`[nga-sdk] managed server started at ${url} in ${Date.now() - startedAt}ms`);
        resolve({
          url,
          close: () => {
            closeChildTree(child);
          },
        });
      });
    };

    const onError = (error: Error) => {
      finish(() => reject(new Error(`Failed to start NGA SDK server (${command}): ${error.message}`)));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => {
        reject(new Error(
          `NGA SDK server exited before listening (code=${code ?? 'null'}, signal=${signal ?? 'null'}). Log tail: ${logTail.trim()}`,
        ));
      });
    };

    const timer = setTimeout(() => {
      finish(() => {
        closeChild();
        reject(new Error(`Timed out waiting for NGA SDK server to start after ${timeoutMs}ms. Log tail: ${logTail.trim()}`));
      });
    }, timeoutMs);

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

function closeChildTree(child: ChildProcessWithoutNullStreams): void {
  try {
    if (child.killed || child.exitCode !== null) return;
    if (isWindows() && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      return;
    }
    child.kill('SIGTERM');
  } catch {
    // ignore shutdown failures
  }
}

async function ensureClient(): Promise<{ client: OpenCodeHttpClient; baseUrl: string }> {
  const externalBaseUrl = getBaseUrl();
  const baseUrl = externalBaseUrl || (await ensureManagedServer()).url;

  if (clientInstance && clientBaseUrl === baseUrl) {
    return { client: clientInstance, baseUrl };
  }

  const health = await fetchJsonWithTimeout(`${baseUrl}/global/health`, getTimeoutMs());
  if (!health?.healthy) {
    throw new Error(`NGA SDK health check failed at ${baseUrl}/global/health`);
  }

  const { createOpencodeClient } = await runtimeImport<typeof import('@opencode-ai/sdk')>('@opencode-ai/sdk');
  const client = createOpencodeClient({ baseUrl }) as unknown as OpenCodeHttpClient;
  const configResult = await client.config?.get?.({});
  if (configResult?.error) {
    throw new Error(`NGA SDK config.get failed: ${formatError(configResult.error)}`);
  }

  clientInstance = client;
  clientBaseUrl = baseUrl;
  return { client, baseUrl };
}

export class NgaSdkEngineWrapper extends EventEmitter implements Engine {
  private currentSessionId: string | null = null;
  private collectedOutput = '';

  getName(): string {
    return 'nga-sdk';
  }

  async isAvailable(): Promise<boolean> {
    const externalBaseUrl = getBaseUrl();
    if (externalBaseUrl) {
      try {
        const health = await fetchJsonWithTimeout(`${externalBaseUrl}/global/health`, getTimeoutMs());
        return !!health?.healthy;
      } catch {
        return false;
      }
    }
    return !!managedServer || !!serverStarting || !!findCommand('ngagent', getCommonCliSearchPaths()) || !!findCommand('nga', getCommonCliSearchPaths());
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    const startedAt = Date.now();
    this.collectedOutput = '';

    try {
      const { client, baseUrl } = await ensureClient();

      if (options.sessionId) {
        this.currentSessionId = options.sessionId;
        console.log(`[nga-sdk] resuming session: ${this.currentSessionId}`);
      } else {
        console.log(`[nga-sdk] creating session via ${baseUrl}`);
        const sessionResult = await client.session.create({
          body: {},
          query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
        });
        if (sessionResult.error) {
          throw new Error(`NGA SDK session.create failed: ${formatError(sessionResult.error)}`);
        }
        this.currentSessionId = getSessionId(sessionResult.data);
        console.log(`[nga-sdk] session created: ${this.currentSessionId}`);
      }

      if (!this.currentSessionId) {
        throw new Error('[nga-sdk] no session ID');
      }

      this.emit('stream', {
        type: 'session',
        content: this.currentSessionId,
      } as EngineStreamEvent);

      const fullPrompt = buildFullPrompt(options);
      const model = parseProviderModel(options.model);

      console.log(`[nga-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      const output = await sendPromptWithOpenCodeHttp({
        engineName: 'nga-sdk',
        client,
        sessionId: this.currentSessionId,
        fullPrompt,
        eventBaseUrl: baseUrl,
        promptBodyExtras: {
          ...(model ? { model: model.model } : {}),
          ...(model?.variant ? { variant: model.variant } : {}),
        },
        workingDirectory: options.workingDirectory,
        timeoutMs: options.timeoutMs,
        emit: (event) => this.emit('stream', event),
      });
      if (!output.trim()) {
        throw new Error('NGA SDK prompt returned empty output');
      }
      this.collectedOutput = output;

      const durationMs = Date.now() - startedAt;
      console.log(`[nga-sdk] prompt completed: sessionId=${this.currentSessionId}, outputLength=${output.length}, duration=${durationMs}ms`);

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
      const errorMessage = error?.message || 'NGA SDK error';
      this.emit('stream', { type: 'error', content: errorMessage } as EngineStreamEvent);
      return {
        success: false,
        output: this.collectedOutput,
        error: errorMessage,
        sessionId: this.currentSessionId || undefined,
        metadata: ZERO_USAGE_METADATA,
      };
    }
  }

  cancel(): void {
    // The current SDK client call path does not expose per-request cancellation.
  }

  static shutdown(): void {
    if (managedServer) {
      managedServer.close();
      managedServer = null;
    }
    clientInstance = null;
    clientBaseUrl = null;
  }
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
