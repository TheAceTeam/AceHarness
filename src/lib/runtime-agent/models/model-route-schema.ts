import type { RuntimeSqliteDatabase } from '../sqlite/database';

export type ModelProviderKind = 'anthropic' | 'openai' | 'local' | 'custom';

export type ModelRouteStatus = 'active' | 'inactive' | 'deprecated';

export interface ModelCatalogEntry {
  id: string;
  displayName: string;
  family?: string;
  contextWindow?: number;
  capabilities?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModelProviderEntry {
  id: string;
  kind: ModelProviderKind;
  displayName: string;
  baseUrl?: string;
  envRequirements?: unknown[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRouteEntry {
  id: string;
  modelId: string;
  agentId: string;
  runtime: 'acpx' | 'magic';
  providerId?: string;
  providerModel: string;
  configOptions?: Record<string, unknown>;
  envRequirements?: unknown[];
  capabilities?: Record<string, unknown>;
  priority: number;
  isDefault: boolean;
  status: ModelRouteStatus;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelPricingEntry {
  id: string;
  modelId: string;
  providerId?: string;
  inputUsdPerMillion?: number;
  outputUsdPerMillion?: number;
  costMultiplier?: number;
  currency: string;
  effectiveAt: string;
  metadata?: Record<string, unknown>;
}

export interface ModelDiscoveryCacheEntry {
  id: string;
  agentId: string;
  providerId?: string;
  payload?: unknown;
  discoveredAt: string;
  expiresAt?: string;
}

export const MODEL_ROUTES_SQLITE_SCHEMA = `
CREATE TABLE IF NOT EXISTS model_catalog (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  family TEXT,
  context_window INTEGER,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(context_window IS NULL OR context_window > 0)
);

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  display_name TEXT NOT NULL,
  base_url TEXT,
  env_requirements_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(kind IN ('anthropic','openai','local','custom'))
);

CREATE TABLE IF NOT EXISTS model_routes (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  runtime TEXT NOT NULL,
  provider_id TEXT,
  provider_model TEXT NOT NULL,
  config_options_json TEXT NOT NULL DEFAULT '{}',
  env_requirements_json TEXT NOT NULL DEFAULT '[]',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  is_default INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(model_id) REFERENCES model_catalog(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES model_providers(id) ON DELETE SET NULL,
  CHECK(runtime IN ('acpx','magic')),
  CHECK(is_default IN (0,1)),
  CHECK(status IN ('active','inactive','deprecated'))
);

CREATE TABLE IF NOT EXISTS model_pricing (
  id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  provider_id TEXT,
  input_usd_per_million REAL,
  output_usd_per_million REAL,
  cost_multiplier REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(model_id) REFERENCES model_catalog(id) ON DELETE CASCADE,
  FOREIGN KEY(provider_id) REFERENCES model_providers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS model_discovery_cache (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  provider_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  discovered_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY(provider_id) REFERENCES model_providers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_model_routes_agent_model_active
  ON model_routes(agent_id, model_id, status, is_default, priority, verified_at, id);
CREATE INDEX IF NOT EXISTS idx_model_routes_model
  ON model_routes(model_id);
CREATE INDEX IF NOT EXISTS idx_model_pricing_model_provider_effective
  ON model_pricing(model_id, provider_id, effective_at);
CREATE INDEX IF NOT EXISTS idx_model_discovery_cache_agent_provider
  ON model_discovery_cache(agent_id, provider_id, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_routes_one_default_per_agent_model
  ON model_routes(agent_id, model_id)
  WHERE status = 'active' AND is_default = 1;
`;

function existingTableColumns(db: RuntimeSqliteDatabase, table: string): string[] {
  return (db.pragma(`table_info(${table})`) as Array<{ name?: string }>)
    .map((column) => String(column.name ?? ''))
    .filter(Boolean);
}

function addColumnIfMissing(
  db: RuntimeSqliteDatabase,
  columns: Set<string>,
  table: string,
  column: string,
  definition: string,
): void {
  if (columns.has(column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  columns.add(column);
}

export function ensureModelRouteSchema(db: RuntimeSqliteDatabase): void {
  const routeColumns = existingTableColumns(db, 'model_routes');
  if (routeColumns.length > 0 && !routeColumns.includes('model_id')) {
    const columns = new Set(routeColumns);
    addColumnIfMissing(db, columns, 'model_routes', 'model_id', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, columns, 'model_routes', 'agent_id', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, columns, 'model_routes', 'runtime', "TEXT NOT NULL DEFAULT 'acpx'");
    addColumnIfMissing(db, columns, 'model_routes', 'provider_id', 'TEXT');
    addColumnIfMissing(db, columns, 'model_routes', 'provider_model', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, columns, 'model_routes', 'config_options_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, columns, 'model_routes', 'env_requirements_json', "TEXT NOT NULL DEFAULT '[]'");
    addColumnIfMissing(db, columns, 'model_routes', 'capabilities_json', "TEXT NOT NULL DEFAULT '{}'");
    addColumnIfMissing(db, columns, 'model_routes', 'priority', 'INTEGER NOT NULL DEFAULT 100');
    addColumnIfMissing(db, columns, 'model_routes', 'is_default', 'INTEGER NOT NULL DEFAULT 0');
    addColumnIfMissing(db, columns, 'model_routes', 'status', "TEXT NOT NULL DEFAULT 'active'");
    addColumnIfMissing(db, columns, 'model_routes', 'verified_at', 'TEXT');
    addColumnIfMissing(db, columns, 'model_routes', 'created_at', "TEXT NOT NULL DEFAULT ''");
    addColumnIfMissing(db, columns, 'model_routes', 'updated_at', "TEXT NOT NULL DEFAULT ''");
  }

  db.exec(MODEL_ROUTES_SQLITE_SCHEMA);
}
