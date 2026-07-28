declare module 'acpx/runtime' {
  export const ACPX_BACKEND_ID: string;

  export type AcpRuntimePromptMode = 'prompt' | 'steer';
  export type AcpRuntimeSessionMode = 'persistent' | 'oneshot';
  export type PermissionMode = 'approve-all' | 'approve-reads' | 'deny-all';
  export type NonInteractivePermissionPolicy = 'deny' | 'fail';

  export interface AcpSessionStore {
    load(sessionId: string): Promise<unknown | undefined>;
    save(record: unknown): Promise<void>;
  }

  export interface AcpAgentRegistry {
    resolve(agentName: string): string;
    list(): string[];
  }

  export interface SessionAgentOptions {
    model?: string;
    allowedTools?: string[];
    maxTurns?: number;
    systemPrompt?:
      | string
      | {
          append: string;
        };
    env?: Record<string, string>;
    [key: string]: unknown;
  }

  export interface AcpRuntimeHandle {
    sessionKey: string;
    backend: string;
    runtimeSessionName: string;
    cwd?: string;
    acpxRecordId?: string;
    backendSessionId?: string;
    agentSessionId?: string;
  }

  export interface AcpRuntimeEvent {
    type?: string;
    event?: string;
    payload?: unknown;
    data?: unknown;
    usage?: unknown;
    cost?: unknown;
    error?: unknown;
    [key: string]: unknown;
  }

  export type AcpRuntimeTurnResult =
    | { status: 'completed'; stopReason?: string; usage?: unknown; cost?: unknown }
    | { status: 'cancelled'; stopReason?: string; usage?: unknown; cost?: unknown }
    | {
        status: 'failed';
        error: {
          message: string;
          code?: string;
          detailCode?: string;
          retryable?: boolean;
        };
      };

  export interface AcpRuntimeTurn {
    readonly requestId: string;
    readonly events: AsyncIterable<AcpRuntimeEvent>;
    readonly result: Promise<AcpRuntimeTurnResult>;
    cancel(input?: { reason?: string }): Promise<void>;
    closeStream(input?: { reason?: string }): Promise<void>;
  }

  export interface AcpRuntimeStatus {
    status?: string;
    activeTurnId?: string;
    lastEventAt?: string;
    error?: unknown;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface AcpRuntimeOptions {
    cwd: string;
    sessionStore: AcpSessionStore;
    agentRegistry: AcpAgentRegistry;
    permissionMode: PermissionMode;
    nonInteractivePermissions?: NonInteractivePermissionPolicy;
    timeoutMs?: number;
    probeAgent?: string;
    verbose?: boolean;
    [key: string]: unknown;
  }

  export interface AcpRuntimeEnsureInput {
    sessionKey: string;
    agent: string;
    mode: AcpRuntimeSessionMode;
    resumeSessionId?: string;
    cwd?: string;
    sessionOptions?: SessionAgentOptions;
  }

  export interface AcpRuntimeTurnInput {
    handle: AcpRuntimeHandle;
    text: string;
    mode: AcpRuntimePromptMode;
    requestId: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }

  export interface AcpRuntime {
    ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
    startTurn(input: AcpRuntimeTurnInput): AcpRuntimeTurn;
    runTurn?(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;
    cancel(input: { handle: AcpRuntimeHandle; reason?: string }): Promise<void>;
    close(input: { handle: AcpRuntimeHandle; reason: string; discardPersistentState?: boolean }): Promise<void>;
    getStatus?(input: { handle: AcpRuntimeHandle; signal?: AbortSignal }): Promise<AcpRuntimeStatus>;
    [key: string]: unknown;
  }

  export const AcpxRuntime: new (...args: any[]) => AcpRuntime;
  export function createAcpRuntime(options: AcpRuntimeOptions): AcpRuntime;
  export function createAgentRegistry(input?: { overrides?: Record<string, string> }): AcpAgentRegistry;
  export function createFileSessionStore(input: { stateDir: string }): AcpSessionStore;
  export function createRuntimeStore(input: { stateDir: string }): AcpSessionStore;
  export function encodeAcpxRuntimeHandleState(...args: any[]): unknown;
  export function decodeAcpxRuntimeHandleState(...args: any[]): unknown;
}

declare module 'acpx/flows' {
  export const FlowRunner: new (...args: any[]) => unknown;
  export function acp(...args: any[]): unknown;
  export function action(...args: any[]): unknown;
  export function checkpoint(...args: any[]): unknown;
  export function compute(...args: any[]): unknown;
  export function decision(...args: any[]): unknown;
  export function defineFlow(...args: any[]): unknown;
  export function parseJsonObject(...args: any[]): unknown;
}
