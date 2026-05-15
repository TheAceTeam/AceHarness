import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { getEngineConfigDir } from '@/lib/engines/engine-config';
import { getDefaultDriver, normalizeDriverSelection, supportsDriverSelection, type EngineDriver } from '@/lib/engines/engine-factory';
import { getEngineConfigPath, getWorkspaceRoot } from '@/lib/core/app-paths';
import { ensureDirectoryLinkSync } from '@/lib/core/directory-links';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';

const ENGINE_CONFIG_FILE = getEngineConfigPath();

interface EngineConfig {
  engine: string;
  defaultModel?: string;
  driver?: EngineDriver;
  drivers?: Partial<Record<'claude-code' | 'opencode' | 'codegenie', EngineDriver>>;
  updatedAt: string;
}

function getConfiguredDriver(config: EngineConfig, engine?: string | null): EngineDriver | undefined {
  const normalizedEngine = String(engine || '').trim();
  if (!supportsDriverSelection(normalizedEngine)) return undefined;
  const driverKey = normalizedEngine as 'claude-code' | 'opencode' | 'codegenie';
  return normalizeDriverSelection(normalizedEngine, config.drivers?.[driverKey] || config.driver);
}

export async function GET() {
  try {
    const exists = await fs.access(ENGINE_CONFIG_FILE).then(() => true).catch(() => false);

    if (!exists) {
      return NextResponse.json({ engine: '', defaultModel: '' });
    }

    const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
    const config: EngineConfig = JSON.parse(content);

    return NextResponse.json({
      engine: config.engine,
      defaultModel: config.defaultModel || '',
      driver: getConfiguredDriver(config, config.engine) || getDefaultDriver(config.engine),
      drivers: config.drivers || {},
    });
  } catch (error) {
    console.error('Failed to read engine config:', error);
    return NextResponse.json({ engine: '', defaultModel: '', driver: 'sdk', drivers: {} });
  }
}

export async function POST(request: Request) {
  try {
    const { engine, defaultModel, driver } = await request.json();

    if (!engine) {
      return NextResponse.json({ error: 'Engine is required' }, { status: 400 });
    }

    // Read existing config to preserve fields
    let existing: Partial<EngineConfig> = {};
    try {
      const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
      existing = JSON.parse(content);
    } catch { /* new file */ }

    const config: EngineConfig = {
      ...existing,
      engine,
      updatedAt: new Date().toISOString(),
    };
    // Only update defaultModel if explicitly provided
    if (defaultModel !== undefined) {
      config.defaultModel = defaultModel;
    }
    // Only update driver if explicitly provided
    const normalizedDriver = normalizeDriverSelection(engine, driver);
    if (normalizedDriver) {
      config.drivers = {
        ...(config.drivers || {}),
        [engine]: normalizedDriver,
      };
      if (config.engine === engine) {
        config.driver = normalizedDriver;
      }
    } else if (!supportsDriverSelection(engine)) {
      if (config.engine === engine) {
        delete config.driver;
      }
    } else {
      const fallbackDriver = getDefaultDriver(engine);
      if (fallbackDriver) {
        config.drivers = {
          ...(config.drivers || {}),
          [engine]: fallbackDriver,
        };
        if (config.engine === engine && !config.driver) {
          config.driver = fallbackDriver;
        }
      }
    }

    await fs.writeFile(ENGINE_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

    // Create engine config dir and symlink skills
    try {
      const engineConfigDir = getEngineConfigDir(engine);
      const configDir = path.join(getWorkspaceRoot(), engineConfigDir);
      const skillsDir = await getRuntimeSkillsDirPath();
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      const skillsLink = path.join(configDir, 'skills');
      if (existsSync(skillsDir) && ensureDirectoryLinkSync(skillsDir, skillsLink) === 'created') {
        console.log(`[Engine] Linked ${engineConfigDir}/skills -> skills/`);
      }
    } catch (e) {
      console.warn('[Engine] Failed to setup skills symlink:', e);
    }

    return NextResponse.json({ success: true, engine, defaultModel: config.defaultModel });
  } catch (error) {
    console.error('Failed to save engine config:', error);
    return NextResponse.json({ error: 'Failed to save engine config' }, { status: 500 });
  }
}
