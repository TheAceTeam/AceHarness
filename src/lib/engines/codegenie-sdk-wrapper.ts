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
import type { Engine, EngineOptions, EngineResult, EngineResultMetadata, EngineStreamEvent } from './engine-interface';
import { normalizeEngineOutput } from './engine-output';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';

type TextPart = {
  type: 'text';
  text: string;
};

type Part = TextPart | {
  type: string;
  [key: string]: unknown;
};

type SessionCreateResponse = {
  id?: string;
};

type SessionPromptResponse = {
  info?: { parts?: Part[]; error?: unknown };
  parts?: Part[];
  [key: string]: unknown;
};

type CodegenieSdkClient = {
  config?: {
    get(options?: Record<string, never>): Promise<{ data?: unknown; error?: unknown }>;
  };
  session: {
    create(options: {
      body: Record<string, never>;
      query?: { directory?: string };
    }): Promise<{ data?: SessionCreateResponse; error?: unknown }>;
    prompt(options: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        parts: Array<{ type: 'text'; text: string }>;
      };
      query?: { directory?: string };
    }): Promise<{ data?: SessionPromptResponse; error?: unknown }>;
  };
};

type ManagedServer = {
  url: string;
  close: () => void;
};

const ZERO_USAGE_METADATA: EngineResultMetadata = {
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  cost_usd: 0,
  duration_ms: 0,
  duration_api_ms: 0,
  num_turns: 0,
};

let clientInstance: CodegenieSdkClient | null = null;
let clientBaseUrl: string | null = null;
let managedServer: ManagedServer | null = null;
let serverStarting: Promise<ManagedServer> | null = null;
let shutdownHooksInstalled = false;

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

  return await new Promise<ManagedServer>((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: process.platform === 'win32',
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
    if (process.platform === 'win32' && child.pid) {
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

async function ensureClient(): Promise<{ client: CodegenieSdkClient; baseUrl: string }> {
  const externalBaseUrl = getBaseUrl();
  const baseUrl = externalBaseUrl || (await ensureManagedServer()).url;

  if (clientInstance && clientBaseUrl === baseUrl) {
    return { client: clientInstance, baseUrl };
  }

  const health = await fetchJsonWithTimeout(`${baseUrl}/global/health`, getTimeoutMs());
  if (!health?.healthy) {
    throw new Error(`CodeGenie SDK health check failed at ${baseUrl}/global/health`);
  }

  const { createOpencodeClient } = await import('@opencode-ai/sdk');
  const client = createOpencodeClient({ baseUrl }) as unknown as CodegenieSdkClient;
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

    try {
      const { client, baseUrl } = await ensureClient();

      if (options.sessionId) {
        this.currentSessionId = options.sessionId;
        console.log(`[codegenie-sdk] resuming session: ${this.currentSessionId}`);
      } else {
        console.log(`[codegenie-sdk] creating session via ${baseUrl}`);
        const sessionResult = await client.session.create({
          body: {},
          query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
        });
        if (sessionResult.error) {
          throw new Error(`CodeGenie SDK session.create failed: ${formatError(sessionResult.error)}`);
        }
        this.currentSessionId = getSessionId(sessionResult.data);
        console.log(`[codegenie-sdk] session created: ${this.currentSessionId}`);
      }

      if (!this.currentSessionId) {
        throw new Error('[codegenie-sdk] no session ID');
      }

      this.emit('stream', {
        type: 'session',
        content: this.currentSessionId,
      } as EngineStreamEvent);

      let fullPrompt = options.prompt;
      if (options.systemPrompt) {
        fullPrompt = `<system>\n${options.systemPrompt}\n</system>\n\n${options.prompt}`;
      }

      console.log(`[codegenie-sdk] sendPrompt: sessionId=${this.currentSessionId}, promptLength=${fullPrompt.length}`);
      const model = parseProviderModel(options.model);
      const promptResult = await client.session.prompt({
        path: { id: this.currentSessionId },
        body: {
          ...(model ? { model } : {}),
          parts: [{ type: 'text', text: fullPrompt }],
        },
        query: options.workingDirectory ? { directory: options.workingDirectory } : undefined,
      });

      if (promptResult.error) {
        throw new Error(`CodeGenie SDK prompt failed: ${formatError(promptResult.error)}`);
      }
      if (promptResult.data?.info?.error) {
        throw new Error(`CodeGenie SDK agent failed: ${formatError(promptResult.data.info.error)}`);
      }

      const output = extractOutput(promptResult.data);
      if (!output.trim()) {
        throw new Error('CodeGenie SDK prompt returned empty output');
      }
      this.collectedOutput = output;
      if (output) {
        this.emit('stream', { type: 'text', content: output } as EngineStreamEvent);
      }

      const durationMs = Date.now() - startedAt;
      console.log(`[codegenie-sdk] prompt completed: sessionId=${this.currentSessionId}, outputLength=${output.length}, duration=${durationMs}ms`);

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

function getSessionId(session: SessionCreateResponse | undefined): string | null {
  if (!session || typeof session !== 'object') return null;
  return typeof session.id === 'string' ? session.id : null;
}

function parseProviderModel(modelId: string | undefined): { providerID: string; modelID: string } | null {
  const raw = String(modelId || '').trim();
  if (!raw || !raw.includes('/')) return null;
  const [providerID, ...rest] = raw.split('/');
  const modelID = rest.join('/');
  if (!providerID || !modelID) return null;
  return { providerID, modelID };
}

function extractOutput(data: SessionPromptResponse | undefined): string {
  if (!data) return '';
  const direct = collectTextFromParts(data.info?.parts) || collectTextFromParts(data.parts);
  if (direct) return direct;
  return collectTextDeep(data);
}

function collectTextFromParts(parts: Part[] | undefined): string {
  if (!Array.isArray(parts)) return '';
  return parts
    .filter((part): part is TextPart => part?.type === 'text' && typeof (part as any).text === 'string')
    .map((part) => part.text)
    .join('');
}

function collectTextDeep(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  if (Array.isArray(value)) {
    return value.map(collectTextDeep).filter(Boolean).join('');
  }
  const record = value as Record<string, unknown>;
  if (record.type === 'text' && typeof record.text === 'string') return record.text;
  for (const key of ['parts', 'content', 'message', 'info', 'data']) {
    const text = collectTextDeep(record[key]);
    if (text) return text;
  }
  return '';
}

function formatError(error: unknown): string {
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
