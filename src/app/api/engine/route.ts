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
  drivers?: Partial<Record<'claude-code' | 'opencode' | 'nga' | 'codegenie', EngineDriver>>;
  updatedAt: string;
}

function getConfiguredDriver(config: EngineConfig, engine?: string | null): EngineDriver | undefined {
  const normalizedEngine = String(engine || '').trim();
  if (!supportsDriverSelection(normalizedEngine)) return undefined;
  const driverKey = normalizedEngine as 'claude-code' | 'opencode' | 'nga' | 'codegenie';
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
    const { engine, targetEngine, defaultModel, driver } = await request.json();

    if (!engine) {
      return NextResponse.json({ error: 'Engine is required' }, { status: 400 });
    }

    // Read existing config to preserve fields
    let existing: Partial<EngineConfig> = {};
    try {
      const content = await fs.readFile(ENGINE_CONFIG_FILE, 'utf-8');
      existing = JSON.parse(content);
    } catch { /* new file */ }

    const driverTarget = String(targetEngine || engine || '').trim();

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
    if (driver !== undefined) {
      const normalizedDriver = normalizeDriverSelection(driverTarget, driver);
      if (normalizedDriver) {
        config.drivers = {
          ...(config.drivers || {}),
          [driverTarget]: normalizedDriver,
        };
        if (config.engine === driverTarget) {
          config.driver = normalizedDriver;
        }
      }
    } else if (!supportsDriverSelection(driverTarget)) {
      if (config.engine === driverTarget) {
        delete config.driver;
      }
    } else {
      // No driver provided — preserve existing; only set default if nothing stored
      const existingDriver = config.drivers?.[driverTarget as 'claude-code' | 'opencode' | 'nga' | 'codegenie'];
      if (!existingDriver) {
        const fallbackDriver = getDefaultDriver(driverTarget);
        if (fallbackDriver) {
          config.drivers = {
            ...(config.drivers || {}),
            [driverTarget]: fallbackDriver,
          };
          if (config.engine === driverTarget && !config.driver) {
            config.driver = fallbackDriver;
          }
        }
      }
      // Sync top-level driver field to match stored per-engine driver
      if (config.engine === driverTarget && !config.driver && config.drivers?.[driverTarget as 'claude-code' | 'opencode' | 'nga' | 'codegenie']) {
        config.driver = config.drivers[driverTarget as 'claude-code' | 'opencode' | 'nga' | 'codegenie'];
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
      if (existsSync(skillsDir)) {
        const linkResult = ensureDirectoryLinkSync(skillsDir, skillsLink);
        if (linkResult === 'created') {
          console.log(`[Engine] Linked ${engineConfigDir}/skills -> skills/`);
        } else if (linkResult === 'skipped' && !existsSync(skillsLink)) {
          // Link failed or target mismatch — fall back to copy
          try {
            const { cpSync } = await import('fs');
            cpSync(skillsDir, skillsLink, { recursive: true, force: true });
            console.log(`[Engine] Copied ${engineConfigDir}/skills (symlink fallback)`);
          } catch (copyErr) {
            console.warn('[Engine] Failed to copy skills:', copyErr);
          }
        }
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
