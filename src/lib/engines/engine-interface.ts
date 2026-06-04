/**
 * Engine Interface
 *
 * Abstract interface for different AI engines (Claude Code, Kiro CLI, etc.)
 */

export interface EngineOptions {
  agent: string;
  step: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  workingDirectory: string;
  allowedTools?: string[];
  timeoutMs?: number;
  sessionId?: string;
  /** Force a fresh backend session even if the wrapper has an in-memory session. */
  forceNewSession?: boolean;
  appendSystemPrompt?: boolean;
  runId?: string;
  /** MCP server configs */
  mcpServers?: any[];
  /** Review panel agents */
  agents?: Record<string, any>;
  /** Frontend session tracking */
  frontendSessionId?: string;
  /** Authenticated user id for user-scoped credentials/env vars. */
  userId?: string;
  /** Enable high-detail wrapper/transport lifecycle logs for diagnostics only. */
  diagnosticLogging?: boolean;
}

export interface EngineTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface EngineResultMetadata {
  usage?: Partial<EngineTokenUsage>;
  cost_usd?: number;
  costUsd?: number;
  duration_ms?: number;
  durationMs?: number;
  duration_api_ms?: number;
  durationApiMs?: number;
  num_turns?: number;
  numTurns?: number;
  [key: string]: any;
}

/** Unified execution result across all engines */
export interface EngineJsonResult {
  result: string;
  session_id: string;
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  usage: EngineTokenUsage;
}

export interface EngineResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  stopReason?: string;
  metadata?: EngineResultMetadata;
}

export interface EngineContextCompactOptions {
  sessionId: string;
  prompt: string;
  systemPrompt: string;
  model: string;
  workingDirectory: string;
  error?: string;
}

export interface EngineContextCompactResult {
  sessionId?: string;
  prompt?: string;
  summary?: string;
  method?: 'native' | 'manual';
}

export interface EngineStreamEvent {
  type: 'text' | 'tool' | 'thought' | 'error' | 'log' | 'session';
  content: string;
  metadata?: any;
}

export interface Engine {
  execute(options: EngineOptions): Promise<EngineResult>;
  compactContext?(options: EngineContextCompactOptions): Promise<EngineContextCompactResult | null>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
  off(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
}
