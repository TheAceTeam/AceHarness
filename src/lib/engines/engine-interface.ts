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
  appendSystemPrompt?: boolean;
  runId?: string;
  /** MCP server configs */
  mcpServers?: any[];
  /** Review panel agents */
  agents?: Record<string, any>;
  /** Frontend session tracking */
  frontendSessionId?: string;
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
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

export interface EngineResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
  stopReason?: string;
  metadata?: any;
}

export interface EngineStreamEvent {
  type: 'text' | 'tool' | 'thought' | 'error' | 'log';
  content: string;
  metadata?: any;
}

export interface Engine {
  execute(options: EngineOptions): Promise<EngineResult>;
  cancel(): void;
  isAvailable(): Promise<boolean>;
  getName(): string;
  on(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
  off(event: 'stream', listener: (event: EngineStreamEvent) => void): void;
}
