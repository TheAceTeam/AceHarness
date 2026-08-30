import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { loadConfiguredEnvObject } from '@/lib/core/configured-env';
import { parse } from 'yaml';
import { getBuiltinAgentDefinition } from '@/lib/runtime-agent/agent-registry';
import { getAcpxAgentRegistryOverrides, resolveAcpxCommand, resolveAcpxRuntimeAgent, shouldSkipOpencodeSafeCheck } from '@/lib/runtime-agent/adapters/acpx-adapter';
import { DEEPSEEK_HARNESS_DEFAULT_MODELS } from '@/lib/runtime-agent/deepseek-harness-constants';
import { createAcpxCompatibleSessionStore } from '@/lib/runtime-agent/adapters/acpx-runtime-client';
import { qualifyModelId } from '@/lib/models/provider-qualified-id';
import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

type DiscoveredModel = {
  modelId: string;
  name: string;
  source?: string;
  recommended?: boolean;
  endpoints?: string[];
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
    const next: DiscoveredModel = {
      modelId,
      name: current?.name || model.name || modelId,
      source: current?.source || model.source,
      endpoints: Array.from(new Set([...(current?.endpoints || []), ...(model.endpoints || [])])),
    };
    if (current?.recommended || model.recommended) next.recommended = true;
    byId.set(modelId, next);
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

function addModel(
  target: DiscoveredModel[],
  seen: Set<string>,
  modelId: unknown,
  name?: unknown,
  options?: { source?: string; endpoint?: string },
): void {
  const id = stringValue(modelId);
  if (!id || seen.has(id)) return;
  seen.add(id);
  target.push({
    modelId: id,
    name: stringValue(name) || id,
    source: options?.source || 'acpx',
    ...(options?.endpoint ? { endpoints: [options.endpoint] } : {}),
  });
}

function configuredProviderEndpoints(providerId: string, providerConfig: Record<string, unknown>): string[] {
  const explicit = [providerConfig.endpoints, providerConfig.endpoint]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map(stringValue)
    .filter(Boolean);
  if (explicit.length > 0) return Array.from(new Set(explicit));

  const provider = providerId.toLowerCase();
  if (provider === 'deepseek' || provider.includes('deepseek')) return ['deepseek'];
  if (provider === 'openai' || provider.includes('openai')) return ['openai'];

  // DSH's pi-ai protocol names are transport protocols, not provider ids.
  // They are only used as a conservative endpoint hint when the route name
  // itself is opaque (for example, a gateway named `boft`).
  const api = stringValue(providerConfig.api).toLowerCase();
  if (api.includes('deepseek')) return ['deepseek'];
  if (api.startsWith('openai-')) return ['openai'];
  return [];
}

function addConfiguredModel(
  target: DiscoveredModel[],
  seen: Set<string>,
  providerId: string,
  providerConfig: Record<string, unknown>,
  model: unknown,
): void {
  const endpoints = configuredProviderEndpoints(providerId, providerConfig);
  const endpoint = endpoints[0];
  if (typeof model === 'string') {
    addModel(target, seen, qualifyModelId(providerId, model), model, { source: 'config', endpoint });
    return;
  }
  if (!model || typeof model !== 'object') return;
  const record = model as Record<string, unknown>;
  const rawModelId = stringValue(record.id ?? record.modelId ?? record.value ?? record.key);
  addModel(
    target,
    seen,
    qualifyModelId(providerId, rawModelId),
    record.name ?? record.displayName ?? record.label ?? record.title ?? rawModelId,
    { source: 'config', endpoint },
  );
}

async function loadDeepseekConfiguredModels(): Promise<DiscoveredModel[]> {
  const configuredEnv = await loadConfiguredEnvObject();
  const dshHome = configuredEnv.DSH_HOME?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  try {
    const source = await readFile(`${dshHome}/settings.yaml`, 'utf8');
    const settings = parse(source);
    if (!settings || typeof settings !== 'object') return [];
    const settingMap = settings as Record<string, unknown>;
    const target: DiscoveredModel[] = [];
    const seen = new Set<string>();
    const deepseek = settingMap['llm-deepseek'];
    if (deepseek && typeof deepseek === 'object') {
      const config = deepseek as Record<string, unknown>;
      for (const model of valuesFromUnknown(config.models)) addConfiguredModel(target, seen, 'deepseek-official', config, model);
    }
    const providers = settingMap['llm-pi-ai'];
    if (!providers || typeof providers !== 'object') return [];
    const providerMap = (providers as Record<string, unknown>).providers;
    if (!providerMap || typeof providerMap !== 'object') return [];

    for (const [providerId, providerValue] of Object.entries(providerMap as Record<string, unknown>)) {
      if (!providerValue || typeof providerValue !== 'object') continue;
      const providerConfig = providerValue as Record<string, unknown>;
      const models = providerConfig.models;
      for (const model of valuesFromUnknown(models)) addConfiguredModel(target, seen, providerId, providerConfig, model);
    }
    return target;
  } catch {
    return [];
  }
}

function getDeepseekBundleModels(): DiscoveredModel[] {
  return DEEPSEEK_HARNESS_DEFAULT_MODELS.map((model) => ({
    modelId: qualifyModelId('deepseek-official', model.modelId),
    name: model.name,
    source: 'bundle',
    endpoints: ['deepseek'],
  }));
}

function normalizeDeepseekAcpModelId(modelId: string, defaultProvider?: string): string {
  const value = stringValue(modelId);
  const separator = value.indexOf('::');
  if (separator > 0) return qualifyModelId(value.slice(0, separator), value.slice(separator + 2));
  return value.includes('/') ? value : qualifyModelId(defaultProvider || 'deepseek-official', value);
}

async function loadDeepseekDefaultProvider(): Promise<string | undefined> {
  const configuredEnv = await loadConfiguredEnvObject();
  const dshHome = configuredEnv.DSH_HOME?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh');
  try {
    const settings = parse(await readFile(`${dshHome}/settings.yaml`, 'utf8'));
    const defaultModel = settings && typeof settings === 'object'
      ? (settings as Record<string, unknown>)['agent-default-model']
      : undefined;
    return defaultModel && typeof defaultModel === 'object'
      ? stringValue((defaultModel as Record<string, unknown>).provider) || undefined
      : undefined;
  } catch {
    return undefined;
  }
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
  const configuredEnv = await loadConfiguredEnvObject();
  const deepseekEnv = agentId === 'deepseek-harness'
    ? {
      ...configuredEnv,
      DSH_HOME: configuredEnv.DSH_HOME?.trim() || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'),
    }
    : undefined;

  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
  const runtime = createAcpRuntime({
    cwd,
    sessionStore: createAcpxCompatibleSessionStore(createRuntimeStore({
      stateDir: getWorkspaceDataFile('acpx-runtime'),
    })),
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
    ...(deepseekEnv ? { sessionOptions: { env: deepseekEnv } } : {}),
  });

  try {
    const status = await runtime.getStatus?.({ handle });
    const defaultProvider = agentId === 'deepseek-harness'
      ? await loadDeepseekDefaultProvider()
      : undefined;
    const discoveredModels = uniqueModels(
      extractModelsFromStatus(status).map((model) => agentId === 'deepseek-harness'
        ? { ...model, modelId: normalizeDeepseekAcpModelId(model.modelId, defaultProvider) }
        : model),
    );
    // Preserve configured routes and product defaults when the ACP agent is
    // unavailable during discovery. The OpenMA adapter normally advertises a
    // live model catalog through session configuration.
    const configuredModels = agentId === 'deepseek-harness'
      ? await loadDeepseekConfiguredModels()
      : [];
    const deepseekModels = agentId === 'deepseek-harness'
      ? uniqueModels([
        ...configuredModels,
        ...getDeepseekBundleModels(),
      ])
      : [];
    const models = uniqueModels([
      ...discoveredModels,
      ...deepseekModels,
    ]);
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
