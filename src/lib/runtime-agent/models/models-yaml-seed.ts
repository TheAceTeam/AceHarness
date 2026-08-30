import { parse, stringify } from 'yaml';
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_ENDPOINTS } from '@/lib/models/defaults';
import { parseProviderQualifiedModelId } from '@/lib/models/provider-qualified-id';
import type { RuntimeSqliteDatabase } from '../sqlite/database';
import {
  importModelRoutes,
  listModelCatalogEntries,
  listModelProviders,
  listModelRoutes,
  type ImportModelRoutesInput,
  type ImportModelRoutesResult,
} from './model-routes';

type PreRuntimeYamlModel = {
  value?: unknown;
  label?: unknown;
  costMultiplier?: unknown;
  contextWindow?: unknown;
  endpoints?: unknown;
  engines?: unknown;
};

type RuntimeYamlModel = {
  id?: unknown;
  displayName?: unknown;
  family?: unknown;
  contextWindow?: unknown;
  capabilities?: unknown;
  metadata?: unknown;
};

type RuntimeYamlProvider = {
  id?: unknown;
  kind?: unknown;
  displayName?: unknown;
  baseUrl?: unknown;
  envRequirements?: unknown;
  metadata?: unknown;
};

type RuntimeYamlRoute = {
  modelRouteId?: unknown;
  id?: unknown;
  modelId?: unknown;
  agentId?: unknown;
  runtime?: unknown;
  providerId?: unknown;
  providerModel?: unknown;
  configOptions?: unknown;
  envRequirements?: unknown;
  capabilities?: unknown;
  priority?: unknown;
  default?: unknown;
  isDefault?: unknown;
  status?: unknown;
  verifiedAt?: unknown;
};

const preRuntimeAgentIdBySourceName: Record<string, string> = {
  'claude-code': 'claude',
  'kiro-cli': 'kiro',
  codex: 'codex',
  opencode: 'opencode',
  nga: 'nga',
  codeagent: 'codeagent',
  codegenie: 'codegenie',
  'deepseek-harness': 'deepseek-harness',
  cursor: 'cursor',
  trae: 'trae',
  'cangjie-magic': 'cangjie-magic',
};

const providerKindById: Record<string, 'anthropic' | 'openai' | 'local' | 'custom'> = {
  anthropic: 'anthropic',
  openai: 'openai',
  deepseek: 'custom',
};

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

function asString(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined;
}

function asNumber(input: unknown): number | undefined {
  return typeof input === 'number' && Number.isFinite(input) ? input : undefined;
}

function contextWindowOrDefault(input: unknown): number {
  const value = asNumber(input);
  return typeof value === 'number' && value > 0 ? value : DEFAULT_MODEL_CONTEXT_WINDOW;
}

function endpointsOrDefault(input: unknown): string[] {
  if (!Array.isArray(input)) return [...DEFAULT_MODEL_ENDPOINTS];
  const endpoints = Array.from(
    new Set(asArray(input).map(normalizeProviderId).filter(Boolean) as string[]),
  );
  return endpoints;
}

function slug(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function parseProviderModel(value: string): { providerModel: string; configOptions: Record<string, unknown> } {
  const match = value.match(/^(.+?)\[(.*)]$/);
  if (!match) return { providerModel: value, configOptions: {} };

  const [, providerModel, rawOptions] = match;
  if (!rawOptions.includes('=')) return { providerModel: value, configOptions: {} };
  const configOptions: Record<string, unknown> = {};
  for (const part of rawOptions.split(',').map((item) => item.trim()).filter(Boolean)) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    const value = rawValueParts.join('=').trim();
    if (!key) continue;
    if (value === 'true') configOptions[key] = true;
    else if (value === 'false') configOptions[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) configOptions[key] = Number(value);
    else configOptions[key] = value;
  }

  return { providerModel, configOptions };
}

function normalizeProviderId(endpoint: unknown): string | undefined {
  return asString(endpoint);
}

function runtimeForAgent(agentId: string): 'acpx' | 'magic' {
  return agentId === 'cangjie-magic' ? 'magic' : 'acpx';
}

function routeId(agentId: string, modelId: string, providerId?: string): string {
  return [agentId, modelId, providerId]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .map(slug)
    .join('__');
}

export function parseModelRoutesYamlSeed(source: string, now = new Date().toISOString()): ImportModelRoutesInput {
  const parsed = asRecord(parse(source));

  if (Array.isArray(parsed.catalog) || Array.isArray(parsed.routes)) {
    return parseRuntimeYamlSeed(parsed, now);
  }

  return parsePreRuntimeModelsYamlSeed(parsed, now);
}

function parseRuntimeYamlSeed(parsed: Record<string, unknown>, now: string): ImportModelRoutesInput {
  const catalog = asArray(parsed.catalog).map((item) => {
    const model = item as RuntimeYamlModel;
    const id = asString(model.id);
    if (!id) throw new Error('Model catalog YAML entry requires id');
    return {
      id,
      displayName: asString(model.displayName) ?? id,
      family: asString(model.family),
      contextWindow: contextWindowOrDefault(model.contextWindow),
      capabilities: asRecord(model.capabilities),
      metadata: asRecord(model.metadata),
      now,
    };
  });

  const providers = asArray(parsed.providers).map((item) => {
    const provider = item as RuntimeYamlProvider;
    const id = asString(provider.id);
    if (!id) throw new Error('Model provider YAML entry requires id');
    return {
      id,
      kind: providerKindById[asString(provider.kind) ?? id] ?? 'custom',
      displayName: asString(provider.displayName) ?? id,
      baseUrl: asString(provider.baseUrl),
      envRequirements: asArray(provider.envRequirements),
      metadata: asRecord(provider.metadata),
      now,
    };
  });

  const routes = asArray(parsed.routes).map((item) => {
    const route = item as RuntimeYamlRoute;
    const id = asString(route.modelRouteId) ?? asString(route.id);
    const modelId = asString(route.modelId);
    const agentId = asString(route.agentId);
    if (!id || !modelId || !agentId) throw new Error('Model route YAML entry requires modelRouteId, modelId, and agentId');
    return {
      id,
      modelId,
      agentId,
      runtime: asString(route.runtime) === 'magic' ? 'magic' as const : 'acpx' as const,
      providerId: asString(route.providerId),
      providerModel: asString(route.providerModel) ?? modelId,
      configOptions: asRecord(route.configOptions),
      envRequirements: asArray(route.envRequirements),
      capabilities: asRecord(route.capabilities),
      priority: asNumber(route.priority),
      isDefault: Boolean(route.isDefault ?? route.default),
      status: asString(route.status) === 'inactive' || asString(route.status) === 'deprecated'
        ? asString(route.status) as 'inactive' | 'deprecated'
        : 'active' as const,
      verifiedAt: asString(route.verifiedAt),
      now,
    };
  });

  return { catalog, providers, routes };
}

function parsePreRuntimeModelsYamlSeed(parsed: Record<string, unknown>, now: string): ImportModelRoutesInput {
  const models = asArray(parsed.models) as PreRuntimeYamlModel[];
  const providerIds = new Set<string>();
  const catalog: ImportModelRoutesInput['catalog'] = [];
  const routes: ImportModelRoutesInput['routes'] = [];

  for (const model of models) {
    const modelId = asString(model.value);
    if (!modelId) continue;

    const qualified = parseProviderQualifiedModelId(modelId);
    const { providerModel: parsedProviderModel, configOptions } = parseProviderModel(qualified.modelId);
    const providerModel = parsedProviderModel;
    const qualifiedProviderId = qualified.providerId;
    const endpoints = endpointsOrDefault(model.endpoints);
    catalog.push({
      id: modelId,
      displayName: asString(model.label) ?? modelId,
      contextWindow: contextWindowOrDefault(model.contextWindow),
      metadata: {
        seedSource: 'preRuntime-models-yaml',
        costMultiplier: asNumber(model.costMultiplier),
        endpoints,
      },
      now,
    });

    if (!qualifiedProviderId) {
      for (const endpoint of endpoints) providerIds.add(endpoint);
    } else {
      providerIds.add(qualifiedProviderId);
    }

    const providerChoices = qualifiedProviderId ? [qualifiedProviderId] : (endpoints.length > 0 ? endpoints : [undefined]);
    const agentIds = asArray(model.engines)
      .map(asString)
      .filter(Boolean)
      .map((sourceName) => preRuntimeAgentIdBySourceName[sourceName!] ?? sourceName!)
      .filter((agentId, index, all) => all.indexOf(agentId) === index);

    for (const agentId of agentIds) {
      providerChoices.forEach((providerId, index) => {
        routes.push({
          id: routeId(agentId, modelId, providerId),
          modelId,
          agentId,
          runtime: runtimeForAgent(agentId),
          providerId,
          providerModel,
          configOptions,
          capabilities: {},
          priority: index + 100,
          isDefault: index === 0,
          status: 'active',
          now,
        });
      });
    }
  }

  const providers = Array.from(providerIds).sort().map((id) => ({
    id,
    kind: providerKindById[id] ?? 'custom' as const,
    displayName: id,
    now,
  }));

  return { catalog, providers, routes };
}

export function importModelRoutesYamlSeed(
  db: RuntimeSqliteDatabase,
  source: string,
  now?: string,
): ImportModelRoutesResult {
  return importModelRoutes(db, parseModelRoutesYamlSeed(source, now));
}

export function exportModelRoutesYamlSeed(db: RuntimeSqliteDatabase): string {
  const catalog = listModelCatalogEntries(db).map((model) => ({
    id: model.id,
    displayName: model.displayName,
    family: model.family,
    contextWindow: model.contextWindow,
    capabilities: model.capabilities ?? {},
    metadata: model.metadata ?? {},
  }));
  const providers = listModelProviders(db).map((provider) => ({
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName,
    baseUrl: provider.baseUrl,
    envRequirements: provider.envRequirements ?? [],
    metadata: provider.metadata ?? {},
  }));
  const routes = listModelRoutes(db).map((route) => ({
    modelRouteId: route.id,
    modelId: route.modelId,
    agentId: route.agentId,
    runtime: route.runtime,
    providerId: route.providerId,
    providerModel: route.providerModel,
    configOptions: route.configOptions ?? {},
    envRequirements: route.envRequirements ?? [],
    capabilities: route.capabilities ?? {},
    priority: route.priority,
    isDefault: route.isDefault,
    status: route.status,
    verifiedAt: route.verifiedAt,
  }));

  return stringify({ catalog, providers, routes });
}
