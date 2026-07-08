import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';
import { agentApi } from '@/lib/core/api';
import {
  getAgentConfigsSnapshot,
  optimisticDeleteAgentConfigs,
  optimisticUpsertAgentConfig,
  restoreAgentConfigsSnapshot,
  type AgentConfigRow,
} from '@/client/db/collections';

export interface AgentConfig {
  name: string;
  team: 'blue' | 'red' | 'judge' | 'black-gold';
  roleType?: 'normal' | 'supervisor';
  avatar?: any;
  category?: string;
  tags?: string[];
  engineModels: Record<string, string>;
  activeEngine: string;
  temperature?: number;
  systemPrompt?: string;
  iterationPrompt?: string;
  capabilities?: string[];
  constraints?: string[];
  skills?: string[];
  description?: string;
  alwaysAvailableForChat?: boolean;
  workspaceProfile?: {
    nickname?: string;
    officeRole?: string;
    residency?: {
      office?: boolean;
      meetingRoom?: boolean;
      defaultDirectRoom?: boolean;
    };
    roomPresence?: {
      recommendForMeetingRoom?: boolean;
      autoShowInOffice?: boolean;
    };
  };
}

export type AgentsListResponse = {
  agents: AgentConfig[];
  runtimeAgentsDir?: string;
};

export type AgentMemoryResponse = {
  agentName: string;
  storageScope: 'role';
  storageKey: string;
  entries: any[];
  baseMemory: string;
  mergedContent: string;
  charCount: number;
  maxChars: number;
  overLimit: boolean;
  updatedAt: string;
};

export function useAgentsQuery() {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: async () => {
      const data = await apiRequest<AgentsListResponse>('/api/agents');
      return {
        agents: data.agents || [],
        runtimeAgentsDir: data.runtimeAgentsDir || '',
      };
    },
    placeholderData: (previous) => previous,
    staleTime: 15_000,
  });
}

export function useSaveAgentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, agent }: { name: string; agent: AgentConfig }) => agentApi.saveAgent(name, agent),
    onMutate: async ({ name, agent }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.agents() });
      const snapshot = getAgentConfigsSnapshot();
      optimisticUpsertAgentConfig({ ...agent, name: agent.name || name });
      return { snapshot };
    },
    onError: (_error, _variables, context?: { snapshot: AgentConfigRow[] }) => {
      if (context?.snapshot) restoreAgentConfigsSnapshot(context.snapshot);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}

export function useDeleteAgentMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => agentApi.deleteAgent(name),
    onMutate: async (name) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.agents() });
      const snapshot = getAgentConfigsSnapshot();
      optimisticDeleteAgentConfigs([name]);
      return { snapshot };
    },
    onError: (_error, _name, context?: { snapshot: AgentConfigRow[] }) => {
      if (context?.snapshot) restoreAgentConfigsSnapshot(context.snapshot);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}

export function useBatchDeleteAgentsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (names: string[]) => agentApi.batchDeleteAgents(names),
    onMutate: async (names) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.agents() });
      const snapshot = getAgentConfigsSnapshot();
      optimisticDeleteAgentConfigs(names);
      return { snapshot };
    },
    onError: (_error, _names, context?: { snapshot: AgentConfigRow[] }) => {
      if (context?.snapshot) restoreAgentConfigsSnapshot(context.snapshot);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}

export function useImportAgentZipMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => agentApi.importAgentZip(file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.agents() }),
  });
}

export function useExportAgentsMutation() {
  return useMutation({
    mutationFn: (names: string[]) => agentApi.exportAgents(names),
  });
}

export function useAgentMemoryQuery(name: string, maxChars = 5000, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.agentMemory(name, maxChars),
    queryFn: () => agentApi.getMemory(name, maxChars) as Promise<AgentMemoryResponse>,
    enabled: options.enabled ?? Boolean(name),
    staleTime: 15_000,
  });
}

export function useSaveAgentMemoryMutation(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { baseMemory: string; maxChars?: number }) => agentApi.saveMemory(name, input),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentMemory(name, variables.maxChars ?? 5000) });
    },
  });
}

export function useClearAgentMemoryMutation(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (maxChars: number) => agentApi.clearMemory(name, maxChars),
    onSuccess: (_data, maxChars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.agentMemory(name, maxChars) });
    },
  });
}

export function useGenerateAgentAvatarMutation() {
  return useMutation({
    mutationFn: (input: {
      displayName: string;
      team?: string;
      mission?: string;
      style?: string;
      variant?: string;
    }) => agentApi.generateAvatar(input),
  });
}
