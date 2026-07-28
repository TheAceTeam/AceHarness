import { readFile } from 'fs/promises';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { toAcpMcpServers } from '@/lib/mcp/registry';
import type {
  AcpRuntime,
  AcpRuntimeEvent,
  AcpRuntimeHandle,
  AcpRuntimeOptions,
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
import { formatAcpxCommandForRuntime, getAcpxAgentRegistryOverrides, shouldSkipOpencodeSafeCheck, type AcpxCommandResolution, type AcpxRuntimeClient } from './acpx-adapter';

export interface CreateAcpxRuntimeClientOptions {
  cwd?: string;
  stateDir?: string;
  runtime?: AcpRuntime;
  importRuntime?: () => Promise<AcpxRuntimeModule>;
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

export function createAcpxRuntimeClient(options: CreateAcpxRuntimeClientOptions = {}): AcpxRuntimeClient {
  const runtimePromises = new Map<string, Promise<AcpRuntime>>();
  const runtimeKeyBySessionKey = new Map<string, string>();
  const activeTurns = new Map<string, AcpRuntimeTurn>();

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
      const runtime = await getRuntime(session.profileSnapshot);
      applyProcessEnvForAgent(session.profileSnapshot.agentId);
      const handle = await runtime.ensureSession({
        sessionKey: session.runtimeSessionId,
        agent: formatAcpxCommandForRuntime(input.command, {
          agentId: session.profileSnapshot.agentId,
          cwd: session.profileSnapshot.cwd,
        }),
        mode: 'persistent',
        cwd: session.profileSnapshot.cwd,
        resumeSessionId: resolveResumeSessionId(input.existingHandle),
        sessionOptions: {
          model: resolveAcpModelName(session.modelRoute.providerModel, session.modelRoute.configOptions),
          env: resolveEnv(session),
        },
      });
      runtimeKeyBySessionKey.set(
        handle.sessionKey,
        runtimeCacheKey(resolveAcpxPermissionConfig(session.profileSnapshot.permissionPolicyId), resolveRuntimeMcpServers(session.profileSnapshot)),
      );
      return handle;
    },

    async *runTurn(binding: RuntimeBinding, input: AdapterTurnInput): AsyncIterable<AcpRuntimeEvent> {
      const runtime = await getRuntime(input.profileSnapshot);
      const handle = requireAcpHandle(binding);
      runtimeKeyBySessionKey.set(
        handle.sessionKey,
        runtimeCacheKey(resolveAcpxPermissionConfig(input.profileSnapshot.permissionPolicyId), resolveRuntimeMcpServers(input.profileSnapshot)),
      );
      const beforeUsage = await readCumulativeUsage(runtime, handle);
      const seenToolCalls = new Map<string, AcpRuntimeEvent>();
      const completedToolCalls = new Set<string>();
      const turn = runtime.startTurn({
        handle,
        text: input.input,
        mode: 'prompt',
        requestId: input.requestId,
      });
      activeTurns.set(input.turnId, turn);
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
        const afterUsage = await readCumulativeUsage(runtime, handle);
        const usage = diffUsage(afterUsage, beforeUsage);
        const cost = diffCost(afterUsage?.cost, beforeUsage?.cost);
        if (result.status === 'completed') {
          for (const event of await readPersistedToolResultEvents(handle, seenToolCalls, completedToolCalls)) {
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
        activeTurns.delete(input.turnId);
      }
    },

    async cancel(binding: RuntimeBinding, input: AdapterCancelInput): Promise<void> {
      const turn = activeTurns.get(input.turnId);
      if (turn) {
        await turn.cancel({ reason: input.reason });
        return;
      }
      const handle = requireAcpHandle(binding);
      const runtime = await getRuntimeForHandle(handle);
      await runtime.cancel({
        handle,
        reason: input.reason,
      });
    },

    async close(binding: RuntimeBinding): Promise<void> {
      const handle = requireAcpHandle(binding);
      const runtime = await getRuntimeForHandle(handle);
      await runtime.close({
        handle,
        reason: 'aceharness-runtime-close',
        discardPersistentState: false,
      });
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
    ...permissionConfig,
  });
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

function resolveAcpModelName(providerModel: string, configOptions?: Record<string, unknown>): string {
  const model = String(providerModel || '').trim();
  if (!model || model.includes('[')) return model;
  const optionKeys = Object.keys(configOptions || {}).filter(Boolean);
  if (optionKeys.length !== 1) return model;
  const [key] = optionKeys;
  const value = configOptions?.[key];
  if (value !== '' && value !== true) return model;
  if (!/^(low|medium|high|xhigh)$/i.test(key)) return model;
  return `${model}[${key}]`;
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

function resolveEnv(input: AdapterSessionInput): Record<string, string> | undefined {
  const env: Record<string, string> = {};
  for (const item of input.profileSnapshot.env ?? []) {
    if (item.secret) continue;
    if (typeof item.value === 'string') env[item.key] = item.value;
  }
  delete env.OPENCODE_SKIP_SAFE_CHECK;
  return Object.keys(env).length > 0 ? env : undefined;
}

function applyProcessEnvForAgent(agentId: string | undefined): void {
  if (shouldSkipOpencodeSafeCheck(agentId)) {
    process.env.OPENCODE_SKIP_SAFE_CHECK = process.env.OPENCODE_SKIP_SAFE_CHECK || '1';
  }
}
