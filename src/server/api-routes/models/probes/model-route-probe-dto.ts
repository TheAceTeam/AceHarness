import { listRuntimeModelsFromSqlite, resolveRuntimeModelRoute } from '@/lib/runtime-agent/models/model-routes-api';

type ProbeLike = Record<string, any>;

function readModelRouteId(input: unknown): string | undefined {
  return typeof input === 'string' && input.trim() ? input.trim() : undefined;
}

export function normalizeProbeInputForModelRouteId(input: ProbeLike): any {
  const modelRouteId = readModelRouteId(input?.modelRouteId);
  if (!modelRouteId) return input;

  const route = resolveRuntimeModelRoute({ modelRouteId });
  if (!route) return input;
  return {
    ...input,
    modelRouteId,
    engine: input.engine || route.agentId,
    model: input.model || route.providerModel,
    endpoints: Array.isArray(input.endpoints) && input.endpoints.length > 0
      ? input.endpoints
      : route.providerId ? [route.providerId] : [],
  };
}

export function attachModelRouteIdsToProbeResponse<T>(data: T): T {
  const routes = listRuntimeModelsFromSqlite().routes;
  const attach = (probe: ProbeLike): ProbeLike => {
    if (!probe || typeof probe !== 'object' || probe.modelRouteId) return probe;
    const matched = routes.find((route) => (
      route.agentId === probe.engine
      && (route.providerModel === probe.model || route.modelId === probe.model || route.value === probe.model)
    ));
    return matched ? { ...probe, modelRouteId: matched.modelRouteId } : probe;
  };

  if (Array.isArray((data as any)?.probes)) {
    return { ...(data as any), probes: (data as any).probes.map(attach) };
  }
  if ((data as any)?.probe) {
    return { ...(data as any), probe: attach((data as any).probe) };
  }
  return data;
}
