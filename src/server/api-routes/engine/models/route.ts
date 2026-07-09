import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getBuiltinAgentDefinition } from '@/lib/runtime-agent/agent-registry';
import { discoverClaudeCodeModels } from '@/lib/engines/claude-code-model-discovery';
import { discoverOpenCodeSdkModels } from '@/lib/engines/opencode-sdk-wrapper';
import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

export const dynamic = 'force-dynamic';

type DiscoveredModel = {
  modelId: string;
  name: string;
  source?: string;
  recommended?: boolean;
};

function normalizeEngineId(engine: string): string {
  if (engine === 'claude-code') return 'claude';
  if (engine === 'kiro-cli') return 'kiro';
  if (engine === 'magic-cli') return 'cangjie-magic';
  return engine;
}

function uniqueModels(models: DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map<string, DiscoveredModel>();
  for (const model of models) {
    const modelId = String(model.modelId || '').trim();
    if (!modelId) continue;
    const current = byId.get(modelId);
    byId.set(modelId, {
      modelId,
      name: current?.name || model.name || modelId,
      source: current?.source || model.source,
      recommended: Boolean(current?.recommended || model.recommended),
    });
  }
  return Array.from(byId.values());
}

async function discoverViaAcpx(agentId: string): Promise<DiscoveredModel[]> {
  const definition = getBuiltinAgentDefinition(agentId);
  if (!definition || definition.runtime !== 'acpx') {
    throw new Error(`Unknown ACPX agent: ${agentId}`);
  }

  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
  const runtime = createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: createRuntimeStore({
      stateDir: getWorkspaceDataFile('acpx-runtime'),
    }),
    agentRegistry: createAgentRegistry(),
    permissionMode: 'approve-all',
    nonInteractivePermissions: 'deny',
  });

  const handle = await runtime.ensureSession({
    sessionKey: `model-discovery:${agentId}`,
    agent: definition.command || agentId,
    mode: 'oneshot',
    cwd: process.cwd(),
  });

  try {
    const status = await runtime.getStatus?.({ handle });
    const models = status && typeof status === 'object' && 'models' in status
      ? (status as { models?: { availableModelIds?: unknown } }).models
      : undefined;
    const ids = Array.isArray(models?.availableModelIds)
      ? models.availableModelIds.filter((modelId): modelId is string => typeof modelId === 'string' && modelId.trim().length > 0)
      : [];
    return uniqueModels(ids.map((modelId) => ({
      modelId,
      name: modelId,
      source: 'acpx',
    })));
  } finally {
    await runtime.close({
      handle,
      reason: 'model-discovery-complete',
      discardPersistentState: true,
    }).catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const engine = requestUrl(request).searchParams.get('engine')?.trim();
  if (!engine) {
    return jsonError('engine parameter required', 400);
  }

  const agentId = normalizeEngineId(engine);

  if (agentId === 'claude') {
    try {
      const result = await discoverClaudeCodeModels();
      return jsonOk({
        engine,
        agentId,
        source: result.fallback,
        usedAnthropicApi: result.usedAnthropicApi,
        models: uniqueModels(result.models.map((model) => ({
          modelId: model.modelId,
          name: model.name,
          source: model.source,
          recommended: Boolean(model.recommended),
        }))),
      });
    } catch (error) {
      console.error('[engine/models] Failed to discover Claude models:', error);
      return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
    }
  }

  try {
    const models = await discoverViaAcpx(agentId);
    if (models.length > 0) {
      return jsonOk({ engine, agentId, source: 'acpx', models });
    }
  } catch (error) {
    console.error(`[engine/models] ACPX discovery failed for ${agentId}:`, error);
    if (agentId !== 'opencode') {
      return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
    }
  }

  if (agentId === 'opencode') {
    try {
      const models = await discoverOpenCodeSdkModels();
      return jsonOk({
        engine,
        agentId,
        source: 'sdk-http',
        models: uniqueModels(models),
      });
    } catch (error) {
      console.error('[engine/models] OpenCode SDK model discovery failed:', error);
      return jsonError(`Failed to discover models: ${errorMessage(error)}`, 500);
    }
  }

  return jsonOk({
    engine,
    agentId,
    source: 'acpx',
    models: [],
    message: '当前运行时没有返回可用模型列表',
  });
}
