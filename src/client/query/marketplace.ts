import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallRequest, MarketplaceCategory, MarketplaceSourceConfig, MarketplaceSource, SearchResponse } from '@/types/marketplace';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type MarketplaceSearchParams = {
  source: MarketplaceSource;
  keyword: string;
  category: string;
  pageNum: number;
  pageSize: number;
};

type MarketplaceSourcesResponse = { sources: MarketplaceSourceConfig[]; canManage: boolean };

export function useMarketplaceSourcesQuery(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.marketplace.sources(),
    queryFn: ({ signal }) => apiRequest<MarketplaceSourcesResponse>('/api/marketplace/sources', { signal }),
    enabled,
  });
}

export function useMarketplaceSourceMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string } | Pick<MarketplaceSourceConfig, 'label' | 'url' | 'protocol'>) => 'id' in input
      ? apiRequest<{ source?: MarketplaceSourceConfig }>('/api/marketplace/sources?' + new URLSearchParams({ id: input.id }), { method: 'DELETE' })
      : apiRequest<{ source?: MarketplaceSourceConfig }>('/api/marketplace/sources', { method: 'POST', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.marketplace.sources() });
      await queryClient.invalidateQueries({ queryKey: ['marketplace', 'search'], refetchType: 'none' });
    },
  });
}

export function useMarketplaceCategoriesQuery(source: MarketplaceSource, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.marketplace.categories(source),
    queryFn: () => apiRequest<{ success: boolean; data?: { categories: MarketplaceCategory[] }; error?: string }>(
      '/api/marketplace/categories?' + new URLSearchParams({ source }),
    ),
    enabled: options.enabled ?? true,
    staleTime: 10 * 60_000,
  });
}

export function useMarketplaceSearchQuery(params: MarketplaceSearchParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.marketplace.search(params),
    queryFn: ({ signal }) => apiRequest<SearchResponse>('/api/marketplace/search', {
      method: 'POST',
      body: params,
      signal,
    }),
    enabled: options.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useInstallMarketplaceSkillMutation() {
  return useMutation({
    mutationFn: (body: InstallRequest) => apiRequest<{ success: boolean; error?: string }>('/api/marketplace/install', {
      method: 'POST',
      body,
    }),
  });
}
