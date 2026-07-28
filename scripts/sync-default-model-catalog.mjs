import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { parse } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function resolveWorkspaceRoot() {
  if (process.env.ACE_HOME?.trim()) return path.resolve(process.env.ACE_HOME.trim());
  if (process.platform === 'win32' && process.env.APPDATA?.trim()) {
    return path.resolve(process.env.APPDATA.trim(), 'ACEHarness');
  }
  if (process.env.XDG_DATA_HOME?.trim()) return path.resolve(process.env.XDG_DATA_HOME.trim(), 'aceharness');
  return path.resolve(process.env.HOME || process.cwd(), '.aceharness');
}

function ensureSchema(db) {
  db.pragma('journal_mode = WAL');
  db.exec(`
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
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_providers (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      display_name TEXT NOT NULL,
      base_url TEXT,
      env_requirements_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
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
      FOREIGN KEY(model_id) REFERENCES model_catalog(id) ON DELETE CASCADE
    );
  `);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function slug(input) {
  return String(input).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model';
}

function parseProviderModel(value) {
  const match = String(value).match(/^(.+?)\[(.*)]$/);
  if (!match) return { providerModel: value, configOptions: {} };

  const [, providerModel, rawOptions] = match;
  const configOptions = {};
  for (const part of rawOptions.split(',').map((item) => item.trim()).filter(Boolean)) {
    const [rawKey, ...rawValueParts] = part.split('=');
    const key = rawKey?.trim();
    const rawValue = rawValueParts.join('=').trim();
    if (!key) continue;
    if (rawValue === 'true') configOptions[key] = true;
    else if (rawValue === 'false') configOptions[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(rawValue)) configOptions[key] = Number(rawValue);
    else configOptions[key] = rawValue;
  }

  return { providerModel, configOptions };
}

function normalizeAgentId(engine) {
  if (engine === 'claude-code') return 'claude';
  if (engine === 'kiro-cli') return 'kiro';
  if (engine === 'magic-cli') return 'cangjie-magic';
  return engine;
}

function runtimeForAgent(agentId) {
  return agentId === 'cangjie-magic' ? 'magic' : 'acpx';
}

function providerKind(providerId) {
  if (providerId === 'anthropic' || providerId === 'openai') return providerId;
  return 'custom';
}

function routeId(agentId, modelId, providerId) {
  return [agentId, modelId, providerId].filter(Boolean).map(slug).join('__');
}

function readCatalogModels() {
  const seedPath = path.join(repoRoot, 'configs', 'models', 'models.yaml');
  const parsed = parse(fs.readFileSync(seedPath, 'utf8')) || {};
  return asArray(parsed.models)
    .map((model) => ({
      id: asString(model?.value),
      displayName: asString(model?.label),
      costMultiplier: asNumber(model?.costMultiplier),
      endpoints: asArray(model?.endpoints).map(asString).filter(Boolean),
      engines: asArray(model?.engines).map(asString).filter(Boolean),
    }))
    .filter((model) => model.id);
}

const workspaceRoot = resolveWorkspaceRoot();
const dbPath = path.join(workspaceRoot, 'data', 'runtime-agent.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath, { timeout: 5000 });
try {
  ensureSchema(db);
  const before = new Set(db.prepare('SELECT id FROM model_catalog').all().map((row) => String(row.id)));
  const now = new Date().toISOString();
  const bundledModelIds = new Set(
    db.prepare(`
      SELECT id, metadata_json
      FROM model_catalog
    `).all()
      .filter((row) => {
        try {
          const metadata = JSON.parse(String(row.metadata_json || '{}'));
          return metadata?.seedSource === 'bundled-models-yaml';
        } catch {
          return false;
        }
      })
      .map((row) => String(row.id)),
  );
  const upsert = db.prepare(`
    INSERT INTO model_catalog (
      id, display_name, family, context_window, capabilities_json, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = excluded.display_name,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const upsertRoute = db.prepare(`
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
  `);
  const upsertProvider = db.prepare(`
    INSERT INTO model_providers (
      id, kind, display_name, base_url, env_requirements_json, metadata_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      display_name = excluded.display_name,
      updated_at = excluded.updated_at
  `);

  const models = readCatalogModels();
  const seedModelIds = new Set(models.map((model) => model.id));
  const tx = db.transaction(() => {
    for (const modelId of bundledModelIds) {
      if (seedModelIds.has(modelId)) continue;
      db.prepare('DELETE FROM model_routes WHERE model_id = ?').run(modelId);
      db.prepare('DELETE FROM model_catalog WHERE id = ?').run(modelId);
    }

    for (const model of models) {
      upsert.run(
        model.id,
        model.displayName || model.id,
        null,
        null,
        '{}',
        JSON.stringify({
          seedSource: 'bundled-models-yaml',
          costMultiplier: model.costMultiplier,
          endpoints: model.endpoints,
        }),
        now,
        now,
      );

      const { providerModel, configOptions } = parseProviderModel(model.id);
      const endpoints = model.endpoints.length > 0 ? model.endpoints : [undefined];
      for (const endpoint of endpoints) {
        if (!endpoint) continue;
        upsertProvider.run(endpoint, providerKind(endpoint), endpoint, null, '[]', '{}', now, now);
      }
      const agentIds = Array.from(new Set(model.engines.map(normalizeAgentId).filter(Boolean)));
      for (const agentId of agentIds) {
        endpoints.forEach((providerId, index) => {
          const id = routeId(agentId, model.id, providerId);
          upsertRoute.run(
            id,
            model.id,
            agentId,
            runtimeForAgent(agentId),
            providerId ?? null,
            providerModel,
            JSON.stringify(configOptions),
            '[]',
            '{}',
            index + 100,
            index === 0 ? 1 : 0,
            'active',
            null,
            now,
            now,
          );
        });
      }
    }
  });
  tx();

  const after = db.prepare('SELECT id FROM model_catalog ORDER BY id ASC').all().map((row) => String(row.id));
  const added = after.filter((id) => !before.has(id));
  const removed = Array.from(bundledModelIds).filter((id) => !seedModelIds.has(id));
  console.log(JSON.stringify({
    database: dbPath,
    inputCatalog: models.length,
    added,
    removed,
    totalCatalog: after.length,
  }, null, 2));
} finally {
  db.close();
}
