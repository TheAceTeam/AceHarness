'use client';

import { useEffect, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { StoryOnboarding } from '@/components/onboarding/StoryOnboarding';
import { Button } from '@/components/ui/button';
import { useChat } from '@/contexts/ChatContext';

type Role = 'admin' | 'user';
type ProgressPayload = {
  done: boolean;
  phase: 'intro' | 'overview' | 'module' | 'member' | 'admin' | 'adminReport' | 'done';
  introIndex: number;
  selectedModule: any;
  moduleStepIndex: number;
  visitedModules: any[];
  memberChecks: {
    homeGuideDone: boolean;
    engineModelDone: boolean;
    notebookDone: boolean;
    personalDirConfirm: boolean;
  };
  adminChecks: {
    engineReady: boolean;
    defaultModel: boolean;
    agentGroup: boolean;
    personalDirReady: boolean;
  };
  maximized: boolean;
};

export default function OnboardingPortal() {
  const pathname = usePathname();
  const { isOpen: chatOpen } = useChat();
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<Role>('user');
  const [loadingProgress, setLoadingProgress] = useState(false);
  const [progress, setProgress] = useState<ProgressPayload | null>(null);

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
        setOpen(!data.progress.done);
      }
    } catch {
      // ignore
    } finally {
      setLoadingProgress(false);
    }
  }, [getAuthToken]);

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

  const persistProgress = async (nextProgress: ProgressPayload, options?: { markCompleted?: boolean }) => {
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

  const openWithRefresh = async () => {
    await loadProgress();
    setOpen(true);
  };

  if (pathname === '/' || pathname === '/chat') {
    return null;
  }

  return (
    <>
      <div
        className={`fixed bottom-24 z-[50] transition-[right,opacity,transform] duration-300 ${open ? 'pointer-events-none opacity-0' : 'opacity-100 translate-x-[calc(100%-22px)] hover:translate-x-0 focus-within:translate-x-0'}`}
        style={{
          right: chatOpen ? 420 : 0,
          transition: 'right 300ms ease-in-out, opacity 300ms ease-in-out, transform 220ms ease-in-out',
        }}
      >
        <div className="relative flex items-center pl-4">
          <div className="pointer-events-none absolute left-0 top-1/2 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-border/70 bg-background/94 text-muted-foreground shadow-sm backdrop-blur">
            <span className="material-symbols-outlined text-[14px]">school</span>
          </div>
          <Button
            className="h-14 w-14 rounded-full shadow-lg"
            variant="outline"
            onClick={() => {
              void openWithRefresh();
            }}
            title="打开新手引导"
          >
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>school</span>
          </Button>
        </div>
      </div>
      <StoryOnboarding
        open={open}
        role={role}
        initialProgress={progress}
        loadingProgress={loadingProgress}
        onPersist={persistProgress}
        onClose={(completed) => {
          if (completed && progress) {
            void persistProgress({ ...progress, done: true, phase: 'done' }, { markCompleted: true });
          }
          setOpen(false);
        }}
      />
    </>
  );
}
