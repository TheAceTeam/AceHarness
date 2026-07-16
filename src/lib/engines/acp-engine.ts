/**
 * Unified ACP Engine — powered by @agentclientprotocol/sdk
 *
 * Replaces hand-rolled JSON-RPC with ClientSideConnection + ndJsonStream.
 * Used by all ACP-compatible engines: Kiro CLI, OpenCode, Cursor.
 */

import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { delimiter as pathDelimiter, join } from 'path';
import { homedir } from 'os';
import { Writable, Readable } from 'node:stream';
import { EventEmitter } from 'events';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { buildConfiguredProcessEnvSync } from '@/lib/core/configured-env';
import { toAcpMcpServers, type ManagedMcpServer } from '@/lib/mcp/registry';
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
  /** Authenticated user id for user-scoped credentials/env vars. */
  userId?: string;
  /** MCP server configs for the current session */
  mcpServers?: ManagedMcpServer[];
  /** Enable detailed lifecycle logs for diagnostics. */
  diagnosticLogging?: boolean;
}

// Re-export StopReason so wrappers can use it
export type ACPStopReason = StopReason;

/** `CSIHARNESS_TIMING_DEBUG` / `CSIHARNESS_ACP_TIMING_DEBUG`：1|true|on|yes 开；0|false|off|no 关；未设置时开发环境默认开。 */
function parseTimingDebugEnv(value: string | undefined): boolean | null {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (['0', 'false', 'off', 'no'].includes(v)) return false;
  if (['1', 'true', 'on', 'yes'].includes(v)) return true;
  return null;
}

/**
 * 是否打印 ACP / chat/stream 各阶段 `[CSIHARNESS_TIMING]` 日志。
 * - 未设置环境变量且为本地开发（`NODE_ENV` 非 `production` / `test`）时默认开启，便于 `npm run dev` 分析。
 * - 生产或测试跑法默认关闭；需要时在部署环境设 `CSIHARNESS_TIMING_DEBUG=1`。
 * - 任一变量的显式 `0` / `false` / `off` / `no` 会关闭（优先于默认开）。
 */
export function isAceTimingDebug(): boolean {
  const a = parseTimingDebugEnv(process.env.CSIHARNESS_TIMING_DEBUG);
  const b = parseTimingDebugEnv(process.env.CSIHARNESS_ACP_TIMING_DEBUG);
  if (a === false || b === false) return false;
  if (a === true || b === true) return true;
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv !== 'production' && nodeEnv !== 'test';
}

export function logAcpTiming(engineType: string, phase: string, startedAt: number, extra?: string): void {
  if (!isAceTimingDebug()) return;
  const ms = Date.now() - startedAt;
  const tail = extra ? ` | ${extra}` : '';
  console.log(`[CSIHARNESS_TIMING][${engineType}] ${phase}: ${ms}ms${tail}`);
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

/** Timeout for `connection.initialize` (ms). Env: `CSIHARNESS_ACP_INIT_TIMEOUT_MS`, default 30000. */
export function getAcpInitTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.CSIHARNESS_ACP_INIT_TIMEOUT_MS, DEFAULT_ACP_PHASE_MS);
}

/** Timeout for `connection.newSession` (ms). Env: `CSIHARNESS_ACP_NEW_SESSION_TIMEOUT_MS`, default 60000. */
export function getAcpNewSessionTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.CSIHARNESS_ACP_NEW_SESSION_TIMEOUT_MS, DEFAULT_ACP_NEW_SESSION_MS);
}

/** Timeout for `session/load` when resuming (ms). Env: `CSIHARNESS_ACP_LOAD_SESSION_TIMEOUT_MS`, default 30000. */
export function getAcpLoadSessionTimeoutMs(): number {
  return parseAcpPhaseTimeoutMs(process.env.CSIHARNESS_ACP_LOAD_SESSION_TIMEOUT_MS, DEFAULT_ACP_PHASE_MS);
}

/**
 * Outer timeout for GET /api/engine/models (full start + session + model list).
 * Env: `CSIHARNESS_ACP_MODEL_DISCOVERY_TIMEOUT_MS`; if unset, uses init + newSession + 15s headroom.
 */
export function getAcpModelDiscoveryTimeoutMs(): number {
  const raw = process.env.CSIHARNESS_ACP_MODEL_DISCOVERY_TIMEOUT_MS;
  if (raw != null && String(raw).trim() !== '') {
    return parseAcpPhaseTimeoutMs(raw, getAcpInitTimeoutMs() + getAcpNewSessionTimeoutMs() + 15_000);
  }
  return getAcpInitTimeoutMs() + getAcpNewSessionTimeoutMs() + 15_000;
}

export interface ACPSendPromptResult {
  stopReason: ACPStopReason;
  usage?: Usage | null;
}

export interface ACPModelInfo {
  modelId: string;
  name: string;
}

export interface ACPCommandInfo {
  name: string;
  description: string;
  source?: string;
  type?: string;
  kind?: string;
  category?: string;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function addAcpModel(
  models: ACPModelInfo[],
  seen: Set<string>,
  modelId: unknown,
  name?: unknown,
): void {
  const id = stringValue(modelId);
  if (!id || seen.has(id)) return;
  seen.add(id);
  models.push({ modelId: id, name: stringValue(name) || id });
}

function arrayFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [];
}

function looksLikeModelConfigOption(option: Record<string, unknown>): boolean {
  const id = stringValue(option.id).toLowerCase();
  if (id === 'model' || id === 'models' || id.endsWith('.model')) return true;
  const label = [
    option.name,
    option.title,
    option.label,
    option.description,
  ].map((value) => stringValue(value).toLowerCase()).filter(Boolean).join(' ');
  return /\bmodels?\b/.test(label);
}

function extractModelsFromConfigOption(option: Record<string, unknown>, models: ACPModelInfo[], seen: Set<string>): void {
  const choices = [
    ...arrayFromUnknown(option.options),
    ...arrayFromUnknown(option.choices),
    ...arrayFromUnknown(option.items),
    ...arrayFromUnknown(option.values),
  ];

  for (const choice of choices) {
    if (typeof choice === 'string') {
      addAcpModel(models, seen, choice);
      continue;
    }
    if (!choice || typeof choice !== 'object') continue;
    const item = choice as Record<string, unknown>;
    addAcpModel(
      models,
      seen,
      item.value ?? item.modelId ?? item.id ?? item.key,
      item.name ?? item.label ?? item.title ?? item.description,
    );
  }
}

/**
 * Normalize ACP model discovery across protocol/engine versions.
 * Older engines expose `models.availableModels`; newer OpenCode exposes the
 * model selector as a `configOptions` select option with `id: "model"`.
 */
export function normalizeAcpModelsFromSessionResult(result: unknown): ACPModelInfo[] {
  const models: ACPModelInfo[] = [];
  const seen = new Set<string>();
  if (!result || typeof result !== 'object') return models;

  const record = result as Record<string, unknown>;
  const modelRecord = record.models && typeof record.models === 'object'
    ? record.models as Record<string, unknown>
    : null;

  for (const item of arrayFromUnknown(modelRecord?.availableModels)) {
    if (typeof item === 'string') {
      addAcpModel(models, seen, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    addAcpModel(
      models,
      seen,
      model.modelId ?? model.value ?? model.id,
      model.name ?? model.label ?? model.title,
    );
  }

  for (const option of arrayFromUnknown(record.configOptions)) {
    if (!option || typeof option !== 'object') continue;
    const optionRecord = option as Record<string, unknown>;
    if (!looksLikeModelConfigOption(optionRecord)) continue;
    extractModelsFromConfigOption(optionRecord, models, seen);
  }

  return models;
}

interface ACPHistoryReplayCollector {
  sessionId: string;
  messageOrder: Array<{ key: string; role: 'user' | 'assistant' }>;
  messageChunks: Map<string, string[]>;
  anonymousMessageCount: number;
  started: boolean;
}

function safeParseJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractOpenCodeStoredText(partData: Record<string, unknown> | null): string {
  if (!partData) return '';
  if (typeof partData.text === 'string') return partData.text;
  if (typeof partData.content === 'string') return partData.content;
  const content = partData.content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return typeof record.text === 'string' ? record.text : '';
        }
        return '';
      })
      .filter(Boolean)
      .join('');
  }
  return '';
}

function extractOpenCodeStoredError(messageData: Record<string, unknown> | null): string {
  const error = messageData?.error;
  if (!error || typeof error !== 'object') return '';
  const errorRecord = error as Record<string, unknown>;
  const data = errorRecord.data && typeof errorRecord.data === 'object'
    ? errorRecord.data as Record<string, unknown>
    : null;
  const message = typeof data?.message === 'string'
    ? data.message
    : typeof errorRecord.message === 'string'
      ? errorRecord.message
      : '';
  const statusCode = data?.statusCode || data?.status;
  return message
    ? `模型调用失败${statusCode ? ` (${statusCode})` : ''}: ${message}`
    : '';
}

function recoverOpenCodeAssistantMessageFromStorage(sessionId: string): string {
  const dbPath = join(homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!existsSync(dbPath)) return '';
  let db: any = null;
  try {
    const requireFn = eval('require') as NodeRequire;
    const Database = requireFn('better-sqlite3');
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const assistantMessages = db.prepare(
      'select id, data from message where session_id = ? order by time_created asc'
    ).all(sessionId)
      .map((row: any) => ({ id: String(row.id || ''), data: safeParseJsonRecord(row.data) }))
      .filter((row: { id: string; data: Record<string, unknown> | null }) => row.data?.role === 'assistant');
    const latestAssistant = assistantMessages[assistantMessages.length - 1];
    if (!latestAssistant) return '';

    const parts = db.prepare(
      'select data from part where session_id = ? and message_id = ? order by time_created asc'
    ).all(sessionId, latestAssistant.id);
    const text = parts
      .map((row: any) => extractOpenCodeStoredText(safeParseJsonRecord(row.data)))
      .filter(Boolean)
      .join('');
    if (text) return text;
    return extractOpenCodeStoredError(latestAssistant.data);
  } catch {
    return '';
  } finally {
    try {
      db?.close?.();
    } catch {
      // ignore close failures
    }
  }
}

export function buildAcpCommandArgs(config: ACPEngineConfig): string[] {
  const args: string[] = [];
  switch (config.engineType) {
    case 'claude-code-acp':
      break;
    case 'opencode':
      args.push('acp', '--cwd', config.workingDirectory);
      break;
    case 'codegenie':
      args.push('acp', '--cwd', config.workingDirectory);
      break;
    case 'nga':
      if (config.skipNgaDisableUpdate) {
        args.push('acp', '--cwd', config.workingDirectory);
      } else {
        args.push('--disable-update', 'acp', '--cwd', config.workingDirectory);
      }
      break;
    case 'kiro-cli':
      args.push('acp');
      if (config.agentName) args.push('--agent', config.agentName);
      if (config.model) args.push('--model', config.model);
      break;
    case 'cursor':
      args.push('acp');
      break;
    case 'trae-cli':
      args.push('acp', 'serve');
      break;
    case 'magic-cli':
      args.push('acp');
      if (config.model) args.push('--model', config.model);
      break;
    default:
      throw new Error(`Unknown engine type: ${config.engineType}`);
  }
  if (config.args) args.push(...config.args);
  return args;
}

export function buildAcpProcessReuseKey(config: ACPEngineConfig): string {
  return JSON.stringify({
    engineType: config.engineType,
    command: config.command,
    workingDirectory: config.workingDirectory,
    args: buildAcpCommandArgs(config),
    env: config.env || {},
    userId: config.userId || '',
    diagnosticLogging: Boolean(config.diagnosticLogging),
  });
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

function closeAcpChildTree(child: ChildProcess): void {
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
    setTimeout(() => {
      try {
        if (!child.killed && child.exitCode === null) {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore shutdown failures
      }
    }, 3000);
  } catch {
    // ignore shutdown failures
  }
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
  private availableCommands: ACPCommandInfo[] = [];
  private mcpServers: ManagedMcpServer[] = [];
  private lastStderrChunk = '';
  private lastExitInfo = '';
  private historyReplayCollector: ACPHistoryReplayCollector | null = null;

  constructor(private config: ACPEngineConfig) {
    super();
    this.mcpServers = config.mcpServers || [];
  }

  setMcpServers(servers: ManagedMcpServer[] | undefined): void {
    this.mcpServers = servers || [];
  }

  getAvailableCommands(): ACPCommandInfo[] {
    return [...this.availableCommands];
  }

  async waitForAvailableCommands(timeoutMs = 1500): Promise<ACPCommandInfo[]> {
    if (this.availableCommands.length > 0) return this.getAvailableCommands();
    return await new Promise<ACPCommandInfo[]>((resolve) => {
      const timer = setTimeout(() => {
        this.off('available-commands', onCommands);
        resolve(this.getAvailableCommands());
      }, Math.max(0, timeoutMs));
      const onCommands = (commands: ACPCommandInfo[]) => {
        clearTimeout(timer);
        this.off('available-commands', onCommands);
        resolve(commands);
      };
      this.on('available-commands', onCommands);
    });
  }

  private isDiagnosticLoggingEnabled(): boolean {
    return Boolean(this.config.diagnosticLogging);
  }

  private shouldDebugStreamEvents(): boolean {
    const env = parseTimingDebugEnv(process.env.CSIHARNESS_ACP_STREAM_DEBUG);
    if (env !== null) return env;
    return this.isDiagnosticLoggingEnabled();
  }

  private emitDiagnosticLog(input: {
    level?: 'info' | 'warning' | 'error';
    message: string;
    detail?: string;
    metadata?: unknown;
    verbose?: boolean;
  }): void {
    if (!this.isDiagnosticLoggingEnabled()) return;
    this.emit('log', input);
  }

  /**
   * Start the ACP engine process
   */
  async start(): Promise<void> {
    const tStartTotal = Date.now();
    const args = this.buildCommandArgs();
    const commonCliPaths = getCommonCliSearchPaths();
    const resolvedCommand = findCommand(this.config.command, commonCliPaths) ?? this.config.command;
    const baseEnv = buildConfiguredProcessEnvSync(
      this.config.env,
      process.env,
      this.config.userId ? { userId: this.config.userId } : undefined,
    );
    const envPath = [
      baseEnv.PATH || baseEnv.Path || '',
      ...getWindowsSystemPaths(),
      ...commonCliPaths,
    ].filter(Boolean).join(pathDelimiter);

    const childEnv = {
      ...baseEnv,
      PATH: envPath,
      Path: envPath,
    };

    console.log(`[${this.config.engineType}] spawning: ${resolvedCommand} ${args.join(' ')}`);
    this.emitDiagnosticLog({
      message: 'ACP spawn start',
      detail: `${resolvedCommand} ${args.join(' ')}`.trim(),
      metadata: {
        cwd: this.config.workingDirectory,
        command: resolvedCommand,
        args,
      },
      verbose: true,
    });

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
      this.emitDiagnosticLog({
        level: /error|failed|exception/i.test(msg) ? 'error' : 'warning',
        message: 'ACP stderr',
        detail: msg.trim(),
        metadata: { chunkLength: msg.length },
        verbose: true,
      });
    });

    this.process.on('exit', (code, signal) => {
      this.lastExitInfo = `code=${code}, signal=${signal}`;
      this.emitDiagnosticLog({
        level: code === 0 && !signal ? 'info' : 'error',
        message: 'ACP child exited',
        detail: this.lastExitInfo,
        metadata: {
          code,
          signal,
          stderrTail: this.lastStderrChunk?.slice(-1000) || '',
        },
        verbose: true,
      });
      if (code !== 0 || signal) {
        console.warn(
          `[${this.config.engineType}] child exited early code=${code} signal=${signal}; stderr tail: ${this.lastStderrChunk?.slice(0, 500) || '<empty>'}`
        );
      }
      this.emit('exit', { code, signal });
      this.cleanup(`${this.config.engineType} process exited (code=${code}, signal=${signal})`);
    });

    this.process.on('error', (error) => {
      this.emitDiagnosticLog({
        level: 'error',
        message: 'ACP child process error',
        detail: error.message,
        metadata: {
          name: error.name,
          stack: error.stack,
        },
      });
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
          engine.handleSessionUpdate(params);
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
    this.emitDiagnosticLog({
      message: 'ACP connection initializing',
      detail: `protocol=${PROTOCOL_VERSION}`,
      verbose: true,
    });
    const tInit = Date.now();
    await this.initialize();
    logAcpTiming(this.config.engineType, 'acp.3_initialize_including_rpc', tInit);
    logAcpTiming(this.config.engineType, 'acp.0_start_process_to_initialized', tStartTotal);
    console.log(`[${this.config.engineType}] ACP client initialized`);
    this.emitDiagnosticLog({
      message: 'ACP connection initialized',
      detail: `sessionReady=${Boolean(this.sessionId)}`,
      verbose: true,
    });
  }

  /**
   * Build command arguments based on engine type
   */
  private buildCommandArgs(): string[] {
    return buildAcpCommandArgs(this.config);
  }
  /**
   * Initialize ACP connection
   */
  private async initialize(): Promise<void> {
    if (!this.connection) throw new Error('No connection');
    console.log(`[${this.config.engineType}] connection.initialize() start`);
    this.emitDiagnosticLog({
      message: 'connection.initialize start',
      detail: `engineType=${this.config.engineType}`,
      verbose: true,
    });
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
                  `ACP connection.initialize timeout after ${initTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set CSIHARNESS_ACP_INIT_TIMEOUT_MS to increase)`
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
    this.emitDiagnosticLog({
      message: 'connection.initialize done',
      detail: `engineType=${this.config.engineType}`,
      verbose: true,
    });

    // Cursor ACP requires authenticate after initialize
    if (this.config.engineType === 'cursor') {
      const tAuth = Date.now();
      try {
        await this.connection.authenticate({ methodId: 'cursor_login' });
      } catch (e) {
        console.log(`[${this.config.engineType}] authenticate: ${e instanceof Error ? e.message : e}`);
        this.emitDiagnosticLog({
          level: 'warning',
          message: 'cursor authenticate warning',
          detail: e instanceof Error ? e.message : String(e),
          verbose: true,
        });
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
    this.emitDiagnosticLog({
      message: 'newSession start',
      detail: this.config.workingDirectory,
      verbose: true,
    });
    const newSessionPromise = this.connection.newSession({
      cwd: this.config.workingDirectory,
      mcpServers: toAcpMcpServers(this.mcpServers),
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
                  `ACP newSession timeout after ${sessionTimeoutMs}ms. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set CSIHARNESS_ACP_NEW_SESSION_TIMEOUT_MS to increase)`
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
    this.availableModels = normalizeAcpModelsFromSessionResult(result);
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
    this.emitDiagnosticLog({
      message: 'newSession done',
      detail: this.sessionId || '',
      metadata: {
        availableModelCount: this.availableModels.length,
      },
      verbose: true,
    });
    return this.sessionId!;
  }

  /**
   * Resume an existing session
   */
  async resumeSession(sessionId: string): Promise<string> {
    if (!this.initialized || !this.connection) throw new Error(`${this.config.engineType} not initialized`);
    this.emitDiagnosticLog({
      message: 'session/load start',
      detail: sessionId,
      verbose: true,
    });
    const loadPromise = this.connection.loadSession({
      sessionId,
      cwd: this.config.workingDirectory,
      mcpServers: toAcpMcpServers(this.mcpServers),
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
                  `ACP session/load timeout after ${loadTimeoutMs}ms. sessionId=${sessionId}. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'} (set CSIHARNESS_ACP_LOAD_SESSION_TIMEOUT_MS to increase)`
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
    const models = normalizeAcpModelsFromSessionResult(result);
    if (models.length > 0) this.availableModels = models;
    this.emit('session-resumed', {
      sessionId: this.sessionId,
      configOptions: result.configOptions,
      modes: result.modes,
      models: result.models,
    });
    this.emitDiagnosticLog({
      message: 'session/load done',
      detail: sessionId,
      metadata: {
        availableModelCount: this.availableModels.length,
      },
      verbose: true,
    });
    return this.sessionId;
  }
  /**
   * Send a prompt to the current session
   */
  async sendPrompt(prompt: string): Promise<ACPSendPromptResult> {
    if (!this.sessionId || !this.connection) throw new Error('No active session');

    console.log(`[${this.config.engineType}] sendPrompt: sessionId=${this.sessionId}, promptLength=${prompt.length}`);
    this.emitDiagnosticLog({
      message: 'session.prompt start',
      detail: `sessionId=${this.sessionId}, promptLength=${prompt.length}`,
      metadata: {
        sessionId: this.sessionId,
        promptLength: prompt.length,
      },
      verbose: true,
    });

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
      this.emitDiagnosticLog({
        message: 'session.prompt done',
        detail: `stopReason=${result.stopReason ?? 'n/a'}`,
        metadata: {
          sessionId: this.sessionId,
          stopReason: result.stopReason,
          usage: result.usage,
        },
        verbose: true,
      });
      return {
        stopReason: result.stopReason,
        usage: result.usage,
      };
    } catch (err) {
      console.error(`[${this.config.engineType}] sendPrompt error:`, err);
      this.emitDiagnosticLog({
        level: 'error',
        message: 'session.prompt failed',
        detail: err instanceof Error ? err.message : String(err),
        metadata: {
          sessionId: this.sessionId,
        },
      });
      throw err;
    }
  }

  async recoverLatestAssistantMessage(sessionId = this.sessionId): Promise<string> {
    if (!sessionId || !this.connection || !this.initialized) return '';

    const collector: ACPHistoryReplayCollector = {
      sessionId,
      messageOrder: [],
      messageChunks: new Map<string, string[]>(),
      anonymousMessageCount: 0,
      started: false,
    };
    this.historyReplayCollector = collector;
    this.emitDiagnosticLog({
      message: 'session/load replay start',
      detail: sessionId,
      verbose: true,
    });

    const loadPromise = this.connection.loadSession({
      sessionId,
      cwd: this.config.workingDirectory,
      mcpServers: toAcpMcpServers(this.mcpServers),
    });
    const loadTimeoutMs = getAcpLoadSessionTimeoutMs();
    const tReplay = Date.now();

    try {
      const result = await Promise.race([
        loadPromise,
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `ACP session/load replay timeout after ${loadTimeoutMs}ms. sessionId=${sessionId}. engineType=${this.config.engineType}, command=${this.config.command}. lastStderr=${this.lastStderrChunk || '<empty>'}`
                )
              ),
            loadTimeoutMs
          )
        ),
      ]);
      await this.flushHistoryReplayNotifications();
      logAcpTiming(this.config.engineType, 'acp.7_session_replay_load_rpc', tReplay, `sessionId=${sessionId}`);
      const models = normalizeAcpModelsFromSessionResult(result);
      if (models.length > 0) this.availableModels = models;
      const lastUserIndex = [...collector.messageOrder]
        .map((entry) => entry.role)
        .lastIndexOf('user');
      const assistantEntries = (lastUserIndex >= 0
        ? collector.messageOrder.slice(lastUserIndex + 1)
        : collector.messageOrder)
        .filter((entry) => entry.role === 'assistant');
      const latestAssistantEntry = assistantEntries[assistantEntries.length - 1];
      const latestAssistantMessage = latestAssistantEntry
        ? (collector.messageChunks.get(latestAssistantEntry.key) || []).join('')
        : '';
      const recoveredFromStorage = latestAssistantMessage
        ? ''
        : this.config.engineType === 'opencode'
          ? recoverOpenCodeAssistantMessageFromStorage(sessionId)
          : '';
      this.emitDiagnosticLog({
        message: 'session/load replay done',
        detail: `messageCount=${collector.messageOrder.length}, latestLength=${latestAssistantMessage.length || recoveredFromStorage.length}`,
        metadata: {
          sessionId,
          latestMessageId: latestAssistantEntry?.key || '',
          lastUserIndex,
          replayStarted: collector.started,
          recoveredFromStorage: Boolean(recoveredFromStorage),
        },
        verbose: true,
      });
      return latestAssistantMessage || recoveredFromStorage;
    } catch (error) {
      this.emitDiagnosticLog({
        level: 'warning',
        message: 'session/load replay failed',
        detail: error instanceof Error ? error.message : String(error),
        metadata: { sessionId },
      });
      return '';
    } finally {
      this.historyReplayCollector = null;
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
    this.emitDiagnosticLog({
      message: 'setSessionModel start',
      detail: `${modelId} -> ${resolved}`,
      verbose: true,
    });
    const tSet = Date.now();
    try {
      await this.connection.unstable_setSessionModel({ sessionId: this.sessionId, modelId: resolved });
      logAcpTiming(this.config.engineType, 'acp.5_setSessionModel_rpc', tSet, resolved);
      this.emitDiagnosticLog({
        message: 'setSessionModel done',
        detail: resolved,
        verbose: true,
      });
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
    const requested = String(shortName || '').trim();
    if (!requested) return '';
    const normalize = (s: string) => s.trim().toLowerCase().replace(/[.\-_]/g, '-');
    const normalized = normalize(requested);

    // Exact match by canonical modelId must win over every display-name or fuzzy path.
    const exactById = this.availableModels.find(m => m.modelId.trim() === requested);
    if (exactById) return exactById.modelId;

    // Some ACP servers expose the provider/model value as the display name while
    // using an internal modelId. Treat an exact display-name match as deliberate.
    const exactByName = this.availableModels.find(m => m.name.trim() === requested);
    if (exactByName) return exactByName.modelId;

    const normalizedById = this.availableModels.find(m => normalize(m.modelId) === normalized);
    if (normalizedById) return normalizedById.modelId;

    const normalizedByName = this.availableModels.find(m => normalize(m.name) === normalized);
    if (normalizedByName) return normalizedByName.modelId;

    // Provider-qualified input is already specific. If it did not match above,
    // do not fall through to suffix or fuzzy matching and risk selecting another provider.
    if (requested.includes('/')) {
      return '';
    }

    // Exact suffix match (e.g. "claude-sonnet-4-5" matches "penguiapi/claude-sonnet-4-5")
    const suffixMatch = this.availableModels
      .filter(m => (m.modelId.split('/').pop() || '') === requested)
      .sort((a, b) => a.modelId.length - b.modelId.length)[0];
    if (suffixMatch) return suffixMatch.modelId;

    const normSuffix = this.availableModels
      .filter(m => {
        const tail = m.modelId.split('/').pop() || '';
        return normalize(tail) === normalized;
      })
      .sort((a, b) => a.modelId.length - b.modelId.length)[0];
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
    const child = this.process;
    if (child) {
      closeAcpChildTree(child);
      this.cleanup(`${this.config.engineType} process stop requested`);
    }
  }
  /**
   * Handle session update notifications from the SDK
   */
  private handleSessionUpdate(notification: SessionNotification): void {
    const update = notification.update;
    if (this.captureHistoryReplayUpdate(notification)) {
      return;
    }
    if (this.shouldDebugStreamEvents()) {
      console.log(`[${this.config.engineType}] sessionUpdate: ${update.sessionUpdate}`);
    }
    this.emitDiagnosticLog({
      message: 'ACP session update',
      detail: update.sessionUpdate,
      metadata: update,
      verbose: true,
    });
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
        this.emit('user-message', (update as any).content);
        break;
      case 'agent_message_chunk':
        this.emit('agent-message', {
          messageId: typeof (update as any).messageId === 'string' ? (update as any).messageId : '',
          content: (update as any).content,
        });
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
      case 'available_commands_update':
        this.availableCommands = Array.isArray((update as any).availableCommands)
          ? (update as any).availableCommands
              .map((command: any) => ({
                name: String(command?.name || '').trim(),
                description: String(command?.description || '').trim(),
                source: typeof command?.source === 'string' ? command.source.trim() : undefined,
                type: typeof command?.type === 'string' ? command.type.trim() : undefined,
                kind: typeof command?.kind === 'string' ? command.kind.trim() : undefined,
                category: typeof command?.category === 'string' ? command.category.trim() : undefined,
              }))
              .filter((command: ACPCommandInfo) => command.name)
          : [];
        this.emit('available-commands', this.getAvailableCommands());
        break;
      default:
        this.emit('update', update);
    }
  }

  private captureHistoryReplayUpdate(notification: SessionNotification): boolean {
    const collector = this.historyReplayCollector;
    if (!collector) return false;
    if (notification.sessionId !== collector.sessionId) return false;

    const update = notification.update;
    const role = update.sessionUpdate === 'agent_message_chunk'
      ? 'assistant'
      : update.sessionUpdate === 'user_message_chunk'
        ? 'user'
        : null;
    if (!role) {
      return true;
    }

    if (!collector.started) {
      if (role !== 'user') {
        return true;
      }
      collector.started = true;
      collector.messageOrder.length = 0;
      collector.messageChunks.clear();
      collector.anonymousMessageCount = 0;
    }

    const messageIdRaw = typeof (update as any).messageId === 'string'
      ? (update as any).messageId.trim()
      : '';
    const messageId = messageIdRaw || `__anonymous_${++collector.anonymousMessageCount}`;
    const key = `${role}:${messageId}`;
    if (!collector.messageChunks.has(key)) {
      collector.messageChunks.set(key, []);
      collector.messageOrder.push({ key, role });
    }

    const text = this.extractChunkText((update as any).content);
    if (text) {
      collector.messageChunks.get(key)!.push(text);
    }
    return true;
  }

  private async flushHistoryReplayNotifications(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.resolve();
  }

  private extractChunkText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!content || typeof content !== 'object') return '';
    const chunk = content as Record<string, unknown>;
    if (typeof chunk.text === 'string') return chunk.text;
    if (typeof chunk.content === 'string') return chunk.content;
    return '';
  }

  /**
   * Clean up resources
   */
  private cleanup(reason?: string): void {
    if (reason) {
      this.emitDiagnosticLog({
        message: 'ACP cleanup',
        detail: reason,
        verbose: true,
      });
    }
    this.process = null;
    this.connection = null;
    this.sessionId = null;
    this.initialized = false;
  }
}
