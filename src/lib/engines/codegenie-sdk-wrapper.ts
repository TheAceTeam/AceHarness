/**
 * CodeGenie SDK Engine Wrapper
 *
 * Uses CodeGenie's OpenCode-compatible HTTP API through @opencode-ai/sdk.
 * This wrapper intentionally does not call createOpencode(), because that
 * helper hard-codes the opencode binary and boot log prefix. Instead it can
 * either connect to ACE_CODEGENIE_SDK_BASE_URL or start `codegenie serve`
 * itself and parse CodeGenie's own "server listening" line.
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
  return String(process.env.ACE_CODEGENIE_SDK_BASE_URL || '').trim().replace(/\/+$/, '');
}

function getCodegenieCommand(): string {
  const configured = String(process.env.ACE_CODEGENIE_SDK_COMMAND || process.env.ACE_CODEGENIE_BIN || '').trim();
  if (configured) return configured;
  return findCommand('codegenie', getCommonCliSearchPaths()) || 'codegenie';
}

function getTimeoutMs(): number {
  const raw = Number.parseInt(String(process.env.ACE_CODEGENIE_SDK_TIMEOUT_MS || '').trim(), 10);
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
    CodegenieSdkEngineWrapper.shutdown();
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
  const command = getCodegenieCommand();
  const args = ['serve', '--hostname=127.0.0.1', '--port=0', '--print-logs'];
  const timeoutMs = getTimeoutMs();
  const startedAt = Date.now();
  let logTail = '';

  console.log(`[codegenie-sdk] starting managed CodeGenie server: ${command} ${args.join(' ')}`);

  // Load user-configured environment variables
  const spawnEnv = { ...process.env };
  try {
    const userEnvVars = await loadEnvVars();
    const userEnv = buildEnvObject(userEnvVars);
    Object.assign(spawnEnv, userEnv);
  } catch {
    // Ignore env loading errors
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
      const match = text.match(/codegenie server listening on (https?:\/\/[^\s]+)/i)
        || logTail.match(/codegenie server listening on (https?:\/\/[^\s]+)/i);
      if (!match?.[1]) return;
      const url = match[1].replace(/\/+$/, '');
      finish(() => {
        installShutdownHooks();
        console.log(`[codegenie-sdk] managed server started at ${url} in ${Date.now() - startedAt}ms`);
        resolve({
          url,
          close: () => {
            closeChildTree(child);
          },
        });
      });
    };

    const onError = (error: Error) => {
      finish(() => reject(new Error(`Failed to start CodeGenie SDK server (${command}): ${error.message}`)));
    };

    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => {
        reject(new Error(
          `CodeGenie SDK server exited before listening (code=${code ?? 'null'}, signal=${signal ?? 'null'}). Log tail: ${logTail.trim()}`,
        ));
      });
    };

    const timer = setTimeout(() => {
      finish(() => {
        closeChild();
        reject(new Error(`Timed out waiting for CodeGenie SDK server to start after ${timeoutMs}ms. Log tail: ${logTail.trim()}`));
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
    throw new Error(`CodeGenie SDK health check failed at ${baseUrl}/global/health`);
  }

  const { createOpencodeClient } = await runtimeImport<typeof import('@opencode-ai/sdk')>('@opencode-ai/sdk');
  const client = createOpencodeClient({ baseUrl }) as unknown as OpenCodeHttpClient;
  const configResult = await client.config?.get?.({});
  if (configResult?.error) {
    throw new Error(`CodeGenie SDK config.get failed: ${formatError(configResult.error)}`);
  }

  clientInstance = client;
  clientBaseUrl = baseUrl;
  return { client, baseUrl };
}

export class CodegenieSdkEngineWrapper extends EventEmitter implements Engine {
  private currentSessionId: string | null = null;
  private collectedOutput = '';
  private diagnosticLoggingEnabled = false;

  private emitDiagnosticLog(input: {
    message: string;
    detail?: string;
    level?: 'info' | 'warning' | 'error';
    metadata?: unknown;
    verbose?: boolean;
  }): void {
    if (!this.diagnosticLoggingEnabled) return;
    const { message, detail, level, metadata, verbose } = input;
    this.emit('stream', {
      type: 'log',
      content: message,
      metadata: {
        ...(detail ? { detail } : {}),
        ...(level ? { level } : {}),
        ...(metadata !== undefined ? { payload: metadata } : {}),
        ...(verbose !== undefined ? { verbose } : {}),
      },
    } as EngineStreamEvent);
  }

  getName(): string {
    return 'codegenie-sdk';
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
    return !!managedServer || !!serverStarting || !!findCommand('codegenie', getCommonCliSearchPaths());
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    const startedAt = Date.now();
    this.collectedOutput = '';
    this.diagnosticLoggingEnabled = Boolean(options.diagnosticLogging);
    this.emitDiagnosticLog({
      message: 'CodeGenie SDK execute start',
      detail: `sessionId=${options.sessionId || '<new>'}, model=${options.model || '<default>'}`,
      metadata: {
        workingDirectory: options.workingDirectory,
        timeoutMs: options.timeoutMs,
      },
      verbose: true,
    });

    try {
      this.emitDiagnosticLog({
        message: 'Ensuring CodeGenie SDK client',
        detail: options.workingDirectory,
        verbose: true,
      });
      const { client, baseUrl } = await ensureClient();
      this.emitDiagnosticLog({
        message: 'CodeGenie SDK client ready',
        detail: baseUrl,
        verbose: true,
      });

      if (options.sessionId) {
        this.currentSessionId = options.sessionId;
        console.log(`[codegenie-sdk] resuming session: ${this.currentSessionId}`);
        this.emitDiagnosticLog({
          message: 'Resuming CodeGenie session',
          detail: this.currentSessionId,
          verbose: true,
        });
      } else {
        this.currentSessionId = null;
        console.log(`[codegenie-sdk] creating session via ${baseUrl}`);
        this.emitDiagnosticLog({
          message: 'Creating CodeGenie session',
          detail: baseUrl,
          verbose: true,
        });
        const sessionResult = await client.session.create({
          body: {},
          query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
        });
        if (sessionResult.error) {
          throw new Error(`CodeGenie SDK session.create failed: ${formatError(sessionResult.error)}`);
        }
        this.currentSessionId = getSessionId(sessionResult.data);
        console.log(`[codegenie-sdk] session created: ${this.currentSessionId}`);
        this.emitDiagnosticLog({
          message: 'CodeGenie session created',
          detail: this.currentSessionId || '',
          verbose: true,
        });
      }

      if (!this.currentSessionId) {
        throw new Error('[codegenie-sdk] no session ID');
      }

      this.emit('stream', {
        type: 'session',
        content: this.currentSessionId,
      } as EngineStreamEvent);

      const fullPrompt = buildFullPrompt(options);

      console.log(`[codegenie-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      this.emitDiagnosticLog({
        message: 'CodeGenie SDK prompt start',
        detail: `sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`,
        verbose: true,
      });
      const model = parseProviderModel(options.model);
      const output = await sendPromptWithOpenCodeHttp({
        engineName: 'codegenie-sdk',
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
        ...(this.diagnosticLoggingEnabled ? { log: (entry) => this.emitDiagnosticLog(entry) } : {}),
      });
      if (!output.trim()) {
        throw new Error('CodeGenie SDK prompt returned empty output');
      }
      this.collectedOutput = output;

      const durationMs = Date.now() - startedAt;
      console.log(`[codegenie-sdk] prompt completed: sessionId=${this.currentSessionId}, outputLength=${output.length}, duration=${durationMs}ms`);
      this.emitDiagnosticLog({
        message: 'CodeGenie SDK execute done',
        detail: `outputLength=${output.length}, duration=${durationMs}ms`,
        metadata: {
          sessionId: this.currentSessionId,
        },
        verbose: true,
      });

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
      const errorMessage = error?.message || 'CodeGenie SDK error';
      this.emitDiagnosticLog({
        level: 'error',
        message: 'CodeGenie SDK execute failed',
        detail: errorMessage,
      });
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
