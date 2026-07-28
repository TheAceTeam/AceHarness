import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/client/query/api-client';
import type {
  InstantiateWorkflowTemplateInput,
  SaveWorkflowTemplateInput,
  WorkflowTemplateDetail,
  WorkflowTemplateSummary,
} from '@/lib/workflow-template/types';

export type WorkflowTemplateListFilters = {
  keyword?: string;
  category?: string;
  mode?: string;
  source?: string;
};

export type WorkflowTemplateListResponse = {
  templates: WorkflowTemplateSummary[];
  categories: string[];
  issues: Array<{ path: string; message: string }>;
};

export function buildWorkflowTemplatesPath(filters: WorkflowTemplateListFilters = {}) {
  const search = new URLSearchParams();
  if (filters.keyword?.trim()) search.set('keyword', filters.keyword.trim());
  if (filters.category && filters.category !== 'all') search.set('category', filters.category);
  if (filters.mode && filters.mode !== 'all') search.set('mode', filters.mode);
  if (filters.source && filters.source !== 'all') search.set('sourceFilter', filters.source);
  const query = search.toString();
  return `/api/workflow-templates${query ? `?${query}` : ''}`;
}

export function useWorkflowTemplatesQuery(filters: WorkflowTemplateListFilters = {}) {
  return useQuery({
    queryKey: ['workflow-templates', 'list', filters],
    queryFn: () => apiRequest<WorkflowTemplateListResponse>(buildWorkflowTemplatesPath(filters)),
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useWorkflowTemplateDetailQuery(
  identity?: { source: string; id: string; version: string } | null,
) {
  return useQuery({
    queryKey: ['workflow-templates', 'detail', identity?.source, identity?.id, identity?.version],
    queryFn: () => {
      const search = new URLSearchParams({
        source: identity?.source || '',
        id: identity?.id || '',
        version: identity?.version || '',
      });
      return apiRequest<{ template: WorkflowTemplateDetail }>(`/api/workflow-templates?${search.toString()}`);
    },
    enabled: Boolean(identity?.source && identity?.id && identity?.version),
    staleTime: 30_000,
  });
}

export function useSaveWorkflowTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SaveWorkflowTemplateInput) => apiRequest<{ success: true; template: WorkflowTemplateDetail }>(
      '/api/workflow-templates',
      { method: 'POST', body },
    ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflow-templates'] });
    },
  });
}

export function useInstantiateWorkflowTemplateMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: InstantiateWorkflowTemplateInput) => apiRequest<{
      success: true;
      filename: string;
      templateRef: { source: string; id: string; version: string; digest: string };
    }>('/api/workflow-templates/instantiate', { method: 'POST', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
  });
}
