/**
 * Unified ACP Engine — powered by @agentclientprotocol/sdk
 *
 * Replaces hand-rolled JSON-RPC with ClientSideConnection + ndJsonStream.
 * Used by all ACP-compatible engines: Kiro CLI, OpenCode, Cursor.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { delimiter as pathDelimiter, join } from 'path';
import { Writable, Readable } from 'node:stream';
import { EventEmitter } from 'events';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { isWindows } from '@/lib/core/runtime-platform';
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
  Usage,
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
  /** NGA-compatible commands such as codeagent use OpenCode-style args without --disable-update */
  skipNgaDisableUpdate?: boolean;
  /** Field name for prompt content in session/prompt (default: 'prompt', kiro uses 'content') */
  promptField?: string;
  /** Environment variables */
  env?: Record<string, string>;
}

// Re-export StopReason so wrappers can use it
export type ACPStopReason = StopReason;

const ACP_STREAM_DEBUG = true; // Always log ACP stream events for diagnostics

/** `ACE_TIMING_DEBUG` / `ACE_ACP_TIMING_DEBUG`：1|true|on|yes 开；0|false|off|no 关；未设置时开发环境默认开。 */
function parseTimingDebugEnv(value: string | undefined): boolean | null {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return null;
}

/**
 * 是否打印 ACP / chat/stream 各阶段 `[ACE_TIMING]` 日志。
 * - 未设置环境变量且为本地开发（`NODE_ENV` 非 `production` / `test`）时默认开启，便于 `npm run dev` 分析。
 * - 生产或测试跑法默认关闭；需要时在部署环境设 `ACE_TIMING_DEBUG=1`。
 * - 任一变量的显式 `0` / `false` / `off` / `no` 会关闭（优先于默认开）。
 */
export function isAceTimingDebug(): boolean {
  const a = parseTimingDebugEnv(process.env.ACE_TIMING_DEBUG);
  const b = parseTimingDebugEnv(process.env.ACE_ACP_TIMING_DEBUG);
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv !== 'production' && nodeEnv !== 'test';
}

export function logAcpTiming(engineType: string, phase: string, startedAt: number, extra?: string): void {
  if (!isAceTimingDebug()) return;
  const ms = Date.now() - startedAt;
  const tail = extra ? ` | ${extra}` : '';
  console.log(`[ACE_TIMING][${engineType}] ${phase}: ${ms}ms${tail}`);
}

const DEFAULT_ACP_PHASE_MS = 30_000;
/** Default for `newSession` only (NGA memory sync can exceed 30s). */
const DEFAULT_ACP_NEW_SESSION_MS = 60_000;
const MIN_ACP_PHASE_MS = 1_000;
const MAX_ACP_PHASE_MS = 900_000;

function parseAcpPhaseTimeoutMs(raw: string | undefined, fallback: number): number {
  if (raw == null || String(raw).trim() === '') return fallback;
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ACP_PHASE_MS, Math.max(MIN_ACP_PHASE_MS, n));
}

/** Timeout for `connection.initialize` (ms). Env: `ACE_ACP_INIT_TIMEOUT_MS`, default 30000. */
export function getAcpInitTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.ACE_ACP_INIT_TIMEOUT_MS, DEFAULT_ACP_PHASE_MS);
}

/** Timeout for `connection.newSession` (ms). Env: `ACE_ACP_NEW_SESSION_TIMEOUT_MS`, default 60000. */
export function getAcpNewSessionTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.ACE_ACP_NEW_SESSION_TIMEOUT_MS, DEFAULT_ACP_NEW_SESSION_MS);
}

/** Timeout for `session/load` when resuming (ms). Env: `ACE_ACP_LOAD_SESSION_TIMEOUT_MS`, default 30000. */
export function getAcpLoadSessionTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.ACE_ACP_LOAD_SESSION_TIMEOUT_MS, DEFAULT_ACP_PHASE_MS);
}

/**
 * Outer timeout for GET /api/engine/models (full start + session + model list).
 * Env: `ACE_ACP_MODEL_DISCOVERY_TIMEOUT_MS`; if unset, uses init + newSession + 15s headroom.
 */
export function getAcpModelDiscoveryTimeoutMs(): number {
  const raw = process.env.ACE_ACP_MODEL_DISCOVERY_TIMEOUT_MS;
  if (raw != null && String(raw).trim() !== '') {
    return parseAcpPhaseTimeoutMs(raw, getAcpInitTimeoutMs() + getAcpNewSessionTimeoutMs() + 15_000);
  }
  return getAcpInitTimeoutMs() + getAcpNewSessionTimeoutMs() + 15_000;
}

export interface ACPSendPromptResult {
  stopReason: ACPStopReason;
  usage?: Usage | null;
}

/** Quote one argv token for cmd.exe when paths contain spaces or quotes. */
function escapeWinCmdToken(s: string): string {
  if (s === '') return '""';
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function getWindowsSystemPaths(): string[] {
  if (!isWindows()) return [];
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  const paths = roots.flatMap((root) => [
    join(root, 'System32'),
    join(root, 'Sysnative'),
    root,
  ]);
  return Array.from(new Set(paths));
}

function resolveWindowsCmdShell(): string {
  const candidates = [
    process.env.ComSpec?.trim(),
    ...getWindowsSystemPaths().map((dir) => join(dir, 'cmd.exe')),
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
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
  if (!isWindows()) {
    return spawn(command, argv, {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  const line = [command, ...argv].map(escapeWinCmdToken).join(' ');
  console.log(`[${engineType}] win32 shell spawn (cmd): ${line}`);
  return spawn(line, {
    shell: resolveWindowsCmdShell(),
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
  private lastExitInfo = '';

  constructor(private config: ACPEngineConfig) {
    super();
  }

  /**
   * Start the ACP engine process
   */
  async start(): Promise<void> {
    const tStartTotal = Date.now();
    const args = this.buildCommandArgs();
    const commonCliPaths = getCommonCliSearchPaths();
    const resolvedCommand = findCommand(this.config.command, commonCliPaths) ?? this.config.command;
    const envPath = [
      process.env.PATH || '',
      ...getWindowsSystemPaths(),
      ...commonCliPaths,
      this.config.env?.PATH || this.config.env?.Path || '',
    ].filter(Boolean).join(pathDelimiter);

    const childEnv = {
      ...process.env,
      ...this.config.env,
      PATH: envPath,
      Path: envPath,
    };

    console.log(`[${this.config.engineType}] spawning: ${resolvedCommand} ${args.join(' ')}`);

    const tSpawn = Date.now();
    this.process = spawnAcpCli(this.config.engineType, resolvedCommand, args, {
      cwd: this.config.workingDirectory,
      env: childEnv,
    });
    logAcpTiming(this.config.engineType, 'acp.1_spawn_call_wall', tSpawn);

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
      this.lastExitInfo = `code=${code}, signal=${signal}`;
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
    const tStreams = Date.now();
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
    logAcpTiming(this.config.engineType, 'acp.2_ndjson_stream_ready', tStreams);

    console.log(`[${this.config.engineType}] initializing ACP client...`);
    const tInit = Date.now();
    await this.initialize();
    logAcpTiming(this.config.engineType, 'acp.3_initialize_including_rpc', tInit);
    logAcpTiming(this.config.engineType, 'acp.0_start_process_to_initialized', tStartTotal);
    console.log(`[${this.config.engineType}] ACP client initialized`);
  }

  /**
   * Build command arguments based on engine type
   */
  private buildCommandArgs(): string[] {
    const args: string[] = [];
    switch (this.config.engineType) {
      case 'claude-code-acp':
        // claude-agent-acp starts ACP stdio mode with no positional subcommand.
        break;
      case 'opencode':
        args.push('acp', '--cwd', this.config.workingDirectory);
        break;
      case 'codegenie':
        // OpenCode-kernel CLI: same ACP argv as opencode
        args.push('acp', '--cwd', this.config.workingDirectory);
        break;
      case 'nga':
        if (this.config.skipNgaDisableUpdate) {
          // Some NGA-compatible binaries (for example codeagent) support OpenCode-style ACP args only.
          args.push('acp', '--cwd', this.config.workingDirectory);
        } else {
          // ngagent 套壳 OpenCode：默认关闭更新检查，cwd 与 opencode 一致
          args.push('--disable-update', 'acp', '--cwd', this.config.workingDirectory);
        }
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
      case 'magic-cli':
        args.push('acp');
        if (this.config.model) args.push('--model', this.config.model);
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

    const initTimeoutMs = getAcpInitTimeoutMs();
    let result;
    const tInitRpc = Date.now();
    try {
      result = await Promise.race([
        initPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `ACP connection.initialize timeout after ${initTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set ACE_ACP_INIT_TIMEOUT_MS to increase)`
                )
              ),
            initTimeoutMs
          )
        ),
      ]);
    } catch (error) {
      throw this.withAcpDiagnostics('connection.initialize', error);
    }
    logAcpTiming(this.config.engineType, 'acp.3a_connection.initialize_rpc', tInitRpc);
    this.initialized = true;
    console.log(`[${this.config.engineType}] connection.initialize() done`);

    // Cursor ACP requires authenticate after initialize
    if (this.config.engineType === 'cursor') {
      const tAuth = Date.now();
      try {
        await this.connection.authenticate({ methodId: 'cursor_login' });
      } catch (e) {
        console.log(`[${this.config.engineType}] authenticate: ${e instanceof Error ? e.message : e}`);
      }
      logAcpTiming(this.config.engineType, 'acp.3b_cursor_authenticate', tAuth);
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

    const sessionTimeoutMs = getAcpNewSessionTimeoutMs();
    let result;
    const tNewSess = Date.now();
    try {
      result = await Promise.race([
        newSessionPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `ACP newSession timeout after ${sessionTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set ACE_ACP_NEW_SESSION_TIMEOUT_MS to increase)`
                )
              ),
            sessionTimeoutMs
          )
        ),
      ]);
    } catch (error) {
      throw this.withAcpDiagnostics('newSession', error);
    }
    logAcpTiming(this.config.engineType, 'acp.4_newSession_rpc', tNewSess);
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
    const loadPromise = this.connection.loadSession({
      sessionId,
      cwd: this.config.workingDirectory,
      mcpServers: [],
    });
    const loadTimeoutMs = getAcpLoadSessionTimeoutMs();
    let result;
    const tLoad = Date.now();
    try {
      result = await Promise.race([
        loadPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `ACP session/load timeout after ${loadTimeoutMs}ms. sessionId=${sessionId}. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set ACE_ACP_LOAD_SESSION_TIMEOUT_MS to increase)`
                )
              ),
            loadTimeoutMs
          )
        ),
      ]);
    } catch (error) {
      throw this.withAcpDiagnostics('session/load', error);
    }
    logAcpTiming(this.config.engineType, 'acp.4_session_load_rpc', tLoad, `sessionId=${sessionId}`);
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
  async sendPrompt(prompt: string): Promise<ACPSendPromptResult> {
    if (!this.sessionId || !this.connection) throw new Error('No active session');

    console.log(`[${this.config.engineType}] sendPrompt: sessionId=${this.sessionId}, promptLength=${prompt.length}`);

    try {
      const tPrompt = Date.now();
      const result = await this.connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: prompt }],
      });
      logAcpTiming(
        this.config.engineType,
        'acp.6_prompt_rpc_agent_wall',
        tPrompt,
        `stopReason=${result.stopReason ?? 'n/a'} len=${prompt.length}`
      );
      console.log(`[${this.config.engineType}] sendPrompt completed: stopReason=${result.stopReason}`);
      return {
        stopReason: result.stopReason,
        usage: result.usage,
      };
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
    const tSet = Date.now();
    try {
      await this.connection.unstable_setSessionModel({ sessionId: this.sessionId, modelId: resolved });
      logAcpTiming(this.config.engineType, 'acp.5_setSessionModel_rpc', tSet, resolved);
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

  private withAcpDiagnostics(phase: string, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const stderrTail = this.lastStderrChunk?.slice(-1000) || '<empty>';
    const exitInfo = this.lastExitInfo || '<not-exited>';
    return new Error(
      `${message}. phase=${phase}; engineType=${this.config.engineType}; command=${this.config.command}; cwd=${this.config.workingDirectory}; childExit=${exitInfo}; stderrTail=${stderrTail}`
    );
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
    if (ACP_STREAM_DEBUG) {
      console.log(`[${this.config.engineType}] sessionUpdate: ${update.sessionUpdate}`);
    }
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
