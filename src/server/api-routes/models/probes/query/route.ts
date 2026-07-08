import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { listModelProbes } from '@/lib/models/probes';
import type { ModelProbeListSummary, ModelProbeRuntimeStatus, ModelProbeSummary } from '@/lib/models/probe-types';

export const dynamic = 'force-dynamic';

function readHistoryLimit(value: string | null): number | undefined {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function computeSummary(probes: ModelProbeSummary[]): ModelProbeListSummary {
  return {
    total: probes.length,
    enabled: probes.filter((probe) => probe.enabled).length,
    running: probes.filter((probe) => probe.status === 'running').length,
    operational: probes.filter((probe) => probe.status === 'operational').length,
    degraded: probes.filter((probe) => probe.status === 'degraded').length,
    down: probes.filter((probe) => probe.status === 'down').length,
    paused: probes.filter((probe) => probe.status === 'paused').length,
    unknown: probes.filter((probe) => probe.status === 'unknown').length,
    lastUpdatedAt: probes.reduce<string | null>((latest, probe) => {
      if (!latest) return probe.updatedAt;
      return Date.parse(probe.updatedAt) > Date.parse(latest) ? probe.updatedAt : latest;
    }, null),
    nextRunAt: probes
      .map((probe) => probe.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null,
    minIntervalMinutes: probes
      .filter((probe) => probe.enabled)
      .reduce<number | null>((min, probe) => {
        if (min === null) return probe.intervalMinutes;
        return Math.min(min, probe.intervalMinutes);
      }, null),
  };
}

export async function GET(request: Request) {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;

  try {
    const { searchParams } = requestUrl(request);
    const provider = String(searchParams.get('provider') || '').trim().toLowerCase();
    const engine = String(searchParams.get('engine') || '').trim().toLowerCase();
    const keyword = String(searchParams.get('keyword') || '').trim().toLowerCase();
    const status = String(searchParams.get('status') || '').trim() as ModelProbeRuntimeStatus | '';
    const historyLimit = readHistoryLimit(searchParams.get('historyLimit'));

    const data = await listModelProbes({ historyLimit });
    const probes = data.probes.filter((probe) => {
      if (provider && !probe.endpoints.some((item) => item.toLowerCase() === provider)) return false;
      if (engine && probe.engine.toLowerCase() !== engine) return false;
      if (status && probe.status !== status) return false;
      if (keyword) {
        const haystack = `${probe.name} ${probe.model} ${probe.engineLabel} ${probe.endpoints.join(' ')}`.toLowerCase();
        if (!haystack.includes(keyword)) return false;
      }
      return true;
    });

    return jsonOk({
      probes,
      summary: computeSummary(probes),
      filters: {
        provider: provider || null,
        engine: engine || null,
        status: status || null,
        keyword: keyword || null,
        historyLimit: historyLimit || null,
      },
    });
  } catch (error) {
    return jsonError(errorMessage(error) || 'Failed to query model probes', 500);
  }
}
