import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelOption } from '@/lib/core/models';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import { normalizeRuntimeEngineId } from '@/lib/models/engine-compatibility';
import {
  getModelCatalogSnapshot,
  restoreModelCatalogSnapshot,
  syncModelCatalogToDb,
  type ModelCatalogRow,
} from '@/client/db/collections';

export type EngineConfig = {
  engine?: string;
  defaultModel?: string;
  [key: string]: unknown;
};

export type EngineAvailabilityReport = {
  engine: string;
  available?: boolean;
  diagnostics?: {
    status?: string;
    summary?: string;
    checkedAt?: string;
    error?: string;
  };
};

export type RuntimeAgentListItem = {
  id?: string;
  name?: string;
  title?: string;
  displayName?: string;
  iconPath?: string;
  activeEngine?: string;
  runtimeState?: {
    enabled?: boolean;
    hidden?: boolean;
    availability?: {
      status?: 'unknown' | 'available' | 'missing' | 'error' | string;
      checkedAt?: string;
      message?: string;
    };
  };
  definition?: {
    id?: string;
    displayName?: string;
    iconPath?: string;
  };
};

export type RuntimeEngineSelection = EngineConfig & {
  source: 'runtime-model-routes' | 'runtime-agent-registry';
};

export type ModelsSaveOption = {
  value: string;
  label: string;
  costMultiplier?: number;
  engines?: string[];
  endpoints?: string[];
  status?: string;
  contextWindow?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type DetectedEngineModel = {
  modelId: string;
  name: string;
  source?: string;
  recommended?: boolean;
};

export function selectEngineDefaultModel(
  models: Array<{ value: string; isDefault?: boolean }>,
  currentModel = '',
): string {
  if (currentModel && models.some((model) => model.value === currentModel)) return currentModel;
  return models.find((model) => model.isDefault)?.value || models[0]?.value || '';
}

export type EngineModelSmokeResult = {
  model: string;
  ok: boolean;
  resolvedModel?: string;
  error?: string;
  durationMs: number;
  preview?: string;
  skipped?: boolean;
};

export type RuntimeCommandMetadata = {
  namespace?: string;
  commands: Array<{
    name?: string;
    description?: string;
  }>;
};

const RUNTIME_AVAILABILITY_ENGINE_IDS = [
  'claude',
  'kiro',
  'opencode',
  'nga',
  'codeagent',
  'codegenie',
  'codex',
  'cursor',
  'trae',
  'cangjie-magic',
  'pi',
  'openclaw',
  'gemini',
  'copilot',
  'kilocode',
  'kimi',
  'mux',
  'qoder',
  'qwen',
] as const;

export function useModelsQuery() {
  return useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => apiRequest<{ models: ModelOption[] }>('/api/models'),
    staleTime: 60_000,
  });
}

async function fetchRuntimeAgents() {
  const data = await apiRequest<{ agents?: RuntimeAgentListItem[] }>('/api/runtime-agents');
  return data.agents || [];
}

function runtimeAgentId(agent: RuntimeAgentListItem): string {
  const id = String(agent.id || agent.name || agent.definition?.id || agent.activeEngine || '').trim();
  return normalizeRuntimeEngineId(id) || id;
}

function runtimeAgentLabel(agent: RuntimeAgentListItem): string {
  return String(agent.title || agent.displayName || agent.definition?.displayName || runtimeAgentId(agent)).trim();
}

type RuntimeEngineOption = {
  id: string;
  name: string;
  iconPath?: string;
};

export function runtimeAgentToEngineOption(agent: RuntimeAgentListItem): RuntimeEngineOption | null {
  const id = runtimeAgentId(agent);
  return id
    ? {
        id,
        name: runtimeAgentLabel(agent),
        iconPath: String(agent.iconPath || agent.definition?.iconPath || '').trim() || undefined,
      }
    : null;
}

export function isRuntimeAvailabilityAvailable(status: string | undefined): boolean {
  return status === 'available';
}

export function runtimeAgentsToEngineAvailabilityReports(
  agents: RuntimeAgentListItem[],
): Record<string, EngineAvailabilityReport> {
  const entries: Array<readonly [string, EngineAvailabilityReport]> = [];
  for (const agent of agents) {
    const engine = runtimeAgentId(agent);
    if (!engine) continue;
    const availability = agent.runtimeState?.availability;
    const status = availability?.status || 'unknown';
    entries.push([engine, {
      engine,
      available: status === 'unknown' ? undefined : isRuntimeAvailabilityAvailable(status),
      diagnostics: {
        status,
        summary: availability?.message,
        checkedAt: status === 'unknown' ? undefined : availability?.checkedAt,
        error: status === 'error' || status === 'missing' || status === 'failed' || status === 'misconfigured'
          ? availability?.message || status
          : undefined,
      },
    }]);
  }
  return Object.fromEntries(entries) as Record<string, EngineAvailabilityReport>;
}

export function runtimeAgentsToEngineAvailabilityMap(agents: RuntimeAgentListItem[]): Record<string, boolean> {
  const entries = agents
    .map((agent) => {
      const engine = runtimeAgentId(agent);
      if (!engine) return null;
      const status = agent.runtimeState?.availability?.status || 'unknown';
      return [engine, isRuntimeAvailabilityAvailable(status)] as const;
    })
    .filter((entry): entry is readonly [string, boolean] => Boolean(entry));
  return Object.fromEntries(entries) as Record<string, boolean>;
}

function visibleRuntimeEngineOptions(agents: RuntimeAgentListItem[]): RuntimeEngineOption[] {
  return agents
    .filter((agent) => agent.runtimeState?.enabled !== false && agent.runtimeState?.hidden !== true)
    .map(runtimeAgentToEngineOption)
    .filter((agent): agent is RuntimeEngineOption => Boolean(agent));
}

export function useRuntimeEngineOptionsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.agents(), 'runtime-engine-options'] as const,
    queryFn: fetchRuntimeAgents,
    select: visibleRuntimeEngineOptions,
    staleTime: 30_000,
    enabled: options.enabled,
  });
}

export function useRuntimeEngineSelectionQuery() {
  const modelsQuery = useModelsQuery();
  const agentsQuery = useRuntimeEngineOptionsQuery();
  return useQuery({
    queryKey: [...queryKeys.models(), 'runtime-selection'] as const,
    queryFn: async (): Promise<RuntimeEngineSelection> => {
      const configured: EngineConfig = await apiRequest<EngineConfig>('/api/engine').catch(() => ({} as EngineConfig));
      if (typeof configured.engine === 'string' && configured.engine.trim()) {
        return {
          engine: normalizeRuntimeEngineId(configured.engine) || configured.engine,
          defaultModel: typeof configured.defaultModel === 'string' ? configured.defaultModel : '',
          source: 'runtime-model-routes',
        };
      }

      const modelsData = modelsQuery.data || await apiRequest<{ models: ModelOption[] }>('/api/models');
      const models = modelsData.models || [];
      const defaultRoute = models.find((model: any) => model?.isDefault && typeof model.agentId === 'string')
        || models.find((model: any) => typeof model?.agentId === 'string');
      if (defaultRoute) {
        const route = defaultRoute as ModelOption & { agentId?: string; modelId?: string };
        return {
          engine: route.agentId || '',
          defaultModel: route.value || route.modelId || '',
          source: 'runtime-model-routes',
        };
      }

      const agents: RuntimeEngineOption[] = agentsQuery.data ?? await fetchRuntimeAgents().then(visibleRuntimeEngineOptions);
      return {
        engine: agents[0]?.id || '',
        defaultModel: '',
        source: 'runtime-agent-registry',
      };
    },
    enabled: !modelsQuery.isLoading && !agentsQuery.isLoading,
    staleTime: 30_000,
  });
}

export async function fetchRuntimeCommandMetadataCompat(options: {
  engine: string;
  cwd?: string;
}): Promise<RuntimeCommandMetadata | null> {
  const engine = String(options.engine || '').trim();
  if (!engine) return null;
  return {
    namespace: engine === 'nga' || engine === 'nga-sdk' ? 'codeagent' : engine.replace(/-sdk$/, ''),
    commands: [],
  };
}

export function useSaveModelsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { models: ModelsSaveOption[] }) => apiRequest<{ models?: ModelOption[] }>('/api/models', {
      method: 'POST',
      body: payload,
    }),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.models() });
      const snapshot = getModelCatalogSnapshot();
      syncModelCatalogToDb(payload.models);
      return { snapshot };
    },
    onError: (_error, _payload, context?: { snapshot: ModelCatalogRow[] }) => {
      if (context?.snapshot) restoreModelCatalogSnapshot(context.snapshot);
    },
    onSuccess: (_data, payload) => {
      queryClient.setQueryData(queryKeys.models(), payload);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('engine:updated'));
      }
    },
  });
}

export function useEngineConfigQuery() {
  return useQuery({
    queryKey: queryKeys.engines(),
    queryFn: fetchRuntimeEngineConfig,
    staleTime: 30_000,
  });
}

async function fetchRuntimeEngineConfig(): Promise<EngineConfig> {
  const configured: EngineConfig = await apiRequest<EngineConfig>('/api/engine').catch(() => ({} as EngineConfig));
  if (typeof configured.engine === 'string' && configured.engine.trim()) {
    return {
      ...configured,
      engine: normalizeRuntimeEngineId(configured.engine) || configured.engine,
      defaultModel: typeof configured.defaultModel === 'string' ? configured.defaultModel : '',
    };
  }

  const [modelsData, agents] = await Promise.all([
    apiRequest<{ models: ModelOption[] }>('/api/models'),
    fetchRuntimeAgents(),
  ]);
  const models = modelsData.models || [];
  const defaultRoute = models.find((model: any) => model?.isDefault && typeof model.agentId === 'string')
    || models.find((model: any) => typeof model?.agentId === 'string');
  if (defaultRoute) {
    const route = defaultRoute as ModelOption & { agentId?: string; modelId?: string };
    return {
      engine: route.agentId || '',
      defaultModel: route.value || route.modelId || '',
    };
  }
  return {
    engine: visibleRuntimeEngineOptions(agents)[0]?.id || '',
    defaultModel: '',
  };
}

export function useEngineAvailabilityReportsQuery(options: { forceRefresh?: boolean; refreshToken?: number } = {}) {
  return useQuery({
    queryKey: [
      ...queryKeys.engineAvailability(),
      { reports: true, forceRefresh: options.forceRefresh ?? false, refreshToken: options.refreshToken ?? 0 },
    ] as const,
    queryFn: async () => {
      const entries = await Promise.all(RUNTIME_AVAILABILITY_ENGINE_IDS.map(async (engine) => {
        try {
          const data = await apiRequest<EngineAvailabilityReport & { error?: string }>(
            `/api/engine/availability?engine=${encodeURIComponent(engine)}${options.forceRefresh ? '&refresh=1' : ''}`,
            { authRedirect: false },
          );
          const normalizedEngine = normalizeRuntimeEngineId(data.engine) || engine;
          const status = data.diagnostics?.status;
          return [normalizedEngine, {
            ...data,
            engine: normalizedEngine,
            available: status === 'unknown' ? undefined : Boolean(data.available),
          }] as const;
        } catch {
          return [engine, {
            engine,
            available: false,
            diagnostics: {
              error: 'availability request failed',
            },
          }] as const;
        }
      }));
      return Object.fromEntries(entries) as Record<string, EngineAvailabilityReport>;
    },
    staleTime: 30 * 60_000,
  });
}

export function useEngineAvailabilityQuery() {
  const reportsQuery = useEngineAvailabilityReportsQuery();
  return {
    ...reportsQuery,
    data: reportsQuery.data
      ? Object.fromEntries(Object.entries(reportsQuery.data).map(([engine, report]) => [engine, report.available]))
      : undefined,
  };
}

export function useRefreshEngineAvailabilityMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const entries = await Promise.all(RUNTIME_AVAILABILITY_ENGINE_IDS.map(async (engine) => {
        try {
          const data = await apiRequest<EngineAvailabilityReport & { error?: string }>(
            `/api/engine/availability?engine=${encodeURIComponent(engine)}&refresh=1`,
            { authRedirect: false },
          );
          return [normalizeRuntimeEngineId(data.engine) || engine, Boolean(data.available)] as const;
        } catch {
          return [engine, false] as const;
        }
      }));
      return Object.fromEntries(entries) as Record<string, boolean>;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.engineAvailability(), data);
    },
  });
}

export function useSaveEngineConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>): Promise<EngineConfig> => apiRequest<EngineConfig>('/api/engine', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.models() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('engine-config-updated-at', String(Date.now()));
        window.dispatchEvent(new CustomEvent('engine:updated'));
      }
    },
  });
}

export function useDetectEngineModelsMutation() {
  return useMutation({
    mutationFn: ({ engine, driver }: { engine: string; driver?: string }) => {
      const params = new URLSearchParams({ engine });
      if (driver) params.set('driver', driver);
      return apiRequest<{ models?: DetectedEngineModel[]; error?: string; message?: string }>(`/api/engine/models?${params.toString()}`, {
        authRedirect: false,
      });
    },
  });
}

export function useSmokeTestEngineModelsMutation() {
  return useMutation({
    mutationFn: (models: string[]): Promise<{ results?: EngineModelSmokeResult[]; error?: string }> => Promise.resolve({
      results: models
        .map((model) => String(model || '').trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((model) => ({
          model,
          ok: false,
          error: 'Pre-runtime engine smoke tests have moved to runtime model probes.',
          durationMs: 0,
          skipped: true,
        })),
    }),
  });
}
