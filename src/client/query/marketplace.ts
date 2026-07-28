import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MarketplaceSkill } from '@/types/marketplace';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type MarketplaceSearchParams = {
  keyword: string;
  category: string;
  pageNum: number;
  pageSize: number;
};

export type MarketplaceSearchResponse = {
  success: boolean;
  data?: {
    skills: MarketplaceSkill[];
    total: number;
  };
  error?: string;
};

export function useMarketplaceCategoriesQuery() {
  return useQuery({
    queryKey: queryKeys.marketplace.categories(),
    queryFn: () => apiRequest<{ success: boolean; data?: { categories: any[] }; error?: string }>('/api/marketplace/categories'),
    staleTime: 10 * 60_000,
  });
}

export function useMarketplaceSearchQuery(params: MarketplaceSearchParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.marketplace.search(params),
    queryFn: () => apiRequest<MarketplaceSearchResponse>('/api/marketplace/search', {
      method: 'POST',
      body: params,
    }),
    enabled: options.enabled ?? true,
    placeholderData: (previous) => previous,
    staleTime: 30_000,
  });
}

export function useInstallMarketplaceSkillMutation(params: MarketplaceSearchParams) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skillName: string) => apiRequest<{ success: boolean; error?: string }>('/api/marketplace/install', {
      method: 'POST',
      body: { skillName },
    }),
    onSuccess: (data, skillName) => {
      if (!data.success) return;
      queryClient.setQueryData<MarketplaceSearchResponse>(
        queryKeys.marketplace.search(params),
        (current) => {
          if (!current?.data?.skills) return current;
          return {
            ...current,
            data: {
              ...current.data,
              skills: current.data.skills.map((skill) => (
                skill.name === skillName ? { ...skill, installed: true } : skill
              )),
            },
          };
        },
      );
    },
  });
}
