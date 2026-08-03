import { normalizeRuntimeEngineId } from '@/lib/models/engine-compatibility';
import { resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';

function modelRouteEngineCandidates(engine: string): string[] {
  const raw = String(engine || '').trim();
  const normalized = normalizeRuntimeEngineId(raw);
  const withoutSdkSuffix = normalized.endsWith('-sdk') ? normalized.slice(0, -4) : '';
  return Array.from(new Set([raw, normalized, withoutSdkSuffix].filter(Boolean)));
}

export function resolveActiveChatModelRoute(engine: string, model: string) {
  const engineCandidates = modelRouteEngineCandidates(engine);
  try {
    const explicitRoute = resolveRuntimeModelRoute({ modelRouteId: model });
    if (explicitRoute && engineCandidates.includes(explicitRoute.agentId)) return explicitRoute;
  } catch {
    // The selector normally stores a model ID, but explicit route IDs are valid.
  }

  for (const agentId of engineCandidates) {
    try {
      const route = resolveRuntimeModelRoute({ agentId, modelId: model });
      if (route) return route;
    } catch {
      // Continue through compatible engine aliases.
    }
  }
  return null;
}

export function chatModelRouteError(engine: string, model: string): string {
  return `模型「${model}」当前没有可用于引擎「${engine}」的有效运行路由，请选择已配置的模型后重试。`;
}
