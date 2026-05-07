'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-primary to-blue-600 rounded-xl flex items-center justify-center">
            <svg className="animate-spin w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
          <p className="text-sm text-muted-foreground">加载中...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
