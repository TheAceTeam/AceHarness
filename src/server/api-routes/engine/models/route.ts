import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { ACPEngine, getAcpModelDiscoveryTimeoutMs } from '@/lib/engines/acp-engine';
import { discoverClaudeCodeModels } from '@/lib/engines/claude-code-model-discovery';
import { commandExists } from '@/lib/core/command-exists';
import { resolveCursorAgentCommand } from '@/lib/engines/cursor-wrapper';
import { discoverOpenCodeSdkModels } from '@/lib/engines/opencode-sdk-wrapper';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import { isWindows } from '@/lib/core/runtime-platform';
import {
  getDefaultDriver,
  normalizeDriverSelection,
  resolveEffectiveEngine,
  supportsDriverSelection,
  type EngineDriver,
} from '@/lib/engines/engine-selection';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';

interface EngineConfig {
  engine: string;
  driver?: EngineDriver;
  drivers?: Partial<Record<'claude-code' | 'opencode' | 'nga' | 'codegenie', EngineDriver>>;
}

async function readEngineConfig(): Promise<EngineConfig | null> {
  const configPath = getEngineConfigPath();
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(await readFile(configPath, 'utf-8')) as EngineConfig;
  } catch (error) {
    console.warn('[engine/models] Failed to read engine config:', error);
    return null;
  }
}

function getConfiguredDriver(config: EngineConfig | null, engineType: string, requestedDriver: string | null): EngineDriver | undefined {
  if (!supportsDriverSelection(engineType)) return undefined;
  if (requestedDriver === 'sdk' || requestedDriver === 'stdio') {
    return normalizeDriverSelection(engineType, requestedDriver);
  }
  const engineKey = engineType as 'claude-code' | 'opencode' | 'nga' | 'codegenie';
  return normalizeDriverSelection(engineType, config?.drivers?.[engineKey] || config?.driver || getDefaultDriver(engineType));
}

function parseOpenCodeCliModels(output: string): Array<{ modelId: string; name: string }> {
  const seen = new Set<string>();
  const models: Array<{ modelId: string; name: string }> = [];
  for (const line of output.split(/\r?\n/)) {
    const modelId = line.trim();
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    models.push({ modelId, name: modelId });
  }
  return models;
}

function runOpenCodeModelsCli(command: string, cwd: string): Promise<Array<{ modelId: string; name: string }>> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, ['models'], {
      cwd,
      windowsHide: true,
      shell: isWindows(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('opencode models timed out after 15000ms'));
    }, 15_000);

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`opencode models exited with code ${code}: ${stderr.trim() || '<empty stderr>'}`));
        return;
      }
      resolve(parseOpenCodeCliModels(stdout));
    });
  });
}

/**
 * GET /api/engine/models?engine=opencode
 *
 * Spawns the specified ACP engine, initializes + creates a session to discover
 * available models, then immediately stops the engine.
 * Returns the list of models reported by the engine.
 */
export async function GET(request: Request) {
  const engineType = requestUrl(request).searchParams.get('engine');
  if (!engineType) {
    return jsonError('engine parameter required', 400);
  }
  const config = await readEngineConfig();
  const driver = getConfiguredDriver(config, engineType, requestUrl(request).searchParams.get('driver'));
  const effectiveEngine = resolveEffectiveEngine(engineType, driver) || engineType;

  if (engineType === 'claude-code') {
    try {
      const result = await discoverClaudeCodeModels();
      return jsonOk({
        engine: engineType,
        source: result.fallback,
        usedAnthropicApi: result.usedAnthropicApi,
        models: result.models.map((m) => ({
          modelId: m.modelId,
          name: m.name,
          source: m.source,
          recommended: Boolean(m.recommended),
        })),
      });
    } catch (error) {
      console.error('[engine/models] Failed to discover models for claude-code:', error);
      return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
    }
  }

  // TODO: magic-cli doesn't support ACP model discovery.
  // These engines don't use ACP or are not available on this system
  if (engineType === 'codex') {
    return jsonOk({ models: [], message: `${engineType} does not support ACP model discovery` });
  }

  // magic-cli: models come from config YAML, not ACP discovery, due to magic-cli can't support model
  // listing via ACP protocol currently.
  if (engineType === 'magic-cli') {
    const { getModelOptions } = await import('@/lib/core/models');
    const allModels = await getModelOptions();
    const models = allModels
      .filter((m: any) => !m.engines || m.engines.length === 0 || m.engines.includes('magic-cli'))
      .map((m: any) => ({ modelId: m.value, name: m.label }));
    return jsonOk({ engine: engineType, models });
  }

  const commandMap: Record<string, string> = {
    'opencode': 'opencode',
    // Prefer ngagent when available; it's commonly the intended ACP stdio entrypoint.
    'nga': commandExists('ngagent', [
      '/root/.local/bin',
      '/usr/local/bin',
      '/usr/bin',
    ]) ? 'ngagent' : 'nga',
    'kiro-cli': 'kiro-cli',
    'cursor': resolveCursorAgentCommand(),
    'trae-cli': 'trae-cli',
    'codegenie': 'codegenie',
  };

  const command = commandMap[engineType];
  if (!command) {
    return jsonError(`Unknown engine: ${engineType}`, 400);
  }

  if (engineType === 'opencode' && effectiveEngine === 'opencode-sdk') {
    try {
      const models = await discoverOpenCodeSdkModels();
      return jsonOk({
        engine: engineType,
        driver,
        source: 'sdk-http',
        models,
      });
    } catch (error) {
      console.error('[engine/models] Failed to discover opencode SDK models via HTTP API:', error);
      try {
        const models = await runOpenCodeModelsCli(command, process.cwd());
        return jsonOk({
          engine: engineType,
          driver,
          source: 'cli-fallback',
          models,
        });
      } catch (fallbackError) {
        console.error('[engine/models] OpenCode CLI fallback failed:', fallbackError);
        return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
      }
    }
  }

  const engine = new ACPEngine({
    engineType,
    command,
    workingDirectory: process.cwd(),
  });

  try {
    const discoveryMs = getAcpModelDiscoveryTimeoutMs();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Engine model discovery timed out (${discoveryMs}ms; set ACE_ACP_MODEL_DISCOVERY_TIMEOUT_MS or ACE_ACP_INIT_TIMEOUT_MS / ACE_ACP_NEW_SESSION_TIMEOUT_MS)`
            )
          ),
        discoveryMs
      )
    );

    const discover = async () => {
      await engine.start();
      await engine.createSession();
      return engine.getAvailableModels();
    };

    const models = await Promise.race([discover(), timeout]);
    const source = models.length > 0 ? 'acp' : 'empty';

    if (engineType === 'opencode' && models.length === 0) {
      try {
        const httpModels = await discoverOpenCodeSdkModels();
        return jsonOk({
          engine: engineType,
          driver,
          source: 'sdk-http-fallback',
          models: httpModels,
        });
      } catch (httpFallbackError) {
        console.error('[engine/models] OpenCode ACP returned no models and HTTP fallback failed:', httpFallbackError);
      }
      try {
        const cliModels = await runOpenCodeModelsCli(command, process.cwd());
        return jsonOk({
          engine: engineType,
          driver,
          source: 'cli-fallback',
          models: cliModels,
        });
      } catch (fallbackError) {
        console.error('[engine/models] OpenCode ACP returned no models and CLI fallback failed:', fallbackError);
      }
    }

    return jsonOk({
      engine: engineType,
      driver,
      source,
      models: models.map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
      })),
    });
  } catch (error) {
    console.error(`[engine/models] Failed to discover models for ${engineType}:`, error);
    if (engineType === 'opencode') {
      try {
        const httpModels = await discoverOpenCodeSdkModels();
        return jsonOk({
          engine: engineType,
          driver,
          source: 'sdk-http-fallback',
          models: httpModels,
        });
      } catch (httpFallbackError) {
        console.error('[engine/models] OpenCode HTTP fallback failed:', httpFallbackError);
      }
      try {
        const cliModels = await runOpenCodeModelsCli(command, process.cwd());
        return jsonOk({
          engine: engineType,
          driver,
          source: 'cli-fallback',
          models: cliModels,
        });
      } catch (fallbackError) {
        console.error('[engine/models] OpenCode CLI fallback failed:', fallbackError);
      }
    }
    return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
  } finally {
    engine.stop();
  }
}
