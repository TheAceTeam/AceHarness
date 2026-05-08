'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BrandLoadingScreen from './BrandLoadingScreen';

interface AuthGuardProps {
  children: React.ReactNode;
}

export default function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('auth-token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) {
          localStorage.removeItem('auth-token');
          localStorage.removeItem('auth-user');
          router.push('/login');
        } else {
          return res.json().then(data => {
            if (data.user) {
              localStorage.setItem('auth-user', JSON.stringify(data.user));
            }
            setAuthChecked(true);
          });
        }
      })
      .catch(() => {
        localStorage.removeItem('auth-token');
        localStorage.removeItem('auth-user');
        router.push('/login');
      });
  }, [router]);

  // Listen for auth:expired events from authFetch
  useEffect(() => {
    const handleExpired = () => {
      localStorage.removeItem('auth-user');
      router.push('/login');
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, [router]);

  if (!authChecked) {
    return <BrandLoadingScreen />;
  }

  return <>{children}</>;
}
