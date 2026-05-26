'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ModernOnboardingTour, type ModernOnboardingProgress } from '@/components/onboarding/ModernOnboardingTour';
import { Button } from '@/components/ui/button';

type Role = 'admin' | 'user';
type TourLaunchMode = 'resume' | 'current-route';

export default function OnboardingPortal() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [launchMode, setLaunchMode] = useState<TourLaunchMode>('resume');
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [progress, setProgress] = useState<ModernOnboardingProgress | null>(null);
  const [dismissedForSession, setDismissedForSession] = useState(false);
  const lastTourQueryRef = useRef<string | null>(null);

  const getAuthToken = useCallback(() => (typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null), []);

  const loadProgress = useCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    setLoadingProgress(true);
    try {
      const res = await fetch('/api/onboarding/progress', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.role === 'admin' || data?.role === 'user') setRole(data.role);
      if (data?.progress) {
        setProgress(data.progress);
        setLaunchMode('resume');
        setOpen(!data.progress.done && !dismissedForSession && pathname !== '/' && pathname !== '/chat');
      }
    } catch {
      // ignore
    } finally {
      setLoadingProgress(false);
    }
  }, [dismissedForSession, getAuthToken, pathname]);

  useEffect(() => {
    const stored = localStorage.getItem('auth-user');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed?.role === 'admin') setRole('admin');
      } catch {
        // ignore
      }
    }
    void loadProgress();
  }, [loadProgress]);

  const openWithRefresh = useCallback(async (mode: TourLaunchMode) => {
    setDismissedForSession(false);
    setLaunchMode(mode);
    await loadProgress();
    setLaunchMode(mode);
    setOpen(true);
  }, [loadProgress]);

  useEffect(() => {
    const tourParam = searchParams.get('tour');
    if (!tourParam) {
      lastTourQueryRef.current = null;
      return;
    }
    if (tourParam === lastTourQueryRef.current) return;
    if (tourParam === '1' || tourParam === 'true' || tourParam === 'onboarding') {
      lastTourQueryRef.current = tourParam;
      void openWithRefresh('current-route');
    }
  }, [openWithRefresh, searchParams]);

  const persistProgress = async (nextProgress: ModernOnboardingProgress, options?: { markCompleted?: boolean }) => {
    setProgress(nextProgress);
    const token = getAuthToken();
    if (!token) return;
    try {
      await fetch('/api/onboarding/progress', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          progress: nextProgress,
          markCompleted: options?.markCompleted === true,
        }),
      });
    } catch {
      // ignore
    }
  };

  return (
    <>
      <div
        className={`fixed bottom-24 right-0 z-[50] transition-[right,opacity,transform] duration-300 ${open ? 'pointer-events-none opacity-0' : 'opacity-100 translate-x-[calc(100%-22px)] hover:translate-x-0 focus-within:translate-x-0'}`}
        style={{ transition: 'opacity 300ms ease-in-out, transform 220ms ease-in-out' }}
      >
        <div className="relative flex items-center pl-4">
          <div className="pointer-events-none absolute left-0 top-1/2 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-border/70 bg-background/94 text-muted-foreground shadow-sm backdrop-blur">
            <span className="material-symbols-outlined text-[14px]">school</span>
          </div>
          <Button
            className="h-14 w-14 rounded-full shadow-lg"
            variant="outline"
            onClick={() => {
              void openWithRefresh('current-route');
            }}
            title="打开产品导览"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>school</span>
          </Button>
        </div>
      </div>
      <ModernOnboardingTour
        open={open}
        role={role}
        launchMode={launchMode}
        initialProgress={progress}
        loadingProgress={loadingProgress}
        onPersist={persistProgress}
        onClose={(completed) => {
          if (!completed) setDismissedForSession(true);
          setOpen(false);
        }}
      />
    </>
  );
}
