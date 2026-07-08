import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  finalizeWorkflowConfigDelete,
  optimisticDeleteWorkflowConfig,
  restoreWorkflowConfigSnapshot,
  type WorkflowConfigRow,
} from '../db/collections';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export function useStartWorkflowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { configFile: string; input?: string }) =>
      apiRequest<{ runId?: string }>('/api/workflow/start', { method: 'POST', body }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatusCompact(variables.configFile) });
      void queryClient.invalidateQueries({ queryKey: ['runs', 'history'] });
    },
  });
}

export function useStopWorkflowMutation(configFile: string, runId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('/api/workflow/stop', { method: 'POST', body: { configFile, runId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatusCompact(configFile, runId) });
    },
  });
}

export function useResumeWorkflowMutation(configFile: string, runId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest('/api/workflow/resume', { method: 'POST', body: { configFile, runId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatusCompact(configFile, runId) });
    },
  });
}

export function useForceTransitionMutation(configFile: string, runId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetState: string; instruction?: string }) =>
      apiRequest('/api/workflow/force-transition', {
        method: 'POST',
        body: { ...body, configFile, runId },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatusCompact(configFile, runId) });
      if (runId) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.workflowEvents(configFile, runId, { afterSeq: 0, limit: 100 }) });
      }
    },
  });
}

export function useDeleteConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (filename: string) =>
      apiRequest(`/api/configs/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
    onMutate: async (filename) => {
      await queryClient.cancelQueries({ queryKey: ['configs'] });
      await queryClient.cancelQueries({ queryKey: queryKeys.config(filename) });
      const snapshot = optimisticDeleteWorkflowConfig(filename);
      return { filename, snapshot };
    },
    onError: (_error, filename, context?: { filename: string; snapshot?: WorkflowConfigRow }) => {
      restoreWorkflowConfigSnapshot(context?.snapshot, context?.filename || filename);
    },
    onSuccess: (_data, filename) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.config(filename) });
    },
    onSettled: async (_data, error, filename) => {
      if (!error) {
        await queryClient.invalidateQueries({ queryKey: ['configs'] });
        finalizeWorkflowConfigDelete(filename);
      }
    },
  });
}

export function useSaveConfigMutation(filename: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      apiRequest(`/api/configs/${encodeURIComponent(filename)}`, {
        method: 'POST',
        body: { config },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.config(filename) });
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
    },
  });
}

export function useValidateConfigMutation() {
  return useMutation({
    mutationFn: (body: { config?: unknown; filename?: string }) =>
      apiRequest('/api/configs/validate', { method: 'POST', body }),
  });
}

export function useCreateConfigMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest<any>('/api/configs/create', { method: 'POST', body }),
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['configs'] });
      const filename = String(data?.filename || variables.filename || '').trim();
      if (filename) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.config(filename) });
      }
    },
  });
}
