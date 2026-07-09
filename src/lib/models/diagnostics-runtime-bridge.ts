import { randomUUID } from 'crypto';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { createRuntimeOrchestrator } from '@/lib/runtime-agent/orchestrator';
import { openRuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import {
  upsertModelCatalogEntry,
  upsertModelRoute,
  capabilitiesForResolvedRoute,
  type ResolvedModelRouteRecord,
} from '@/lib/runtime-agent/models/model-routes';
import { resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';
import type { DiagnosticDriver } from '@/lib/models/diagnostic-types';
import type { RuntimeEvent } from '@/lib/runtime-agent/contracts';

export interface RuntimeDiagnosticIdentity {
  modelRouteId?: string;
  engineId: string;
  model: string;
  providerId?: string;
  route?: ResolvedModelRouteRecord;
}

export interface RuntimeDiagnosticAvailability {
  available: boolean;
  drivers?: Partial<Record<Exclude<DiagnosticDriver, 'auto'>, boolean>>;
  detail?: string;
}

export interface RuntimeDiagnosticPromptOptions {
  modelRouteId?: string;
  engineId: string;
  model: string;
  prompt: string;
  systemPrompt?: string;
  step?: string;
  agent?: string;
  category?: string;
  timeoutMs?: number;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeDiagnosticPromptEvent {
  type: string;
  content?: string;
  metadata?: unknown;
}

export interface RuntimeDiagnosticPromptResult {
  success: boolean;
  output: string;
  sessionId?: string;
  stopReason?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  events: RuntimeDiagnosticPromptEvent[];
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compatRouteId(agentId: string, model: string): string {
  return `model-diagnostics-compat-${agentId}-${model || 'default'}`.replace(/[^a-zA-Z0-9_.:-]+/g, '-');
}

export function resolveRuntimeDiagnosticIdentity(input: {
  modelRouteId?: string;
  engine?: string;
  model?: string;
}): RuntimeDiagnosticIdentity {
  const modelRouteId = optionalTrimmedString(input.modelRouteId);
  const requestedEngine = optionalTrimmedString(input.engine);
  const requestedModel = optionalTrimmedString(input.model);
  const route = resolveRuntimeModelRoute({
    modelRouteId,
    agentId: requestedEngine,
    modelId: requestedModel,
  });

  return {
    modelRouteId: route?.modelRouteId ?? modelRouteId,
    engineId: route?.agentId ?? requestedEngine ?? 'claude-code',
    model: route?.providerModel ?? requestedModel ?? 'default',
    providerId: route?.providerId,
    route: route ?? undefined,
  };
}

function ensureRuntimeRoute(identity: RuntimeDiagnosticIdentity): ResolvedModelRouteRecord {
  if (identity.route) return identity.route;
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  try {
    const modelId = identity.model || 'default';
    const routeId = identity.modelRouteId || compatRouteId(identity.engineId, modelId);
    upsertModelCatalogEntry(db, {
      id: modelId,
      displayName: modelId,
      metadata: {
        source: 'model-diagnostics-compat-bridge',
      },
    });
    const route = upsertModelRoute(db, {
      id: routeId,
      modelId,
      agentId: identity.engineId,
      providerModel: identity.model,
      runtime: 'acpx',
      capabilities: {
        streaming: true,
        permissions: false,
        toolCalls: false,
        usage: 'missing',
        source: 'model-diagnostics-compat-bridge',
      },
      status: 'active',
      isDefault: false,
      priority: 9999,
    });
    return {
      modelRouteId: route.id,
      modelId: route.modelId,
      modelDisplayName: modelId,
      agentId: route.agentId,
      runtime: route.runtime,
      providerId: route.providerId,
      providerModel: route.providerModel,
      configOptions: route.configOptions ?? {},
      envRequirements: route.envRequirements ?? [],
      capabilities: route.capabilities ?? {},
      priority: route.priority,
      isDefault: route.isDefault,
      verifiedAt: route.verifiedAt,
    };
  } finally {
    db.close();
  }
}

export async function getRuntimeDiagnosticAvailability(identity: RuntimeDiagnosticIdentity): Promise<RuntimeDiagnosticAvailability> {
  try {
    const route = ensureRuntimeRoute(identity);
    return {
      available: true,
      drivers: { sdk: route.runtime === 'acpx', stdio: route.runtime === 'acpx' },
      detail: `runtime=${route.runtime}, route=${route.modelRouteId}`,
    };
  } catch (error) {
    return {
      available: false,
      drivers: { sdk: false, stdio: false },
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function textFromPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  for (const key of ['text', 'content', 'delta', 'message', 'output']) {
    if (typeof record[key] === 'string') return String(record[key]);
  }
  return '';
}

function stopReasonFromPayload(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>).stopReason;
  return typeof value === 'string' ? value : undefined;
}

function eventToPromptEvent(event: RuntimeEvent): RuntimeDiagnosticPromptEvent {
  const content = textFromPayload(event.payload);
  return {
    type: event.type === 'message.delta' || event.type === 'message.completed'
      ? 'text'
      : event.type === 'diagnostic'
        ? 'log'
        : event.type,
    content,
    metadata: event.payload,
  };
}

export async function runRuntimeDiagnosticPrompt(options: RuntimeDiagnosticPromptOptions): Promise<RuntimeDiagnosticPromptResult> {
  const identity = resolveRuntimeDiagnosticIdentity({
    modelRouteId: options.modelRouteId,
    engine: options.engineId,
    model: options.model,
  });
  const route = ensureRuntimeRoute(identity);
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  try {
    const orchestrator = createRuntimeOrchestrator({
      db,
      resolveModelRoute: () => ({
        modelRouteId: route.modelRouteId,
        agentId: route.agentId,
        runtime: route.runtime,
        providerModel: route.providerModel,
        configOptions: route.configOptions,
        envRequirements: route.envRequirements as any,
        capabilities: capabilitiesForResolvedRoute(route),
      }),
      leaseOwner: 'model-diagnostics',
    });
    const session = await orchestrator.openSession({
      agentId: route.agentId,
      modelRouteId: route.modelRouteId,
      cwd: process.cwd(),
      kind: options.category === 'probe' ? 'probe' : 'diagnostic',
      title: options.step || options.agent || 'model diagnostics',
    });

    const events: RuntimeDiagnosticPromptEvent[] = [];
    let output = '';
    let stopReason: string | undefined;
    let error: string | undefined;
    const turnEvents = orchestrator.runTurn({
      runtimeSessionId: options.sessionId || session.runtimeSessionId,
      requestId: `model-diagnostics-${randomUUID()}`,
      input: options.prompt,
      interruptPolicy: 'reject',
      metadata: {
        source: 'model-diagnostics-compat-bridge',
        systemPrompt: options.systemPrompt,
        step: options.step,
        agent: options.agent,
        model: route.providerModel,
        timeoutMs: options.timeoutMs,
        ...options.metadata,
      },
    });
    for await (const event of turnEvents) {
      const promptEvent = eventToPromptEvent(event);
      events.push(promptEvent);
      if (event.type === 'message.delta' || event.type === 'message.completed') {
        output += promptEvent.content || '';
      }
      if (event.type === 'turn.completed') {
        stopReason = stopReasonFromPayload(event.payload) || stopReason;
      }
      if (event.type === 'turn.failed') {
        error = textFromPayload(event.payload) || 'Runtime turn failed';
      }
    }

    return {
      success: !error,
      output,
      sessionId: session.runtimeSessionId,
      stopReason,
      error,
      metadata: { resolvedModel: route.providerModel, modelRouteId: route.modelRouteId },
      events,
    };
  } catch (error) {
    return {
      success: false,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      events: [],
    };
  } finally {
    db.close();
  }
}
