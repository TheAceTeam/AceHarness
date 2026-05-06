/**
 * Unified ACP Engine — powered by @agentclientprotocol/sdk
 *
 * Replaces hand-rolled JSON-RPC with ClientSideConnection + ndJsonStream.
 * Used by all ACP-compatible engines: Kiro CLI, OpenCode, Cursor.
 */

import { spawn, ChildProcess } from 'child_process';
import { delimiter as pathDelimiter } from 'path';
import { Writable, Readable } from 'node:stream';
import { EventEmitter } from 'events';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  StopReason,
  SessionUpdate,
  Client,
  Agent,
} from '@agentclientprotocol/sdk';

// ============================================================================
// ACP Engine Configuration
// ============================================================================

export interface ACPEngineConfig {
  /** Engine type: 'opencode', 'nga', 'codegenie', 'kiro-cli', 'cursor', ... */
  engineType: string;
  /** Command to execute (e.g., 'opencode', 'nga', 'codegenie', 'kiro-cli', 'cursor') */
  command: string;
  /** Working directory */
  workingDirectory: string;
  /** Agent name (optional) */
  agentName?: string;
  /** Model to use (optional) */
  model?: string;
  /** Additional arguments */
  args?: string[];
  /** Field name for prompt content in session/prompt (default: 'prompt', kiro uses 'content') */
  promptField?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// Re-export StopReason so wrappers can use it
export type ACPStopReason = StopReason;

/** Extra bin dirs for spawned CLI (POSIX servers); Windows uses native PATH only — wrong delimiter breaks child env. */
function augmentPathForSpawn(existingPath: string | undefined): string {
  const extra =
    process.platform === 'win32' ? [] : ['/root/.local/bin', '/usr/local/bin'];
  return [existingPath || '', ...extra].filter(Boolean).join(pathDelimiter);
}

/** Quote one argv token for cmd.exe when paths contain spaces or quotes. */
function escapeWinCmdToken(s: string): string {
  if (s === '') return '""';
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Spawn ACP CLI. On Windows, plain `spawn('codegenie', …)` often fails to resolve npm `.cmd` shims;
 * use `shell: true` so `codegenie.cmd` / PATH behave like an interactive terminal.
 */
function spawnAcpCli(
  engineType: string,
  command: string,
  argv: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv },
): ChildProcess {
  if (process.platform !== 'win32') {
    return spawn(command, argv, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  const line = [command, ...argv].map(escapeWinCmdToken).join(' ');
  console.log(`[${engineType}] win32 shell spawn (cmd): ${line}`);
  return spawn(line, {
    shell: true,
    windowsHide: true,
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
// ============================================================================
// Unified ACP Engine
// ============================================================================

export class ACPEngine extends EventEmitter {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private initialized = false;
  private availableModels: Array<{ modelId: string; name: string }> = [];
  private lastStderrChunk = '';

  constructor(private config: ACPEngineConfig) {
    super();
  }

  /**
   * Start the ACP engine process
   */
  async start(): Promise<void> {
    const args = this.buildCommandArgs();
    console.log(`[${this.config.engineType}] spawning: ${this.config.command} ${args.join(' ')}`);

    const childEnv = {
      ...process.env,
      PATH: augmentPathForSpawn(process.env.PATH),
      ...this.config.env,
    };

    this.process = spawnAcpCli(this.config.engineType, this.config.command, args, {
      cwd: this.config.workingDirectory,
      env: childEnv,
    });

    if (!this.process.stdin || !this.process.stdout || !this.process.stderr) {
      throw new Error(`Failed to create ${this.config.engineType} process streams`);
    }

    this.process.stderr.on('data', (data: Buffer) => {
      const msg = data.toString();
      this.lastStderrChunk = msg.trim();
      console.error(`[${this.config.engineType} stderr] ${msg.trim()}`);
      this.emit('log', msg);
    });

    this.process.on('exit', (code, signal) => {
      if (code !== 0 || signal) {
        console.warn(
          `[${this.config.engineType}] child exited early code=${code} signal=${signal}; stderr tail: ${this.lastStderrChunk?.slice(0, 500) || '<empty>'}`
        );
      }
      this.emit('exit', { code, signal });
      this.cleanup(`${this.config.engineType} process exited (code=${code}, signal=${signal})`);
    });

    this.process.on('error', (error) => {
      this.emit('error', error);
      this.cleanup(`${this.config.engineType} process error: ${error.message}`);
    });
    // Convert Node streams to Web streams for the SDK
    const output = Writable.toWeb(this.process.stdin) as WritableStream<Uint8Array>;
    const input = Readable.toWeb(this.process.stdout) as ReadableStream<Uint8Array>;
    const stream = ndJsonStream(output, input);

    const engine = this; // capture for closure
    // SDK calls notification/request handlers without awaiting the inner Promise in all paths;
    // any rejection becomes process unhandledRejection — handlers must never throw.
    this.connection = new ClientSideConnection((_agent: Agent): Client => ({
      async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        try {
          const optionId = params.options[0]?.optionId ?? 'always';
          engine.emit('permission', params);
          return { outcome: { outcome: 'selected', optionId } };
        } catch (e) {
          console.error(`[${engine.config.engineType}] requestPermission error`, e);
          return { outcome: { outcome: 'selected', optionId: 'always' } };
        }
      },

      async sessionUpdate(params: SessionNotification): Promise<void> {
        try {
          engine.handleSessionUpdate(params.update);
        } catch (e) {
          console.error(`[${engine.config.engineType}] sessionUpdate error`, e);
        }
      },

      // Cursor extensions
      async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        try {
          switch (method) {
            case 'cursor/ask_question':
            case 'cursor/create_plan':
            case 'cursor/update_todos':
              engine.emit('cursor-ext', { method, params });
              return {};
            case 'cursor/task':
              engine.emit('subtask', params);
              return {};
            case 'cursor/generate_image':
              return {};
            default:
              console.log(`[${engine.config.engineType}] unhandled extMethod: ${method}`);
              return {};
          }
        } catch (e) {
          console.error(`[${engine.config.engineType}] extMethod error`, method, e);
          return {};
        }
      },

      // Kiro extensions
      async extNotification(method: string, params: Record<string, unknown>): Promise<void> {
        try {
          if (method.startsWith('_kiro.dev/')) {
            engine.emit('kiro-ext', { method, params });
          }
        } catch (e) {
          console.error(`[${engine.config.engineType}] extNotification error`, method, e);
        }
      },
    }), stream);

    console.log(`[${this.config.engineType}] initializing ACP client...`);
    await this.initialize();
    console.log(`[${this.config.engineType}] ACP client initialized`);
  }

  /**
   * Build command arguments based on engine type
   */
  private buildCommandArgs(): string[] {
    const args: string[] = [];
    switch (this.config.engineType) {
      case 'opencode':
        args.push('acp', '--cwd', this.config.workingDirectory);
        break;
      case 'codegenie':
        // OpenCode-kernel CLI: same ACP argv as opencode
        args.push('acp', '--cwd', this.config.workingDirectory);
        break;
      case 'nga':
        // ngagent 套壳 OpenCode：默认关闭更新检查，cwd 与 opencode 一致
        args.push('--disable-update', 'acp', '--cwd', this.config.workingDirectory);
        break;
      case 'kiro-cli':
        args.push('acp');
        if (this.config.agentName) args.push('--agent', this.config.agentName);
        if (this.config.model) args.push('--model', this.config.model);
        break;
      case 'cursor':
        args.push('acp');
        break;
      case 'trae-cli':
        args.push('acp', 'serve');
        break;
      default:
        throw new Error(`Unknown engine type: ${this.config.engineType}`);
    }
    if (this.config.args) args.push(...this.config.args);
    return args;
  }
  /**
   * Initialize ACP connection
   */
  private async initialize(): Promise<void> {
    if (!this.connection) throw new Error('No connection');
    console.log(`[${this.config.engineType}] connection.initialize() start`);
    const initPromise = this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'aceharness', version: '1.0.0' },
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
        terminal: true,
      },
    });

    const initTimeoutMs = 30_000;
    const result = await Promise.race([
      initPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `ACP connection.initialize timeout after ${initTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'}`
              )
            ),
          initTimeoutMs
        )
      ),
    ]);
    this.initialized = true;
    console.log(`[${this.config.engineType}] connection.initialize() done`);

    // Cursor ACP requires authenticate after initialize
    if (this.config.engineType === 'cursor') {
      try {
        await this.connection.authenticate({ methodId: 'cursor_login' });
      } catch (e) {
        console.log(`[${this.config.engineType}] authenticate: ${e instanceof Error ? e.message : e}`);
      }
    }

    this.emit('initialized', result);
  }

  /**
   * Create a new session
   */
  async createSession(): Promise<string> {
    if (!this.initialized || !this.connection) throw new Error(`${this.config.engineType} not initialized`);
    console.log(`[${this.config.engineType}] createSession() start`);
    const newSessionPromise = this.connection.newSession({
      cwd: this.config.workingDirectory,
      mcpServers: [],
    });

    const sessionTimeoutMs = 30_000;
    const result = await Promise.race([
      newSessionPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `ACP newSession timeout after ${sessionTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'}`
              )
            ),
          sessionTimeoutMs
        )
      ),
    ]);
    this.sessionId = result.sessionId;
    this.availableModels = (result.models?.availableModels as any[]) || [];
    console.log(`[${this.config.engineType}] session created: ${this.sessionId}`);
    console.log(
      `[${this.config.engineType}] available models (${this.availableModels.length}):`,
      JSON.stringify(this.availableModels.map(m => ({ id: m.modelId, name: m.name })), null, 2),
    );
    this.emit('session-created', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });
    return this.sessionId!;
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<string> {
    if (!this.initialized || !this.connection) throw new Error(`${this.config.engineType} not initialized`);
    const result = await this.connection.loadSession({ sessionId, cwd: this.config.workingDirectory, mcpServers: [] });
    this.sessionId = sessionId;
    this.availableModels = (result.models?.availableModels as any[]) || this.availableModels;
    this.emit('session-resumed', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });
    return this.sessionId;
  }
  /**
   * Send a prompt to the current session
   */
  async sendPrompt(prompt: string): Promise<ACPStopReason> {
    if (!this.sessionId || !this.connection) throw new Error('No active session');

    console.log(`[${this.config.engineType}] sendPrompt: sessionId=${this.sessionId}, promptLength=${prompt.length}`);

    try {
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
      console.log(`[${this.config.engineType}] sendPrompt completed: stopReason=${result.stopReason}`);
      return result.stopReason;
    } catch (err) {
      console.error(`[${this.config.engineType}] sendPrompt error:`, err);
      throw err;
    }
  }

  /**
   * Set the model for the current session
   */
  async setModel(modelId: string): Promise<void> {
    if (!this.sessionId || !this.connection) throw new Error('No active session');
    const resolved = this.resolveModelId(modelId);
    if (!resolved) {
      const modelList = this.availableModels.map(m => `  ${m.modelId} (${m.name})`).join('\n');
      const err = new Error(
        `Model "${modelId}" not found. Available models:\n${modelList}`
      );
      (err as any).status = 404;
      throw err;
    }
    console.log(`[${this.config.engineType}] setModel: "${modelId}" -> resolved: "${resolved}"`);
    try {
      await this.connection.unstable_setSessionModel({ sessionId: this.sessionId, modelId: resolved });
    } catch (err) {
      const modelList = this.availableModels.map(m => `  ${m.modelId} (${m.name})`).join('\n');
      const wrapped = new Error(
        `setModel("${modelId}") failed: ${err instanceof Error ? err.message : err}\nAvailable models:\n${modelList}`
      );
      (wrapped as any).status = 404;
      throw wrapped;
    }
  }

  /**
   * Get available models (for UI display)
   */
  getAvailableModels(): Array<{ modelId: string; name: string }> {
    return this.availableModels;
  }

  /**
   * Resolve model ID from short name
   */
  private resolveModelId(shortName: string): string {
    if (!shortName) return '';
    // Exact match by modelId
    const exactById = this.availableModels.find(m => m.modelId === shortName);
    if (exactById) return exactById.modelId;
    // Provider-qualified ID (e.g. "anthropic/claude-sonnet-4-6")
    if (shortName.includes('/')) {
      const exists = this.availableModels.find(m => m.modelId === shortName);
      return exists ? exists.modelId : '';
    }
    // Exact suffix match (e.g. "claude-sonnet-4-5" matches "penguiapi/claude-sonnet-4-5")
    const suffixMatch = this.availableModels.find(m => m.modelId.endsWith('/' + shortName));
    if (suffixMatch) return suffixMatch.modelId;
    // Normalize separators: dots ↔ dashes (e.g. "claude-sonnet-4.5" → "claude-sonnet-4-5")
    const normalize = (s: string) => s.toLowerCase().replace(/[.\-_]/g, '-');
    const normalized = normalize(shortName);
    const normSuffix = this.availableModels.find(m => {
      const tail = m.modelId.split('/').pop() || '';
      return normalize(tail) === normalized;
    });
    if (normSuffix) return normSuffix.modelId;
    // Fuzzy: match name or modelId containing the normalized input
    const fuzzy = this.availableModels
      .filter(m => normalize(m.name).includes(normalized) || normalize(m.modelId).includes(normalized))
      .sort((a, b) => a.modelId.length - b.modelId.length);
    if (fuzzy.length > 0) return fuzzy[0].modelId;
    // No match found
    return '';
  }

  /**
   * Cancel the current session
   */
  cancelSession(): void {
    if (!this.sessionId || !this.connection) return;
    this.connection.cancel({ sessionId: this.sessionId }).catch(() => {});
  }

  /**
   * Stop the engine
   */
  stop(): void {
    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }
  /**
   * Handle session update notifications from the SDK
   */
  private handleSessionUpdate(update: SessionUpdate): void {
    console.log(`[${this.config.engineType}] sessionUpdate: ${update.sessionUpdate}`);
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.emit('user-message', (update as any).content);
        break;
      case 'agent_message_chunk':
        this.emit('agent-message', (update as any).content);
        break;
      case 'agent_thought_chunk':
        this.emit('agent-thought', (update as any).content);
        break;
      case 'tool_call':
        this.emit('tool-call', {
          id: (update as any).toolCallId,
          title: (update as any).title,
          status: (update as any).status,
          kind: (update as any).kind,
          content: (update as any).content,
          locations: (update as any).locations,
          rawInput: (update as any).rawInput,
        });
        break;
      case 'tool_call_update':
        this.emit('tool-call-update', {
          id: (update as any).toolCallId,
          title: (update as any).title,
          status: (update as any).status,
          kind: (update as any).kind,
          content: (update as any).content,
          rawInput: (update as any).rawInput,
          rawOutput: (update as any).rawOutput,
        });
        break;
      case 'plan':
        this.emit('plan', (update as any).entries);
        break;
      case 'current_mode_update':
        this.emit('mode-changed', (update as any).currentModeId);
        break;
      case 'config_option_update':
        this.emit('config-changed', (update as any).configOptions);
        break;
      default:
        this.emit('update', update);
    }
  }

  /**
   * Clean up resources
   */
  private cleanup(reason?: string): void {
    this.process = null;
    this.connection = null;
    this.sessionId = null;
    this.initialized = false;
  }
}
