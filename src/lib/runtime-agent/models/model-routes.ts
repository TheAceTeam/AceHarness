import type { RuntimeAdapterKind, RuntimeCapabilities } from '../contracts';
import type { RuntimeSqliteDatabase } from '../sqlite/database';
import { withImmediateTransaction } from '../sqlite/database';
import { ensureModelRouteSchema, type ModelCatalogEntry, type ModelProviderEntry, type ModelRouteEntry } from './model-route-schema';

export interface UpsertModelCatalogInput {
  id: string;
  displayName: string;
  family?: string;
  contextWindow?: number;
  capabilities?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  now?: string;
}

export interface UpsertModelProviderInput {
  id: string;
  kind: ModelProviderEntry['kind'];
  displayName: string;
  baseUrl?: string;
  envRequirements?: unknown[];
  metadata?: Record<string, unknown>;
  now?: string;
}

export interface UpsertModelRouteInput {
  id: string;
  modelId: string;
  agentId: string;
  runtime?: RuntimeAdapterKind;
  providerId?: string;
  providerModel: string;
  configOptions?: Record<string, unknown>;
  envRequirements?: unknown[];
  capabilities?: Record<string, unknown>;
  priority?: number;
  isDefault?: boolean;
  status?: ModelRouteEntry['status'];
  verifiedAt?: string;
  now?: string;
}

export interface ResolveModelRouteInput {
  modelRouteId?: string;
  agentId?: string;
  modelId?: string;
}

export interface ResolvedModelRouteRecord {
  modelRouteId: string;
  modelId: string;
  modelDisplayName: string;
  agentId: string;
  runtime: RuntimeAdapterKind;
  providerId?: string;
  providerModel: string;
  configOptions: Record<string, unknown>;
  envRequirements: unknown[];
  capabilities: Record<string, unknown>;
  priority: number;
  isDefault: boolean;
  verifiedAt?: string;
}

type JsonObject = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

function toJson(input: unknown): string {
  return JSON.stringify(input ?? null);
}

function parseJson<T>(input: unknown, fallback: T): T {
  if (typeof input !== 'string' || input.length === 0) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function optionalString(input: unknown): string | undefined {
  return typeof input === 'string' && input.length > 0 ? input : undefined;
}

function routeFromRow(row: any): ModelRouteEntry {
  return {
    id: String(row.id),
    modelId: String(row.model_id),
    agentId: String(row.agent_id),
    runtime: row.runtime as RuntimeAdapterKind,
    providerId: optionalString(row.provider_id),
    providerModel: String(row.provider_model),
    configOptions: parseJson<JsonObject>(row.config_options_json, {}),
    envRequirements: parseJson<unknown[]>(row.env_requirements_json, []),
    capabilities: parseJson<JsonObject>(row.capabilities_json, {}),
    priority: Number(row.priority),
    isDefault: Number(row.is_default) === 1,
    status: row.status,
    verifiedAt: optionalString(row.verified_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function resolvedRouteFromRow(row: any): ResolvedModelRouteRecord {
  return {
    modelRouteId: String(row.id),
    modelId: String(row.model_id),
    modelDisplayName: String(row.display_name),
    agentId: String(row.agent_id),
    runtime: row.runtime as RuntimeAdapterKind,
    providerId: optionalString(row.provider_id),
    providerModel: String(row.provider_model),
    configOptions: parseJson<JsonObject>(row.config_options_json, {}),
    envRequirements: parseJson<unknown[]>(row.env_requirements_json, []),
    capabilities: parseJson<JsonObject>(row.capabilities_json, {}),
    priority: Number(row.priority),
    isDefault: Number(row.is_default) === 1,
    verifiedAt: optionalString(row.verified_at),
  };
}

export function upsertModelCatalogEntry(db: RuntimeSqliteDatabase, input: UpsertModelCatalogInput): ModelCatalogEntry {
  ensureModelRouteSchema(db);
  const now = input.now ?? nowIso();
  db.prepare(`
    INSERT INTO model_catalog (
      id, display_name, family, context_window, capabilities_json, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      family = excluded.family,
      context_window = excluded.context_window,
      capabilities_json = excluded.capabilities_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    input.id,
    input.displayName,
    input.family ?? null,
    input.contextWindow ?? null,
    toJson(input.capabilities ?? {}),
    toJson(input.metadata ?? {}),
    now,
    now,
  );

  const row = db.prepare('SELECT * FROM model_catalog WHERE id = ?').get(input.id) as any;
  return {
    id: String(row.id),
    displayName: String(row.display_name),
    family: optionalString(row.family),
    contextWindow: typeof row.context_window === 'number' ? row.context_window : undefined,
    capabilities: parseJson<JsonObject>(row.capabilities_json, {}),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function upsertModelProvider(db: RuntimeSqliteDatabase, input: UpsertModelProviderInput): ModelProviderEntry {
  ensureModelRouteSchema(db);
  const now = input.now ?? nowIso();
  db.prepare(`
    INSERT INTO model_providers (
      id, kind, display_name, base_url, env_requirements_json, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      display_name = excluded.display_name,
      base_url = excluded.base_url,
      env_requirements_json = excluded.env_requirements_json,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `).run(
    input.id,
    input.kind,
    input.displayName,
    input.baseUrl ?? null,
    toJson(input.envRequirements ?? []),
    toJson(input.metadata ?? {}),
    now,
    now,
  );

  const row = db.prepare('SELECT * FROM model_providers WHERE id = ?').get(input.id) as any;
  return {
    id: String(row.id),
    kind: row.kind,
    displayName: String(row.display_name),
    baseUrl: optionalString(row.base_url),
    envRequirements: parseJson<unknown[]>(row.env_requirements_json, []),
    metadata: parseJson<JsonObject>(row.metadata_json, {}),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function upsertModelRoute(db: RuntimeSqliteDatabase, input: UpsertModelRouteInput): ModelRouteEntry {
  ensureModelRouteSchema(db);
  const now = input.now ?? nowIso();
  db.prepare(`
    INSERT INTO model_routes (
      id, model_id, agent_id, runtime, provider_id, provider_model, config_options_json,
      env_requirements_json, capabilities_json, priority, is_default, status, verified_at, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      model_id = excluded.model_id,
      agent_id = excluded.agent_id,
      runtime = excluded.runtime,
      provider_id = excluded.provider_id,
      provider_model = excluded.provider_model,
      config_options_json = excluded.config_options_json,
      env_requirements_json = excluded.env_requirements_json,
      capabilities_json = excluded.capabilities_json,
      priority = excluded.priority,
      is_default = excluded.is_default,
      status = excluded.status,
      verified_at = excluded.verified_at,
      updated_at = excluded.updated_at
  `).run(
    input.id,
    input.modelId,
    input.agentId,
    input.runtime ?? 'acpx',
    input.providerId ?? null,
    input.providerModel,
    toJson(input.configOptions ?? {}),
    toJson(input.envRequirements ?? []),
    toJson(input.capabilities ?? {}),
    input.priority ?? 100,
    input.isDefault ? 1 : 0,
    input.status ?? 'active',
    input.verifiedAt ?? null,
    now,
    now,
  );

  return routeFromRow(db.prepare('SELECT * FROM model_routes WHERE id = ?').get(input.id));
}

export function resolveModelRoute(db: RuntimeSqliteDatabase, input: ResolveModelRouteInput): ResolvedModelRouteRecord {
  ensureModelRouteSchema(db);

  if (input.modelRouteId) {
    const explicit = db.prepare(`
      SELECT route.*, catalog.display_name
      FROM model_routes AS route
      JOIN model_catalog AS catalog ON catalog.id = route.model_id
      WHERE route.id = ? AND route.status = 'active'
    `).get(input.modelRouteId);
    if (!explicit) throw new Error(`Active model route not found: ${input.modelRouteId}`);
    return resolvedRouteFromRow(explicit);
  }

  // 新增：fallback - 有 agentId 但没有 modelId/modelRouteId 时，取第一个可用路由
  if (input.agentId && !input.modelId && !input.modelRouteId) {
    const fallbackRow = db.prepare(`
      SELECT route.*, catalog.display_name
      FROM model_routes AS route
      JOIN model_catalog AS catalog ON catalog.id = route.model_id
      WHERE route.agent_id = ?
        AND route.status = 'active'
      ORDER BY
        route.is_default DESC,
        route.priority ASC,
        CASE WHEN route.verified_at IS NULL THEN 1 ELSE 0 END ASC,
        route.verified_at DESC,
        route.id ASC
      LIMIT 1
    `).get(input.agentId);

    if (!fallbackRow) throw new Error(`No active model route for agentId=${input.agentId}`);
    return resolvedRouteFromRow(fallbackRow);
  }

  // 原来的错误检查（保持不变）
  if (!input.agentId || !input.modelId) {
    throw new Error('resolveModelRoute requires modelRouteId or agentId + modelId');
  }  

  const row = db.prepare(`
    SELECT route.*, catalog.display_name
    FROM model_routes AS route
    JOIN model_catalog AS catalog ON catalog.id = route.model_id
    WHERE route.agent_id = ?
      AND route.model_id = ?
      AND route.status = 'active'
    ORDER BY
      route.is_default DESC,
      route.priority ASC,
      CASE WHEN route.verified_at IS NULL THEN 1 ELSE 0 END ASC,
      route.verified_at DESC,
      route.id ASC
    LIMIT 1
  `).get(input.agentId, input.modelId);

  if (!row) throw new Error(`No active model route for agentId=${input.agentId} modelId=${input.modelId}`);
  return resolvedRouteFromRow(row);
}

export function listModelRoutes(db: RuntimeSqliteDatabase): ModelRouteEntry[] {
  ensureModelRouteSchema(db);
  return db.prepare('SELECT * FROM model_routes ORDER BY agent_id ASC, model_id ASC, priority ASC, id ASC')
    .all()
    .map(routeFromRow);
}

export function listModelCatalogEntries(db: RuntimeSqliteDatabase): ModelCatalogEntry[] {
  ensureModelRouteSchema(db);
  return db.prepare('SELECT * FROM model_catalog ORDER BY id ASC')
    .all()
    .map((row: any) => ({
      id: String(row.id),
      displayName: String(row.display_name),
      family: optionalString(row.family),
      contextWindow: typeof row.context_window === 'number' ? row.context_window : undefined,
      capabilities: parseJson<JsonObject>(row.capabilities_json, {}),
      metadata: parseJson<JsonObject>(row.metadata_json, {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
}

export function listModelProviders(db: RuntimeSqliteDatabase): ModelProviderEntry[] {
  ensureModelRouteSchema(db);
  return db.prepare('SELECT * FROM model_providers ORDER BY id ASC')
    .all()
    .map((row: any) => ({
      id: String(row.id),
      kind: row.kind,
      displayName: String(row.display_name),
      baseUrl: optionalString(row.base_url),
      envRequirements: parseJson<unknown[]>(row.env_requirements_json, []),
      metadata: parseJson<JsonObject>(row.metadata_json, {}),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
}

export interface ImportModelRoutesInput {
  catalog: UpsertModelCatalogInput[];
  providers?: UpsertModelProviderInput[];
  routes: UpsertModelRouteInput[];
}

export interface ImportModelRoutesResult {
  catalogCount: number;
  providerCount: number;
  routeCount: number;
}

export function importModelRoutes(db: RuntimeSqliteDatabase, input: ImportModelRoutesInput): ImportModelRoutesResult {
  ensureModelRouteSchema(db);
  return withImmediateTransaction(db, () => {
    for (const provider of input.providers ?? []) upsertModelProvider(db, provider);
    for (const model of input.catalog) upsertModelCatalogEntry(db, model);
    for (const route of input.routes) upsertModelRoute(db, route);

    return {
      catalogCount: input.catalog.length,
      providerCount: input.providers?.length ?? 0,
      routeCount: input.routes.length,
    };
  });
}

export function replaceModelRoutes(db: RuntimeSqliteDatabase, input: ImportModelRoutesInput): ImportModelRoutesResult {
  ensureModelRouteSchema(db);
  return withImmediateTransaction(db, () => {
    db.prepare('DELETE FROM model_routes').run();
    db.prepare('DELETE FROM model_pricing').run();
    db.prepare('DELETE FROM model_catalog').run();
    db.prepare('DELETE FROM model_providers').run();

    for (const provider of input.providers ?? []) upsertModelProvider(db, provider);
    for (const model of input.catalog) upsertModelCatalogEntry(db, model);
    for (const route of input.routes) upsertModelRoute(db, route);

    return {
      catalogCount: input.catalog.length,
      providerCount: input.providers?.length ?? 0,
      routeCount: input.routes.length,
    };
  });
}

export function capabilitiesForResolvedRoute(route: ResolvedModelRouteRecord): RuntimeCapabilities {
  return {
    streaming: route.capabilities.streaming !== false,
    cancel: route.capabilities.cancel !== false,
    commands: Boolean(route.capabilities.commands),
    compact: Boolean(route.capabilities.compact),
    fork: Boolean(route.capabilities.fork),
    handoff: Boolean(route.capabilities.handoff),
    permissions: route.capabilities.permissions !== false,
    toolCalls: route.capabilities.toolCalls !== false,
    usage: typeof route.capabilities.usage === 'string'
      ? route.capabilities.usage as RuntimeCapabilities['usage']
      : 'missing',
    models: [route.modelId],
    metadata: route.capabilities,
  };
}
