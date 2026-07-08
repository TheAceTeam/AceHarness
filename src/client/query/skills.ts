import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import {
  getLocalSkillsSnapshot,
  optimisticDeleteLocalSkills,
  restoreLocalSkillsSnapshot,
  type LocalSkillRow,
} from '@/client/db/collections';

export interface LocalSkill {
  name: string;
  path: string;
  description: string;
  descriptionZh?: string;
  tags: string[];
  platforms?: string[];
  version?: string;
  updatedAt?: string;
  contributors?: string[];
  detailedDescription?: string;
  source?: string;
  hasPromptMd?: boolean;
}

export type SkillsListResponse = {
  skills: LocalSkill[];
  installSkills: LocalSkill[];
  runtimeSkillsDir?: string;
  error?: string;
};

export type SkillMutationResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  deleted?: string[];
};

export function useSkillsQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.skills(),
    queryFn: async () => {
      const data = await apiRequest<SkillsListResponse>('/api/skills');
      if (data.error) {
        throw new Error(data.error);
      }
      return {
        skills: data.skills || [],
        installSkills: data.installSkills || [],
        runtimeSkillsDir: data.runtimeSkillsDir || '',
      };
    },
    enabled: options.enabled ?? true,
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

async function readJsonMutationResponse(response: Response, fallback: string): Promise<SkillMutationResponse> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || fallback);
  }
  return data;
}

export async function uploadSkillZip(file: File): Promise<SkillMutationResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiFetch('/api/skills', { method: 'POST', body: formData });
  return readJsonMutationResponse(response, '导入失败');
}

export async function deleteSkillsByName(skillNames: string[]): Promise<SkillMutationResponse> {
  return apiRequest<SkillMutationResponse>('/api/skills', {
    method: 'DELETE',
    body: { skills: skillNames },
  });
}

export async function syncSkillsByName(skillNames: string[]): Promise<SkillMutationResponse> {
  return apiRequest<SkillMutationResponse>('/api/skills', {
    method: 'PATCH',
    body: { skills: skillNames },
  });
}

export async function exportSkillsZip(skillNames: string[]): Promise<Blob> {
  const response = await apiFetch('/api/skills', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skills: skillNames }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || '导出失败');
  }
  return response.blob();
}

export function useUploadSkillZipMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => uploadSkillZip(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.skills() }),
  });
}

export function useDeleteSkillsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skillNames: string[]) => deleteSkillsByName(skillNames),
    onMutate: async (skillNames) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.skills() });
      const snapshot = getLocalSkillsSnapshot();
      optimisticDeleteLocalSkills(skillNames);
      return { snapshot };
    },
    onError: (_error, _skillNames, context?: { snapshot: LocalSkillRow[] }) => {
      if (context?.snapshot) restoreLocalSkillsSnapshot(context.snapshot);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.skills() }),
  });
}

export function useSyncSkillsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (skillNames: string[]) => syncSkillsByName(skillNames),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.skills() }),
  });
}

export function useExportSkillsMutation() {
  return useMutation({
    mutationFn: (skillNames: string[]) => exportSkillsZip(skillNames),
  });
}
