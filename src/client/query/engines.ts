import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ModelOption } from '@/lib/core/models';
import { getConcreteEngines } from '@/lib/core/engine-metadata';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import {
  getModelCatalogSnapshot,
  restoreModelCatalogSnapshot,
  syncModelCatalogToDb,
  type ModelCatalogRow,
} from '@/client/db/collections';

export type EngineConfig = {
  engine?: string;
  driver?: string;
  defaultModel?: string;
  drivers?: Record<string, 'stdio' | 'sdk'>;
  [key: string]: unknown;
};

export type EngineAvailabilityReport = {
  engine: string;
  available: boolean;
  drivers?: Partial<Record<'stdio' | 'sdk', boolean>>;
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

export type EngineModelSmokeResult = {
  model: string;
  ok: boolean;
  resolvedModel?: string;
  error?: string;
  durationMs: number;
  preview?: string;
};

export function useModelsQuery() {
  return useQuery({
    queryKey: queryKeys.models(),
    queryFn: () => apiRequest<{ models: ModelOption[] }>('/api/models'),
    staleTime: 60_000,
  });
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
    queryFn: () => apiRequest<EngineConfig>('/api/engine'),
    staleTime: 30_000,
  });
}

export function useEngineAvailabilityReportsQuery(options: { forceRefresh?: boolean } = {}) {
  return useQuery({
    queryKey: [...queryKeys.engineAvailability(), { reports: true, forceRefresh: options.forceRefresh ?? false }] as const,
    queryFn: async () => {
      const entries = await Promise.all(getConcreteEngines().map(async (engine) => {
        try {
          const data = await apiRequest<{ available?: boolean; drivers?: EngineAvailabilityReport['drivers'] }>(
            `/api/engine/availability?engine=${encodeURIComponent(engine.id)}${options.forceRefresh ? '&refresh=1' : ''}`,
            { authRedirect: false },
          );
          return [engine.id, {
            engine: engine.id,
            available: Boolean(data.available),
            drivers: data.drivers,
          }] as const;
        } catch {
          return [engine.id, {
            engine: engine.id,
            available: false,
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
      const entries = await Promise.all(getConcreteEngines().map(async (engine) => {
        try {
          const data = await apiRequest<{ available?: boolean }>(
            `/api/engine/availability?engine=${encodeURIComponent(engine.id)}&refresh=1`,
            { authRedirect: false },
          );
          return [engine.id, Boolean(data.available)] as const;
        } catch {
          return [engine.id, false] as const;
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
    mutationFn: (payload: Record<string, unknown>) => apiRequest<EngineConfig>('/api/engine', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
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
      return apiRequest<{ models?: DetectedEngineModel[]; error?: string }>(`/api/engine/models?${params.toString()}`, {
        authRedirect: false,
      });
    },
  });
}

export function useSmokeTestEngineModelsMutation() {
  return useMutation({
    mutationFn: (models: string[]) => apiRequest<{ results?: EngineModelSmokeResult[]; error?: string }>('/api/engine/models/smoke', {
      method: 'POST',
      body: { models },
      authRedirect: false,
    }),
  });
}
