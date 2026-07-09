'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/lib/navigation/client';
import { clearAuthSession } from '@/client/query/api-client';
import { isAuthUnauthorizedError, useCurrentUserQuery } from '@/client/query/auth';
import { queryKeys } from '@/client/query/query-keys';
import { buildLoginHref, getCurrentAuthReturnTo } from '@/lib/navigation/return-target';
import BrandLoadingScreen from './BrandLoadingScreen';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const currentUser = useCurrentUserQuery();
  const isLoginPage = typeof window !== 'undefined' && window.location.pathname === '/login';

  useEffect(() => {
    const expireAuthSession = () => {
      if (isLoginPage) return;
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.replace(buildLoginHref(getCurrentAuthReturnTo('/')));
    };

    if (!currentUser.isError || !isAuthUnauthorizedError(currentUser.error)) return;
    expireAuthSession();
  }, [currentUser.error, currentUser.isError, isLoginPage, queryClient, router]);

  useEffect(() => {
    const expireAuthSession = () => {
      if (isLoginPage) return;
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.replace(buildLoginHref(getCurrentAuthReturnTo('/')));
    };

    if (!currentUser.isSuccess || currentUser.data) return;
    expireAuthSession();
  }, [currentUser.data, currentUser.isSuccess, isLoginPage, queryClient, router]);

  // Listen for auth:expired events from authFetch
  useEffect(() => {
    const handleExpired = () => {
      if (isLoginPage) return;
      clearAuthSession({ emitEvent: false });
      queryClient.removeQueries({ queryKey: queryKeys.auth.currentUser() });
      router.replace(buildLoginHref(getCurrentAuthReturnTo('/')));
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [isLoginPage, queryClient, router]);

  if (currentUser.isPending) {
    return <BrandLoadingScreen />;
  }

  if (!currentUser.data) return <BrandLoadingScreen />;

  return <>{children}</>;
}
