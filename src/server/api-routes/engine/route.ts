import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getEngineConfigPath, getWorkspaceAgentConfigDir, getWorkspaceRoot } from '@/lib/core/app-paths';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

const ENGINE_CONFIG_FILE = getEngineConfigPath();
const migrationOnlyHeaders = {
  headers: {
    'x-ace-migration-only': 'pre-runtime-engine-api',
  },
};

type EngineRuntime = 'js' | 'cangjie' | 'auto';

interface CangjieRuntimeLibraryConfig {
  name?: string;
  path?: string;
  initJson?: string;
}

interface CangjieRuntimeConfig {
  enabled?: boolean;
  fallbackToJs?: boolean;
  library?: CangjieRuntimeLibraryConfig;
  engines?: Partial<Record<string, EngineRuntime>>;
}

interface EngineConfig {
  engine: string;
  defaultModel?: string;
  engineRuntime?: EngineRuntime;
  cangjieRuntime?: CangjieRuntimeConfig;
  updatedAt: string;
}

function normalizeEngineRuntime(value?: string | null): EngineRuntime | undefined {
  if (value === 'js' || value === 'cangjie' || value === 'auto') return value;
  return undefined;
}

function stripDriverConfig(config: Record<string, any>): Partial<EngineConfig> {
  const { driver: _driver, drivers: _drivers, ...rest } = config;
  return rest;
}

export async function GET() {
  try {
    // Migration-only endpoint. New runtime code must use runtime/agent APIs.
    const exists = await fs.access(ENGINE_CONFIG_FILE).then(() => true).catch(() => false);

    if (!exists) {
      return jsonOk({ engine: '', defaultModel: '', migrationOnly: true }, migrationOnlyHeaders);
    }

    const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
    const config = stripDriverConfig(JSON.parse(content));

    return jsonOk({
      engine: config.engine,
      defaultModel: config.defaultModel || '',
      engineRuntime: normalizeEngineRuntime(config.engineRuntime) || 'auto',
      cangjieRuntime: config.cangjieRuntime || {},
      migrationOnly: true,
    }, migrationOnlyHeaders);
  } catch (error) {
    console.error('Failed to read engine config:', error);
    return jsonOk({ engine: '', defaultModel: '', engineRuntime: 'auto', cangjieRuntime: {}, migrationOnly: true }, migrationOnlyHeaders);
  }
}

export async function POST(request: Request) {
  try {
    // Migration-only endpoint. New runtime code must not persist pre-runtime driver config here.
    const body = await readJsonBody<Record<string, any>>(request, {});
    const { engine, defaultModel, engineRuntime, cangjieRuntime } = body;
    const ignoredFields = ['driver', 'drivers'].filter((field) => Object.prototype.hasOwnProperty.call(body, field));

    // Read existing config to preserve fields
    let existing: Partial<EngineConfig> = {};
    try {
      const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
      existing = stripDriverConfig(JSON.parse(content));
    } catch { /* new file */ }

    const nextEngine = String(engine || existing.engine || '').trim();
    if (!nextEngine) {
      return jsonError('Engine is required', 400);
    }

    const config: EngineConfig = {
      ...existing,
      engine: nextEngine,
      updatedAt: new Date().toISOString(),
    };
    // Only update defaultModel if explicitly provided
    if (defaultModel !== undefined) {
      config.defaultModel = defaultModel;
    }
    if (engineRuntime !== undefined) {
      const normalizedRuntime = normalizeEngineRuntime(engineRuntime);
      if (!normalizedRuntime) {
        return jsonError('Invalid engineRuntime', 400);
      }
      config.engineRuntime = normalizedRuntime;
    }
    if (cangjieRuntime !== undefined) {
      if (!cangjieRuntime || typeof cangjieRuntime !== 'object' || Array.isArray(cangjieRuntime)) {
        return jsonError('Invalid cangjieRuntime', 400);
      }
      config.cangjieRuntime = cangjieRuntime as CangjieRuntimeConfig;
    }

    await fs.writeFile(ENGINE_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    // Create the shared engine config dir. Skills are linked per chat request
    // based on the enabled skill list, not as a full runtime directory mirror.
    try {
      if (config.engine) {
        const engineConfigDir = getWorkspaceAgentConfigDir(config.engine);
        const configDir = path.join(getWorkspaceRoot(), engineConfigDir);
        if (!existsSync(configDir)) {
          mkdirSync(configDir, { recursive: true });
        }
      }
    } catch (e) {
      console.warn('[Engine] Failed to setup engine config directory:', e);
    }

    return jsonOk({
      success: true,
      engine,
      defaultModel: config.defaultModel,
      engineRuntime: config.engineRuntime || 'auto',
      cangjieRuntime: config.cangjieRuntime || {},
      ignoredFields,
      notice: ignoredFields.length ? 'Pre-runtime driver settings are ignored by this one-time migration endpoint.' : undefined,
      migrationOnly: true,
    }, migrationOnlyHeaders);
  } catch (error) {
    console.error('Failed to save engine config:', error);
    return jsonError('Failed to save engine config', 500);
  }
}
