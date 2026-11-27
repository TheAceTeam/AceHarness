import type { AcpRuntimeOptions } from 'acpx/runtime';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getBuiltinAgentDefinition } from '@/lib/runtime-agent/agent-registry';
import { applyAcpxAgentProcessEnvDefaults, getAcpxAgentRegistryOverrides, resolveAcpxCommand, resolveAcpxRuntimeAgent } from '@/lib/runtime-agent/adapters/acpx-adapter';
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

  for (const item of valuesFromUnknown(models?.availableModels)) {
    if (typeof item === 'string') {
      addModel(target, seen, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const model = item as Record<string, unknown>;
    addModel(target, seen, model.modelId ?? model.value ?? model.id, model.name ?? model.label ?? model.title);
  }
  for (const modelId of valuesFromUnknown(models?.availableModelIds)) {
    addModel(target, seen, modelId);
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
  const effortOption = configOptions.find((option) => option && typeof option === 'object'
    && (option as Record<string, unknown>).id === 'reasoning_effort') as Record<string, unknown> | undefined;
  const reasoningEfforts = valuesFromUnknown(effortOption?.options)
    .map((choice) => typeof choice === 'string' ? choice : stringValue((choice as Record<string, unknown>)?.value))
    .filter(Boolean);
  const modelOption = configOptions.find((option) => option && typeof option === 'object'
    && (option as Record<string, unknown>).id === 'model') as Record<string, unknown> | undefined;
  const currentModelId = stringValue(modelOption?.currentValue ?? models?.currentModelId);
  const currentModel = target.find(model => model.modelId === currentModelId);
  // ACP options describe the selected model. Do not apply its effort choices
  // to every advertised model: older models can support a smaller set.
  if (currentModel) for (const effort of reasoningEfforts) {
    addModel(target, seen, `${currentModel.modelId}[effort=${effort}]`, `${currentModel.name} [effort=${effort}]`);
  }
  return target;
}

async function resolveInstalledClaudeLaunch() {
  const { AGENT_REGISTRY, resolveInstalledBuiltInAgentLaunch } = await import('acpx/agent-registry');
  return resolveInstalledBuiltInAgentLaunch(AGENT_REGISTRY.claude);
}

async function discoverViaAcpx(agentId: string): Promise<DiscoveredModel[]> {
  const definition = getBuiltinAgentDefinition(agentId);
  if (!definition || definition.runtime !== 'acpx') {
    throw new Error(`Unknown ACPX agent: ${agentId}`);
  }

  const cwd = process.cwd();
  applyAcpxAgentProcessEnvDefaults(agentId);
  const acpx = await import('acpx/runtime');

  const installedClaude = agentId === 'claude' ? await resolveInstalledClaudeLaunch() : undefined;
  const overrides = installedClaude
    ? { claude: [installedClaude.command, ...installedClaude.args] }
    : getAcpxAgentRegistryOverrides();

  const command = resolveAcpxCommand(agentId);
  const runtimeAgent = resolveAcpxRuntimeAgent(command, { agentId, cwd });
  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = acpx;
  const runtimeOptions: AcpRuntimeOptions = {
    cwd,
    sessionStore: createRuntimeStore({
      stateDir: getWorkspaceDataFile('acpx-runtime'),
    }),
    agentRegistry: createAgentRegistry({ overrides }),
    permissionMode: installedClaude ? 'deny-all' : 'approve-all',
    nonInteractivePermissions: 'deny',
    ...(installedClaude ? { fs: false, terminal: false } : {}),
  };

  let advertisedModels: DiscoveredModel[] | undefined;
  let resolveAdvertised: ((models: DiscoveredModel[]) => void) | undefined;
  const advertised = installedClaude ? new Promise<DiscoveredModel[]>((resolve) => {
    resolveAdvertised = resolve;
  }) : undefined;

  if (advertised) {
    let sessionRequestId: string | number | undefined;
    runtimeOptions.onAcpMessage = (direction, message) => {
      if (direction === 'outbound' && message.method === 'session/new' && message.id != null) {
        sessionRequestId = message.id;
      }
      if (direction === 'inbound' && sessionRequestId !== undefined && message.id === sessionRequestId) {
        const models = uniqueModels(extractModelsFromStatus(message.result));
        if (models.length > 0) {
          advertisedModels = models;
          resolveAdvertised?.(models);
        }
      }
    };
  }

  const runtime = createAcpRuntime(runtimeOptions);
  const completeProbe = async () => {
    try {
      const handle = await runtime.ensureSession({
        sessionKey: `model-discovery:${agentId}`,
        agent: runtimeAgent,
        mode: 'oneshot',
        cwd,
      });

      try {
        if (advertisedModels) return advertisedModels;
        const status = await runtime.getStatus?.({ handle });
        const models = extractModelsFromStatus(status);
        if (agentId === 'codex' && runtime.setModel) {
          const baseModels = models.filter(model => !model.modelId.includes('['));
          for (const model of baseModels) {
            await runtime.setModel({ handle, model: model.modelId });
            models.push(...extractModelsFromStatus(await runtime.getStatus?.({ handle })));
          }
        }
        return uniqueModels(models);
      } finally {
        await runtime.close({
          handle,
          reason: 'model-discovery-complete',
          discardPersistentState: true,
        }).catch(() => undefined);
      }
    } finally {
      await runtime.shutdown?.().catch(() => undefined);
    }
  };

  // The live ACP reply already contains the complete catalog. ACPX keeps
  // ownership of the temporary session and finishes closing it independently.
  const completion = completeProbe();
  return advertised ? Promise.race([advertised, completion]) : completion;
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
      return jsonOk({ engine, agentId, source: 'acpx', models }, { headers: { 'Cache-Control': 'no-store' } });
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
  }, { headers: { 'Cache-Control': 'no-store' } });
}
