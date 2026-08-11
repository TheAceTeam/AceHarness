import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getBuiltinAgentDefinition } from '@/lib/runtime-agent/agent-registry';
import { getAcpxAgentRegistryOverrides, resolveAcpxCommand, resolveAcpxRuntimeAgent, shouldSkipOpencodeSafeCheck } from '@/lib/runtime-agent/adapters/acpx-adapter';
import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

type DiscoveredModel = {
  modelId: string;
  name: string;
  source?: string;
  recommended?: boolean;
};

function normalizeEngineId(engine: string): string {
  if (engine === 'claude-code') return 'claude';
  if (engine === 'kiro-cli') return 'kiro';
  if (engine === 'magic-cli') return 'cangjie-magic';
  return engine;
}

function uniqueModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();
  for (const model of models) {
    const modelId = String(model.modelId || '').trim();
    if (!modelId) continue;
    const current = byId.get(modelId);
    byId.set(modelId, {
      modelId,
      name: current?.name || model.name || modelId,
      source: current?.source || model.source,
      recommended: Boolean(current?.recommended || model.recommended),
    });
  }
  return Array.from(byId.values());
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function valuesFromUnknown(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>);
  return [];
}

function addModel(target: DiscoveredModel[], seen: Set<string>, modelId: unknown, name?: unknown): void {
  const id = stringValue(modelId);
  if (!id || seen.has(id)) return;
  seen.add(id);
  target.push({ modelId: id, name: stringValue(name) || id, source: 'acpx' });
}

function looksLikeModelConfigOption(option: Record<string, unknown>): boolean {
  const id = stringValue(option.id).toLowerCase();
  const type = stringValue(option.type).toLowerCase();
  const category = stringValue(option.category).toLowerCase();
  return type === 'select' && (id === 'model' || category === 'model');
}

function extractModelsFromStatus(status: unknown): DiscoveredModel[] {
  const target: DiscoveredModel[] = [];
  const seen = new Set<string>();
  if (!status || typeof status !== 'object') return target;
  const record = status as Record<string, unknown>;
  const models = record.models && typeof record.models === 'object'
    ? record.models as Record<string, unknown>
    : undefined;

  for (const modelId of valuesFromUnknown(models?.availableModelIds)) {
    addModel(target, seen, modelId);
  }
  for (const item of valuesFromUnknown(models?.availableModels)) {
    if (typeof item === 'string') {
      addModel(target, seen, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    addModel(target, seen, model.modelId ?? model.value ?? model.id, model.name ?? model.label ?? model.title);
  }

  const configOptions = [
    ...valuesFromUnknown(record.configOptions),
    ...valuesFromUnknown((record.details as Record<string, unknown> | undefined)?.configOptions),
  ];
  for (const option of configOptions) {
    if (!option || typeof option !== 'object') continue;
    const optionRecord = option as Record<string, unknown>;
    if (!looksLikeModelConfigOption(optionRecord)) continue;
    for (const choice of [
      ...valuesFromUnknown(optionRecord.options),
      ...valuesFromUnknown(optionRecord.choices),
      ...valuesFromUnknown(optionRecord.items),
      ...valuesFromUnknown(optionRecord.values),
    ]) {
      if (typeof choice === 'string') {
        addModel(target, seen, choice);
        continue;
      }
      if (!choice || typeof choice !== 'object') continue;
      const item = choice as Record<string, unknown>;
      addModel(target, seen, item.value ?? item.modelId ?? item.id ?? item.key, item.name ?? item.label ?? item.title ?? item.description);
    }
  }
  return target;
}

async function discoverViaAcpx(agentId: string): Promise<DiscoveredModel[]> {
  const definition = getBuiltinAgentDefinition(agentId);
  if (!definition || definition.runtime !== 'acpx') {
    throw new Error(`Unknown ACPX agent: ${agentId}`);
  }
  const cwd = process.cwd();
  const command = resolveAcpxCommand(agentId);
  // Built-in ACPX agents resolve through the registry override argv array.
  // Passing the ID avoids ACPX's unsupported Windows raw-command-string path.
  const runtimeAgent = resolveAcpxRuntimeAgent(command, { agentId, cwd });
  return await discoverViaAcpxCommand(agentId, runtimeAgent, agentId, 1, 1, cwd);
}

async function discoverViaAcpxCommand(
  agentId: string,
  command: string,
  source: string,
  attempt: number,
  attemptCount: number,
  cwd: string,
): Promise<DiscoveredModel[]> {
  const startedAt = Date.now();

  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
  const runtime = createAcpRuntime({
    cwd,
    sessionStore: createRuntimeStore({
      stateDir: getWorkspaceDataFile('acpx-runtime'),
    }),
    agentRegistry: createAgentRegistry({
      overrides: getAcpxAgentRegistryOverrides(),
    }),
    permissionMode: 'approve-all',
    nonInteractivePermissions: 'deny',
  });
  if (shouldSkipOpencodeSafeCheck(agentId)) {
    process.env.OPENCODE_SKIP_SAFE_CHECK = process.env.OPENCODE_SKIP_SAFE_CHECK || '1';
  }

  const handle = await runtime.ensureSession({
    sessionKey: `model-discovery:${agentId}`,
    agent: command,
    mode: 'oneshot',
    cwd,
  });

  try {
    const status = await runtime.getStatus?.({ handle });
    const models = uniqueModels(extractModelsFromStatus(status));
    return models;
  } finally {
    await runtime.close({
      handle,
      reason: 'model-discovery-complete',
      discardPersistentState: true,
    }).catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const engine = requestUrl(request).searchParams.get('engine')?.trim();
  if (!engine) {
    return jsonError('engine parameter required', 400);
  }

  const agentId = normalizeEngineId(engine);

  try {
    const models = await discoverViaAcpx(agentId);
    if (models.length > 0) {
      return jsonOk({ engine, agentId, source: 'acpx', models });
    }
  } catch (error) {
    return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
  }

  return jsonOk({
    engine,
    agentId,
    source: 'acpx',
    models: [],
    message: '当前运行时没有返回可用模型列表',
  });
}
