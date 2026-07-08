'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/navigation/client';
import { clearAuthSession } from '@/client/query/api-client';
import { useCurrentUserQuery } from '@/client/query/auth';
import { queryKeys } from '@/client/query/query-keys';
import BrandLoadingScreen from './BrandLoadingScreen';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUserQuery();

  useEffect(() => {
    const expireAuthSession = () => {
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.push('/login');
    };

    if (!currentUser.isError) return;
    expireAuthSession();
  }, [currentUser.isError, queryClient, router]);

  useEffect(() => {
    const expireAuthSession = () => {
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.push('/login');
    };

    if (!currentUser.isSuccess || currentUser.data) return;
    expireAuthSession();
  }, [currentUser.data, currentUser.isSuccess, queryClient, router]);

  // Listen for auth:expired events from authFetch
  useEffect(() => {
    const handleExpired = () => {
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.push('/login');
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [queryClient, router]);

  if (currentUser.isPending) {
    return <BrandLoadingScreen />;
  }

  if (!currentUser.data) return <BrandLoadingScreen />;

  return <>{children}</>;
}
