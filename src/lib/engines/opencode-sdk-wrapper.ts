/**
 * OpenCode SDK Engine Wrapper
 *
 * Uses @opencode-ai/sdk to communicate with OpenCode via HTTP API
 * instead of stdio ACP. One server instance serves all sessions.
 *
 * Note: the upstream SDK's createOpencode({ env }) helper currently does not
 * forward custom env vars into the spawned `opencode serve` process. We work
 * around that here by temporarily patching process.env during server startup,
 * then restoring it immediately after the child process is launched.
 */

import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { EventEmitter } from 'events';
import { ensureOpenCodeCompatibleMcpServers } from '@/lib/mcp/registry';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from './engine-interface';
import { normalizeEngineOutput } from './engine-output';
import { buildConfiguredProcessEnvSync, getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { buildOpenCodeRawCommandPrompt, isOpenCodeSlashCommandPrompt, parseOpenCodeSlashCommand } from './opencode-command';
import { mergeOpenCodeCommandsWithFileFallback } from './opencode-command-files';
import {
  buildFullPrompt,
  discoverOpenCodeCommandsFromHttpClient,
  discoverOpenCodeModelsFromHttpClient,
  executeCommandWithOpenCodeHttp,
  getSessionId,
  resolveOpenCodeModelId,
  type OpenCodeHttpClient,
  type OpenCodeDiscoveredCommand,
  type OpenCodeDiscoveredModel,
  sendPromptWithOpenCodeHttp,
  ZERO_USAGE_METADATA,
} from './opencode-http-adapter';

/** Singleton server instance shared across all sessions */
let serverInstance: { url: string; close: () => void } | null = null;
let serverEnvFingerprint: string | null = null;
let serverStarting: Promise<{ url: string; close: () => void }> | null = null;
let serverStartingFingerprint: string | null = null;
let clientInstance: OpenCodeHttpClient | null = null;
let activeExecutions = 0;
const OPENCODE_SERVER_STARTUP_TIMEOUT_MS = 20_000;
const IGNORABLE_OPENCODE_SDK_ERROR_PATTERNS = [
  /ECONNRESET/i,
  /child exited early code=1 signal=null; stderr tail:\s*<empty>/i,
];

function isIgnorableOpenCodeSdkTailError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  if (!message.trim()) return false;
  return IGNORABLE_OPENCODE_SDK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

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

function configuredEnvOptions(userId?: string): { userId: string } | undefined {
  return userId ? { userId } : undefined;
}

function getOpencodeCommand(userId?: string): string {
  return findCommand('opencode', getConfiguredCliSearchPaths(getCommonCliSearchPaths(), configuredEnvOptions(userId))) || 'opencode';
}

function fingerprintEnv(env: NodeJS.ProcessEnv): string {
  return Object.entries(env)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}\0${String(value ?? '')}`)
    .join('\n');
}

async function withTemporaryProcessEnv<T>(env: NodeJS.ProcessEnv, action: () => Promise<T>): Promise<T> {
  const snapshot = new Map<string, string | undefined>();
  const keys = new Set<string>([
    ...Object.keys(process.env),
    ...Object.keys(env),
  ]);

  for (const key of keys) {
    snapshot.set(key, process.env[key]);
  }

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await action();
  } finally {
    for (const key of keys) {
      const original = snapshot.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  }
}

async function ensureServer(userId?: string): Promise<{ client: OpenCodeHttpClient; url: string }> {
  const serverEnv = buildConfiguredProcessEnvSync(
    undefined,
    process.env,
    configuredEnvOptions(userId),
  );
  const nextFingerprint = JSON.stringify({
    userId: userId || '',
    env: fingerprintEnv(serverEnv),
  });

  if (clientInstance && serverInstance && serverEnvFingerprint === nextFingerprint) {
    return { client: clientInstance, url: serverInstance.url };
  }

  if (serverStarting && serverStartingFingerprint === nextFingerprint) {
    const server = await serverStarting;
    return { client: requireClient(), url: server.url };
  }

  if (serverStarting) {
    try {
      await serverStarting;
    } catch {
      // ignore: we are about to start a fresh server below
    }
  }

  if (serverInstance && serverEnvFingerprint !== nextFingerprint) {
    console.log('[opencode-sdk] configured env changed, restarting HTTP server...');
    OpenCodeSdkEngineWrapper.shutdown();
  }

  serverStartingFingerprint = nextFingerprint;
  serverStarting = (async () => {
    const { createOpencodeClient, createOpencodeServer } = await runtimeImport<typeof import('@opencode-ai/sdk')>('@opencode-ai/sdk');
    console.log(`[opencode-sdk] starting HTTP server with command ${getOpencodeCommand(userId)}...`);

    const server = await withTemporaryProcessEnv(serverEnv, async () => {
      return await createOpencodeServer({
        port: 0,
        hostname: '127.0.0.1',
        timeout: OPENCODE_SERVER_STARTUP_TIMEOUT_MS,
      } as any);
    });

    serverInstance = server;
    serverEnvFingerprint = nextFingerprint;
    clientInstance = createOpencodeClient({
      baseUrl: server.url,
    }) as unknown as OpenCodeHttpClient;
    console.log(`[opencode-sdk] server started at ${server.url}`);
    return server;
  })().finally(() => {
    serverStarting = null;
    serverStartingFingerprint = null;
  });

  const server = await serverStarting;
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

export async function discoverOpenCodeSdkModels(): Promise<OpenCodeDiscoveredModel[]> {
  const { client } = await ensureServer();
  return discoverOpenCodeModelsFromHttpClient(client);
}

export async function discoverOpenCodeSdkCommands(userId?: string, workingDirectory?: string): Promise<OpenCodeDiscoveredCommand[]> {
  const { client } = await ensureServer(userId);
  return mergeOpenCodeCommandsWithFileFallback(
    await discoverOpenCodeCommandsFromHttpClient(client),
    { workingDirectory, userId },
  );
}

export class OpenCodeSdkEngineWrapper extends EventEmitter implements Engine {
  private currentSessionId: string | null = null;
  private collectedOutput = '';
  private streamedTranscript = '';
  private abortController: AbortController | null = null;
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
    return 'opencode-sdk';
  }

  async isAvailable(): Promise<boolean> {
    return !!serverInstance || !!serverStarting || !!findCommand('opencode', getConfiguredCliSearchPaths(getCommonCliSearchPaths()));
  }

  async execute(options: EngineOptions): Promise<EngineResult> {
    const startTime = Date.now();
    activeExecutions += 1;
    this.collectedOutput = '';
    this.streamedTranscript = '';
    this.abortController = new AbortController();
    this.diagnosticLoggingEnabled = Boolean(options.diagnosticLogging);
    this.emitDiagnosticLog({
      message: 'OpenCode SDK execute start',
      detail: `sessionId=${options.sessionId || '<new>'}, model=${options.model || '<default>'}`,
      metadata: {
        workingDirectory: options.workingDirectory,
        timeoutMs: options.timeoutMs,
      },
      verbose: true,
    });

    try {
      this.emitDiagnosticLog({
        message: 'Ensuring OpenCode SDK server/client',
        detail: options.workingDirectory,
        verbose: true,
      });
      const { client, url } = await ensureServer(options.userId);
      this.emitDiagnosticLog({
        message: 'OpenCode SDK server ready',
        detail: url,
        verbose: true,
      });
      await ensureOpenCodeCompatibleMcpServers(client as any, options.workingDirectory, options.mcpServers as any);

      // Create or resume session
      if (options.sessionId) {
        this.currentSessionId = options.sessionId;
        console.log(`[opencode-sdk] resuming session: ${this.currentSessionId}`);
        this.emitDiagnosticLog({
          message: 'Resuming OpenCode session',
          detail: this.currentSessionId,
          verbose: true,
        });
      } else {
        this.currentSessionId = null;
        console.log('[opencode-sdk] creating new session...');
        this.emitDiagnosticLog({
          message: 'Creating OpenCode session',
          detail: options.workingDirectory,
          verbose: true,
        });
        const sessionResult = await client.session.create({
          body: {},
          query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
        });
        if (sessionResult.error) {
          throw new Error(`Failed to create session: ${JSON.stringify(sessionResult.error)}`);
        }
        this.currentSessionId = getSessionId(sessionResult.data);
        console.log(`[opencode-sdk] session created: ${this.currentSessionId}`);
        this.emitDiagnosticLog({
          message: 'OpenCode session created',
          detail: this.currentSessionId || '',
          verbose: true,
        });
      }

      if (!this.currentSessionId) {
        throw new Error('[opencode-sdk] no session ID');
      }
      this.emit('stream', {
        type: 'session',
        content: this.currentSessionId,
      } as EngineStreamEvent);

      let resolvedModelId = String(options.model || '').trim();
      if (resolvedModelId && !resolvedModelId.includes('/')) {
        const availableModels = await discoverOpenCodeModelsFromHttpClient(client);
        resolvedModelId = resolveOpenCodeModelId(resolvedModelId, availableModels) || resolvedModelId;
        this.emitDiagnosticLog({
          message: 'OpenCode SDK resolved model',
          detail: `${options.model} -> ${resolvedModelId}`,
          metadata: { availableModelCount: availableModels.length },
          verbose: true,
        });
      }
      const model = parseProviderModel(resolvedModelId);
      const isSlashCommand = Boolean(options.rawPrompt) && isOpenCodeSlashCommandPrompt(options.prompt);

      if (isSlashCommand) {
        const parsedCommand = parseOpenCodeSlashCommand(options.prompt);
        if (!parsedCommand) {
          throw new Error('Invalid OpenCode slash command');
        }
        const commands = await mergeOpenCodeCommandsWithFileFallback(
          await discoverOpenCodeCommandsFromHttpClient(client),
          { workingDirectory: options.workingDirectory, userId: options.userId },
        );
        const commandExists = commands.some((command) => command.name.toLowerCase() === parsedCommand.command.toLowerCase());
        if (!commandExists) {
          throw new Error(`OpenCode command not found: ${parsedCommand.command}`);
        }
        this.emitDiagnosticLog({
          message: 'OpenCode SDK command start',
          detail: `/${parsedCommand.command}`,
          verbose: true,
        });
        const output = await executeCommandWithOpenCodeHttp({
          client,
          sessionId: this.currentSessionId,
          command: {
            command: parsedCommand.command,
            arguments: parsedCommand.arguments,
            model: resolvedModelId || options.model,
          },
          workingDirectory: options.workingDirectory,
          emit: (event) => {
            if (event.type === 'text' && typeof event.content === 'string') {
              this.streamedTranscript += event.content;
            }
            this.emit('stream', event);
          },
          ...(this.diagnosticLoggingEnabled ? { log: (entry) => this.emitDiagnosticLog(entry) } : {}),
        });
        this.collectedOutput = this.streamedTranscript || output;
        const durationMs = Date.now() - startTime;
        return {
          success: true,
          output: normalizeEngineOutput(this.collectedOutput || output),
          sessionId: this.currentSessionId,
          metadata: {
            ...ZERO_USAGE_METADATA,
            duration_ms: durationMs,
          },
        };
      }

      const fullPrompt = isSlashCommand
        ? buildOpenCodeRawCommandPrompt(options.prompt)
        : buildFullPrompt(options);
      if (isSlashCommand) {
        this.emitDiagnosticLog({
          message: 'OpenCode SDK raw slash command prompt fallback',
          detail: fullPrompt.split(/\r?\n/, 1)[0] || '',
          verbose: true,
        });
      }

      console.log(`[opencode-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      this.emitDiagnosticLog({
        message: 'OpenCode SDK prompt start',
        detail: `sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`,
        verbose: true,
      });
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
        permissionResponse: 'always',
        emit: (event) => {
          if (event.type === 'text' && typeof event.content === 'string') {
            this.streamedTranscript += event.content;
          }
          this.emit('stream', event);
        },
        ...(this.diagnosticLoggingEnabled ? { log: (entry) => this.emitDiagnosticLog(entry) } : {}),
      });
      this.collectedOutput = this.streamedTranscript || output;

      const durationMs = Date.now() - startTime;
      console.log(`[opencode-sdk] prompt completed: sessionId=${this.currentSessionId}, outputLength=${output.length}, duration=${durationMs}ms`);
      this.emitDiagnosticLog({
        message: 'OpenCode SDK execute done',
        detail: `outputLength=${output.length}, duration=${durationMs}ms`,
        metadata: {
          sessionId: this.currentSessionId,
        },
        verbose: true,
      });
      return {
        success: true,
        output: normalizeEngineOutput(this.collectedOutput || output),
        sessionId: this.currentSessionId,
        metadata: {
          ...ZERO_USAGE_METADATA,
          duration_ms: durationMs,
        },
      };
    } catch (error: any) {
      const errorMessage = error?.message || 'OpenCode SDK error';
      const normalizedOutput = normalizeEngineOutput(this.collectedOutput || this.streamedTranscript || '');
      if (normalizedOutput && isIgnorableOpenCodeSdkTailError(errorMessage)) {
        this.emitDiagnosticLog({
          level: 'warning',
          message: 'OpenCode SDK ignored tail transport error after final output',
          detail: errorMessage,
          metadata: {
            outputLength: normalizedOutput.length,
            sessionId: this.currentSessionId,
          },
        });
        return {
          success: true,
          output: normalizedOutput,
          sessionId: this.currentSessionId || undefined,
          metadata: ZERO_USAGE_METADATA,
        };
      }
      this.emitDiagnosticLog({
        level: 'error',
        message: 'OpenCode SDK execute failed',
        detail: errorMessage,
      });
      this.emit('stream', { type: 'error', content: errorMessage } as EngineStreamEvent);
      return {
        success: false,
        output: normalizedOutput,
        error: errorMessage,
        sessionId: this.currentSessionId || undefined,
        metadata: ZERO_USAGE_METADATA,
      };
    } finally {
      activeExecutions = Math.max(0, activeExecutions - 1);
      this.abortController = null;
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  cleanup(): void {
    this.cancel();
    if (activeExecutions === 0) {
      OpenCodeSdkEngineWrapper.shutdown();
    }
  }

  /** Clean up the shared server (call on app shutdown) */
  static shutdown(): void {
    if (serverInstance) {
      serverInstance.close();
      serverInstance = null;
    }
    serverEnvFingerprint = null;
    serverStartingFingerprint = null;
    clientInstance = null;
  }
}
