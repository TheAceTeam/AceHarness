import { NextRequest, NextResponse } from 'next/server';
import { ACPEngine, getAcpModelDiscoveryTimeoutMs } from '@/lib/engines/acp-engine';
import { discoverClaudeCodeModels } from '@/lib/engines/claude-code-model-discovery';
import { commandExists } from '@/lib/core/command-exists';

export const dynamic = 'force-dynamic';

/**
 * GET /api/engine/models?engine=opencode
 *
 * Spawns the specified ACP engine, initializes + creates a session to discover
 * available models, then immediately stops the engine.
 * Returns the list of models reported by the engine.
 */
export async function GET(request: NextRequest) {
  const engineType = request.nextUrl.searchParams.get('engine');
  if (!engineType) {
    return NextResponse.json({ error: 'engine parameter required' }, { status: 400 });
  }

  if (engineType === 'claude-code') {
    try {
      const result = await discoverClaudeCodeModels();
      return NextResponse.json({
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
      return NextResponse.json({
        error: `Failed to discover models: ${error instanceof Error ? error.message : String(error)}`,
      }, { status: 500 });
    }
  }

  // TODO: magic-cli doesn't support ACP model discovery.
  // These engines don't use ACP or are not available on this system
  if (engineType === 'codex') {
    return NextResponse.json({ models: [], message: `${engineType} does not support ACP model discovery` });
  }

  // magic-cli: models come from config YAML, not ACP discovery, due to magic-cli can't support model
  // listing via ACP protocol currently.
  if (engineType === 'magic-cli') {
    const { getModelOptions } = await import('@/lib/core/models');
    const allModels = await getModelOptions();
    const models = allModels
      .filter((m: any) => !m.engines || m.engines.length === 0 || m.engines.includes('magic-cli'))
      .map((m: any) => ({ modelId: m.value, name: m.label }));
    return NextResponse.json({ engine: engineType, models });
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
    'cursor': 'agent',
    'trae-cli': 'trae-cli',
    'codegenie': 'codegenie',
  };

  const command = commandMap[engineType];
  if (!command) {
    return NextResponse.json({ error: `Unknown engine: ${engineType}` }, { status: 400 });
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

    return NextResponse.json({
      engine: engineType,
      models: models.map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
      })),
    });
  } catch (error) {
    console.error(`[engine/models] Failed to discover models for ${engineType}:`, error);
    return NextResponse.json({
      error: `Failed to discover models: ${error instanceof Error ? error.message : String(error)}`,
    }, { status: 500 });
  } finally {
    engine.stop();
  }
}
