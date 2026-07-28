import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type ScheduleJob = {
  id: string;
  name: string;
  configFile: string;
  enabled: boolean;
  mode: 'simple' | 'cron';
  interval?: { value: number; unit: 'hour' | 'day' | 'week' };
  fixedTime?: { hour: number; minute: number; weekday?: number };
  cronExpression?: string;
  lastRunId?: string;
  lastRunTime?: string;
  lastRunStatus?: string;
  nextRunTime?: string;
  createdAt: string;
  runHistory: { runId: string; time: string; status: string }[];
};

export type SchedulePayload = {
  name: string;
  configFile: string;
  enabled: boolean;
  mode: 'simple' | 'cron';
  interval?: { value: number; unit: 'hour' | 'day' | 'week' };
  fixedTime?: { hour: number; minute: number; weekday?: number };
  cronExpression?: string;
};

export function useSchedulesQuery() {
  return useQuery({
    queryKey: queryKeys.schedules(),
    queryFn: () => apiRequest<{ jobs: ScheduleJob[] }>('/api/schedules'),
    staleTime: 15_000,
  });
}

export function useCreateScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: SchedulePayload) => apiRequest<{ job: ScheduleJob }>('/api/schedules', {
      method: 'POST',
      body: payload,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules() }),
  });
}

export function useUpdateScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: SchedulePayload }) =>
      apiRequest<{ job: ScheduleJob }>(`/api/schedules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules() }),
  });
}

export function useDeleteScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/schedules/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules() }),
  });
}

export function useToggleScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<{ job: ScheduleJob }>(`/api/schedules/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.schedules() });
      const previous = queryClient.getQueryData<{ jobs: ScheduleJob[] }>(queryKeys.schedules());
      queryClient.setQueryData<{ jobs: ScheduleJob[] }>(queryKeys.schedules(), (current) => {
        if (!current) return current;
        return {
          ...current,
          jobs: current.jobs.map((job) => job.id === id ? { ...job, enabled: !job.enabled } : job),
        };
      });
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.schedules(), context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules() }),
  });
}

export function useTriggerScheduleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<unknown>(`/api/schedules/${encodeURIComponent(id)}/trigger`, {
      method: 'POST',
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules() }),
  });
}
