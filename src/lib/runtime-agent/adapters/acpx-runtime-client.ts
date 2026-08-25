import { readFile } from 'fs/promises';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { loadConfiguredEnvObject } from '@/lib/core/configured-env';
import { toAcpMcpServers } from '@/lib/mcp/registry';
import { resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';
import type {
  AcpRuntime,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
  AcpSessionStore,
  AcpRuntimeSessionMode,
  AcpRuntimeTurn,
} from 'acpx/runtime';
import type {
  AdapterCancelInput,
  AdapterSessionInput,
  AdapterTurnInput,
  RuntimePermissionPolicyId,
  RuntimeBinding,
  RuntimeProfileSnapshot,
} from '../contracts';
import { writeAcpxDebugTrace } from '../acpx-debug-trace';
import { redactDiagnosticPayload } from '../security/redaction';
import { formatAcpxCommandForRuntime, getAcpxAgentRegistryOverrides, shouldSkipOpencodeSafeCheck, type AcpxCommandResolution, type AcpxRuntimeClient } from './acpx-adapter';

export interface CreateAcpxRuntimeClientOptions {
  cwd?: string;
  stateDir?: string;
  runtime?: AcpRuntime;
  importRuntime?: () => Promise<AcpxRuntimeModule>;
  sessionMode?: AcpRuntimeSessionMode;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  /** Maximum time to wait for a terminal result after ACP has ended its event stream. */
  resultTimeoutMs?: number;
  loadConfiguredEnv?: (options?: { userId?: string }) => Promise<Record<string, string>>;
}

export interface AcpxRuntimeModule {
  createAcpRuntime(options: AcpRuntimeOptions): AcpRuntime;
  createAgentRegistry(input?: { overrides?: Record<string, string | string[]> }): AcpRuntimeOptions['agentRegistry'];
  createRuntimeStore(input: { stateDir: string }): AcpRuntimeOptions['sessionStore'];
}

type AcpxPermissionConfig = Pick<AcpRuntimeOptions, 'permissionMode' | 'nonInteractivePermissions'>;
type AcpxMcpServers = Array<{
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}>;

const DEFAULT_ACPX_SESSION_MODE: AcpRuntimeSessionMode = 'oneshot';
const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
const DEFAULT_TURN_RESULT_TIMEOUT_MS = 30_000;
const ACPX_PERSISTED_ENV_KEY_PREFIX = 'ace_env_';
const ACPX_PERSISTED_SNAKE_CASE_KEY = /^[a-z][a-z0-9_]*$/;

interface ActiveAcpxTurn {
  handle: AcpRuntimeHandle;
  runtime: AcpRuntime;
  turn: AcpRuntimeTurn;
}

interface AcpxModelSelection {
  model: string;
  postInitializationConfig: Array<{ key: string; value: string }>;
}

export function createAcpxRuntimeClient(options: CreateAcpxRuntimeClientOptions = {}): AcpxRuntimeClient {
  const runtimePromises = new Map<string, Promise<AcpRuntime>>();
  const runtimeKeyBySessionKey = new Map<string, string>();
  const selectedModelBySessionKey = new Map<string, string>();
  const activeTurns = new Map<string, ActiveAcpxTurn>();
  const closedSessionKeys = new Set<string>();
  const pendingRuntimeCloses = new Map<string, Promise<void>>();
  const cleanupTimeoutMs = normalizeTimeout(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS);
  const turnResultTimeoutMs = normalizeTimeout(options.resultTimeoutMs, DEFAULT_TURN_RESULT_TIMEOUT_MS);

  async function getRuntime(profileSnapshot?: RuntimeProfileSnapshot): Promise<AcpRuntime> {
    if (options.runtime) return options.runtime;
    const permissionConfig = resolveAcpxPermissionConfig(profileSnapshot?.permissionPolicyId);
    const mcpServers = resolveRuntimeMcpServers(profileSnapshot);
    const cacheKey = runtimeCacheKey(permissionConfig, mcpServers);
    let runtimePromise = runtimePromises.get(cacheKey);
    if (!runtimePromise) {
      runtimePromise = createRuntime(options, permissionConfig, mcpServers);
      runtimePromises.set(cacheKey, runtimePromise);
    }
    return runtimePromise;
  }

  return {
    async ensureSession(input) {
      const session = input.session;
      const agentId = session.profileSnapshot.agentId;
      const runtimeAgent = formatAcpxCommandForRuntime(input.command, {
        agentId,
        cwd: session.profileSnapshot.cwd,
      });
      const modelSelection = resolveAcpModelSelection(
        agentId,
        session.modelRoute.providerModel,
        session.modelRoute.configOptions,
      );
      const resumeSessionId = resolveResumeSessionId(input.existingHandle);
      let runtime: AcpRuntime | undefined;
      let handle: AcpRuntimeHandle | undefined;

      try {
        runtime = await getRuntime(session.profileSnapshot);
        applyProcessEnvForAgent(agentId);
        const env = await resolveEnv(session, options.loadConfiguredEnv);
        const createEnsureInput = (sessionKey: string, resumeId?: string) => ({
          sessionKey,
          agent: runtimeAgent,
          // A persistent ACP client keeps npm exec/shell/agent processes alive between turns.
          // ACEHarness persists the session record and reconnects on the next turn, so the
          // transport itself must be one-shot by default.
          mode: options.sessionMode ?? DEFAULT_ACPX_SESSION_MODE,
          cwd: session.profileSnapshot.cwd,
          ...(resumeId ? { resumeSessionId: resumeId } : {}),
          sessionOptions: {
            model: modelSelection.model,
            ...(env ? { env } : {}),
          },
        });
        try {
          handle = await runtime.ensureSession(createEnsureInput(session.runtimeSessionId, resumeSessionId));
        } catch (error) {
          if (!resumeSessionId || !isAcpResumeUnavailableError(error)) throw error;

          const recoverySessionKey = createFreshAcpSessionKey(session.runtimeSessionId);
          writeAcpxDebugTrace({
            stage: 'acpx.session_resume_fallback',
            context: {
              runtimeSessionId: session.runtimeSessionId,
              agentId,
              runtime: 'acpx',
            },
            payload: {
              resumeSessionId,
              recoverySessionKey,
              nativeError: describeAcpxError(error),
            },
          });
          handle = await runtime.ensureSession(createEnsureInput(recoverySessionKey));
        }

        for (const config of modelSelection.postInitializationConfig) {
          if (!runtime.setConfigOption) {
            throw new Error(`当前 ACPX runtime 不支持会话配置项 ${config.key}`);
          }
          await runtime.setConfigOption({ handle, ...config });
        }
        await ensureOpenCodeSelectedModel(runtime, handle, agentId, modelSelection.model);
        selectedModelBySessionKey.set(handle.sessionKey, modelSelection.model);

        runtimeKeyBySessionKey.set(
          handle.sessionKey,
          runtimeCacheKey(resolveAcpxPermissionConfig(session.profileSnapshot.permissionPolicyId), resolveRuntimeMcpServers(session.profileSnapshot)),
        );
        return handle;
      } catch (error) {
        if (runtime && handle) {
          await closeRuntimeForHandle(runtime, handle, 'aceharness-runtime-session-init-failed', cleanupTimeoutMs).catch(() => {});
        }
        const failure = createAcpxSessionInitializationError({
          error,
          agentId,
          runtimeAgent,
          requestedModel: session.modelRoute.providerModel,
          modelSelection,
        });
        writeAcpxDebugTrace({
          stage: 'acpx.session_init_failed',
          context: {
            runtimeSessionId: session.runtimeSessionId,
            agentId,
            runtime: 'acpx',
          },
          payload: failure.details,
        });
        throw failure;
      }
    },

    async *runTurn(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AcpRuntimeEvent> {
      const runtime = await getRuntime(input.profileSnapshot);
      const handle = requireAcpHandle(binding);
      const sessionCloseKey = acpxSessionKey(handle);
      closedSessionKeys.delete(sessionCloseKey);
      runtimeKeyBySessionKey.set(
        handle.sessionKey,
        runtimeCacheKey(resolveAcpxPermissionConfig(input.profileSnapshot.permissionPolicyId), resolveRuntimeMcpServers(input.profileSnapshot)),
      );
      await ensureOpenCodeSelectedModel(
        runtime,
        handle,
        input.profileSnapshot.agentId,
        selectedModelBySessionKey.get(handle.sessionKey) || resolveProfileSnapshotProviderModel(input.profileSnapshot),
        { force: true },
      );
      let beforeUsage: AcpxCumulativeUsageSnapshot | undefined;
      try {
        beforeUsage = await withTimeout(
          readCumulativeUsage(runtime, handle),
          cleanupTimeoutMs,
          'ACP runtime status timed out',
        ).catch(() => undefined);
      } catch (error) {
        await closeRuntimeForHandle(runtime, handle, 'aceharness-runtime-start-failed', cleanupTimeoutMs).catch(() => {});
        throw error;
      }
      const seenToolCalls = new Map<string, AcpRuntimeEvent>();
      const terminalToolCalls = new Map<string, ToolTerminalStatus>();
      const recoveredToolResultCalls = new Set<string>();
      let turn: AcpRuntimeTurn;
      try {
        turn = runtime.startTurn({
          handle,
          text: input.input,
          mode: 'prompt',
          requestId: input.requestId,
          ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
        });
      } catch (error) {
        await closeRuntimeForHandle(runtime, handle, 'aceharness-runtime-start-failed', cleanupTimeoutMs).catch(() => {});
        throw error;
      }
      activeTurns.set(input.turnId, { handle, runtime, turn });
      let resultSettled = false;
      try {
        for await (const nativeEvent of turn.events) {
          // ACPX classifies provider-private orchestration calls such as
          // Codex spawnAgent/wait as `other`. The same session record retains
          // the original ToolUse metadata, so recover it before projection.
          const event = await enrichOpaqueToolEventFromPersistedCall(handle, nativeEvent)
            .catch(() => nativeEvent);
          const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
          if (toolCallId && isTrackableToolLifecycleEvent(event)) {
            const previous = seenToolCalls.get(toolCallId);
            seenToolCalls.set(toolCallId, mergeToolCallEvent(previous, event));
          }
          const nativeTerminalStatus = resolveNativeToolTerminalStatus(event);
          if (toolCallId && nativeTerminalStatus) {
            terminalToolCalls.set(toolCallId, nativeTerminalStatus);
          }
          yield event;
        }
        // ACP agents can occasionally close their event stream after a tool
        // has completed yet never settle `result` (OpenCode oneshot is one
        // observed case). Without a bound here the orchestrator retains a
        // running turn forever, even after its process has exited. This timer
        // starts only after the event stream has ended, so long-running tools
        // may continue to stream normally without being cut off.
        const result = await withTimeout(
          turn.result,
          turnResultTimeoutMs,
          'ACP runtime ended its event stream without a terminal result',
        );
        resultSettled = true;
        writeAcpxDebugTrace({
          stage: 'acpx.turn_result',
          context: {
            runtimeSessionId: binding.runtimeSessionId,
            turnId: input.turnId,
            requestId: input.requestId,
            traceId: input.traceId,
            runtime: binding.runtime,
          },
          payload: result,
        });
        const afterUsage = await withTimeout(
          readCumulativeUsage(runtime, handle),
          cleanupTimeoutMs,
          'ACP runtime status timed out',
        ).catch(() => undefined);
        const persistedUsage: Awaited<ReturnType<typeof readPersistedTerminalUsage>> =
          await readPersistedTerminalUsage(handle, beforeUsage).catch(() => ({}));
        const usage = diffUsage(afterUsage, beforeUsage) ?? persistedUsage.usage;
        const cost = diffCost(afterUsage?.cost, beforeUsage?.cost) ?? persistedUsage.cost;
        const fallbackToolStatus = resolveTurnTerminalToolStatus(result);
        const recoveredToolEvents = await readPersistedToolResultEvents(
          handle,
          seenToolCalls,
          terminalToolCalls,
          recoveredToolResultCalls,
        );
        for (const event of recoveredToolEvents) {
          if (typeof event.toolCallId === 'string') recoveredToolResultCalls.add(event.toolCallId);
        }
        const toolCompletionEvents = [
          ...recoveredToolEvents,
          ...createMissingToolCompletionEvents(
            seenToolCalls,
            terminalToolCalls,
            recoveredToolResultCalls,
            fallbackToolStatus,
            result.status,
          ),
        ];
        for (const event of toolCompletionEvents) {
          writeAcpxDebugTrace({
            stage: 'acpx.raw_event',
            context: {
              runtimeSessionId: binding.runtimeSessionId,
              turnId: input.turnId,
              requestId: input.requestId,
              traceId: input.traceId,
              runtime: binding.runtime,
            },
            payload: event,
          });
          yield event;
        }
        if (result.status === 'completed') {
          yield { type: 'done', stopReason: result.stopReason, usage, cost };
        } else if (result.status === 'cancelled') {
          yield { type: 'done', stopReason: result.stopReason ?? 'cancelled', usage, cost };
        } else {
          yield {
            type: 'error',
            message: result.error.message,
            code: result.error.code,
            detailCode: result.error.detailCode,
            retryable: result.error.retryable,
            usage,
            cost,
          };
        }
      } finally {
        if (!resultSettled) {
          await abortTurn(turn, 'acpx turn consumer detached or failed', cleanupTimeoutMs);
        }
        activeTurns.delete(input.turnId);
        try {
          await closeRuntimeForHandle(
            runtime,
            handle,
            resultSettled ? 'aceharness-runtime-turn-complete' : 'aceharness-runtime-turn-aborted',
            cleanupTimeoutMs,
          );
        } catch (error) {
          writeAcpxDebugTrace({
            stage: 'acpx.runtime_close_failed',
            context: {
              runtimeSessionId: binding.runtimeSessionId,
              turnId: input.turnId,
              requestId: input.requestId,
              traceId: input.traceId,
              runtime: binding.runtime,
            },
            payload: error,
          });
        }
      }
    },

    async cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void> {
      const handle = requireAcpHandle(binding);
      const runtime = await getRuntimeForHandle(handle);
      const active = activeTurns.get(input.turnId);
      const cancellingActiveTurn = Boolean(active && sameAcpSession(active.handle, handle));
      let failure: unknown;
      try {
        if (cancellingActiveTurn && active) {
          await withTimeout(active.turn.cancel({ reason: input.reason }), cleanupTimeoutMs, 'ACP turn cancellation timed out');
        } else {
          await withTimeout(runtime.cancel({
            handle,
            reason: input.reason,
          }), cleanupTimeoutMs, 'ACP session cancellation timed out');
        }
      } catch (error) {
        failure = error;
      }

      if (!cancellingActiveTurn) {
        try {
          await closeRuntimeForHandle(
            runtime,
            handle,
            failure ? 'aceharness-runtime-cancel-failed' : 'aceharness-runtime-cancel',
            cleanupTimeoutMs,
          );
        } catch (error) {
          // Preserve the native cancellation error when both operations fail; otherwise surface
          // close timeout/failure so a successful cancel cannot hide a leaked runtime transport.
          failure ??= error;
        }
      }

      if (failure) throw failure;
    },

    async close(binding: RuntimeBinding): Promise<void> {
      const handle = requireAcpHandle(binding);
      const runtime = await getRuntimeForHandle(handle);
      const active = Array.from(activeTurns.values()).filter((entry) => sameAcpSession(entry.handle, handle));
      for (const entry of active) {
        await abortTurn(entry.turn, 'aceharness runtime close', cleanupTimeoutMs);
      }
      await closeRuntimeForHandle(runtime, handle, 'aceharness-runtime-close', cleanupTimeoutMs);
    },

    async getStatus(binding: RuntimeBinding) {
      const handle = requireAcpHandle(binding);
      const runtime = await getRuntimeForHandle(handle);
      return runtime.getStatus?.({
        handle,
      });
    },
  };

  async function getRuntimeForHandle(handle: AcpRuntimeHandle): Promise<AcpRuntime> {
    if (options.runtime) return options.runtime;
    const cacheKey = runtimeKeyBySessionKey.get(handle.sessionKey);
    if (cacheKey) {
      const runtimePromise = runtimePromises.get(cacheKey);
      if (runtimePromise) return runtimePromise;
    }
    return getRuntime();
  }

  async function closeRuntimeForHandle(
    runtime: AcpRuntime,
    handle: AcpRuntimeHandle,
    reason: string,
    timeoutMs: number,
  ): Promise<void> {
    const key = acpxSessionKey(handle);
    if (closedSessionKeys.has(key)) return;
    const pending = pendingRuntimeCloses.get(key);
    if (pending) return pending;

    const closePromise = closeRuntime(runtime, handle, reason, timeoutMs)
      .then(() => {
        closedSessionKeys.add(key);
      })
      .finally(() => {
        pendingRuntimeCloses.delete(key);
      });
    pendingRuntimeCloses.set(key, closePromise);
    return closePromise;
  }
}

type ToolTerminalStatus = 'completed' | 'failed';

function resolveNativeToolTerminalStatus(event: AcpRuntimeEvent): ToolTerminalStatus | undefined {
  const eventType = String(event.type || '').trim().toLowerCase();
  if (eventType === 'tool_completed') return 'completed';
  if (eventType === 'tool_failed') return 'failed';

  const status = String(event.status ?? '').trim().toLowerCase();
  if (['completed', 'done', 'success'].includes(status)) return 'completed';
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) return 'failed';
  return undefined;
}

function resolveTurnTerminalToolStatus(result: { status: string }): ToolTerminalStatus {
  return result.status === 'completed' ? 'completed' : 'failed';
}

function isTrackableToolLifecycleEvent(event: AcpRuntimeEvent): boolean {
  return [
    'tool_call',
    'tool_call_update',
    'tool_started',
    'tool_updated',
    'tool_output',
    'tool_completed',
    'tool_failed',
  ].includes(String(event.type || '').toLowerCase());
}

type PersistedToolCallMetadata = {
  id: string;
  name: string;
  rawInput?: Record<string, unknown>;
};

async function enrichOpaqueToolEventFromPersistedCall(
  handle: AcpRuntimeHandle,
  event: AcpRuntimeEvent,
): Promise<AcpRuntimeEvent> {
  if (!isTrackableToolLifecycleEvent(event)) return event;
  const source = isRecord(event) ? event : {};
  if (!isOpaqueToolEvent(source)) return event;

  const toolCallIds = extractToolCallIds(source);
  if (toolCallIds.length === 0) return event;
  const metadata = await readPersistedToolCallMetadata(handle, toolCallIds);
  if (!metadata) return event;
  const canonicalName = normalizeProviderToolName(metadata.name);
  return {
    ...source,
    toolCallId: metadata.id,
    name: canonicalName,
    toolName: canonicalName,
    tool_name: canonicalName,
    rawInput: metadata.rawInput ?? source.rawInput,
  } as AcpRuntimeEvent;
}

function extractToolCallIds(event: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const add = (value: unknown) => {
    const id = nonEmptyString(value);
    if (id && !candidates.includes(id)) candidates.push(id);
  };
  const read = (value: unknown) => {
    if (!isRecord(value)) return;
    add(value.toolCallId ?? value.tool_call_id);
    add(value.id);
  };

  read(event);
  read(event.payload);
  read(event.data);
  read(event.toolCall);
  read(event.tool_call);
  return candidates;
}

function isOpaqueToolEvent(event: Record<string, unknown>): boolean {
  const identity = [event.name, event.toolName, event.tool_name, event.tool, event.kind, event.title]
    .map(nonEmptyString)
    .filter((value): value is string => Boolean(value));
  return identity.length === 0 || identity.some((value) => /^(other|unknown|tool|tool call)$/i.test(value));
}

async function readPersistedToolCallMetadata(
  handle: AcpRuntimeHandle,
  toolCallIds: string[],
): Promise<PersistedToolCallMetadata | undefined> {
  const recordId = handle.acpxRecordId || handle.sessionKey;
  if (!recordId) return undefined;
  const filePath = getWorkspaceDataFile('acpx-runtime', 'sessions', `${encodeURIComponent(recordId)}.json`);
  const record = await readJsonRecord(filePath);
  if (!record) return undefined;
  const calls = new Map<string, PersistedToolCallMetadata>();
  collectPersistedToolCalls(calls, record);
  for (const toolCallId of toolCallIds) {
    const metadata = calls.get(toolCallId);
    if (metadata) return metadata;
  }
  return undefined;
}

function collectPersistedToolCalls(
  target: Map<string, PersistedToolCallMetadata>,
  source: unknown,
): void {
  if (!isRecord(source)) return;
  collectPersistedToolUseContent(target, source.content);
  collectPersistedToolUseContent(target, source.tool_uses ?? source.toolUses ?? source.tool_calls ?? source.toolCalls);

  const agent = isRecord(source.Agent) ? source.Agent : isRecord(source.agent) ? source.agent : undefined;
  if (agent) {
    collectPersistedToolUseContent(target, agent.content);
    collectPersistedToolUseContent(target, agent.tool_uses ?? agent.toolUses ?? agent.tool_calls ?? agent.toolCalls);
  }
  const messages = Array.isArray(source.messages) ? source.messages : [];
  for (const message of messages) collectPersistedToolCalls(target, message);
}

function collectPersistedToolUseContent(
  target: Map<string, PersistedToolCallMetadata>,
  content: unknown,
): void {
  const entries = Array.isArray(content)
    ? content
    : isRecord(content)
      ? Object.values(content)
      : [];
  for (const entry of entries) {
    const source = isRecord(entry) ? entry : {};
    const toolUse = isRecord(source.ToolUse)
      ? source.ToolUse
      : isRecord(source.toolUse)
        ? source.toolUse
        : source;
    const id = nonEmptyString(toolUse.id ?? toolUse.toolCallId ?? toolUse.tool_call_id);
    const name = nonEmptyString(toolUse.name ?? toolUse.toolName ?? toolUse.tool_name);
    if (!id || !name) continue;
    target.set(id, {
      id,
      name,
      rawInput: parsePersistedToolInput(toolUse.input ?? toolUse.raw_input ?? toolUse.rawInput),
    });
  }
}

function normalizeProviderToolName(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'spawnagent') return 'subagent-dispatch';
  if (normalized === 'wait' || normalized === 'waitforagents') return 'subagent-wait';
  return name;
}

function parsePersistedToolInput(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function mergeToolCallEvent(previous: AcpRuntimeEvent | undefined, incoming: AcpRuntimeEvent): AcpRuntimeEvent {
  if (!previous) return incoming;
  const previousRecord = isRecord(previous) ? previous : {};
  const incomingRecord = isRecord(incoming) ? incoming : {};
  return {
    ...previous,
    ...incoming,
    toolCallId: incomingRecord.toolCallId ?? previousRecord.toolCallId,
    ...pickToolIdentity(previousRecord, incomingRecord),
    title: incomingRecord.title ?? previousRecord.title,
    kind: incomingRecord.kind ?? previousRecord.kind,
    rawInput: incomingRecord.rawInput ?? previousRecord.rawInput,
    rawOutput: incomingRecord.rawOutput ?? previousRecord.rawOutput,
    output: incomingRecord.output ?? previousRecord.output,
    aggregated_output: incomingRecord.aggregated_output ?? previousRecord.aggregated_output,
    stdout: incomingRecord.stdout ?? previousRecord.stdout,
    stderr: incomingRecord.stderr ?? previousRecord.stderr,
    exitCode: incomingRecord.exitCode ?? previousRecord.exitCode,
    exit_code: incomingRecord.exit_code ?? previousRecord.exit_code,
  } as AcpRuntimeEvent;
}

function pickToolIdentity(
  previous: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: incoming.name ?? previous.name,
    toolName: incoming.toolName ?? previous.toolName,
    tool_name: incoming.tool_name ?? previous.tool_name,
  };
}

function pickToolIdentityFromEvent(event: AcpRuntimeEvent): Record<string, unknown> {
  return pickToolIdentity(isRecord(event) ? event : {}, {});
}

function createMissingToolCompletionEvents(
  seenToolCalls: Map<string, AcpRuntimeEvent>,
  terminalToolCalls: Map<string, ToolTerminalStatus>,
  recoveredToolResultCalls: Set<string>,
  fallbackStatus: ToolTerminalStatus,
  turnStatus: 'completed' | 'cancelled' | 'failed',
): AcpRuntimeEvent[] {
  const events: AcpRuntimeEvent[] = [];
  for (const [toolCallId, callEvent] of seenToolCalls) {
    if (terminalToolCalls.has(toolCallId) || recoveredToolResultCalls.has(toolCallId)) continue;
    const exitCode = finiteNumber(callEvent.exitCode) ?? finiteNumber(callEvent.exit_code);
    events.push({
      type: 'tool_call_update',
      toolCallId,
      ...pickToolIdentityFromEvent(callEvent),
      status: fallbackStatus,
      title: callEvent.title,
      kind: callEvent.kind,
      rawInput: callEvent.rawInput,
      rawOutput: createUnavailableToolResult(callEvent, fallbackStatus, turnStatus, exitCode),
      text: callEvent.title || 'tool call completed',
    });
  }
  return events;
}

function createUnavailableToolResult(
  callEvent: AcpRuntimeEvent,
  status: ToolTerminalStatus,
  turnStatus: 'completed' | 'cancelled' | 'failed',
  exitCode?: number,
): Record<string, unknown> {
  if (status === 'completed') {
    return {
      completed: true,
      resultUnavailable: true,
      ...(exitCode !== undefined ? { exitCode } : {}),
    };
  }
  return {
    error: resolveToolLifecycleError(callEvent)
      || (turnStatus === 'cancelled'
        ? '工具调用在运行取消前未返回终态。'
        : '运行失败前工具调用未返回终态。'),
    resultUnavailable: true,
    ...(turnStatus === 'cancelled' ? { cancelled: true } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function resolveToolLifecycleError(event: AcpRuntimeEvent): string | undefined {
  if (typeof event.error === 'string' && event.error.trim()) return event.error;
  if (isRecord(event.error) && typeof event.error.message === 'string' && event.error.message.trim()) {
    return event.error.message;
  }
  return undefined;
}

async function readPersistedToolResultEvents(
  handle: AcpRuntimeHandle,
  seenToolCalls: Map<string, AcpRuntimeEvent>,
  terminalToolCalls: Map<string, ToolTerminalStatus>,
  recoveredToolResultCalls: Set<string>,
): Promise<AcpRuntimeEvent[]> {
  const recordId = handle.acpxRecordId || handle.sessionKey;
  if (!recordId || seenToolCalls.size === 0) return [];
  const filePath = getWorkspaceDataFile('acpx-runtime', 'sessions', `${encodeURIComponent(recordId)}.json`);
  const record = await readJsonRecord(filePath);
  const messages = Array.isArray(record?.messages) ? record.messages : [];
  const resultById = new Map<string, Record<string, any>>();
  collectToolResults(resultById, record);
  for (const message of messages) {
    collectToolResults(resultById, message);
    const agent = isRecord(message?.Agent) ? message.Agent : undefined;
    collectToolResults(resultById, agent);
  }

  const events: AcpRuntimeEvent[] = [];
  for (const [toolCallId, callEvent] of seenToolCalls) {
    if (recoveredToolResultCalls.has(toolCallId)) continue;
    const result = resultById.get(toolCallId);
    if (!result) continue;
    const rawOutput = normalizePersistedToolOutput(result);
    const persistedFailure = isPersistedToolFailure(result);
    if (rawOutput === undefined && !persistedFailure) continue;
    const status: ToolTerminalStatus = persistedFailure || terminalToolCalls.get(toolCallId) === 'failed'
      ? 'failed'
      : 'completed';
    const exitCode = isRecord(rawOutput)
      ? finiteNumber(rawOutput.exitCode) ?? finiteNumber(rawOutput.exit_code)
      : undefined;
    events.push({
      type: 'tool_call_update',
      toolCallId,
      ...pickToolIdentityFromEvent(callEvent),
      status,
      title: callEvent.title,
      kind: callEvent.kind,
      rawInput: callEvent.rawInput,
      rawOutput: rawOutput ?? {
        error: resolveToolLifecycleError(callEvent) || '工具调用失败，ACP 未返回详细结果。',
        resultUnavailable: true,
      },
      output: isRecord(rawOutput) ? rawOutput.output : rawOutput,
      exit_code: exitCode,
      text: callEvent.title || 'tool call completed',
    });
  }
  return events;
}

function collectToolResults(target: Map<string, Record<string, any>>, source: unknown): void {
  if (!isRecord(source)) return;
  const toolResults = isRecord(source.tool_results)
    ? source.tool_results
    : isRecord(source.toolResults)
      ? source.toolResults
      : undefined;
  if (!toolResults) return;
  for (const [toolCallId, value] of Object.entries(toolResults)) {
    if (isRecord(value)) target.set(toolCallId, value);
  }
}

async function readJsonRecord(filePath: string): Promise<Record<string, any> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function normalizePersistedToolOutput(result: Record<string, any>): unknown {
  if (result.output !== undefined) {
    const output = normalizePersistedToolOutputValue(result.output);
    return normalizePersistedToolResultData(addPersistedExitCode(output, result));
  }
  const text = typeof result.content?.Text === 'string' ? result.content.Text : undefined;
  if (text !== undefined) {
    if (!text.trim()) return addPersistedExitCode(undefined, result);
    try {
      return normalizePersistedToolResultData(addPersistedExitCode(normalizePersistedToolOutputValue(JSON.parse(text)), result));
    } catch {
      return normalizePersistedToolResultData(addPersistedExitCode({ output: text }, result));
    }
  }
  const rawOutput = pickDefinedRecord({
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
    output: result.formatted_output,
    exitCode: finiteNumber(result.exit_code) ?? finiteNumber(result.exitCode),
  });
  return normalizePersistedToolResultData(rawOutput);
}

function addPersistedExitCode(value: unknown, result: Record<string, any>): unknown {
  const exitCode = finiteNumber(result.exit_code) ?? finiteNumber(result.exitCode);
  if (value === undefined || value === null) {
    return exitCode === undefined ? undefined : { exitCode };
  }
  if (exitCode === undefined) return value;
  if (isRecord(value)) {
    return {
      ...value,
      exitCode: finiteNumber(value.exitCode) ?? finiteNumber(value.exit_code) ?? exitCode,
    };
  }
  return { output: value, exitCode };
}

function normalizePersistedToolResultData(value: unknown): unknown {
  return hasPersistedToolResultData(value) ? value : undefined;
}

function hasPersistedToolResultData(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.some(hasPersistedToolResultData);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => {
    if (['exitCode', 'exit_code'].includes(key)) return finiteNumber(child) !== undefined;
    return hasPersistedToolResultData(child);
  });
}

function isPersistedToolFailure(result: Record<string, any>): boolean {
  if (result.is_error === true || result.isError === true) return true;
  if (typeof result.error === 'string' && result.error.trim()) return true;
  return isRecord(result.error) && typeof result.error.message === 'string' && result.error.message.trim().length > 0;
}

function normalizePersistedToolOutputValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (typeof value.formatted_output === 'string') {
    return {
      ...value,
      output: value.formatted_output,
      exitCode: finiteNumber(value.exit_code) ?? finiteNumber(value.exitCode),
    };
  }
  const exitCode = finiteNumber(value.exit_code) ?? finiteNumber(value.exitCode);
  return exitCode === undefined ? value : { ...value, exitCode };
}

function pickDefinedRecord(source: Record<string, unknown>): Record<string, unknown> {
  const target: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) target[key] = value;
  }
  return target;
}

async function createRuntime(
  options: CreateAcpxRuntimeClientOptions,
  permissionConfig: AcpxPermissionConfig,
  mcpServers: AcpxMcpServers,
): Promise<AcpRuntime> {
  const module = await (options.importRuntime?.() ?? import('acpx/runtime'));
  const sessionStore = module.createRuntimeStore({
    stateDir: options.stateDir ?? getWorkspaceDataFile('acpx-runtime'),
  });
  return module.createAcpRuntime({
    cwd: options.cwd ?? process.cwd(),
    sessionStore: createAcpxCompatibleSessionStore(sessionStore),
    agentRegistry: module.createAgentRegistry({
      overrides: getAcpxAgentRegistryOverrides(),
    }),
    ...(mcpServers.length > 0 ? { mcpServers: mcpServers as AcpRuntimeOptions['mcpServers'] } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...permissionConfig,
  });
}

/**
 * acpx 0.13.0 validates every persisted object key as snake_case, including
 * environment-variable maps whose keys must retain their original spelling.
 * Encode only the on-disk keys and restore them immediately after loading so
 * agent processes still receive names such as ANTHROPIC_AUTH_TOKEN unchanged.
 */
function createAcpxCompatibleSessionStore(store: AcpSessionStore): AcpSessionStore {
  return {
    async load(sessionId) {
      const record = await store.load(sessionId);
      return record ? remapPersistedEnvKeys(record, decodePersistedEnvKey) : undefined;
    },
    async save(record) {
      await store.save(remapPersistedEnvKeys(record, encodePersistedEnvKey));
    },
  };
}

function remapPersistedEnvKeys(
  record: unknown,
  mapKey: (key: string) => string,
): unknown {
  if (!isRecord(record) || !isRecord(record.acpx)) return record;
  const sessionOptions = record.acpx.session_options;
  if (!isRecord(sessionOptions) || !isRecord(sessionOptions.env)) return record;

  return {
    ...record,
    acpx: {
      ...record.acpx,
      session_options: {
        ...sessionOptions,
        env: Object.fromEntries(Object.entries(sessionOptions.env).map(([key, value]) => [mapKey(key), value])),
      },
    },
  };
}

function encodePersistedEnvKey(key: string): string {
  if (ACPX_PERSISTED_SNAKE_CASE_KEY.test(key)) return key;
  return `${ACPX_PERSISTED_ENV_KEY_PREFIX}${Buffer.from(key, 'utf8').toString('hex')}`;
}

function decodePersistedEnvKey(key: string): string {
  if (!key.startsWith(ACPX_PERSISTED_ENV_KEY_PREFIX)) return key;
  const encoded = key.slice(ACPX_PERSISTED_ENV_KEY_PREFIX.length);
  if (encoded.length === 0 || encoded.length % 2 !== 0 || !/^[a-f0-9]+$/.test(encoded)) return key;
  return Buffer.from(encoded, 'hex').toString('utf8');
}

async function abortTurn(turn: AcpRuntimeTurn, reason: string, timeoutMs: number): Promise<void> {
  try {
    await withTimeout(turn.cancel({ reason }), timeoutMs, 'ACP turn cancellation timed out');
  } catch {
    // Closing the stream is still useful when the agent rejects or ignores cancellation.
  }
  try {
    await withTimeout(turn.closeStream({ reason }), timeoutMs, 'ACP turn stream close timed out');
  } catch {
    // The runtime close path remains the final cleanup boundary.
  }
}

async function closeRuntime(
  runtime: AcpRuntime,
  handle: AcpRuntimeHandle,
  reason: string,
  timeoutMs: number,
): Promise<void> {
  await withTimeout(runtime.close({
    handle,
    reason,
    discardPersistentState: false,
  }), timeoutMs, 'ACP runtime close timed out');
}

function acpxSessionKey(handle: AcpRuntimeHandle): string {
  return handle.acpxRecordId || handle.sessionKey;
}

function sameAcpSession(left: AcpRuntimeHandle, right: AcpRuntimeHandle): boolean {
  if (left.sessionKey && left.sessionKey === right.sessionKey) return true;
  if (left.acpxRecordId && left.acpxRecordId === right.acpxRecordId) return true;
  if (left.backendSessionId && left.backendSessionId === right.backendSessionId) return true;
  return false;
}

function normalizeTimeout(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveAcpxPermissionConfig(permissionPolicyId: RuntimePermissionPolicyId | undefined): AcpxPermissionConfig {
  switch (permissionPolicyId) {
    case 'deny-all':
      return { permissionMode: 'deny-all', nonInteractivePermissions: 'deny' };
    case 'approve-reads':
      return { permissionMode: 'approve-reads', nonInteractivePermissions: 'deny' };
    case 'ask':
      return { permissionMode: 'approve-reads', nonInteractivePermissions: 'fail' };
    case 'deny-destructive':
      return { permissionMode: 'approve-reads', nonInteractivePermissions: 'deny' };
    case 'unrestricted':
    case undefined:
      return { permissionMode: 'approve-all', nonInteractivePermissions: 'deny' };
  }
}

function runtimeCacheKey(permissionConfig: AcpxPermissionConfig, mcpServers: AcpxMcpServers = []): string {
  return `${permissionConfig.permissionMode}:${permissionConfig.nonInteractivePermissions ?? ''}:${stableJson(mcpServers)}`;
}

function resolveRuntimeMcpServers(profileSnapshot?: RuntimeProfileSnapshot): AcpxMcpServers {
  const servers = Array.isArray(profileSnapshot?.mcpServers) ? profileSnapshot.mcpServers : [];
  return toAcpMcpServers(servers as any);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function resolveAcpModelSelection(
  agentId: string | undefined,
  providerModel: string,
  configOptions?: Record<string, unknown>,
): AcpxModelSelection {
  const model = String(providerModel || '').trim();
  if (String(agentId || '').trim().toLowerCase() !== 'codex') {
    return {
      model: resolveAcpModelName(model, configOptions),
      postInitializationConfig: [],
    };
  }

  const bracketMatch = model.match(/^(.*)\[(low|medium|high|xhigh)\]$/i);
  const baseModel = bracketMatch?.[1]?.trim() || model;
  const reasoningEffort = bracketMatch?.[2]?.toLowerCase()
    || resolveCodexReasoningEffort(configOptions);
  return {
    model: baseModel,
    postInitializationConfig: reasoningEffort
      ? [{ key: 'reasoning_effort', value: reasoningEffort }]
      : [],
  };
}

function resolveAcpModelName(model: string, configOptions?: Record<string, unknown>): string {
  if (!model || model.includes('[')) return model;
  const optionKeys = Object.keys(configOptions || {}).filter(Boolean);
  if (optionKeys.length !== 1) return model;
  const [key] = optionKeys;
  const value = configOptions?.[key];
  if (value !== '' && value !== true) return model;
  if (!/^(low|medium|high|xhigh)$/i.test(key)) return model;
  return `${model}[${key}]`;
}

function resolveCodexReasoningEffort(configOptions?: Record<string, unknown>): string | undefined {
  const explicit = configOptions?.reasoning_effort ?? configOptions?.reasoningEffort;
  if (typeof explicit === 'string' && /^(low|medium|high|xhigh)$/i.test(explicit.trim())) {
    return explicit.trim().toLowerCase();
  }
  const optionKeys = Object.keys(configOptions || {}).filter(Boolean);
  if (optionKeys.length !== 1) return undefined;
  const [key] = optionKeys;
  const value = configOptions?.[key];
  if (value !== '' && value !== true) return undefined;
  return /^(low|medium|high|xhigh)$/i.test(key) ? key.toLowerCase() : undefined;
}

function createAcpxSessionInitializationError(input: {
  error: unknown;
  agentId: string;
  runtimeAgent: string;
  requestedModel: string;
  modelSelection: AcpxModelSelection;
}): Error & {
  code: 'ADAPTER_FAILED';
  retryable: false;
  redacted: true;
  details: Record<string, unknown>;
  cause: { code?: string; message: string };
} {
  const native = describeAcpxError(input.error);
  const details = redactDiagnosticPayload({
    stage: 'session.initialize',
    agentId: input.agentId,
    runtimeAgent: input.runtimeAgent,
    requestedModel: input.requestedModel,
    resolvedModel: input.modelSelection.model,
    postInitializationConfig: input.modelSelection.postInitializationConfig,
    nativeError: native,
  }, { maxDepth: 6 }).value as Record<string, unknown>;
  const lines = [
    'ACPX 会话初始化失败。',
    `引擎：${input.agentId}`,
    `请求模型：${input.requestedModel || '默认模型'}`,
    input.modelSelection.model && input.modelSelection.model !== input.requestedModel
      ? `传给 ACP 的模型：${input.modelSelection.model}`
      : '',
    input.modelSelection.postInitializationConfig.length > 0
      ? `会话配置：${input.modelSelection.postInitializationConfig.map((item) => `${item.key}=${item.value}`).join(', ')}`
      : '',
    native.code ? `ACP 错误码：${native.code}` : '',
    native.detailCode ? `ACP 详情码：${native.detailCode}` : '',
    native.reason ? `失败原因：${native.reason}` : '',
    native.diagnostic ? `详细信息：${native.diagnostic}` : '',
    `处理建议：${acpxSessionInitializationSuggestion(native)}`,
  ].filter(Boolean);
  const failure = Object.assign(new Error(lines.join('\n')), {
    code: 'ADAPTER_FAILED' as const,
    retryable: false as const,
    redacted: true as const,
    details,
    cause: {
      ...(native.code ? { code: native.code } : {}),
      message: native.diagnostic || native.message || 'ACPX session initialization failed',
    },
  });
  return failure;
}

function describeAcpxError(error: unknown): {
  code?: string;
  detailCode?: string;
  reason?: string;
  message?: string;
  diagnostic?: string;
} {
  const source = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
  const cause = source?.cause && typeof source.cause === 'object' ? source.cause as Record<string, unknown> : undefined;
  const data = source?.data && typeof source.data === 'object' ? source.data as Record<string, unknown> : undefined;
  const causeData = cause?.data && typeof cause.data === 'object' ? cause.data as Record<string, unknown> : undefined;
  const message = firstString(source?.message, cause?.message);
  const detail = firstString(
    data?.details,
    data?.message,
    data?.reason,
    source?.details,
    causeData?.details,
    causeData?.message,
    causeData?.reason,
    cause?.details,
    message,
  );
  return {
    code: firstString(source?.code, cause?.code),
    detailCode: firstString(source?.detailCode, cause?.detailCode),
    reason: firstString(source?.reason, data?.reason, cause?.reason, causeData?.reason),
    message,
    diagnostic: truncateDiagnosticText(detail),
  };
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function truncateDiagnosticText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.length > 3000 ? `${value.slice(0, 3000)}...` : value;
}

function acpxSessionInitializationSuggestion(error: ReturnType<typeof describeAcpxError>): string {
  const diagnostic = [error.message, error.diagnostic, error.reason].filter(Boolean).join(' ').toLowerCase();
  if (error.code === 'ACP_MODEL_UNSUPPORTED' || diagnostic.includes('did not advertise that model')) {
    return '重新检测该引擎可用模型，并在模型管理或工作流设置中选择 ACP 实际返回的模型。';
  }
  if (diagnostic.includes('failed to reload config') || diagnostic.includes('config.toml')) {
    return '检查本机 Codex 配置格式，或升级 ACPX 与 Codex ACP 适配器后重试。';
  }
  return '查看后台 ACPX 诊断日志后，从失败步骤重新运行。';
}

interface AcpxCumulativeUsageSnapshot {
  inputTokens?: number;
  outputTokens?: number;
  cachedReadTokens?: number;
  cachedWriteTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
  cost?: {
    amount?: number;
    currency?: string;
  };
}

async function readCumulativeUsage(runtime: AcpRuntime, handle: AcpRuntimeHandle): Promise<AcpxCumulativeUsageSnapshot | undefined> {
  const status = await runtime.getStatus?.({ handle }).catch(() => undefined);
  const usage = isRecord(status?.usage) ? status.usage : undefined;
  const cumulative = isRecord(usage?.cumulative) ? usage.cumulative : undefined;
  const cost = isRecord(usage?.cost) ? usage.cost : undefined;
  if (!cumulative && !cost) return undefined;
  return {
    inputTokens: finiteNumber(cumulative?.inputTokens),
    outputTokens: finiteNumber(cumulative?.outputTokens),
    cachedReadTokens: finiteNumber(cumulative?.cachedReadTokens),
    cachedWriteTokens: finiteNumber(cumulative?.cachedWriteTokens),
    thoughtTokens: finiteNumber(cumulative?.thoughtTokens),
    totalTokens: finiteNumber(cumulative?.totalTokens),
    cost: cost ? {
      amount: finiteNumber(cost.amount),
      currency: typeof cost.currency === 'string' ? cost.currency : undefined,
    } : undefined,
  };
}

async function readPersistedTerminalUsage(
  handle: AcpRuntimeHandle,
  before: AcpxCumulativeUsageSnapshot | undefined,
): Promise<{
  usage?: Record<string, number>;
  cost?: AcpxCumulativeUsageSnapshot['cost'];
}> {
  const recordId = handle.acpxRecordId || handle.sessionKey;
  if (!recordId) return {};
  const filePath = getWorkspaceDataFile('acpx-runtime', 'sessions', `${encodeURIComponent(recordId)}.json`);
  const record = await readJsonRecord(filePath);
  if (!record) return {};

  const requestUsage = selectPersistedUsageSnapshot(record.request_token_usage ?? record.requestTokenUsage);
  const requestCost = selectPersistedCostSnapshot(record.request_cost ?? record.requestCost) ?? requestUsage?.cost;
  if (requestUsage) {
    return {
      usage: usageRecordFromSnapshot(requestUsage),
      cost: requestCost,
    };
  }

  const cumulativeCost = normalizePersistedCostSnapshot(record.cumulative_cost ?? record.cumulativeCost);
  const cumulativeUsage = normalizePersistedUsageSnapshot(record.cumulative_token_usage ?? record.cumulativeTokenUsage);
  const cumulativeSnapshot = cumulativeUsage
    ? { ...cumulativeUsage, cost: cumulativeUsage.cost ?? cumulativeCost }
    : cumulativeCost
      ? { cost: cumulativeCost }
      : undefined;
  return {
    usage: diffUsage(cumulativeSnapshot, before),
    cost: diffCost(cumulativeSnapshot?.cost, before?.cost),
  };
}

function selectPersistedUsageSnapshot(value: unknown): AcpxCumulativeUsageSnapshot | undefined {
  const direct = normalizePersistedUsageSnapshot(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return selectNewestPersistedEntry(value, normalizePersistedUsageSnapshot);
}

function selectPersistedCostSnapshot(value: unknown): AcpxCumulativeUsageSnapshot['cost'] | undefined {
  const direct = normalizePersistedCostSnapshot(value);
  if (direct) return direct;
  if (!isRecord(value)) return undefined;
  return selectNewestPersistedEntry(value, normalizePersistedCostSnapshot);
}

function selectNewestPersistedEntry<T>(
  value: Record<string, unknown>,
  normalize: (entry: unknown) => T | undefined,
): T | undefined {
  let selected: { index: number; timestamp?: number; value: T } | undefined;
  Object.entries(value).forEach(([key, entry], index) => {
    const normalized = normalize(entry);
    if (!normalized) return;
    const timestamp = persistedEntryTimestamp(entry) ?? persistedKeyTimestamp(key);
    if (
      !selected
      || (timestamp !== undefined && (selected.timestamp === undefined || timestamp >= selected.timestamp))
      || (timestamp === undefined && selected.timestamp === undefined && index >= selected.index)
    ) {
      selected = { index, timestamp, value: normalized };
    }
  });
  return selected?.value;
}

function normalizePersistedUsageSnapshot(value: unknown): AcpxCumulativeUsageSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const cost = normalizePersistedCostSnapshot(value.cost);
  const usage = {
    inputTokens: finiteNumber(value.inputTokens ?? value.input_tokens),
    outputTokens: finiteNumber(value.outputTokens ?? value.output_tokens),
    cachedReadTokens: finiteNumber(value.cachedReadTokens ?? value.cacheReadInputTokens ?? value.cache_read_input_tokens),
    cachedWriteTokens: finiteNumber(value.cachedWriteTokens ?? value.cacheCreationInputTokens ?? value.cache_creation_input_tokens),
    thoughtTokens: finiteNumber(value.thoughtTokens ?? value.thought_tokens),
    totalTokens: finiteNumber(value.totalTokens ?? value.total_tokens),
    cost,
  };
  const hasUsage = [
    usage.inputTokens,
    usage.outputTokens,
    usage.cachedReadTokens,
    usage.cachedWriteTokens,
    usage.thoughtTokens,
    usage.totalTokens,
    usage.cost?.amount,
  ].some((item) => item !== undefined);
  return hasUsage ? usage : undefined;
}

function normalizePersistedCostSnapshot(value: unknown): AcpxCumulativeUsageSnapshot['cost'] | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return { amount: value };
  if (!isRecord(value)) return undefined;
  const amount = finiteNumber(value.amount ?? value.costUsd ?? value.cost_usd);
  if (amount === undefined) return undefined;
  return {
    amount,
    currency: typeof value.currency === 'string' ? value.currency : undefined,
  };
}

function persistedEntryTimestamp(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  return timestampValue(
    value.updatedAt,
    value.updated_at,
    value.createdAt,
    value.created_at,
    value.timestamp,
  );
}

function persistedKeyTimestamp(key: string): number | undefined {
  return timestampValue(key);
}

function timestampValue(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsedNumber = Number(value);
    if (Number.isFinite(parsedNumber)) return parsedNumber;
    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) return parsedDate;
  }
  return undefined;
}

function usageRecordFromSnapshot(snapshot: AcpxCumulativeUsageSnapshot): Record<string, number> | undefined {
  const usage = {
    input_tokens: snapshot.inputTokens,
    output_tokens: snapshot.outputTokens,
    cache_read_input_tokens: snapshot.cachedReadTokens,
    cache_creation_input_tokens: snapshot.cachedWriteTokens,
    thought_tokens: snapshot.thoughtTokens,
    total_tokens: snapshot.totalTokens,
  };
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  if (entries.length === 0 || entries.every(([, value]) => value === 0)) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
}

function diffUsage(
  after: AcpxCumulativeUsageSnapshot | undefined,
  before: AcpxCumulativeUsageSnapshot | undefined,
): Record<string, number> | undefined {
  if (!after) return undefined;
  const usage = {
    input_tokens: diffNumber(after.inputTokens, before?.inputTokens),
    output_tokens: diffNumber(after.outputTokens, before?.outputTokens),
    cache_read_input_tokens: diffNumber(after.cachedReadTokens, before?.cachedReadTokens),
    cache_creation_input_tokens: diffNumber(after.cachedWriteTokens, before?.cachedWriteTokens),
    thought_tokens: diffNumber(after.thoughtTokens, before?.thoughtTokens),
    total_tokens: diffNumber(after.totalTokens, before?.totalTokens),
  };
  const entries = Object.entries(usage).filter(([, value]) => value !== undefined);
  if (entries.length === 0 || entries.every(([, value]) => value === 0)) return undefined;
  return Object.fromEntries(entries) as Record<string, number>;
}

function diffCost(
  after: AcpxCumulativeUsageSnapshot['cost'] | undefined,
  before: AcpxCumulativeUsageSnapshot['cost'] | undefined,
): AcpxCumulativeUsageSnapshot['cost'] | undefined {
  const amount = roundCost(diffNumber(after?.amount, before?.amount));
  if (amount === undefined) return undefined;
  return {
    amount,
    currency: after?.currency ?? before?.currency,
  };
}

function diffNumber(after: number | undefined, before: number | undefined): number | undefined {
  if (after === undefined) return undefined;
  return Math.max(0, after - (before ?? 0));
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function roundCost(value: number | undefined): number | undefined {
  return value === undefined ? undefined : Number(value.toFixed(12));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireAcpHandle(binding: RuntimeBinding): AcpRuntimeHandle {
  const raw = binding.raw;
  if (raw && typeof raw === 'object' && 'handle' in raw) {
    const handle = (raw as { handle?: unknown }).handle;
    if (handle && typeof handle === 'object') {
      return handle as AcpRuntimeHandle;
    }
  }
  throw new Error(`Runtime binding does not contain an acpx handle: ${binding.id}`);
}

function resolveResumeSessionId(handle: AcpRuntimeHandle | undefined): string | undefined {
  if (!handle || typeof handle !== 'object') return undefined;
  const backendSessionId = (handle as { backendSessionId?: unknown }).backendSessionId;
  const agentSessionId = (handle as { agentSessionId?: unknown }).agentSessionId;
  return typeof backendSessionId === 'string'
    ? backendSessionId
    : typeof agentSessionId === 'string'
      ? agentSessionId
      : undefined;
}

async function resolveEnv(
  input: AdapterSessionInput,
  configuredEnvLoader: CreateAcpxRuntimeClientOptions['loadConfiguredEnv'],
): Promise<Record<string, string> | undefined> {
  const configured = await (configuredEnvLoader?.({ userId: input.profileSnapshot.ownerUserId })
    ?? loadConfiguredEnvObject(
      input.profileSnapshot.ownerUserId ? { userId: input.profileSnapshot.ownerUserId } : undefined,
    ));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(configured)) {
    if (key.trim().length > 0 && typeof value === 'string' && value.trim().length > 0) {
      env[key.trim()] = value;
    }
  }
  for (const item of input.profileSnapshot.env ?? []) {
    // The ACP child inherits process-env from the host. Passing that snapshot as
    // an explicit option would incorrectly replace system or personal values.
    if (item.source === 'process-env') continue;
    if (item.secret) continue;
    if (typeof item.value === 'string' && item.value.trim().length > 0 && item.key.trim().length > 0) {
      env[item.key.trim()] = item.value;
    }
  }
  return Object.keys(env).length > 0 ? env : undefined;
}

/**
 * OpenCode advertises model selection through the ACP `model` config option.
 * Some ACP reconnect paths retain the requested session option but reopen on
 * OpenCode's default model.  That is especially dangerous when the default
 * provider is unavailable: the UI still labels the run with the requested
 * model while the provider failure appears unrelated.  Re-read the negotiated
 * model and make the selection durable through the same ACP config channel.
 */
async function ensureOpenCodeSelectedModel(
  runtime: AcpRuntime,
  handle: AcpRuntimeHandle,
  agentId: string,
  requestedModel: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (String(agentId || '').trim().toLowerCase() !== 'opencode') return;
  if (!requestedModel || !runtime.getStatus || !runtime.setConfigOption) return;

  const currentModel = readCurrentAcpModel(await runtime.getStatus({ handle }));
  if (!options.force && (!currentModel || currentModel === requestedModel)) return;

  await runtime.setConfigOption({ handle, key: 'model', value: requestedModel });
  const verifiedModel = readCurrentAcpModel(await runtime.getStatus({ handle }));
  if (verifiedModel && verifiedModel !== requestedModel) {
    throw new Error(`OpenCode ACP 未采用所选模型「${requestedModel}」，当前仍为「${verifiedModel}」`);
  }
}

function resolveProfileSnapshotProviderModel(profileSnapshot: RuntimeProfileSnapshot): string {
  try {
    return resolveRuntimeModelRoute({ modelRouteId: profileSnapshot.modelRouteId })?.providerModel || '';
  } catch {
    return '';
  }
}

function readCurrentAcpModel(status: unknown): string | undefined {
  if (!isRecord(status)) return undefined;
  const models = isRecord(status.models) ? status.models : undefined;
  const currentModel = models?.currentModelId;
  return typeof currentModel === 'string' && currentModel.trim() ? currentModel.trim() : undefined;
}

function createFreshAcpSessionKey(runtimeSessionId: string): string {
  return `${runtimeSessionId}:recovery:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
}

function isAcpResumeUnavailableError(error: unknown): boolean {
  const native = describeAcpxError(error);
  const diagnostic = [
    native.message,
    native.diagnostic,
    native.reason,
  ].filter(Boolean).join('\n').toLowerCase();
  if (!diagnostic) return false;
  if (diagnostic.includes('no rollout found')) return true;
  if (/\bpersistent acp session\b.*\bcould not be resumed\b/u.test(diagnostic)) return true;
  const isNotFound = /\b(resource not found|not found|does not exist|unknown session|missing session)\b/u.test(diagnostic);
  if (isNotFound) return true;
  const mentionsResume = /\b(resume|resumed|session\/resume|session\/load|thread id)\b/u.test(diagnostic);
  return mentionsResume && isNotFound;
}

function applyProcessEnvForAgent(agentId: string | undefined): void {
  if (shouldSkipOpencodeSafeCheck(agentId)) {
    process.env.OPENCODE_SKIP_SAFE_CHECK = process.env.OPENCODE_SKIP_SAFE_CHECK || '1';
  }
}
