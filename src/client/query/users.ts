import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from './api-client';
import { queryKeys } from './query-keys';

export type UserInfo = {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'rejected';
  personalDir: string;
  avatar?: string;
  createdAt: number;
  createdBy?: string;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  reviewNote?: string;
};

export type UserSavePayload = {
  username?: string;
  email?: string;
  password?: string;
  question?: string;
  answer?: string;
  role?: 'admin' | 'user';
  personalDir?: string;
  avatar?: string;
  resetPassword?: string;
  reviewAction?: 'approve' | 'reject';
};

export function useUsersQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.users(),
    queryFn: () => apiRequest<{ users: UserInfo[] }>('/api/users', { authRedirect: false }),
    enabled: options.enabled ?? true,
    staleTime: 15_000,
  });
}

export function useCreateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UserSavePayload) => apiRequest<{ user: UserInfo }>('/api/users', {
      method: 'POST',
      body: payload,
      authRedirect: false,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
  });
}

export function useUpdateUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UserSavePayload }) =>
      apiRequest<{ user: UserInfo }>(`/api/users/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: payload,
        authRedirect: false,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
  });
}

export function useDeleteUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      authRedirect: false,
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.users() }),
  });
}
