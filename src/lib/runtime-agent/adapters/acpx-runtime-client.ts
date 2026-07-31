import { readFile } from 'fs/promises';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { loadConfiguredEnvObject } from '@/lib/core/configured-env';
import { toAcpMcpServers } from '@/lib/mcp/registry';
import type {
  AcpRuntime,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
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
  loadConfiguredEnv?: (options?: { userId?: string }) => Promise<Record<string, string>>;
}

export interface AcpxRuntimeModule {
  createAcpRuntime(options: AcpRuntimeOptions): AcpRuntime;
  createAgentRegistry(input?: { overrides?: Record<string, string> }): AcpRuntimeOptions['agentRegistry'];
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
  const activeTurns = new Map<string, ActiveAcpxTurn>();
  const closedSessionKeys = new Set<string>();
  const pendingRuntimeCloses = new Map<string, Promise<void>>();
  const cleanupTimeoutMs = normalizeTimeout(options.cleanupTimeoutMs, DEFAULT_CLEANUP_TIMEOUT_MS);

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
      const completedToolCalls = new Set<string>();
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
        for await (const event of turn.events) {
          const toolCallId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
          if (event.type === 'tool_call' && toolCallId) {
            seenToolCalls.set(toolCallId, event);
            if (hasToolOutput(event)) completedToolCalls.add(toolCallId);
          } else if (toolCallId && hasToolOutput(event)) {
            completedToolCalls.add(toolCallId);
          }
          yield event;
        }
        const result = await turn.result;
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
        const usage = diffUsage(afterUsage, beforeUsage);
        const cost = diffCost(afterUsage?.cost, beforeUsage?.cost);
        if (result.status === 'completed') {
          const recoveredToolEvents = await readPersistedToolResultEvents(handle, seenToolCalls, completedToolCalls);
          for (const event of recoveredToolEvents) {
            if (typeof event.toolCallId === 'string') completedToolCalls.add(event.toolCallId);
          }
          const toolCompletionEvents = [
            ...recoveredToolEvents,
            ...createMissingToolCompletionEvents(seenToolCalls, completedToolCalls),
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
      let failure: unknown;
      try {
        if (active && sameAcpSession(active.handle, handle)) {
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

function hasToolOutput(event: Record<string, any>): boolean {
  return event.rawOutput !== undefined
    || event.output !== undefined
    || event.aggregated_output !== undefined
    || event.stdout !== undefined
    || event.stderr !== undefined
    || event.exitCode !== undefined
    || event.exit_code !== undefined;
}

function createMissingToolCompletionEvents(
  seenToolCalls: Map<string, AcpRuntimeEvent>,
  completedToolCalls: Set<string>,
): AcpRuntimeEvent[] {
  const events: AcpRuntimeEvent[] = [];
  for (const [toolCallId, callEvent] of seenToolCalls) {
    if (completedToolCalls.has(toolCallId)) continue;
    events.push({
      type: 'tool_call_update',
      toolCallId,
      status: 'completed',
      title: callEvent.title,
      kind: callEvent.kind,
      rawInput: callEvent.rawInput,
      rawOutput: {
        output: '工具调用已完成，ACP 未返回详细结果。',
        resultUnavailable: true,
      },
      text: callEvent.title || 'tool call completed',
    });
  }
  return events;
}

async function readPersistedToolResultEvents(
  handle: AcpRuntimeHandle,
  seenToolCalls: Map<string, AcpRuntimeEvent>,
  completedToolCalls: Set<string>,
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
    if (completedToolCalls.has(toolCallId)) continue;
    const result = resultById.get(toolCallId);
    if (!result) continue;
    const rawOutput = normalizePersistedToolOutput(result);
    if (rawOutput === undefined) continue;
    events.push({
      type: 'tool_call_update',
      toolCallId,
      status: result.is_error ? 'failed' : 'completed',
      title: callEvent.title,
      kind: callEvent.kind,
      rawInput: callEvent.rawInput,
      rawOutput,
      output: isRecord(rawOutput) ? rawOutput.output : rawOutput,
      exit_code: isRecord(rawOutput) ? rawOutput.exitCode ?? rawOutput.exit_code : undefined,
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
  if (result.output !== undefined) return normalizePersistedToolOutputValue(result.output);
  const text = typeof result.content?.Text === 'string' ? result.content.Text : '';
  if (text) {
    try {
      return normalizePersistedToolOutputValue(JSON.parse(text));
    } catch {
      return { output: text };
    }
  }
  return undefined;
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
  return value;
}

async function createRuntime(
  options: CreateAcpxRuntimeClientOptions,
  permissionConfig: AcpxPermissionConfig,
  mcpServers: AcpxMcpServers,
): Promise<AcpRuntime> {
  const module = await (options.importRuntime?.() ?? import('acpx/runtime'));
  return module.createAcpRuntime({
    cwd: options.cwd ?? process.cwd(),
    sessionStore: module.createRuntimeStore({
      stateDir: options.stateDir ?? getWorkspaceDataFile('acpx-runtime'),
    }),
    agentRegistry: module.createAgentRegistry({
      overrides: getAcpxAgentRegistryOverrides(),
    }),
    ...(mcpServers.length > 0 ? { mcpServers: mcpServers as AcpRuntimeOptions['mcpServers'] } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    ...permissionConfig,
  });
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
  const mentionsResume = /\b(resume|resumed|session\/resume|session\/load|thread id)\b/u.test(diagnostic);
  return mentionsResume && /\b(resource not found|not found|does not exist|unknown session|missing session)\b/u.test(diagnostic);
}

function applyProcessEnvForAgent(agentId: string | undefined): void {
  if (shouldSkipOpencodeSafeCheck(agentId)) {
    process.env.OPENCODE_SKIP_SAFE_CHECK = process.env.OPENCODE_SKIP_SAFE_CHECK || '1';
  }
}
