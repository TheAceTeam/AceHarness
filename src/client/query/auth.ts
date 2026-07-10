import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiRequest, clearAuthSession } from './api-client';
import { ApiError } from './query-client';
import { queryKeys } from './query-keys';

export interface CurrentUser {
  id?: string;
  username: string;
  email?: string;
  role?: 'admin' | 'user';
  avatar?: string;
  [key: string]: unknown;
}

export type AuthSetupStatus = {
  isSetup?: boolean;
  setupAccessRequired?: boolean;
  setupAccessVerified?: boolean;
  verificationFile?: string;
  platform?: string;
  runtimeRoot?: string;
  userHome?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type LoginResponse = {
  token?: string;
  user?: CurrentUser;
};

interface CurrentUserResponse {
  user?: CurrentUser | null;
}

function syncStoredUser(user: CurrentUser | null) {
  if (typeof window === 'undefined') return;
  if (user) {
    window.localStorage.setItem('auth-user', JSON.stringify(user));
    return;
  }
  window.localStorage.removeItem('auth-user');
}

export function isAuthUnauthorizedError(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  let data: CurrentUserResponse;
  try {
    data = await apiRequest<CurrentUserResponse>('/api/auth/me', {
      authRedirect: false,
    });
  } catch (error) {
    if (isAuthUnauthorizedError(error)) {
      syncStoredUser(null);
      return null;
    }
    throw error;
  }
  const user = data.user ?? null;
  syncStoredUser(user);
  return user;
}

export function useCurrentUserQuery() {
  return useQuery({
    queryKey: queryKeys.auth.currentUser(),
    queryFn: fetchCurrentUser,
    retry: false,
    staleTime: 30_000,
  });
}

function useUpdateCurrentUserCache() {
  const queryClient = useQueryClient();
  return (patch: Partial<CurrentUser>) => {
    queryClient.setQueryData<CurrentUser | null>(queryKeys.auth.currentUser(), (current) => {
      const next = current ? { ...current, ...patch } : patch as CurrentUser;
      syncStoredUser(next);
      return next;
    });
  };
}

export function useChangePasswordMutation() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      apiRequest('/api/auth/password', {
        method: 'PUT',
        body: { currentPassword, newPassword },
        authRedirect: false,
      }),
  });
}

export function useAuthSetupStatusQuery() {
  return useQuery({
    queryKey: ['auth', 'setup'] as const,
    queryFn: () => apiRequest<AuthSetupStatus>('/api/auth/setup', { authRedirect: false }),
    staleTime: 30_000,
  });
}

export function useRegisterUserMutation() {
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest('/api/auth/register', {
      method: 'POST',
      body: payload,
      authRedirect: false,
    }),
  });
}

export function useLoginMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LoginPayload) => apiRequest<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: payload,
      authRedirect: false,
    }),
    onSuccess: (data, payload) => {
      if (typeof window !== 'undefined') {
        if (data.token) window.localStorage.setItem('auth-token', data.token);
      }
      const user = data.user || { email: payload.email, username: payload.email.split('@')[0] || payload.email };
      syncStoredUser(user);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('auth:changed'));
      }
      queryClient.setQueryData(queryKeys.auth.currentUser(), user);
    },
  });
}

export function useInitialSetupMutation() {
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => apiRequest('/api/auth/setup', {
      method: 'POST',
      body: payload,
      authRedirect: false,
    }),
  });
}

export function useVerifyInitialSetupAccessMutation() {
  return useMutation({
    mutationFn: (verificationCode: string) => apiRequest('/api/auth/setup', {
      method: 'POST',
      body: { action: 'verify-access', verificationCode },
      authRedirect: false,
    }),
  });
}

export function useChangeEmailMutation() {
  const updateCurrentUserCache = useUpdateCurrentUserCache();
  return useMutation({
    mutationFn: (newEmail: string) => apiRequest('/api/auth/email', {
      method: 'PUT',
      body: { newEmail },
      authRedirect: false,
    }),
    onSuccess: (_data, newEmail) => updateCurrentUserCache({ email: newEmail }),
  });
}

export function useUpdateProfileMutation() {
  const updateCurrentUserCache = useUpdateCurrentUserCache();
  return useMutation({
    mutationFn: (patch: Partial<Pick<CurrentUser, 'avatar' | 'personalDir'>>) => apiRequest('/api/auth/profile', {
      method: 'PUT',
      body: patch,
      authRedirect: false,
    }),
    onSuccess: (_data, patch) => updateCurrentUserCache(patch),
  });
}

export async function logoutCurrentUser(queryClient?: QueryClient) {
  try {
    await apiRequest('/api/auth/me', {
      method: 'DELETE',
      authRedirect: false,
    });
  } catch {
    // Logout should still clear local session even if the network request fails.
  } finally {
    clearAuthSession();
    queryClient?.removeQueries({ queryKey: queryKeys.auth.currentUser() });
  }
}
