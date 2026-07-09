import fs from 'fs/promises';
import { stringify } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { clearModelsCache, normalizeModelOptions, type ModelOption } from '@/lib/core/models';
import { DEFAULT_MODEL_CONTEXT_WINDOW, DEFAULT_MODEL_ENDPOINTS } from '@/lib/models/defaults';
import { getRuntimeModelsConfigPath } from '@/lib/run/runtime-configs';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '../sqlite/database';
import { ensureModelRouteSchema } from './model-route-schema';
import {
  listModelCatalogEntries,
  listModelRoutes,
  replaceModelRoutes,
  resolveModelRoute,
  type ImportModelRoutesResult,
  type ResolvedModelRouteRecord,
} from './model-routes';
import { exportModelRoutesYamlSeed, parseModelRoutesYamlSeed } from './models-yaml-seed';

export interface RuntimeModelRouteDto extends ModelOption {
  modelRouteId: string | null;
  modelId: string;
  agentId: string | null;
  provider: string | null;
  providerModel: string | null;
  runtime: 'acpx' | 'magic' | null;
  isDefault: boolean;
  priority: number | null;
}

export interface RuntimeModelsApiDto {
  models: RuntimeModelRouteDto[];
  routes: RuntimeModelRouteDto[];
  yamlSeed: string;
}

function openModelsDatabase(): RuntimeSqliteDatabase {
  const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
  ensureModelRouteSchema(db);
  return db;
}

function optionalTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolveRuntimeModelRoute(input: {
  modelRouteId?: string;
  agentId?: string;
  modelId?: string;
}): ResolvedModelRouteRecord | null {
  const modelRouteId = optionalTrimmedString(input.modelRouteId);
  const agentId = optionalTrimmedString(input.agentId);
  const modelId = optionalTrimmedString(input.modelId);
  if (!modelRouteId && (!agentId || !modelId)) return null;

  const db = openModelsDatabase();
  try {
    try {
      return resolveModelRoute(db, modelRouteId
        ? { modelRouteId }
        : { agentId, modelId });
    } catch (error) {
      if (modelRouteId) throw error;
      return null;
    }
  } finally {
    db.close();
  }
}

function costMultiplierFromMetadata(metadata?: Record<string, unknown>): number {
  const value = metadata?.costMultiplier;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

function contextWindowOrDefault(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_MODEL_CONTEXT_WINDOW;
}

function toRouteDtos(db: RuntimeSqliteDatabase): RuntimeModelRouteDto[] {
  const catalog = listModelCatalogEntries(db);
  const catalogById = new Map(catalog.map((model) => [model.id, model]));
  const routes = listModelRoutes(db);
  return routes.map((route) => {
    const model = catalogById.get(route.modelId);
    return {
      value: route.modelId,
      label: model?.displayName ?? route.modelId,
      costMultiplier: costMultiplierFromMetadata(model?.metadata),
      endpoints: route.providerId ? [route.providerId] : [],
      engines: [route.agentId],
      contextWindow: contextWindowOrDefault(model?.contextWindow),
      status: route.status === 'active' ? 'active' as const : 'inactive' as const,
      createdAt: route.createdAt,
      updatedAt: route.updatedAt,
      modelRouteId: route.id,
      modelId: route.modelId,
      agentId: route.agentId,
      provider: route.providerId ?? null,
      providerModel: route.providerModel,
      runtime: route.runtime,
      isDefault: route.isDefault,
      priority: route.priority,
    };
  });
}

function toModelDtos(db: RuntimeSqliteDatabase): RuntimeModelRouteDto[] {
  const catalog = listModelCatalogEntries(db);
  const routes = listModelRoutes(db);
  const routesByModelId = new Map<string, ReturnType<typeof listModelRoutes>>();
  for (const route of routes) {
    const group = routesByModelId.get(route.modelId) || [];
    group.push(route);
    routesByModelId.set(route.modelId, group);
  }

  const modelDtos = catalog
    .filter((model) => routesByModelId.has(model.id))
    .map((model) => {
      const modelRoutes = routesByModelId.get(model.id) || [];
      const defaultRoute = modelRoutes.find((route) => route.isDefault) || modelRoutes[0];
      return {
        value: model.id,
        label: model.displayName,
        costMultiplier: costMultiplierFromMetadata(model.metadata),
        endpoints: Array.from(new Set(modelRoutes.map((route) => route.providerId).filter((endpoint): endpoint is string => Boolean(endpoint)))),
        engines: Array.from(new Set(modelRoutes.map((route) => route.agentId).filter(Boolean))),
        contextWindow: contextWindowOrDefault(model.contextWindow),
        status: modelRoutes.some((route) => route.status === 'active') ? 'active' as const : 'inactive' as const,
        createdAt: model.createdAt,
        updatedAt: model.updatedAt,
        modelRouteId: defaultRoute?.id ?? null,
        modelId: model.id,
        agentId: defaultRoute?.agentId ?? null,
        provider: defaultRoute?.providerId ?? null,
        providerModel: defaultRoute?.providerModel ?? null,
        runtime: defaultRoute?.runtime ?? null,
        isDefault: modelRoutes.some((route) => route.isDefault),
        priority: defaultRoute?.priority ?? null,
      };
    });

  const routedModelIds = new Set(routes.map((route) => route.modelId));
  const catalogOnlyDtos = catalog
    .filter((model) => !routedModelIds.has(model.id))
    .map((model) => ({
      value: model.id,
      label: model.displayName,
      costMultiplier: costMultiplierFromMetadata(model.metadata),
      endpoints: [...DEFAULT_MODEL_ENDPOINTS],
      engines: [],
      contextWindow: contextWindowOrDefault(model.contextWindow),
      status: 'active' as const,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
      modelRouteId: null,
      modelId: model.id,
      agentId: null,
      provider: null,
      providerModel: null,
      runtime: null,
      isDefault: false,
      priority: null,
    }));

  return [...modelDtos, ...catalogOnlyDtos];
}

export function listRuntimeModelsFromSqlite(): RuntimeModelsApiDto {
  const db = openModelsDatabase();
  try {
    const models = toModelDtos(db);
    const routes = toRouteDtos(db);
    return {
      models,
      routes,
      yamlSeed: exportModelRoutesYamlSeed(db),
    };
  } finally {
    db.close();
  }
}

export async function replaceRuntimeModelsFromApiInput(modelsInput: unknown): Promise<ImportModelRoutesResult> {
  const models = normalizeModelOptions(modelsInput);
  const now = new Date().toISOString();
  const seed = parseModelRoutesYamlSeed(stringify({ models }, { lineWidth: 0 }), now);
  const db = openModelsDatabase();
  try {
    const result = replaceModelRoutes(db, seed);
    await fs.writeFile(await getRuntimeModelsConfigPath(), exportModelRoutesYamlSeed(db), 'utf-8');
    clearModelsCache();
    return result;
  } finally {
    db.close();
  }
}
